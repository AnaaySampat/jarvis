import { useEffect, useRef, useCallback } from "react";
import { useWebSocket } from "./hooks/useWebSocket";
import "./overlay.css";

// Window frames the zoom-scaled pill (120px design × 0.8 ≈ 96px) with margin for
// its glow. ~20% smaller than the original 150/168/50 footprint.
const IDLE_W = 120;
const BUSY_W = 134;
const WIN_H = 40;
// Approve/Deny card (shown wherever the user is when JARVIS needs permission).
const PERM_W = 360;
const PERM_H = 120;
const BOTTOM_MARGIN = 10;

async function applyWindow(visible, busy, perm) {
  try {
    const { getCurrentWindow, LogicalSize, LogicalPosition } =
      await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    if (!visible) {
      await win.hide();
      return;
    }
    const w = perm ? PERM_W : busy ? BUSY_W : IDLE_W;
    const h = perm ? PERM_H : WIN_H;
    const screenLeft = window.screen.availLeft || 0;
    const screenTop = window.screen.availTop || 0;
    const screenWidth = window.screen.availWidth || window.screen.width;
    const screenHeight = window.screen.availHeight || window.screen.height;
    const x = Math.round(screenLeft + (screenWidth - w) / 2);
    const y = Math.round(screenTop + screenHeight - h - BOTTOM_MARGIN);
    await win.setSize(new LogicalSize(w, h));
    await win.setPosition(new LogicalPosition(x, y));
    await win.show();
  } catch {
    /* Browser dev preview, no Tauri window available. */
  }
}

function shouldShow(activeApp, overlay) {
  if (!overlay?.enabled) return false;
  if (!activeApp) return false;
  if (activeApp.on_jarvis) return false;
  // Normalise both sides to the bare process stem (drop ".exe", lowercase) and
  // compare for equality. Substring matching over-matched badly — a hide entry
  // "code" would also hide on "vscode", "chrome" on "chromium", etc.
  const stem = (s) =>
    String(s || "")
      .toLowerCase()
      .replace(/\.exe$/, "")
      .trim();
  const app = stem(activeApp.app);
  const list = (overlay.apps || []).map(stem).filter(Boolean);
  const matches = !!app && list.includes(app);
  if (overlay.mode === "only") return list.length ? matches : false;
  if (overlay.mode === "except") return !matches;
  return true;
}

const STATE_LABEL = {
  idle: "STANDBY",
  listening: "LISTENING",
  thinking: "THINKING",
  speaking: "SPEAKING",
  working: "EXECUTING",
};

const BAR_COUNT = 9;

// The animated waveform bars, rendered the same way in both the listening and
// the thinking/speaking states (only the wrapper around them differs).
function WaveBars() {
  return Array.from({ length: BAR_COUNT }).map((_, i) => (
    <span key={i} className="pill-bar" style={{ animationDelay: `${i * 70}ms` }} />
  ));
}

function CircuitLayer() {
  return (
    <svg className="pill-circuit" viewBox="0 0 877 284" aria-hidden="true">
      <defs>
        <filter id="pillCircuitGlow" x="-20%" y="-30%" width="140%" height="160%">
          <feGaussianBlur stdDeviation="2.6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <rect
        className="pill-capsule-outline pill-capsule-outline--wide"
        x="58"
        y="36"
        width="761"
        height="212"
        rx="106"
      />
      <rect
        className="pill-capsule-outline pill-capsule-outline--tight"
        x="78"
        y="55"
        width="721"
        height="174"
        rx="87"
      />

      <g className="pill-trace pill-trace--top">
        <path d="M146 67 H246 L262 51 H369" />
        <path d="M170 83 H274 L288 68 H382" />
        <path d="M210 51 H309 L319 41 H416" />
        <path d="M731 67 H631 L615 51 H508" />
        <path d="M707 83 H603 L589 68 H495" />
        <path d="M667 51 H568 L558 41 H461" />
      </g>

      <g className="pill-trace pill-trace--bottom">
        <path d="M148 218 H251 L267 234 H385" />
        <path d="M191 200 H292 L308 216 H412" />
        <path d="M729 218 H626 L610 234 H492" />
        <path d="M686 200 H585 L569 216 H465" />
      </g>

      <g className="pill-trace pill-trace--side">
        <path d="M104 91 V126 L87 143 L104 160 V195" />
        <path d="M128 80 V112 L112 128 V156 L128 172 V204" />
        <path d="M150 93 V122 L137 135 V149 L150 162 V191" />
        <path d="M773 91 V126 L790 143 L773 160 V195" />
        <path d="M749 80 V112 L765 128 V156 L749 172 V204" />
        <path d="M727 93 V122 L740 135 V149 L727 162 V191" />
      </g>

      <g className="pill-nodes">
        {[
          [146, 67],
          [246, 67],
          [319, 41],
          [731, 67],
          [631, 67],
          [558, 41],
          [148, 218],
          [267, 234],
          [729, 218],
          [610, 234],
          [104, 126],
          [128, 112],
          [150, 122],
          [773, 126],
          [749, 112],
          [727, 122],
        ].map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2.6" />
        ))}
      </g>
    </svg>
  );
}

function accentToRgb(accent) {
  const hex = String(accent || "").trim();
  const short = /^#([0-9a-f]{3})$/i.exec(hex);
  if (short) {
    return short[1]
      .split("")
      .map((c) => parseInt(c + c, 16))
      .join(", ");
  }
  const full = /^#([0-9a-f]{6})$/i.exec(hex);
  if (full) {
    const n = parseInt(full[1], 16);
    return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
  }
  return "0, 229, 255";
}

export default function Overlay() {
  const {
    status,
    stopSpeech,
    triggerListen,
    finishListen,
    activeApp,
    overlay,
    screen,
    permissionRequest,
    respondPermission,
  } = useWebSocket();

  const previewStatus = new URLSearchParams(window.location.search).get("status");
  const displayStatus = previewStatus || status;
  const busy = displayStatus !== "idle";
  // An Approve/Deny request OVERRIDES the normal show rules — hide-list, idle
  // state, AND the on-JARVIS exclusion: the user MUST see it wherever they are.
  // This used to also exclude on_jarvis, deferring to the main HUD's modal — but
  // that modal is only force-surfaced when the overlay is DISABLED, so with the
  // overlay enabled and the (≤1.5s-stale) foreground read coming back as a JARVIS
  // window — e.g. while a slow app like BlueJ was still cold-booting and hadn't
  // grabbed focus — the pill HID itself (shouldShow also bails on on_jarvis) and
  // the prompt was invisible in BOTH windows, silently stalling the task. The
  // pill is always-on-top, so showing the card is safe even over JARVIS's own
  // windows; a redundant HUD modal (if its window is visible) is harmless.
  const permPending = !!permissionRequest && overlay?.enabled !== false;
  const visible = permPending || shouldShow(activeApp, overlay);
  const accent = screen?.accent || "#00e5ff";
  const accentRgb = Array.isArray(screen?.rgb) ? screen.rgb.join(", ") : accentToRgb(accent);

  const lastApplied = useRef("");
  useEffect(() => {
    const key = `${visible}-${busy}-${permPending}`;
    if (key === lastApplied.current) return;
    lastApplied.current = key;
    applyWindow(visible, busy, permPending);
  }, [visible, busy, permPending]);

  const handleListen = useCallback(
    (e) => {
      e?.stopPropagation();
      triggerListen();
    },
    [triggerListen],
  );

  const handleStop = useCallback(
    (e) => {
      e?.stopPropagation();
      stopSpeech();
    },
    [stopSpeech],
  );

  // ✓ — finish listening now and process what was said (vs. ✕ which cancels).
  const handleCommit = useCallback(
    (e) => {
      e?.stopPropagation();
      finishListen();
    },
    [finishListen],
  );

  // Floating Approve/Deny card — replaces the pill while a request is pending.
  if (permPending) {
    return (
      <div className="pill-root">
        <div
          className="perm-card"
          style={{ color: accent, "--pill-rgb": accentRgb }}
          role="alertdialog"
          aria-label="Permission required"
        >
          <div className="perm-card-kicker">⚠ JARVIS — AUTHORISATION REQUIRED</div>
          <div className="perm-card-desc">
            Wants to <strong>{permissionRequest.description}</strong>
          </div>
          <div className="perm-card-actions">
            <button
              className="perm-card-btn perm-card-btn--deny"
              onClick={() => respondPermission(permissionRequest.id, false)}
            >
              DENY
            </button>
            <button
              className="perm-card-btn perm-card-btn--approve"
              onClick={() => respondPermission(permissionRequest.id, true)}
            >
              APPROVE
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pill-root">
      <div
        className={`pill pill--${displayStatus}${busy ? " is-busy" : ""}`}
        style={{ color: accent, "--pill-rgb": accentRgb }}
        title={busy ? displayStatus : "Tap to talk to JARVIS"}
        onClick={busy ? undefined : handleListen}
      >
        <div className="pill-face">
          <div className="pill-carbon" />
          <div className="pill-glass" />
          <CircuitLayer />

          {displayStatus === "idle" && (
            <div className="pill-brand" aria-hidden="true">
              JARVIS
            </div>
          )}

          <div className="pill-state" aria-live="polite">
            <span className="pill-state-dot" />
            <span>{STATE_LABEL[displayStatus] || String(displayStatus).toUpperCase()}</span>
          </div>

          {displayStatus === "listening" && (
            <div className="pill-listen-controls">
              <button
                className="pill-action pill-action--cancel"
                title="Cancel listening"
                aria-label="Cancel listening"
                onClick={handleStop}
              >
                x
              </button>
              <div className="pill-wave pill-wave--listening" aria-hidden="true">
                <WaveBars />
              </div>
              <button
                className="pill-action pill-action--ok"
                title="Done — process now"
                aria-label="Finish listening"
                onClick={handleCommit}
              />
            </div>
          )}

          {busy && displayStatus !== "listening" && (
            <div className="pill-wave" aria-hidden="true">
              <WaveBars />
            </div>
          )}

          {busy && displayStatus !== "listening" && (
            <button className="pill-stop" title="Stop" aria-label="Stop" onClick={handleStop}>
              x
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
