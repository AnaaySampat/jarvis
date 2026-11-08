import type { ActionSpec } from "../types";

/** Unknown action types are conservatively treated as effects. Reads may repeat. */
export function hasSideEffect(spec: ActionSpec): boolean {
  if (["schedule", "agenda", "routine", "playbook"].includes(spec.type))
    return !["get", "list", "show"].includes(String(spec.do ?? "get"));
  if (spec.type === "tv_control") return !["status", "look"].includes(String(spec.do));
  return ![
    "read_agent_result",
    "check_action_outcome",
    "consult_agent",
    "weather",
    "news",
    "search_web",
    "read_webpage",
    "places",
    "directions",
    "clipboard",
    "read_file",
    "list_dir",
    "time",
    "day",
    "notifications",
    "screenshot",
  ].includes(spec.type);
}

/** Re-applying an absolute state after a later mutation is a new operation. */
export function setsAbsoluteState(spec: ActionSpec): boolean {
  return (
    ["set_volume", "open_app", "close_app", "open_url", "screen"].includes(spec.type) ||
    (spec.type === "device" &&
      [
        "flashlight_on",
        "flashlight_off",
        "dnd_on",
        "dnd_off",
        "ringer_normal",
        "ringer_vibrate",
        "ringer_silent",
        "media_play",
        "media_pause",
        "brightness",
        "auto_rotate_on",
        "auto_rotate_off",
        "lock_screen",
      ].includes(String(spec.do)))
  );
}

export function canonical(value: unknown): unknown {
  if (typeof value === "string") return value.normalize("NFC").trim();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}

/** Hash the lowered action, not provider IDs or raw arguments. No message bodies in storage. */
export async function operationKey(spec: ActionSpec): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(spec)));
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}
