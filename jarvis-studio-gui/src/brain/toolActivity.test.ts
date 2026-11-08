import { describe, expect, it, vi } from "vitest";
import { dispatch, type DispatchDeps } from "./tools/dispatch";
import {
  activityToolName,
  finishToolActivity,
  toolActivity,
  type ToolActivityEvent,
} from "./toolActivity";
import type { ToolResult } from "./types";

const fixture = () => {
  const events: ToolActivityEvent[] = [];
  const deps = {
    config: { tier: "groq", model: "m", keys: {} },
    platform: {},
    onToolActivity: (event: ToolActivityEvent) => events.push(event),
  } as unknown as DispatchDeps;
  return { events, deps };
};
describe("tool execution activity", () => {
  it("emits running before the effect resolves and keeps one invocation identity", async () => {
    const { events, deps } = fixture();
    let complete!: (result: ToolResult) => void;
    const pending = new Promise<ToolResult>((resolve) => {
      complete = resolve;
    });
    deps.platform.system = {
      setVolume: vi.fn(() => pending),
    } as unknown as DispatchDeps["platform"]["system"];
    const execution = dispatch({ type: "set_volume", level: 40 }, deps);
    expect(events.map((e) => e.state)).toEqual(["queued", "running"]);
    complete({ ok: true, summary: "Volume confirmed" });
    await execution;
    expect(events.map((e) => e.state)).toEqual(["queued", "running", "completed"]);
    expect(new Set(events.map((e) => e.id)).size).toBe(1);
    expect(events[2]).toMatchObject({
      tool: "set_volume",
      input: "Media volume: 40%",
      elapsedMs: expect.any(Number),
    });
  });
  it("shows a permission rejection as not run without starting native", async () => {
    const { events, deps } = fixture();
    const setVolume = vi.fn();
    deps.platform.system = { setVolume } as unknown as DispatchDeps["platform"]["system"];
    deps.getToolAvailability = async () => ({ set_volume: { state: "permission_required" } });
    await dispatch({ type: "set_volume", level: 40 }, deps);
    expect(events.map((e) => e.state)).toEqual(["queued", "not_run"]);
    expect(setVolume).not.toHaveBeenCalled();
  });
  it("retains unconfirmed Clock intents and unproved delegated success", async () => {
    const { events, deps } = fixture();
    deps.platform.clock = {
      setTimer: async () => ({
        ok: true,
        summary: "Clock accepted",
        verification: { status: "unverified", method: "clock_intent" },
      }),
    } as unknown as DispatchDeps["platform"]["clock"];
    await dispatch({ type: "clock", do: "timer", seconds: 300 }, deps);
    expect(events.at(-1)).toMatchObject({ state: "unconfirmed", tool: "set_timer" });
    finishToolActivity(
      deps.onToolActivity,
      toolActivity("phone_task"),
      { ok: true, summary: "Done" },
      Date.now(),
    );
    expect(events.at(-1)!.state).toBe("unconfirmed");
  });
  it.each(["allow", "deny"] as const)(
    "shows the approval wait and honours %s",
    async (decision) => {
      const { events, deps } = fixture();
      let answer!: (value: "allow" | "deny") => void;
      deps.authorizePhoneAction = () =>
        new Promise((resolve) => {
          answer = resolve;
        });
      const message = vi.fn(async () => ({ ok: true, summary: "Sent SECRET message" }));
      deps.platform.direct = {
        resolveContact: async () => ({
          ok: true,
          target: { name: "SECRET contact", number: "123456789", app: "sms", route: "sms" },
        }),
        message,
      } as unknown as DispatchDeps["platform"]["direct"];
      const execution = dispatch(
        { type: "message", to: "SECRET contact", text: "SECRET message", app: "sms" },
        deps,
      );
      await vi.waitFor(() => expect(events.at(-1)?.state).toBe("waiting_for_approval"));
      expect(message).not.toHaveBeenCalled();
      answer(decision);
      await execution;
      expect(events.at(-1)?.state).toBe(decision === "allow" ? "completed" : "not_run");
      expect(message).toHaveBeenCalledTimes(decision === "allow" ? 1 : 0);
      expect(JSON.stringify(events)).not.toContain("SECRET");
    },
  );
  it("treats an exception after effect dispatch as uncertain and hides its payload", async () => {
    const { events, deps } = fixture();
    deps.platform.system = {
      setVolume: async () => {
        throw new Error("SECRET token");
      },
    } as unknown as DispatchDeps["platform"]["system"];
    await expect(dispatch({ type: "set_volume", level: 40 }, deps)).rejects.toThrow("SECRET token");
    expect(events.at(-1)!.state).toBe("unconfirmed");
    expect(JSON.stringify(events)).not.toContain("SECRET");
  });
  it("never lets a broken activity observer prevent an action", async () => {
    const { deps } = fixture();
    deps.onToolActivity = () => {
      throw new Error("UI failed");
    };
    expect((await dispatch({ type: "time" }, deps)).ok).toBe(true);
  });
  it("does not expose raw inputs or summaries, and tolerates rejected malformed arguments", () => {
    const { events, deps } = fixture();
    const context = toolActivity("web_search", {
      query: "SECRET key",
      headers: { Authorization: "SECRET" },
    });
    finishToolActivity(
      deps.onToolActivity,
      context,
      { ok: false, error: "invalid_tool_call", summary: "SECRET" },
      Date.now(),
      false,
    );
    expect(JSON.stringify(events)).not.toContain("SECRET");
    expect(events[0].state).toBe("not_run");
    expect(toolActivity("unknown_SECRET", null as unknown as Record<string, unknown>).tool).toBe(
      "unknown_tool",
    );
    expect(activityToolName({ type: "clock", do: "alarm" })).toBe("set_alarm");
  });
});
