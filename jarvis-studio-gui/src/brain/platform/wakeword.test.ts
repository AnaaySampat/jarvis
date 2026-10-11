/**
 * Wake word: stuck-listener recovery, and the one-clip command flow.
 *
 * Recovery was prompted by "after a timer is set, JARVIS stopped responding to Hey
 * Jarvis." The obvious mechanism (the Clock intent stealing foreground, so the microphone
 * foreground-service resume is refused) was measured on-device and RULED OUT —
 * EXTRA_SKIP_UI keeps JARVIS topResumedActivity and polling never pauses. The trigger is
 * still unidentified, so these tests pin the property that makes the symptom survivable
 * whatever causes it: the listener must never stay wedged.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));
vi.mock("../tools/httpClient", () => ({ inTauri: () => true, platformFetch: () => fetch }));
vi.mock("./stt", () => ({
  transcribe: vi.fn(async () => "set a timer"),
  isNoiseTranscript: (t: string) => /^thank you\.?$/i.test(t),
}));

import { commandAfterWake, heardWakePhrase, WakeWordListener } from "./wakeword";

/** Drive the listener's private poll loop deterministically. */
function pollOf(l: WakeWordListener): () => Promise<void> {
  return (l as unknown as { poll: () => Promise<void> }).poll.bind(l);
}
function setHandling(l: WakeWordListener, on: boolean, since: number): void {
  const priv = l as unknown as { handling: boolean; handlingSince: number };
  priv.handling = on;
  priv.handlingSince = since;
}

function makeListener() {
  const onError = vi.fn();
  const l = new WakeWordListener({
    isBusy: () => false,
    onCommand: vi.fn(),
    onError,
  });
  (l as unknown as { on: boolean }).on = true;
  return { l, onError };
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({ seq: 0, listening: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("stuck-listener recovery", () => {
  it("frees a listener wedged mid-command and restarts the engine", async () => {
    // The failure this guards: `handling` set, then something never returns. Before
    // the fix, poll() early-returned on it forever and the engine was never restarted.
    const { l, onError } = makeListener();
    setHandling(l, true, Date.now() - 60_000); // wedged for longer than a whole cycle
    await pollOf(l)();

    expect((l as unknown as { handling: boolean }).handling).toBe(false);
    expect(invokeMock).toHaveBeenCalledWith("plugin:phone|start_wake_word");
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/stuck/i));
  });

  it("leaves a normally-running command alone", async () => {
    const { l, onError } = makeListener();
    setHandling(l, true, Date.now() - 1_000); // mid-command, perfectly healthy
    await pollOf(l)();

    expect((l as unknown as { handling: boolean }).handling).toBe(true);
    expect(invokeMock).not.toHaveBeenCalledWith("plugin:phone|start_wake_word");
    expect(onError).not.toHaveBeenCalled();
  });

  it("stops waiting for a clip the bridge never delivers", async () => {
    vi.useFakeTimers();
    invokeMock.mockImplementation(() => new Promise(() => {})); // every reply dropped
    const { l } = makeListener();
    const fetchClip = (l as unknown as { fetchClip: () => Promise<unknown> }).fetchClip.bind(l);
    const pending = fetchClip();
    await vi.advanceTimersByTimeAsync(20_000); // past CLIP_WAIT_MS, with every poll bounded
    await expect(pending).resolves.toBeUndefined();
  });
});

describe("commandAfterWake", () => {
  it("is what follows the last 'Hey Jarvis' — talk before it in the pre-roll is dropped", () => {
    expect(commandAfterWake("Hey Jarvis, open YouTube.")).toBe("open YouTube.");
    expect(commandAfterWake("so anyway. Hey Jarvis what's the time")).toBe("what's the time");
    expect(commandAfterWake("Hey Jarvis. Hey Jarvis, pause")).toBe("pause");
    expect(commandAfterWake("Hey Jarvis.")).toBe("");
  });

  it("is null when the clip has no wake phrase — a false wake", () => {
    expect(commandAfterWake("you know how it got one task down to 8 seconds")).toBeNull();
    expect(commandAfterWake("my Jarvis app is fast")).toBeNull();
  });
});

describe("heardWakePhrase", () => {
  it("accepts how Whisper writes a spoken 'Hey Jarvis'", () => {
    for (const t of [
      "Hey Jarvis.",
      "Hey, Jarvis!",
      "hey jarvis what's the time",
      "Hi Jarvis",
      "Okay, Jarvis",
      "Hey Jervis",
      "Hey Javis",
      "Hey Travis",
      "so anyway. Hey JARVIS",
      // Live 2026-09-27, a spoken "Hey Jarvis" came back as these:
      "Kay Jarvis.",
      "A. Jarvis",
    ]) {
      expect(heardWakePhrase(t), t).toBe(true);
    }
  });

  it("rejects conversation, including talk ABOUT Jarvis", () => {
    // The 2026-09-26 false wake came while the user was describing JARVIS to someone.
    for (const t of [
      "",
      "Thank you.",
      "my Jarvis app got one task down to 8 seconds",
      "Jarvis is the app I'm building",
      "you know how it got faster",
      "the harvest is late",
      "it's a Jarvis clone",
      "Jarvis.",
    ]) {
      expect(heardWakePhrase(t), t).toBe(false);
    }
  });
});

describe("the one-clip command", () => {
  const WAV = btoa("RIFF....WAVEfmt "); // any bytes: the recogniser is mocked
  type OnWake = (clip?: { wav: string; speech: boolean }) => Promise<void>;

  function listen(heard: string | Error) {
    const onCommand = vi.fn();
    const onError = vi.fn();
    const transcribe = vi.fn(async (_b: Blob, _o?: { prompt?: string }) => {
      if (heard instanceof Error) throw heard;
      return heard;
    });
    const l = new WakeWordListener({ isBusy: () => false, onCommand, onError, transcribe });
    (l as unknown as { on: boolean }).on = true;
    const onWake = (l as unknown as { onWake: OnWake }).onWake.bind(l);
    return { onWake, onCommand, onError, transcribe };
  }

  async function run(onWake: OnWake, clip?: { wav: string; speech: boolean }) {
    vi.useFakeTimers();
    const done = onWake(clip);
    await vi.advanceTimersByTimeAsync(5_000);
    await done;
  }

  it("keeps a one-breath command whole, from one transcription", async () => {
    const { onWake, onCommand, transcribe } = listen("Hey Jarvis, open YouTube.");
    await run(onWake, { wav: WAV, speech: true });
    expect(onCommand).toHaveBeenCalledWith("open YouTube.");
    expect(transcribe).toHaveBeenCalledTimes(1);
    // The hint is the name alone: the command prompt names "Hey JARVIS", and Whisper can
    // echo its prompt on noise — which would pass every false wake.
    const [blob, o] = transcribe.mock.calls[0]!;
    expect(o).toEqual({ prompt: "Jarvis" });
    expect(blob.type).toBe("audio/wav");
  });

  it("drops a wake whose clip was conversation", async () => {
    const { onWake, onCommand } = listen("you know how it got one task down to 8 seconds");
    await run(onWake, { wav: WAV, speech: true });
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("never sends a clip with nothing said after the wake to the recogniser", async () => {
    const { onWake, onCommand, transcribe } = listen("Hey Jarvis.");
    await run(onWake, { wav: WAV, speech: false });
    expect(transcribe).not.toHaveBeenCalled();
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("drops a wake followed only by a silence hallucination", async () => {
    const { onWake, onCommand } = listen("Hey Jarvis. Thank you.");
    await run(onWake, { wav: WAV, speech: true });
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("reports a failed transcription instead of acting on a guess", async () => {
    const { onWake, onCommand, onError } = listen(new Error("Groq STT 503"));
    await run(onWake, { wav: WAV, speech: true });
    expect(onCommand).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/503/));
  });

  it("polls for the clip when the detection's reply didn't carry it", async () => {
    // The usual case: the command is still being spoken when the detection is reported.
    let polls = 0;
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === "plugin:phone|poll_wake_word"
        ? ++polls < 4
          ? { seq: 1, listening: true }
          : { seq: 1, listening: true, preRoll: WAV, speech: true }
        : undefined,
    );
    const { onWake, onCommand } = listen("Hey Jarvis set a timer for five minutes");
    await run(onWake, undefined);
    expect(polls).toBe(4);
    expect(onCommand).toHaveBeenCalledWith("set a timer for five minutes");
  });

  it("never stops the engine to take the microphone", async () => {
    const { onWake } = listen("Hey Jarvis, open YouTube.");
    await run(onWake, { wav: WAV, speech: true });
    expect(invokeMock).not.toHaveBeenCalledWith("plugin:phone|stop_wake_word");
  });
});

describe("polling", () => {
  it("keeps one poll in flight, so the reply carrying the wake audio can't be overtaken", async () => {
    // Live 2026-09-27: two polls 114 ms apart; the second, tiny reply beat the ~130 KB one
    // that carried the audio, and the wake went through unchecked.
    const { l } = makeListener();
    let answer!: (v: unknown) => void;
    invokeMock.mockImplementation(() => new Promise((r) => (answer = r)));
    const first = pollOf(l)();
    await pollOf(l)(); // fires while the first is still waiting
    expect(invokeMock).toHaveBeenCalledTimes(1);

    const onWake = vi
      .spyOn(l as unknown as { onWake: (p?: string) => Promise<void> }, "onWake")
      .mockResolvedValue(undefined);
    (l as unknown as { lastSeq: number }).lastSeq = 4;
    answer({ seq: 5, listening: true, preRoll: "UklGRg==" });
    await first;
    expect(onWake).toHaveBeenCalledWith({ wav: "UklGRg==", speech: true });
  });

  it("gives up on a poll the bridge never answered", async () => {
    vi.useFakeTimers();
    const { l } = makeListener();
    invokeMock.mockImplementation(() => new Promise(() => {})); // dropped reply
    void pollOf(l)();
    await vi.advanceTimersByTimeAsync(3_100);
    void pollOf(l)();
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });
});
