import type { LLMReply } from "../providers";
import type { ToolDeclaration } from "../types";
import { groupOf, LOAD_TOOLS, requestedGroups } from "../tools/registry";
import { validateToolCall } from "../tools/validation";

export interface SelectionScore { correct: boolean; valid: boolean; elapsed_ms: number | null }
/** Ground truth comes only from a labelled fixture. Unlabelled production turns are not scored. */
export function scoreSelection(reply: LLMReply, expected: { firstTool: string; firstArgs?: Record<string, unknown> },
  offered: ToolDeclaration[], elapsedMs?: number): SelectionScore {
  const first = reply.toolCalls[0];
  const valid = !!first && !validateToolCall(first, offered);
  const loader = first?.name === LOAD_TOOLS && !offered.some((t) => t.name === expected.firstTool) &&
    requestedGroups(first.args).includes(groupOf(expected.firstTool) ?? "");
  const correct = valid && (loader || (first.name === expected.firstTool &&
    Object.entries(expected.firstArgs ?? {}).every(([key, value]) => JSON.stringify(first.args[key]) === JSON.stringify(value))));
  return { correct, valid, elapsed_ms: elapsedMs === undefined ? null : Math.max(0, elapsedMs) };
}
export function selectionReport(scores: SelectionScore[]) {
  const correct = scores.filter((s) => s.correct).length;
  const timed = scores.flatMap((s) => s.elapsed_ms === null ? [] : [s.elapsed_ms]);
  return { labelled_cases: scores.length, correct, selection_accuracy: scores.length ? correct / scores.length : null,
    invalid: scores.filter((s) => !s.valid).length,
    mean_selection_ms: timed.length ? timed.reduce((sum, ms) => sum + ms, 0) / timed.length : null };
}
