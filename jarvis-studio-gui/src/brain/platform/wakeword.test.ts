/**
 * Wake-word stuck-listener recovery.
 *
 * Prompted by "after a timer is set, JARVIS stopped responding to Hey Jarvis." The
 * obvious mechanism (the Clock intent stealing foreground, so the microphone
 * foreground-service resume is refused) was measured on-device and RULED OUT —
 * EXTRA_SKIP_UI keeps JARVIS topResumedActivity and polling never pauses. The
 * trigger is still unidentified.
 *
 * So these tests don't pin a trigger. They pin the property that makes the symptom
 * survivable whatever causes it: the listener must never stay wedged. Both wedge
 * paths below were real — an unbounded capture() and a swallowed resume — and each
 * presents to the user as "the wake word just stopped".
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));
vi.mock("../tools/httpClient", () => ({ inTauri: () => true, platformFetch: () => fetch }));

// MicRecorder.start() is the unbounded await that could wedge `handling`.
let startBehaviour: () => Promise<void> = async () => {};
const cancelSpy = vi.fn();
vi.mock("./stt", () => ({
  MicRecorder: class {
    start() {
      return startBehaviour();
    }
    untilSilence() {
      return Promise.resolve(true);
    }
    stop() {
      return Promise.resolve(new Blob(["x"]));
    }
    cancel() {
      cancelSpy();
    }
  },
  transcribe: vi.fn(async () => "set a timer"),
  isNoiseTranscript: () => false,
}));

import { heardWakePhrase, WakeWordListener } from "./wakeword";

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
  cancelSpy.mockReset();
  startBehaviour = async () => {};
  invokeMock.mockResolvedValue({ seq: 0, listening: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("stuck-listener recovery", () => {
  it("frees a listener wedged mid-command and restarts the engine", async () => {
    // The failure this guards: `handling` set, then something never returns. Before
    // the fix, poll() early-returned on it forever and the engine — which onWake had
    // deliberately stopped — was never restarted.
    const { l, onError } = makeListener();
    setHandling(l, true, Date.now() - 60_000); // wedged for longer than a whole cycle
    await pollOf(l)();

    expect((l as unknown as { handling: boolean }).handling).toBe(false);
    expect(invokeMock).toHaveBeenCalledWith("plugin:phone|start_wake_word");
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/stuck/i));
  });

  it("leaves a normally-running command alone", async () => {
    const { l, onError } = makeListener();
    setHandling(l, true, Date.now() - 1_000); // mid-capture, perfectly healthy
    await pollOf(l)();

    expect((l as unknown as { handling: boolean }).handling).toBe(true);
    expect(invokeMock).not.toHaveBeenCalledWith("plugin:phone|start_wake_word");
    expect(onError).not.toHaveBeenCalled();
  });

  it("bounds a hung microphone instead of waiting forever", async () => {
    vi.useFakeTimers();
    startBehaviour = () => new Promise<void>(() => {}); // never resolves
    const { l, onError } = makeListener();

    const capture = (l as unknown as { capture: (ms: number) => Promise<Blob | null> }).capture.bind(l);
    const pending = capture(6000);
    await vi.advanceTimersByTimeAsync(17_000); // past CAPTURE_TIMEOUT_MS (COMMAND_MS + 6s)

    await expect(pending).resolves.toBeNull();
    expect(cancelSpy).toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/microphone capture/i));
  });
});

describe("heardWakePhrase", () => {
  it("accepts how Whisper writes a spoken 'Hey Jarvis'", () => {
    for (const t of ["Hey Jarvis.", "Hey, Jarvis!", "hey jarvis what's the time", "Hi Jarvis",
      "Okay, Jarvis", "Hey Jervis", "Hey Javis", "Hey Travis", "so anyway. Hey JARVIS",
      // Live 2026-09-27, a spoken "Hey Jarvis" came back as these:
      "Kay Jarvis.", "A. Jarvis"]) {
      expect(heardWakePhrase(t), t).toBe(true);
    }
  });

  it("rejects conversation, including talk ABOUT Jarvis", () => {
    // The 2026-09-26 false wake came while the user was describing JARVIS to someone.
    for (const t of ["", "Thank you.", "my Jarvis app got one task down to 8 seconds",
      "Jarvis is the app I'm building", "you know how it got faster", "the harvest is late",
      "it's a Jarvis clone", "Jarvis."]) {
      expect(heardWakePhrase(t), t).toBe(false);
    }
  });
});

describe("the wake audio check", () => {
  const WAV = btoa("RIFF....WAVEfmt "); // any bytes: the recogniser is mocked
  type Onwake = (preRoll?: string) => Promise<void>;

  function listen(preRollText: string | Error) {
    const onCommand = vi.fn();
    const transcribe = vi.fn(async (b: Blob, _o?: { prompt?: string }) => {
      if (b.type === "audio/wav") {
        if (preRollText instanceof Error) throw preRollText;
        return preRollText;
      }
      return "set a timer for five minutes";
    });
    const l = new WakeWordListener({ isBusy: () => false, onCommand, transcribe });
    (l as unknown as { on: boolean }).on = true;
    const onWake = (l as unknown as { onWake: Onwake }).onWake.bind(l);
    return { onWake, onCommand, transcribe };
  }

  async function run(onWake: Onwake, preRoll?: string) {
    vi.useFakeTimers();
    const done = onWake(preRoll);
    await vi.advanceTimersByTimeAsync(5_000);
    await done;
  }

  it("sends the command when the wake audio says 'Hey Jarvis'", async () => {
    const { onWake, onCommand, transcribe } = listen("Hey Jarvis.");
    await run(onWake, WAV);
    expect(onCommand).toHaveBeenCalledWith("set a timer for five minutes");
    // The hint is the name alone: the command prompt names "Hey JARVIS", and Whisper can
    // echo its prompt on noise — which would pass every false wake.
    const [blob, o] = transcribe.mock.calls[0]!;
    expect(o).toEqual({ prompt: "Jarvis" });
    expect(blob.type).toBe("audio/wav");
  });

  it("drops a wake whose audio was conversation, and stops recording it", async () => {
    const { onWake, onCommand, transcribe } = listen("you know how it got one task down to 8 seconds");
    await run(onWake, WAV);
    expect(onCommand).not.toHaveBeenCalled();
    expect(cancelSpy).toHaveBeenCalled();
    expect(transcribe).toHaveBeenCalledTimes(1); // the overheard command is never sent off
  });

  it("lets the wake through when the check can't run", async () => {
    const offline = listen(new Error("Groq STT 503"));
    await run(offline.onWake, WAV);
    expect(offline.onCommand).toHaveBeenCalledWith("set a timer for five minutes");

    const noAudio = listen("irrelevant"); // an older native build sends no pre-roll
    await run(noAudio.onWake, undefined);
    expect(noAudio.onCommand).toHaveBeenCalledWith("set a timer for five minutes");
    expect(noAudio.transcribe).toHaveBeenCalledTimes(1);
  });

  it("fetches the audio once the engine stops, when the detection didn't carry it", async () => {
    // The engine records a little past the detection, so the audio usually lands after it.
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === "plugin:phone|poll_wake_word" ? { seq: 1, listening: false, preRoll: WAV } : undefined,
    );
    const { onWake, onCommand, transcribe } = listen("Hey Jarvis.");
    await run(onWake, undefined);
    expect(transcribe.mock.calls[0]![0].type).toBe("audio/wav");
    expect(onCommand).toHaveBeenCalledWith("set a timer for five minutes");
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

    const onWake = vi.spyOn(l as unknown as { onWake: (p?: string) => Promise<void> }, "onWake")
      .mockResolvedValue(undefined);
    (l as unknown as { lastSeq: number }).lastSeq = 4;
    answer({ seq: 5, listening: true, preRoll: "UklGRg==" });
    await first;
    expect(onWake).toHaveBeenCalledWith("UklGRg==");
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
