import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { applyScreenAction, cleanLook, moveInColumn, patchScreenConfig } from "./screenConfig";
import { toolPalette } from "../tools/registry";

/** Minimal Storage stub — this suite runs in node, which has no localStorage.
 *  Same shape as the one in memory/proceduralMigration.test.ts. */
class TestStorage {
  private values = new Map<string, string>();
  getItem(k: string): string | null {
    return this.values.has(k) ? this.values.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.values.set(k, String(v));
  }
  removeItem(k: string): void {
    this.values.delete(k);
  }
  clear(): void {
    this.values.clear();
  }
}

/**
 * Regression: the ten `action` values the tool schema advertises for
 * customize_screen shared NO value with the seven applyScreenAction branched on, so
 * every call the model made fell straight to "I didn't understand that screen
 * customisation" — the whole tool was dead. The existing dispatch test missed it by
 * calling with the INTERNAL name ("accent") rather than an advertised one.
 *
 * This walks the palette itself, so re-adding an action to the schema without an
 * implementation fails here instead of silently on the device.
 */
function advertisedActions(): string[] {
  const tool = toolPalette({ tier: "groq", keys: { groq: ["x"] } } as never).find(
    (t) => t.name === "customize_screen",
  );
  const action = tool?.parameters?.properties?.action as { enum?: string[] } | undefined;
  return action?.enum ?? [];
}

/** Values each action needs to be well-formed; irrelevant ones are ignored. */
const ARGS: Record<string, { value?: string; panel?: string; direction?: string }> = {
  set_theme: { value: "red" },
  set_style: { value: "iron man" },
  set_background: { value: "grid" },
  set_density: { value: "compact" },
  show_panel: { panel: "weather" },
  hide_panel: { panel: "weather" },
  toggle_panel: { panel: "weather" },
  move_panel: { panel: "weather", direction: "left" },
};

describe("customize_screen", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: new TestStorage(),
    });
  });
  afterEach(() => Reflect.deleteProperty(globalThis, "localStorage"));

  it("advertises at least one action", () => {
    expect(advertisedActions().length).toBeGreaterThan(0);
  });

  it("accepts every action name it advertises to the model", () => {
    const rejected = advertisedActions().filter((name) => {
      const a = ARGS[name] ?? {};
      return !applyScreenAction(name, a.value ?? "", a.panel ?? "", a.direction ?? "").ok;
    });
    expect(rejected).toEqual([]);
  });

  it("still accepts the internal names existing callers use", () => {
    expect(applyScreenAction("accent", "red", "", "").ok).toBe(true);
    expect(applyScreenAction("get", "", "", "").ok).toBe(true);
  });

  it("set_theme persists a named colour as the theme's two hex colours", () => {
    const cfg = applyScreenAction("set_theme", "dark red please", "", "").config;
    expect([cfg?.accent, cfg?.accent2, cfg?.rgb]).toEqual(["#ff4d57", "#ff9197", [255, 77, 87]]);
    expect(applyScreenAction("set_theme", "plaid", "", "").ok).toBe(false);
  });

  it("set_style switches the whole look and leaves the colours alone", () => {
    applyScreenAction("set_theme", "amber", "", "");
    const cfg = applyScreenAction("set_style", "Iron Man mode", "", "").config;
    expect(cfg).toMatchObject({
      cards: "hud",
      core: "reactor",
      gauges: "rings",
      accent: "#ffb648",
    });
    expect(applyScreenAction("set_style", "modern", "", "").config?.core).toBe("orb");
    expect(applyScreenAction("set_style", "sparkly", "", "").ok).toBe(false);
  });

  it("toggle_panel flips a visible panel off, then back on", () => {
    expect(applyScreenAction("toggle_panel", "", "weather", "").config?.panels?.weather).toBe(
      false,
    );
    expect(applyScreenAction("toggle_panel", "", "weather", "").config?.panels?.weather).toBe(true);
  });

  it("hide_all hides every panel and show_all brings them back", () => {
    const hidden = applyScreenAction("hide_all", "", "", "").config?.panels ?? {};
    expect(Object.keys(hidden).length).toBeGreaterThan(0);
    expect(Object.values(hidden).every((v) => v === false)).toBe(true);
    const shown = applyScreenAction("show_all", "", "", "").config?.panels ?? {};
    expect(Object.values(shown).every((v) => v === true)).toBe(true);
  });

  it("reset clears the stored layout but keeps saved themes", () => {
    patchScreenConfig({ accent: "#ff4d57", save_preset: "Mine" });
    applyScreenAction("set_theme", "green", "", "");
    expect(applyScreenAction("reset", "", "", "").config).toEqual({
      presets: [expect.objectContaining({ name: "Mine", accent: "#ff4d57" })],
    });
    patchScreenConfig({ delete_preset: "mine" });
  });

  it("reset clears the stored layout", () => {
    applyScreenAction("set_theme", "red", "", "");
    expect(applyScreenAction("reset", "", "", "").ok).toBe(true);
    expect(applyScreenAction("get", "", "", "").config).toBeUndefined();
  });

  it("move_panel up/down reorders instead of throwing", () => {
    const down = applyScreenAction("move_panel", "", "system", "down").config?.order;
    expect(down?.left).toEqual(["power", "system", "agenda"]);
    const up = applyScreenAction("move_panel", "", "system", "up").config?.order;
    expect(up?.left).toEqual(["system", "power", "agenda"]);
    expect(applyScreenAction("move_panel", "", "weather", "sideways").ok).toBe(false);
  });

  it("still rejects an action it genuinely does not know", () => {
    expect(applyScreenAction("make_it_sparkle", "", "", "").ok).toBe(false);
  });
});

describe("the look (desktop clean_look / set_screen)", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: new TestStorage(),
    });
  });
  afterEach(() => Reflect.deleteProperty(globalThis, "localStorage"));

  it("keeps only valid values: they all end up in CSS", () => {
    expect(
      cleanLook({
        accent: "FF4D57",
        accent2: "red; background:url(x)",
        font: "comic",
        cards: "hud",
        corners: 99,
        glow: "-5",
        background: "image",
        image: "javascript:alert(1)",
      }),
    ).toEqual({
      accent: "#ff4d57",
      rgb: [255, 77, 87],
      cards: "hud",
      corners: 24,
      glow: 0,
      background: "image",
    });
  });

  it("one colour picked derives a lighter second one", () => {
    expect(patchScreenConfig({ accent: "#000000" }).accent2).toBe("#6b6b6b");
  });

  it("saves the current look as a theme, applies it by name, and deletes it", () => {
    patchScreenConfig({ style: "ironman", accent: "#22e39a", save_preset: "  Sonar  " });
    patchScreenConfig({ style: "modern", accent: "#3b82f6" });
    const back = patchScreenConfig({ preset: "sonar" });
    expect(back).toMatchObject({ core: "reactor", accent: "#22e39a" });
    expect(back.presets?.map((p) => p.name)).toEqual(["Sonar"]);
    expect(patchScreenConfig({ delete_preset: "SONAR" }).presets).toEqual([]);
  });

  it("a theme saved before any change records the default look, colours included", () => {
    expect(patchScreenConfig({ save_preset: "Plain" }).presets?.[0]).toMatchObject({
      name: "Plain",
      accent: "#00e5ff",
      background: "grid",
      core: "orb",
    });
  });

  it("imports a theme file: saved under its name, then applied, junk dropped", () => {
    const cfg = patchScreenConfig({
      import_preset: { name: "Sub", accent: "#ff8a3d", core: "reactor", evil: "<script>" },
    });
    expect(cfg).toMatchObject({ accent: "#ff8a3d", core: "reactor" });
    expect(cfg.presets).toEqual([
      { name: "Sub", accent: "#ff8a3d", rgb: [255, 138, 61], core: "reactor" },
    ]);
  });

  it("toggles a panel from its current state", () => {
    expect(patchScreenConfig({ panels: { weather: "toggle" } }).panels?.weather).toBe(false);
    expect(patchScreenConfig({ panels: { weather: "toggle" } }).panels?.weather).toBe(true);
  });
});

describe("moveInColumn (the phone's one-column order)", () => {
  const base = { left: ["system", "power", "agenda"], right: ["weather", "network", "terminal"] };

  it("moves within a rail", () => {
    expect(moveInColumn(base, "power", -1)).toEqual({
      left: ["power", "system", "agenda"],
      right: base.right,
    });
  });

  it("crosses the rail boundary by trading with the neighbour, keeping rail sizes", () => {
    expect(moveInColumn(base, "agenda", 1)).toEqual({
      left: ["system", "power", "weather"],
      right: ["agenda", "network", "terminal"],
    });
  });

  it("is a no-op past either end or for an unknown panel", () => {
    expect(moveInColumn(base, "system", -1)).toEqual(base);
    expect(moveInColumn(base, "terminal", 1)).toEqual(base);
    expect(moveInColumn(base, "nope", 1)).toEqual(base);
  });

  it("falls back to the default layout when nothing is stored", () => {
    expect(moveInColumn(undefined, "system", 1).left).toEqual(["power", "system", "agenda"]);
  });
});
