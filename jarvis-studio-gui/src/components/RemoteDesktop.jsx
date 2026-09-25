import { useCallback, useEffect, useRef, useState } from "react";
import { mapPointToScreen } from "../brain/remote/webrtcScreen";

/* ANDROID FORK — Remote Desktop (live view + direct control).
 *
 * Shows the paired PC's screen (a WebRTC video track from the desktop) and turns
 * touch into mouse/keyboard input:
 *   • single tap        → left click at that point
 *   • double tap        → double click
 *   • long-press (held) → right click
 *   • hold + drag       → real mouse drag (down → streamed move → up), e.g.
 *                         selecting text or moving a window
 *   • two-finger drag    → scroll (vertical)
 *   • keyboard toggle    → the device keyboard types into the PC
 *
 * Every gesture also drops an immediate visual ripple where the finger landed —
 * before, a tap gave no feedback until the NEXT video frame showed a UI change
 * (or didn't, if it missed), which is exactly what made control feel untrustworthy.
 *
 * Coordinates are sent NORMALIZED 0–1000 over the whole desktop — the exact frame
 * the video covers — so the PC's computer.click_xy lands DPI/resolution-independent.
 * Direct input only takes effect while the PC is "armed" (its consent window); until
 * then the Arm button is the call to action and taps are refused server-side.
 */

const TAP_MOVE_TOL = 12; // px — movement under this (with a quick release) is a tap
const TAP_MS = 320; // ms — press shorter than this is a tap
const DOUBLE_MS = 320; // ms — two taps within this window = double click
const SCROLL_STEP = 44; // px of two-finger travel per scroll notch
const LONG_PRESS_MS = 480; // ms — held still this long (no drag) = right-click
const DRAG_MOVE_THROTTLE_MS = 40; // min gap between streamed "move" events during a drag
let _rippleId = 0;

// One game-pad button: HOLDS its key while pressed (key_down on touch, key_up on
// release) so movement/modifiers behave like a real keyboard in games. Pointer
// capture guarantees the release fires even if the finger slides off the button.
function GameKey({ label, keyName, onKey, wide }) {
  const [down, setDown] = useState(false);
  const press = (e) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (!down) {
      setDown(true);
      onKey("key_down", keyName);
    }
  };
  const release = (e) => {
    e.preventDefault();
    if (down) {
      setDown(false);
      onKey("key_up", keyName);
    }
  };
  return (
    <button
      onPointerDown={press}
      onPointerUp={release}
      onPointerCancel={release}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        pointerEvents: "auto",
        minWidth: wide ? 88 : 46,
        height: 46,
        margin: 3,
        borderRadius: 8,
        border: "1px solid rgba(120,180,255,0.5)",
        background: down ? "rgba(80,180,255,0.55)" : "rgba(10,20,35,0.72)",
        color: "#dff0ff",
        fontWeight: 700,
        fontSize: 13,
        touchAction: "none",
        userSelect: "none",
      }}
    >
      {label}
    </button>
  );
}

// Floating touch game-pad: WASD on the left, common action keys on the right. It
// overlays the video (pointerEvents:none so it never eats a tap outside a button)
// and only shows while control is armed. Keys inject real scancodes on the PC
// (computer.key_down/up), so DirectInput games see them.
function GamePad({ onKey }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        padding: 12,
      }}
    >
      <div>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <GameKey label="W" keyName="w" onKey={onKey} />
        </div>
        <div style={{ display: "flex" }}>
          <GameKey label="A" keyName="a" onKey={onKey} />
          <GameKey label="S" keyName="s" onKey={onKey} />
          <GameKey label="D" keyName="d" onKey={onKey} />
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", maxWidth: 210 }}>
        <GameKey label="␣ Space" keyName="space" onKey={onKey} wide />
        <GameKey label="⇧ Shift" keyName="shift" onKey={onKey} wide />
        <GameKey label="Ctrl" keyName="ctrl" onKey={onKey} />
        <GameKey label="E" keyName="e" onKey={onKey} />
        <GameKey label="R" keyName="r" onKey={onKey} />
        <GameKey label="F" keyName="f" onKey={onKey} />
        <GameKey label="Esc" keyName="esc" onKey={onKey} />
        <GameKey label="⏎" keyName="enter" onKey={onKey} />
      </div>
    </div>
  );
}

export default function RemoteDesktop({
  hostLabel,
  screenState,
  screenDetail,
  screenStream,
  controlArmed,
  controlSecondsLeft,
  onArm,
  onDisarm,
  onInput,
  onStop,
  onClose,
  hudStatus,
  onSendMessage,
  onTriggerListen,
  onCommandMode,
}) {
  const videoRef = useRef(null);
  const surfaceRef = useRef(null);
  const kbdRef = useRef(null);
  const gesture = useRef({
    startX: 0,
    startY: 0,
    startT: 0,
    moved: false,
    lastTapT: 0,
    twoFingerY: 0,
    scrollAcc: 0,
    dragging: false,
    longPressFired: false,
    lastMoveSentT: 0,
  });
  const longPressTimer = useRef(null);
  const [cmdText, setCmdText] = useState("");
  const [gamepad, setGamepad] = useState(false);
  // Immediate visual feedback for taps/right-clicks (fading dots) and a live dot
  // that tracks a finger while dragging — the fix for "did that even register?".
  const [ripples, setRipples] = useState([]);
  const [dragPoint, setDragPoint] = useState(null);

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  /** A CLIENT point → coordinates relative to the video surface (for absolute positioning). */
  const toSurfaceRelative = useCallback((clientX, clientY) => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  /** Drop a fading ripple at a CLIENT point, positioned relative to the video surface. */
  const spawnRipple = useCallback(
    (clientX, clientY, kind) => {
      const rel = toSurfaceRelative(clientX, clientY);
      if (!rel) return;
      const id = ++_rippleId;
      setRipples((prev) => [...prev, { id, left: rel.x, top: rel.y, kind }]);
      setTimeout(() => setRipples((prev) => prev.filter((r) => r.id !== id)), 500);
    },
    [toSurfaceRelative],
  );

  // While this view is open, every command (typed in the bar OR spoken via the
  // mic) is for the PC on screen — flip the brain into PC-command mode so it
  // forwards them to the desktop directly instead of letting the phone LLM
  // decide (which is how "open Windows Explorer" once got refused as web-only).
  useEffect(() => {
    onCommandMode?.(true);
    return () => onCommandMode?.(false);
  }, [onCommandMode]);

  // Bind the incoming MediaStream to the <video>.
  useEffect(() => {
    const v = videoRef.current;
    if (v && screenStream && v.srcObject !== screenStream) {
      v.srcObject = screenStream;
      v.play?.().catch(() => {});
    }
  }, [screenStream]);

  /** Map a touch point to normalized 0–1000 over the video content (letterbox-aware). */
  const toNormalized = useCallback((clientX, clientY) => {
    const v = videoRef.current;
    if (!v) return null;
    const rect = v.getBoundingClientRect();
    return mapPointToScreen(
      rect,
      v.videoWidth || rect.width,
      v.videoHeight || rect.height,
      clientX,
      clientY,
    );
  }, []);

  const onTouchStart = useCallback(
    (e) => {
      const g = gesture.current;
      if (e.touches.length === 1) {
        const t = e.touches[0];
        g.startX = t.clientX;
        g.startY = t.clientY;
        g.startT = e.timeStamp;
        g.moved = false;
        g.dragging = false;
        g.longPressFired = false;
        clearLongPress();
        // Held still (no drag, no quick release) → right-click. Cancelled by
        // onTouchMove (once it becomes a drag) or onTouchEnd (once it's a tap).
        longPressTimer.current = setTimeout(() => {
          longPressTimer.current = null;
          if (g.moved || g.dragging) return;
          const pt = toNormalized(g.startX, g.startY);
          if (!pt) return;
          g.longPressFired = true;
          spawnRipple(g.startX, g.startY, "right");
          onInput({ action: "right_click", x: pt.x, y: pt.y });
        }, LONG_PRESS_MS);
      } else if (e.touches.length === 2) {
        clearLongPress();
        g.twoFingerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        g.scrollAcc = 0;
        g.moved = true; // a two-finger gesture is never a tap
      }
    },
    [clearLongPress, onInput, spawnRipple, toNormalized],
  );

  const onTouchMove = useCallback(
    (e) => {
      const g = gesture.current;
      if (e.touches.length === 2) {
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        g.scrollAcc += midY - g.twoFingerY;
        g.twoFingerY = midY;
        while (Math.abs(g.scrollAcc) >= SCROLL_STEP) {
          const dir = g.scrollAcc > 0 ? 1 : -1; // drag down (positive) → scroll up content
          onInput({ action: "scroll", amount: -dir }); // wheel notch; negative = up
          g.scrollAcc -= dir * SCROLL_STEP;
        }
        return;
      }
      if (e.touches.length === 1) {
        const t = e.touches[0];
        const past =
          Math.abs(t.clientX - g.startX) > TAP_MOVE_TOL ||
          Math.abs(t.clientY - g.startY) > TAP_MOVE_TOL;
        if (past && !g.moved) {
          g.moved = true;
          clearLongPress(); // real movement rules out a long-press
        }
        if (!g.moved || g.longPressFired) return;
        const now = e.timeStamp;
        if (!g.dragging) {
          // Movement just crossed the tap tolerance — this is now a DRAG. Press
          // down at the ORIGINAL point (not the current one), matching how a
          // physical drag starts, then stream live positions below.
          const startPt = toNormalized(g.startX, g.startY);
          if (!startPt) return;
          g.dragging = true;
          g.lastMoveSentT = now;
          g.lastX = t.clientX;
          g.lastY = t.clientY;
          onInput({ action: "down", x: startPt.x, y: startPt.y });
          setDragPoint(toSurfaceRelative(t.clientX, t.clientY));
          return;
        }
        g.lastX = t.clientX;
        g.lastY = t.clientY;
        if (now - g.lastMoveSentT < DRAG_MOVE_THROTTLE_MS) return;
        const pt = toNormalized(t.clientX, t.clientY);
        if (!pt) return;
        g.lastMoveSentT = now;
        setDragPoint(toSurfaceRelative(t.clientX, t.clientY));
        onInput({ action: "move", x: pt.x, y: pt.y });
      }
    },
    [clearLongPress, onInput, toNormalized, toSurfaceRelative],
  );

  const onTouchEnd = useCallback(
    (e) => {
      const g = gesture.current;
      clearLongPress();
      if (g.dragging) {
        g.dragging = false;
        setDragPoint(null);
        const last = e.changedTouches?.[0];
        const pt = last ? toNormalized(last.clientX, last.clientY) : null;
        if (pt) onInput({ action: "up", x: pt.x, y: pt.y });
        return;
      }
      if (g.longPressFired) return; // already handled by the long-press timer
      // Only treat a quick, still, single-finger release as a click.
      if (g.moved || e.timeStamp - g.startT > TAP_MS) return;
      const pt = toNormalized(g.startX, g.startY);
      if (!pt) return;
      const isDouble = e.timeStamp - g.lastTapT < DOUBLE_MS;
      g.lastTapT = isDouble ? 0 : e.timeStamp; // consume so a triple-tap isn't two doubles
      spawnRipple(g.startX, g.startY, isDouble ? "double" : "tap");
      onInput({ action: isDouble ? "double" : "click_xy", x: pt.x, y: pt.y });
    },
    [clearLongPress, onInput, spawnRipple, toNormalized],
  );

  // A held-down finger dragged off-screen (or the browser cancelled the touch) —
  // release the mouse button on the PC so it doesn't stay stuck down forever.
  const onTouchCancel = useCallback(() => {
    const g = gesture.current;
    clearLongPress();
    if (g.dragging) {
      g.dragging = false;
      setDragPoint(null);
      // Release wherever the finger last WAS, not the drag's starting point —
      // mouseUp(x, y) moves the cursor there before releasing, so using the
      // start point would snap the cursor back before letting go.
      const pt = toNormalized(g.lastX ?? g.startX, g.lastY ?? g.startY);
      if (pt) onInput({ action: "up", x: pt.x, y: pt.y });
    }
  }, [clearLongPress, onInput, toNormalized]);

  const focusKeyboard = useCallback(() => {
    kbdRef.current?.focus();
  }, []);

  const onKeyDown = useCallback(
    (e) => {
      const map = { Enter: "enter", Backspace: "backspace", Tab: "tab", Escape: "esc" };
      const key = map[e.key];
      if (key) {
        onInput({ action: "key", key });
        e.preventDefault();
      }
    },
    [onInput],
  );

  const onKbdInput = useCallback(
    (e) => {
      const data = e.nativeEvent?.data;
      if (data) onInput({ action: "type", text: data });
      e.target.value = ""; // keep the hidden field empty so it never grows
    },
    [onInput],
  );

  // Game-pad key events → the same remote-input channel as touch (held keys).
  const sendKey = useCallback((action, key) => onInput({ action, key }), [onInput]);

  // Give JARVIS a task on THIS PC without leaving the live view — goes through the
  // normal chat pipeline (same sendMessage the main HUD uses) so pc_task routing,
  // the conversation log, and spoken replies all work exactly as they do elsewhere.
  const submitCommand = useCallback(() => {
    const t = cmdText.trim();
    if (!t) return;
    onSendMessage?.(t);
    setCmdText("");
  }, [cmdText, onSendMessage]);

  const listening = hudStatus === "listening";
  const thinking = hudStatus === "thinking";

  const streaming = screenState === "streaming";
  const stateLabel =
    screenState === "connecting"
      ? "Connecting…"
      : screenState === "streaming"
        ? "Live"
        : screenState === "failed"
          ? "Couldn't connect"
          : "Idle";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        // Above hud-mobile.css's `.hud-fixed-btn { z-index: 260 !important }` and
        // `.mobile-mic` (210) — those are `position:fixed` HUD chrome that otherwise
        // shows through any lower overlay. Matches `.settings-overlay` (270), the
        // modal this replaces on-screen.
        zIndex: 280,
        background: "#05070c",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Top bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 12px",
          background: "rgba(10,16,26,0.9)",
          borderBottom: "1px solid rgba(80,120,180,0.25)",
        }}
      >
        <span style={{ fontWeight: 700, letterSpacing: 0.4, color: "#8fd0ff" }}>
          REMOTE DESKTOP
        </span>
        <span style={{ fontSize: 12, opacity: 0.65 }}>{hostLabel}</span>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 12,
            color: streaming ? "#36d399" : "#e0a800",
          }}
        >
          {stateLabel}
        </span>
        <button
          onClick={onStop}
          title="Stop JARVIS immediately — cancels any running task and disarms control"
          style={{
            marginLeft: 10,
            padding: "6px 12px",
            borderRadius: 6,
            border: "1px solid #ff5c5c",
            background: "rgba(255,60,60,0.16)",
            color: "#ff8080",
            fontWeight: 800,
            fontSize: 12,
            letterSpacing: 0.5,
          }}
        >
          ■ STOP
        </button>
        <button className="settings-x" onClick={onClose} style={{ marginLeft: 6 }}>
          ✕
        </button>
      </div>

      {/* Video surface */}
      <div
        ref={surfaceRef}
        style={{ position: "relative", flex: 1, overflow: "hidden", touchAction: "none" }}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchCancel}
          style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000" }}
        />

        {/* Tap/right-click feedback + a live dot tracking an in-progress drag —
            without this, a touch gave no confirmation until the next video frame
            happened to show a change (or silently didn't, if it missed). */}
        {ripples.map((r) => (
          <div
            key={r.id}
            className={`remote-tap-ripple ${r.kind === "right" ? "is-right" : ""}`}
            style={{ left: r.left, top: r.top }}
          />
        ))}
        {dragPoint && (
          <div className="remote-drag-dot" style={{ left: dragPoint.x, top: dragPoint.y }} />
        )}

        {controlArmed && gamepad && <GamePad onKey={sendKey} />}

        {!streaming && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              color: "#7a8aa0",
              fontSize: 14,
              textAlign: "center",
              padding: 24,
            }}
          >
            {screenState === "connecting" && (
              <div className="remote-progress-track">
                <div className="remote-progress-fill" />
              </div>
            )}
            {screenState === "connecting"
              ? screenDetail || "Connecting to your PC…"
              : screenState === "failed"
                ? "Couldn't connect to your PC's screen. Make sure it's turned on and on the same Wi-Fi — if you're on a different network, turn on the extra relay option in Remote PC settings."
                : "Starting…"}
          </div>
        )}

        {/* Hidden input that raises the soft keyboard and forwards keystrokes. */}
        <input
          ref={kbdRef}
          value=""
          onKeyDown={onKeyDown}
          onInput={onKbdInput}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          style={{ position: "absolute", left: -9999, width: 1, height: 1, opacity: 0 }}
        />
      </div>

      {/* Tell JARVIS what to do on THIS PC, without leaving the live view. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          background: "rgba(10,16,26,0.9)",
          borderTop: "1px solid rgba(80,120,180,0.25)",
        }}
      >
        <button
          onClick={onTriggerListen}
          title={listening ? "Listening… tap to stop" : "Speak a command to JARVIS"}
          style={{
            width: 36,
            height: 36,
            borderRadius: "50%",
            border: "1px solid rgba(80,160,255,0.4)",
            background: listening ? "#ff5c5c" : "rgba(20,40,70,0.9)",
            color: "#cfe8ff",
            fontSize: 16,
            flexShrink: 0,
          }}
        >
          🎙
        </button>
        <input
          value={cmdText}
          onChange={(e) => setCmdText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitCommand();
          }}
          placeholder={thinking ? "JARVIS is working on it…" : "Tell JARVIS what to do on this PC…"}
          disabled={thinking}
          style={{
            flex: 1,
            minWidth: 0,
            padding: "8px 10px",
            borderRadius: 6,
            border: "1px solid rgba(80,120,180,0.35)",
            background: "rgba(255,255,255,0.06)",
            color: "#e8f2ff",
            fontSize: 14,
          }}
        />
        <button
          onClick={submitCommand}
          disabled={!cmdText.trim() || thinking}
          className="settings-save"
          style={{
            width: "auto",
            padding: "8px 14px",
            opacity: !cmdText.trim() || thinking ? 0.5 : 1,
          }}
        >
          Send
        </button>
      </div>

      {/* Control bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 12px",
          background: "rgba(10,16,26,0.95)",
          borderTop: "1px solid rgba(80,120,180,0.25)",
        }}
      >
        {controlArmed ? (
          <>
            <span style={{ fontSize: 12, color: "#36d399", fontWeight: 600 }}>
              ● Control armed{controlSecondsLeft ? ` · ${Math.ceil(controlSecondsLeft / 60)}m` : ""}
            </span>
            <button className="dirlist-addbtn" onClick={onDisarm} style={{ marginLeft: "auto" }}>
              Disarm
            </button>
          </>
        ) : (
          <>
            <span style={{ fontSize: 12, color: "#e0a800" }}>View only — arm to control</span>
            <button
              className="settings-save"
              onClick={() => onArm(15)}
              style={{ marginLeft: "auto", width: "auto", padding: "8px 16px" }}
              disabled={!streaming}
            >
              Arm control (15m)
            </button>
          </>
        )}
        <button
          className="hud-fixed-btn"
          title="Show keyboard"
          onClick={focusKeyboard}
          disabled={!controlArmed}
          style={{ opacity: controlArmed ? 1 : 0.4 }}
        >
          ⌨
        </button>
        <button
          className="hud-fixed-btn"
          title={gamepad ? "Hide game controls" : "Show game controls (WASD + keys)"}
          onClick={() => setGamepad((v) => !v)}
          disabled={!controlArmed}
          style={{ opacity: controlArmed ? 1 : 0.4, background: gamepad ? "rgba(80,180,255,0.4)" : undefined }}
        >
          🎮
        </button>
      </div>
    </div>
  );
}
