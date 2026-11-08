import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("../tools/httpClient", () => ({ inTauri: () => true }));

let syncStopOverlay: typeof import("./stopOverlay").syncStopOverlay;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (command: string) =>
    command === "plugin:phone|poll_stop_overlay" ? { seq: 0, visible: true } : { ok: true });
  ({ syncStopOverlay } = await import("./stopOverlay"));
});

afterEach(() => {
  syncStopOverlay(false, () => {});
  vi.useRealTimers();
});

const shows = () => invokeMock.mock.calls.filter(([command]) => command === "plugin:phone|show_stop_overlay");

describe("native STOP overlay reconciliation", () => {
  it("restores a natively hidden overlay even when desired visibility stays true", async () => {
    const onStop = vi.fn();
    syncStopOverlay(true, onStop);
    await vi.advanceTimersByTimeAsync(250);
    syncStopOverlay(true, onStop);
    expect(shows()).toHaveLength(1);
    invokeMock.mockResolvedValueOnce({ seq: 0, visible: false });
    await vi.advanceTimersByTimeAsync(250);
    expect(shows()).toHaveLength(2);
    expect(onStop).not.toHaveBeenCalled();
  });

  it("uses the current stop handler across consecutive owners", async () => {
    const first = vi.fn();
    const second = vi.fn();
    syncStopOverlay(true, first);
    await vi.advanceTimersByTimeAsync(250);
    syncStopOverlay(true, second);
    invokeMock.mockResolvedValueOnce({ seq: 1, visible: true });
    await vi.advanceTimersByTimeAsync(250);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it("does not resurrect an overlay from a poll completed after STOP", async () => {
    syncStopOverlay(true, vi.fn());
    let resolvePoll!: (value: unknown) => void;
    invokeMock.mockImplementationOnce(() => new Promise((resolve) => { resolvePoll = resolve; }));
    await vi.advanceTimersByTimeAsync(250);
    syncStopOverlay(false, vi.fn());
    resolvePoll({ seq: 0, visible: false });
    await vi.advanceTimersByTimeAsync(500);
    expect(shows()).toHaveLength(1);
  });

  it("ignores stale poll replies from the preceding run", async () => {
    const onStop = vi.fn();
    syncStopOverlay(true, onStop);
    let resolvePoll!: (value: unknown) => void;
    invokeMock.mockImplementationOnce(() => new Promise((resolve) => { resolvePoll = resolve; }));
    await vi.advanceTimersByTimeAsync(250);
    syncStopOverlay(false, onStop);
    syncStopOverlay(true, onStop);
    await vi.advanceTimersByTimeAsync(250);
    resolvePoll({ seq: 99, visible: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(shows()).toHaveLength(2);
    expect(onStop).not.toHaveBeenCalled();
  });
});
