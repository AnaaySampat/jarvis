import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { androidPlatform } from "./index";

describe("Android durable cancellation polling", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("returns an abort signal when native task status is unknowable", async () => {
    invokeMock.mockRejectedValueOnce(new Error("bridge unavailable"));

    await expect(androidPlatform.phone.isTaskCancelled?.("task-1")).resolves.toBe(true);
  });
});
