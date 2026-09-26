import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LLMReply } from "./providers";

const replies: LLMReply[] = [];
const seen: string[][] = [];
vi.mock("./ask", () => ({
  chatOverLadder: async (convo: Array<{ content: string }>) => {
    seen.push(convo.map((m) => m.content));
    return replies.shift() ?? { text: "(script exhausted)", toolCalls: [] };
  },
}));
const dispatched: string[] = [];
vi.mock("./tools/dispatch", () => ({
  dispatch: async (spec: { type: string }) => {
    dispatched.push(spec.type);
    return { ok: true, summary: "Found it: 55.2 GB used." };
  },
}));

import { answeredPhoneWithoutLooking, claimedWithoutActing, runTurn } from "./loop";
import type { DispatchDeps } from "./tools/dispatch";

const deps = { config: {} } as unknown as DispatchDeps;
const ask = (text: string) => runTurn([{ role: "user", content: text }], [], deps);

beforeEach(() => {
  replies.length = 0;
  seen.length = 0;
  dispatched.length = 0;
});

describe("runTurn — said it did it but didn't", () => {
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
    expect(out.reply).toBe("I've opened it.");
  });

  it("leaves questions and genuine tool-backed replies alone", () => {
    expect(claimedWithoutActing("what's the capital of France?", "It's Paris.", false)).toBe(false);
    expect(claimedWithoutActing("set a timer for 5 minutes", "I've set it.", true)).toBe(false);
    expect(claimedWithoutActing("set a timer for 5 minutes", "I've set it.", false)).toBe(true);
  });
});

describe("runTurn — answered about the phone without looking", () => {
  it("sends a phone question back to look instead of answering from memory", async () => {
    // Live 2026-09-26, fallback chat model: "Android 14" for a phone on Android 16.
    replies.push(
      { text: "Phone info: Android 14.", toolCalls: [] },
      { text: "", toolCalls: [{ id: "c1", name: "phone_task", args: { goal: "find the Android version" } }] },
      { text: "Android 16.", toolCalls: [] },
    );
    const out = await ask("on my phone, check Settings and tell me the Android version");
    expect(dispatched).toEqual(["phone_task"]);
    expect(out.reply).toBe("Android 16.");
    expect(seen[1]!.at(-1)).toMatch(/didn't come from the phone/);
  });

  it("only for requests about the phone, and not once a tool ran", () => {
    expect(answeredPhoneWithoutLooking("what's my phone's device name?", false)).toBe(true);
    expect(answeredPhoneWithoutLooking("how long has it been on? check in Settings", false)).toBe(true);
    expect(answeredPhoneWithoutLooking("what's the tallest mountain?", false)).toBe(false);
    expect(answeredPhoneWithoutLooking("on my phone, what's the Android version?", true)).toBe(false);
  });
});
