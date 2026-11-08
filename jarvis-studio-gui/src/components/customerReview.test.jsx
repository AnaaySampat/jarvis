import { useState } from "react";
import TopBarEditor from "./TopBarEditor";
import { cleanTopBar, TOP_BAR_ACTIONS } from "../brain/mobile/topBarConfig";
import { act, create } from "react-test-renderer";
import { expect, it, vi } from "vitest";
import MobileQuickControls from "./MobileQuickControls";
import QuickStart from "./QuickStart";
import { WeatherWidget } from "../hud/widgets";
import GesturePanel from "../gestures/GesturePanel";
import ActivityView from "../gestures/ActivityView";
import { defaults } from "../gestures/engine";
import { documentId } from "../gestures/storage";
import { ChatOverlay } from "../hud/HudPanels";

vi.mock("../hooks/useAssistant", () => ({ IS_MOBILE: true }));
vi.mock("./Sheet", async (original) => ({
  ...(await original()),
  default: ({ open, children, footer }) =>
    open ? (
      <section>
        {children}
        {footer}
      </section>
    ) : null,
}));
vi.mock("./ResponseRenderer", () => ({ default: ({ text }) => <span>{text}</span> }));

const text = (node) => (typeof node === "string" ? node : node.children.map(text).join(""));
const button = (root, label) =>
  root.findAllByType("button").find((node) => (node.props["aria-label"] || text(node)) === label);
async function render(element) {
  let view;
  await act(async () => {
    view = create(element);
  });
  return view;
}
function controls(mode = "reading") {
  return {
    config: {
      ...defaults(),
      mode,
      reader: "Page one.\n\nPage two.",
      steps: "Boil water\nPour tea",
    },
    status: { running: false, starting: false, summary: "Camera is off." },
    camera: {},
    supported: false,
    page: 0,
    step: 0,
    bookmarks: [],
    practice: false,
    paused: false,
    history: [],
    availability: {},
    timers: { timers: [], now: 0, busy: false, error: "", clearError: vi.fn() },
    changeConfig: vi.fn(),
    switchMode: vi.fn(),
    setPractice: vi.fn(),
    setPracticeTarget: vi.fn(),
    setPaused: vi.fn(),
    selectPage: vi.fn(),
    selectStep: vi.fn(),
    act: vi.fn(),
  };
}

it("defaults to live status, Sound and Settings without Search or branding", async () => {
  const mute = vi.fn(),
    settings = vi.fn();
  const view = await render(<MobileQuickControls onMute={mute} onSettings={settings} />);
  expect(view.root.findAllByType("button")).toHaveLength(2);
  expect(view.root.findByProps({ role: "status" }).children).toEqual(["Ready"]);
  expect(button(view.root, "Command palette")).toBeUndefined();
  expect(text(view.root)).not.toContain("JARVIS");
  await act(async () => button(view.root, "Mute JARVIS").props.onClick());
  await act(async () => button(view.root, "Settings").props.onClick());
  expect(mute).toHaveBeenCalledOnce();
  expect(settings).toHaveBeenCalledOnce();
  await act(async () => view.update(<MobileQuickControls muted onMute={mute} />));
  expect(button(view.root, "Unmute JARVIS").props["aria-pressed"]).toBe(true);
  await act(async () => view.unmount());
});

it("shows the real assistant state and keeps Stop available even with status hidden", async () => {
  const stop = vi.fn();
  const view = await render(<MobileQuickControls status="listening" onStop={stop} />);
  expect(text(view.root)).toContain("Listening");
  expect(button(view.root, "Stop JARVIS")).toBeUndefined();
  for (const [status, taskActive, label] of [
    ["thinking", false, "Thinking"],
    ["working", false, "Working"],
    ["idle", true, "Working"],
    ["speaking", false, "Speaking"],
  ]) {
    await act(async () =>
      view.update(<MobileQuickControls status={status} taskActive={taskActive} onStop={stop} />),
    );
    expect(view.root.findByProps({ role: "status" }).children).toEqual([label]);
    expect(Boolean(button(view.root, "Stop JARVIS"))).toBe(status !== "thinking");
  }
  await act(async () =>
    view.update(
      <MobileQuickControls
        taskActive
        onStop={stop}
        preferences={{ showStatus: false, showLabels: false, buttons: ["settings"] }}
      />,
    ),
  );
  expect(view.root.findAllByProps({ role: "status" })).toHaveLength(0);
  await act(async () => button(view.root, "Stop JARVIS").props.onClick());
  expect(stop).toHaveBeenCalledOnce();
  await act(async () => view.unmount());
});

it("keeps every tool reachable through an optional Menu button", async () => {
  const callbacks = {
    onGestures: vi.fn(),
    onTasks: vi.fn(),
    onDevices: vi.fn(),
    onPhone: vi.fn(),
    onCustomize: vi.fn(),
    onSettings: vi.fn(),
  };
  const view = await render(
    <MobileQuickControls
      {...callbacks}
      preferences={{ buttons: ["menu"], showStatus: true, showLabels: true }}
    />,
  );
  for (const [label, key] of [
    ["Activities", "onGestures"],
    ["Tasks", "onTasks"],
    ["PC & TV", "onDevices"],
    ["Phone controls", "onPhone"],
    ["Appearance", "onCustomize"],
    ["Settings", "onSettings"],
  ]) {
    await act(async () => button(view.root, "Open menu").props.onClick());
    await act(async () => button(view.root, label).props.onClick());
    expect(callbacks[key]).toHaveBeenCalledOnce();
    expect(button(view.root, "Open menu").props["aria-expanded"]).toBe(false);
  }
  await act(async () => view.unmount());
});

it("edits button order, status and labels live and can reset without losing access to settings", async () => {
  function Editable() {
    const [value, setValue] = useState(cleanTopBar());
    return (
      <>
        <MobileQuickControls preferences={value} />
        <TopBarEditor value={value} onChange={setValue} />
      </>
    );
  }
  const view = await render(<Editable />);
  const actions = () =>
    view.root
      .findByProps({ "aria-label": "Quick controls" })
      .findAllByType("button")
      .map((node) => node.props["aria-label"]);
  expect(button(view.root, "Remove Settings").props.disabled).toBe(true);
  const add = () => view.root.findByProps({ "aria-label": "Add top bar button" });
  await act(async () => button(add(), "Tasks").props.onClick());
  expect(button(add(), "Menu").props.disabled).toBeUndefined();
  await act(async () => button(view.root, "Move Tasks left").props.onClick());
  expect(actions()).toEqual(["Mute JARVIS", "Tasks", "Settings"]);
  await act(async () => button(view.root, "Remove Sound").props.onClick());
  await act(async () => button(add(), "Menu").props.onClick());
  expect(button(view.root, "Remove Settings").props.disabled).toBe(false);
  await act(async () => button(view.root, "Remove Settings").props.onClick());
  expect(actions()).toEqual(["Tasks", "Open menu"]);
  const toggle = (name) =>
    view.root
      .findAllByProps({ role: "switch" })
      .find((node) => node.type === "input" && node.props["aria-label"] === name);
  await act(async () =>
    toggle("Show assistant status").props.onChange({ target: { checked: false } }),
  );
  await act(async () => toggle("Show button labels").props.onChange({ target: { checked: true } }));
  expect(view.root.findAllByProps({ role: "status" })).toHaveLength(0);
  expect(text(view.root.findByProps({ "aria-label": "Quick controls" }))).toBe("TasksMenu");
  await act(async () => button(view.root, "Reset top bar").props.onClick());
  expect(actions()).toEqual(["Mute JARVIS", "Settings"]);
  expect(view.root.findByProps({ role: "status" }).children).toEqual(["Ready"]);
  await act(async () => view.unmount());
});

it("lets the user add all shortcuts and keeps every selected control reachable", async () => {
  function Editable() {
    const [value, setValue] = useState(cleanTopBar());
    return <><MobileQuickControls preferences={value} /><TopBarEditor value={value} onChange={setValue} /></>;
  }
  const view = await render(<Editable />);
  for (const id of Object.keys(TOP_BAR_ACTIONS).filter((id) => !["sound", "settings"].includes(id))) {
    const available = view.root.findByProps({ "aria-label": "Add top bar button" });
    await act(async () => button(available, TOP_BAR_ACTIONS[id].label).props.onClick());
  }
  const selected = view.root.findByProps({ "aria-label": "Quick controls" }).findAllByType("button");
  expect(selected).toHaveLength(Object.keys(TOP_BAR_ACTIONS).length);
  expect(selected.map((item) => item.props["aria-label"])).toContain("Phone controls");
  await act(async () => view.unmount());
});

it("introduces the controls before shortcut selection and commits only the chosen draft", async () => {
  const finish = vi.fn();
  const view = await render(<QuickStart preferences={{ buttons: ["settings"] }} onFinish={finish} />);
  expect(text(view.root)).toContain("Capabilities");
  expect(view.root.findAllByProps({ "aria-label": "Add top bar button" })).toHaveLength(0);
  await act(async () => button(view.root, "Choose shortcuts").props.onClick());
  for (const id of ["tasks", "devices", "activities", "phone"]) {
    const available = view.root.findByProps({ "aria-label": "Add top bar button" });
    await act(async () => button(available, TOP_BAR_ACTIONS[id].label).props.onClick());
  }
  expect(finish).not.toHaveBeenCalled();
  await act(async () => button(view.root, "Use these shortcuts").props.onClick());
  expect(finish).toHaveBeenCalledWith({ showStatus: true, showLabels: false, buttons: ["settings", "tasks", "devices", "activities", "phone"] });
  await act(async () => view.unmount());
});

it("skips the tour without replacing existing shortcut preferences", async () => {
  const finish = vi.fn();
  const preferences = cleanTopBar({ buttons: ["menu", "devices", "tasks", "phone"], showLabels: true });
  const view = await render(<QuickStart preferences={preferences} onFinish={finish} />);
  await act(async () => button(view.root, "Skip for now").props.onClick());
  expect(finish).toHaveBeenCalledWith(preferences);
  await act(async () => view.unmount());
});

it("keeps reading and the camera switch together, with preferences behind Settings", async () => {
  const value = controls();
  const view = await render(<GesturePanel controls={value} workspace />);
  expect(view.root.findAllByProps({ "aria-label": "Read" })).toHaveLength(1);
  expect(button(view.root, "Hands-free")).toBeDefined();
  expect(view.root.findAllByProps({ role: "tab" })).toHaveLength(0);
  await act(async () => button(view.root, "Gesture settings").props.onClick());
  expect(button(view.root, "Use Balanced response")).toBeDefined();
  expect(value.act).not.toHaveBeenCalled();
  await act(async () => button(view.root, "Back").props.onClick());
  expect(view.root.findAllByProps({ "aria-label": "Read" })).toHaveLength(1);
  await act(async () => view.unmount());
});

it("keeps Stop available in a live reading workspace", async () => {
  const value = { ...controls(), status: { running: true }, stop: vi.fn() };
  const view = await render(<GesturePanel controls={value} workspace />);
  await act(async () => button(view.root, "Stop").props.onClick());
  expect(value.stop).toHaveBeenCalledOnce();
  await act(async () => view.unmount());
});

it("retains bookmark naming and return controls in the compact reader", async () => {
  const value = controls();
  value.bookmarks = [
    {
      at: 1,
      page: 1,
      name: "Riverside",
      excerpt: "Page two",
      documentId: documentId(value.config.reader),
    },
  ];
  value.renameBookmark = vi.fn();
  const view = await render(<ActivityView controls={value} />);
  await act(async () => button(view.root, "Bookmarks (1)").props.onClick());
  await act(async () => button(view.root, "Riverside").props.onClick());
  expect(value.selectPage).toHaveBeenCalledWith(1);
  expect(button(view.root, "Bookmarks (1)").props["aria-expanded"]).toBe(false);
  await act(async () => view.unmount());
});

it("keeps timer errors in Steps while preserving real timers in other activities", async () => {
  const value = controls("cooking");
  value.timers.error = "This only works on the device.";
  value.timers.timers = [
    { id: "tea", seconds: 10, label: "Tea", deadline: 10000, state: "running" },
  ];
  const view = await render(<ActivityView controls={value} />);
  expect(view.root.findAllByProps({ role: "alert" })).toHaveLength(1);
  await act(async () => button(view.root, "Dismiss timer message").props.onClick());
  expect(value.timers.clearError).toHaveBeenCalledOnce();
  await act(async () =>
    view.update(
      <ActivityView controls={{ ...value, config: { ...value.config, mode: "reading" } }} />,
    ),
  );
  expect(view.root.findAllByProps({ role: "alert" })).toHaveLength(0);
  expect(text(view.root)).toContain("Tea");
  expect(text(view.root)).not.toContain("This only works on the device.");
  await act(async () => view.unmount());
});

it("renders live tool activity inside the matching chat reply and retains it with the final answer", async () => {
  const call = { id: "call", tool: "set_timer", title: "Set a timer", input: "Duration: 300 seconds",
    state: "running", at: Date.now(), startedAt: Date.now() };
  const messages = [{ id: "user", role: "user", text: "Set a timer" },
    { id: "reply", role: "jarvis", text: "", finalized: false, toolActivity: [call] }];
  const view = await render(<ChatOverlay open status="thinking" messages={messages} />);
  expect(text(view.root)).toContain("set_timer");
  expect(text(view.root)).toContain("Running");
  await act(async () => view.update(<ChatOverlay open status="idle" messages={[messages[0],
    { ...messages[1], text: "Clock opened; check the timer.", finalized: true,
      toolActivity: [{ ...call, state: "unconfirmed", elapsedMs: 800 }] }]} />));
  expect(text(view.root)).toContain("Unconfirmed");
  expect(text(view.root)).toContain("Clock opened; check the timer.");
  expect(view.root.findAllByProps({ "aria-label": "Tools used" })).toHaveLength(1);
  await act(async () => view.unmount());
});

it("offers provider setup inside a pending conversation and preserves its draft", async () => {
  const setup = vi.fn();
  const messages = [
    { id: 1, role: "user", text: "Plan a short walk" },
    { id: 2, role: "jarvis", text: "Set up an AI provider." },
  ];
  const props = {
    open: true,
    status: "idle",
    messages,
    onSetupProvider: setup,
    providerRequired: true,
  };
  const view = await render(<ChatOverlay {...props} />);
  const input = view.root.findByProps({ "aria-label": "Message JARVIS" });
  await act(async () => input.props.onChange({ target: { value: "Keep this draft" } }));
  await act(async () => button(view.root, "Set up an AI provider").props.onClick());
  expect(setup).toHaveBeenCalledOnce();
  await act(async () => view.update(<ChatOverlay {...props} open={false} />));
  expect(view.root.findAllByType("input")).toHaveLength(0);
  await act(async () => view.update(<ChatOverlay {...props} providerRequired={false} />));
  expect(view.root.findByProps({ "aria-label": "Message JARVIS" }).props.value).toBe(
    "Keep this draft",
  );
  expect(text(view.root)).toContain("Plan a short walk");
  expect(button(view.root, "Set up an AI provider")).toBeUndefined();
  await act(async () => view.unmount());
});

it("offers the correct Location recovery path directly from Weather", async () => {
  const open = vi.fn();
  const view = await render(<WeatherWidget open onOpenLocation={open} />);
  expect(text(view.root)).toContain("Settings → Location");
  expect(text(view.root)).not.toContain("Files & Location");
  await act(async () => button(view.root, "Set location").props.onClick());
  expect(open).toHaveBeenCalledOnce();
  await act(async () => view.unmount());
});
