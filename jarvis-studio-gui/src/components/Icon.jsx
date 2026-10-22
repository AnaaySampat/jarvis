/* Icon.jsx — the app's icon set.
 *
 * These were emoji. Emoji are the loudest "built at home" tell a UI can have: the
 * platform renders them as full-colour, differently-weighted glyphs that ignore the
 * accent colour, sit on their own baseline, and look nothing like each other. In a
 * monochrome sci-fi HUD driven by one accent variable, a row of them reads as a
 * debug toolbar.
 *
 * One stroke weight, one 24-grid, `currentColor` throughout — so every icon inherits
 * the accent, the disabled state, and the hover colour for free.
 */

const P = {
  // ── transport / voice ──
  mic: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm-6 9a6 6 0 0 0 12 0m-6 6v3",
  stop: "M7 7h10v10H7z",
  volume: "M4 9v6h4l5 4V5L8 9H4Zm12.5-.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12",
  volumeOff: "M4 9v6h4l5 4V5L8 9H4Z M17 9.5l4 5 M21 9.5l-4 5",
  // ── surfaces ──
  chat: "M4 5h16v11H9l-5 4V5Zm4 5h8M8 13h5",
  terminal: "M4 5h16v14H4zM8 9.5l3 2.5-3 2.5m5 0h3",
  globe:
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z",
  activity: "M3 12h4l3-8 4 16 3-8h4",
  monitor: "M3 4h18v12H3zM8 20h8M12 16v4",
  tv: "M3 6h18v12H3zM8 21h8M8 3l4 3 4-3",
  play: "M7 4v16l13-8L7 4Z",
  pencil: "M4 20h4L19 9l-4-4L4 16v4Z M13.5 6.5l4 4",
  palette:
    "M12 21a9 9 0 1 1 9-9c0 2-1.5 3-3.5 3H16a2 2 0 0 0-1.5 3.3A1.6 1.6 0 0 1 12 21ZM7.5 11h.01M10 7.5h.01M14.5 7.5h.01",
  settings:
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.3 7.3 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.3 7.3 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.3 7.3 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.3 7.3 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z",
  power: "M12 3v8m5.7-5.7a8 8 0 1 1-11.4 0",
  sparkle: "M12 3l2.1 5.4L19.5 10l-5.4 2.1L12 17.5l-2.1-5.4L4.5 10l5.4-1.6L12 3Z",
  memory:
    "M9 4a3 3 0 0 0-3 3v.2A3 3 0 0 0 4 10a3 3 0 0 0 1 2.2A3 3 0 0 0 7 17a3 3 0 0 0 5 2V5.5A2.5 2.5 0 0 0 9 4Zm6 0a3 3 0 0 1 3 3v.2A3 3 0 0 1 20 10a3 3 0 0 1-1 2.2A3 3 0 0 1 17 17a3 3 0 0 1-5 2M12 9h-2m2 5H9m3-5h2m-2 5h3",
  help: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M9.5 9.2a2.6 2.6 0 0 1 5 .8c0 1.7-2.5 2-2.5 4 M12 17h.01",
  // ── state / feedback ──
  robot: "M6 8h12v10H6z M12 8V5 M12 5h.01 M9.5 12h.01 M14.5 12h.01 M9.5 15.5h5 M3 11v4 M21 11v4",
  alert: "M12 3.5 22 20H2L12 3.5Z M12 10v4 M12 17h.01",
  shield: "M12 3l8 3v6c0 4.4-3.3 8.2-8 9-4.7-.8-8-4.6-8-9V6l8-3Z M12 8.5v4 M12 15.5h.01",
  close: "M6 6l12 12M18 6 6 18",
  check: "M5 12.5l4.5 4.5L19 7",
  cloud: "M7 18h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.6 1.5A3.3 3.3 0 0 0 7 18Z",
  // ── weather (the phone's Weather card; the brain's WMO table still hands out emoji) ──
  sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 2.5v2m0 15v2M5.3 5.3l1.4 1.4m10.6 10.6 1.4 1.4M2.5 12h2m15 0h2M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4",
  cloudSun:
    "M8 2.5V4M3 8h1.5M4.5 4.5l1 1m6.9-1-1 1M5.2 11.3A4 4 0 1 1 11.9 7.4M9 20h8.5a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.7 1.2A2.9 2.9 0 0 0 9 20Z",
  rain: "M7 15h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.6 1.5A3.3 3.3 0 0 0 7 15Zm1 3-1 2.5m5-2.5-1 2.5m5-2.5-1 2.5",
  snow: "M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5",
  storm: "M7 15h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.6 1.5A3.3 3.3 0 0 0 7 15Zm6 0-2 3.5h3L12 22",
  fog: "M7 13h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.6 1.5A3.3 3.3 0 0 0 7 13Zm-3 4h16M6 20.5h12",
  camera: "M4 8h3l2-3h6l2 3h3v11H4zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z",
  history: "M3 12a9 9 0 1 0 2.6-6.4L3 8.2M3 3.5v4.7h4.7M12 7.5V12l3 2",
  // ── empty states ──
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-10v6m0-9h.01",
  inbox: "M4 13h4l1.5 3h5l1.5-3h4 M4 13 6.5 5h11L20 13v6H4v-6Z",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v5m8-5v5",
  folder: "M3 6h6l2 2h10v11H3z",
  key: "M8 15a4 4 0 1 1 3.5-6H21v3h-2v2h-2v-2h-5.5A4 4 0 0 1 8 15Zm0-4h.01",
  route:
    "M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm12-10a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM6 15V9a4 4 0 0 1 4-4h4m4 4v6a4 4 0 0 1-4 4h-4",
  pin: "M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11Zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  chevronRight: "M9.5 6l6 6-6 6",
  chevronLeft: "M14.5 6l-6 6 6 6",
  chevronUp: "M6 14.5l6-6 6 6",
  chevronDown: "M6 9.5l6 6 6-6",
  plus: "M12 5v14M5 12h14",
  send: "M21 3 3 10.5l7.2 2.6L12.8 20 21 3Zm-10.8 10.1L15 8.4",
  trash: "M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3",
  paperclip:
    "M20 11.5 12.2 19.3a4.8 4.8 0 0 1-6.8-6.8l7.8-7.8a3.2 3.2 0 0 1 4.5 4.5l-7.8 7.8a1.6 1.6 0 0 1-2.3-2.3l7.1-7.1",
  wifi: "M2.5 9.5a14 14 0 0 1 19 0M5.5 12.8a9.5 9.5 0 0 1 13 0M8.6 16a5 5 0 0 1 6.8 0M12 19.5h.01",
  bluetooth: "M7 7.5l10 9-5 4v-17l5 4-10 9",
  battery: "M3 8h15v8H3zM21 11v2",
  lock: "M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3",
  moon: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z",
  restart: "M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5",
  logout: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10",
  external: "M14 4h6v6m0-6-9 9M18 14v6H4V6h6",
  clipboard: "M8 5h8v3H8z M8 6.5H5.5V21h13V6.5H16 M9 12h6 M9 16h4",
  hand: "M8 12V5.5a1.5 1.5 0 0 1 3 0V11 M11 10.5V4a1.5 1.5 0 0 1 3 0v6.5 M14 10.5V5.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-12.2 4.6L3.5 16a1.6 1.6 0 0 1 2.4-2.1L8 16",
  // ── the desktop's names (hud/icons.jsx there), so its screens port as they are ──
  skills:
    "M12 3v4m0 10v4M3 12h4m10 0h4M6.3 6.3l2.8 2.8m5.8 5.8 2.8 2.8m0-11.4-2.8 2.8m-5.8 5.8-2.8 2.8",
  caps: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-5v.01M12 13a2 2 0 1 0-2-2",
  mute: "M4 9v6h4l5 4V5L8 9H4Zm12 1 4 4m0-4-4 4",
  wake: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM4 10v2m16-2v2M12 18v3",
  talk: "M7 8h10M7 12h6m-9 8 3-4h11a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v14Z",
  minus: "M5 12h14",
  attach:
    "M20 11.5l-8 8a5 5 0 0 1-7.1-7.1l8.4-8.4a3.3 3.3 0 0 1 4.7 4.7l-8.4 8.4a1.7 1.7 0 0 1-2.4-2.4l7.7-7.7",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm9.5 2.5-4.6-4.6",
  copy: "M9 9h11v11H9zM5.5 15H4V4h11v1.5",
  edit: "M4 20h4L19.5 8.5l-4-4L4 16v4Zm9.5-13.5 4 4",
  chevDown: "M6 9l6 6 6-6",
  chevUp: "M6 15l6-6 6 6",
  chevRight: "M9 6l6 6-6 6",
  arrowRight: "M5 12h14m-6-6 6 6-6 6",
  arrowLeft: "M19 12H5m6-6-6 6 6 6",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  eyeOff:
    "M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-2.7 3.5M6.6 6.6A16.8 16.8 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2",
  qr: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2M14 18h2v2M18 18h2v2h-2",
  record: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  video: "M3 7h12v10H3zM15 10.5l6-3.5v10l-6-3.5",
  keyboard: "M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10",
  phone: "M8 3h8v18H8zM11 18h2",
  message: "M4 20l1.4-4A8 8 0 1 1 8 19.6L4 20Z",
  plug: "M9 3v5m6-5v5M6 8h12v3a6 6 0 0 1-12 0V8Zm6 9v4",
  spark:
    "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Zm7 12 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z",
  layout: "M3 4h18v16H3zM9 4v16m0-10h12",
  cursor: "M5 3l14 7-6 2-2 6L5 3Z",
  wrench:
    "M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4 2.6-2.6Z",
  bell: "M6 16v-5a6 6 0 0 1 12 0v5l2 2H4l2-2Zm4 4a2 2 0 0 0 4 0",
  command: "M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6Z",
  warning: "M12 4 2.5 20h19L12 4Zm0 6v4m0 3h.01",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0",
  undo: "M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3",
  hourglass: "M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9",
  scroll: "M12 4v16m-4-4 4 4 4-4M8 8l4-4 4 4",
  note: "M5 4h14v16H5zM9 8h6M9 12h6M9 16h3",
  drizzle:
    "M7 15h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.6 1.5A3.3 3.3 0 0 0 7 15Zm1 4h.01M12 19h.01M16 19h.01",
  droplet: "M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z",
  wind: "M3 9h11a3 3 0 1 0-3-3M3 15h14a3 3 0 1 1-3 3M3 12h7",
  leaf: "M5 20c0-8 5-14 15-15-1 10-6 15-14 15M5 20l7-7",
  arrowDown: "M12 5v14m-6-6 6 6 6-6",
  download: "M12 4v11m-5-5 5 5 5-5M5 20h14",
  upload: "M12 16V5m-5 5 5-5 5 5M5 20h14",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9.5h.01",
  grip: "M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01",
  arrowUp: "M12 19V5m-6 6 6-6 6 6",
  charging: "M3 8h15v8H3zM21 11v2M11.5 9.5 9.5 12h3l-2 2.5",
  cpu: "M7 7h10v10H7zM10 10h4v4h-4zM10 3v4m4-4v4m-4 10v4m4-4v4M3 10h4m-4 4h4m10-4h4m-4 4h4",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13.5V12l3 2",
};

/**
 * @param {{name: keyof typeof P, size?: number, className?: string, strokeWidth?: number}} props
 */
export default function Icon({ name, size = 20, className = "", strokeWidth = 1.5 }) {
  const d = P[name];
  if (!d) return null;
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}
