import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NativeOutcomeTracker } from "./nativeOutcomes";

describe("native action outcome reconciliation", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("reports an unknown timeout and later recovers the original successful reply without re-execution", async () => {
    const tracker = new NativeOutcomeTracker();
    let finish!: (r: { ok: boolean; summary: string }) => void;
    const invoke = vi.fn(
      () =>
        new Promise<{ ok: boolean; summary: string }>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = tracker.call(invoke, 15_000);
    await vi.advanceTimersByTimeAsync(15_000);
    const unknown = await pending;
    expect(unknown).toMatchObject({ ok: false, code: "native_outcome_unknown" });
    expect(unknown.summary).not.toMatch(/failed/i);
    finish({ ok: true, summary: "Message sent." });
    await Promise.resolve();
    expect(await tracker.check(unknown.nativeOutcomeId!)).toMatchObject({
      ok: true,
      summary: "Message sent.",
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps a rejected transport receipt unknown rather than assuming the action failed", async () => {
    const tracker = new NativeOutcomeTracker();
    const invoke = vi.fn(async () => {
      throw new Error("connection lost");
    });
    const reply = await tracker.call(invoke, 15_000);
    expect(reply.code).toBe("native_outcome_unknown");
    expect((await tracker.check(reply.nativeOutcomeId!)).code).toBe("native_outcome_unknown");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("inspects current state without promoting an unfinished action or replaying it", async () => {
    const tracker = new NativeOutcomeTracker();
    const invoke = vi.fn(() => new Promise<never>(() => {}));
    const inspect = vi.fn(async () => "The current volume is 40%.");
    const pending = tracker.call(invoke, 100, inspect);
    await vi.advanceTimersByTimeAsync(100);
    const reply = await pending;
    const checked = await tracker.check(reply.nativeOutcomeId!);
    expect(checked).toMatchObject({ ok: false, code: "native_outcome_unknown" });
    expect(checked.summary).toContain("40%");
    expect(inspect).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledOnce();
  });

  it("does not invent a failed or successful result after process-state loss", async () => {
    const checked = await new NativeOutcomeTracker().check("receipt-from-before-restart");
    expect(checked).toMatchObject({ ok: false, code: "native_outcome_unknown" });
    expect(checked.summary).toContain("restart");
  });

  it("notifies late receipt observers once without repeating the invocation", async () => {
    const tracker = new NativeOutcomeTracker();
    let finish!: (r: { ok: boolean; summary: string }) => void;
    const pending = tracker.call(
      () =>
        new Promise<{ ok: boolean; summary: string }>((resolve) => {
          finish = resolve;
        }),
      100,
    );
    await vi.advanceTimersByTimeAsync(100);
    const unknown = await pending;
    const listener = vi.fn();
    tracker.watch(unknown.nativeOutcomeId!, listener);
    finish({ ok: true, summary: "Confirmed." });
    await vi.advanceTimersByTimeAsync(0);
    expect(listener).toHaveBeenCalledOnce();
  });

  it("keeps malformed native replies unknown", async () => {
    const reply = await new NativeOutcomeTracker().call(async () => ({}), 100);
    expect(reply.code).toBe("native_outcome_unknown");
    expect(reply.nativeOutcomeId).toBeTruthy();
  });

  it("retains an actual negative acknowledgement that arrives late", async () => {
    const tracker = new NativeOutcomeTracker();
    let finish!: (r: { ok: boolean; summary: string; code: string }) => void;
    const pending = tracker.call(
      () =>
        new Promise<{ ok: boolean; summary: string; code: string }>((r) => {
          finish = r;
        }),
      100,
    );
    await vi.advanceTimersByTimeAsync(100);
    const reply = await pending;
    finish({ ok: false, summary: "Permission denied before sending.", code: "permission_denied" });
    await Promise.resolve();
    expect(await tracker.check(reply.nativeOutcomeId!)).toMatchObject({
      ok: false,
      code: "permission_denied",
    });
  });
});
