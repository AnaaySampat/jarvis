import { afterEach, describe, expect, it, vi } from "vitest";
import { MicRecorder, isNoiseTranscript } from "./stt";

/** Fake Web Audio whose analyser plays back a scripted RMS level per 50ms tick. */
function fakeAudio(levels: number[]) {
  let tick = 0;
  class Ctx {
    resume = () => Promise.resolve();
    close = () => Promise.resolve();
    createMediaStreamSource = () => ({ connect: () => {} });
    createAnalyser = () => ({
      fftSize: 4,
      getFloatTimeDomainData: (buf: Float32Array) => buf.fill(levels[Math.min(tick++, levels.length - 1)]!),
    });
  }
  vi.stubGlobal("window", { AudioContext: Ctx });
}

function recorder(): MicRecorder {
  const r = new MicRecorder();
  Object.assign(r, { stream: {}, recorder: { state: "recording" } });
  return r;
}


describe("MicRecorder.untilSilence", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("ends ~0.9s after speech stops instead of the full window", async () => {
    vi.useFakeTimers();
    // 0.5s room noise, 1.5s speech, then quiet.
    const levels = [...Array(10).fill(0.003), ...Array(30).fill(0.2), 0.003];
    const [ms, heard] = await elapsedUntilDone(levels);
    expect(heard).toBe(true);
    expect(ms).toBeGreaterThanOrEqual(2800);
    expect(ms).toBeLessThan(3200);
  });

  it("gives up after 4s when nobody speaks", async () => {
    vi.useFakeTimers();
    const [ms, heard] = await elapsedUntilDone([0.003]);
    expect(heard).toBe(false);
    expect(ms).toBeLessThan(4200);
  });

  it("falls back to the full window when the analyser reads silence-zero (suspended)", async () => {
    vi.useFakeTimers();
    const [ms] = await elapsedUntilDone([0], 6000);
    expect(ms).toBeGreaterThanOrEqual(6000);
  });
});

/** Like elapsed() but measures when the promise settled, not when timers ran out. */
async function elapsedUntilDone(levels: number[], maxMs = 10000): Promise<[number, boolean]> {
  fakeAudio(levels);
  const t0 = Date.now();
  let doneAt = 0;
  const p = recorder()
    .untilSilence(maxMs)
    .then((h) => ((doneAt = Date.now()), h));
  await vi.advanceTimersByTimeAsync(maxMs + 100);
  return [doneAt - t0, await p];
}

describe("isNoiseTranscript", () => {
  it("screens an echo of the Whisper prompt", () => {
    expect(isNoiseTranscript("A voice command for a phone assistant.")).toBe(true);
    expect(isNoiseTranscript("open YouTube")).toBe(false);
  });
});
