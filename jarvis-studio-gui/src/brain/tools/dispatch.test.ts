/**
 * `onDispatched` — the single place cross-cutting concerns hang off.
 *
 * dispatch() has two callers: the HUD's action buttons and the brain's tool loop.
 * Logging and HUD state-sync were wired only to the first, so the Agent Activity
 * log recorded button presses and NOTHING JARVIS did by voice, and a spoken
 * "make the HUD red" persisted without re-rendering. These pin the property that
 * fixes it: the hook fires for every action, from any caller, success or not.
 */

import { describe, expect, it, vi } from "vitest";
import { dispatch, type DispatchDeps } from "./dispatch";
import type { Platform } from "../platform";
import type { BrainConfig } from "../config";

function makeDeps(onDispatched: DispatchDeps["onDispatched"]) {
  const platform = {
    clock: {
      setAlarm: vi.fn(async () => ({ ok: true, summary: "alarm set" })),
      setTimer: vi.fn(async () => ({ ok: true, summary: "timer set" })),
      showAlarms: vi.fn(async () => ({ ok: true, summary: "" })),
      showTimers: vi.fn(async () => ({ ok: true, summary: "" })),
      dismissTimer: vi.fn(async () => ({ ok: true, summary: "" })),
    },
  } as unknown as Platform;
  const config: BrainConfig = { tier: "groq", model: "m", keys: { groq: ["k"] } };
  return { platform, config, onDispatched } as unknown as DispatchDeps;
}

describe("onDispatched", () => {
  it("distinguishes an unsaved calendar draft from an event with a saved id", async () => {
    const deps = makeDeps(undefined);
    const add = vi.fn(async (): Promise<{ ok: boolean; summary: string; eventId?: number }> => ({
      ok: true,
      summary: "Opened your calendar to add it — tap save.",
    }));
    const remove = vi.fn();
    deps.platform.calendar = { add, remove } as unknown as Platform["calendar"];
    const spec = { type: "schedule", do: "add", time: "23:54", task: "calendar regression" };
    const draft = await dispatch(spec, deps);
    expect(draft.summary).toContain("tap save");
    expect(draft.summary).not.toContain("It's in your calendar too");
    await dispatch({ type: "schedule", do: "remove", task: spec.task }, deps);
    expect(remove).not.toHaveBeenCalled();
    add.mockResolvedValue({ ok: true, summary: "Added to your calendar.", eventId: 7429 });
    expect((await dispatch(spec, deps)).summary).toContain("It's in your calendar too");
    await dispatch({ type: "schedule", do: "remove", task: spec.task }, deps);
    expect(remove).toHaveBeenCalledWith(7429);
  });
  it("blocks agenda mutations and recursive consultation before either handler runs", async () => {
    const seen = vi.fn();
    const consultAgent = vi.fn();
    const deps = { ...makeDeps(seen), informationOnly: true, consultAgent };
    for (const spec of [
      { type: "schedule", do: "add", task: "Unexpected meeting" },
      { type: "consult_agent", agent: "content", question: "Send a message" },
    ]) {
      expect(await dispatch(spec, deps)).toMatchObject({ ok: false, error: "blocked" });
    }
    expect(consultAgent).not.toHaveBeenCalled();
    expect(seen).toHaveBeenCalledTimes(2);
  });
  it("fires for a successful action", async () => {
    const seen = vi.fn();
    const spec = { type: "clock", do: "timer", seconds: 60, label: "tea" };
    const result = await dispatch(spec, makeDeps(seen));
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenCalledWith(spec, result);
  });

  it("fires for a FAILED action too — the activity log needs the failures most", async () => {
    const seen = vi.fn();
    const result = await dispatch({ type: "clock", do: "timer", seconds: 0 }, makeDeps(seen));
    expect(result.ok).toBe(false);
    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ type: "clock" }), result);
  });

  it("fires for an unknown action rather than silently dropping it", async () => {
    const seen = vi.fn();
    await dispatch({ type: "not_a_real_tool" }, makeDeps(seen));
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("carries the screen config through, which is what re-renders the HUD", async () => {
    const seen = vi.fn();
    await dispatch({ type: "screen", do: "accent", value: "#ff0000" }, makeDeps(seen));
    const [, result] = seen.mock.calls[0]!;
    expect(result.data).toBeDefined();
  });

  it("never lets a broken observer fail the action it observes", async () => {
    const boom = vi.fn(() => {
      throw new Error("panel exploded");
    });
    const result = await dispatch({ type: "clock", do: "timer", seconds: 60 }, makeDeps(boom));
    expect(result.ok).toBe(true);
  });

  it("is optional — dispatch works with no observer at all", async () => {
    const result = await dispatch({ type: "clock", do: "timer", seconds: 60 }, makeDeps(undefined));
    expect(result.ok).toBe(true);
  });
});

describe("media search recovery", () => {
  it("continues a normal play request through the operator but never widens a restricted PC/WhatsApp scope", async () => {
    const deps = makeDeps(undefined);
    const failure = { ok: false, summary: "Nothing started", error: "not_playing" };
    const device = vi.fn(async () => failure);
    const isEnabled = vi.fn(async () => false);
    deps.platform.direct = { device } as unknown as Platform["direct"];
    deps.platform.phone = { isEnabled } as unknown as Platform["phone"];
    deps.platform.openAccessibilitySettings = vi.fn(async () => ({
      ok: true,
      summary: "Opened Accessibility",
    }));
    const spec = { type: "play_media", query: "lofi instrumental", app: "spotify" };
    expect((await dispatch(spec, deps)).error).toBe("accessibility_disabled");
    expect(isEnabled).toHaveBeenCalledOnce();
    isEnabled.mockClear();
    expect(await dispatch(spec, { ...deps, onlyTools: new Set(["play_media"]) })).toEqual(failure);
    expect(isEnabled).not.toHaveBeenCalled();
  });
});

describe("one-step messages and calls", () => {
  const target = { name: "Mom", number: "+91 98200 12345", route: "chat", app: "whatsapp" };

  function commDeps(opts: {
    lookup?: unknown;
    decision?: "allow" | "deny" | "allow_task";
    noApprover?: boolean;
  }) {
    const direct = {
      device: vi.fn(async () => ({ ok: true, summary: "done" })),
      resolveContact: vi.fn(async () => opts.lookup ?? { ok: true, target }),
      message: vi.fn(async () => ({ ok: true, summary: "Sent to Mom on WhatsApp." })),
      call: vi.fn(async () => ({ ok: true, summary: "Calling Mom." })),
      readNotifications: vi.fn(async () => ({
        ok: true,
        summary: "No notifications are showing.",
      })),
    };
    const authorizePhoneAction = vi.fn(async () => opts.decision ?? "allow");
    const deps = {
      platform: { direct } as unknown as Platform,
      config: { tier: "groq", model: "m", keys: { groq: ["k"] } },
      ...(opts.noApprover ? {} : { authorizePhoneAction }),
    } as unknown as DispatchDeps;
    return { deps, direct, authorizePhoneAction };
  }

  it("looks the person up, asks about exactly that person and text, then sends", async () => {
    const { deps, direct, authorizePhoneAction } = commDeps({});
    const res = await dispatch(
      { type: "message", to: "mom", text: "on my way", app: "whatsapp" },
      deps,
    );
    expect(direct.resolveContact).toHaveBeenCalledWith("mom", "whatsapp");
    expect(authorizePhoneAction).toHaveBeenCalledWith(
      expect.objectContaining({
        risk: "R2",
        action: "message",
        target: "Mom (+91 98200 12345) on WhatsApp",
        reason: "send “on my way” to Mom (+91 98200 12345) on WhatsApp",
      }),
    );
    expect(direct.message).toHaveBeenCalledWith(target, "on my way");
    expect(res).toEqual({ ok: true, summary: "Sent to Mom on WhatsApp." });
  });

  it("sends nothing when the user denies", async () => {
    const { deps, direct } = commDeps({ decision: "deny" });
    const res = await dispatch({ type: "message", to: "mom", text: "hi" }, deps);
    expect(direct.message).not.toHaveBeenCalled();
    expect(res).toMatchObject({ ok: false, error: "approval_denied" });
  });

  it("refuses outright when there is no way to ask", async () => {
    const { deps, direct } = commDeps({ noApprover: true });
    const res = await dispatch({ type: "call", to: "dad" }, deps);
    expect(direct.call).not.toHaveBeenCalled();
    expect(res).toMatchObject({ ok: false, error: "approval_unavailable" });
  });

  it("passes an ambiguous lookup back as a question, without asking to send", async () => {
    const lookup = {
      ok: false,
      summary: 'More than one contact matches "Rahul": Rahul M, Rahul S. Which one?',
      error: "ambiguous",
    };
    const { deps, direct, authorizePhoneAction } = commDeps({ lookup });
    const res = await dispatch({ type: "message", to: "Rahul", text: "hi" }, deps);
    expect(authorizePhoneAction).not.toHaveBeenCalled();
    expect(direct.message).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: false, summary: lookup.summary, error: "ambiguous" });
  });

  it("calls through the phone app with the approved target", async () => {
    const { deps, direct, authorizePhoneAction } = commDeps({});
    await dispatch({ type: "call", to: "mom" }, deps);
    expect(direct.resolveContact).toHaveBeenCalledWith("mom", "phone");
    expect(authorizePhoneAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "call", reason: "call Mom (+91 98200 12345)" }),
    );
    expect(direct.call).toHaveBeenCalledWith(target, false);
  });

  it("places a WhatsApp video call, saying so in the approval", async () => {
    const { deps, direct, authorizePhoneAction } = commDeps({});
    await dispatch({ type: "call", to: "mom", app: "whatsapp", video: true }, deps);
    expect(direct.resolveContact).toHaveBeenCalledWith("mom", "whatsapp");
    expect(authorizePhoneAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "call",
        reason: "video call Mom (+91 98200 12345) on WhatsApp",
      }),
    );
    expect(direct.call).toHaveBeenCalledWith(target, true);
  });

  it("asks for what's missing before touching the phone", async () => {
    const { deps, direct } = commDeps({});
    expect((await dispatch({ type: "message", to: "mom", text: " " }, deps)).ok).toBe(false);
    expect((await dispatch({ type: "call", to: "" }, deps)).ok).toBe(false);
    expect(direct.resolveContact).not.toHaveBeenCalled();
  });

  it("treats a brightness call with no level as auto, never 0%", async () => {
    const { deps, direct } = commDeps({});
    await dispatch({ type: "device", do: "brightness" }, deps);
    expect(direct.device).toHaveBeenCalledWith({ action: "brightness", value: -1 });
    await dispatch({ type: "device", do: "Flashlight_On" }, deps);
    expect(direct.device).toHaveBeenLastCalledWith({ action: "flashlight_on", value: 0 });
  });
});

describe("wake_pc", () => {
  it("goes to the PC link's wake, and says so when no PC is paired", async () => {
    const wake = vi.fn(async () => ({ ok: true, summary: "Woke the PC — it's connected now." }));
    const remote = { runTask: vi.fn(), wake };
    const deps = { ...makeDeps(undefined), remote };
    await expect(dispatch({ type: "wake_pc" }, deps)).resolves.toMatchObject({ ok: true });
    expect(wake).toHaveBeenCalledOnce();
    await expect(dispatch({ type: "wake_pc" }, makeDeps(undefined))).resolves.toMatchObject({
      ok: false,
      summary: "No PC is paired yet.",
    });
  });
});

describe("pc_task hand-off cards", () => {
  it("shows the phone asking a PC agent mid-turn and what it hands back", async () => {
    const runTask = vi.fn(async () => ({
      ok: true,
      summary: "₹4,210 on IndiGo.",
      data: { findings: ["6E 5321, Fri 06:10 (google.com/flights)"] },
    }));
    const said: unknown[] = [];
    const deps = {
      ...makeDeps(undefined),
      remote: { runTask },
      onAgentEvent: (ev: { event: string; data?: unknown }) => said.push(ev),
    };
    await dispatch({ type: "pc_task", goal: "find the cheapest flight", kind: "research" }, deps);
    expect(said).toEqual([
      {
        event: "agent_message",
        data: {
          from: "phone",
          to: "research",
          kind: "ask",
          text: "find the cheapest flight",
          items: [],
        },
      },
      {
        event: "agent_message",
        data: {
          from: "research",
          to: "phone",
          kind: "answer",
          text: "₹4,210 on IndiGo.",
          items: ["6E 5321, Fri 06:10 (google.com/flights)"],
        },
      },
    ]);
  });

  it("a picked PC agent just gets the request — its result is the reply", async () => {
    const said: { event: string; data?: Record<string, unknown> }[] = [];
    const deps = {
      ...makeDeps(undefined),
      remote: { runTask: vi.fn(async () => ({ ok: true, summary: "Done." })) },
      onAgentEvent: (ev: { event: string; data?: Record<string, unknown> }) => said.push(ev),
    };
    await dispatch({ type: "pc_task", goal: "open Notepad", kind: "computer", picked: true }, deps);
    expect(said.map((e) => [e.data?.from, e.data?.to, e.data?.kind])).toEqual([
      ["phone", "desktop", "handover"],
    ]);
  });
});
