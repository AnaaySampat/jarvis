import { describe, expect, it, vi } from "vitest";
import type { BrainConfig } from "./config";
import type { ChatMessage, ToolResult } from "./types";

const runTurn = vi.fn(
  async (
    _messages: ChatMessage[],
    _tools?: Array<{ name: string }>,
    _deps?: { onlyTools?: ReadonlySet<string> },
    _onFallback?: unknown,
    _fullTools?: Array<{ name: string }>,
  ): Promise<{ reply: string; toolResults: ToolResult[]; calledTools: string[] }> => ({
    reply: "Done, sir.",
    toolResults: [],
    calledTools: [],
  }),
);
vi.mock("./loop", () => ({ runTurn }));

const { createBrain } = await import("./index");
const { PersistentStore } = await import("./memory/store");

const cfg: BrainConfig = { tier: "groq", model: "openai/gpt-oss-120b", keys: { groq: ["g1"] } };

describe("ask with display text (a routine run)", () => {
  it("sends the full turn to the model but saves what the chat showed", async () => {
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

  it("is ok only when a tool ran and every tool worked", async () => {
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
