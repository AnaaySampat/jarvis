/** Counters describe observed execution, never estimated provider cost or accuracy. */
export interface ToolMetrics {
  instrumentation_version?: 2;
  started_at_ms: number;
  ended_at_ms?: number;
  elapsed_ms: number;
  model_decisions: number;
  tool_calls: number;
  unverified_results: number;
  provider_cost: null;
  choosing_ms?: number;
  executing_ms?: number;
  verifying_ms?: number;
  model_requests?: number;
  fallbacks?: number;
  hedges?: number;
  proposed_calls?: number;
  invalid_calls?: number;
  scope_rejections?: number;
  duplicates_prevented?: number;
  parallel_reads?: number;
  budget_extensions?: number;
  direct_turns?: number;
  recovery_checks?: number;
  resumes?: number;
}
export type Counter = Exclude<keyof ToolMetrics,
  "instrumentation_version" | "started_at_ms" | "ended_at_ms" | "elapsed_ms" |
  "tool_calls" | "unverified_results" | "provider_cost">;
export function count(metrics: ToolMetrics | undefined, key: Counter, amount = 1): void {
  if (metrics?.instrumentation_version === 2) metrics[key] = (metrics[key] ?? 0) + amount;
}
export function newMetrics(): ToolMetrics {
  return { instrumentation_version: 2, started_at_ms: Date.now(), elapsed_ms: 0,
    model_decisions: 0, tool_calls: 0, unverified_results: 0, provider_cost: null,
    choosing_ms: 0, executing_ms: 0, verifying_ms: 0, model_requests: 0, fallbacks: 0,
    hedges: 0, proposed_calls: 0, invalid_calls: 0, scope_rejections: 0,
    duplicates_prevented: 0, parallel_reads: 0, budget_extensions: 0,
    direct_turns: 0, recovery_checks: 0, resumes: 0 };
}

export const DIAGNOSTIC_METRICS = [
  "instrumentation_version", "choosing_ms", "executing_ms", "verifying_ms", "model_requests",
  "fallbacks", "hedges", "proposed_calls", "invalid_calls", "scope_rejections",
  "duplicates_prevented", "parallel_reads", "budget_extensions", "direct_turns", "recovery_checks", "resumes",
] as const;

export function toolPerformance(tasks: Array<{ source?: string; hasWork?: boolean; status?: string; metrics?: ToolMetrics }>) {
  const measured = tasks.filter((task) => task.source === "workflow" && task.hasWork &&
    task.metrics?.instrumentation_version === 2 && !["running", "cancelling"].includes(task.status ?? ""));
  const sum = (key: keyof ToolMetrics) => measured.reduce((total, task) => total + Number(task.metrics?.[key] ?? 0), 0);
  return { tasks: measured.length, verified: measured.filter((t) => t.status === "succeeded").length,
    choosing_ms: sum("choosing_ms"), executing_ms: sum("executing_ms"), verifying_ms: sum("verifying_ms"),
    proposed: sum("proposed_calls"), invalid: sum("invalid_calls"), duplicates: sum("duplicates_prevented"),
    requests: sum("model_requests"), fallbacks: sum("fallbacks"), hedges: sum("hedges") };
}
