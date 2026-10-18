/**
 * HUD look & layout persisted on-device (replaces desktop `customize_screen` / sendScreen).
 */

export interface ScreenConfig {
  accent?: string;
  accent2?: string;
  rgb?: [number, number, number];
  background?: string;
  density?: string;
  panels?: Record<string, boolean>;
  order?: { left?: string[]; right?: string[] };
}

const KEY = "jarvis.android.screen.v1";

export function loadScreenConfig(): ScreenConfig | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ScreenConfig) : null;
  } catch {
    return null;
  }
}

export function patchScreenConfig(patch: ScreenConfig): ScreenConfig {
  const prev = loadScreenConfig() ?? {};
  const next = deepMerge(prev, patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* quota */
  }
  return next;
}

function deepMerge(base: ScreenConfig, patch: ScreenConfig): ScreenConfig {
  const out: ScreenConfig = { ...base, ...patch };
  if (patch.panels) out.panels = { ...(base.panels ?? {}), ...patch.panels };
  if (patch.order) {
    out.order = {
      left: patch.order.left ?? base.order?.left,
      right: patch.order.right ?? base.order?.right,
    };
  }
  return out;
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
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* storage unavailable — nothing persisted to clear */
    }
    return { ok: true, summary: "Put your home screen back to the default layout." };
  }

  const patch: ScreenConfig = {};
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
  if (a === "toggle" && panel) {
    const now = loadScreenConfig()?.panels?.[panel] !== false;
    patch.panels = { [panel]: !now };
  } else if (a === "accent" && value) patch.accent = value;
  else if (a === "background" && value) patch.background = value;
  else if (a === "density" && value) patch.density = value;
  else if (a === "hide" && panel) patch.panels = { [panel]: false };
  else if (a === "show" && panel) patch.panels = { [panel]: true };
  else if (a === "move" && panel && (direction === "up" || direction === "down")) {
    // Advertised, but only left/right had a branch: up/down indexed order["up"] and threw.
    patch.order = moveInColumn(loadScreenConfig()?.order, panel, direction === "up" ? -1 : 1);
  } else if (a === "move" && panel && (direction === "left" || direction === "right")) {
    const cfg = loadScreenConfig() ?? {};
    const order = {
      left: [...(cfg.order?.left ?? ["system", "power", "agenda"])],
      right: [...(cfg.order?.right ?? ["weather", "network", "terminal"])],
    };
    const from = direction === "left" ? "right" : "left";
    const fromRail = order[from].filter((p) => p !== panel);
    const toRail = [...order[direction as "left" | "right"].filter((p) => p !== panel), panel];
    order[from] = fromRail;
    order[direction as "left" | "right"] = toRail;
    patch.order = order;
  } else {
    return { ok: false, summary: "I didn't understand that screen customisation." };
  }
  const config = patchScreenConfig(patch);
  return { ok: true, summary: "Updated your home screen.", config };
}
