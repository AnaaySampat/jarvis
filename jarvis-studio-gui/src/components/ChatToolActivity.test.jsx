import { act, create } from "react-test-renderer";
import { expect, it, vi } from "vitest";
import ChatToolActivity from "./ChatToolActivity";
const row = (id, state) => ({
  id,
  tool: "web_search",
  title: "Search the web",
  input: "Inputs kept private",
  summary: state === "completed" ? "Result received" : "",
  state,
  startedAt: Date.now(),
  at: Date.now(),
  elapsedMs: 1500,
});
const words = (node) =>
  typeof node === "string" ? node : (node?.children || []).map(words).join("");
it("opens live calls, shows tool names/details, then collapses successful work after the answer", async () => {
  let view;
  await act(async () => {
    view = create(<ChatToolActivity rows={[row("a", "running")]} />);
  });
  expect(view.root.findByType("button").props["aria-expanded"]).toBe(true);
  expect(words(view.toJSON())).toContain("web_search");
  expect(words(view.toJSON())).toContain("Running");
  expect(view.root.findByType("details").findAllByType("dd")).toHaveLength(3);
  await act(async () => {
    view.update(<ChatToolActivity rows={[row("a", "completed")]} finished />);
  });
  expect(view.root.findByType("button").props["aria-expanded"]).toBe(false);
  expect(view.root.findAllByType("li")).toHaveLength(0);
  await act(async () => {
    view.root.findByType("button").props.onClick();
  });
  expect(words(view.toJSON())).toContain("Result received");
  expect(words(view.toJSON())).toContain("1.5 s");
  await act(async () => view.unmount());
});
it("keeps failures and uncertain results visible even when the section is collapsed", async () => {
  let view;
  await act(async () => {
    view = create(
      <ChatToolActivity
        rows={[row("a", "completed"), row("b", "unconfirmed"), row("c", "not_run")]}
        finished
      />,
    );
  });
  await act(async () => {
    view.root.findByType("button").props.onClick();
  });
  expect(view.root.findAllByType("li")).toHaveLength(2);
  expect(words(view.toJSON())).toContain("Unconfirmed");
  expect(words(view.toJSON())).toContain("Not run");
  await act(async () => view.unmount());
});
it("preserves a manual collapse while more live calls arrive", async () => {
  let view;
  await act(async () => {
    view = create(<ChatToolActivity rows={[row("a", "running")]} />);
  });
  await act(async () => {
    view.root.findByType("button").props.onClick();
  });
  await act(async () => {
    view.update(<ChatToolActivity rows={[row("a", "running"), row("b", "queued")]} />);
  });
  expect(view.root.findByType("button").props["aria-expanded"]).toBe(false);
  await act(async () => view.unmount());
});

it("groups child tools and reported task steps under their parent with existing task controls", async () => {
  const openTasks = vi.fn(),
    stopTask = vi.fn();
  const parent = {
    ...row("parent", "running"),
    tool: "pc_task",
    title: "Run a PC task",
    taskId: "pc-owned-task",
    steps: [{ id: "step", kind: "tap", state: "reported", at: 1 }],
  };
  let view;
  await act(async () => {
    view = create(
      <ChatToolActivity
        rows={[parent, { ...row("child", "running"), parentId: "parent" }]}
        onOpenTasks={openTasks}
        onStopTask={stopTask}
      />,
    );
  });
  const rootList = view.root.findAllByProps({ className: "chat-tools-list" })[0];
  expect(rootList.children).toHaveLength(1);
  expect(words(view.toJSON())).toContain("Tap step");
  expect(words(view.toJSON())).toContain("Reported");
  const buttons = view.root.findAllByType("button");
  await act(async () => buttons.find((b) => words(b) === "View tasks").props.onClick());
  await act(async () => buttons.find((b) => words(b) === "Stop task").props.onClick());
  expect(openTasks).toHaveBeenCalledOnce();
  expect(stopTask).toHaveBeenCalledExactlyOnceWith("pc-owned-task");
  await act(async () => view.unmount());
});
