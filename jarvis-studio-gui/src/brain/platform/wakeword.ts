/* Wake word ("Hey Jarvis") — ANDROID FORK.
 *
 * Matches the desktop flow: openWakeWord listens on-device (free, instant, always
 * running). When "Hey Jarvis" is heard, we release the wake mic, capture your command
 * with Groq Whisper Large v3, and send it to the brain — same as the laptop — once
 * Whisper has also heard "Hey Jarvis" in the audio that fired the wake (heardWake).
 *
 * The old Whisper-in-a-loop hack (record 3.5s → API → regex → repeat) is gone.
 */

import { invoke } from "@tauri-apps/api/core";
import { MicRecorder, transcribe, isNoiseTranscript } from "./stt";
import { inTauri } from "../tools/httpClient";
import { base64ToBytes } from "../tools/base64";

const WAKE = /\b(?:hey\s+|ok(?:ay)?\s+|hi\s+)?j[ae][rv]+i[s5]\b/i;

/** "Hey Jarvis" the way a recogniser writes it: a greeting, then the name. Whisper also
 *  spells the name Jervis, Javis or Travis, and hears "Hey" as "Kay" or "A." (live
 *  2026-09-27). A bare "Jarvis" doesn't count — "my Jarvis app" is someone talking ABOUT
 *  JARVIS, which is how the 2026-09-26 false wake started. */
const WAKE_PHRASE =
  /(?:\b(?:hey|hi|hay|hei|ay|eh|kay|ok(?:ay)?|hello|yo)\b[\s,.!-]*|\ba[.,!]\s*)(?:j|ch|tr)[ae]r?v[aeiu]s\b/i;

export function heardWakePhrase(text: string): boolean {
  return WAKE_PHRASE.test(text);
}

// Ceiling only: capture ends ~0.9s after you stop talking (MicRecorder.untilSilence).
// Was a fixed 6s window — every command waited the full 6s, and longer ones got cut.
const COMMAND_MS = 10000;
const POLL_MS = 140; // how often JS asks the native engine "any new detection?" — low
// enough that a wake is picked up almost immediately (the poll is a cheap atomic read).
const POLL_STUCK_MS = 3000; // a poll unanswered this long is presumed dropped

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function stripWake(text: string): string {
  return text
    .replace(WAKE, "")
    .replace(/^[\s,.:;!?-]+/, "")
    .trim();
}

export interface WakeWordOpts {
  groqKey?: string;
  vertexSaJson?: string; // not used to transcribe (that's in `transcribe`) — only to
  // compute the config signature so syncWakeWord() knows when to restart the engine.
  /** `prompt: ""` asks for no vocabulary prompt (the wake check needs an unbiased ear). */
  transcribe?: (blob: Blob, o?: { prompt?: string }) => Promise<string>;
  isBusy: () => boolean;
  onStatus?: (s: "listening" | "idle") => void;
  onCommand: (text: string) => void;
  onError?: (msg: string) => void;
  onFatal?: (msg: string) => void;
}

// ── Stuck-listener recovery ───────────────────────────────────────────────────
// Reported live: "after a timer is set, JARVIS stopped responding to Hey Jarvis."
// The obvious mechanism — the Clock intent stealing foreground and the mic
// foreground-service resume being refused — was MEASURED AND RULED OUT:
// EXTRA_SKIP_UI keeps JARVIS as topResumedActivity and polling never pauses.
// The real trigger is still unidentified.
//
// What IS certain from the code is that this listener had two ways to wedge
// permanently, both of which present exactly as "the wake word just stopped":
//   1. `handling` is set before an unbounded `await capture()`. getUserMedia
//      hanging (rather than rejecting) means the finally never runs, so
//      `handling` stays true, poll() early-returns forever, and the engine is
//      left stopped by onWake's own stop_wake_word.
//   2. a failed resume was swallowed by an empty catch, so nothing recovered and
//      nothing was reported.
// So rather than guess at the trigger, bound every wait and supervise the state:
// whatever wedges it, it un-wedges itself within HANDLING_MAX_MS and says so.
const CAPTURE_TIMEOUT_MS = COMMAND_MS + 6000; // record window + mic start/stop slack
const HANDLING_MAX_MS = 45000; // ceiling on one wake→command→resume cycle

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export class WakeWordListener {
  private on = false;
  private handling = false;
  private handlingSince = 0;
  private rec = new MicRecorder();
  private bootTimer?: ReturnType<typeof setTimeout>;
  private pollTimer?: ReturnType<typeof setInterval>;
  private lastSeq = -1; // baseline set on first poll so we ignore prior detections
  private notListeningStreak = 0;
  private onVisible?: () => void;
  /** When the in-flight poll started (0 = none). See poll(). */
  private pollingSince = 0;

  constructor(private opts: WakeWordOpts) {}

  get active(): boolean {
    return this.on;
  }

  start(): void {
    if (this.on || !inTauri()) return;
    this.on = true;
    // Defer the native work briefly. The syncWakeWord() singleton already guarantees
    // one instance across re-renders; this second guard covers the remaining case of
    // a rapid CONFIG change (e.g. a key being edited) that stops this listener and
    // starts a new one within a few hundred ms — the delay lets stop() cancel this
    // boot before it issues native invokes.
    this.bootTimer = setTimeout(() => {
      this.bootTimer = undefined;
      if (this.on) this.boot();
    }, 150);
  }

  stop(): void {
    this.on = false;
    this.handling = false;
    if (this.bootTimer) {
      clearTimeout(this.bootTimer);
      this.bootTimer = undefined;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    if (this.onVisible && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisible);
      this.onVisible = undefined;
    }
    this.rec.cancel();
    this.opts.onStatus?.("idle");
    void invoke("plugin:phone|stop_wake_word").catch(() => {});
  }

  /**
   * Start the native engine and then POLL it for detections — deliberately NOT the
   * Tauri event/Channel bridge (addPluginListener + trigger). Confirmed live on this
   * device: that bridge drops callbacks during the WebView's startup reloads ("[TAURI]
   * Couldn't find callback id …"), so `register_listener` never completed and native
   * `trigger("wake-detected")` never reached the page — the engine detected "Hey
   * Jarvis" perfectly (score ~0.9) but nothing happened in the app. The plain
   * request/response invoke path, by contrast, is reliable (getDeviceStats polls it
   * every second without loss). So we poll a monotonic detection counter instead.
   */
  private boot(): void {
    // Kick the engine (best-effort — its reply may be dropped by the bridge; the poll
    // loop below confirms liveness and restarts it if it's ever down).
    void invoke("plugin:phone|start_wake_word").catch(() => {});
    this.pollTimer = setInterval(() => void this.poll(), POLL_MS);

    // Coming back to the foreground is the moment a resume is most likely to be
    // both needed and permitted (Android refuses a microphone foreground-service
    // start from the background). Cheap insurance for every app-switch path —
    // phone_task, the calendar's ACTION_INSERT fallback, the user leaving the app.
    if (typeof document !== "undefined") {
      this.onVisible = () => {
        if (!this.on || this.handling || document.hidden) return;
        void invoke("plugin:phone|start_wake_word").catch(() => {});
      };
      document.addEventListener("visibilitychange", this.onVisible);
    }
  }

  /**
   * One poll in flight at a time. A detection's audio rides on exactly one reply, and
   * that ~130 KB reply is slow: with overlapping polls the next, tiny reply overtook it
   * and reported the wake with no audio (live 2026-09-27, 114 ms apart), so it went
   * through unchecked. Bounded, so a reply the bridge drops can't stop polling for good.
   */
  private async poll(): Promise<void> {
    if (Date.now() - this.pollingSince < POLL_STUCK_MS) return;
    this.pollingSince = Date.now();
    try {
      await this.pollOnce();
    } finally {
      this.pollingSince = 0;
    }
  }

  private async pollOnce(): Promise<void> {
    // Skip while onWake() is capturing a command — it intentionally stops the engine,
    // and we must neither re-fire nor auto-restart underneath it. But never trust
    // that flag indefinitely: if it has been set longer than a whole cycle could
    // possibly take, something wedged and this is the only code left running that
    // can notice (see the stuck-listener note above).
    if (this.handling) {
      if (Date.now() - this.handlingSince < HANDLING_MAX_MS) return;
      this.handling = false;
      this.rec.cancel();
      this.opts.onStatus?.("idle");
      this.opts.onError?.("Wake word got stuck mid-command — restarting the listener.");
      void invoke("plugin:phone|start_wake_word").catch(() => {});
      return;
    }
    type WakeState = { seq?: number; listening?: boolean; preRoll?: string };
    let st: WakeState | null = null;
    try {
      st = (await invoke("plugin:phone|poll_wake_word")) as WakeState;
    } catch {
      return; // transient bridge hiccup — just try again next tick
    }
    if (!st || !this.on) return;
    const seq = typeof st.seq === "number" ? st.seq : 0;
    if (this.lastSeq < 0) {
      this.lastSeq = seq; // first poll: baseline, don't react to pre-existing detections
    } else if (seq > this.lastSeq) {
      this.lastSeq = seq;
      void this.onWake(st.preRoll);
      return;
    }
    if (st.listening) {
      this.notListeningStreak = 0;
    } else {
      // Engine isn't up — (re)start it. On a fresh cold start the first attempts may
      // race the bridge; only surface a fatal if it stays down for a sustained stretch
      // (~6s), which points at a genuine mic/asset failure rather than a startup blip.
      this.notListeningStreak += 1;
      void invoke("plugin:phone|start_wake_word").catch(() => {});
      if (this.notListeningStreak === 20) {
        this.opts.onFatal?.(
          "Could not start on-device wake word — check that JARVIS has microphone access.",
        );
      }
    }
  }

  private async onWake(preRoll?: string): Promise<void> {
    if (!this.on || this.opts.isBusy() || this.handling) return;
    this.handling = true;
    this.handlingSince = Date.now();
    // Light the HUD "listening" state the INSTANT we pick up the wake, before the mic
    // handoff below — otherwise the user gets no feedback for ~½ second after saying
    // "Hey Jarvis" and it feels dead. Reset to idle on any early bail-out.
    this.opts.onStatus?.("listening");
    let verdict = Promise.resolve(true);
    try {
      await invoke("plugin:phone|stop_wake_word").catch(() => {});
      // Let the wake-word AudioRecord release before MediaRecorder opens. Kept short so
      // capture starts promptly after the wake; too low risks the mic still being held.
      await sleep(250);
      if (!this.on || this.opts.isBusy()) {
        this.opts.onStatus?.("idle");
        return;
      }
      // The engine hands the wake audio over once it stops (the audio runs a little past
      // the detection, which often fires before "Jarvis" has ended). It's fetched and
      // checked while the command records — recording starts no later than before — and a
      // false wake is dropped, its recording cut short, once the verdict is in.
      verdict = (preRoll ? Promise.resolve(preRoll) : this.fetchPreRoll()).then((audio) => {
        if (audio) return this.heardWake(audio);
        console.info("[wake] no wake audio came with this detection; unchecked");
        return true;
      });
      void verdict.then((ok) => ok || this.rec.cancel());

      const blob = await this.capture(COMMAND_MS);
      this.opts.onStatus?.("idle");
      if (!(await verdict) || !blob || !this.on) return;

      let text = "";
      try {
        text = await this.transcribeBlob(blob);
      } catch (e) {
        this.opts.onError?.((e as Error)?.message || String(e));
        return;
      }

      const clean = stripWake(text);
      // Drop empty/near-silent captures and Whisper's stock silence hallucinations
      // ("thank you", "thanks for watching", …) so a wake with no real command doesn't
      // fire a phantom turn. `clean` has the wake word already stripped.
      if (clean && !isNoiseTranscript(clean) && this.on) {
        this.opts.onCommand(clean);
        await this.settle();
      }
    } finally {
      this.handling = false;
      if (this.on) {
        try {
          await invoke("plugin:phone|start_wake_word");
        } catch (e) {
          // Never silent. A resume can legitimately be refused while the app is
          // backgrounded (Android blocks starting a microphone foreground service
          // from there) — that case is expected and the visibilitychange handler
          // above will retry, so only bother the user when we ARE visible and it
          // still failed, which means the engine is genuinely down.
          const hidden = typeof document !== "undefined" && document.hidden;
          if (!hidden) {
            this.opts.onError?.(
              `Couldn't restart wake-word listening: ${String((e as Error)?.message ?? e)}`,
            );
          }
        }
      }
    }
  }

  private transcribeBlob(blob: Blob, o?: { prompt?: string }): Promise<string> {
    if (this.opts.transcribe) return this.opts.transcribe(blob, o);
    const key = (this.opts.groqKey || "").trim();
    if (!key) {
      return Promise.reject(
        new Error("Add a Groq API key to transcribe commands after “Hey Jarvis”."),
      );
    }
    return transcribe(blob, { groqKey: key, ...o });
  }

  /** The wake audio, which the engine hands over as it stops (a few polls at most). */
  private async fetchPreRoll(): Promise<string | undefined> {
    for (let i = 0; i < 5; i++) {
      try {
        const st = (await invoke("plugin:phone|poll_wake_word")) as { preRoll?: string } | null;
        if (st?.preRoll) return st.preRoll;
      } catch {
        // try again
      }
      await sleep(100);
    }
    return undefined;
  }

  /**
   * Did a real recogniser hear "Hey Jarvis" in the audio that fired the wake? The on-device
   * model also fires on conversation that only sounds close (live 2026-09-26), and its
   * scores can't tell them apart: genuine wakes on this phone scored as low as 0.37. The
   * hint is the name alone, never the command prompt's "Hey JARVIS": Whisper can echo its
   * prompt, and an echo of "Jarvis" has no greeting, so it can't pass on its own.
   * A check that can't run (no audio, a failed call) lets the wake through, as before.
   */
  private async heardWake(preRollB64: string): Promise<boolean> {
    try {
      const wav = new Blob([base64ToBytes(preRollB64)], { type: "audio/wav" });
      const text = await this.transcribeBlob(wav, { prompt: "Jarvis" });
      const heard = WAKE_PHRASE.exec(text);
      if (heard) {
        console.info(`[wake] confirmed: "${heard[0]}"`);
        return true;
      }
      console.info(`[wake] ignored — no "Hey Jarvis" in the wake audio: "${text.slice(0, 60)}"`);
      return false;
    } catch (e) {
      console.warn("[wake] couldn't check the wake audio; accepting the wake:", e);
      return true;
    }
  }

  /** Record for `ms`. Bounded: an unbounded await here is what let a hung
   *  getUserMedia wedge `handling` (and with it the whole listener) forever. */
  private async capture(ms: number): Promise<Blob | null> {
    try {
      return await withTimeout(
        (async () => {
          await this.rec.start();
          await this.rec.untilSilence(ms);
          return this.rec.stop();
        })(),
        CAPTURE_TIMEOUT_MS,
        "mic capture",
      );
    } catch (e) {
      this.rec.cancel();
      this.opts.onError?.(`Microphone capture failed: ${String((e as Error)?.message ?? e)}`);
      return null;
    }
  }

  private async settle(): Promise<void> {
    for (let i = 0; i < 12 && this.on && !this.opts.isBusy(); i += 1) {
      await sleep(100);
    }
  }
}

// ── App-global singleton ──────────────────────────────────────────────────────
// The wake engine is a single, app-lived resource backed by an Android foreground
// service — it's meant to OUTLIVE the React component tree, not be spun up and torn
// down on every effect run. Tying its lifecycle to a useEffect's mount/cleanup was
// the actual root-cause bug: React StrictMode (main.jsx) and rapid startup
// re-renders mount → unmount → remount the effect, so a transient listener's async
// native boot got torn down mid-flight, orphaning Tauri IPC callbacks ("[TAURI]
// Couldn't find callback id …") and hanging boot() before start_wake_word ever
// dispatched. This manager dedupes by config signature so EXACTLY ONE engine boots
// no matter how many times the effect re-runs, and it only stops when the caller
// explicitly asks (wake word turned off, or every credential removed).
let current: WakeWordListener | null = null;
let currentSig: string | null = null;

/** Cheap, non-secret signature of the config that would change the engine. */
function sigOf(opts: WakeWordOpts): string {
  const s = `${opts.groqKey || ""} ${opts.vertexSaJson || ""}`;
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

/**
 * Idempotently reconcile the wake engine to the desired state. Pass `null` to turn
 * it off. SAFE TO CALL ON EVERY RENDER: re-invoking with the same config is a no-op,
 * so it doesn't matter how many times (or how erratically) a React effect fires it.
 * Do NOT wire this to an effect's cleanup — let it own the lifecycle across renders.
 */
export function syncWakeWord(opts: WakeWordOpts | null): void {
  if (!inTauri()) return;
  if (!opts || (!(opts.groqKey || "").trim() && !(opts.vertexSaJson || "").trim())) {
    if (current) {
      current.stop();
      current = null;
      currentSig = null;
    }
    return;
  }
  const sig = sigOf(opts);
  if (current && currentSig === sig) return; // already running with this exact config
  current?.stop();
  current = new WakeWordListener(opts);
  currentSig = sig;
  current.start();
}
