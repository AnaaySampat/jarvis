import type { ToolCall } from "./types";

/** Anchored whole-command grammar. Ambiguous, relative and compound requests use the model. */
export function directCommand(text: string): ToolCall | undefined {
  const input = text.trim().replace(/[.!]$/, "").toLowerCase();
  const prefix = "(?:please )?(?:set|change) (?:the |my )?";
  const volume = input.match(new RegExp(`^${prefix}(?:media )?volume to (\\d{1,3})(?:%| percent)?(?: please)?$`));
  if (volume) {
    const level = Number(volume[1]);
    if (level <= 100) return { id: "direct", name: "set_volume", args: { level } };
  }
  const timer = input.match(/^(?:please )?(?:set|start) (?:a |the )?timer for ([1-9]\d{0,6}) (seconds?|minutes?|hours?)(?: please)?$/);
  if (timer) {
    const seconds = Number(timer[1]) * (/^hour/.test(timer[2]) ? 3600 : /^minute/.test(timer[2]) ? 60 : 1);
    if (seconds <= 2147483647)
      return { id: "direct", name: "set_timer", args: { seconds } };
  }
  return undefined;
}
