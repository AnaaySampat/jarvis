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
  mic: "M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3ZM5 11a7 7 0 0 0 14 0M12 18v3",
  stop: "M7 7h10v10H7z",
  volume: "M4 9v6h4l5 4V5L8 9H4Z M16.5 8.5a5 5 0 0 1 0 7 M19 6a8.5 8.5 0 0 1 0 12",
  volumeOff: "M4 9v6h4l5 4V5L8 9H4Z M17 9.5l4 5 M21 9.5l-4 5",
  // ── surfaces ──
  chat: "M4 5h16v11H9l-5 4V5Z",
  terminal: "M4 4h16v16H4z M8 9l3 3-3 3 M13 15h4",
  globe:
    "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M3 12h18 M12 3c2.5 2.4 3.8 5.4 3.8 9S14.5 18.6 12 21c-2.5-2.4-3.8-5.4-3.8-9S9.5 5.4 12 3Z",
  activity: "M3 5h18v14H3z M3 9h18 M8 5v4 M16 5v4 M8 13h8 M8 16h5",
  monitor: "M3 4h18v12H3z M8 20h8 M12 16v4",
  palette:
    "M12 3a9 9 0 0 0 0 18c1.1 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.1 0-.9.8-1.7 1.7-1.7H16a5 5 0 0 0 5-5c0-4-4-7.3-9-7.3Z M7.5 12.5h.01 M9.5 8.5h.01 M14.5 8h.01",
  settings:
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.4 1Z",
  power: "M12 3v9 M7.5 6.2a8 8 0 1 0 9 0",
  sparkle: "M12 3l2.1 5.4L19.5 10l-5.4 2.1L12 17.5l-2.1-5.4L4.5 10l5.4-1.6L12 3Z",
  memory:
    "M9 4a3 3 0 0 0-3 3v.2A3 3 0 0 0 4 10a3 3 0 0 0 1 2.2A3 3 0 0 0 7 17a3 3 0 0 0 5 2V5.5A2.5 2.5 0 0 0 9 4Zm6 0a3 3 0 0 1 3 3v.2A3 3 0 0 1 20 10a3 3 0 0 1-1 2.2A3 3 0 0 1 17 17a3 3 0 0 1-5 2M12 9h-2m2 5H9m3-5h2m-2 5h3",
  help: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M9.5 9.2a2.6 2.6 0 0 1 5 .8c0 1.7-2.5 2-2.5 4 M12 17h.01",
  // ── state / feedback ──
  robot: "M6 8h12v10H6z M12 8V5 M12 5h.01 M9.5 12h.01 M14.5 12h.01 M9.5 15.5h5 M3 11v4 M21 11v4",
  alert: "M12 3.5 22 20H2L12 3.5Z M12 10v4 M12 17h.01",
  shield: "M12 3l8 3v6c0 4.4-3.3 8.2-8 9-4.7-.8-8-4.6-8-9V6l8-3Z M12 8.5v4 M12 15.5h.01",
  close: "M6 6l12 12 M18 6 6 18",
  camera: "M4 7h4l1.5-2h5L16 7h4v12H4z M12 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z",
  history: "M3.5 12a8.5 8.5 0 1 0 2.6-6.1 M3 4v4h4 M12 8v4.5l3 1.7",
  // ── empty states ──
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M12 11v5.5 M12 7.8h.01",
  inbox: "M4 13h4l1.5 3h5l1.5-3h4 M4 13 6.5 5h11L20 13v6H4v-6Z",
  calendar: "M4 6h16v14H4z M4 10h16 M8 3.5v4 M16 3.5v4",
  folder: "M3 6h6l2 2.5h10V19H3V6Z",
  key: "M8 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z M11.5 12H21 M18 12v3 M15 12v2",
  route:
    "M6 4a1.5 1.5 0 1 0 0 3 1.5 1.5 0 1 0 0-3Z M18 17a1.5 1.5 0 1 0 0 3 1.5 1.5 0 1 0 0-3Z M6 7v4a3 3 0 0 0 3 3h6a3 3 0 0 1 3 3",
  pin: "M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z M12 12.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z",
  chevronRight: "M9.5 6l6 6-6 6",
  chevronLeft: "M14.5 6l-6 6 6 6",
  plus: "M12 5v14 M5 12h14",
  send: "M4 12 20 4l-4 16-4.5-6.5L4 12Z M11.5 13.5 20 4",
  trash: "M4 7h16 M9.5 7V4.5h5V7 M6.5 7l1 13h9l1-13 M10 11v5.5 M14 11v5.5",
  paperclip:
    "M20 11.5 12.2 19.3a4.8 4.8 0 0 1-6.8-6.8l7.8-7.8a3.2 3.2 0 0 1 4.5 4.5l-7.8 7.8a1.6 1.6 0 0 1-2.3-2.3l7.1-7.1",
  wifi: "M3 9a13 13 0 0 1 18 0 M6 12.5a8.5 8.5 0 0 1 12 0 M9 16a4 4 0 0 1 6 0 M12 19.5h.01",
  bluetooth: "M7 7.5l10 9-5 4v-17l5 4-10 9",
  battery: "M3 8h15v8H3z M21 11v2 M6 11v2",
  lock: "M6 11h12v9H6z M8.5 11V8a3.5 3.5 0 0 1 7 0v3",
  moon: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z",
  restart: "M20 12a8 8 0 1 1-2.3-5.6 M20 4v4.5h-4.5",
  logout: "M14 4h5v16h-5 M10 8l-4 4 4 4 M6 12h10",
  external: "M14 4h6v6 M20 4l-9 9 M18 14v6H4V6h6",
  clipboard: "M8 5h8v3H8z M8 6.5H5.5V21h13V6.5H16 M9 12h6 M9 16h4",
  hand: "M8 12V5.5a1.5 1.5 0 0 1 3 0V11 M11 10.5V4a1.5 1.5 0 0 1 3 0v6.5 M14 10.5V5.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-12.2 4.6L3.5 16a1.6 1.6 0 0 1 2.4-2.1L8 16",
};

/**
 * @param {{name: keyof typeof P, size?: number, className?: string, strokeWidth?: number}} props
 */
export default function Icon({ name, size = 20, className = "", strokeWidth = 1.6 }) {
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
