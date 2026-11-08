import { describe, expect, it } from "vitest";
import { toolPalette, turnPalette } from "./registry";
import { parseToolArguments, validateToolCall } from "./validation";

const full = toolPalette(
  { tier: "gemini", model: "m", keys: { gemini: ["k"] } },
  {
    pcPaired: true,
    tvPaired: true,
  },
);
const palette = turnPalette(full, new Set());
const validate = (name: string, args: unknown) =>
  validateToolCall({ id: "call", name, args: args as Record<string, unknown> }, [
    ...full,
    ...palette,
  ]);

describe("tool boundary validation", () => {
  it.each([
    ["set_volume", { level: "40" }],
    ["set_volume", { level: 101 }],
    ["set_volume", { level: NaN }],
    ["set_volume", { level: Infinity }],
    ["set_timer", { seconds: 1.5 }],
    ["set_timer", { seconds: 0 }],
    ["set_timer", { seconds: 2 ** 40 }],
    ["set_alarm", { hour: 8 }],
    ["set_alarm", { hour: 8, minute: 60 }],
    ["set_alarm", { hour: -1, minute: 0 }],
    ["set_alarm", { hour: 8, minute: 0, days: "monday-ish" }],
    ["open_application", { name: " " }],
    ["send_message", { to: "Mom" }],
    ["send_message", { to: "Mom", text: " " }],
    ["get_time", { type: "message" }],
    ["phone_task", { goal: "open settings", stay_in_app: "false" }],
    ["phone_task", null],
    ["phone_task", []],
    ["phone_task", "open settings"],
    ["device_control", { action: "factory_reset" }],
    ["manage_schedule", { action: "edit", task: "gym" }],
    ["set_my_location", { action: "set" }],
    ["manage_routine", { action: "add", name: "morning" }],
    ["customize_screen", { action: "move_panel", panel: "weather", direction: "somewhere" }],
    ["tv_control", { action: "task", goal: "play rain" }],
    ["tv_control", { action: "set_volume", target: "101" }],
    ["made_up", { type: "message", to: "Mom", text: "hi" }],
    ["constructor", {}],
    ["__proto__", {}],
  ])("refuses %s with invalid arguments %j", (name, args) => {
    expect(validate(name as string, args)).toMatchObject({ ok: false, error: "invalid_tool_call" });
  });

  it.each([
    ["set_volume", { level: 40 }],
    ["set_alarm", { hour: 0, minute: 0, days: "mon,wed,fri" }],
    ["device_control", { action: "brightness", value: -1 }],
    ["get_time", {}],
    ["send_message", { to: "Mom", text: " Hi! " }],
    ["manage_schedule", { action: "edit", task: "gym", new_time: "18:00" }],
    ["load_tools", { groups: "files, planner" }],
  ])("accepts a valid %s call without coercion", (name, args) => {
    expect(validate(name as string, args)).toBeNull();
  });

  it("checks names against the request's authorized palette", () => {
    expect(
      validateToolCall({ id: "x", name: "phone_task", args: { goal: "read settings" } }, []),
    ).toMatchObject({ ok: false });
  });

  it.each(["{", "null", "[]", "42", '"text"', undefined])(
    "does not silently turn malformed arguments %j into defaults",
    (raw) => {
      const parsed = parseToolArguments(raw);
      expect(parsed.argumentError).toBeTruthy();
      expect(validateToolCall({ id: "x", name: "get_time", ...parsed }, full)?.ok).toBe(false);
    },
  );
});
