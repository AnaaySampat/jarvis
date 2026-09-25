/* Plain values shared by the HUD components. Kept out of the .jsx files so those
   export only components (React Fast Refresh needs that). */

/* Sensible idle defaults so the HUD looks alive before the first telemetry
   frame arrives over the socket. */
export const DEFAULT_TELEMETRY = {
  cpu: 0,
  ram: 0,
  disk: 0,
  diskActivity: 0,
  gpu: 0,
  net: 0,
  down: 0,
  up: 0,
  ping: 0,
  temp: null,
  batteryPct: null,
  charging: false,
  remaining: "",
  ramTotalGb: 8,
  diskUsedGb: 0,
  diskTotalGb: 0,
  gpuName: "",
  linkLabel: "ONLINE",
};

/* ───────── status labels (idle→listening→thinking→speaking) ───────── */
// idle/listening are the app's resting states, so they take the accent — hardcoded
// cyan left the status dot and label stuck on the default while the rest of a
// recoloured HUD moved, which reads as a rendering bug rather than a theme.
// thinking/speaking/working keep their own hues: those distinguish *what JARVIS is
// doing* at a glance, and collapsing them into one accent would lose that.
export const STATUS_META = {
  idle: { label: 'STANDBY — say "Hey Jarvis"', col: "var(--ac2, #00c8ff)" },
  listening: { label: "LISTENING…", col: "var(--ac, #00e5ff)" },
  thinking: { label: "PROCESSING REQUEST…", col: "#78b4ff" },
  speaking: { label: "RESPONDING…", col: "#ffb648" },
  working: { label: "EXECUTING TASK…", col: "#22e39a" },
};

/* Default HUD look — recolored per-user by hudConfig in App.jsx */
export const DEFAULT_DIRECTION = {
  id: "reactor",
  name: "REACTOR CORE",
  layout: "hud--reactor",
  accent: "#00e5ff",
  accent2: "#6fe9ff",
  rgb: [0, 229, 255],
  tagline: "Symmetric · classic Stark",
  spokes: false,
  sysVariant: "radial",
};
