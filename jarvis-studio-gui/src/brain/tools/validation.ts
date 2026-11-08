import type { ToolCall, ToolDeclaration, ToolResult } from "../types";

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

/** Keep malformed wire arguments distinguishable from a valid empty object. */
export function parseToolArguments(raw: unknown): Pick<ToolCall, "args" | "argumentError"> {
  try {
    const args: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!isObject(args)) throw new Error("not an object");
    return { args };
  } catch {
    return { args: {}, argumentError: "Arguments must be a valid JSON object." };
  }
}

/** Validate against the authorized full palette, including groups not yet advertised. */
export function validateToolCall(call: ToolCall, palette: ToolDeclaration[]): ToolResult | null {
  const declaration = palette.find((tool) => tool.name === call.name);
  const errors: string[] = [];
  if (!declaration) errors.push("Unknown or unavailable tool.");
  if (call.argumentError) errors.push(call.argumentError);
  if (!isObject(call.args)) errors.push("Arguments must be an object.");
  if (declaration && isObject(call.args) && !call.argumentError) {
    const properties = declaration.parameters?.properties ?? {};
    const required = new Set(declaration.parameters?.required ?? []);
    for (const key of required) {
      if (!Object.hasOwn(call.args, key)) errors.push(`${key} is required.`);
    }
    for (const [key, value] of Object.entries(call.args)) {
      if (!Object.hasOwn(properties, key)) {
        errors.push(`${key} is not an accepted argument.`);
        continue;
      }
      const schema = properties[key]!;
      const numeric = schema.type === "number" || schema.type === "integer";
      if (
        numeric
          ? typeof value !== "number" ||
            !Number.isFinite(value) ||
            (schema.type === "integer" && !Number.isSafeInteger(value))
          : typeof value !== schema.type
      ) {
        errors.push(`${key} must be ${schema.type}.`);
        continue;
      }
      if (required.has(key) && typeof value === "string" && !value.trim())
        errors.push(`${key} must not be empty.`);
      if (schema.enum && !schema.enum.includes(value as string))
        errors.push(`${key} must be one of: ${schema.enum.join(", ")}.`);
      if (
        typeof value === "number" &&
        ((schema.minimum !== undefined && value < schema.minimum) ||
          (schema.maximum !== undefined && value > schema.maximum))
      )
        errors.push(
          `${key} must be between ${schema.minimum ?? "-∞"} and ${schema.maximum ?? "∞"}.`,
        );
    }
    const a = call.args;
    const need = (...keys: string[]) => {
      for (const key of keys)
        if (typeof a[key] !== "string" || !(a[key] as string).trim())
          errors.push(`${key} is required for this action.`);
    };
    if (call.name === "set_my_location" && a.action === "set") need("place");
    if (
      call.name === "device_control" &&
      ["volume_up", "volume_down"].includes(String(a.action)) &&
      a.value !== undefined &&
      (typeof a.value !== "number" || a.value < 1)
    )
      errors.push("Volume steps must be positive.");
    if (call.name === "manage_routine" && a.action !== "list") {
      need("name");
      if (a.action === "add") need("prompt");
    }
    if (call.name === "manage_playbook" && a.action !== "list") {
      need("name");
      if (a.action === "add") need("steps");
    }
    if (call.name === "manage_schedule" && ["add", "edit", "remove"].includes(String(a.action))) {
      need("task");
      if (
        a.action === "edit" &&
        !String(a.new_time ?? "").trim() &&
        !String(a.new_task ?? "").trim()
      )
        errors.push("An edit requires new_time or new_task.");
    }
    if (call.name === "customize_screen") {
      if (["show_panel", "hide_panel", "toggle_panel", "move_panel"].includes(String(a.action)))
        need("panel");
      if (["set_theme", "set_style", "set_background", "set_density"].includes(String(a.action)))
        need("value");
      if (a.action === "move_panel") {
        need("direction");
        if (!["up", "down", "left", "right"].includes(String(a.direction)))
          errors.push("Invalid move direction.");
      }
    }
    if (call.name === "tv_control" && a.action === "open_app" && !a.target) need("app");
    if (call.name === "tv_control" && ["task", "key", "set_volume"].includes(String(a.action))) {
      need("target");
      if (a.action === "set_volume" && !/^(?:100|[1-9]?\d)$/.test(String(a.target)))
        errors.push("target must be a volume from 0 to 100.");
    }
    if (
      call.name === "set_alarm" &&
      typeof a.days === "string" &&
      a.days &&
      !/^(?:daily|weekdays|weekends|(?:mon|tue|wed|thu|fri|sat|sun)(?:\s*,\s*(?:mon|tue|wed|thu|fri|sat|sun))*)$/i.test(
        a.days,
      )
    )
      errors.push("days must be daily, weekdays, weekends, or comma-separated day abbreviations.");
  }
  return errors.length
    ? {
        ok: false,
        error: "invalid_tool_call",
        summary: `Not run: ${errors.join(" ")} Correct the call using the tool's declared arguments.`,
      }
    : null;
}
