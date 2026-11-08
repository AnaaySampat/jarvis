import { describe, expect, it, vi } from "vitest";
import { WorkflowRecovery, recoveryFacts, continuationTools } from "./recovery";
import { WorkflowJournal } from "./workflow";
import { agentResult } from "./results";
import type { Platform } from "./platform";

function fixture() {
  const values = new Map<string, string>();
  const journal = new WorkflowJournal({ get: (k) => values.get(k) ?? null,
    set: (k, v) => { values.set(k, v); }, remove: (k) => { values.delete(k); } });
  const run = journal.begin("Read sources and set volume");
  run.scope = { onlyTools: ["web_search", "set_volume"], informationOnly: false };
  run.state = "suspended";
  run.results.push(agentResult({ ok: true, summary: "Sources read" }, "Read sources", "web_search"));
  journal.save(run);
  const reconcileOutcome = vi.fn(async () => ({ ok: true, summary: "Volume confirmed" }));
  return { journal, run, reconcileOutcome,
    recovery: new WorkflowRecovery(journal, { reconcileOutcome } as unknown as Platform) };
}
describe("checked workflow continuation", () => {
  it("preserves original scope and completed receipts, and claims a token once", async () => {
    const { recovery, run } = fixture();
    const checked = await recovery.check(run.id);
    expect(checked).toMatchObject({ canResume: true, completed: ["Sources read"] });
    const resumed = recovery.claim(run.id, checked.token!);
    expect(resumed.scope).toEqual(run.scope);
    expect(resumed.results).toHaveLength(1);
    expect(resumed.state).toBe("running");
    expect(() => recovery.claim(run.id, checked.token!)).toThrow(/Check.*again/i);
    expect((await recovery.check(run.id)).canResume).toBe(false);
  });
  it("blocks stale snapshots and expired tickets", async () => {
    const { recovery, run, journal } = fixture();
    const checked = await recovery.check(run.id);
    run.reason = "changed";
    journal.save(run);
    expect(() => recovery.claim(run.id, checked.token!)).toThrow(/state changed/);
    const fresh = await recovery.check(run.id);
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61_000);
    try { expect(() => recovery.claim(run.id, fresh.token!)).toThrow(/state changed/); }
    finally { clock.mockRestore(); }
  });
  it("refuses legacy authority, pending effects, and effects without receipts", async () => {
    const { recovery, run, journal } = fixture();
    delete run.scope;
    journal.save(run);
    expect((await recovery.check(run.id)).canResume).toBe(false);
    run.scope = { onlyTools: null, informationOnly: false };
    run.pending = { id: "intent", tool: "send_message", state: "intent_recorded", effect: true };
    journal.save(run);
    expect(await recovery.check(run.id)).toMatchObject({ canResume: false, uncertain: [expect.stringMatching(/may have started/)] });
    run.pending = null;
    run.operations = [{ id: "op", key: "a".repeat(64), tool: "send_message" }];
    journal.save(run);
    expect((await recovery.check(run.id)).canResume).toBe(false);
    run.operations[0].resultId = "missing-receipt";
    journal.save(run);
    expect((await recovery.check(run.id)).canResume).toBe(false);
  });
  it("can safely repeat an interrupted read, but never guesses whether a legacy intent was a read", async () => {
    const { recovery, run, journal } = fixture();
    run.pending = { id: "read", tool: "web_search", state: "intent_recorded", effect: false };
    journal.save(run);
    const checked = await recovery.check(run.id);
    expect(checked.canResume).toBe(true);
    expect(recovery.claim(run.id, checked.token!).pending).toBeNull();
    run.pending = { id: "legacy", tool: "web_search", state: "intent_recorded" };
    run.state = "suspended";
    journal.save(run);
    expect((await recovery.check(run.id)).canResume).toBe(false);
  });
  it("checks a native receipt without dispatching or adding a second action", async () => {
    const { recovery, run, journal, reconcileOutcome } = fixture();
    const result = agentResult({ ok: false, summary: "Unknown", error: "native_outcome_unknown" }, "Set volume");
    run.results.push(result);
    run.operations = [{ id: "op", key: "a".repeat(64), tool: "set_volume", resultId: result.result_id, nativeOutcomeId: "receipt" }];
    journal.save(run);
    expect((await recovery.check(run.id)).canResume).toBe(true);
    expect(reconcileOutcome).toHaveBeenCalledExactlyOnceWith("receipt");
    expect(journal.list()[0].results[1]).toMatchObject({ result_id: result.result_id, status: "succeeded" });
    expect(journal.list()[0].operations).toHaveLength(1);
  });
  it("keeps compound outcomes uncertain when the composing process is gone", async () => {
    const { recovery, run, journal, reconcileOutcome } = fixture();
    const result = agentResult({ ok: false, summary: "Calendar uncertain", error: "native_outcome_unknown" }, "Save reminder");
    run.results.push(result);
    run.operations = [{ id: "op", key: "a".repeat(64), tool: "set_reminder", resultId: result.result_id, nativeOutcomeId: "receipt" }];
    journal.save(run);
    expect((await recovery.check(run.id)).canResume).toBe(false);
    expect(reconcileOutcome).not.toHaveBeenCalled();
  });
  it("shows proven partial work separately from uncertain work", () => {
    const { run } = fixture();
    const result = agentResult({ ok: false, summary: "Calendar unconfirmed", error: "native_outcome_unknown",
      data: { completed: ["Reminder stored locally"], remaining: ["Check Calendar"] } });
    run.results.push(result);
    expect(recoveryFacts(run)).toMatchObject({ completed: ["Sources read", "Reminder stored locally"],
      uncertain: ["Calendar unconfirmed"], remaining: ["Check Calendar"] });
  });
  it("withholds completed action families and broad alternate executors while preserving the original scope", () => {
    const { run } = fixture();
    run.scope = { onlyTools: ["get_time", "set_volume", "set_timer", "phone_task", "device_control"], informationOnly: false };
    const result = agentResult({ ok: true, summary: "Volume set" }, "Set volume", "set_volume");
    run.results.push(result);
    run.operations = [{ id: "op", key: "a".repeat(64), tool: "set_volume", resultId: result.result_id }];
    expect(continuationTools(run, ["get_time", "set_volume", "play_media", "set_timer", "phone_task", "device_control", "send_message"]))
      .toEqual(["get_time", "set_timer"]);
    run.scope.onlyTools = null;
    run.operations[0].tool = "pc_task";
    expect(continuationTools(run, ["get_time", "set_timer", "manage_schedule", "phone_task", "pc_task"]))
      .toEqual(["get_time"]);
  });
});
