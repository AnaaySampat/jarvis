import { useEffect } from "react";
import { act, create } from "react-test-renderer";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { useGestureModes } from "./useGestureModes";
import { documentId } from "./storage";
import { defaults, poseFeatures } from "./engine";
let controls,
  renderer,
  camera,
  host,
  props,
  store,
  saved,
  pose,
  sequence,
  publish,
  lastFrame,
  frameExtra;
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
  const legacy = defaults();
  legacy.bindings.voice.PEACE = "voice.ptt";
  store.set("jarvis.gestures.v2", JSON.stringify(legacy));
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
  frameExtra = {};
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
        lastFrame = {
          seq: sequence++,
          observedAt: Date.now(),
          pose,
          score: 1,
          landmarks: [],
          ...frameExtra,
        };
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
  it("calibrates a tracked custom shape even when the canned classifier is uncertain", async () => {
    await start();
    const points = Array.from({ length: 21 }, (_, i) => [
      0.3 + (i % 4) * 0.035,
      0.2 + Math.floor(i / 4) * 0.06,
      0,
    ]);
    frameExtra = { landmarks: points, handCount: 1, score: 0.3 };
    await act(async () => controls.calibrate("My shape", "phone.dim"));
    expect(controls.calibration).toMatchObject({ phase: "prepare", remaining: 3, samples: 0 });
    await advance(4000);
    expect(controls.config.customPoses).toHaveLength(1);
    expect(controls.config.customPoses[0].name).toBe("My shape");
    const id = controls.config.customPoses[0].id;
    expect(controls.config.bindings.custom[id]).toBe("phone.dim");
    expect(controls.calibration).toMatchObject({ phase: "saved", poseId: id, action: "phone.dim" });
    expect(controls.calibrating).toBe(false);
    expect(host.perform).not.toHaveBeenCalled();
  });
  it("cancels calibration without saving a pose or running its selected action", async () => {
    await start();
    await act(async () => controls.setPractice(true));
    await act(async () => controls.calibrate("Cancelled pose", "phone.flashlightOn"));
    await advance(1000);
    await act(async () => controls.cancelCalibration());
    await advance(4000);
    expect(controls.calibration).toBeNull();
    expect(controls.calibrating).toBe(false);
    expect(controls.config.customPoses).toHaveLength(0);
    expect(controls.practice).toBe(true);
    expect(host.perform).not.toHaveBeenCalled();
    expect(controls.message).toContain("cancelled");
  });
  it("advances the calibration countdown even if the camera has no fresh hand frame", async () => {
    await start();
    publish = false;
    await act(async () => controls.calibrate("Waiting pose"));
    await advance(3500);
    expect(controls.calibration).toMatchObject({ phase: "capture", samples: 0 });
    expect(controls.config.customPoses).toHaveLength(0);
    await advance(15000);
    expect(controls.calibration).toMatchObject({ phase: "error" });
    expect(controls.calibrating).toBe(false);
  });
  it("rejects newly calibrated poses that would collide with an existing template", async () => {
    const points = Array.from({ length: 21 }, (_, i) => [
      0.3 + (i % 4) * 0.035,
      0.2 + Math.floor(i / 4) * 0.06,
      0,
    ]);
    await act(async () =>
      controls.changeConfig({
        customPoses: [{ id: "custom_old", name: "Existing", features: poseFeatures(points) }],
      }),
    );
    await start();
    frameExtra = { landmarks: points, handCount: 1 };
    await act(async () => controls.calibrate("Duplicate shape"));
    await advance(4000);
    expect(controls.config.customPoses).toHaveLength(1);
    expect(controls.message).toContain("too similar to Existing");
    expect(controls.calibrating).toBe(false);
  });
  it("shows recognition in practice without executing gestures or manual commands", async () => {
    await act(async () => controls.setPractice(true));
    await start();
    await show("OPEN_PALM");
    expect(controls.recognition.phase).toBe("recognized");
    expect(host.stopSpeech).not.toHaveBeenCalled();
    await show("UNKNOWN", 500);
    await show("PEACE");
    expect(host.pttStart).not.toHaveBeenCalled();
    await act(async () => controls.act("media.up"));
    expect(host.perform).not.toHaveBeenCalled();
    await show("FIST", 1100);
    expect(camera.stop).toHaveBeenCalledTimes(1);
  });
  it("requires neutral after leaving practice and cancels owned capture when entering", async () => {
    await start();
    await show("PEACE");
    expect(host.pttStart).toHaveBeenCalledTimes(1);
    await act(async () => controls.setPractice(true));
    expect(host.cancelListen).toHaveBeenCalledTimes(1);
    await show("UNKNOWN", 500);
    await show("OPEN_PALM");
    await act(async () => controls.setPractice(false));
    await show("OPEN_PALM");
    expect(host.stopSpeech).not.toHaveBeenCalled();
    await show("UNKNOWN", 500);
    await show("OPEN_PALM");
    expect(host.stopSpeech).toHaveBeenCalledTimes(1);
  });
  it("starts recognizing immediately without waiting for the idle poll", async () => {
    await act(async () => {
      await controls.start();
    });
    await advance(500);
    pose = "OPEN_PALM";
    await advance(750);
    expect(host.stopSpeech).toHaveBeenCalledTimes(1);
  });
  it("never overlaps bridge polls when a refresh arrives during an existing request", async () => {
    let complete;
    camera.poll.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    await advance(1000);
    const pending = camera.poll.mock.calls.length;
    await act(async () => {
      await controls.start();
    });
    await advance(500);
    expect(camera.poll).toHaveBeenCalledTimes(pending);
    await act(async () => {
      complete({ running: false, summary: "Off" });
    });
    await advance(0);
    expect(camera.poll).toHaveBeenCalledTimes(pending + 1);
  });
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
  it("cancels its own admitted PTT when frames stall", async () => {
    await start();
    await show("PEACE");
    expect(host.pttStart).toHaveBeenCalledTimes(1);
    expect(host.finishListen).not.toHaveBeenCalled();
    publish = false;
    await advance(1000);
    expect(host.cancelListen).toHaveBeenCalledTimes(1);
    await advance(1000);
    expect(host.cancelListen).toHaveBeenCalledTimes(1);
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

describe("gesture session usability", () => {
  it("pauses pose actions and cancels PTT while leaving touch controls usable", async () => {
    await start();
    await show("PEACE");
    expect(host.pttStart).toHaveBeenCalledOnce();
    await act(async () => controls.setPaused(true));
    expect(host.cancelListen).toHaveBeenCalledOnce();
    expect(controls.paused).toBe(true);
    await show("UNKNOWN", 500);
    await show("OPEN_PALM");
    expect(host.stopSpeech).not.toHaveBeenCalled();
    await act(async () => controls.act("media.toggle"));
    expect(host.perform).toHaveBeenCalledWith("media.toggle", controls.config, camera);
    await act(async () => controls.setPaused(false));
    await show("OPEN_PALM");
    expect(host.stopSpeech).not.toHaveBeenCalled();
    await show("UNKNOWN", 500);
    await show("OPEN_PALM");
    expect(host.stopSpeech).toHaveBeenCalledOnce();
    expect(camera.stop).not.toHaveBeenCalled();
  });

  it("switches activities without restarting the camera or replaying a held pose", async () => {
    await start();
    await show("OPEN_PALM");
    expect(host.stopSpeech).toHaveBeenCalledOnce();
    await act(async () => controls.switchMode("media"));
    expect(controls.config.mode).toBe("media");
    expect(camera.start).toHaveBeenCalledOnce();
    expect(camera.stop).not.toHaveBeenCalled();
    await show("OPEN_PALM");
    expect(host.perform).not.toHaveBeenCalled();
    await show("UNKNOWN", 500);
    await show("OPEN_PALM");
    expect(host.perform).toHaveBeenCalledWith("media.toggle", controls.config, camera);
  });

  it("passes only the selected practice target and requires fresh evidence when retesting", async () => {
    await act(async () => {
      controls.setPractice(true);
      controls.setPracticeTarget("PEACE");
    });
    await start();
    await show("OPEN_PALM");
    expect(controls.practicePassed).toEqual([]);
    await show("UNKNOWN", 500);
    await show("PEACE");
    expect(controls.practicePassed).toEqual(["PEACE"]);
    await advance(1000);
    expect(controls.practicePassed).toEqual(["PEACE"]);
    await act(async () => controls.setPracticeTarget("PEACE"));
    expect(controls.practicePassed).toEqual([]);
    await show("PEACE");
    expect(controls.practicePassed).toEqual([]);
    await show("UNKNOWN", 500);
    await show("PEACE");
    expect(controls.practicePassed).toEqual(["PEACE"]);
    expect(host.pttStart).not.toHaveBeenCalled();
    expect(host.stopSpeech).not.toHaveBeenCalled();
  });

  it("records pending and actual failed or successful command results", async () => {
    await start();
    let complete;
    host.perform.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    await act(async () => controls.act("media.toggle"));
    expect(controls.history[0]).toMatchObject({
      action: "media.toggle",
      pose: "manual",
      state: "pending",
    });
    await act(async () => complete({ ok: false, summary: "No music player is available." }));
    expect(controls.history[0]).toMatchObject({
      state: "failed",
      summary: "No music player is available.",
    });
    host.perform.mockResolvedValueOnce({ ok: true, summary: "Media command sent." });
    await act(async () => controls.act("media.next"));
    expect(controls.history[0]).toMatchObject({
      action: "media.next",
      state: "done",
      summary: "Media command sent.",
    });
    expect(controls.history[1].state).toBe("failed");
    expect(controls.history[0].id).not.toBe(controls.history[1].id);
  });

  it("does not label an unconfirmed host request as completed", async () => {
    await start();
    host.perform.mockResolvedValueOnce(undefined);
    await act(async () => controls.act("media.next"));
    expect(controls.history[0]).toMatchObject({ action: "media.next", state: "requested" });
  });

  it("scrolls the inline reader before a hidden floating reading area", async () => {
    const panel = { clientHeight: 300, scrollBy: vi.fn() };
    const floating = { clientHeight: 100, scrollBy: vi.fn() };
    document.querySelector = vi.fn((selector) =>
      selector === "[data-gesture-reader='panel']" ? panel : floating,
    );
    await act(async () => controls.switchMode("reading"));
    await start();
    await act(async () => controls.act("reader.scrollDown"));
    expect(panel.scrollBy).toHaveBeenCalledWith({ top: 195, behavior: "smooth" });
    expect(floating.scrollBy).not.toHaveBeenCalled();
  });

  it("scrolls the hands-free menu body when no inline reader is open", async () => {
    const handsFreeBody = { clientHeight: 400, scrollBy: vi.fn() };
    document.querySelector = vi.fn((selector) =>
      selector === ".hands-free-body" ? handsFreeBody : null,
    );
    await act(async () => controls.switchMode("tv"));
    await start();
    await act(async () => controls.act("reader.scrollDown"));
    expect(handsFreeBody.scrollBy).toHaveBeenCalledWith({ top: 260, behavior: "smooth" });
  });
});

it("executes explicit touch actions with the camera off", async () => {
  expect(controls.status.running).toBe(false);
  await act(async () => controls.act("media.toggle"));
  expect(host.perform).toHaveBeenCalledWith("media.toggle", controls.config, camera);
  expect(controls.history[0]).toMatchObject({
    action: "media.toggle",
    pose: "manual",
    state: "done",
  });
  expect(camera.start).not.toHaveBeenCalled();
  expect(camera.stop).not.toHaveBeenCalled();
});

it("finishes existing listening from a manual button even when starting another capture is disallowed", async () => {
  props = { ...props, listening: true, canListen: false };
  await act(async () => renderer.update(<App {...props} />));
  await act(async () => controls.act("voice.listen"));
  expect(host.finishListen).toHaveBeenCalledOnce();
  expect(host.listen).not.toHaveBeenCalled();
  expect(host.pttStart).not.toHaveBeenCalled();
  expect(host.cancelListen).not.toHaveBeenCalled();
  expect(camera.start).not.toHaveBeenCalled();
});

it("stops an unresolved camera startup and ignores its later response", async () => {
  let completeStart;
  camera.start.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        completeStart = resolve;
      }),
  );
  camera.poll.mockResolvedValue({
    running: false,
    starting: false,
    foreground: true,
    summary: "Stopped",
  });
  let pendingStart;
  await act(async () => {
    pendingStart = controls.start();
  });
  expect(controls.status.starting).toBe(true);
  expect(controls.busy).toBe(true);
  await act(async () => {
    await controls.stop();
  });
  expect(camera.stop).toHaveBeenCalledOnce();
  expect(controls.status).toMatchObject({ running: false, starting: false, summary: "Stopped" });
  expect(controls.busy).toBe(false);
  await act(async () => {
    completeStart({ ok: false, summary: "Late startup failure" });
    await pendingStart;
  });
  expect(controls.status).toMatchObject({ running: false, starting: false, summary: "Stopped" });
  expect(controls.message).not.toContain("Late startup failure");
  expect(controls.busy).toBe(false);
});

it("does not claim the camera is off when a Stop request fails", async () => {
  await start();
  camera.stop.mockRejectedValueOnce(new Error("Bridge unavailable"));
  await act(async () => {
    await controls.stop();
  });
  expect(controls.status.running).toBe(true);
  expect(controls.status.summary).toContain("Could not confirm");
  expect(controls.message).toBe("Bridge unavailable");
});

it("uses reading controls and bookmarks without a running camera or camera support", async () => {
  await act(async () => {
    renderer.update(<App {...props} enabled={false} />);
    controls.changeConfig({
      mode: "reading",
      reader: "First page.\n\nSecond page.",
    });
  });
  await act(async () => {
    controls.act("reader.next");
  });
  expect(controls.page).toBe(1);
  await act(async () => {
    controls.act("reader.bookmark");
  });
  expect(controls.bookmarks[0].page).toBe(1);
  await act(async () => {
    controls.renameBookmark(controls.bookmarks[0].at, "My place");
  });
  await advance(600);
  expect(JSON.parse(store.get("jarvis.gesture.bookmarks.v2"))[0].name).toBe("My place");
  expect(camera.start).not.toHaveBeenCalled();
});
it("practices poses without running activities and preserves fist stop", async () => {
  await act(async () => {
    controls.setPractice(true);
    controls.setPracticeTarget("PEACE");
  });
  await start();
  await show("PEACE");
  expect(controls.practicePassed).toContain("PEACE");
  expect(host.pttStart).not.toHaveBeenCalled();
  expect(host.perform).not.toHaveBeenCalled();
  expect(host.speak).not.toHaveBeenCalled();
  await show("FIST");
  expect(camera.stop).toHaveBeenCalled();
});
it("pauses gesture actions while manual activity controls continue to work", async () => {
  await act(async () => {
    controls.changeConfig({ mode: "reading", reader: "One.\n\nTwo." });
  });
  await start();
  await act(async () => {
    controls.setPaused(true);
  });
  await show("PEACE");
  expect(controls.page).toBe(0);
  await act(async () => {
    controls.act("reader.next");
  });
  expect(controls.page).toBe(1);
  await show("FIST");
  expect(camera.stop).toHaveBeenCalled();
});
it("keeps the current step status when older speech finishes after manual navigation", async () => {
  let finish;
  host.speak.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => {
    controls.changeConfig({ mode: "cooking", steps: "One\nTwo\nThree" });
  });
  await act(async () => {
    controls.act("steps.repeat");
  });
  await act(async () => {
    controls.selectStep(2);
  });
  await act(async () => {
    finish({ ok: true, summary: "Reading finished." });
  });
  expect(controls.step).toBe(2);
  expect(controls.message).toBe("Step 3.");
});

it("keeps camera-off instructions accurate after leaving practice or unpausing", async () => {
  await act(async () => controls.setPractice(true));
  expect(controls.message).toContain("Camera is off");
  await act(async () => controls.setPractice(false));
  expect(controls.message).toContain("use the buttons");
  expect(controls.message).not.toContain("Lower your hand");
  await act(async () => controls.setPaused(false));
  expect(controls.message).toContain("Camera is off");
  await start();
  await act(async () => controls.setPractice(false));
  expect(controls.message).toContain("Lower your hand");
});

it("clears a failed step timer when changing activity without discarding text", async () => {
  host.startTimer = vi.fn(async () => ({ ok: false, summary: "Native timer unavailable" }));
  await act(async () =>
    controls.changeConfig({ mode: "cooking", steps: "Boil water", reader: "Saved reading" }),
  );
  await act(async () => controls.timers.start(10, "Step 1"));
  expect(controls.timers.error).toBe("Native timer unavailable");
  await act(async () => controls.switchMode("reading"));
  expect(controls.timers.error).toBe("");
  expect(controls.config.reader).toBe("Saved reading");
  expect(controls.config.steps).toBe("Boil water");
});

it("opens direct local activities in Control after leaving Learn and preserves a paused camera", async () => {
  await act(async () => controls.setPractice(true));
  expect(controls.practice).toBe(true);
  await act(async () => controls.openActivity("reading"));
  expect(controls.config.mode).toBe("reading");
  expect(controls.practice).toBe(false);
  expect(controls.message).toContain("Camera is off");
  expect(camera.start).not.toHaveBeenCalled();
  await start();
  await act(async () => controls.setPaused(true));
  await act(async () => controls.openActivity("cooking"));
  expect(controls.config.mode).toBe("cooking");
  expect(controls.paused).toBe(true);
  expect(controls.status.running).toBe(true);
  expect(controls.message).toContain("Gestures paused");
});

it("starts one-shot voice without tying the recording to camera tracking", async () => {
  await act(async () => controls.changeConfig({ bindings: defaults().bindings }));
  await start();
  await show("PEACE");
  expect(host.listen).toHaveBeenCalledOnce();
  expect(host.pttStart).not.toHaveBeenCalled();
  publish = false;
  await advance(1500);
  expect(host.finishListen).not.toHaveBeenCalled();
  expect(host.cancelListen).not.toHaveBeenCalled();
});
