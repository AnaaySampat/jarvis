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
