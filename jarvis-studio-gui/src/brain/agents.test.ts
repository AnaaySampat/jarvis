import { describe, expect, it } from "vitest";
import { agentsFor, mention, routeFor } from "./agents";

describe("mention", () => {
  it("picks the agent an @handle or a spoken name gives, and drops it", () => {
    expect(mention("@files what's in my downloads")).toEqual({
      agent: "files",
      rest: "what's in my downloads",
    });
    expect(mention("open github @browser")).toEqual({ agent: "browser", rest: "open github" });
    expect(mention("tell the desktop agent to open notepad")).toEqual({
      agent: "desktop",
      rest: "open notepad",
    });
    expect(mention("Research agent, budget phones")).toEqual({
      agent: "research",
      rest: "budget phones",
    });
  });

  it("ignores addresses, unknown names and a bare handle", () => {
    for (const t of ["mail me at a@b.com", "@nobody hi", "@files", "my travel agent called"]) {
      expect(mention(t)).toEqual({ agent: "", rest: t });
    }
  });
});

describe("routeFor", () => {
  it("sends PC agents to the PC and research there only when one is paired", () => {
    expect(routeFor("desktop", true)).toEqual({ pc: "computer" });
    expect(routeFor("browser", false)).toEqual({ pc: "browser" });
    expect(routeFor("research", true)).toEqual({ pc: "research" });
    expect(routeFor("research", false)).toMatchObject({
      groups: [],
      context: expect.stringMatching(/RESEARCH/),
    });
    expect(routeFor("scheduling", false)).toMatchObject({ groups: ["planner"] });
    expect(routeFor("auto", true)).toBeNull();
    expect(routeFor("", true)).toBeNull();
  });

  it("shows the PC's agents only while a PC is paired", () => {
    expect(agentsFor(false).map((a) => a.id)).not.toContain("desktop");
    expect(agentsFor(true).map((a) => a.id)).toContain("desktop");
  });
});
