import { expect, it } from "vitest";
import { scoreSelection, selectionReport } from "./evaluation";
import { LOAD_TOOLS, toolPalette, turnPalette } from "../tools/registry";
const full = toolPalette({ tier: "groq", model: "m", keys: {} }, { tvPaired: true });
const reply = (name: string, args: Record<string, unknown>) => ({ text: "", toolCalls: [{ id: "c", name, args }] });
it("counts wrong arguments, unknown calls and missing calls as incorrect labelled selections", () => {
  const expected = { firstTool: "set_volume", firstArgs: { level: 40 } };
  const scores = [scoreSelection(reply("set_volume", { level: 40 }), expected, full, 20),
    scoreSelection(reply("set_volume", { level: 50 }), expected, full, 30),
    scoreSelection(reply("unknown", {}), expected, full, 10),
    scoreSelection({ text: "Done", toolCalls: [] }, expected, full, 40)];
  expect(selectionReport(scores)).toEqual({ labelled_cases: 4, correct: 1, selection_accuracy: 0.25, invalid: 2, mean_selection_ms: 25 });
  expect(selectionReport([]).selection_accuracy).toBeNull();
});
it("accepts only a valid loader for the expected unloaded group", () => {
  const offered = turnPalette(full, new Set());
  const expected = { firstTool: "read_file" };
  expect(offered.some((t) => t.name === "read_file")).toBe(false);
  expect(scoreSelection(reply(LOAD_TOOLS, { groups: "files" }), expected, offered).correct).toBe(true);
  expect(scoreSelection(reply(LOAD_TOOLS, { groups: "web" }), expected, offered).correct).toBe(false);
  expect(scoreSelection(reply(LOAD_TOOLS, { groups: ["files"] }), expected, offered).correct).toBe(false);
});
