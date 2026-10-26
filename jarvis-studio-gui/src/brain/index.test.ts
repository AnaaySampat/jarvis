import { describe, expect, it, vi } from "vitest";
import type { BrainConfig } from "./config";
import type { ChatMessage, ToolResult } from "./types";
import * as httpTools from "./tools/http";
import { androidPlatform } from "./platform";

const runTurn = vi.fn(
  async (
    _messages: ChatMessage[],
    _tools?: Array<{ name: string }>,
    _deps?: { onlyTools?: ReadonlySet<string> },
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
        platform: { ...androidPlatform, direct: { ...androidPlatform.direct, readNotifications } },
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
    const brain = createBrain({ getConfig: () => cfg, memory });
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
    expect(runTask).toHaveBeenCalledWith("open notepad and write a list", "computer");
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
    const brain = createBrain({ getConfig: () => cfg, memory: new PersistentStore() });
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
