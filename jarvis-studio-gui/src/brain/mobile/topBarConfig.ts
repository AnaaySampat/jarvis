/** Device-local Android header preferences. */
export const TOP_BAR_ACTIONS = {
  sound: { label: "Sound", icon: "volume", description: "Turn spoken replies on or off." },
  settings: { label: "Settings", icon: "settings", description: "Manage AI providers, voice and app preferences." },
  menu: { label: "Menu", icon: "more", description: "Open all tools and edit your shortcut bar." },
  activities: { label: "Activities", icon: "hand", description: "Read text, follow steps and use hand gestures." },
  tasks: { label: "Tasks", icon: "activity", description: "Check progress and stop running tasks." },
  devices: { label: "PC & TV", icon: "monitor", description: "Pair and control your computer or TV." },
  appearance: { label: "Appearance", icon: "palette", description: "Change your theme, home screen and shortcuts." },
  phone: { label: "Phone controls", icon: "power", description: "Open device controls for sound, brightness and more." },
} as const;
export type TopBarAction = keyof typeof TOP_BAR_ACTIONS;
export interface TopBarConfig {
  showStatus: boolean;
  showLabels: boolean;
  buttons: TopBarAction[];
}
export const DEFAULT_TOP_BAR: TopBarConfig = {
  showStatus: true,
  showLabels: false,
  buttons: ["sound", "settings"],
};
export function cleanTopBar(value?: unknown): TopBarConfig {
  const src = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const buttons: TopBarAction[] = Array.isArray(src.buttons)
    ? [
        ...new Set(
          src.buttons.filter(
            (id): id is TopBarAction =>
              typeof id === "string" && Object.prototype.hasOwnProperty.call(TOP_BAR_ACTIONS, id),
          ),
        ),
      ]
    : [...DEFAULT_TOP_BAR.buttons];
  // Always retain a route back to the editor, including for old or malformed data.
  if (!buttons.includes("settings") && !buttons.includes("menu")) {
    buttons.push("settings");
  }
  return {
    showStatus: typeof src.showStatus === "boolean" ? src.showStatus : DEFAULT_TOP_BAR.showStatus,
    showLabels: typeof src.showLabels === "boolean" ? src.showLabels : DEFAULT_TOP_BAR.showLabels,
    buttons,
  };
}
