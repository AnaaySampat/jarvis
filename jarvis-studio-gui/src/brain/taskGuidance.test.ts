import { describe, expect, it } from "vitest";
import { taskGuidanceFor, taskGuidanceKind } from "./taskGuidance";

describe("English task guidance", () => {
  it.each([
    ["Fix the TypeScript bug and run tests", "coding"],
    ["Research and compare sources", "research"],
    ["Rewrite this email", "writing"],
    ["Open the app and send a message", "automation"],
    ["Improve the microphone and wake word", "voice"],
    ["Create a roadmap with milestones", "planning"],
    ["Audit API credentials and permissions", "security"],
    ["Hello Jarvis", "general"],
  ])("selects a guide for %s", (request, kind) => {
    expect(taskGuidanceKind(request)).toBe(kind);
  });

  it("does not route on fragments inside unrelated English words", () => {
    expect(taskGuidanceKind("Tell me about a secretary bird")).toBe("general");
    expect(taskGuidanceKind("Write a biography of a playwright")).toBe("writing");
  });

  it("keeps guidance provider-neutral and retains the existing execution boundary", () => {
    const guide = taskGuidanceFor("Automate a phone task");
    expect(guide).toContain("single dispatcher");
    expect(guide).toContain("verification");
    expect(guide).not.toMatch(/You are Claude|Darija|Arabic/);
  });
});
