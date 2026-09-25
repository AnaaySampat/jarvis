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

import { WakeWordListener } from "./wakeword";

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
