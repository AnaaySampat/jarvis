/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { toSpec, capabilitiesFor, toolPalette, DEVICE_ACTIONS } from "./registry";
import kotlin from "../../../src-tauri/tauri-plugin-phone/android/src/main/java/DirectActions.kt?raw";

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

  it("maps manage_routine into the routine spec, matching by name and falling back to prompt", () => {
    expect(toSpec("manage_routine", { action: "remove", name: "bedtime" })).toEqual({
      type: "routine",
      do: "remove",
      name: "bedtime",
      time: "",
      days: "daily",
      prompt: "",
      match: "bedtime",
    });
    expect(toSpec("manage_routine", { action: "remove", prompt: "wake me up" }).match).toBe(
      "wake me up",
    );
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

  it("only advertises tv_control when a TV is set up, and lowers it to one spec", () => {
    const cfg = { tier: "groq" as const, model: "x", keys: {}, pinnedLocation: "" };
    expect(toolPalette(cfg).some((t) => t.name === "tv_control")).toBe(false);
    expect(toolPalette(cfg, { tvPaired: true }).some((t) => t.name === "tv_control")).toBe(true);
    expect(toSpec("tv_control", { action: "play", target: "Stranger Things" })).toEqual({
      type: "tv_control",
      do: "play",
      target: "Stranger Things",
      app: "netflix",
      season: 0,
      episode: 0,
    });
  });
});

describe("one-step phone tools", () => {
  it("lowers each to its own spec", () => {
    expect(toSpec("device_control", { action: "flashlight_on" })).toEqual({
      type: "device",
      do: "flashlight_on",
      value: undefined,
    });
    expect(toSpec("send_message", { to: "Mom", text: "on my way" })).toEqual({
      type: "message",
      to: "Mom",
      text: "on my way",
      app: "whatsapp",
    });
    expect(toSpec("call_contact", { to: "Dad" })).toEqual({ type: "call", to: "Dad", app: "phone", video: false });
    expect(toSpec("call_contact", { to: "Dad", app: "whatsapp", video: true })).toEqual({
      type: "call",
      to: "Dad",
      app: "whatsapp",
      video: true,
    });
    expect(toSpec("navigate_to", { destination: "Central Station" })).toEqual({
      type: "navigate",
      destination: "Central Station",
      mode: "",
    });
    expect(toSpec("play_media", { query: "Back in Black", app: "spotify" })).toEqual({
      type: "play_media",
      query: "Back in Black",
      app: "spotify",
    });
    expect(toSpec("read_notifications")).toEqual({ type: "notifications", app: "", from: "" });
  });

  it("replaces system_control, whose media actions had nothing behind them", () => {
    const names = toolPalette({ tier: "groq", model: "m", keys: { groq: ["k"] } }).map((t) => t.name);
    expect(names).not.toContain("system_control");
    expect(names).toEqual(
      expect.arrayContaining([
        "device_control",
        "send_message",
        "call_contact",
        "navigate_to",
        "play_media",
        "read_notifications",
      ]),
    );
  });

  // ARCHITECTURE §3: an advertised enum value with no handler silently does nothing.
  it("advertises only device actions DirectActions.kt has a branch for", () => {
    const handled = new Set([...kotlin.matchAll(/^\s*"([a-z_]+)" ->/gm)].map((m) => m[1]));
    expect(DEVICE_ACTIONS.filter((a) => !handled.has(a))).toEqual([]);
    const tool = toolPalette({ tier: "groq", model: "m", keys: { groq: ["k"] } }).find(
      (t) => t.name === "device_control",
    );
    expect(tool?.parameters?.properties.action?.enum).toEqual(DEVICE_ACTIONS);
  });
});
