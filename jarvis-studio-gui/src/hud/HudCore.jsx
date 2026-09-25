/* HudCore.jsx — the centerpiece: an angular visor faceplate wrapped in
   counter-rotating reactor rings. SVG faceplate layered over a canvas ring
   engine. Ported from jarvis-hud/hud-core.jsx (window-globals → ES modules).
   Exports: ReactorCore, ReactorRings, Waveform, BootSequence  */

import { useRef, useEffect, useState } from "react";
import { isMobileViewport } from "../utils/isMobileViewport";

/* ───────────────────────── Reactor ring engine (canvas) ──────────────────── */
const CORE_MOODS = {
  idle: { speed: 0.4, energy: 0.34 },
  listening: { speed: 1.3, energy: 0.95 },
  thinking: { speed: 0.95, energy: 0.75 },
  speaking: { speed: 1.7, energy: 1.0 },
};
function _lerp(a, b, t) {
  return a + (b - a) * t;
}

const HUD_FRAME_MIN_MS = isMobileViewport() ? 1000 / 30 : 0; // 0 = uncapped

export function ReactorRings({
  status = "idle",
  size = 522,
  rgb = [0, 229, 255],
  layer = "all",
  className = "",
}) {
  const cvs = useRef(null);
  const raf = useRef(null);
  const cur = useRef({ speed: 0.4, energy: 0.34 });
  // Destructured out here so the effect depends on the three numbers, not on the
  // array (a new [r,g,b] each render would restart the animation loop).
  const [R0, G0, B0] = rgb;

  useEffect(() => {
    const canvas = cvs.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);
    let t0 = null;
    let lastDraw = -Infinity;

    function frame(ts) {
      raf.current = requestAnimationFrame(frame);
      if (t0 == null) t0 = ts;
      // Throttle the redraw rate on mobile (skip frames between draws). The phase is
      // derived from `ts`, so skipping never breaks the animation — just smooths cost.
      if (HUD_FRAME_MIN_MS && ts - lastDraw < HUD_FRAME_MIN_MS) return;
      lastDraw = ts;
      const t = (ts - t0) / 1000;
      const tgt = CORE_MOODS[status] ?? CORE_MOODS.idle;
      const c = cur.current,
        k = 0.06;
      c.speed = _lerp(c.speed, tgt.speed, k);
      c.energy = _lerp(c.energy, tgt.energy, k);

      const w = size,
        h = size,
        cx = w / 2,
        cy = h / 2,
        R = w * 0.46;
      const rgba = (a) => `rgba(${R0},${G0},${B0},${a})`;
      const pulse = 0.5 + 0.5 * Math.sin(t * (1.0 + c.energy * 1.6));
      const drawBack = layer === "all" || layer === "back";
      const drawFront = layer === "all" || layer === "front";
      ctx.clearRect(0, 0, w, h);

      if (drawBack) {
        // outer dotted ring
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(t * c.speed * 0.25);
        const dots = 90;
        for (let i = 0; i < dots; i++) {
          const a = (i / dots) * Math.PI * 2;
          const on = i % 3 !== 0;
          ctx.beginPath();
          ctx.arc(Math.cos(a) * R * 0.98, Math.sin(a) * R * 0.98, on ? 2.8 : 3.6, 0, Math.PI * 2);
          ctx.fillStyle = rgba(on ? 0.22 : 0.5);
          ctx.fill();
        }
        ctx.restore();

        // tick ring CW
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(t * c.speed * 0.5);
        const ticks = 60;
        for (let i = 0; i < ticks; i++) {
          const a = (i / ticks) * Math.PI * 2,
            long = i % 5 === 0;
          const r0 = R * (long ? 0.78 : 0.83),
            r1 = R * 0.9;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
          ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
          ctx.lineWidth = long ? 3.6 : 2.7;
          ctx.strokeStyle = rgba(long ? 0.55 : 0.22);
          ctx.stroke();
        }
        ctx.restore();
      }

      if (drawFront) {
        // segmented arcs CCW
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(-t * c.speed * 0.7);
        const segs = 7;
        for (let i = 0; i < segs; i++) {
          const a0 = (i / segs) * Math.PI * 2 + 0.18;
          const a1 = a0 + ((Math.PI * 2) / segs) * 0.52;
          ctx.beginPath();
          ctx.arc(0, 0, R * 0.72, a0, a1);
          ctx.lineWidth = 4.2;
          ctx.strokeStyle = rgba(0.6);
          ctx.stroke();
        }
        ctx.restore();

        // inner gauge arc CW
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(t * c.speed * 0.9);
        ctx.beginPath();
        ctx.arc(0, 0, R * 0.6, -0.4, 1.7);
        ctx.lineWidth = 5;
        ctx.strokeStyle = rgba(0.8);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, R * 0.6, Math.PI - 0.4, Math.PI + 1.2);
        ctx.lineWidth = 3.4;
        ctx.strokeStyle = rgba(0.4);
        ctx.stroke();
        ctx.restore();
      }

      // breathing rim glow
      ctx.beginPath();
      ctx.arc(cx, cy, R * (0.9 + 0.012 * pulse), 0, Math.PI * 2);
      ctx.lineWidth = 3.2;
      ctx.strokeStyle = rgba(0.3 + 0.2 * pulse);
      ctx.stroke();
    }
    const onVis = () => {
      if (document.hidden) cancelAnimationFrame(raf.current);
      else {
        t0 = null;
        raf.current = requestAnimationFrame(frame);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    raf.current = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf.current);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [status, size, layer, R0, G0, B0]);

  return (
    <canvas
      ref={cvs}
      className={className}
      style={{ width: size, height: size, display: "block" }}
      aria-hidden="true"
    />
  );
}

/* ───────────────────────── Visor faceplate (original SVG) ─────────────────── */
function VisorFace({ w = 302 }) {
  const h = w * (610 / 409);
  return (
    <svg
      className="visor visor--trace"
      viewBox="0 0 409 610"
      width={w}
      height={h}
      aria-hidden="true"
    >
      <image
        className="iron-trace-image"
        href="/assets/ironman-helmet-kept.png"
        x="0"
        y="0"
        width="409"
        height="610"
        preserveAspectRatio="xMidYMid meet"
      />
    </svg>
  );
}

/* ───────────────────────── ReactorCore (assembled) ───────────────────────── */
export function ReactorCore({
  status = "idle",
  size = 522,
  rgb = [0, 229, 255],
  showVisor = true,
}) {
  return (
    <div className="reactor" style={{ width: size, height: size }}>
      <div className="reactor-glow" />
      <ReactorRings
        className="reactor-rings reactor-rings--back"
        layer="back"
        status={status}
        size={size}
        rgb={rgb}
      />
      {showVisor && (
        <div className="visor-wrap">
          <VisorFace status={status} w={size * 0.58} />
        </div>
      )}
      {showVisor && (
        <ReactorRings
          className="reactor-rings reactor-rings--front"
          layer="front"
          status={status}
          size={size}
          rgb={rgb}
        />
      )}
      {!showVisor && <div className={`reactor-pip reactor-pip--${status}`} />}
    </div>
  );
}

/* ───────────────────────── Waveform (status reactive) ─────────────────────── */
export function Waveform({ status = "idle", bars = 34, height = 48, rgb = [0, 229, 255] }) {
  const [seed, setSeed] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSeed((s) => s + 1), 120);
    return () => clearInterval(id);
  }, []);
  const amp =
    status === "listening"
      ? 1
      : status === "speaking"
        ? 0.85
        : status === "thinking"
          ? 0.5
          : status === "working"
            ? 0.6
            : 0.22;
  const col = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  return (
    <div className="waveform" style={{ height }}>
      {Array.from({ length: bars }).map((_, i) => {
        const base = Math.sin((i / bars) * Math.PI);
        const n = Math.sin(i * 12.9 + seed * 0.9) * 0.5 + 0.5;
        const hgt = Math.max(0.08, base * (0.35 + n * amp)) * height;
        return (
          <span
            key={i}
            style={{
              height: hgt,
              background: col,
              boxShadow: `0 0 8px ${col}`,
              opacity: 0.55 + 0.45 * base,
            }}
          />
        );
      })}
    </div>
  );
}

/* ───────────────────────── Boot sequence overlay ─────────────────────────── */
// Copy now describes what the app is actually doing on launch. The old lines
// ("CALIBRATING ARC REACTOR … 100%", "MOUNTING NEURAL INTERFACE") were pure
// costume: nothing was being calibrated, and a paying user who reads them learns
// that the status text can't be trusted — which is a bad first thing to teach
// about an assistant whose whole job is reporting what it did. Same house style,
// same cadence, but every line names a real subsystem.
const BOOT_LINES = [
  "INITIALISING CORE",
  "LOADING VOICE ENGINE",
  "READING DEVICE SENSORS",
  "RESTORING MEMORY",
  "LINKING ASSISTANT",
  "READY",
];
// Total run was 6x360ms + 650ms ≈ 2.8s of blocking animation on EVERY launch.
// A splash the user cannot skip is the thing that shows up in one-star reviews,
// so: quicker, and tappable to cut straight through.
const BOOT_STEP_MS = 190;
const BOOT_HOLD_MS = 320;
export function BootSequence({ onDone, name = "REACTOR CORE" }) {
  const [line, setLine] = useState(0);
  const [gone, setGone] = useState(false);
  const finish = () => {
    setGone(true);
    onDone?.();
  };
  useEffect(() => {
    if (line >= BOOT_LINES.length) {
      const t = setTimeout(() => {
        setGone(true);
        onDone?.();
      }, BOOT_HOLD_MS);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setLine((l) => l + 1), BOOT_STEP_MS);
    return () => clearTimeout(t);
  }, [line, onDone]);
  if (gone) return null;
  return (
    <div
      className={`boot ${line >= BOOT_LINES.length ? "boot--out" : ""}`}
      onClick={finish}
      role="button"
      tabIndex={0}
      aria-label="Skip startup animation"
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") finish();
      }}
    >
      <div className="boot-ring" />
      <div className="boot-name">{name}</div>
      <div className="boot-log">
        {BOOT_LINES.slice(0, line).map((l, i) => (
          <div key={i} className="boot-line">
            {"› "}
            {l}
          </div>
        ))}
      </div>
      <div className="boot-bar">
        <span style={{ width: `${(line / BOOT_LINES.length) * 100}%` }} />
      </div>
      <div className="boot-skip">TAP TO SKIP</div>
    </div>
  );
}
