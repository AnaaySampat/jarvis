import { afterEach, describe, expect, it, vi } from "vitest";

class TestStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  dump(): string {
    return JSON.stringify([...this.values.values()]);
  }
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
  vi.resetModules();
});

describe("procedural learning storage migration", () => {
  it("purges both raw replay caches on read without requiring a new save", async () => {
    const storage = new TestStorage();
    storage.setItem(
      "jarvis_phone_playbooks",
      JSON.stringify({ goal: "send secret", commands: [{ do: "type", text: "VERY_SECRET" }] }),
    );
    storage.setItem(
      "jarvis_phone_workflows_v2",
      JSON.stringify({ raw: "captured OTP 123456", target: 17 }),
    );
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: storage,
    });
    vi.resetModules();

    const learning = await import("./proceduralLearning");
    learning.listPlaybooks();

    expect(storage.getItem("jarvis_phone_playbooks")).toBeNull();
    expect(storage.getItem("jarvis_phone_workflows_v2")).toBeNull();
    expect(storage.dump()).not.toContain("VERY_SECRET");
  });
});
