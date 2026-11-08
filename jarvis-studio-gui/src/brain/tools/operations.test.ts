import { describe, expect, it } from "vitest";
import { hasSideEffect, operationKey } from "./operations";
import { toSpec } from "./registry";

describe("operation identity", () => {
  it("binds identity to the lowered action regardless of argument order and defaults", async () => {
    expect(await operationKey(toSpec("send_message", { to: " Mom ", text: "hi" }))).toBe(
      await operationKey(toSpec("send_message", { app: "whatsapp", text: "hi", to: "Mom" })),
    );
    expect(await operationKey(toSpec("set_timer", { seconds: 60 }))).not.toBe(
      await operationKey(toSpec("set_timer", { seconds: 120 })),
    );
  });
  it("allows repeat reads but guards mutations of the same mixed-action tool", () => {
    expect(hasSideEffect(toSpec("read_notifications", {}))).toBe(false);
    expect(hasSideEffect(toSpec("manage_schedule", { action: "get" }))).toBe(false);
    expect(hasSideEffect(toSpec("manage_schedule", { action: "add", task: "gym" }))).toBe(true);
    expect(hasSideEffect(toSpec("tv_control", { action: "look" }))).toBe(false);
    expect(hasSideEffect(toSpec("tv_control", { action: "key", target: "ok" }))).toBe(true);
    expect(hasSideEffect(toSpec("phone_task", { goal: "read settings" }))).toBe(true);
  });
});
