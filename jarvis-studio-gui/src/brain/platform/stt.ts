/* Speech-to-text — ANDROID FORK.
 *
 * Captures microphone audio in the WebView via MediaRecorder, then transcribes it
 * with Groq's Whisper Large v3 Turbo endpoint. Requires a Groq API key (free tier).
 */

import { platformFetch, withRetry } from "../tools/httpClient";
import { bytesToBase64 } from "../tools/base64";

const GROQ_STT_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
// Full v3, not turbo: Groq lists 10.3% vs 12% WER, and both return a few-second
// command in well under a second, so the accuracy is nearly free.
const WHISPER_MODEL = "whisper-large-v3";
// Biases spelling/vocabulary toward assistant commands. Whisper can echo its prompt
// on near-silence, so isNoiseTranscript() screens an exact echo.
const WHISPER_PROMPT = "Hey JARVIS, a voice command for a phone assistant.";

/** The first recording container the WebView supports (Whisper accepts all). */
function pickRecordMime(): string {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return "";
  }
  for (const m of [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
    "audio/3gpp",
  ]) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

/** Records a single push-to-talk turn from the microphone. */
export class MicRecorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];

  get recording(): boolean {
    return this.recorder?.state === "recording";
  }

  /** Begin capturing. Throws if mic permission is denied / unavailable. */
  async start(): Promise<void> {
    if (this.recording) return;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.chunks = [];
    const mime = pickRecordMime();
    this.recorder = mime
      ? new MediaRecorder(this.stream, { mimeType: mime })
      : new MediaRecorder(this.stream);
    this.recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start(250);
  }

  /** Stop and return the recorded audio (or null if nothing captured). */
  stop(): Promise<Blob | null> {
    return new Promise((resolve) => {
      const mr = this.recorder;
      if (!mr || mr.state === "inactive") {
        this.cleanup();
        resolve(null);
        return;
      }
      mr.onstop = () => {
        const type = mr.mimeType || "audio/webm";
        const blob = this.chunks.length ? new Blob(this.chunks, { type }) : null;
        this.cleanup();
        resolve(blob);
      };
      try {
        mr.stop();
      } catch {
        this.cleanup();
        resolve(null);
      }
    });
  }

  /**
   * Resolves once the speaker is done: `silenceMs` of quiet after speech, `noSpeechMs`
   * with no speech at all, or `maxMs` regardless. Replaces a fixed record window that
   * made every wake-word command wait the full 6s. Resolves true if speech was heard.
   * ponytail: plain energy VAD with a tracked noise floor — swap for a model VAD
   * (Silero) if loud rooms keep it from ending early.
   */
  async untilSilence(maxMs: number, silenceMs = 900, noSpeechMs = 4000): Promise<boolean> {
    const Ctx =
      typeof window !== "undefined"
        ? (window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
        : undefined;
    const stream = this.stream;
    let ctx: AudioContext | null = null;
    try {
      if (!Ctx || !stream) throw new Error("no Web Audio");
      ctx = new Ctx();
      await ctx.resume().catch(() => {});
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Float32Array(an.fftSize);
      return await new Promise<boolean>((resolve) => {
        const t0 = Date.now();
        let floor = Infinity;
        let heard = false;
        let anySignal = false; // a suspended/broken analyser reads all zeros
        let lastLoud = t0;
        const timer = setInterval(() => {
          an.getFloatTimeDomainData(buf);
          let sum = 0;
          for (const v of buf) sum += v * v;
          const rms = Math.sqrt(sum / buf.length);
          if (rms > 0) anySignal = true;
          // Floor drops instantly, rises slowly, so speech barely moves it.
          floor = rms < floor ? rms : floor + (rms - floor) * 0.01;
          const now = Date.now();
          if (rms > Math.max(0.01, floor * 3)) {
            heard = true;
            lastLoud = now;
          }
          const done =
            now - t0 >= maxMs ||
            (heard ? now - lastLoud >= silenceMs : anySignal && now - t0 >= noSpeechMs) ||
            !this.recording;
          if (done) {
            clearInterval(timer);
            resolve(heard);
          }
        }, 50);
      });
    } catch {
      await new Promise((r) => setTimeout(r, maxMs)); // no Web Audio: old fixed window
      return true;
    } finally {
      void ctx?.close().catch(() => {});
    }
  }

  cancel(): void {
    try {
      this.recorder?.stop();
    } catch {
      /* ignore */
    }
    this.cleanup();
  }

  private cleanup(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
  }
}

/** Transcribe a recorded audio blob to text via Groq Whisper Large v3. */
export async function transcribeWithGroq(blob: Blob, groqKey: string): Promise<string> {
  const ext = (blob.type || "").includes("mp4") ? "m4a" : "webm";
  const form = new FormData();
  form.append("file", blob, `speech.${ext}`);
  form.append("model", WHISPER_MODEL);
  form.append("response_format", "json");
  form.append("language", "en");
  form.append("temperature", "0");
  form.append("prompt", WHISPER_PROMPT);

  const res = await withRetry(() =>
    platformFetch()(GROQ_STT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${groqKey}` },
      body: form,
    }),
  );
  if (!res.ok) {
    throw new Error(`Groq STT ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as { text?: string } | null;
  return (json?.text || "").trim();
}

/** Transcribe via Google Cloud Speech-to-Text v2 (Chirp model) using Vertex AI credentials. */
export async function transcribeWithVertex(
  blob: Blob,
  saJson: string,
  region = "us-central1",
): Promise<string> {
  // Import dynamically to avoid circular deps at module load time
  const { getAccessToken, extractProjectId } = await import("../providers/vertexAuth");
  const project = extractProjectId(saJson);
  const token = await getAccessToken(saJson);

  // Convert blob to base64
  const buf = await blob.arrayBuffer();
  const audioBase64 = bytesToBase64(new Uint8Array(buf));

  const body = JSON.stringify({
    config: {
      autoDecodingConfig: {},
      model: "chirp_2",
      languageCodes: ["en-US"],
      features: { enableAutomaticPunctuation: true },
    },
    content: audioBase64,
  });

  const url = `https://${region}-speech.googleapis.com/v2/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(region)}:recognize`;

  const res = await withRetry(() =>
    platformFetch()(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body,
    }),
  );

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Cloud STT ${res.status}: ${detail.slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    results?: Array<{ alternatives?: Array<{ transcript?: string }> }>;
  } | null;
  const results = json?.results ?? [];
  const transcript = results
    .map((r) => r?.alternatives?.[0]?.transcript ?? "")
    .join(" ")
    .trim();
  return transcript;
}

/**
 * Transcribe via the best available backend, falling back to the other one.
 *
 * Groq Whisper Large v3 is tried first: it is markedly faster than Chirp,
 * which matters most right after the wake word. (The old docstring claimed
 * "Vertex Chirp > Groq Whisper" while the code did the opposite — the code's order
 * is the one that was actually wanted, so the comment is what was wrong.)
 *
 * The real bug was the missing FALLBACK: whichever backend was chosen, a failure
 * threw straight out even when working credentials for the other one were sitting
 * right there, so a Groq rate-limit took voice input down completely for a user who
 * also had a Vertex service account.
 */
export async function transcribe(
  blob: Blob,
  keys: { groqKey?: string; vertexSaJson?: string },
): Promise<string> {
  const groqKey = (keys.groqKey || "").trim();
  const saJson = (keys.vertexSaJson || "").trim();
  if (!groqKey && !saJson) {
    throw new Error(
      "Voice needs either a Vertex AI service account (recommended) or a Groq API key. Add one in Settings.",
    );
  }
  if (groqKey) {
    try {
      return await transcribeWithGroq(blob, groqKey);
    } catch (err) {
      if (!saJson) throw err;
      console.warn("Groq STT failed, falling back to Vertex Chirp:", err);
    }
  }
  return transcribeWithVertex(blob, saJson);
}

/**
 * Whisper (and Chirp) reliably "hallucinate" a short stock phrase when handed near-
 * silence or unintelligible noise — most often "Thank you." / "Thanks for watching!" /
 * "you" / "Bye." — because those dominate its training data's trailing frames. After
 * the wake word, an empty command window would otherwise fire one of these as a real
 * command (JARVIS replying to a phantom "thank you"). This screens them out. Kept to
 * whole-utterance matches so it never eats a genuine short command like "call mom".
 */
const HALLUCINATION_PHRASES = new Set([
  "thank you",
  "thank you.",
  "thanks",
  "thanks.",
  "thank you very much",
  "thanks for watching",
  "thanks for watching!",
  "thank you for watching",
  "thank you for watching.",
  "please subscribe",
  "you",
  "bye",
  "bye.",
  "bye bye",
  "goodbye",
  "so",
  "okay",
  "ok",
  "the",
  "i'm sorry",
  "silence",
  "[silence]",
  "[ silence ]",
  "music",
  "[music]",
  "[ music ]",
  "applause",
  "[applause]",
  "you're welcome",
  "see you next time",
]);

// The wake word may already be stripped, so match the prompt's tail.
const PROMPT_ECHO = /^(hey jarvis )?a voice command for a phone assistant$/;

export function isNoiseTranscript(text: string): boolean {
  const norm = (text || "")
    .toLowerCase()
    .replace(/[.!?,;:"'”“]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!norm) return true;
  return HALLUCINATION_PHRASES.has(norm) || PROMPT_ECHO.test(norm);
}

/** True when this WebView can capture microphone audio. */
export function micAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function" &&
    typeof window !== "undefined" &&
    "MediaRecorder" in window
  );
}
