import { act, create } from "react-test-renderer";
import { useEffect } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ call: vi.fn(), subscribe: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ addPluginListener: native.subscribe }));
vi.mock("../brain/platform/appUpdate", async (original) => ({ ...await original(), appUpdate: native.call }));
import { useAppUpdate } from "./useAppUpdate";
let hook, view;
const release = { id: "v3.0.0", versionName: "3.0.0", features: [], fixes: [] };
function Harness({ blocked = false }) {
  const current = useAppUpdate({ enabled: true, blocked, channel: "stable" });
  useEffect(() => { hook = current; }, [current]);
  return null;
}
beforeEach(() => {
  vi.stubGlobal("document", { visibilityState: "visible", addEventListener: vi.fn(), removeEventListener: vi.fn() });
  native.call.mockReset(); native.subscribe.mockResolvedValue({ unregister: vi.fn() });
  native.call.mockResolvedValue({ release, eligible: true, phase: "available" });
});
afterEach(async () => { await act(async () => view?.unmount()); vi.unstubAllGlobals(); });
it("queues the popup until the active task ends", async () => {
  await act(async () => { view = create(<Harness blocked />); });
  expect(hook.show).toBe(false);
  await act(async () => view.update(<Harness />));
  expect(hook.show).toBe(true);
});
it("closes immediately while the snooze write is pending, and can reopen from Settings", async () => {
  await act(async () => { view = create(<Harness />); });
  let finish;
  native.call.mockImplementation((action) => action === "snooze" ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve({ release, eligible: true }));
  await act(async () => hook.close());
  expect(hook.show).toBe(false);
  await act(async () => finish({ release, eligible: false }));
  expect(hook.show).toBe(false);
  await act(async () => hook.open());
  expect(hook.show).toBe(true);
});
it("keeps the manual check busy until the network response arrives", async () => {
  await act(async () => { view = create(<Harness />); });
  let finish;
  native.call.mockImplementation((action) => action === "check" ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve({}));
  await act(async () => { void hook.check(); });
  expect(hook.busy).toBe(true);
  await act(async () => finish({ release, eligible: true }));
  expect(hook.busy).toBe(false);
});
