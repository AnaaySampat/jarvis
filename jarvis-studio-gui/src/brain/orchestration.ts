/** Only reads with concrete inputs and no device UI state may overlap. */
const INDEPENDENT_READS = new Set([
  "get_weather", "get_news", "web_search", "read_webpage", "get_time", "get_day",
  "read_file", "list_directory",
]);
export const parallelRead = (name: string) => INDEPENDENT_READS.has(name);
export const TOOL_CALL_LIMIT = 24;
export const ADAPTIVE_ROUND_LIMIT = 6;

/** Extend only after a new, successful step; explicit scoped budgets stay exact. */
export function progressing(signatures: string[], successful: string[]): boolean {
  return successful.some((sig) => !signatures.includes(sig));
}
