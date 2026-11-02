import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskPasskeyPrompt } from "./taskPasskeyPrompt";

describe("per-task laptop passkey entry", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("requires fresh input for each task without publishing the passkey to UI metadata", async () => {
    const onChange = vi.fn();
    const prompt = new TaskPasskeyPrompt(onChange);
    const first = prompt.request("open Notepad");
    expect(prompt.respond("test-only-passkey")).toBe(true);
    expect(await first).toBe("test-only-passkey");
    expect(onChange.mock.calls).toEqual([[{ goal: "open Notepad" }], [null]]);
    let resolved = false;
    const second = prompt.request("take a screenshot").then((value) => { resolved = true; return value; });
    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toBe(false);
    prompt.respond(null);
    expect(await second).toBeNull();
  });

  it("cancels unanswered or unmounted prompts and never reuses an earlier answer", async () => {
    const onChange = vi.fn();
    const prompt = new TaskPasskeyPrompt(onChange, 100);
    const expired = prompt.request("first task");
    await vi.advanceTimersByTimeAsync(101);
    expect(await expired).toBeNull();
    const closed = prompt.request("second task");
    prompt.dispose();
    expect(await closed).toBeNull();
    expect(prompt.respond("test-only-passkey")).toBe(false);
  });

  it("does not replace a pending request or accept invalid-length input", async () => {
    const prompt = new TaskPasskeyPrompt(vi.fn());
    const first = prompt.request("first task");
    expect(await prompt.request("second task")).toBeNull();
    expect(prompt.respond("short")).toBe(false);
    expect(prompt.respond("x".repeat(129))).toBe(false);
    prompt.respond("  exact-test-passkey  ");
    expect(await first).toBe("  exact-test-passkey  ");
  });
});
