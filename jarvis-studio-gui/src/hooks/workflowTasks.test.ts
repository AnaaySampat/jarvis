import { describe, expect, it } from "vitest";
import { workflowTask, taskDisplayState } from "./workflowTasks";
import type { Workflow } from "../brain/workflow";
import { agentResult } from "../brain/results";
import fixtures from "../../../contracts/ecosystem-v1/task-states.json";

const run = (patch: Partial<Workflow> = {}): Workflow => ({
  version: 1,
  id: "opaque",
  objective: "Research and save",
  state: "suspended",
  updated: 1000,
  plan: ["web_search", "pc_task"],
  results: [agentResult({ ok: true, summary: "Sources read" })],
  pending: null,
  ...patch,
});
describe("conversation task cards", () => {
  it.each(fixtures)("shares the Windows state vocabulary: $status", ({ status, expected }) => {
    expect(taskDisplayState({ status })).toBe(expected);
  });
  it("keeps successful work while exposing missing work and executor ownership", () => {
    const card = workflowTask(
      run({
        outcome: "partial",
        completion: {
          status: "partial",
          completed: ["Sources read"],
          remaining: ["PC unavailable"],
        },
      }),
    );
    expect(card).toMatchObject({
      status: "partial",
      completed: ["Sources read"],
      remaining: ["PC unavailable"],
      deviceLabel: "This phone · Windows steps",
    });
  });
  it("requires reconciliation for uncertain effects even after STOP", () => {
    const card = workflowTask(
      run({
        outcome: "cancelled",
        pending: { id: "send", tool: "send_message", state: "intent_recorded" },
      }),
    );
    expect(taskDisplayState(card)).toBe("needs_you");
    expect(card.remaining.join()).toMatch(/Check.*executing device/);
  });
  it("keeps legacy states readable and does not label unknown recovery as running", () => {
    expect(taskDisplayState({ status: "succeeded" })).toBe("completed");
    expect(taskDisplayState({ status: "recovering" })).toBe("needs_you");
    expect(taskDisplayState(workflowTask(run({ outcome: "cancelled" })))).toBe("cancelled");
  });
});
