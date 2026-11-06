import { act, create } from "react-test-renderer";
import { expect, it, vi } from "vitest";
import GestureWorkspace from "./GestureWorkspace";
import { defaults } from "./engine";
import { actionLabel } from "./presentation";

const textOf = (node) => (typeof node === "string" ? node : node.children.map(textOf).join(""));
const button = (root, name) =>
  root.findAllByType("button").find((node) => (node.props["aria-label"] || textOf(node)) === name);
const valueFor = (extra = {}) => ({
  config: defaults(),
  status: { running: true, starting: false },
  camera: {},
  paused: false,
  practice: false,
  step: 0,
  page: 0,
  stop: vi.fn(),
  setPaused: vi.fn(),
  act: vi.fn(),
  ...extra,
});

it("attaches a webcam preview only when startup reaches a running stream", async () => {
  const preview = vi.fn(),
    video = {};
  const controls = valueFor({ status: { starting: true, running: false }, camera: { preview } });
  let view;
  await act(async () => {
    view = create(<GestureWorkspace controls={controls} />, {
      createNodeMock: (element) => (element.type === "video" ? video : null),
    });
  });
  expect(preview).not.toHaveBeenCalled();
  await act(async () =>
    view.update(
      <GestureWorkspace controls={{ ...controls, status: { starting: false, running: true } }} />,
    ),
  );
  expect(preview).toHaveBeenCalledWith(video);
  await act(async () => view.unmount());
});

it("keeps Pause and Stop available when minimized and restores preview on expansion", async () => {
  const preview = vi.fn(),
    video = {};
  const controls = valueFor({ camera: { preview } });
  let view;
  await act(async () => {
    view = create(<GestureWorkspace controls={controls} />, {
      createNodeMock: (element) => (element.type === "video" ? video : null),
    });
  });
  expect(preview).toHaveBeenCalledOnce();
  await act(async () => button(view.root, "Minimize gesture session").props.onClick());
  expect(view.root.findAllByType("video")).toHaveLength(0);
  await act(async () => button(view.root, "Pause gestures").props.onClick());
  expect(controls.setPaused).toHaveBeenCalledWith(true);
  await act(async () => button(view.root, "Stop camera").props.onClick());
  expect(controls.stop).toHaveBeenCalledOnce();
  await act(async () => button(view.root, "Expand gesture session").props.onClick());
  expect(preview).toHaveBeenCalledTimes(2);
  await act(async () => view.unmount());
});

it("offers Resume and usable touch controls during a paused reading session", async () => {
  const controls = valueFor({
    paused: true,
    config: { ...defaults(), mode: "reading", reader: "First page.\n\nSecond page." },
  });
  let view;
  await act(async () => {
    view = create(<GestureWorkspace controls={controls} />);
  });
  expect(button(view.root, actionLabel("reader.previous")).props.disabled).toBe(true);
  expect(button(view.root, actionLabel("reader.next")).props.disabled).toBeFalsy();
  await act(async () => button(view.root, actionLabel("reader.next")).props.onClick());
  expect(controls.act).toHaveBeenCalledWith("reader.next");
  await act(async () => button(view.root, "Resume gestures").props.onClick());
  expect(controls.setPaused).toHaveBeenCalledWith(false);
  expect(view.root.findByProps({ "data-gesture-reader": "workspace" }).children).toEqual([
    "First page.",
  ]);
  await act(async () => view.unmount());
});

it("shows practice guidance instead of command buttons during learning", async () => {
  let view;
  await act(async () => {
    view = create(<GestureWorkspace controls={valueFor({ practice: true })} />);
  });
  expect(view.root.findAllByProps({ "aria-label": "Touch controls" })).toHaveLength(0);
  expect(textOf(view.root)).toContain("Testing · actions off");
  expect(button(view.root, "Stop camera")).toBeDefined();
  await act(async () => view.unmount());
});

it("marks native-camera sessions for placement and hides the pointing cursor while paused", async () => {
  const controls = valueFor({
    config: { ...defaults(), mode: "hud" },
    cursor: { x: 50, y: 70, down: false },
  });
  let view;
  await act(async () => {
    view = create(<GestureWorkspace controls={controls} />);
  });
  expect(
    view.root.findByProps({ "aria-label": "Active gesture session" }).props["data-native"],
  ).toBe(true);
  const cursors = () =>
    view.root.findAll(
      (node) => node.type === "div" && node.props.className?.split(" ").includes("gesture-cursor"),
    );
  expect(cursors()).toHaveLength(1);
  await act(async () => view.update(<GestureWorkspace controls={{ ...controls, paused: true }} />));
  expect(cursors()).toHaveLength(0);
  await act(async () => view.unmount());
});
