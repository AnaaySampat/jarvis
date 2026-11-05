import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import GesturePanel from "./GesturePanel";
import { defaults } from "./engine";
import { actionLabel } from "./presentation";

function controls(mode = "voice", extra = {}) {
  return {
    config: { ...defaults(), mode },
    status: { running: false, starting: false, summary: "Camera is off." },
    camera: {},
    supported: true,
    busy: false,
    blocked: false,
    paused: false,
    practice: false,
    practiceTarget: null,
    practicePassed: [],
    history: [],
    availability: {},
    bookmarks: [],
    page: 0,
    step: 0,
    recognition: {
      pose: "UNKNOWN",
      score: 0,
      progress: 0,
      phase: "idle",
      hint: "Lower your hand.",
    },
    changeConfig: vi.fn(),
    switchMode: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    act: vi.fn(),
    setPaused: vi.fn(),
    setPractice: vi.fn(),
    setPracticeTarget: vi.fn(),
    ...extra,
  };
}
async function render(value, routines = []) {
  let view;
  await act(async () => {
    view = create(<GesturePanel controls={value} routines={routines} />);
  });
  return view;
}
const textOf = (node) => (typeof node === "string" ? node : node.children.map(textOf).join(""));
const button = (root, name) =>
  root.findAllByType("button").find((node) => (node.props["aria-label"] || textOf(node).replace(/\s+/g, " ").trim()) === name);
const tab = (root, name) =>
  root.findAllByProps({ role: "tab" }).find((node) => textOf(node) === name);
const byLabel = (root, name) => root.findByProps({ "aria-label": name });

async function update(view, value) {
  await act(async () => view.update(<GesturePanel controls={value} />));
}

describe("human gesture workflows", () => {
  it("prioritizes useful phone activities and opens the setup guide without starting the camera", async () => {
    const value = controls("phone", { platform: "android" });
    const view = await render(value);
    const activities = byLabel(view.root, "Choose activity");
    expect(activities.findAllByType("button").map((node) => node.props["aria-label"])).toEqual([
      "Choose Phone",
      "Choose Music",
      "Choose Voice",
      "Choose Read",
      "Choose Photo",
      "Choose Steps",
    ]);
    await act(async () => tab(view.root, "Guide").props.onClick());
    const guide = byLabel(view.root, "Gesture setup guide");
    expect(textOf(guide)).toContain("Calibration is only needed");
    expect(textOf(guide)).toContain("hand commands pause when you switch to another app");
    expect(value.start).not.toHaveBeenCalled();
    expect(value.act).not.toHaveBeenCalled();
    await act(async () => button(guide, "Practice open palm").props.onClick());
    expect(value.setPractice).toHaveBeenCalledWith(true);
    expect(value.setPracticeTarget).toHaveBeenCalledWith("OPEN_PALM");
    expect(byLabel(view.root, "Guided practice")).toBeDefined();
    expect(value.start).not.toHaveBeenCalled();
    await act(async () => view.unmount());
  });

  it("keeps a live session paused while the guide opens action editing and resumes after saving", async () => {
    const value = controls("phone", { platform: "android", status: { running: true } });
    const view = await render(value);
    await act(async () => tab(view.root, "Guide").props.onClick());
    expect(value.setPaused).toHaveBeenLastCalledWith(true);
    await update(view, { ...value, paused: true });
    await act(async () => button(view.root, "Choose this gesture’s action").props.onClick());
    expect(value.setPaused).not.toHaveBeenCalledWith(false);
    const editor = byLabel(view.root, "Change action for Open palm");
    await act(async () => button(editor, "Save action").props.onClick());
    expect(value.changeConfig).toHaveBeenCalledOnce();
    expect(value.setPaused).toHaveBeenLastCalledWith(false);
    await act(async () => view.unmount());
  });

  it("chooses a custom pose action before capture and starts setup with commands disabled", async () => {
    const value = controls("custom", { calibrate: vi.fn() });
    const view = await render(value);
    await act(async () => button(view.root, "Start camera for setup").props.onClick());
    expect(value.setPractice).toHaveBeenCalledWith(true);
    expect(value.setPractice.mock.invocationCallOrder[0]).toBeLessThan(
      value.start.mock.invocationCallOrder[0],
    );
    await update(view, { ...value, practice: true, status: { running: true } });
    await act(async () =>
      byLabel(view.root, "Pose name").props.onChange({ target: { value: "My signal" } }),
    );
    await act(async () =>
      byLabel(view.root, "Custom pose action").props.onChange({ target: { value: "phone.dim" } }),
    );
    expect(button(view.root, "Capture my pose").props.disabled).toBeFalsy();
    await act(async () => button(view.root, "Capture my pose").props.onClick());
    expect(value.calibrate).toHaveBeenCalledWith("My signal", "phone.dim");
    expect(value.act).not.toHaveBeenCalled();
    await update(view, {
      ...value,
      practice: true,
      calibrating: true,
      status: { running: true },
      calibration: { phase: "capture", samples: 4 },
      cancelCalibration: vi.fn(),
    });
    expect(byLabel(view.root, "Pose capture progress").props.value).toBe(4);
    expect(button(view.root, "Finish teaching & enable actions")).toBeUndefined();
    await act(async () => view.unmount());
  });

  it("offers six useful activities first and switches a running camera without restarting it", async () => {
    const value = controls("voice", { status: { running: true, starting: false } });
    const view = await render(value);
    const activities = byLabel(view.root, "Choose activity");
    expect(activities.findAllByType("button").map((node) => node.props["aria-label"])).toEqual([
      "Choose Voice",
      "Choose Music",
      "Choose Slides",
      "Choose Read",
      "Choose Photo",
      "Choose Steps",
    ]);
    expect(button(view.root, "Choose Music").props.disabled).toBeFalsy();
    await act(async () => button(view.root, "Choose Music").props.onClick());
    expect(value.switchMode).toHaveBeenCalledWith("media");
    expect(value.stop).not.toHaveBeenCalled();
    expect(value.start).not.toHaveBeenCalled();
    await act(async () => button(view.root, "More activities").props.onClick());
    expect(button(view.root, "Choose My gestures")).toBeDefined();
    expect(button(view.root, "Choose TV")).toBeDefined();
    await act(async () => view.unmount());
  });

  it("shows the selected activity's useful content and teaches finger placement visually", async () => {
    const view = await render(controls());
    expect(view.root.findAllByType("textarea")).toHaveLength(0);
    const guide = byLabel(view.root, "Gestures for this mode");
    expect(guide.findAllByType("article").length).toBeGreaterThan(0);
    expect(
      guide.findAllByType("article").every((card) => card.findAllByType("svg").length > 0),
    ).toBe(true);
    expect(textOf(guide)).toContain("Raise your index and middle fingers in a V");
    expect(button(guide, "Learn Peace sign")).toBeDefined();
    expect(button(guide, "Change Closed fist")).toBeUndefined();
    await update(view, controls("reading"));
    expect(byLabel(view.root, "Reading text").type).toBe("textarea");
    expect(view.root.findAllByProps({ "aria-label": "Instructions" })).toHaveLength(0);
    await update(view, controls("cooking"));
    expect(byLabel(view.root, "Instructions").type).toBe("textarea");
    expect(view.root.findAllByProps({ "aria-label": "Reading text" })).toHaveLength(0);
    await act(async () => view.unmount());
  });

  it("starts guided practice for a chosen pose only after explicit camera start", async () => {
    const value = controls();
    const view = await render(value);
    await act(async () => button(view.root, "Learn Peace sign").props.onClick());
    expect(value.setPractice).toHaveBeenCalledWith(true);
    expect(value.setPracticeTarget).toHaveBeenCalledWith("PEACE");
    expect(byLabel(view.root, "Guided practice")).toBeDefined();
    expect(value.start).not.toHaveBeenCalled();
    await update(view, { ...value, practice: true, practiceTarget: "PEACE" });
    await act(async () => button(view.root, "Start practice").props.onClick());
    expect(value.start).toHaveBeenCalledOnce();
    expect(value.setPracticeTarget).toHaveBeenLastCalledWith("PEACE");
    expect(value.setPractice.mock.invocationCallOrder.at(-1)).toBeLessThan(
      value.start.mock.invocationCallOrder[0],
    );
    expect(value.setPracticeTarget.mock.invocationCallOrder.at(-1)).toBeLessThan(
      value.start.mock.invocationCallOrder[0],
    );
    await act(async () => view.unmount());
  });

  it("advances practice only when the selected target passed and explicitly returns to actions", async () => {
    const value = controls("voice", {
      status: { running: true },
      practice: true,
      practiceTarget: "OPEN_PALM",
      recognition: { pose: "PEACE", score: 0.99, progress: 1, phase: "recognized" },
    });
    const view = await render(value);
    expect(button(view.root, "Next gesture").props.disabled).toBe(true);
    expect(textOf(byLabel(view.root, "Guided practice"))).toContain("The camera sees peace sign");
    await update(view, { ...value, practicePassed: ["OPEN_PALM"] });
    expect(button(view.root, "Next gesture").props.disabled).toBe(false);
    await act(async () => button(view.root, "Next gesture").props.onClick());
    expect(value.setPracticeTarget).toHaveBeenCalledWith("PEACE");
    await act(async () => button(view.root, "Use gestures").props.onClick());
    expect(value.setPractice).toHaveBeenCalledWith(false);
    expect(tab(view.root, "Control").props["aria-selected"]).toBe(true);
    await act(async () => view.unmount());
  });

  it("pauses actions for Tune and locks camera timing until the camera stops", async () => {
    const value = controls("voice", { status: { running: true } });
    const view = await render(value);
    await act(async () => tab(view.root, "Tune").props.onClick());
    expect(value.setPaused).toHaveBeenCalledWith(true);
    expect(button(view.root, "Use Balanced response").props.disabled).toBe(true);
    expect(byLabel(view.root, "Hold time").props.disabled).toBe(true);
    expect(button(view.root, "Stop camera").props.disabled).toBeFalsy();
    await update(view, { ...value, status: { running: false, starting: false } });
    expect(button(view.root, "Use Deliberate response").props.disabled).toBe(false);
    await act(async () => button(view.root, "Use Deliberate response").props.onClick());
    expect(value.changeConfig).toHaveBeenCalledWith({
      holdMs: 1000,
      releaseMs: 500,
      confidence: 0.9,
    });
    await act(async () => view.unmount());
  });

  it("edits a pose inline with relevant actions and resumes only after saving the scoped change", async () => {
    const value = controls("media", { status: { running: true } });
    const view = await render(value);
    await act(async () => button(view.root, "Change Open palm").props.onClick());
    expect(value.setPaused).toHaveBeenCalledWith(true);
    const editor = byLabel(view.root, "Change action for Open palm");
    const suggested = byLabel(editor, "Suggested actions");
    expect(button(suggested, actionLabel("media.next"))).toBeDefined();
    expect(button(suggested, "TV: next")).toBeUndefined();
    await act(async () => button(suggested, actionLabel("media.next")).props.onClick());
    await act(async () => button(editor, "Save action").props.onClick());
    const patch = value.changeConfig.mock.calls[0][0](value.config);
    expect(patch.bindings.media.OPEN_PALM).toBe("media.next");
    expect(patch.bindings.media.PEACE).toBe(value.config.bindings.media.PEACE);
    expect(patch.bindings.voice).toEqual(value.config.bindings.voice);
    expect(value.setPaused).toHaveBeenLastCalledWith(false);
    expect(value.changeConfig.mock.invocationCallOrder[0]).toBeLessThan(
      value.setPaused.mock.invocationCallOrder.at(-1),
    );
    expect(view.root.findAllByProps({ "aria-label": "Change action for Open palm" })).toHaveLength(
      0,
    );
    await act(async () => view.unmount());
  });

  it("keeps an already paused session paused when cancelling a pose edit", async () => {
    const value = controls("media", { status: { running: true }, paused: true });
    const view = await render(value);
    await act(async () => button(view.root, "Change Open palm").props.onClick());
    const editor = byLabel(view.root, "Change action for Open palm");
    await act(async () => button(editor, "Cancel editing").props.onClick());
    expect(value.setPaused).not.toHaveBeenCalled();
    expect(value.changeConfig).not.toHaveBeenCalled();
    await act(async () => view.unmount());
  });

  it("shows connection setup and actual failed results without optimistic success", async () => {
    const setup = vi.fn();
    const value = controls("pc", {
      status: { running: true },
      availability: {
        pc: { ready: false, detail: "Connect your PC first.", setup, setupLabel: "Open PC setup" },
      },
      history: [
        {
          id: 1,
          action: "pc.next",
          pose: "manual",
          at: 1,
          state: "failed",
          summary: "PC control has expired.",
        },
      ],
    });
    const view = await render(value);
    expect(textOf(view.root)).toContain("Connect your PC first.");
    await act(async () => button(view.root, "Open PC setup").props.onClick());
    expect(setup).toHaveBeenCalledOnce();
    expect(view.root.findByProps({ "data-state": "failed" }).findByType("p").children).toEqual([
      "PC control has expired.",
    ]);
    const quick = byLabel(view.root, "Touch controls");
    expect(quick.findAllByType("button").every((node) => node.props.disabled)).toBe(true);
    await act(async () => view.unmount());
  });
});

it("resumes a previously active session when leaving an edit through activity navigation or Control", async () => {
  for (const exit of ["activity", "control"]) {
    const value = controls("media", { status: { running: true } });
    const view = await render(value);
    await act(async () => button(view.root, "Change Open palm").props.onClick());
    expect(value.setPaused).toHaveBeenCalledWith(true);
    await act(async () =>
      (exit === "activity"
        ? button(view.root, "Choose Photo")
        : tab(view.root, "Control")
      ).props.onClick(),
    );
    expect(value.setPaused).toHaveBeenLastCalledWith(false);
    expect(value.changeConfig).not.toHaveBeenCalled();
    expect(view.root.findAllByProps({ "aria-label": "Change action for Open palm" })).toHaveLength(
      0,
    );
    await act(async () => view.unmount());
  }
});

it("searches additional actions without filling the main editor with unrelated choices", async () => {
  const value = controls();
  const view = await render(value);
  await act(async () => button(view.root, "Change Peace sign").props.onClick());
  const editor = byLabel(view.root, "Change action for Peace sign");
  const suggestions = byLabel(editor, "Suggested actions");
  expect(button(suggestions, "Mute microphone")).toBeUndefined();
  await act(async () => button(editor, "More actions").props.onClick());
  const search = byLabel(editor, "Search actions");
  await act(async () => search.props.onChange({ target: { value: "microphone" } }));
  const results = search.parent.findAllByType("button");
  expect(results.map(textOf)).toEqual(["Mute microphone", "Unmute microphone"]);
  await act(async () => button(search.parent, "Mute microphone").props.onClick());
  await act(async () => button(editor, "Save action").props.onClick());
  expect(value.changeConfig.mock.calls[0][0](value.config).bindings.voice.PEACE).toBe("mic.mute");
  await act(async () => view.unmount());
});

it("keeps Stop available while opening the camera", async () => {
  const value = controls("voice", { status: { running: false, starting: true }, busy: true });
  const view = await render(value);
  const stop = button(view.root, "Stop camera");
  expect(stop.props.disabled).toBeFalsy();
  await act(async () => stop.props.onClick());
  expect(value.stop).toHaveBeenCalledOnce();
  await act(async () => view.unmount());
});

it("starts the new activity's practice target when changing activities inside Learn", async () => {
  const value = controls("voice", {
    practice: true,
    practiceTarget: "OPEN_PALM",
    status: { running: true },
  });
  const view = await render(value);
  await act(async () => button(view.root, "Change activity").props.onClick());
  await act(async () => button(view.root, "Choose Photo").props.onClick());
  expect(value.switchMode).toHaveBeenCalledWith("photo");
  expect(value.setPracticeTarget).toHaveBeenCalledWith("PEACE");
  await act(async () => view.unmount());
});
