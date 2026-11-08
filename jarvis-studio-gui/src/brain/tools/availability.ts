import type { ActionSpec, ToolAvailability } from "../types";

export type AvailabilityMap = Record<string, ToolAvailability>;

export const NATIVE_TOOLS = [
  "take_screenshot",
  "open_application",
  "close_application",
  "open_website",
  "set_volume",
  "device_control",
  "send_message",
  "call_contact",
  "navigate_to",
  "play_media",
  "read_notifications",
  "open_saved_file",
  "read_clipboard",
  "read_file",
  "list_directory",
  "set_alarm",
  "set_timer",
  "set_reminder",
  "manage_clock",
  "phone_task",
  "enable_phone_control",
  "request_tool_access",
] as const;

/** Both the model loop and trusted direct actions use the same capability gate. */
export function availabilityForSpec(
  spec: ActionSpec,
  availability: AvailabilityMap,
): ToolAvailability | undefined {
  const names: Record<string, string> = {
    screenshot: "take_screenshot",
    open_app: "open_application",
    close_app: "close_application",
    open_url: "open_website",
    open_file: "open_saved_file",
    clipboard: "read_clipboard",
    list_dir: "list_directory",
    device: "device_control",
    message: "send_message",
    call: "call_contact",
    navigate: "navigate_to",
    notifications: "read_notifications",
    reminder: "set_reminder",
    open_a11y_settings: "enable_phone_control",
    request_tool_access: "request_tool_access",
  };
  const name =
    spec.type === "clock"
      ? spec.do === "alarm"
        ? "set_alarm"
        : spec.do === "timer"
          ? "set_timer"
          : "manage_clock"
      : (names[spec.type] ?? spec.type);
  return availability[name];
}
