import { act, create } from "react-test-renderer";
import { expect, it, vi } from "vitest";
import { ActivityContent, CameraView, QuickControls } from "./GestureSessionViews";
import { defaults } from "./engine";
import { actionLabel } from "./presentation";

const valueFor = (mode = "media", extra = {}) => ({
  config: { ...defaults(), mode },
  status: { running: true, starting: false },
  camera: {},
  paused: false,
  practice: false,
  blocked: false,
  availability: {},
  page: 0,
  step: 0,
  act: vi.fn(),
  changeConfig: vi.fn(),
  ...extra,
});
const named = (root, name) => root.findByProps({ "aria-label": name });

it("keeps real touch controls working while gestures are paused and blocks them when unavailable", async () => {
  const value = valueFor("media", { paused: true });
  let view;
  await act(async () => {
    view = create(<QuickControls controls={value} />);
  });
  const play = () => named(view.root, actionLabel("media.toggle"));
  expect(play().props.disabled).toBe(false);
  await act(async () => play().props.onClick());
  expect(value.act).toHaveBeenCalledWith("media.toggle");
  for (const patch of [
    { practice: true },
    { blocked: true },
    { availability: { media: { ready: false } } },
  ]) {
    await act(async () => view.update(<QuickControls controls={{ ...value, ...patch }} />));
    expect(play().props.disabled).toBe(true);
  }
  await act(async () => view.unmount());
});

it("disables reader boundary controls while leaving valid reading actions available", async () => {
  const value = valueFor("reading", {
    config: { ...defaults(), mode: "reading", reader: "First page.\n\nSecond page." },
    status: { running: false, starting: false },
  });
  let view;
  await act(async () => {
    view = create(<QuickControls controls={value} />);
  });
  expect(named(view.root, actionLabel("reader.previous")).props.disabled).toBe(true);
  expect(named(view.root, actionLabel("reader.next")).props.disabled).toBe(false);
  expect(named(view.root, actionLabel("reader.speak")).props.disabled).toBe(false);
  await act(async () => view.update(<QuickControls controls={{ ...value, page: 1 }} />));
  expect(named(view.root, actionLabel("reader.previous")).props.disabled).toBe(false);
  expect(named(view.root, actionLabel("reader.next")).props.disabled).toBe(true);
  await act(async () =>
    view.update(<QuickControls controls={{ ...value, config: { ...value.config, reader: "" } }} />),
  );
  expect(
    view.root
      .findAllByType("button")
      .filter((node) => node.props["data-action"]?.startsWith("reader."))
      .every((node) => node.props.disabled),
  ).toBe(true);
  await act(async () => view.unmount());
});

it("allows explicit music controls with the camera off while photos still require it", async () => {
  const music = valueFor("media", { status: { running: false, starting: false } });
  let view;
  await act(async () => {
    view = create(<QuickControls controls={music} />);
  });
  const play = named(view.root, actionLabel("media.toggle"));
  expect(play.props.disabled).toBeFalsy();
  await act(async () => play.props.onClick());
  expect(music.act).toHaveBeenCalledWith("media.toggle");
  const photo = valueFor("photo", { status: { running: false, starting: false } });
  await act(async () => view.update(<QuickControls controls={photo} />));
  expect(named(view.root, actionLabel("photo.capture")).props.disabled).toBe(true);
  await act(async () =>
    view.update(<QuickControls controls={{ ...photo, status: { running: true } }} />),
  );
  expect(named(view.root, actionLabel("photo.capture")).props.disabled).toBeFalsy();
  await act(async () => view.unmount());
});

it("offers a Finish listening button for an active voice capture", async () => {
  const value = valueFor("voice", { listening: true, status: { running: false } });
  let view;
  await act(async () => {
    view = create(<QuickControls controls={value} />);
  });
  const finish = named(view.root, "Finish listening");
  expect(finish.props.disabled).toBeFalsy();
  await act(async () => finish.props.onClick());
  expect(value.act).toHaveBeenCalledWith("voice.listen");
  await act(async () => view.unmount());
});

it("attaches a visible webcam preview only when running and releases the element on unmount", async () => {
  const preview = vi.fn(),
    video = { srcObject: {} };
  const value = valueFor("voice", {
    status: { running: false, starting: true },
    camera: { preview },
  });
  let view;
  await act(async () => {
    view = create(<CameraView controls={value} />, {
      createNodeMock: (element) => (element.type === "video" ? video : null),
    });
  });
  expect(preview).not.toHaveBeenCalled();
  await act(async () =>
    view.update(<CameraView controls={{ ...value, status: { running: true } }} />),
  );
  expect(preview).toHaveBeenCalledWith(video);
  expect(view.root.findAllByType("video")).toHaveLength(1);
  await act(async () => view.unmount());
  expect(video.srcObject).toBe(null);
});

it("explains the real Android floating preview without rendering a fake camera feed", async () => {
  let view;
  await act(async () => {
    view = create(<CameraView controls={valueFor()} />);
  });
  expect(view.root.findAllByType("video")).toHaveLength(0);
  expect(
    view.root
      .findAllByType("span")
      .some((node) => node.children.join("").includes("floating camera preview on your phone")),
  ).toBe(true);
  await act(async () => view.unmount());
});

it("provides an inline reader target and keeps timer editing in human minutes", async () => {
  const value = valueFor("reading", {
    config: { ...defaults(), mode: "reading", reader: "An article." },
  });
  let view;
  await act(async () => {
    view = create(<ActivityContent controls={value} editable location="panel" />);
  });
  expect(view.root.findByProps({ "data-gesture-reader": "panel" }).children).toEqual([
    "An article.",
  ]);
  const steps = valueFor("cooking");
  await act(async () =>
    view.update(<ActivityContent controls={steps} editable location="panel" />),
  );
  await act(async () =>
    named(view.root, "Timer minutes").props.onChange({ target: { value: "2.5" } }),
  );
  expect(steps.changeConfig).toHaveBeenCalledWith({ timerSeconds: 150 });
  await act(async () => view.unmount());
});

it("keeps the reading editor open when the first typed character creates a page", async () => {
  const value = valueFor("reading");
  let view;
  await act(async () => {
    view = create(<ActivityContent controls={value} editable location="panel" />);
  });
  expect(view.root.findByType("details").props.open).toBe(true);
  await act(async () =>
    view.update(
      <ActivityContent
        controls={{ ...value, config: { ...value.config, reader: "F" } }}
        editable
        location="panel"
      />,
    ),
  );
  expect(view.root.findByType("details").props.open).toBe(true);
  await act(async () => view.unmount());
});

it("keeps local reading controls usable without a supported gesture camera", async () => {
  const value = valueFor("reading", {
    supported: false,
    config: { ...defaults(), mode: "reading", reader: "First.\n\nSecond." },
    status: { running: false },
  });
  let view;
  await act(async () => {
    view = create(<QuickControls controls={value} />);
  });
  const next = named(view.root, "Next page");
  expect(next.props.disabled).toBeFalsy();
  await act(async () => next.props.onClick());
  expect(value.act).toHaveBeenCalledWith("reader.next");
  await act(async () => view.unmount());
});
