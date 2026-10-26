import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LLMReply } from "./providers";

const replies: LLMReply[] = [];
const seen: string[][] = [];
const seenTools: string[][] = [];
vi.mock("./ask", () => ({
  chatOverLadder: async (convo: Array<{ content: string }>, tools?: Array<{ name: string }>) => {
    seen.push(convo.map((m) => m.content));
    seenTools.push((tools ?? []).map((t) => t.name));
    return replies.shift() ?? { text: "(script exhausted)", toolCalls: [] };
  },
}));
const dispatched: string[] = [];
const results: ToolResult[] = [];
vi.mock("./tools/dispatch", () => ({
  dispatch: async (spec: { type: string }) => {
    dispatched.push(spec.type);
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
import { turnPalette } from "./tools/registry";
import type { ToolDeclaration, ToolResult } from "./types";
import { WorkflowJournal } from "./workflow";

const deps = { config: {} } as unknown as DispatchDeps;
const ask = (text: string) => runTurn([{ role: "user", content: text }], [], deps);

beforeEach(() => {
  replies.length = 0;
  seen.length = 0;
  seenTools.length = 0;
  dispatched.length = 0;
  results.length = 0;
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

describe("runTurn — STOP", () => {
  it("ends the turn on the task's own words, with no model round to recast it", async () => {
    // Live 2026-10-20: STOP mid TV task, then "I wasn't able to complete that task on
    // your TV. Would you like me to try again…?"
    results.push({ ok: false, summary: "Stopped.", error: "cancelled" });
    replies.push(
      {
        text: "",
        toolCalls: [{ id: "c1", name: "tv_control", args: { action: "task", goal: "play rain" } }],
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
  ])("uses the single tool receipt without another model ($status)", async (receipt) => {
    results.push(receipt);
    replies.push(
      { text: "", toolCalls: [{ id: "t", name: "set_timer", args: { seconds: 300 } }] },
      { text: "Timer started.", toolCalls: [] },
    );
    const verifyCompletion = vi.fn();
    const out = await runTurn([{ role: "user", content: "Set a timer for five minutes" }], [], {
      ...deps,
      verifyCompletion,
    });
    expect(verifyCompletion).not.toHaveBeenCalled();
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
    await runTurn([{ role: "user", content: "What time is it?" }], [], {
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
      [],
      { ...deps, verifyCompletion },
    );
    expect(verifyCompletion).toHaveBeenCalledWith(expect.any(String), expect.any(Array), answer);
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
      [],
      { ...deps, journal, verifyCompletion },
    );
    expect(output.reply).toContain("Still unconfirmed: Save the comparison");
    expect(output.reply).not.toContain("Saved your comparison");
    expect(journal.listSuspended()[0]?.completion?.status).toBe("partial");
  });
});

describe("runTurn — said it did it but didn't", () => {
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
    const out = await runTurn([{ role: "user", content: "Research a topic" }], [], {
      ...deps,
      maxToolRounds: 10,
    });
    expect(dispatched).toHaveLength(6);
    expect(out.reply).toBe("Findings with source links.");
    expect(seen.flat().some((s) => s.includes("used every tool call"))).toBe(false);
  });

  it("honours STOP between research rounds", async () => {
    replies.push(call("one"), call("two"));
    const out = await runTurn([{ role: "user", content: "Research a topic" }], [], {
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
    const out = await ask("read my screen and search up what time it starts");
    expect(out.reply).toBe("It starts at 17:00 UTC.");
    expect(seen.at(-1)!.at(-1)).toMatch(/used every tool call/);
  });

  it("falls back to the tools' own words when the model still wants to act", async () => {
    replies.push(call("a"), call("b"), call("c"), call("d"));
    const out = await ask("read my screen and search up what time it starts");
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
  const full = ["open_application", "manage_schedule", "get_news"].map(
    (name) => ({ name, description: name }) as ToolDeclaration,
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
    const out = await runTurn([{ role: "user", content: "alarm at 7 and text mom" }], [], scoped);
    expect(dispatched).toEqual(["clock"]);
    expect(out.toolResults).toHaveLength(1);
    expect(seen[1]!.some((c) => /Not run: that tool isn't available/.test(c))).toBe(true);
  });
});
