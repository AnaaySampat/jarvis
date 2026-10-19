import { describe, expect, it, vi } from "vitest";
import type { BrainConfig } from "./config";
import type { ChatMessage } from "./types";

const runTurn = vi.fn(async (_messages: ChatMessage[]) => ({
  reply: "Done, sir.",
  toolResults: [],
  calledTools: [],
}));
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
