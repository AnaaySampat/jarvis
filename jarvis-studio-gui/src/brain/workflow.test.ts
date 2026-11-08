import { describe, expect, it } from "vitest";
import type { KV } from "./memory/store";
import { WorkflowJournal, subscribeWorkflows } from "./workflow";
import { agentResult } from "./results";

function storage(): KV {
  const entries = new Map<string, string>();
  return {
    get: (k) => entries.get(k) ?? null,
    set: (k, v) => {
      entries.set(k, v);
    },
    remove: (k) => {
      entries.delete(k);
    },
  };
}

describe("workflow recovery evaluations", () => {
  it("publishes saved checkpoints and scopes STOP to the accepted workflow", () => {
    const journal = new WorkflowJournal(storage());
    let updates = 0;
    const unsubscribe = subscribeWorkflows(() => { updates++; });
    const run = journal.begin("First task");
    expect(journal.requestStop(run.id)).toBe(true);
    expect(journal.shouldStop(run.id)).toBe(true);
    // An in-flight caller still holds the old object: a later save cannot erase STOP.
    journal.save(run);
    expect(journal.list()[0].cancelRequested).toBe(true);
    run.state = "suspended";
    run.outcome = "cancelled";
    journal.save(run);
    const next = journal.begin("Next task");
    expect(journal.shouldStop(next.id)).toBe(false);
    expect(journal.requestStop(run.id)).toBe(false);
    expect(updates).toBe(5);
    unsubscribe();
  });
  it("does not suspend a live task when React recreates the brain", () => {
    const kv = storage();
    const runtime = new Set<string>();
    const journal = new WorkflowJournal(kv, runtime);
    journal.begin("Operate the phone while the PC connection changes");
    expect(new WorkflowJournal(kv, runtime).recover()).toEqual([]);
    expect(new WorkflowJournal(kv, new Set()).recover()).toHaveLength(1);
  });
  it("preserves completed research and suspends an interrupted write without replay", () => {
    const kv = storage();
    const journal = new WorkflowJournal(kv);
    const run = journal.begin("Research three laptops and save the comparison");
    const result = agentResult(
      {
        ok: true,
        summary: "Comparison",
        data: {
          findings: ["x".repeat(3000), "Final vendor source: https://vendor.example/sku-123"],
        },
      },
      "Research",
      "web_search",
    );
    run.results.push(result);
    run.pending = { id: "save-1", tool: "pc_task", state: "intent_recorded" };
    journal.save(run);
    const restarted = new WorkflowJournal(kv);
    const recovered = restarted.recover();
    expect(recovered[0]).toMatchObject({ state: "suspended", pending: { id: "save-1" } });
    expect(restarted.readResult(run.id, result.result_id)?.findings.at(-1)).toContain("sku-123");
    expect(restarted.readResult("another-workflow", result.result_id)).toBeUndefined();
    expect(restarted.recover()).toEqual([]);
  });

  it("refuses to start work when intent storage fails", () => {
    const kv = storage();
    kv.set = () => {
      throw new Error("disk full");
    };
    expect(() => new WorkflowJournal(kv).begin("Send one message")).toThrow(/checkpoint/);
  });

  it("does not overwrite unreadable pending work", () => {
    const kv = storage();
    kv.set("jarvis.android.workflows.v1", "damaged checkpoint");
    expect(() => new WorkflowJournal(kv).begin("Retry a message")).toThrow();
    expect(kv.get("jarvis.android.workflows.v1")).toBe("damaged checkpoint");
  });
  it("refuses malformed checkpoint shapes without deleting legacy data", () => {
    const kv = storage();
    const raw = JSON.stringify([{ version: 1, id: "opaque", state: "running", results: [], pending: { tool: "send_message" } }]);
    kv.set("jarvis.android.workflows.v1", raw);
    expect(() => new WorkflowJournal(kv).recover()).toThrow(/invalid/);
    expect(kv.get("jarvis.android.workflows.v1")).toBe(raw);
  });

  it("preserves an effect identity across interruption without replaying it", () => {
    const kv = storage();
    const journal = new WorkflowJournal(kv);
    const run = journal.begin("Start a timer");
    const operation = { id: `${run.id}:timer`, key: "a".repeat(64), tool: "set_timer" };
    run.operations = [operation];
    run.pending = { id: operation.id, tool: operation.tool, state: "intent_recorded" };
    journal.save(run);
    const restored = new WorkflowJournal(kv).recover()[0]!;
    expect(restored).toMatchObject({ state: "suspended", operations: [operation], pending: { id: operation.id } });
    expect(restored.results).toEqual([]);
  });
});
