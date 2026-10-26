/** Conversation-level checkpoints supplement the native phone-task journal.
 * No provider payloads or credentials are persisted. Recovery never replays tools.
 */
import { makeKV, writeJson, type KV } from "./memory/store";
import { resultId, type AgentResult } from "./results";

export interface Workflow {
  version: 1;
  id: string;
  objective: string;
  state: "running" | "succeeded" | "suspended";
  updated: number;
  plan: string[];
  results: AgentResult[];
  pending: { id: string; tool: string; state: "intent_recorded" } | null;
  reason?: string;
  completion?: import("./completion").CompletionVerdict;
  metrics?: {
    started_at_ms: number;
    ended_at_ms?: number;
    elapsed_ms: number;
    model_decisions: number;
    tool_calls: number;
    unverified_results: number;
    provider_cost: null;
  };
}
const KEY = "jarvis.android.workflows.v1";
const liveWorkflows = new Set<string>();

export class WorkflowJournal {
  private kv: KV;
  constructor(
    kv?: KV,
    private live: Set<string> = kv ? new Set() : liveWorkflows,
  ) {
    this.kv = kv ?? {
      get: (key) => this.storage().get(key),
      set: (key, value) => this.storage().set(key, value),
      remove: (key) => this.storage().remove(key),
    };
  }
  private fallback = makeKV(); // non-DOM test/development only
  private storage(): KV {
    if (typeof localStorage !== "undefined") {
      // Unlike memory storage, never silently fall back when persistence is full.
      return {
        get: (k) => localStorage.getItem(k),
        set: (k, v) => localStorage.setItem(k, v),
        remove: (k) => localStorage.removeItem(k),
      };
    }
    if ("__TAURI_INTERNALS__" in globalThis)
      throw new Error("Durable workflow storage is unavailable.");
    return this.fallback;
  }
  private all(): Workflow[] {
    const raw = this.kv.get(KEY);
    if (!raw) return [];
    const records: unknown = JSON.parse(raw);
    if (
      !Array.isArray(records) ||
      records.some(
        (r) =>
          !r ||
          typeof r.id !== "string" ||
          !["running", "succeeded", "suspended"].includes(r.state) ||
          !Array.isArray(r.results),
      )
    ) {
      throw new Error("Workflow journal is invalid. Inspect stored work before continuing.");
    }
    return records as Workflow[];
  }
  save(run: Workflow): void {
    if (run.state !== "running") this.live.delete(run.id);
    run.updated = Date.now();
    const metrics = (run.metrics ??= {
      started_at_ms: run.updated,
      elapsed_ms: 0,
      model_decisions: 0,
      tool_calls: 0,
      unverified_results: 0,
      provider_cost: null,
    });
    if (run.state !== "running") metrics.ended_at_ms ??= run.updated;
    metrics.elapsed_ms = Math.max(0, (metrics.ended_at_ms ?? run.updated) - metrics.started_at_ms);
    metrics.tool_calls = run.plan.length;
    metrics.unverified_results = run.results.filter((r) => r.status === "unverified").length;
    const records = this.all().filter((r) => r.id !== run.id);
    records.push(run);
    // Preserve suspended work; prune old successful runs first.
    const kept = records.filter(
      (r) => r.state !== "succeeded" || r.updated > Date.now() - 30 * 86400000,
    );
    if (!writeJson(this.kv, KEY, kept))
      throw new Error("Workflow checkpoint could not be saved; no further action was run.");
    if (run.state === "running") this.live.add(run.id);
  }
  begin(objective: string): Workflow {
    const run: Workflow = {
      version: 1,
      id: resultId(),
      objective,
      state: "running",
      updated: Date.now(),
      plan: [],
      results: [],
      pending: null,
    };
    this.save(run);
    return run;
  }
  recover(): Workflow[] {
    const interrupted = this.all().filter((r) => r.state === "running" && !this.live.has(r.id));
    for (const run of interrupted) {
      run.state = "suspended";
      run.reason =
        "Interrupted execution. Inspect and reconcile pending work before a new attempt; never replay it.";
      this.save(run);
    }
    return interrupted;
  }
  readResult(workflowId: string, id: string): AgentResult | undefined {
    return this.all()
      .find((r) => r.id === workflowId)
      ?.results.find((r) => r.result_id === id);
  }
  listSuspended(): Workflow[] {
    return this.all().filter((r) => r.state === "suspended");
  }
}
