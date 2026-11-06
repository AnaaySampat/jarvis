import { act, create } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import { useQuickStart } from "./useQuickStart";

afterEach(() => vi.unstubAllGlobals());

it("shows once, stays dismissed after remount and can be replayed", async () => {
  const storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  });
  let state;
  function Harness() { state = useQuickStart(); return null; }
  let view;
  await act(async () => { view = create(<Harness />); });
  expect(state.open).toBe(true);
  await act(async () => state.finish());
  expect(state.open).toBe(false);
  await act(async () => view.unmount());
  await act(async () => { view = create(<Harness />); });
  expect(state.open).toBe(false);
  await act(async () => state.replay());
  expect(state.open).toBe(true);
  await act(async () => state.finish());
  expect(state.open).toBe(false);
  await act(async () => view.unmount());
});

it("allows the introduction to close when device storage is unavailable", async () => {
  vi.stubGlobal("localStorage", {
    getItem: () => { throw new Error("Storage unavailable"); },
    setItem: () => { throw new Error("Storage unavailable"); },
  });
  let state;
  function Harness() { state = useQuickStart(); return null; }
  let view;
  await act(async () => { view = create(<Harness />); });
  expect(state.open).toBe(true);
  await act(async () => state.finish());
  expect(state.open).toBe(false);
  await act(async () => view.unmount());
});
