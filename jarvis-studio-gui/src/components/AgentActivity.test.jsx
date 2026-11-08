import { act, create } from "react-test-renderer";
import { expect, it, vi } from "vitest";
import AgentActivity from "./AgentActivity";
vi.mock("./ModalPanel", () => ({ default: ({ children }) => <section>{children}</section> }));
const words = (node) => typeof node === "string" ? node : (node.children || []).map(words).join("");
const button = (view, label) => view.root.findAllByType("button").find((b) => words(b) === label);
const task = { id: "workflow:w", workflowId: "w", source: "workflow", kind: "workflow", goal: "Research and save",
  status: "suspended", canCheck: true, completed: ["Research finished"], uncertain: ["Calendar unconfirmed"], remaining: ["Check calendar"] };
it("shows recovery facts and enables continuation only after the backend permits it", async () => {
  const onCheckWorkflow = vi.fn().mockResolvedValueOnce({ canResume: false, reason: "Still uncertain" })
    .mockResolvedValueOnce({ canResume: true, token: "checked-ticket", reason: "Checked" });
  const onResumeWorkflow = vi.fn().mockResolvedValue("Remaining work completed");
  let view;
  await act(async () => { view = create(<AgentActivity tasks={[task]} onCheckWorkflow={onCheckWorkflow} onResumeWorkflow={onResumeWorkflow} />); });
  expect(words(view.toJSON())).toContain("Calendar unconfirmed");
  expect(button(view, "Continue remaining work")).toBeUndefined();
  await act(async () => { await button(view, "Check outcomes").props.onClick(); });
  expect(button(view, "Continue remaining work")).toBeUndefined();
  await act(async () => { await button(view, "Check outcomes").props.onClick(); });
  await act(async () => { await button(view, "Continue remaining work").props.onClick(); });
  expect(onResumeWorkflow).toHaveBeenCalledExactlyOnceWith(task, "checked-ticket");
  expect(words(view.toJSON())).toContain("Remaining work completed");
  expect(button(view, "Continue remaining work")).toBeUndefined();
  await act(async () => view.unmount());
});
it("displays changed-state failures and removes the consumed continuation ticket", async () => {
  const onCheckWorkflow = vi.fn().mockResolvedValue({ canResume: true, token: "ticket", reason: "Checked" });
  const onResumeWorkflow = vi.fn().mockRejectedValue(new Error("Task state changed. Check again."));
  let view;
  await act(async () => { view = create(<AgentActivity tasks={[task]} onCheckWorkflow={onCheckWorkflow} onResumeWorkflow={onResumeWorkflow} />); });
  await act(async () => { await button(view, "Check outcomes").props.onClick(); });
  await act(async () => { await button(view, "Continue remaining work").props.onClick(); });
  expect(words(view.toJSON())).toContain("Task state changed");
  expect(button(view, "Continue remaining work")).toBeUndefined();
  await act(async () => view.unmount());
});
