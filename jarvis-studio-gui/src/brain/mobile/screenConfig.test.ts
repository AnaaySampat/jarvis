import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { applyScreenAction } from "./screenConfig";
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

  it("set_theme actually persists the accent", () => {
    expect(applyScreenAction("set_theme", "red", "", "").config?.accent).toBe("red");
  });

  it("toggle_panel flips a visible panel off, then back on", () => {
    expect(applyScreenAction("toggle_panel", "", "weather", "").config?.panels?.weather).toBe(false);
    expect(applyScreenAction("toggle_panel", "", "weather", "").config?.panels?.weather).toBe(true);
  });

  it("hide_all hides every panel and show_all brings them back", () => {
    const hidden = applyScreenAction("hide_all", "", "", "").config?.panels ?? {};
    expect(Object.keys(hidden).length).toBeGreaterThan(0);
    expect(Object.values(hidden).every((v) => v === false)).toBe(true);
    const shown = applyScreenAction("show_all", "", "", "").config?.panels ?? {};
    expect(Object.values(shown).every((v) => v === true)).toBe(true);
  });

  it("reset clears the stored layout", () => {
    applyScreenAction("set_theme", "red", "", "");
    expect(applyScreenAction("reset", "", "", "").ok).toBe(true);
    expect(applyScreenAction("get", "", "", "").config).toBeUndefined();
  });

  it("still rejects an action it genuinely does not know", () => {
    expect(applyScreenAction("make_it_sparkle", "", "", "").ok).toBe(false);
  });
});
