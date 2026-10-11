/* Wake word ("Hey Jarvis") — ANDROID FORK.
 *
 * openWakeWord listens on-device (free, instant, always running). On a detection the
 * native engine keeps recording until the command ends and hands over ONE clip — the
 * seconds before the wake plus the command (CommandCapture in WakePreRoll.kt). It is
 * transcribed once; the command counts only if the recogniser also heard "Hey Jarvis" in
 * it, and is whatever follows that. The mic is never handed over, so "Hey Jarvis, open X"
 * in one breath keeps its first words (the old WebView-mic handoff lost ~0.5–1 s).
 *
 * The old Whisper-in-a-loop hack (record 3.5s → API → regex → repeat) is gone.
 */

import { invoke } from "@tauri-apps/api/core";
import { transcribe, isNoiseTranscript } from "./stt";
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

// How long to wait for the clip: the native capture's 10 s ceiling plus slack.
const CLIP_WAIT_MS = 14000;
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

/** The command in a clip's transcript: what follows its LAST "Hey Jarvis" (the pre-roll
 *  can hold talk from before it). null when no wake phrase was heard — a false wake. */
export function commandAfterWake(text: string): string | null {
  let end = -1;
  for (const m of text.matchAll(new RegExp(WAKE_PHRASE.source, "gi"))) end = m.index + m[0].length;
  return end < 0 ? null : stripWake(text.slice(end));
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
//   1. `handling` was set before an unbounded await (then getUserMedia; the mic is
//      no longer handed over, but a dropped poll reply would do the same): the
//      finally never runs, `handling` stays true and poll() early-returns forever.
//   2. a failed resume was swallowed by an empty catch, so nothing recovered and
//      nothing was reported.
// So rather than guess at the trigger, bound every wait and supervise the state:
// whatever wedges it, it un-wedges itself within HANDLING_MAX_MS and says so.
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

/** A detection's clip: base64 WAV of the wake plus the command, and whether anything past
 *  the wake word sounded like speech. */
interface Clip {
  wav: string;
  speech: boolean;
}

export class WakeWordListener {
  private on = false;
  private handling = false;
  private handlingSince = 0;
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
    // Skip while onWake() is handling a command — it polls for the clip itself. But never trust
    // that flag indefinitely: if it has been set longer than a whole cycle could
    // possibly take, something wedged and this is the only code left running that
    // can notice (see the stuck-listener note above).
    if (this.handling) {
      if (Date.now() - this.handlingSince < HANDLING_MAX_MS) return;
      this.handling = false;
      this.opts.onStatus?.("idle");
      this.opts.onError?.("Wake word got stuck mid-command — restarting the listener.");
      void invoke("plugin:phone|start_wake_word").catch(() => {});
      return;
    }
    type WakeState = { seq?: number; listening?: boolean; preRoll?: string; speech?: boolean };
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
      void this.onWake(st.preRoll ? { wav: st.preRoll, speech: st.speech !== false } : undefined);
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

  private async onWake(clip?: Clip): Promise<void> {
    if (!this.on || this.opts.isBusy() || this.handling) return;
    this.handling = true;
    this.handlingSince = Date.now();
    // Light the HUD "listening" state the INSTANT we pick up the wake — the command is
    // still being recorded natively, and silence here would feel dead.
    this.opts.onStatus?.("listening");
    try {
      const c = clip ?? (await this.fetchClip());
      this.opts.onStatus?.("idle");
      // No clip (a lost reply), or nothing said after the wake: don't pay the recogniser
      // to invent a phantom command.
      if (!c || !c.speech || !this.on) return;

      let text = "";
      try {
        const wav = new Blob([base64ToBytes(c.wav)], { type: "audio/wav" });
        // The hint is the name alone, never the command prompt's "Hey JARVIS": Whisper can
        // echo its prompt, and an echo of "Jarvis" has no greeting, so it can't pass the
        // wake check on its own.
        text = await this.transcribeBlob(wav, { prompt: "Jarvis" });
      } catch (e) {
        this.opts.onError?.((e as Error)?.message || String(e));
        return;
      }

      // The on-device model also fires on conversation that only sounds close (live
      // 2026-09-26), and its scores can't tell them apart: genuine wakes on this phone
      // scored as low as 0.37. So a command counts only if "Hey Jarvis" is in the clip.
      const clean = commandAfterWake(text);
      if (clean === null) {
        console.info(`[wake] ignored — no "Hey Jarvis" in the clip: "${text.slice(0, 60)}"`);
        return;
      }
      // Drop empty commands and Whisper's stock silence hallucinations ("thank you",
      // "thanks for watching", …) so a wake with no real command doesn't fire a phantom turn.
      if (clean && !isNoiseTranscript(clean) && this.on) {
        this.opts.onCommand(clean);
        await this.settle();
      }
    } finally {
      this.handling = false;
      // The engine keeps running through a command; this only revives one that died.
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

  /** The clip, which the engine hands over once the command has ended. */
  private async fetchClip(): Promise<Clip | undefined> {
    const until = Date.now() + CLIP_WAIT_MS;
    while (this.on && Date.now() < until) {
      try {
        // Bounded: the bridge can drop a reply, and an unanswered await would wedge us.
        const st = (await withTimeout(
          invoke("plugin:phone|poll_wake_word"),
          POLL_STUCK_MS,
          "wake poll",
        )) as { preRoll?: string; speech?: boolean } | null;
        if (st?.preRoll) return { wav: st.preRoll, speech: st.speech !== false };
      } catch {
        // try again
      }
      await sleep(POLL_MS);
    }
    console.warn("[wake] the command clip never arrived");
    return undefined;
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
