import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import {
  CAMERA_OFF,
  GestureEventGate,
  pollGestureCamera,
  startGestureCamera,
  stopGestureCamera,
  type GestureState,
} from "./gestures";

const now = 1_800_000_000_000;
const visible = { visible: true, blocked: false, now };
const detection = (patch: Partial<GestureState> = {}): GestureState => ({
  ...CAMERA_OFF,
  foreground: true,
  running: true,
  seq: 1,
  detectedAt: now,
  gesture: "PEACE",
  ...patch,
});
function armed() {
  const gate = new GestureEventGate();
  gate.accept(CAMERA_OFF, visible);
  return gate;
}

beforeEach(() => {
  invoke.mockReset();
});

describe("gesture actions", () => {
  it("ignores the first snapshot after a reload, even with a recent detection", () => {
    expect(new GestureEventGate().accept(detection(), visible)).toBeNull();
  });
  it("emits a fresh detection once", () => {
    const gate = armed();
    expect(gate.accept(detection(), visible)).toBe("listen");
    expect(gate.accept(detection(), visible)).toBeNull();
  });
  it("never replays a hidden or approval-blocked detection", () => {
    for (const context of [
      { ...visible, visible: false },
      { ...visible, blocked: true },
    ]) {
      const gate = armed();
      expect(gate.accept(detection(), context)).toBeNull();
      expect(gate.accept(detection(), visible)).toBeNull();
    }
  });
  it("drops stale, future and stopped-session detections", () => {
    for (const patch of [
      { foreground: false },
      { detectedAt: now - 1501 },
      { detectedAt: now + 1 },
      { running: false },
    ])
      expect(armed().accept(detection(patch), visible)).toBeNull();
  });
  it("only maps the three allowlisted actions; thumbs up never approves", () => {
    expect(armed().accept(detection({ gesture: "OPEN_PALM" }), visible)).toBe("stopSpeech");
    expect(armed().accept(detection({ gesture: "THUMBS_UP" }), visible)).toBe("feedback");
    expect(armed().accept(detection({ gesture: "FIST" }), visible)).toBeNull();
    expect(armed().accept(detection({ gesture: "UNKNOWN" }), visible)).toBeNull();
  });
});

describe("camera bridge", () => {
  it("routes start, poll and stop to the registered native commands", async () => {
    invoke.mockResolvedValue({ ok: true, summary: "Starting..." });
    await startGestureCamera();
    await stopGestureCamera();
    invoke.mockResolvedValue(CAMERA_OFF);
    expect(await pollGestureCamera()).toEqual(CAMERA_OFF);
    expect(invoke.mock.calls.map((call) => call[0])).toEqual([
      "plugin:phone|start_gesture_recognition",
      "plugin:phone|stop_gesture_recognition",
      "plugin:phone|poll_gesture_recognition",
    ]);
  });
  it("bounds a dropped native reply so the next poll can run", async () => {
    vi.useFakeTimers();
    try {
      invoke.mockReturnValue(new Promise(() => {}));
      const result = expect(pollGestureCamera()).rejects.toThrow("Camera did not respond");
      await vi.advanceTimersByTimeAsync(4000);
      await result;
      invoke.mockResolvedValue(CAMERA_OFF);
      expect(await pollGestureCamera()).toEqual(CAMERA_OFF);
    } finally {
      vi.useRealTimers();
    }
  });
});
