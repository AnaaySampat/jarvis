import { useEffect } from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { timeLeft, useActivityTimers, validTimers } from "./timers";

let renderer, controls, host, storage;
function App() {
  const state = useActivityTimers(host);
  useEffect(() => {
    controls = state;
  });
  return null;
}
async function mount() {
  await act(async () => {
    renderer = create(<App />);
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(100000);
  storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k) => storage.get(k),
    setItem: (k, v) => storage.set(k, v),
  });
  host = {
    startTimer: vi.fn(async ({ token, seconds, label }) => ({
      ok: true,
      summary: "Started",
      timers: [
        {
          id: token,
          seconds,
          label,
          deadline: Date.now() + seconds * 1000,
          state: "running",
        },
      ],
    })),
    cancelTimer: vi.fn(async () => ({ ok: true })),
  };
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("persists the acknowledged deadline and prevents accidental duplicate starts after reload", async () => {
  await mount();
  await act(async () => {
    await controls.start(60, "Step 2");
  });
  const id = controls.timers[0].id;
  await act(async () => renderer.unmount());
  await mount();
  await act(async () => {
    expect((await controls.start(60, "Step 3")).ok).toBe(false);
  });
  expect(host.startTimer).toHaveBeenCalledTimes(1);
  expect(controls.timers[0].id).toBe(id);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20000);
  });
  expect(timeLeft(controls.timers[0].deadline, controls.now)).toBe("0:40");
});
it("cancels by ID and keeps a timer running if the backend rejects cancellation", async () => {
  await mount();
  await act(async () => {
    await controls.start(60, "Step 2");
  });
  const id = controls.timers[0].id;
  host.cancelTimer.mockResolvedValueOnce({
    ok: false,
    summary: "Disconnected",
  });
  await act(async () => {
    await controls.cancel(id);
  });
  expect(controls.error).toBe("Disconnected");
  expect(controls.timers[0].state).toBe("running");
  await act(async () => {
    await controls.cancel(id);
  });
  expect(host.cancelTimer).toHaveBeenLastCalledWith(id);
  expect(controls.timers[0].state).toBe("cancelled");
});
it("does not replace a new timer with a stale snapshot from before its start", async () => {
  let finish;
  host.listTimers = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await mount();
  await act(async () => {
    await controls.start(60, "Step 1");
  });
  await act(async () => {
    finish({ ok: true, timers: [] });
  });
  expect(controls.timers).toHaveLength(1);
});
it("rejects malformed timer data and derives remaining time from the absolute deadline", () => {
  expect(validTimers([{}, { id: "bad", deadline: Infinity }, null])).toEqual(
    [],
  );
  expect(timeLeft(101000, 100001)).toBe("0:01");
  expect(timeLeft(101000, 102000)).toBe("0:00");
});
it("reuses a durable start token after an uncertain acknowledgement", async () => {
  host.listTimers = vi.fn(() => new Promise(() => {}));
  host.startTimer.mockRejectedValueOnce(new Error("Acknowledgement timed out"));
  await mount();
  await act(async () => {
    expect((await controls.start(60, "Step 1")).ok).toBe(false);
  });
  await act(async () => {
    expect((await controls.start(60, "Step 1")).ok).toBe(true);
  });
  expect(host.startTimer.mock.calls[0][0].token).toBe(
    host.startTimer.mock.calls[1][0].token,
  );
});
it("keeps dismissed completion receipts hidden across later snapshots", async () => {
  const finished = {
    id: "completed",
    seconds: 60,
    label: "Step 1",
    deadline: 99000,
    state: "finished",
  };
  host.listTimers = vi.fn(async () => ({ ok: true, timers: [finished] }));
  await mount();
  expect(controls.timers).toHaveLength(1);
  await act(async () => {
    controls.dismiss("completed");
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(controls.timers).toEqual([]);
});
