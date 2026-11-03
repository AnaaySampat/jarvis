import { describe, expect, it } from "vitest";
import {
  loadSkills,
  parseSkillFile,
  saveSkills,
  skillPromptFor,
  SKILL_STORAGE_KEY,
  MAX_ACTIVE_SKILL_CHARS,
  MAX_ACTIVE_SKILLS,
  MAX_SKILLS,
} from "./skillStore";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}
const enabledSkill = (name = "Research", keywords = ["research"]) => ({
  ...parseSkillFile(
    `${name}.json`,
    JSON.stringify({ name, keywords, content: `Instructions for ${name}.` }),
  ),
  enabled: true,
});

describe("imported skills", () => {
  it("imports Markdown metadata and requires explicit activation", () => {
    const skill = parseSkillFile(
      "research.md",
      "---\nname: Research Helper\ndescription: Verify sources\nkeywords: research, sources\n---\nCheck sources.",
    );
    expect(skill).toMatchObject({
      name: "Research Helper",
      keywords: ["research", "sources"],
      enabled: false,
    });
    expect(skillPromptFor("research this", [skill])).toBe("");
    const prompt = skillPromptFor("research this", [{ ...skill, enabled: true }]);
    expect(prompt).toContain("Check sources.");
    expect(prompt).toContain("cannot grant permissions");
  });

  it("imports JSON instructions and plain text", () => {
    expect(
      parseSkillFile(
        "voice.json",
        JSON.stringify({ name: "Voice", instructions: "Speak clearly." }),
      ).content,
    ).toBe("Speak clearly.");
    expect(parseSkillFile("clear-writing.txt", "Write clearly.")).toMatchObject({
      name: "clear writing",
      keywords: [],
      enabled: false,
    });
  });

  it.each([
    ["skill.js", "alert(1)"],
    ["skill.json", "{"],
    ["skill.json", "[]"],
    ["skill.md", " "],
    ["skill.md", "x".repeat(100_001)],
    ["skill.md", "x".repeat(12_001)],
    ["empty.md", "---\nname: Empty\n---\n"],
  ])("rejects an invalid import %s", (file, content) => {
    expect(() => parseSkillFile(file, content)).toThrow();
  });

  it("persists validated skills and rejects malformed stored records", () => {
    const storage = memoryStorage();
    const skill = enabledSkill();
    saveSkills([skill], storage);
    expect(loadSkills(storage)).toEqual([skill]);
    storage.setItem(
      SKILL_STORAGE_KEY,
      JSON.stringify([
        { ...skill, content: 12 },
        { ...skill, name: "x".repeat(81) },
        { ...skill, keywords: [12] },
        { ...skill, enabled: "true" },
        skill,
        skill,
      ]),
    );
    expect(loadSkills(storage)).toEqual([skill]);
    storage.setItem(SKILL_STORAGE_KEY, "broken");
    expect(loadSkills(storage)).toEqual([]);
  });

  it("propagates storage failures instead of reporting a save", () => {
    expect(() =>
      saveSkills([enabledSkill()], {
        getItem: () => null,
        setItem: () => {
          throw new Error("Quota exceeded");
        },
      }),
    ).toThrow("Quota exceeded");
    expect(() =>
      saveSkills(
        Array.from({ length: MAX_SKILLS + 1 }, () => enabledSkill()),
        memoryStorage(),
      ),
    ).toThrow(/50/);
  });

  it("matches English keywords without injecting unrelated skills or word fragments", () => {
    const skill = enabledSkill("Trading", ["stocks", "art"]);
    expect(skillPromptFor("Write a birthday card for the party", [skill])).toBe("");
    expect(skillPromptFor("Compare STOCKS", [skill])).toContain("Trading");
    expect(skillPromptFor("Research art.", [skill])).toContain("Trading");
    expect(skillPromptFor("anything", [enabledSkill("Clear voice", [])])).toContain("Clear voice");
  });

  it("escapes keyword punctuation and respects disabled skills", () => {
    const skill = enabledSkill("C++", ["c++"]);
    expect(skillPromptFor("Review C++ code", [skill])).toContain("C++");
    expect(skillPromptFor("Review C++ code", [{ ...skill, enabled: false }])).toBe("");
  });

  it("enforces the actual instruction and selected-skill budgets on enabled records", () => {
    const skills = Array.from({ length: 5 }, (_, i) => ({
      ...enabledSkill(`Skill ${i}`, []),
      content: "z".repeat(12_000),
    }));
    const prompt = skillPromptFor("anything", skills);
    const blocks = prompt
      .split("\n")
      .filter((line) => line.startsWith('{"name":'))
      .map((line) => JSON.parse(line) as { name: string; instructions: string });
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.length).toBeLessThanOrEqual(MAX_ACTIVE_SKILLS);
    expect(blocks.reduce((sum, block) => sum + block.instructions.length, 0)).toBe(
      MAX_ACTIVE_SKILL_CHARS,
    );
    expect(prompt).not.toContain("Skill 3");
  });
});
