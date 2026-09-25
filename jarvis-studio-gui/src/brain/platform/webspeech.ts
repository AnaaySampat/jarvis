/* Web Speech TTS — ANDROID FORK (Milestone 1B).
 *
 * Speaks JARVIS's replies using the WebView's SpeechSynthesis API, which on Android
 * is backed by the device's native TextToSpeech engine. This gives real on-device
 * spoken output with no custom Kotlin plugin. (A dedicated TextToSpeech plugin can
 * replace this later for finer voice control; the interface is the same.)
 *
 * Implements platform/index.ts `TextToSpeech`. `speak()` resolves when the utterance
 * finishes, errors, or a length-based safety timeout fires (so the caller's
 * "speaking" status can never get stuck — e.g. in a headless browser with no voices).
 */

import { invoke } from "@tauri-apps/api/core";
import type { TextToSpeech } from "./index";
import { inTauri } from "../tools/httpClient";
import { stripMarkdownForSpeech } from "../formatting";

function synth(): SpeechSynthesis | null {
  return typeof window !== "undefined" && "speechSynthesis" in window
    ? window.speechSynthesis
    : null;
}

// Native Android TextToSpeech (via tauri-plugin-phone). Android System WebView does
// NOT implement window.speechSynthesis, so on-device this is the ONLY way to actually
// produce audio. Returns false if the plugin call fails (then we fall back to synth).
async function nativeSpeak(text: string): Promise<boolean> {
  try {
    await invoke("plugin:phone|speak", { text });
    return true;
  } catch {
    return false;
  }
}

// Real completion, polled the same reliable way wake-word detections are (the Tauri
// event/Channel bridge drops callbacks on this device — see wakeword.ts). `estimateMs`
// remains only as a safety-net ceiling in case the native UtteranceProgressListener
// never fires on some OEM TTS engine; it used to be the ONLY signal, which let the
// "speaking" status (and anything gated on it, like the phone-control STOP banner)
// disappear early on longer replies whose real duration ran past the guess.
let stopCurrent: (() => void) | null = null;
/**
 * Ceiling for how long an utterance could possibly take.
 *
 * This is ONLY a backstop for an OEM engine whose UtteranceProgressListener never
 * fires — `pollNativeSpeaking` is the real completion signal. It was capped at 30s,
 * which is shorter than the actual speech for anything past ~530 characters: the
 * timer fired mid-sentence, resolved speak(), and tore down the poller, so
 * "speaking" went false while Android was still talking — the exact early-drop the
 * polling was added to fix. A 1500-char reply takes ~100s and got cut at 30.
 *
 * 55ms/char is also optimistic (that's ~18 chars/sec; Android's default English
 * voice runs nearer 14), so the rate is relaxed too and the cap raised well clear of
 * any plausible reply.
 */
function estimateMs(text: string): number {
  return Math.min(180000, 1500 + text.length * 80);
}
async function pollNativeSpeaking(): Promise<boolean> {
  try {
    const st = (await invoke("plugin:phone|poll_speaking")) as { speaking?: boolean };
    return Boolean(st?.speaking);
  } catch {
    return false;
  }
}
const SPEAK_POLL_MS = 150;

/** True when the WebView actually has a usable TTS voice. */
export function ttsAvailable(): boolean {
  const s = synth();
  if (!s) return false;
  try {
    return s.getVoices().length > 0;
  } catch {
    return false;
  }
}

/** Prefer a natural English voice when several are installed. */
function pickVoice(s: SpeechSynthesis): SpeechSynthesisVoice | null {
  const voices = s.getVoices();
  if (!voices.length) return null;
  const en = voices.filter((v) => /^en(-|_|$)/i.test(v.lang));
  const pool = en.length ? en : voices;
  return pool.find((v) => /natural|google|neural|enhanced/i.test(v.name)) ?? pool[0];
}

export const webSpeechTTS: TextToSpeech = {
  async speak(text: string): Promise<void> {
    // The transcript can contain **bold** and other readable Markdown. Passing
    // it through unchanged makes Android literally say "asterisk asterisk".
    const clean = stripMarkdownForSpeech(text);
    if (!clean) return;

    // On-device: speak through native Android TextToSpeech (the WebView has no
    // speechSynthesis). Hold "speaking" for an estimated duration, interruptible.
    if (inTauri()) {
      const ok = await nativeSpeak(clean);
      if (ok) {
        await new Promise<void>((resolve) => {
          let settled = false;
          let sawSpeaking = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(safetyTimer);
            clearInterval(poller);
            stopCurrent = null;
            resolve();
          };
          // Ceiling only — real completion (below) resolves first in the normal
          // case. Guards against an OEM engine that never fires onDone/onError.
          const safetyTimer = setTimeout(finish, estimateMs(clean));
          // onStart can lag a beat behind the speak() call returning, so only treat
          // "not speaking" as completion once we've actually observed it start —
          // otherwise the very first poll (before onStart fires) would look like
          // an instantly-finished utterance and cut the wait short immediately.
          const poller = setInterval(() => {
            void pollNativeSpeaking().then((isSpeaking) => {
              if (isSpeaking) sawSpeaking = true;
              else if (sawSpeaking) finish();
            });
          }, SPEAK_POLL_MS);
          stopCurrent = finish;
        });
        return;
      }
      // Native call failed — fall through to the synth path (unlikely on Android).
    }

    // Browser-preview path: the Web Speech synthesis API (works in real browsers).
    const s = synth();
    if (!s) return;
    await new Promise<void>((resolve) => {
      try {
        s.cancel(); // never overlap with a previous utterance
        const u = new SpeechSynthesisUtterance(clean);
        const v = pickVoice(s);
        if (v) u.voice = v;
        u.rate = 1.0;
        u.pitch = 1.0;
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve();
        };
        u.onend = finish;
        u.onerror = finish;
        // Safety net: if onend never fires (some WebViews/headless), resolve anyway.
        const timer = setTimeout(finish, Math.min(45000, 2500 + clean.length * 70));
        s.speak(u);
      } catch {
        resolve();
      }
    });
  },

  stop(): Promise<void> {
    if (inTauri()) invoke("plugin:phone|stop_speaking").catch(() => {});
    if (stopCurrent) stopCurrent(); // cut the native "speaking" wait short
    try {
      synth()?.cancel();
    } catch {
      /* ignore */
    }
    return Promise.resolve();
  },
};
