import { useEffect } from "react";
import { act, create } from "react-test-renderer";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { useGestureModes } from "./useGestureModes";
import { documentId } from "./storage";
let controls, renderer, camera, host, props, store, saved, pose, sequence, publish, lastFrame;
const T = 1_800_000_000_000;
function App(input) {
  const value = useGestureModes(input);
  useEffect(() => {
    controls = value;
  });
  return null;
}
beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(T);
  store = new Map();
  saved = vi.fn((k, v) => store.set(k, v));
  vi.stubGlobal("localStorage", { getItem: (k) => store.get(k) || null, setItem: saved });
  const doc = new EventTarget();
  doc.hidden = false;
  doc.elementFromPoint = () => null;
  doc.querySelector = () => null;
  doc.querySelectorAll = () => [];
  const win = new EventTarget();
  win.innerWidth = 1000;
  win.innerHeight = 800;
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", win);
  pose = "UNKNOWN";
  sequence = 100;
  publish = true;
  lastFrame = null;
  const state = { running: false, starting: false, foreground: true, summary: "Off" };
  camera = {
    start: vi.fn(async () => {
      state.running = true;
      state.summary = "On";
      return { ok: true, summary: "On" };
    }),
    stop: vi.fn(async () => {
      state.running = false;
      state.summary = "Off";
      return { ok: true, summary: "Off" };
    }),
    poll: vi.fn(async () => {
      if (state.running && publish)
        lastFrame = { seq: sequence++, observedAt: Date.now(), pose, score: 1, landmarks: [] };
      return { ...state, frame: lastFrame };
    }),
  };
  host = {
    stopSpeech: vi.fn(),
    listen: vi.fn(),
    pttStart: vi.fn(async () => true),
    finishListen: vi.fn(),
    cancelListen: vi.fn(),
    speak: vi.fn(async () => ({ ok: true, summary: "Spoken" })),
    perform: vi.fn(async () => ({ ok: true, summary: "Done" })),
    reorder: vi.fn(),
  };
  props = { camera, host, enabled: true, blocked: false, canListen: true };
  await act(async () => {
    renderer = create(<App {...props} />);
  });
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function advance(ms) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
async function start() {
  pose = "UNKNOWN";
  await act(async () => {
    await controls.start();
  });
  await advance(1500);
}
async function show(next, ms = 900) {
  pose = next;
  await advance(ms);
}
describe("gesture hook lifecycle regressions", () => {
  it("starts a new engine when a second camera session restarts sequence at zero", async () => {
    await start();
    await show("OPEN_PALM");
    expect(host.stopSpeech).toHaveBeenCalledTimes(1);
    await act(async () => {
      await controls.stop();
    });
    sequence = 0;
    await start();
    await show("OPEN_PALM");
    expect(host.stopSpeech).toHaveBeenCalledTimes(2);
  });
  it("ticks stalled frames and ends only its own admitted PTT", async () => {
    await start();
    await show("PEACE");
    expect(host.pttStart).toHaveBeenCalledTimes(1);
    publish = false;
    await advance(1000);
    expect(host.finishListen).toHaveBeenCalledTimes(1);
    await advance(1000);
    expect(host.finishListen).toHaveBeenCalledTimes(1);
  });
  it("does not finish when canListen rejected the start", async () => {
    props = { ...props, canListen: false };
    await act(async () => renderer.update(<App {...props} />));
    await start();
    await show("PEACE");
    publish = false;
    await advance(1000);
    expect(host.pttStart).not.toHaveBeenCalled();
    expect(host.finishListen).not.toHaveBeenCalled();
  });
  it("does not reset a hold when host and camera wrappers change identity", async () => {
    await start();
    await show("OPEN_PALM", 300);
    props = { ...props, host: { ...host }, camera: { ...camera } };
    await act(async () => renderer.update(<App {...props} />));
    await advance(500);
    expect(host.stopSpeech).toHaveBeenCalledTimes(1);
  });
  it("merges updates in the same tick and debounces text persistence", async () => {
    saved.mockClear();
    await act(async () => {
      controls.changeConfig({ holdMs: 900 });
      controls.changeConfig({ mode: "reading" });
      controls.changeConfig({ reader: "a" });
      controls.changeConfig({ reader: "a longer paragraph" });
    });
    expect(controls.config.holdMs).toBe(900);
    expect(controls.config.mode).toBe("reading");
    expect(saved.mock.calls.filter(([key]) => key === "jarvis.gestures.v2")).toHaveLength(0);
    await advance(500);
    expect(saved.mock.calls.filter(([key]) => key === "jarvis.gestures.v2")).toHaveLength(1);
  });
  it("keeps fist stop active during the calibration countdown", async () => {
    await start();
    await act(async () => controls.calibrate("My pose"));
    expect(controls.message).toContain("3 seconds");
    await show("FIST");
    expect(camera.stop).toHaveBeenCalledTimes(1);
  });
  it("queues the latest navigation and interrupts old speech", async () => {
    await act(async () => controls.changeConfig({ mode: "cooking", steps: "One\nTwo\nThree" }));
    await start();
    let release;
    host.speak.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    host.stopSpeech.mockImplementation(() => release?.({ ok: true, summary: "Stopped" }));
    await act(async () => controls.act("steps.repeat"));
    await act(async () => controls.act("steps.next"));
    expect(host.stopSpeech).toHaveBeenCalled();
    expect(host.speak).toHaveBeenLastCalledWith("Two");
    expect(controls.step).toBe(1);
  });
  it("validates manual events and respects pending approvals", async () => {
    await start();
    props = { ...props, blocked: true };
    await act(async () => renderer.update(<App {...props} />));
    await act(async () => {
      controls.act("approve");
      controls.act("media.up");
    });
    expect(host.perform).not.toHaveBeenCalled();
    props = { ...props, blocked: false };
    await act(async () => renderer.update(<App {...props} />));
    await act(async () => controls.act("media.up"));
    expect(host.perform).toHaveBeenCalledTimes(1);
  });
  it("uses bookmark IDs, bounds pages and catches quota failures on removal", async () => {
    const text = "Only one page";
    await act(async () => controls.changeConfig({ mode: "reading", reader: text }));
    await start();
    await act(async () => controls.selectPage(999));
    expect(controls.page).toBe(0);
    await act(async () => controls.act("reader.bookmark"));
    expect(controls.bookmarks[0]).toMatchObject({ documentId: documentId(text), page: 0 });
    expect(controls.bookmarks[0]).not.toHaveProperty("document");
    saved.mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    await act(async () => controls.removeBookmark(controls.bookmarks[0].at));
    await advance(500);
    expect(controls.message).toContain("storage");
  });
});
