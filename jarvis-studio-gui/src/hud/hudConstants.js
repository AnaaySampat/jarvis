/* Plain values shared by the HUD components. Kept out of the .jsx files so those
   export only components (React Fast Refresh needs that). */

/* Sensible idle defaults so the cards look right before the first telemetry
   frame arrives. */
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

/* Default colours — recoloured per-user by hudConfig in App.jsx */
export const DEFAULT_DIRECTION = {
  accent: "#00e5ff",
  accent2: "#6fe9ff",
  rgb: [0, 229, 255],
};
