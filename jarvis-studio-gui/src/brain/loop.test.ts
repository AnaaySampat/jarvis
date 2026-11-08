import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LLMReply } from "./providers";

const replies: LLMReply[] = [];
const seen: string[][] = [];
const seenTools: string[][] = [];
let onReply: (() => void) | undefined;
vi.mock("./ask", () => ({
  chatOverLadder: async (convo: Array<{ content: string }>, tools?: Array<{ name: string }>) => {
    seen.push(convo.map((m) => m.content));
    seenTools.push((tools ?? []).map((t) => t.name));
    onReply?.();
    return replies.shift() ?? { text: "(script exhausted)", toolCalls: [] };
  },
}));
const dispatched: string[] = [];
const operationIds: Array<string | undefined> = [];
const results: ToolResult[] = [];
let dispatchHook: ((spec: { type: string }) => Promise<ToolResult>) | undefined;
vi.mock("./tools/dispatch", () => ({
  dispatch: async (
    spec: { type: string; result_id?: string },
    deps?: { operationId?: string; reconcileActionOutcome?: (id: string) => Promise<ToolResult> },
  ) => {
    dispatched.push(spec.type);
    operationIds.push(deps?.operationId);
    if (dispatchHook) return dispatchHook(spec);
    if (spec.type === "check_action_outcome") return deps!.reconcileActionOutcome!(spec.result_id!);
    return (
      results.shift() ?? {
        ok: true,
        summary: "Found it: 55.2 GB used.",
        data: { verificationReceipt: `aura.verify.v1:model:${"a".repeat(64)}` },
      }
    );
  },
}));

import {
  answeredPhoneWithoutLooking,
  answeredTvWithoutLooking,
  claimedWithoutActing,
  runTurn,
} from "./loop";
import type { DispatchDeps } from "./tools/dispatch";
import { toolPalette, turnPalette } from "./tools/registry";
import type { ToolResult } from "./types";
import { WorkflowJournal } from "./workflow";

const full = toolPalette(
  { tier: "gemini", model: "m", keys: { gemini: ["k"] } },
  { pcPaired: true, tvPaired: true },
);
const deps = {
  config: {},
  verifyCompletion: async () => ({
    status: "succeeded",
    completed: ["Scripted objective completed"],
    remaining: [],
  }),
} as unknown as DispatchDeps;
const ask = (text: string) => runTurn([{ role: "user", content: text }], full, deps);

beforeEach(() => {
  replies.length = 0;
  seen.length = 0;
  seenTools.length = 0;
  dispatched.length = 0;
  operationIds.length = 0;
  results.length = 0;
  onReply = undefined;
  dispatchHook = undefined;
});

it("shows rejected model calls as not run, tolerates malformed arguments and hides their payloads", async () => {
  const onToolActivity = vi.fn();
  replies.push({ text: "", toolCalls: [{ id: "bad", name: "set_volume", args: { level: 101, secret: "SECRET" } },
    { id: "null", name: "get_time", args: null as unknown as Record<string, unknown> }] },
    { text: "The calls could not run.", toolCalls: [] });
  await runTurn([{ role: "user", content: "Set volume" }], full, { ...deps, onToolActivity });
  expect(dispatched).toHaveLength(0);
  expect(onToolActivity.mock.calls.map(([event]) => event.state)).toEqual(["queued", "not_run", "queued", "not_run"]);
  expect(JSON.stringify(onToolActivity.mock.calls)).not.toContain("SECRET");
});

describe("bounded orchestration", () => {
  const call = (name: string, args: Record<string, unknown>, id = name) => ({ id, name, args });
  it("extends for new progress, then stops at the adaptive hard limit", async () => {
    const journal = new WorkflowJournal();
    for (let i = 0; i < 8; i++) replies.push({ text: "", toolCalls: [call("web_search", { query: `source ${i}` })] });
    await runTurn([{ role: "user", content: "Research sources" }], full, { ...deps, journal });
    expect(dispatched).toHaveLength(6);
    expect(journal.list()[0].metrics).toMatchObject({ budget_extensions: 3, proposed_calls: 6 });
  });
  it("bounds a large single reply before running excess actions", async () => {
    const journal = new WorkflowJournal();
    replies.push({ text: "", toolCalls: Array.from({ length: 30 }, (_, i) => call("web_search", { query: `q${i}` }, `${i}`)) });
    await runTurn([{ role: "user", content: "Research" }], full, { ...deps, journal });
    expect(dispatched).toHaveLength(24);
    expect(journal.list()[0].state).toBe("suspended");
    expect(journal.list()[0].results).toHaveLength(24);
  });
  it("overlaps reads, keeps writes as barriers, and commits each receipt once in model order", async () => {
    const journal = new WorkflowJournal();
    let active = 0;
    let maxActive = 0;
    let finishFirst!: () => void;
    const first = new Promise<void>((resolve) => { finishFirst = resolve; });
    const order: string[] = [];
    dispatchHook = async (spec) => {
      active++;
      maxActive = Math.max(maxActive, active);
      order.push(spec.type);
      if (spec.type === "time") await first;
      if (spec.type === "day") finishFirst();
      if (spec.type === "set_volume") expect(active).toBe(1);
      active--;
      return { ok: true, summary: `${spec.type} returned` };
    };
    replies.push({ text: "", toolCalls: [call("get_time", {}), call("get_day", {}), call("set_volume", { level: 40 })] },
      { text: "Done", toolCalls: [] });
    const output = await runTurn([{ role: "user", content: "Check time, date and set volume" }], full, { ...deps, journal });
    expect(maxActive).toBe(2);
    expect(order).toEqual(["time", "day", "set_volume"]);
    expect(output.toolResults).toHaveLength(3);
    const saved = journal.list()[0];
    expect(saved.results.map((r) => r.result_id)).toEqual(output.toolResults.map((r) => r.result!.result_id));
    expect(saved.metrics).toMatchObject({ parallel_reads: 2, tool_calls: 3 });
    expect(saved.operations).toHaveLength(1);
  });
  it("preserves all started read receipts after STOP and never starts the queued write", async () => {
    const journal = new WorkflowJournal();
    let stop = false;
    dispatchHook = async () => { stop = true; return { ok: true, summary: "read completed" }; };
    replies.push({ text: "", toolCalls: [call("get_time", {}), call("get_day", {}), call("set_volume", { level: 40 })] });
    await runTurn([{ role: "user", content: "Read then set volume" }], full, { ...deps, journal, shouldStopPhoneTask: () => stop });
    expect(dispatched).toEqual(["time", "day"]);
    expect(journal.list()[0].results).toHaveLength(2);
    expect(journal.list()[0].outcome).toBe("cancelled");
  });
  it("does not allow saved work to change anything before a fresh observation", async () => {
    const journal = new WorkflowJournal();
    const run = journal.begin("Set volume to 40");
    run.scope = { onlyTools: ["get_time", "set_volume"], informationOnly: false };
    replies.push({ text: "", toolCalls: [call("set_volume", { level: 40 })] },
      { text: "", toolCalls: [call("get_time", {})] },
      { text: "", toolCalls: [call("set_volume", { level: 40 })] }, { text: "Done", toolCalls: [] });
    await runTurn([{ role: "user", content: run.objective }], full, { ...deps, journal, resumeRun: run });
    expect(dispatched).toEqual(["time", "set_volume"]);
    expect(journal.list()).toHaveLength(1);
  });
});

describe("validated and deduplicated execution", () => {
  const call = (id: string, name: string, args: Record<string, unknown>) => ({ id, name, args });
  const answer = { text: "Done.", toolCalls: [] };

  it("reconciles a late successful native reply into its original receipt without sending twice", async () => {
    const journal = new WorkflowJournal();
    const reconcileOutcome = vi.fn(async () => ({ ok: true, summary: "Message sent." }));
    results.push({
      ok: false,
      error: "native_outcome_unknown",
      summary: "Awaiting native receipt.",
      nativeOutcomeId: "native-receipt-1",
    });
    const send = call("send", "send_message", { to: "Mom", text: "hi" });
    replies.push(
      { text: "", toolCalls: [send] },
      { text: "", toolCalls: [call("check", "check_action_outcome", { result_id: "pending" })] },
      { text: "", toolCalls: [{ ...send, id: "repeat" }] },
      answer,
    );
    let originalId: string | undefined;
    onReply = () => {
      originalId ??= journal.list()[0]?.results[0]?.result_id;
      if (replies[0]?.toolCalls[0]?.name === "check_action_outcome")
        replies[0].toolCalls[0].args.result_id = originalId;
    };
    const out = await runTurn([{ role: "user", content: "Message Mom hi" }], full, {
      ...deps,
      journal,
      platform: { reconcileOutcome } as unknown as DispatchDeps["platform"],
    });
    expect(dispatched).toEqual(["message", "check_action_outcome"]);
    expect(reconcileOutcome).toHaveBeenCalledWith("native-receipt-1");
    expect(out.status).toBe("succeeded");
    expect(out.toolResults[0]).toMatchObject({ ok: true, summary: "Message sent." });
    expect(journal.list()[0]!.results[0]).toMatchObject({
      result_id: originalId,
      status: "succeeded",
    });
    expect(journal.list()[0]!.operations).toHaveLength(1);
  });

  it("updates saved action evidence when its native reply arrives after the chat turn", async () => {
    const journal = new WorkflowJournal();
    let arrived: (() => void) | undefined;
    const reconcileOutcome = vi.fn(async () => ({ ok: true, summary: "Message sent later." }));
    const watchOutcome = vi.fn((_id: string, listener: () => void) => {
      arrived = listener;
      return () => {};
    });
    results.push({
      ok: false,
      error: "native_outcome_unknown",
      summary: "Awaiting reply.",
      nativeOutcomeId: "late-1",
    });
    replies.push(
      { text: "", toolCalls: [call("send", "send_message", { to: "Mom", text: "hi" })] },
      answer,
    );
    const out = await runTurn([{ role: "user", content: "Message Mom hi" }], full, {
      ...deps,
      journal,
      platform: { reconcileOutcome, watchOutcome } as unknown as DispatchDeps["platform"],
    });
    expect(out.status).toBe("unverified");
    const decisions = seen.length;
    arrived!();
    await vi.waitFor(() => expect(journal.list()[0]!.results[0]!.status).toBe("succeeded"));
    expect(journal.list()[0]!.outcome).toBe("unverified"); // overall objective has not been re-reviewed
    expect(out.toolResults[0]!.summary).toBe("Message sent later.");
    expect(dispatched).toEqual(["message"]);
    expect(seen.length).toBe(decisions); // no background model call
  });

  it("keeps changes blocked when reconciliation is still unknown", async () => {
    const journal = new WorkflowJournal();
    const reconcileOutcome = vi.fn(async () => ({
      ok: false,
      error: "native_outcome_unknown",
      summary: "Still awaiting the original reply.",
    }));
    results.push({
      ok: false,
      error: "native_outcome_unknown",
      summary: "Unknown",
      nativeOutcomeId: "native-1",
    });
    replies.push(
      { text: "", toolCalls: [call("a", "set_volume", { level: 40 })] },
      { text: "", toolCalls: [call("b", "check_action_outcome", { result_id: "pending" })] },
      { text: "", toolCalls: [call("c", "set_volume", { level: 60 })] },
      answer,
    );
    onReply = () => {
      if (replies[0]?.toolCalls[0]?.name === "check_action_outcome")
        replies[0].toolCalls[0].args.result_id = journal.list()[0]!.results[0]!.result_id;
    };
    const out = await runTurn([{ role: "user", content: "Set volume to forty" }], full, {
      ...deps,
      journal,
      platform: { reconcileOutcome } as unknown as DispatchDeps["platform"],
    });
    expect(dispatched).toEqual(["set_volume", "check_action_outcome"]);
    expect(out.status).toBe("unverified");
  });

  it("does not inspect a receipt outside the current workflow", async () => {
    const reconcileOutcome = vi.fn();
    replies.push(
      { text: "", toolCalls: [call("x", "check_action_outcome", { result_id: "foreign-result" })] },
      answer,
    );
    await runTurn([{ role: "user", content: "Check the action outcome" }], full, {
      ...deps,
      platform: { reconcileOutcome } as unknown as DispatchDeps["platform"],
    });
    expect(reconcileOutcome).not.toHaveBeenCalled();
  });

  it("does not execute an effect if its operation intent cannot be persisted", async () => {
    const entries = new Map<string, string>();
    let writes = 0;
    const journal = new WorkflowJournal({
      get: (key) => entries.get(key) ?? null,
      set: (key, value) => {
        if (++writes > 1) throw new Error("storage full");
        entries.set(key, value);
      },
      remove: (key) => {
        entries.delete(key);
      },
    });
    replies.push({ text: "", toolCalls: [call("x", "send_message", { to: "Mom", text: "hi" })] });
    await expect(
      runTurn([{ role: "user", content: "Send Mom hi" }], full, { ...deps, journal }),
    ).rejects.toThrow(/checkpoint/);
    expect(dispatched).toEqual([]);
  });

  it("leaves objective completion unverified when no checker is configured", async () => {
    results.push({ ok: true, summary: "Opened Clock." });
    replies.push(
      { text: "", toolCalls: [call("x", "open_application", { name: "Clock" })] },
      { text: "Alarm saved.", toolCalls: [] },
    );
    const out = await runTurn([{ role: "user", content: "Set an alarm for seven" }], full, {
      config: {},
    } as unknown as DispatchDeps);
    expect(out.status).toBe("unverified");
    expect(out.reply).not.toContain("Alarm saved.");
  });

  it("sends an identical message only once, even with reordered arguments and different call IDs", async () => {
    const journal = new WorkflowJournal();
    results.push({ ok: true, summary: "Message sent." });
    replies.push(
      {
        text: "",
        toolCalls: [
          call("a", "send_message", { to: "Mom", text: "hi" }),
          call("b", "send_message", { app: "whatsapp", text: "hi", to: " Mom " }),
        ],
      },
      answer,
    );
    const out = await runTurn([{ role: "user", content: "Message Mom hi" }], full, {
      ...deps,
      journal,
    });
    expect(dispatched).toEqual(["message"]);
    expect(out.toolResults).toHaveLength(1);
    const saved = journal.list()[0]!;
    expect(saved.operations).toHaveLength(1);
    expect(saved.operations![0]!.resultId).toBe(saved.results[0]!.result_id);
    expect(operationIds[0]).toBe(saved.operations![0]!.id);
    expect(saved.operations![0]!.key).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(saved.operations)).not.toContain("Mom");
    expect(seen[1]!.join(" ")).toContain("no additional action ran");
  });

  it("blocks a repeated alarm across rounds and an intervening read", async () => {
    replies.push(
      { text: "", toolCalls: [call("a", "set_alarm", { hour: 7, minute: 0 })] },
      {
        text: "",
        toolCalls: [call("b", "get_time", {}), call("c", "set_alarm", { minute: 0, hour: 7 })],
      },
      answer,
    );
    await ask("Set an alarm at seven");
    expect(dispatched).toEqual(["clock", "time"]);
  });

  it("does not retry an effect with an unknown outcome, but permits a fresh user request", async () => {
    results.push({ ok: false, summary: "Native response lost.", error: "plugin_error" });
    const timer = call("a", "set_timer", { seconds: 60 });
    replies.push(
      { text: "", toolCalls: [timer] },
      { text: "", toolCalls: [{ ...timer, id: "b" }] },
      answer,
    );
    await ask("Start a one minute timer");
    expect(dispatched).toEqual(["clock"]);
    expect(seen[2]!.join(" ")).toContain("may already have taken effect");
    replies.push({ text: "", toolCalls: [timer] }, answer);
    await ask("I checked. Start a new one minute timer");
    expect(dispatched).toEqual(["clock", "clock"]);
    expect(operationIds[0]).not.toBe(operationIds[1]);
  });

  it("allows fresh reads and restoring an absolute state after another mutation", async () => {
    replies.push(
      {
        text: "",
        toolCalls: [
          call("a", "set_volume", { level: 20 }),
          call("b", "get_time", {}),
          call("c", "set_volume", { level: 30 }),
          call("d", "get_time", {}),
          call("e", "set_volume", { level: 20 }),
        ],
      },
      answer,
    );
    await ask("Change the volume and restore it");
    expect(dispatched).toEqual(["set_volume", "time", "set_volume", "time", "set_volume"]);
    expect(new Set(operationIds.filter(Boolean)).size).toBe(3);
  });

  it("cannot retry an unconfirmed alarm through phone_task, but can still read", async () => {
    results.push({
      ok: true,
      summary: "Alarm request sent; check Clock.",
      verification: {
        status: "unverified",
        method: "android_clock_intent_accepted",
        expected: { hour: 7, minute: 0 },
      },
    });
    replies.push(
      { text: "", toolCalls: [call("a", "set_alarm", { hour: 7, minute: 0 })] },
      {
        text: "",
        toolCalls: [
          call("b", "phone_task", { goal: "Set the seven o'clock alarm" }),
          call("c", "get_time", {}),
        ],
      },
      { text: "Please check Clock.", toolCalls: [] },
    );
    const out = await ask("Set an alarm for seven");
    expect(dispatched).toEqual(["clock", "time"]);
    expect(seen[2]!.join(" ")).toContain("Do not retry it through another tool");
    expect(out.status).toBe("unverified");
  });

  it("rejects malformed or injected calls before any dispatch and lets the model correct them", async () => {
    replies.push(
      {
        text: "",
        toolCalls: [
          call("x", "made_up", { type: "message", to: "Mom", text: "hi" }),
          call("y", "set_timer", { seconds: "60" }),
          { ...call("z", "get_time", {}), argumentError: "Invalid JSON" },
        ],
      },
      { text: "", toolCalls: [call("valid", "set_timer", { seconds: 60 })] },
      answer,
    );
    await ask("Start a one minute timer");
    expect(dispatched).toEqual(["clock"]);
    expect(seen[1]!.filter((s) => s.includes("Not run:")).length).toBe(3);
  });

  it("cannot report success when every requested call was invalid", async () => {
    replies.push(
      { text: "", toolCalls: [call("x", "set_alarm", { hour: 25, minute: 0 })] },
      answer,
    );
    const out = await ask("Set an alarm");
    expect(dispatched).toEqual([]);
    expect(out.status).toBe("unverified");
    expect(out.reply).toContain("Not run:");
  });

  it("reviews a simple wrong-tool success against the actual objective", async () => {
    results.push({ ok: true, summary: "Opened Clock." });
    replies.push(
      { text: "", toolCalls: [call("x", "open_application", { name: "Clock" })] },
      { text: "Alarm set for seven.", toolCalls: [] },
    );
    const verifyCompletion = vi.fn(async () => ({
      status: "partial" as const,
      completed: ["Opened Clock"],
      remaining: ["Create a seven o'clock alarm"],
    }));
    const out = await runTurn([{ role: "user", content: "Set an alarm for seven" }], full, {
      ...deps,
      verifyCompletion,
    });
    expect(verifyCompletion).toHaveBeenCalledOnce();
    expect(out.status).toBe("partial");
    expect(out.reply).toContain("Still unconfirmed");
    expect(out.reply).not.toContain("Alarm set for seven");
  });
});

describe("runTurn — a phone task that acted and failed is not re-run", () => {
  const task = (id: string, goal: string) => ({
    text: "",
    toolCalls: [{ id, name: "phone_task", args: { goal } }],
  });
  const stopped = (acted: boolean): ToolResult => ({
    ok: false,
    summary: "Nothing on screen is changing, sir — I've stopped.",
    error: "incomplete",
    data: { findings: [], verificationReceipt: "", acted },
  });

  it("refuses a reworded retry in the same turn", async () => {
    // Live 2026-10-19: 4 shutter taps, ok=false, then a reworded task took 4 more photos.
    results.push(stopped(true));
    replies.push(
      task("c1", "click a photo"),
      task("c2", "open the Camera app and press the shutter button once"),
      {
        text: "I tapped the shutter but couldn't confirm a photo was saved — please check.",
        toolCalls: [],
      },
    );
    const out = await ask("click a photo");
    expect(dispatched).toEqual(["phone_task"]);
    expect(out.toolResults).toHaveLength(1);
    expect(seen[2]!.at(-1)).toMatch(/^\{"ok":false,"summary":"Not run\./);
    expect(out.reply).toBe(stopped(true).summary);
  });

  it("still retries one that failed before touching anything", async () => {
    results.push(stopped(false));
    replies.push(task("c1", "click a photo"), task("c2", "open Camera, take a photo"), {
      text: "Done.",
      toolCalls: [],
    });
    await ask("click a photo");
    expect(dispatched).toEqual(["phone_task", "phone_task"]);
  });
});

describe("runTurn — a successful whole phone task is not handed off again", () => {
  const task = (id: string, goal: string) => ({
    text: "", toolCalls: [{ id, name: "phone_task", args: { goal } }],
  });

  it("retains the first receipt and refuses a reworded lookup in a later round", async () => {
    results.push({ ok: true, summary: "IMEI 1: 111111111111111; IMEI 2: 222222222222222.",
      data: { verificationReceipt: `aura.verify.v1:model:${"a".repeat(64)}` } });
    replies.push(task("first", "Find the IMEI in Settings"),
      task("second", "Open About phone and read the IMEI number"),
      { text: "The saved result contains the answer.", toolCalls: [] });
    const out = await ask("Check my phone's IMEI number");
    expect(dispatched).toEqual(["phone_task"]);
    expect(out.toolResults).toHaveLength(1);
    expect(seen[2]!.at(-1)).toContain("Not run. The whole phone task already completed");
    expect(seen[2]!.at(-1)).toContain("Existing result: IMEI 1: 111111111111111; IMEI 2: 222222222222222.");
  });

  it("also refuses a second handoff in the same batch, but allows a fresh request", async () => {
    const first = task("first", "Find the IMEI");
    replies.push({ text: "", toolCalls: [...first.toolCalls,
      ...task("second", "Read the IMEI in About phone").toolCalls] },
      { text: "Here is the answer.", toolCalls: [] });
    await ask("Check my IMEI");
    expect(dispatched).toEqual(["phone_task"]);
    replies.push(task("fresh", "Read my Android version"), { text: "Android 16.", toolCalls: [] });
    await ask("Now check my Android version");
    expect(dispatched).toEqual(["phone_task", "phone_task"]);
  });
});

describe("runTurn — STOP", () => {
  it("does not dispatch a model reply that arrived after STOP and does not cancel the next turn", async () => {
    const journal = new WorkflowJournal();
    const call = { text: "", toolCalls: [{ id: "one", name: "set_timer", args: { seconds: 1 } }] };
    replies.push(call);
    onReply = () => {
      const current = journal.list().find((run) => run.state === "running");
      expect(current).toBeDefined();
      journal.requestStop(current!.id);
    };
    await runTurn([{ role: "user", content: "First timer" }], full, { ...deps, journal });
    expect(dispatched).toEqual([]);
    onReply = undefined;
    replies.push(call, { text: "Timer set", toolCalls: [] });
    await runTurn([{ role: "user", content: "Next timer" }], full, { ...deps, journal });
    expect(dispatched).toEqual(["clock"]);
  });
  it("prevents later tools in the same response after STOP", async () => {
    replies.push({
      text: "",
      toolCalls: [
        { id: "one", name: "set_timer", args: { seconds: 1 } },
        { id: "two", name: "set_alarm", args: { hour: 8, minute: 0 } },
      ],
    });
    await runTurn([{ role: "user", content: "Timer and alarm" }], full, {
      ...deps,
      shouldStopPhoneTask: () => dispatched.length > 0,
    });
    expect(dispatched).toEqual(["clock"]);
  });
  it("ends the turn on the task's own words, with no model round to recast it", async () => {
    // Live 2026-10-20: STOP mid TV task, then "I wasn't able to complete that task on
    // your TV. Would you like me to try again…?"
    results.push({ ok: false, summary: "Stopped.", error: "cancelled" });
    replies.push(
      {
        text: "",
        toolCalls: [
          { id: "c1", name: "tv_control", args: { action: "task", target: "play rain" } },
        ],
      },
      { text: "I wasn't able to complete that task on your TV.", toolCalls: [] },
    );
    const out = await ask("On YouTube on the TV, search for rain sounds and play the third result");
    expect(out.reply).toBe("Stopped.");
    expect(seen).toHaveLength(1);
  });
});

describe("workflow handover and completion", () => {
  it.each([
    { ok: true, summary: "Timer started.", status: "succeeded" },
    { ok: false, summary: "Permission denied.", error: "approval_denied", status: "blocked" },
    { ok: false, summary: "Timer could not be started.", status: "failed" },
  ])("reviews a single successful tool against the objective ($status)", async (receipt) => {
    results.push(receipt);
    replies.push(
      { text: "", toolCalls: [{ id: "t", name: "set_timer", args: { seconds: 300 } }] },
      { text: "Timer started.", toolCalls: [] },
    );
    const verifyCompletion = vi.fn(async () => ({
      status: "succeeded" as const,
      completed: ["Timer requested"],
      remaining: [],
    }));
    const out = await runTurn([{ role: "user", content: "Set a timer for five minutes" }], full, {
      ...deps,
      verifyCompletion,
    });
    expect(verifyCompletion).toHaveBeenCalledTimes(receipt.ok ? 1 : 0);
    expect(out.status).toBe(receipt.status);
    expect(out.reply).toBe(receipt.summary);
  });

  it("reviews a multi-tool turn even when the wording looked simple", async () => {
    replies.push(
      {
        text: "",
        toolCalls: [
          { id: "a", name: "get_time", args: {} },
          { id: "b", name: "get_day", args: {} },
        ],
      },
      { text: "Saturday at four.", toolCalls: [] },
    );
    const verifyCompletion = vi.fn(async () => ({
      status: "succeeded" as const,
      completed: ["Time and date read"],
      remaining: [],
    }));
    await runTurn([{ role: "user", content: "What time is it?" }], full, {
      ...deps,
      verifyCompletion,
    });
    expect(verifyCompletion).toHaveBeenCalledOnce();
  });
  it("retains a researched answer when checking is unavailable instead of dumping raw pages", async () => {
    const answer =
      "Service A observes UI; Service B observes notifications. Sources: https://example.test/a and https://example.test/b";
    results.push({ ok: true, summary: "Raw page text ".repeat(1000) });
    replies.push(
      {
        text: "",
        toolCalls: [{ id: "r", name: "read_webpage", args: { url: "https://example.test/a" } }],
      },
      { text: answer, toolCalls: [] },
    );
    const verifyCompletion = vi.fn(async () => ({
      status: "unverified" as const,
      completed: [],
      remaining: ["Citation check unavailable"],
    }));
    const out = await runTurn(
      [{ role: "user", content: "Compare the services and cite sources" }],
      full,
      { ...deps, verifyCompletion },
    );
    expect(verifyCompletion).toHaveBeenCalledWith(expect.any(String), expect.any(Array), answer, expect.any(Function));
    expect(out.reply).toContain(answer);
    expect(out.reply).not.toContain("Raw page text");
    expect(out.status).toBe("unverified");
  });
  it("delivers full PC findings and artifacts to the next model", async () => {
    results.push({
      ok: true,
      summary: "Comparison ready",
      data: {
        findings: ["x".repeat(3000), "Laptop B: ₹42,100 — https://vendor.example/B"],
        artifacts: [{ uri: "D:/Reports/comparison.txt", kind: "document" }],
        proof: { passed: true, evidence_ids: ["comparison-read"] },
      },
    });
    replies.push(
      {
        text: "",
        toolCalls: [
          { id: "pc-1", name: "pc_task", args: { goal: "Compare laptops", kind: "browser" } },
        ],
      },
      { text: "Laptop B costs ₹42,100.", toolCalls: [] },
    );
    await ask("Compare laptops on my PC");
    const payload = seen[1]!
      .map((s) => {
        try {
          return JSON.parse(s);
        } catch {
          return null;
        }
      })
      .find((r) => r?.version === 1);
    expect(payload.findings.at(-1)).toContain("₹42,100");
    expect(payload.artifacts[0].uri).toBe("D:/Reports/comparison.txt");
  });

  it("replaces a saved-file claim when only opening the app was proved", async () => {
    const journal = new WorkflowJournal();
    const verifyCompletion = vi.fn(async () => ({
      status: "partial" as const,
      completed: ["Opened Notepad"],
      remaining: ["Save the comparison"],
    }));
    results.push({ ok: true, summary: "Opened Notepad" });
    replies.push(
      {
        text: "",
        toolCalls: [{ id: "open-1", name: "open_application", args: { name: "Notepad" } }],
      },
      { text: "Saved your comparison.", toolCalls: [] },
    );
    const output = await runTurn(
      [{ role: "user", content: "Open Notepad and save the comparison" }],
      full,
      { ...deps, journal, verifyCompletion },
    );
    expect(output.reply).toContain("Still unconfirmed: Save the comparison");
    expect(output.reply).not.toContain("Saved your comparison");
    expect(journal.listSuspended()[0]?.completion?.status).toBe("partial");
  });
});

describe("runTurn — said it did it but didn't", () => {
  it("checks Done against the unstarted phone request and refuses a live-read claim without a tool", async () => {
    const objective = "Open Settings and freshly read both IMEI numbers from the phone screen";
    const journal = new WorkflowJournal();
    replies.push(
      { text: "Access is confirmed. Here are both IMEI numbers read live from the screen.", toolCalls: [] },
      { text: "", toolCalls: [{ id: "fresh-imei", name: "phone_task", args: { goal: objective } }] },
      { text: "Here is the verified phone result.", toolCalls: [] },
    );
    const out = await runTurn([
      { role: "user", content: objective },
      { role: "assistant", content: "Not run. Call request_tool_access, then enable JARVIS in Accessibility settings." },
      { role: "user", content: "Done" },
    ], full, { ...deps, journal });
    expect(dispatched).toEqual(["phone_task"]);
    expect(seen[1].at(-1)).toContain("called no tool");
    expect(out.reply).not.toContain("Access is confirmed");
    expect(journal.list()[0].objective).toBe(objective);
    expect(journal.list()[0].state).toBe("succeeded");
  });

  it("keeps an acknowledgment of completed work from forcing another phone read", async () => {
    replies.push({ text: "You're welcome.", toolCalls: [] });
    const out = await runTurn([
      { role: "user", content: "Read my IMEI" },
      { role: "assistant", content: "Both IMEI numbers were read and reported." },
      { role: "user", content: "Done" },
    ], full, deps);
    expect(dispatched).toEqual([]);
    expect(out.reply).toBe("You're welcome.");
  });

  it("renders requested content without an action, but still guards sending or saving it", async () => {
    const request = "Show a bar chart and table, a flowchart and a two-item schedule";
    const answer = 'Here you go: [CHART type="bar"]{"labels":["Apples"],"values":[3]}[/CHART]';
    expect(claimedWithoutActing(request, answer, false)).toBe(false);
    expect(claimedWithoutActing("Make a chart and email it", "Sent it.", false)).toBe(true);
    expect(claimedWithoutActing("Make a chart and email it", "Done.", false)).toBe(true);
    expect(claimedWithoutActing("Create a table and save it", "I've saved it.", false)).toBe(true);
    replies.push({ text: answer, toolCalls: [] });
    expect((await ask(request)).reply).toBe(answer);
    expect(dispatched).toEqual([]);
  });
  it("rechecks a claimed action that made no tool call, and never speaks the claim", async () => {
    // Live 2026-09-23: the model copied an earlier turn instead of calling phone_task.
    replies.push(
      { text: "I've opened Android's Accessibility settings.", toolCalls: [] },
      { text: "", toolCalls: [{ id: "c1", name: "phone_task", args: { goal: "find storage" } }] },
      { text: "55.2 GB is used.", toolCalls: [] },
    );
    const out = await ask("On my phone, open Settings and find how much storage is used");
    expect(dispatched).toEqual(["phone_task"]);
    expect(out.reply).toBe("55.2 GB is used.");
    expect(seen[1]!.at(-1)).toMatch(/called no tool/);
  });

  it("checks only once", async () => {
    replies.push(
      { text: "I've opened it.", toolCalls: [] },
      { text: "I've opened it.", toolCalls: [] },
    );
    const out = await ask("open settings");
    expect(seen).toHaveLength(2);
    expect(out.reply).toMatch(/couldn't confirm/);
  });

  it("leaves questions and genuine tool-backed replies alone", () => {
    expect(claimedWithoutActing("what's the capital of France?", "It's Paris.", false)).toBe(false);
    expect(claimedWithoutActing("set a timer for 5 minutes", "I've set it.", true)).toBe(false);
    expect(claimedWithoutActing("set a timer for 5 minutes", "I've set it.", false)).toBe(true);
    // Live 2026-09-30, no tool call and the wrong show named.
    expect(claimedWithoutActing("Resume", "Resumed — back to *Arcane* on Netflix.", false)).toBe(
      true,
    );
    // Live 2026-10-18: a bare acknowledgement, no tool call, volume unchanged.
    expect(claimedWithoutActing("increase the volume", "OK.", false)).toBe(true);
    expect(claimedWithoutActing("turn on the flashlight", "Sure thing, sir!", false)).toBe(true);
    // An acknowledgement that goes on to say something real is not caught by this rule.
    expect(claimedWithoutActing("set an alarm", "OK — for what time?", false)).toBe(false);
    // Live 2026-10-18: claimed a WhatsApp reply was sent; no tool ran, nothing was sent.
    expect(
      claimedWithoutActing(
        "can you reply to dad's notification by saying that this was a test",
        "Yes, sir. I've sent the reply to Dad on WhatsApp.",
        false,
      ),
    ).toBe(true);
    expect(claimedWithoutActing("call mom", "Calling Mom now.", false)).toBe(true);
    // Live 2026-10-18: no tool ran, Maps never opened.
    expect(
      claimedWithoutActing(
        "can you set a route to the city library?",
        "Got it — routing you to the city library by car.",
        false,
      ),
    ).toBe(true);
    expect(claimedWithoutActing("navigate to the airport", "Sure, which terminal?", false)).toBe(
      false,
    );
  });
});

describe("runTurn — out of tool rounds", () => {
  const call = (id: string) => ({
    text: "",
    toolCalls: [{ id, name: "web_search", args: { query: id } }],
  });

  it("allows a bounded research budget to search, read multiple pages and resolve gaps", async () => {
    for (let n = 0; n < 6; n++) replies.push(call(`source-${n}`));
    replies.push({ text: "Findings with source links.", toolCalls: [] });
    const out = await runTurn([{ role: "user", content: "Research a topic" }], full, {
      ...deps,
      maxToolRounds: 10,
    });
    expect(dispatched).toHaveLength(6);
    expect(out.reply).toBe("Findings with source links.");
    expect(seen.flat().some((s) => s.includes("used every tool call"))).toBe(false);
  });

  it("honours STOP between research rounds", async () => {
    replies.push(call("one"), call("two"));
    const out = await runTurn([{ role: "user", content: "Research a topic" }], full, {
      ...deps,
      maxToolRounds: 10,
      shouldStopPhoneTask: () => dispatched.length > 0,
    });
    expect(dispatched).toHaveLength(1);
    expect(out.reply).toBe("Stopped.");
  });

  it("answers from what the tools found instead of a canned failure", async () => {
    // Live 2026-09-26: "read my Chrome screen and search up the time" ended in
    // "I worked on that but couldn't fully finish it", its search results thrown away.
    replies.push(call("a"), call("b"), call("c"), {
      text: "It starts at 17:00 UTC.",
      toolCalls: [],
    });
    const out = await runTurn([{ role: "user", content: "read my screen and search up what time it starts" }], full, { ...deps, maxToolRounds: 3 });
    expect(out.reply).toBe("It starts at 17:00 UTC.");
    expect(seen.at(-1)!.at(-1)).toMatch(/used every tool call/);
  });

  it("falls back to the tools' own words when the model still wants to act", async () => {
    replies.push(call("a"), call("b"), call("c"), call("d"));
    const out = await runTurn([{ role: "user", content: "read my screen and search up what time it starts" }], full, { ...deps, maxToolRounds: 3 });
    expect(out.reply).toMatch(
      /^I couldn't finish all of that, sir\. Here's what I did get: Found it: 55\.2 GB used\./,
    );
    expect(dispatched).toHaveLength(3); // the fourth call was never run
  });
});

describe("runTurn — answered about the phone without looking", () => {
  it("sends a phone question back to look instead of answering from memory", async () => {
    // Live 2026-09-26, fallback chat model: "Android 14" for a phone on Android 16.
    replies.push(
      { text: "Phone info: Android 14.", toolCalls: [] },
      {
        text: "",
        toolCalls: [{ id: "c1", name: "phone_task", args: { goal: "find the Android version" } }],
      },
      { text: "Android 16.", toolCalls: [] },
    );
    const out = await ask("on my phone, check Settings and tell me the Android version");
    expect(dispatched).toEqual(["phone_task"]);
    expect(out.reply).toBe("Android 16.");
    expect(seen[1]!.at(-1)).toMatch(/didn't come from the phone/);
  });

  it("only for requests about the phone, and not once a tool ran", () => {
    expect(answeredPhoneWithoutLooking("what's my phone's device name?", false)).toBe(true);
    expect(answeredPhoneWithoutLooking("how long has it been on? check in Settings", false)).toBe(
      true,
    );
    expect(answeredPhoneWithoutLooking("what's the tallest mountain?", false)).toBe(false);
    expect(answeredPhoneWithoutLooking("on my phone, what's the Android version?", true)).toBe(
      false,
    );
  });

  it("without the words 'on my phone'", () => {
    for (const q of [
      "what model is my phone?",
      "is this phone on silent?",
      "what's my battery at",
      "which wifi am I on? my wifi keeps dropping",
      "what android version am I running",
      "how much storage does my device have left",
      // Live 2026-10-18: answered "none" from the previous turn without reading again.
      "can you check my notifications?",
      "any new messages?",
      "do I have unread texts",
    ]) {
      expect(answeredPhoneWithoutLooking(q, false), q).toBe(true);
    }
    for (const q of [
      "what's the capital of France?",
      "tell me a joke",
      "who won the match yesterday",
      "what's the phone number for Pizza Hut?",
    ]) {
      expect(answeredPhoneWithoutLooking(q, false), q).toBe(false);
    }
  });

  it("asks again about the TV the same way", () => {
    // Live 2026-10-19: "nothing playing on the TV" with no tool call.
    expect(answeredTvWithoutLooking("what's on my TV right now?", false)).toBe(true);
    expect(answeredTvWithoutLooking("is the tv on?", false)).toBe(true);
    expect(answeredTvWithoutLooking("what's on my TV right now?", true)).toBe(false);
    expect(answeredTvWithoutLooking("what's a good TV show to watch?", false)).toBe(false);
  });
});

describe("runTurn — load_tools", () => {
  const full = toolPalette({ tier: "gemini", model: "m", keys: { gemini: ["k"] } }).filter((tool) =>
    ["open_application", "manage_schedule", "get_news"].includes(tool.name),
  );
  const call = (id: string, name: string, args: Record<string, unknown>) => ({
    text: "",
    toolCalls: [{ id, name, args }],
  });

  it("adds a group for the rest of the turn without spending a round", async () => {
    replies.push(
      call("l", "load_tools", { groups: "planner" }),
      call("a", "manage_schedule", { action: "get" }),
      call("b", "manage_schedule", { action: "get", day: "tomorrow" }),
      { text: "Two meetings tomorrow, sir.", toolCalls: [] },
    );
    const out = await runTurn(
      [{ role: "user", content: "what's on tomorrow" }],
      turnPalette(full, new Set()),
      deps,
      undefined,
      full,
    );
    expect(seenTools[0]).toEqual(["open_application", "load_tools"]);
    expect(seenTools[1]).toContain("manage_schedule");
    expect(dispatched).toHaveLength(2); // load_tools itself runs nothing
    expect(out.toolResults).toHaveLength(2);
    expect(out.reply).toBe("Two meetings tomorrow, sir.");
    expect(out.calledTools).toEqual(["load_tools", "manage_schedule", "manage_schedule"]);
  });

  it("answers a load of an unknown group with the failure", async () => {
    replies.push(call("l", "load_tools", { groups: "nope" }), { text: "OK.", toolCalls: [] });
    await runTurn(
      [{ role: "user", content: "hi" }],
      turnPalette(full, new Set()),
      deps,
      undefined,
      full,
    );
    expect(JSON.parse(seen[1]!.at(-1)!)).toMatchObject({
      ok: false,
      summary: "No such group.",
      status: "failed",
    });
  });
});

describe("runTurn — a turn limited to some tools (a command from the PC)", () => {
  it("never dispatches a tool outside the scope, even one the model names anyway", async () => {
    const scoped = { config: {}, onlyTools: new Set(["set_alarm"]) } as unknown as DispatchDeps;
    replies.push(
      {
        text: "",
        toolCalls: [
          { id: "c1", name: "send_message", args: { to: "Mom", text: "hi" } },
          { id: "c2", name: "set_alarm", args: { hour: 7, minute: 0 } },
        ],
      },
      { text: "Alarm set for 7; I can't send messages from here.", toolCalls: [] },
    );
    const out = await runTurn([{ role: "user", content: "alarm at 7 and text mom" }], full, scoped);
    expect(dispatched).toEqual(["clock"]);
    expect(out.toolResults).toHaveLength(1);
    expect(seen[1]!.some((c) => /Not run: that tool isn't available/.test(c))).toBe(true);
  });
});
