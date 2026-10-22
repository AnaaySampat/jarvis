/**
 * HUD look & layout persisted on-device (replaces desktop `customize_screen` / sendScreen).
 * Mirrors the desktop's groq_bridge.set_screen / clean_look: the look is a set of
 * validated settings (they all end up in CSS), with built-in and saved presets.
 */

export type Rgb = [number, number, number];

export interface ScreenLook {
  accent?: string;
  accent2?: string;
  rgb?: Rgb;
  background?: string;
  image?: string;
  font?: string;
  cards?: string;
  core?: string;
  gauges?: string;
  corners?: number;
  glow?: number;
}

export interface ScreenPreset extends ScreenLook {
  name: string;
}

export interface ScreenConfig extends ScreenLook {
  density?: string;
  panels?: Record<string, boolean>;
  order?: { left?: string[]; right?: string[] };
  presets?: ScreenPreset[];
}

/** A patch from Customize or the screen tool: look/layout keys plus preset verbs. */
export interface ScreenPatch extends Omit<ScreenConfig, "panels"> {
  panels?: Record<string, boolean | "toggle">;
  style?: string;
  preset?: string;
  save_preset?: string;
  delete_preset?: string;
  import_preset?: Record<string, unknown>;
  reset?: boolean;
}

const KEY = "jarvis.android.screen.v1";

// The home screen's look, as presets. A built-in one leaves the colours and the
// background alone; a saved one carries every key in LOOK_KEYS. None of them touch
// the layout (panels, order, density).
export const SCREEN_PRESETS: Record<string, ScreenLook> = {
  modern: { font: "clean", corners: 14, glow: 40, cards: "clean", core: "orb", gauges: "bars" },
  ironman: { font: "hud", corners: 3, glow: 100, cards: "hud", core: "reactor", gauges: "rings" },
};
// The look before anything is changed (the store keeps only what was changed).
export const DEFAULT_LOOK: ScreenLook & { density: string } = {
  accent: "#00e5ff",
  accent2: "#6fe9ff",
  rgb: [0, 229, 255],
  background: "grid",
  density: "normal",
  ...SCREEN_PRESETS.modern,
};
const LOOK_KEYS = [
  "accent",
  "accent2",
  "background",
  "image",
  "font",
  "corners",
  "glow",
  "cards",
  "core",
  "gauges",
] as const;

// Named accent themes → [accent, accent2] (the desktop's actions._THEMES).
export const THEMES: Record<string, [string, string]> = {
  cyan: ["#00e5ff", "#6fe9ff"],
  blue: ["#3b82f6", "#93c5fd"],
  amber: ["#ffb648", "#ffd591"],
  gold: ["#ffd24a", "#ffe89a"],
  red: ["#ff4d57", "#ff9197"],
  crimson: ["#ff2d55", "#ff8095"],
  green: ["#22e39a", "#8bf0cb"],
  lime: ["#9ee64d", "#caf29a"],
  purple: ["#a872ff", "#cdaaff"],
  magenta: ["#ff5cf0", "#ffa9f6"],
  pink: ["#ff77c8", "#ffb3e0"],
  orange: ["#ff8a3d", "#ffbb85"],
  white: ["#e8f4ff", "#ffffff"],
};

const CHOICES: Record<string, readonly string[]> = {
  background: ["grid", "solid", "aurora", "minimal", "image"],
  font: ["clean", "hud"],
  cards: ["clean", "hud"],
  core: ["orb", "reactor"],
  gauges: ["bars", "rings"],
};
const RANGES: Record<string, [number, number]> = { corners: [0, 24], glow: [0, 100] };
const HEX6 = /^#[0-9a-f]{6}$/;
// A background picture is kept inline. Customize shrinks it to a ≤1280px JPEG first.
// ponytail: localStorage holds ~5 MB per origin (chats live there too), so the cap is
// half the desktop's 4 MB; move the picture to a file if people want bigger ones.
const IMAGE = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
const IMAGE_MAX = 2_000_000;

const hexRgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;

/** A colour as said or picked → hex: a theme name, a hex code, or a theme word in a phrase. */
export function matchTheme(value: unknown): [string, string] | null {
  const v = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!v) return null;
  if (THEMES[v]) return THEMES[v];
  const hex = v.startsWith("#") ? v : `#${v}`;
  if (HEX6.test(hex)) return [hex, ""];
  const word = Object.keys(THEMES).find((name) => new RegExp(`\\b${name}\\b`).test(v));
  return word ? THEMES[word] : null;
}

/** "Iron Man" / "modern" as said → a built-in preset id. */
function matchStyle(value: unknown): string {
  const v = String(value ?? "").toLowerCase();
  if (/\b(iron ?man|reactor|helmet|arc|hud|classic|original|stark)\b/.test(v)) return "ironman";
  if (/\b(modern|orb|simple|clean|calm|default|normal)\b/.test(v)) return "modern";
  return "";
}

/**
 * The valid look settings in `d` (a patch, a saved preset or an imported theme),
 * normalised; everything else is dropped. They all reach the HUD's CSS, so they're
 * checked strictly here, where every caller passes through.
 */
export function cleanLook(d: unknown): ScreenLook {
  if (!d || typeof d !== "object") return {};
  const src = d as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of ["accent", "accent2"]) {
    const v = String(src[k] ?? "")
      .trim()
      .toLowerCase();
    const hex = v.startsWith("#") ? v : `#${v}`;
    if (HEX6.test(hex)) out[k] = hex;
  }
  for (const [k, options] of Object.entries(CHOICES)) {
    if (options.includes(src[k] as string)) out[k] = src[k];
  }
  for (const [k, [lo, hi]] of Object.entries(RANGES)) {
    const n = Number(src[k]);
    if (src[k] !== undefined && src[k] !== "" && Number.isFinite(n)) {
      out[k] = Math.max(lo, Math.min(hi, Math.round(n)));
    }
  }
  const img = src.image;
  if (img === "" || (typeof img === "string" && img.length <= IMAGE_MAX && IMAGE.test(img))) {
    out.image = img;
  }
  if (out.accent) out.rgb = hexRgb(out.accent as string);
  return out as ScreenLook;
}

const presetName = (v: unknown) =>
  String(v ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ")
    .slice(0, 40);

/** A saved preset's look by name (any case), else a built-in one; {} if none. */
function findPreset(name: unknown, cfg: ScreenConfig): ScreenLook {
  const n = presetName(name).toLowerCase();
  if (!n) return {};
  const saved = (cfg.presets ?? []).find((p) => presetName(p.name).toLowerCase() === n);
  if (saved) return cleanLook(saved);
  return { ...(SCREEN_PRESETS[n.replace(/\s/g, "")] ?? {}) };
}

function storePreset(cfg: ScreenConfig, name: string, look: ScreenLook): ScreenPreset[] {
  const keep = (cfg.presets ?? []).filter(
    (p) => presetName(p.name).toLowerCase() !== name.toLowerCase(),
  );
  return [...keep, { name, ...look }];
}

export function loadScreenConfig(): ScreenConfig | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ScreenConfig) : null;
  } catch {
    return null;
  }
}

function saveScreenConfig(cfg: ScreenConfig): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    /* quota */
  }
}

/**
 * Apply a (partial) patch and persist it: `reset` (the saved presets stay), the look
 * keys (cleanLook), presets (`style` built-in, `preset` by name, `save_preset` the
 * current look, `delete_preset`, `import_preset` a theme: saved, then applied),
 * density, `panels` (true / false / "toggle") and a whole `order`.
 */
export function patchScreenConfig(patch: ScreenPatch): ScreenConfig {
  const prev = loadScreenConfig() ?? {};
  if (patch.reset) {
    const kept: ScreenConfig = prev.presets?.length ? { presets: prev.presets } : {};
    try {
      if (kept.presets) saveScreenConfig(kept);
      else localStorage.removeItem(KEY);
    } catch {
      /* storage unavailable — nothing persisted to clear */
    }
    return kept;
  }
  const next: ScreenConfig = { ...prev };
  const look: ScreenLook = { ...(SCREEN_PRESETS[patch.style ?? ""] ?? {}) };
  if (patch.preset) Object.assign(look, findPreset(patch.preset, next));
  const imported = cleanLook(patch.import_preset);
  if (Object.keys(imported).length) {
    const name = presetName(patch.import_preset?.name) || "Imported theme";
    next.presets = storePreset(next, name, imported);
    Object.assign(look, imported);
  }
  // A colour by name ("amber") is a theme: both its colours.
  const named =
    typeof patch.accent === "string" && !patch.accent.startsWith("#")
      ? matchTheme(patch.accent)
      : null;
  Object.assign(
    look,
    cleanLook(named ? { ...patch, accent: named[0], accent2: patch.accent2 ?? named[1] } : patch),
  );
  if (look.accent && !look.accent2 && !patch.accent2) {
    // one colour given: the second is a lighter shade of it
    look.accent2 = `#${look.rgb!.map((c) => (c + Math.round((255 - c) * 0.42)).toString(16).padStart(2, "0")).join("")}`;
  }
  Object.assign(next, look);
  if (presetName(patch.save_preset)) {
    const look = { ...DEFAULT_LOOK, ...next };
    const current = cleanLook(Object.fromEntries(LOOK_KEYS.map((k) => [k, look[k]])));
    next.presets = storePreset(next, presetName(patch.save_preset), current);
  }
  if (presetName(patch.delete_preset)) {
    const gone = presetName(patch.delete_preset).toLowerCase();
    next.presets = (next.presets ?? []).filter((p) => presetName(p.name).toLowerCase() !== gone);
  }
  if (patch.density === "normal" || patch.density === "compact") next.density = patch.density;
  if (patch.panels) {
    const cur = { ...(prev.panels ?? {}) };
    for (const [name, v] of Object.entries(patch.panels)) {
      cur[name] = v === "toggle" ? cur[name] === false : Boolean(v);
    }
    next.panels = cur;
  }
  if (patch.order) {
    next.order = {
      left: patch.order.left ?? prev.order?.left,
      right: patch.order.right ?? prev.order?.right,
    };
  }
  saveScreenConfig(next);
  return next;
}

const DEFAULT_PANELS = {
  left: ["system", "power", "agenda"],
  right: ["weather", "network", "terminal"],
};

/**
 * Move a panel one place up (-1) or down (+1) in the phone's single column: the
 * left rail, then the right. Each rail keeps its length so the desktop layout stays
 * balanced, which means a panel crossing the boundary trades rails with its
 * neighbour. Past either end it's a no-op.
 */
export function moveInColumn(
  order: ScreenConfig["order"],
  panel: string,
  delta: number,
): { left: string[]; right: string[] } {
  const left = [...(order?.left ?? DEFAULT_PANELS.left)];
  const right = [...(order?.right ?? DEFAULT_PANELS.right)];
  const all = [...left, ...right];
  const i = all.indexOf(panel);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= all.length) return { left, right };
  [all[i], all[j]] = [all[j], all[i]];
  return { left: all.slice(0, left.length), right: all.slice(left.length) };
}

/**
 * The tool schema advertises verbs to the model; this function branches on short
 * internal names. They shared no value, so EVERY customize_screen call fell to the
 * "I didn't understand that" branch. Translate here rather than renaming either
 * side, so the internal names existing callers/tests use keep working.
 */
const ACTION_ALIASES: Record<string, string> = {
  set_theme: "accent",
  set_accent: "accent",
  set_style: "style",
  set_background: "background",
  set_density: "density",
  show_panel: "show",
  hide_panel: "hide",
  toggle_panel: "toggle",
  move_panel: "move",
};

/** Apply a customize_screen tool action. */
export function applyScreenAction(
  action: string,
  value: string,
  panel: string,
  direction: string,
): { ok: boolean; summary: string; config?: ScreenConfig } {
  const raw = (action || "get").toLowerCase();
  const a = ACTION_ALIASES[raw] ?? raw;
  if (a === "get") {
    const cfg = loadScreenConfig();
    return {
      ok: true,
      summary: cfg ? "Here's your current home-screen layout." : "Using the default layout.",
      config: cfg ?? undefined,
    };
  }
  // reset / show_all / hide_all / toggle_panel were advertised but had no branch.
  if (a === "reset") {
    const config = patchScreenConfig({ reset: true });
    return {
      ok: true,
      summary: "Put your home screen back to the default layout.",
      config: Object.keys(config).length ? config : undefined,
    };
  }

  const patch: ScreenPatch = {};
  if (a === "show_all" || a === "hide_all") {
    const cfg = loadScreenConfig();
    const names = [
      ...(cfg?.order?.left ?? DEFAULT_PANELS.left),
      ...(cfg?.order?.right ?? DEFAULT_PANELS.right),
    ];
    const on = a === "show_all";
    patch.panels = Object.fromEntries(names.map((p) => [p, on]));
    const config = patchScreenConfig(patch);
    return { ok: true, summary: on ? "Showed every panel." : "Hid every panel.", config };
  }
  if (a === "toggle" && panel) patch.panels = { [panel]: "toggle" };
  else if (a === "accent" && value) {
    const theme = matchTheme(value);
    if (!theme)
      return {
        ok: false,
        summary: `I don't know the colour “${value}”. Try cyan, amber, red, green, purple or a hex code.`,
      };
    patch.accent = theme[0];
    if (theme[1]) patch.accent2 = theme[1];
  } else if (a === "style" && value) {
    const style = matchStyle(value);
    const saved = !style && findPreset(value, loadScreenConfig() ?? {});
    if (!style && !(saved && Object.keys(saved).length)) {
      return {
        ok: false,
        summary: "The style can be modern or Iron Man, or one of your saved themes.",
      };
    }
    if (style) patch.style = style;
    else patch.preset = value;
  } else if (a === "background" && CHOICES.background.includes(value) && value !== "image") {
    patch.background = value;
  } else if (a === "density" && (value === "normal" || value === "compact")) patch.density = value;
  else if (a === "hide" && panel) patch.panels = { [panel]: false };
  else if (a === "show" && panel) patch.panels = { [panel]: true };
  else if (a === "move" && panel && (direction === "up" || direction === "down")) {
    // Advertised, but only left/right had a branch: up/down indexed order["up"] and threw.
    patch.order = moveInColumn(loadScreenConfig()?.order, panel, direction === "up" ? -1 : 1);
  } else if (a === "move" && panel && (direction === "left" || direction === "right")) {
    const cfg = loadScreenConfig() ?? {};
    const order = {
      left: [...(cfg.order?.left ?? DEFAULT_PANELS.left)],
      right: [...(cfg.order?.right ?? DEFAULT_PANELS.right)],
    };
    const from = direction === "left" ? "right" : "left";
    order[from] = order[from].filter((p) => p !== panel);
    const to = direction as "left" | "right";
    order[to] = [...order[to].filter((p) => p !== panel), panel];
    patch.order = order;
  } else {
    return { ok: false, summary: "I didn't understand that screen customisation." };
  }
  const config = patchScreenConfig(patch);
  const summary =
    a === "style" && patch.style
      ? patch.style === "ironman"
        ? "Iron Man display online."
        : "Switched to the modern display."
      : "Updated your home screen.";
  return { ok: true, summary, config };
}
