import { describe, expect, it, vi } from "vitest";
import type { BrainConfig } from "./config";
import type { ChatMessage, ToolResult } from "./types";
import * as httpTools from "./tools/http";
import { androidPlatform } from "./platform";
import { parseSkillFile, saveSkills } from "./skillStore";
import { WorkflowJournal } from "./workflow";
import { agentResult } from "./results";
import { toolActivity } from "./toolActivity";
import type { DispatchDeps } from "./tools/dispatch";

const runTurn = vi.fn(
  async (
    _messages: ChatMessage[],
    _tools?: Array<{ name: string }>,
    _deps?: DispatchDeps,
    _onFallback?: unknown,
    _fullTools?: Array<{ name: string }>,
  ): Promise<{
    reply: string;
    toolResults: ToolResult[];
    calledTools: string[];
    status?: string;
  }> => ({
    status: "succeeded",
    reply: "Done, sir.",
    toolResults: [],
    calledTools: [],
  }),
);
vi.mock("./loop", () => ({ runTurn }));

const { createBrain } = await import("./index");
const { PersistentStore } = await import("./memory/store");

const cfg: BrainConfig = { tier: "groq", model: "openai/gpt-oss-120b", keys: { groq: ["g1"] } };
const nativePlatform = { ...androidPlatform, toolAvailability: async () => ({}) };

it("uses request-owned observers and keeps UI bindings and pending turns out of model history", async () => {
  const memory = new PersistentStore();
  await memory.appendTurn({ role: "user", content: "Earlier request" });
  await memory.beginChatTurn(
    { role: "user", content: "Continue saved task: New question", uiId: "request-user" },
    { role: "assistant", content: "", uiId: "request-reply", uiPending: true },
  );
  runTurn.mockClear();
  const brain = createBrain({ getConfig: () => cfg, memory, platform: nativePlatform });
  await brain.ask("New question", undefined, undefined, undefined, {
    userId: "request-user",
    replyId: "request-reply",
  });
  const messages = runTurn.mock.calls[0][0];
  expect(messages.filter((m) => m.content === "New question")).toHaveLength(1);
  expect(JSON.stringify(messages)).not.toMatch(/uiId|uiPending|request-reply|request-user/);
  expect(await memory.recentChatTurns()).toHaveLength(3);
  expect((await memory.recentChatTurns())[1].content).toBe("Continue saved task: New question");
});

it("groups information-only consultation events under the initiating tool without widening its authority", async () => {
  const events = vi.fn();
  const parent = toolActivity("consult_agent", {}, "consult-parent");
  runTurn
    .mockImplementationOnce(async (_messages, _tools, deps) => {
      deps!.onToolActivity?.({ ...parent, state: "running", at: 1 });
      const answer = await deps!.consultAgent!("research", "Read public sources", parent);
      return {
        reply: answer.summary,
        calledTools: ["consult_agent"],
        toolResults: [answer],
        status: "succeeded",
      };
    })
    .mockImplementationOnce(async (_messages, _tools, deps) => {
      expect(deps!.informationOnly).toBe(true);
      expect(deps!.consultAgent).toBeUndefined();
      expect(deps!.onlyTools?.has("send_message")).toBe(false);
      deps!.onToolActivity?.({
        ...toolActivity("web_search", {}, "child-search"),
        state: "completed",
        at: 2,
      });
      return {
        reply: "Sources ready",
        calledTools: ["web_search"],
        toolResults: [{ ok: true, summary: "Sources" }],
        status: "succeeded",
      };
    });
  await createBrain({ getConfig: () => cfg, platform: nativePlatform }).ask(
    "Research",
    undefined,
    undefined,
    undefined,
    { userId: "u-consult", replyId: "r-consult", onToolActivity: events },
  );
  expect(events.mock.calls.find(([event]) => event.id === "child-search")?.[0].parentId).toBe(
    "consult-parent",
  );
});

it("keeps incoming request limits and direct PC auto routing while reporting through the scoped observer", async () => {
  const event = vi.fn(),
    ambient = vi.fn();
  const runTask = vi.fn(
    async (
      _goal: string,
      _kind?: "browser" | "computer" | "research" | "auto",
      activity?: Parameters<NonNullable<DispatchDeps["remote"]>["runTask"]>[2],
    ) => {
      activity!.onApproval(true);
      activity!.onProgress({ event: "task.accepted", taskId: "owned-pc-task", seq: 1, data: {} });
      activity!.onProgress({
        event: "task.event",
        taskId: "owned-pc-task",
        seq: 2,
        data: { kind: "step", line: "type SECRET", ok: true },
      });
      return {
        ok: true,
        summary: "Done",
        data: { proof: { passed: true, evidence_ids: ["proof-1"] } },
      };
    },
  );
  const brain = createBrain({
    getConfig: () => cfg,
    remote: { runTask },
    onToolActivity: ambient,
    platform: nativePlatform,
  });
  const request = { userId: "u-incoming", replyId: "r-incoming", onToolActivity: event };
  const result = await brain.executeAction(
    { type: "pc_task", kind: "auto", goal: "Open Notepad", picked: true },
    request,
  );
  expect(result.ok).toBe(true);
  expect(runTask.mock.calls[0][1]).toBe("auto");
  expect(event.mock.calls.some(([e]) => e.state === "waiting_for_approval")).toBe(true);
  expect(event.mock.calls.at(-1)?.[0].state).toBe("completed");
  expect(JSON.stringify(event.mock.calls)).not.toContain("SECRET");
  expect(ambient).not.toHaveBeenCalled();
  runTurn.mockClear();
  await brain.askFromPc("Set volume to 40", request);
  expect(runTurn.mock.calls[0][2]!.onlyTools?.has("send_message")).toBe(false);
  await brain.askFromWhatsApp("Set volume to 40", "Owner", request);
  expect(runTurn.mock.calls[1][2]!.onlyTools?.has("read_notifications")).toBe(false);
});

describe("deterministic device commands", () => {
  it("sets absolute volume through the same dispatcher without a model or configured AI key", async () => {
    runTurn.mockClear();
    const onToolActivity = vi.fn();
    const setVolume = vi.fn(async () => ({
      ok: true,
      summary: "Volume 40% confirmed.",
      verification: {
        status: "verified" as const,
        method: "readback",
        expected: { level: 40 },
        observed: { level: 40 },
      },
    }));
    const brain = createBrain({
      getConfig: () => ({ ...cfg, keys: {} }),
      onToolActivity,
      platform: { ...nativePlatform, system: { ...nativePlatform.system, setVolume } },
    });
    expect(await brain.ask("set media volume to 40%")).toBe("Volume 40% confirmed.");
    expect(setVolume).toHaveBeenCalledExactlyOnceWith(40);
    expect(runTurn).not.toHaveBeenCalled();
    expect(onToolActivity.mock.calls.map(([event]) => event.state)).toEqual([
      "queued",
      "running",
      "completed",
    ]);
  });
  it("keeps a Clock intent unverified and uses its actual response", async () => {
    runTurn.mockClear();
    const setTimer = vi.fn(async () => ({
      ok: true,
      summary: "Opened Clock; timer not confirmed.",
      verification: { status: "unverified" as const, method: "clock_intent" },
    }));
    const brain = createBrain({
      getConfig: () => cfg,
      platform: { ...nativePlatform, clock: { ...nativePlatform.clock, setTimer } },
    });
    expect(await brain.ask("set a timer for 5 minutes")).toBe("Opened Clock; timer not confirmed.");
    expect(setTimer).toHaveBeenCalledWith(300, "");
    expect(runTurn).not.toHaveBeenCalled();
  });
  it("routes compound requests and incoming PC requests through their model/scoped path", async () => {
    const brain = createBrain({ getConfig: () => cfg, platform: nativePlatform });
    runTurn.mockClear();
    await brain.ask("Set volume to 40 and call Mom");
    expect(runTurn).toHaveBeenCalledTimes(1);
    await brain.askFromPc("Set volume to 40");
    expect(runTurn).toHaveBeenCalledTimes(2);
    expect(runTurn.mock.calls[1][2]?.onlyTools).toBeTruthy();
  });
  it("honours STOP before a direct effect starts", async () => {
    const setVolume = vi.fn(async () => ({ ok: true, summary: "Volume set" }));
    const brain = createBrain({
      getConfig: () => cfg,
      shouldStopPhoneTask: () => true,
      platform: { ...nativePlatform, system: { ...nativePlatform.system, setVolume } },
    });
    expect(await brain.ask("set volume to 40")).toBe("Stopped.");
    expect(setVolume).not.toHaveBeenCalled();
  });
  it("updates a late direct-action receipt without repeating the native command", async () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    });
    try {
      let notify!: () => void;
      const setVolume = vi.fn(async () => ({
        ok: false,
        summary: "Native outcome unknown",
        error: "native_outcome_unknown",
        nativeOutcomeId: "direct-native-receipt",
      }));
      const reconcileOutcome = vi.fn(async () => ({ ok: true, summary: "Volume 40 confirmed" }));
      const watchOutcome = vi.fn((_id: string, listener: () => void) => {
        notify = listener;
        return () => {};
      });
      const onToolActivity = vi.fn();
      const brain = createBrain({
        getConfig: () => cfg,
        onToolActivity,
        platform: {
          ...nativePlatform,
          reconcileOutcome,
          watchOutcome,
          system: { ...nativePlatform.system, setVolume },
        },
      });
      await brain.ask("set volume to 40");
      const journal = new WorkflowJournal();
      const originalId = journal.list()[0].results[0].result_id;
      expect(journal.list()[0].results[0].status).toBe("unverified");
      notify();
      await vi.waitFor(() => expect(journal.list()[0].results[0].status).toBe("succeeded"));
      expect(journal.list()[0].results[0].result_id).toBe(originalId);
      expect(reconcileOutcome).toHaveBeenCalledExactlyOnceWith("direct-native-receipt");
      expect(setVolume).toHaveBeenCalledExactlyOnceWith(40);
      expect(journal.list()[0].state).toBe("suspended");
      expect(onToolActivity.mock.calls.at(-1)?.[0].state).toBe("completed");
      expect(new Set(onToolActivity.mock.calls.map(([event]) => event.id)).size).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

it("continues the same checked workflow with saved remaining work and protected original tool limits", async () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  });
  try {
    const journal = new WorkflowJournal();
    const run = journal.begin("Send Mom a message and set volume to 40");
    run.scope = {
      onlyTools: ["send_message", "set_volume", "get_time", "phone_task"],
      informationOnly: false,
    };
    const receipt = agentResult(
      { ok: true, summary: "Message sent" },
      "Message Mom",
      "send_message",
    );
    run.results = [receipt];
    run.operations = [
      { id: "sent", key: "a".repeat(64), tool: "send_message", resultId: receipt.result_id },
    ];
    run.completion = {
      status: "partial",
      completed: ["Message Mom"],
      remaining: ["Set volume to 40"],
    };
    run.state = "suspended";
    journal.save(run);
    const brain = createBrain({ getConfig: () => cfg, platform: nativePlatform });
    const report = await brain.checkWorkflow(run.id);
    expect(report).toMatchObject({
      canResume: true,
      completed: ["Message sent"],
      remaining: ["Set volume to 40"],
    });
    runTurn.mockClear();
    await brain.resumeWorkflow(run.id, report.token!);
    const call = runTurn.mock.calls[0];
    expect(call[2]).toMatchObject({ resumeRun: { id: run.id, operations: run.operations } });
    expect([...call[2]!.onlyTools!]).toEqual(expect.arrayContaining(["set_volume", "get_time"]));
    expect([...call[2]!.onlyTools!]).not.toContain("send_message");
    expect([...call[2]!.onlyTools!]).not.toContain("phone_task");
    expect(call[0].some((m) => m.content.includes('"remaining":["Set volume to 40"]'))).toBe(true);
    expect(journal.list()).toHaveLength(1);
    await expect(brain.resumeWorkflow(run.id, report.token!)).rejects.toThrow(/state changed/);
  } finally {
    vi.unstubAllGlobals();
  }
});

describe("runtime tool availability", () => {
  it("omits native capabilities from the browser preview", async () => {
    runTurn.mockClear();
    await createBrain({ getConfig: () => cfg, memory: new PersistentStore() }).ask(
      "What can you do?",
    );
    const tools = runTurn.mock.calls[0]![4]!.map((tool) => tool.name);
    expect(tools).not.toContain("phone_task");
    expect(tools).not.toContain("request_tool_access");
    expect(tools).toContain("manage_schedule");
  });

  it("matches screenshot availability to the actual provider selection and fallback setting", async () => {
    const both = { ...cfg, keys: { groq: ["g"], gemini: ["k"] } };
    for (const fallback of [false, true]) {
      runTurn.mockClear();
      await createBrain({
        getConfig: () => ({ ...both, autoSwitchModels: fallback }),
        platform: nativePlatform,
        memory: new PersistentStore(),
      }).ask("What is on my screen?");
      expect(runTurn.mock.calls[0]![4]!.some((tool) => tool.name === "take_screenshot")).toBe(
        fallback,
      );
    }
  });
});

describe("skill prompt integration", () => {
  it("includes enabled local guidance without adding it to incoming PC requests", async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    };
    const skill = {
      ...parseSkillFile("writing.txt", "Use the phrase verified local guidance."),
      enabled: true,
    };
    saveSkills([skill], storage);
    vi.stubGlobal("localStorage", storage);
    try {
      runTurn.mockClear();
      const brain = createBrain({ getConfig: () => cfg, memory: new PersistentStore() });
      await brain.ask("Draft a thank-you note");
      const prompt = runTurn.mock.calls[0]![0][0]!.content;
      expect(prompt).toContain("WRITING");
      expect(prompt).toContain("verified local guidance");
      runTurn.mockClear();
      await brain.askFromPc("set an alarm for 7am");
      expect(runTurn.mock.calls[0]![0][0]!.content).not.toContain("verified local guidance");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("direct notification reads", () => {
  it.each([true, false])(
    "returns actual reader text without a model decision (ok=%s)",
    async (ok) => {
      runTurn.mockClear();
      const summary = ok
        ? "Notifications: Sample notification: Bring the blue notebook."
        : "Notification access is required.";
      const readNotifications = vi.fn(async () => ({ ok, summary }));
      const memory = new PersistentStore();
      const onDispatched = vi.fn();
      const brain = createBrain({
        getConfig: () => cfg,
        memory,
        onDispatched,
        platform: { ...nativePlatform, direct: { ...nativePlatform.direct, readNotifications } },
      });
      const request = "can you read my notifications and tell me what they are?";
      expect(await brain.ask(request)).toBe(summary);
      expect(readNotifications).toHaveBeenCalledWith("", "");
      expect(runTurn).not.toHaveBeenCalled();
      expect(onDispatched).toHaveBeenCalledWith(
        { type: "notifications" },
        expect.objectContaining({ ok, summary }),
      );
      expect((await memory.recentTurns()).map((t) => t.content)).toEqual([request, summary]);
    },
  );
  it("retains scoped/filtered and compound request routing", async () => {
    runTurn.mockClear();
    const brain = createBrain({ getConfig: () => cfg, memory: new PersistentStore() });
    await brain.ask("Read my notifications and reply to them");
    await brain.ask("Read my WhatsApp notifications");
    await brain.askFromWhatsApp("Read my notifications", "Test sender");
    expect(runTurn).toHaveBeenCalledTimes(3);
  });
});

describe("direct weather response latency", () => {
  it.each([true, false])(
    "returns the tool's actual result without model or reviewer calls (ok=%s)",
    async (ok) => {
      runTurn.mockClear();
      const summary = ok
        ? "Right now it's 30°C and clear."
        : "I couldn't fetch the weather just now.";
      const weather = vi.spyOn(httpTools, "getWeather").mockResolvedValue({ ok, summary });
      try {
        const memory = new PersistentStore();
        const onDispatched = vi.fn();
        const brain = createBrain({ getConfig: () => cfg, memory, onDispatched });
        expect(await brain.ask("What is the weather here?")).toBe(summary);
        expect(weather).toHaveBeenCalledOnce();
        expect(onDispatched).toHaveBeenCalledWith(
          { type: "weather" },
          expect.objectContaining({ ok, summary }),
        );
        expect(runTurn).not.toHaveBeenCalled();
        expect((await memory.recentTurns()).map((t) => t.content)).toEqual([
          "What is the weather here?",
          summary,
        ]);
      } finally {
        weather.mockRestore();
      }
    },
  );

  it("retains the full tool-and-verification path for combined work and specialist research", async () => {
    runTurn.mockClear();
    const brain = createBrain({ getConfig: () => cfg, memory: new PersistentStore() });
    await brain.ask("What is the weather here and set a timer?");
    expect(runTurn).toHaveBeenCalledOnce();
    runTurn.mockClear();
    await brain.ask("What is the weather here?", undefined, undefined, "research");
    expect(runTurn).toHaveBeenCalledOnce();
  });
});

describe("ask with display text (a routine run)", () => {
  it("sends the full turn to the model but saves what the chat showed", async () => {
    runTurn.mockClear();
    const memory = new PersistentStore();
    const brain = createBrain({ getConfig: () => cfg, memory });
    await brain.ask("Run my routine “bedtime”. Do these now…: turn on DND", "Run bedtime");

    const sent = runTurn.mock.calls[0]![0];
    expect(sent.at(-1)).toEqual({
      role: "user",
      content: "Run my routine “bedtime”. Do these now…: turn on DND",
    });
    const [user] = await memory.recentTurns();
    expect(user).toMatchObject({ role: "user", display: "Run bedtime" });

    await memory.archiveConversation();
    expect((await memory.listRecents())[0]!.title).toBe("Run bedtime");
  });
});

describe("askFromPc (a command the paired PC sent)", () => {
  it("offers only the PC's tools and says where the request came from", async () => {
    runTurn.mockClear();
    const memory = new PersistentStore();
    const brain = createBrain({ getConfig: () => cfg, memory, platform: nativePlatform });
    runTurn.mockResolvedValueOnce({
      status: "succeeded",
      reply: "Alarm set for 07:00.",
      toolResults: [{ ok: true, summary: "Alarm set for 07:00 in your clock app." }],
      calledTools: ["set_alarm"],
    });
    const out = await brain.askFromPc("set an alarm for 7am");
    expect(out).toEqual({ reply: "Alarm set for 07:00.", ok: true });

    const [messages, , deps, , fullTools] = runTurn.mock.calls[0]!;
    const offered = new Set(fullTools!.map((t) => t.name));
    expect(offered.has("set_alarm")).toBe(true);
    for (const never of ["send_message", "call_contact", "phone_task", "read_notifications"]) {
      expect(offered.has(never)).toBe(false);
    }
    expect([...offered].every((n) => deps!.onlyTools!.has(n))).toBe(true);
    expect(messages[0]!.content).toMatch(/THIS REQUEST CAME FROM THE USER'S PC/);
    const [user] = await memory.recentTurns();
    expect(user).toMatchObject({ display: "💻 From your PC: set an alarm for 7am" });
  });

  it("is ok only when a tool ran and task completion was verified", async () => {
    const brain = createBrain({ getConfig: () => cfg, memory: new PersistentStore() });
    runTurn.mockResolvedValueOnce({ reply: "Alarm set!", toolResults: [], calledTools: [] });
    expect((await brain.askFromPc("set an alarm")).ok).toBe(false);
    runTurn.mockResolvedValueOnce({
      reply: "Timer started; the flashlight wouldn't turn on.",
      toolResults: [
        { ok: true, summary: "Timer started." },
        { ok: false, summary: "No flashlight." },
      ],
      calledTools: ["set_timer", "device_control"],
    });
    expect((await brain.askFromPc("timer and flashlight")).ok).toBe(false);
  });

  it("does not report success to the PC when task verification is partial", async () => {
    const brain = createBrain({ getConfig: () => cfg, memory: new PersistentStore() });
    runTurn.mockResolvedValueOnce({
      status: "partial",
      reply: "Only the timer was set.",
      toolResults: [{ ok: true, summary: "Timer set." }],
      calledTools: ["set_timer"],
    });
    expect((await brain.askFromPc("set timer and alarm")).ok).toBe(false);
  });
});

describe("askFromWhatsApp (a listed contact, answered on the phone)", () => {
  it("adds lookups to the PC's tools and names the sender", async () => {
    runTurn.mockClear();
    const memory = new PersistentStore();
    const brain = createBrain({ getConfig: () => cfg, memory });
    await brain.askFromWhatsApp("what's the weather in Pune?", "Asha");
    const [messages, , deps] = runTurn.mock.calls[0]!;
    expect(deps!.onlyTools!.has("web_search")).toBe(true);
    expect(deps!.onlyTools!.has("set_alarm")).toBe(true);
    expect(deps!.onlyTools!.has("send_message")).toBe(false);
    expect(messages[0]!.content).toMatch(/THIS REQUEST CAME ON WHATSAPP\nFrom "Asha"/);
    const [user] = await memory.recentTurns();
    expect(user).toMatchObject({ display: "💬 WhatsApp from Asha: what's the weather in Pune?" });
  });
});

describe("ask with a picked agent (agents.ts)", () => {
  it.each(["phone", "research", "files", "scheduling", "content"] as const)(
    "keeps the visible chat context for the user-picked %s agent",
    async (agent) => {
      const memory = new PersistentStore();
      await memory.appendTurn({ role: "user", content: "Tell me my phone's IMEI number" });
      await memory.appendTurn({ role: "assistant", content: "Enable Accessibility, then ask me again." });
      await memory.beginChatTurn(
        { role: "user", content: "Done", uiId: "followup-user" },
        { role: "assistant", content: "", uiId: "followup-reply", uiPending: true },
      );
      runTurn.mockClear();
      const brain = createBrain({ getConfig: () => cfg, memory, platform: nativePlatform });
      await brain.ask("Done", undefined, undefined, agent,
        { userId: "followup-user", replyId: "followup-reply" });
      const [messages, , deps] = runTurn.mock.calls[0]!;
      expect(messages.filter((message) => message.role !== "system")).toEqual([
        { role: "user", content: "Tell me my phone's IMEI number" },
        { role: "assistant", content: "Enable Accessibility, then ask me again." },
        { role: "user", content: "Done" },
      ]);
      expect(messages[0].content).toContain("CONVERSATION CONTEXT");
      expect(JSON.stringify(messages)).not.toMatch(/uiId|uiPending|followup-user|followup-reply/);
      if (agent === "research") {
        expect(deps!.informationOnly).toBe(true);
        expect(deps!.onlyTools!.has("phone_task")).toBe(false);
      }
    },
  );

  it("keeps earlier replies when continuing with a different local agent after recreation", async () => {
    const memory = new PersistentStore();
    runTurn.mockClear();
    runTurn.mockResolvedValueOnce({ reply: "Draft: Welcome to our launch event.", calledTools: [], toolResults: [] });
    await createBrain({ getConfig: () => cfg, memory, platform: nativePlatform })
      .ask("Draft a launch invitation", undefined, undefined, "content");
    await createBrain({ getConfig: () => cfg, memory, platform: nativePlatform })
      .ask("Make that shorter", undefined, undefined, "phone");
    const history = runTurn.mock.calls[1][0].filter((message) => message.role !== "system");
    expect(history).toEqual([
      { role: "user", content: "Draft a launch invitation" },
      { role: "assistant", content: "Draft: Welcome to our launch event." },
      { role: "user", content: "Make that shorter" },
    ]);
  });

  it("keeps Auto follow-ups in context without silently dispatching the earlier action", async () => {
    const memory = new PersistentStore();
    await memory.appendTurn({ role: "user", content: "Tell me my phone's IMEI number" });
    await memory.appendTurn({ role: "assistant", content: "Turn JARVIS off and on again in Accessibility, then ask me again." });
    const isEnabled = vi.fn();
    runTurn.mockClear();
    await createBrain({ getConfig: () => cfg, memory,
      platform: { ...nativePlatform, phone: { ...nativePlatform.phone, isEnabled } } }).ask("Done");
    const messages = runTurn.mock.calls[0][0];
    expect(messages[1].content).toBe("Tell me my phone's IMEI number");
    expect(messages.at(-1)).toEqual({ role: "user", content: "Done" });
    expect(messages[0].content).toContain("continue the remaining work instead of greeting");
    expect(messages[0].content).toContain("An acknowledgment after completed work does not request a repeat");
    expect(isEnabled).not.toHaveBeenCalled(); // Context goes to the normal tool/approval loop.
  });

  it("does not leak the phone chat to incoming PC or WhatsApp requests", async () => {
    const memory = new PersistentStore();
    await memory.appendTurn({ role: "user", content: "PRIVATE_LOCAL_CONVERSATION" });
    const brain = createBrain({ getConfig: () => cfg, memory, platform: nativePlatform });
    runTurn.mockClear();
    await brain.askFromPc("What time is it?");
    await brain.askFromWhatsApp("What time is it?", "Allowed contact");
    for (const [messages, , deps] of runTurn.mock.calls) {
      expect(JSON.stringify(messages)).not.toContain("PRIVATE_LOCAL_CONVERSATION");
      expect(messages[0].content).not.toContain("CONVERSATION CONTEXT");
      expect(deps!.onlyTools).toBeDefined();
    }
  });

  it("keeps internal consultations isolated even when their parent uses a local agent", async () => {
    const memory = new PersistentStore();
    await memory.appendTurn({ role: "user", content: "PRIVATE_PARENT_CHAT" });
    runTurn.mockClear();
    runTurn.mockImplementationOnce(async (messages, _tools, deps) => {
      expect(JSON.stringify(messages)).toContain("PRIVATE_PARENT_CHAT");
      await deps!.consultAgent!("research", "Read public sources only");
      return { reply: "Parent answer", calledTools: [], toolResults: [] };
    }).mockImplementationOnce(async (messages, _tools, deps) => {
      expect(JSON.stringify(messages)).not.toContain("PRIVATE_PARENT_CHAT");
      expect(messages.at(-1)).toEqual({ role: "user", content: "Read public sources only" });
      expect(deps!.informationOnly).toBe(true);
      expect(deps!.consultAgent).toBeUndefined();
      return { reply: "Public findings", status: "succeeded", calledTools: ["web_search"],
        toolResults: [{ ok: true, summary: "Source read" }] };
    });
    await createBrain({ getConfig: () => cfg, memory, platform: nativePlatform })
      .ask("Help with this", undefined, undefined, "content");
    expect(runTurn).toHaveBeenCalledTimes(2);
    expect((await memory.recentTurns()).map((message) => message.content))
      .toEqual(["PRIVATE_PARENT_CHAT", "Help with this", "Parent answer"]);
  });

  it("sends a PC agent's request straight to the PC, without the @mention", async () => {
    runTurn.mockClear();
    const runTask = vi.fn(async () => ({
      ok: true,
      summary: "Notepad has your list, sir.",
      data: { proof: { passed: true, evidence_ids: ["observed:notepad-list"] } },
    }));
    const memory = new PersistentStore();
    const brain = createBrain({ getConfig: () => cfg, memory, remote: { runTask } });
    expect(await brain.ask("@desktop open notepad and write a list")).toBe(
      "Notepad has your list, sir.",
    );
    expect(runTask).toHaveBeenCalledWith(
      "open notepad and write a list",
      "computer",
      expect.objectContaining({
        onProgress: expect.any(Function),
        onApproval: expect.any(Function),
      }),
    );
    expect(runTurn).not.toHaveBeenCalled();
    const [user] = await memory.recentTurns();
    expect(user).toMatchObject({
      content: "open notepad and write a list",
      display: "@desktop open notepad and write a list",
    });
  });

  it("runs research locally with only read tools and saves the reply while a PC is paired", async () => {
    runTurn.mockClear();
    const runTask = vi.fn();
    const memory = new PersistentStore();
    const brain = createBrain({ getConfig: () => cfg, memory, remote: { runTask } });
    await brain.ask("Research Europa Clipper", undefined, undefined, "research");
    expect(runTask).not.toHaveBeenCalled();
    const [messages, , dispatchDeps, , fullTools] = runTurn.mock.calls[0]!;
    expect(messages[0]!.content).toMatch(/directly on this phone/);
    expect(dispatchDeps).toMatchObject({ informationOnly: true, maxToolRounds: 10 });
    expect(dispatchDeps!.onlyTools!.has("read_webpage")).toBe(true);
    expect(fullTools!.map((t) => t.name)).not.toContain("pc_task");
    expect((await memory.recentTurns()).map((t) => t.role)).toEqual(["user", "assistant"]);
  });

  it("gives a phone agent its groups and brief, and research a phone turn with no PC", async () => {
    runTurn.mockClear();
    const brain = createBrain({
      getConfig: () => cfg,
      memory: new PersistentStore(),
      platform: nativePlatform,
    });
    await brain.ask("what's in my downloads", undefined, undefined, "files");
    const [messages, tools, deps] = runTurn.mock.calls[0]!;
    expect(messages[0]!.content).toMatch(/AGENT: FILES/);
    expect(tools!.some((t) => t.name === "list_directory")).toBe(true);
    expect(deps!.onlyTools).toBeUndefined();
    await brain.ask("tell the research agent to compare budget phones");
    expect(runTurn.mock.calls[1]![0][0]!.content).toMatch(/AGENT: RESEARCH/);
    expect(runTurn.mock.calls[1]![0].at(-1)).toMatchObject({ content: "compare budget phones" });
  });
});
