import { describe, expect, it } from "vitest";
import { toSpec, capabilitiesFor, toolPalette } from "./registry";

describe("toSpec", () => {
  it("lowers a simple no-arg call", () => {
    expect(toSpec("take_screenshot")).toEqual({ type: "screenshot" });
    expect(toSpec("get_time")).toEqual({ type: "time" });
  });

  it("lowers args through the named builder, defaulting missing fields", () => {
    expect(toSpec("open_application", { name: "maps" })).toEqual({
      type: "open_app",
      target: "maps",
    });
    expect(toSpec("open_application")).toEqual({ type: "open_app", target: "" });
  });

  it("maps manage_routine's action/prompt into the routine spec, mirroring prompt into match", () => {
    expect(toSpec("manage_routine", { action: "remove", prompt: "wake me up" })).toEqual({
      type: "routine",
      do: "remove",
      time: "",
      days: "daily",
      prompt: "wake me up",
      match: "wake me up",
    });
  });

  it("maps manage_playbook's name into both name and query", () => {
    expect(toSpec("manage_playbook", { action: "add", name: "morning routine" })).toEqual({
      type: "playbook",
      do: "add",
      name: "morning routine",
      steps: "",
      triggers: "",
      query: "morning routine",
    });
  });

  it("falls back to a passthrough spec for an unknown tool name", () => {
    expect(toSpec("totally_unknown_tool", { foo: "bar" })).toEqual({
      type: "totally_unknown_tool",
      foo: "bar",
    });
  });

  it("round-trips control_interface's action into the ui spec", () => {
    expect(toSpec("control_interface", { action: "open_settings" })).toEqual({
      type: "ui",
      do: "open_settings",
    });
  });
});

describe("capabilitiesFor", () => {
  const cfg = (tier: "vertex" | "gemini" | "groq", keys: Record<string, string[]> = {}) =>
    ({ tier, keys }) as Parameters<typeof capabilitiesFor>[0];

  it("gives vertex both places and web grounding", () => {
    expect(capabilitiesFor(cfg("vertex"))).toEqual({ placesOk: true, webOk: true });
  });
  it("gives gemini web but not places", () => {
    expect(capabilitiesFor(cfg("gemini", { gemini: ["k"] }))).toEqual({
      placesOk: false,
      webOk: true,
    });
  });
  it("gives a key-less groq install neither", () => {
    expect(capabilitiesFor(cfg("groq"))).toEqual({ placesOk: false, webOk: false });
  });

  // The regression: both keys present resolves the TIER to groq, but the Gemini key
  // is what grounded search actually uses — so web_search must still be offered.
  it("keeps web search when a Gemini key exists even though the tier is groq", () => {
    expect(capabilitiesFor(cfg("groq", { gemini: ["k"], groq: ["g"] })).webOk).toBe(true);
  });
  it("advertises web_search for a groq tier holding a Gemini key", () => {
    const palette = toolPalette({
      tier: "groq",
      model: "x",
      keys: { gemini: ["k"], groq: ["g"] },
      pinnedLocation: "",
    });
    expect(palette.map((t) => t.name)).toContain("web_search");
  });
});

describe("toolPalette", () => {
  it("only advertises pc_task when a PC is paired", () => {
    const cfg = { tier: "groq" as const, model: "x", keys: {}, pinnedLocation: "" };
    const withoutPc = toolPalette(cfg);
    const withPc = toolPalette(cfg, { pcPaired: true });
    expect(withoutPc.some((t) => t.name === "pc_task")).toBe(false);
    expect(withPc.some((t) => t.name === "pc_task")).toBe(true);
  });
});
