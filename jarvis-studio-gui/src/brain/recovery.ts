import type { Platform } from "./platform";
import { agentResult, resultId } from "./results";
import type { ToolResult } from "./types";
import { count } from "./toolMetrics";
import { WorkflowJournal, type Workflow } from "./workflow";
import { hasSideEffect } from "./tools/operations";
import { toSpec } from "./tools/registry";

/** Protect successful effects even when a continuation rewrites the arguments. */
export function continuationTools(run: Workflow, names: string[]): string[] {
  const completed = new Set((run.operations ?? []).filter((op) =>
    run.results.some((r) => r.result_id === op.resultId && r.ok)).map((op) => op.tool));
  for (const family of [["manage_schedule", "set_reminder"], ["set_timer", "set_alarm", "manage_clock"],
    ["play_media", "set_volume"], ["open_application", "open_website"]]) {
    if (family.some((name) => completed.has(name))) family.forEach((name) => completed.add(name));
  }
  const broad = ["phone_task", "pc_task", "device_control", "manage_routine", "manage_playbook"];
  const opaqueCompleted = completed.has("phone_task") || completed.has("pc_task");
  return names.filter((name) => (!run.scope?.onlyTools || run.scope.onlyTools.includes(name)) &&
    !completed.has(name) && (!completed.size || !broad.includes(name)) &&
    (!opaqueCompleted || (name !== "manage_schedule" && !hasSideEffect(toSpec(name, {})))));
}

// Compound receipts may need an in-memory composer (e.g. attach an existing calendar row).
// Across a process restart, absent composers remain uncertain rather than promoting a substep.
const resolvers = new Map<string, (id: string) => Promise<ToolResult>>();
export function registerRecovery(id: string, resolve: (id: string) => Promise<ToolResult>): void {
  resolvers.set(id, resolve);
  if (resolvers.size > 128) resolvers.delete(resolvers.keys().next().value!);
}
export interface RecoveryReport {
  workflowId: string;
  completed: string[];
  uncertain: string[];
  remaining: string[];
  canResume: boolean;
  reason: string;
  token?: string;
}
export function recoveryFacts(run: Workflow) {
  return {
    completed: [...new Set(run.results.flatMap((r) => r.ok ? [r.summary] : r.completed))],
    uncertain: [...new Set([
      ...run.results.filter((r) => r.status === "unverified").map((r) => r.summary),
      ...(run.pending && run.pending.effect !== false ? [`${run.pending.tool}: execution may have started.`] : []),
      ...(run.operations ?? []).filter((op) => !run.results.some((r) => r.result_id === op.resultId))
        .map((op) => `${op.tool}: no final receipt.`),
    ])],
    remaining: [...new Set(run.completion?.remaining.length ? run.completion.remaining :
      run.results.filter((r) => !r.ok).flatMap((r) => r.remaining.length
        ? r.remaining.map((line) => line.trim().startsWith("{") ? r.summary : line) : [r.summary]))],
  };
}

/** Checks never dispatch a new action. A short-lived token binds continuation to this snapshot. */
export class WorkflowRecovery {
  private tickets = new Map<string, { id: string; snapshot: string; expires: number }>();
  constructor(private journal: WorkflowJournal, private platform: Platform) {}
  async check(id: string): Promise<RecoveryReport> {
    let run = this.journal.list().find((r) => r.id === id);
    if (!run) throw new Error("Saved task was not found.");
    if (run.state === "running" || this.journal.isLive(id))
      return { workflowId: id, ...recoveryFacts(run), canResume: false, reason: "This task is still running." };
    for (const op of run.operations ?? []) {
      const old = run.results.find((r) => r.result_id === op.resultId);
      if (old?.status !== "unverified" || !op.nativeOutcomeId) continue;
      const resolve = resolvers.get(id);
      if (resolve) await resolve(old.result_id);
      else if (this.platform.reconcileOutcome && !["manage_schedule", "set_reminder"].includes(op.tool)) {
        const actual = await this.platform.reconcileOutcome(op.nativeOutcomeId);
        // Re-read after an asynchronous check: never overwrite a newer checkpoint.
        const latest = this.journal.list().find((r) => r.id === id)!;
        if (latest.state === "running") break;
        const index = latest.results.findIndex((r) => r.result_id === old.result_id && r.status === "unverified");
        if (index >= 0) {
          const receipt = agentResult(actual, old.remaining[0] ?? latest.objective, op.tool);
          receipt.result_id = old.result_id;
          if (receipt.status === "unverified")
            receipt.completed = [...new Set([...latest.results[index].completed, ...receipt.completed])];
          latest.results[index] = receipt;
          this.journal.save(latest);
        }
      }
    }
    run = this.journal.list().find((r) => r.id === id)!;
    count(run.metrics, "recovery_checks");
    this.journal.save(run);
    const facts = recoveryFacts(run);
    const canResume = run.state === "suspended" && !this.journal.isLive(id) && !!run.scope &&
      !facts.uncertain.length && !run.results.some((r) => r.status === "blocked");
    const reason = canResume ? "Checked saved receipts. Continue only the remaining requirements." :
      facts.uncertain.length ? "Check the uncertain actions on the executing device before continuing." :
      !run.scope ? "This older task has no saved tool limits. Start a new request after reviewing its results." :
      "This task cannot be continued from its current state.";
    const token = canResume ? resultId() : undefined;
    for (const [key, ticket] of this.tickets) if (ticket.id === id || ticket.expires < Date.now()) this.tickets.delete(key);
    if (token) this.tickets.set(token, { id, snapshot: JSON.stringify(run), expires: Date.now() + 60_000 });
    return { workflowId: id, ...facts, remaining: facts.remaining.length ? facts.remaining : [run.objective], canResume, reason, token };
  }
  claim(id: string, token: string): Workflow {
    const ticket = this.tickets.get(token);
    this.tickets.delete(token);
    const run = this.journal.list().find((r) => r.id === id);
    if (!ticket || ticket.id !== id || ticket.expires < Date.now() || !run ||
        run.state !== "suspended" || this.journal.isLive(id) || JSON.stringify(run) !== ticket.snapshot)
      throw new Error("Task state changed. Check its outcomes again before continuing.");
    run.pending = null; // Only a positively identified read-only pending step can reach here.
    run.state = "running";
    run.cancelRequested = false;
    run.reason = undefined;
    run.outcome = undefined;
    if (run.metrics) delete run.metrics.ended_at_ms;
    count(run.metrics, "resumes");
    this.journal.save(run); // Synchronous claim prevents concurrent continuations.
    return run;
  }
}
