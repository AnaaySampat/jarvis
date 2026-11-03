import type { Workflow } from "../brain/workflow";

export type TaskDisplayState =
  "queued" | "running" | "needs_you" | "completed" | "partial" | "failed" | "cancelled";
export const TASK_LABELS: Record<TaskDisplayState, string> = {
  queued: "Queued",
  running: "Running",
  needs_you: "Needs you",
  completed: "Completed",
  partial: "Partially completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function taskDisplayState(task: {
  status?: string;
  displayState?: TaskDisplayState;
}): TaskDisplayState {
  if (task.displayState) return task.displayState;
  const state = task.status ?? "";
  if (["queued", "accepted"].includes(state)) return "queued";
  if (["succeeded", "done", "completed"].includes(state)) return "completed";
  if (["partial", "partially_completed"].includes(state)) return "partial";
  if (["failed"].includes(state)) return "failed";
  if (["cancelled", "stopped"].includes(state)) return "cancelled";
  if (
    [
      "needs_you",
      "suspended",
      "recovering",
      "blocked",
      "unverified",
      "waiting_for_unlock",
      "waiting_for_approval",
    ].includes(state)
  )
    return "needs_you";
  return ["planning", "policy_check", "executing", "verifying", "running", "cancelling"].includes(
    state,
  )
    ? "running"
    : "needs_you";
}

export function workflowTask(run: Workflow) {
  const completed = run.results.filter((r) => r.ok).map((r) => r.summary);
  const remaining = [
    ...new Set([
      ...(run.completion?.remaining ?? []),
      ...run.results.filter((r) => !r.ok).map((r) => r.summary),
      ...(run.pending
        ? ["Check the recorded action with its executing device before another attempt."]
        : []),
    ]),
  ];
  let status: string = run.state;
  if (run.state === "running") status = run.cancelRequested ? "cancelling" : "running";
  else if (run.pending) status = "suspended";
  else if (run.outcome === "cancelled") status = "cancelled";
  else if (run.state === "succeeded") status = "succeeded";
  else if (completed.length && (remaining.length || run.outcome === "partial")) status = "partial";
  else if (run.outcome === "failed") status = "failed";
  else status = "suspended";
  const delegated = run.plan.includes("pc_task");
  return {
    id: `workflow:${run.id}`,
    workflowId: run.id,
    source: "workflow",
    kind: "workflow",
    goal: run.objective,
    status,
    state: status,
    updatedAt: run.updated,
    deviceLabel: delegated ? "This phone · Windows steps" : "On this phone",
    completed,
    remaining,
    items: run.results.map((r) => ({
      kind: "step",
      line: r.summary,
      ok: r.ok,
      receiptKey: r.result_id,
    })),
    summary: run.reason || run.completion?.completed.join("; ") || "",
    recoveryInfo:
      status === "suspended" || status === "partial"
        ? "Review the saved results and check pending actions. No step is automatically repeated."
        : "",
    metrics: run.metrics,
  };
}
