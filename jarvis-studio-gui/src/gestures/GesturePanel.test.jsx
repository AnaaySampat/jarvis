import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import GesturePanel from "./GesturePanel";
import GesturePreferences from "./GesturePreferences";
import ActionButton from "./ActionButton";
import GestureFeedback from "./GestureFeedback";
import { defaults } from "./engine";

const text = (node) => (typeof node === "string" ? node : (node.children || []).map(text).join(""));
const button = (root, name) =>
  root.findAllByType("button").find((node) => (node.props["aria-label"] || text(node)) === name);
const valueFor = (mode = "media", extra = {}) => ({
  config: { ...defaults(), mode },
  status: { running: false, starting: false, summary: "Camera is off." },
  camera: {},
  supported: true,
  busy: false,
  paused: false,
  practice: false,
  blocked: false,
  history: [],
  bookmarks: [],
  page: 0,
  step: 0,
  practicePassed: [],
  availability: {},
  timers: { timers: [], now: 0, busy: false },
  start: vi.fn(),
  stop: vi.fn(),
  act: vi.fn(),
  setPaused: vi.fn(),
  setPractice: vi.fn(),
  setPracticeTarget: vi.fn(),
  switchMode: vi.fn(),
  changeConfig: vi.fn(),
  calibrate: vi.fn(),
  cancelCalibration: vi.fn(),
  ...extra,
});
async function render(element) {
  let view;
  await act(async () => {
    view = create(element);
  });
  return view;
}

describe("daily task controls", () => {
  it("shows the task and one camera switch without setup or tutorial navigation", async () => {
    const value = valueFor();
    const view = await render(<GesturePanel controls={value} />);
    expect(view.root.findAllByProps({ role: "tab" })).toHaveLength(0);
    expect(text(view.root)).not.toMatch(/Set up, learn|Guide|Learn|Tune|Hold .*seconds/);
    const toggle = button(view.root, "Hands-free");
    expect(toggle.props["aria-checked"]).toBe(false);
    await act(async () => toggle.props.onClick());
    expect(value.setPractice).toHaveBeenCalledWith(false);
    expect(value.start).toHaveBeenCalledOnce();
    expect(
      view.root.findByProps({ className: "task-actions" }).findAllByType("button"),
    ).toHaveLength(3);
    await act(async () => view.unmount());
  });

  it("stops an unresolved startup even while the camera control is busy", async () => {
    const value = valueFor("voice", { status: { starting: true }, busy: true });
    const view = await render(<GesturePanel controls={value} />);
    const toggle = button(view.root, "Hands-free");
    expect(toggle.props.disabled).toBeFalsy();
    await act(async () => toggle.props.onClick());
    expect(value.stop).toHaveBeenCalledOnce();
    await act(async () => view.unmount());
  });

  it("keeps camera, task selection and Stop reachable while reading", async () => {
    const value = valueFor("reading", {
      config: { ...defaults(), mode: "reading", reader: "First.\n\nSecond." },
      status: { running: true },
    });
    const view = await render(<GesturePanel controls={value} />);
    expect(view.root.findByProps({ "aria-label": "Reading page 1" }).children).toEqual(["First."]);
    expect(button(view.root, "Previous page").props.disabled).toBe(true);
    await act(async () => button(view.root, "Next page").props.onClick());
    expect(value.act).toHaveBeenCalledWith("reader.next");
    await act(async () =>
      view.root
        .findByProps({ "aria-label": "Activity" })
        .props.onChange({ target: { value: "cooking" } }),
    );
    expect(value.switchMode).toHaveBeenCalledWith("cooking");
    await act(async () => button(view.root, "Stop").props.onClick());
    expect(value.stop).toHaveBeenCalledOnce();
    await act(async () => view.unmount());
  });

  it("shows the actual saved shortcut and recognized progress without inventing execution success", async () => {
    const config = defaults();
    config.mode = "media";
    config.bindings.media = { LOVE: "media.next" };
    const value = valueFor("media", {
      config,
      status: { running: true },
      recognition: { pose: "LOVE", phase: "recognized", progress: 1 },
    });
    const view = await render(
      <ActionButton controls={value} action="media.next" label="Next" icon="arrowRight" />,
    );
    expect(view.root.findByType("button").props["data-state"]).toBeUndefined();
    expect(view.root.findByType("button").props.style["--gesture-progress"]).toBe("100%");
    await act(async () =>
      view.update(
        <ActionButton
          controls={{ ...value, history: [{ action: "media.next", state: "failed" }] }}
          action="media.next"
          label="Next"
          icon="arrowRight"
        />,
      ),
    );
    expect(view.root.findByType("button").props["data-state"]).toBe("failed");
    await act(async () => view.unmount());
  });

  it("preserves active and already-paused sessions when returning from settings", async () => {
    for (const paused of [false, true]) {
      const value = valueFor("media", { status: { running: true }, paused });
      const view = await render(<GesturePanel controls={value} />);
      await act(async () => button(view.root, "Gesture settings").props.onClick());
      if (!paused) expect(value.setPaused).toHaveBeenCalledWith(true);
      await act(async () => button(view.root, "Back").props.onClick());
      expect(value.setPaused).toHaveBeenLastCalledWith(paused);
      expect(value.stop).not.toHaveBeenCalled();
      await act(async () => view.unmount());
    }
  });
});

describe("optional gesture settings", () => {
  it("starts an action-free test with its target selected before opening the camera", async () => {
    const value = valueFor("voice");
    const view = await render(<GesturePreferences controls={value} onDone={vi.fn()} />);
    await act(async () => button(view.root, "Test Peace sign").props.onClick());
    expect(value.setPractice).toHaveBeenCalledWith(true);
    expect(value.setPracticeTarget).toHaveBeenCalledWith("PEACE");
    expect(value.setPractice.mock.invocationCallOrder[0]).toBeLessThan(
      value.start.mock.invocationCallOrder[0],
    );
    expect(value.setPracticeTarget.mock.invocationCallOrder[0]).toBeLessThan(
      value.start.mock.invocationCallOrder[0],
    );
    expect(value.act).not.toHaveBeenCalled();
    await act(async () =>
      view.update(
        <GesturePreferences
          controls={{ ...value, status: { running: true }, practice: true }}
          onDone={vi.fn()}
        />,
      ),
    );
    await act(async () => view.unmount());
    expect(value.setPractice).toHaveBeenLastCalledWith(false);
    expect(value.stop).toHaveBeenCalledOnce();
  });

  it("edits one saved mapping and leaves other modes and shortcuts intact", async () => {
    const value = valueFor();
    const view = await render(<GesturePreferences controls={value} onDone={vi.fn()} />);
    await act(async () => button(view.root, "Change Open palm").props.onClick());
    expect(button(view.root, "TV: next")).toBeUndefined();
    await act(async () => button(view.root, "Next track").props.onClick());
    await act(async () => button(view.root, "Save action").props.onClick());
    const patch = value.changeConfig.mock.calls[0][0](value.config);
    expect(patch.bindings.media.OPEN_PALM).toBe("media.next");
    expect(patch.bindings.voice).toEqual(value.config.bindings.voice);
    expect(patch.bindings.media.SWIPE_LEFT).toBe("media.previous");
    await act(async () => view.unmount());
  });

  it("searches additional allowlisted actions without filling the initial editor", async () => {
    const value = valueFor("voice");
    const view = await render(<GesturePreferences controls={value} onDone={vi.fn()} />);
    await act(async () => button(view.root, "Change Peace sign").props.onClick());
    expect(button(view.root, "Mute microphone")).toBeUndefined();
    await act(async () => button(view.root, "More actions").props.onClick());
    await act(async () =>
      view.root
        .findByProps({ "aria-label": "Search actions" })
        .props.onChange({ target: { value: "microphone" } }),
    );
    await act(async () => button(view.root, "Mute microphone").props.onClick());
    await act(async () => button(view.root, "Save action").props.onClick());
    expect(value.changeConfig.mock.calls[0][0](value.config).bindings.voice.PEACE).toBe("mic.mute");
    await act(async () => view.unmount());
  });

  it("locks timing while the camera is active and applies a whole response preset when stopped", async () => {
    const value = valueFor("voice", { status: { running: true } });
    const view = await render(<GesturePreferences controls={value} onDone={vi.fn()} />);
    expect(button(view.root, "Use Balanced response").props.disabled).toBe(true);
    await act(async () =>
      view.update(
        <GesturePreferences controls={{ ...value, status: { running: false } }} onDone={vi.fn()} />,
      ),
    );
    await act(async () => button(view.root, "Use Deliberate response").props.onClick());
    expect(value.changeConfig).toHaveBeenCalledWith({
      holdMs: 1000,
      releaseMs: 500,
      confidence: 0.9,
    });
    await act(async () => view.unmount());
  });

  it("captures the selected custom action and cancels unfinished capture on close", async () => {
    const value = valueFor("custom", { status: { running: true } });
    const view = await render(<GesturePreferences controls={value} onDone={vi.fn()} />);
    await act(async () =>
      view.root
        .findByProps({ "aria-label": "Pose name" })
        .props.onChange({ target: { value: "Comfortable" } }),
    );
    await act(async () =>
      view.root
        .findByProps({ "aria-label": "Custom pose action" })
        .props.onChange({ target: { value: "phone.dim" } }),
    );
    await act(async () => button(view.root, "Capture pose").props.onClick());
    expect(value.calibrate).toHaveBeenCalledWith("Comfortable", "phone.dim");
    await act(async () =>
      view.update(
        <GesturePreferences
          controls={{ ...value, calibrating: true, calibration: { phase: "capture", samples: 4 } }}
          onDone={vi.fn()}
        />,
      ),
    );
    expect(view.root.findByProps({ "aria-label": "Pose capture progress" }).props.value).toBe(4);
    await act(async () => view.unmount());
    expect(value.cancelCalibration).toHaveBeenCalledOnce();
  });
});

it("dismisses an unfinished mapping edit before switching tasks", async () => {
  const value = valueFor("media", { status: { running: true } });
  const view = await render(<GesturePanel controls={value} />);
  await act(async () => button(view.root, "Gesture settings").props.onClick());
  await act(async () => button(view.root, "Change Open palm").props.onClick());
  await act(async () =>
    view.root
      .findByProps({ "aria-label": "Activity" })
      .props.onChange({ target: { value: "photo" } }),
  );
  expect(value.switchMode).toHaveBeenCalledWith("photo");
  expect(view.root.findAllByProps({ "aria-label": "Change action for Open palm" })).toHaveLength(0);
  expect(value.changeConfig).not.toHaveBeenCalled();
  expect(value.setPaused).toHaveBeenLastCalledWith(false);
  await act(async () => view.unmount());
});

it("identifies the reserved stop gesture and an unassigned pose without implying an action ran", async () => {
  for (const [pose, label] of [
    ["FIST", "Stop camera"],
    ["LOVE", "No shortcut"],
  ]) {
    const value = valueFor("voice", {
      status: { running: true },
      recognition: { pose, phase: "holding", progress: 0.5 },
    });
    const view = await render(<GestureFeedback controls={value} />);
    expect(text(view.root)).toContain(label);
    expect(value.act).not.toHaveBeenCalled();
    await act(async () => view.unmount());
  }
});
