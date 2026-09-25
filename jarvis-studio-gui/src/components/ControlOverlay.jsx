// ControlOverlay.jsx — the floating "JARVIS CONTROLLING" HUD shown DURING desktop
// computer control.
//
// Compact bar by default (LIVE/PAUSED + timer, Stop / Pause-Resume / Minimize, and
// a CORRECTION textbox to steer JARVIS mid-task). EXPAND it to watch the whole
// process live: the PLAN, the scrolling step log, and the screenshots JARVIS is
// taking. Minimize it to a tiny LIVE pill.
//
// It's its own Tauri window (label "control-overlay") because while JARVIS drives
// the desktop the controlled app is in front, not the main HUD. It never covers the
// screen, so it can't block JARVIS's own clicks; the window TITLE is "JARVIS", so
// computer._guard() treats it as JARVIS's own and won't actuate while you type here.

import { useEffect, useMemo, useRef, useState } from "react";
import { useWebSocket } from "../hooks/useWebSocket";
import "./control-overlay.css";

const W = 580,
  H = 132,
  EXP_H = 452,
  MIN_W = 210,
  MIN_H = 48;

function fmt(secs) {
  const s = Math.max(0, Math.floor(secs));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function stepIcon(line) {
  const s = (line || "").toLowerCase();
  if (s.startsWith("plan:")) return "🧭";
  if (s.startsWith("✗") || s.includes("failed") || s.includes("couldn't")) return "✕";
  if (s.includes("launch") || s.includes("opened") || s.includes("open ")) return "🚀";
  if (s.includes("click")) return "🖱";
  if (s.includes("type")) return "⌨";
  if (s.includes("press")) return "⌨";
  if (s.includes("focus")) return "🎯";
  if (s.includes("scroll")) return "↕";
  if (s.includes("wait")) return "⏳";
  if (s.includes("paused")) return "⏸";
  if (s.includes("resumed")) return "▶";
  if (s.includes("correction")) return "✎";
  if (s.includes("note")) return "📝";
  if (s.includes("done") || s.includes("✓") || s.includes("success")) return "✓";
  return "•";
}

async function applyWindow(visible, minimized, expanded) {
  try {
    const { getCurrentWindow, LogicalSize, LogicalPosition } =
      await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    if (!visible) {
      await win.hide();
      return;
    }
    const left = window.screen.availLeft || 0;
    const top = window.screen.availTop || 0;
    const screenW = window.screen.availWidth || window.screen.width;
    const w = minimized ? MIN_W : W;
    const h = minimized ? MIN_H : expanded ? EXP_H : H;
    const x = Math.round(left + (screenW - w) / 2); // top-center
    await win.setSize(new LogicalSize(w, h));
    await win.setPosition(new LogicalPosition(x, top + 12));
    await win.show();
    await win.setAlwaysOnTop(true);
  } catch (err) {
    console.warn("[ControlOverlay] applyWindow failed:", err);
  }
}

const NO_ITEMS = []; // one stable empty array, so the memos below don't recompute

export default function ControlOverlay() {
  const { controlState, agentTasks, status, screen, stopControl, pauseControl, sendCorrection } =
    useWebSocket();

  const armed = !!controlState.armed;
  const paused = !!controlState.paused;
  const task = useMemo(
    () => (agentTasks || []).filter((t) => t.kind === "computer").slice(-1)[0],
    [agentTasks],
  );
  const running = !!task && task.status === "running";
  const visible = armed || running;

  const [minimized, setMinimized] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState("");
  const [autoPaused, setAutoPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(null);
  const lastApplied = useRef("");
  const stepsRef = useRef(null);

  // Reset on hide during render (React's pattern for state derived from a prop change)
  // rather than in an effect, which paints the stale value first.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (!visible) {
      setElapsed(0);
      setMinimized(false);
    }
  }

  useEffect(() => {
    if (!visible) {
      startRef.current = null;
      return;
    }
    if (startRef.current == null) startRef.current = Date.now();
    const id = setInterval(() => setElapsed((Date.now() - startRef.current) / 1000), 500);
    return () => clearInterval(id);
  }, [visible]);

  // Drive the Tauri window from visibility / minimized / expanded.
  useEffect(() => {
    const key = visible ? (minimized ? "min" : expanded ? "exp" : "full") : "hidden";
    if (key === lastApplied.current) return;
    lastApplied.current = key;
    applyWindow(visible, minimized, expanded);
  }, [visible, minimized, expanded]);

  // Decompose the autopilot feed: the plan line, the step rows, the latest shot.
  const items = task?.items ?? NO_ITEMS;
  const planLine = useMemo(() => {
    const p = items.find(
      (it) => it.kind === "step" && (it.line || "").toLowerCase().startsWith("plan:"),
    );
    return p ? p.line.replace(/^plan:\s*/i, "") : "";
  }, [items]);
  const stepRows = useMemo(
    () =>
      items
        .filter((it) => it.kind === "step" && !(it.line || "").toLowerCase().startsWith("plan:"))
        .slice(-40),
    [items],
  );
  const lastShot = useMemo(() => [...items].reverse().find((it) => it.kind === "shot"), [items]);
  const lastStep = stepRows.length ? stepRows[stepRows.length - 1].line : "";

  // Keep the step log pinned to the newest line.
  useEffect(() => {
    const el = stepsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [stepRows.length, lastShot?.image, expanded]);

  const themeStyle = useMemo(
    () => ({
      "--co-ac": screen?.accent || "#00e5ff",
      "--co-ac2": screen?.accent2 || "#6fe9ff",
    }),
    [screen?.accent, screen?.accent2],
  );

  const togglePause = () => pauseControl(!paused);
  const onCorrFocus = () => {
    if (!paused) {
      setAutoPaused(true);
      pauseControl(true);
    }
  };
  const onCorrBlur = () => {
    if (autoPaused) {
      setAutoPaused(false);
      pauseControl(false);
    }
  };
  const sendCorr = () => {
    const t = draft.trim();
    if (!t) return;
    sendCorrection(t);
    setDraft("");
  };

  const startDrag = async (e) => {
    if (e.target.closest("button, input, .co-steps, .co-shot")) return;
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().startDragging();
    } catch {
      /* not in Tauri */
    }
  };

  if (minimized) {
    return (
      <div
        className={`co-root co-min${paused ? " co-paused" : ""}`}
        style={themeStyle}
        onMouseDown={startDrag}
      >
        <span className="co-dot" aria-hidden="true" />
        <span className="co-min-time">{fmt(elapsed)}</span>
        <button className="co-btn co-stop" title="Stop" onClick={stopControl}>
          ■
        </button>
        <button className="co-btn" title="Expand" onClick={() => setMinimized(false)}>
          ⤢
        </button>
      </div>
    );
  }

  return (
    <div
      className={`co-root${paused ? " co-paused" : ""}${expanded ? " co-exp" : ""}`}
      style={themeStyle}
      onMouseDown={startDrag}
    >
      <span className="co-bracket co-tl" aria-hidden="true" />
      <span className="co-bracket co-tr" aria-hidden="true" />
      <span className="co-bracket co-bl" aria-hidden="true" />
      <span className="co-bracket co-br" aria-hidden="true" />

      <div className="co-bar">
        <span className="co-dot" aria-hidden="true" />
        <span className="co-title">JARVIS CONTROLLING</span>
        <span className={`co-live${paused ? " co-live--paused" : ""}`}>
          {paused ? "PAUSED" : "LIVE"}
        </span>
        <span className="co-time">{fmt(elapsed)}</span>
        <div className="co-spacer" />
        <button className="co-btn co-stop" title="Stop & disarm" onClick={stopControl}>
          ■ Stop
        </button>
        <button
          className="co-btn co-pause"
          title={paused ? "Resume" : "Pause"}
          onClick={togglePause}
        >
          {paused ? "▶ Resume" : "❚❚ Pause"}
        </button>
        <button
          className="co-btn co-icon"
          title={expanded ? "Collapse" : "Show full process"}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "⤡" : "⤢"}
        </button>
        <button className="co-btn co-icon" title="Minimize" onClick={() => setMinimized(true)}>
          —
        </button>
      </div>

      {expanded ? (
        <>
          {task?.goal && (
            <div className="co-goal" title={task.goal}>
              {task.goal}
            </div>
          )}
          {planLine && (
            <div className="co-plan">
              <span className="co-plan-ico" aria-hidden="true">
                🧭
              </span>
              <span className="co-plan-txt" title={planLine}>
                {planLine}
              </span>
            </div>
          )}
          <div className="co-feed">
            {lastShot?.image && (
              <div className="co-shot">
                <span className="co-shot-label">SEEN</span>
                <img src={lastShot.image} alt="what JARVIS sees" />
              </div>
            )}
            <div className="co-steps" ref={stepsRef} aria-live="polite">
              {stepRows.length === 0 && (
                <div className="co-step co-step--muted">
                  <span className="co-step-ico">⏳</span>
                  <span className="co-step-txt">
                    {paused ? "Paused — holding." : "Watching the screen…"}
                  </span>
                </div>
              )}
              {stepRows.map((it, i) => (
                <div key={i} className={`co-step${it.ok === false ? " co-step--fail" : ""}`}>
                  <span className="co-step-ico">{stepIcon(it.line)}</span>
                  <span className="co-step-txt">{it.line}</span>
                </div>
              ))}
              {running && !paused && (
                <div className="co-step co-step--live">
                  <span className="co-step-ico">⏳</span>
                  <span className="co-step-txt">
                    {status === "thinking" ? "Thinking…" : "Working…"}
                  </span>
                </div>
              )}
              {task && task.status !== "running" && task.summary && (
                <div className="co-summary">{task.summary}</div>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="co-status" title={lastStep}>
          <span className="co-status-ico" aria-hidden="true">
            ▸
          </span>
          <span className="co-status-txt">
            {lastStep || (paused ? "Paused — JARVIS is holding." : "Working…")}
          </span>
        </div>
      )}

      <div className="co-corr">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={onCorrFocus}
          onBlur={onCorrBlur}
          onKeyDown={(e) => {
            if (e.key === "Enter") sendCorr();
          }}
          placeholder="Tell JARVIS what to fix…"
        />
        <button className="co-btn co-send" title="Send correction" onClick={sendCorr}>
          ➤
        </button>
      </div>
    </div>
  );
}
