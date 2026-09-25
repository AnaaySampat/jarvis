/* HudGauges.jsx — reusable HUD instruments.
   Ported from jarvis-hud/hud-gauges.jsx (window-globals → ES modules).
   Exports: RadialGauge, MiniRadial, Sparkline, TickStrip, CornerBox,
            DataRow, SegBar  */

import { useState as _useState, useEffect as _useEffect, useRef as _useRef } from "react";

/* Animated number that eases toward `value` */
function useEased(value, ms = 700) {
  // Sanitise: a missing/NaN telemetry value would otherwise propagate through the
  // easing math (start + (NaN - start)*e) and render "NaN" / break the SVG arc.
  const target = Number.isFinite(value) ? value : 0;
  const [v, setV] = _useState(target);
  const from = _useRef(target);
  const t0 = _useRef(0);
  const raf = _useRef(0);
  _useEffect(() => {
    const start = v;
    from.current = start;
    t0.current = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0.current) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      setV(start + (target - start) * e);
      if (p < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [target]);
  return v;
}

/* ── Big radial gauge with sweeping arc + center value ── */
export function RadialGauge({ value = 0, label = "", unit = "%", size = 122, stroke = 9, sub }) {
  const v = useEased(value);
  const r = (size - stroke) / 2 - 6;
  const c = 2 * Math.PI * r;
  const start = 0.62; // fraction of circle used as the open gauge (gap at bottom)
  const arcLen = c * start;
  const dash = (Math.max(0, Math.min(100, v)) / 100) * arcLen; // clamp: a >100 spike must not over-draw the arc
  return (
    <div className="rg" style={{ width: size }}>
      <div className="rg-ring" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
          <g transform={`rotate(126 ${size / 2} ${size / 2})`}>
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke="rgba(255,255,255,0.06)"
              strokeWidth={stroke}
              strokeDasharray={`${arcLen} ${c}`}
              strokeLinecap="round"
            />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke="var(--ac)"
              strokeWidth={stroke}
              strokeDasharray={`${dash} ${c}`}
              strokeLinecap="round"
              style={{ filter: "drop-shadow(0 0 7px var(--ac))" }}
            />
          </g>
          {/* tick marks */}
          <g>
            {Array.from({ length: 11 }).map((_, i) => {
              const a = ((126 + (i / 10) * 0.62 * 360) * Math.PI) / 180;
              const r1 = r + stroke / 2 + 3,
                r2 = r1 + 4;
              const cx = size / 2,
                cy = size / 2;
              return (
                <line
                  key={i}
                  x1={cx + Math.cos(a) * r1}
                  y1={cy + Math.sin(a) * r1}
                  x2={cx + Math.cos(a) * r2}
                  y2={cy + Math.sin(a) * r2}
                  stroke="var(--ac)"
                  strokeWidth="3"
                  opacity="0.35"
                />
              );
            })}
          </g>
        </svg>
        <div className="rg-center">
          <div className="rg-val">
            {Math.round(v)}
            <span className="rg-unit">{unit}</span>
          </div>
          {sub && <div className="rg-sub">{sub}</div>}
        </div>
      </div>
      {label && <div className="rg-label rg-label--below">{label}</div>}
    </div>
  );
}

/* ── Compact ring gauge (no center text emphasis) ── */
export function MiniRadial({ value = 0, label = "", size = 66, stroke = 7, sub }) {
  const v = useEased(value);
  const r = (size - stroke) / 2 - 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="mr" style={{ width: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.07)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--ac)"
          strokeWidth={stroke}
          strokeDasharray={`${(Math.max(0, Math.min(100, v)) / 100) * c} ${c}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ filter: "drop-shadow(0 0 6px var(--ac))" }}
        />
      </svg>
      <div className="mr-val">{Math.round(v)}</div>
      {sub && <div className="mr-sub">{sub}</div>}
      <div className="mr-label">{label}</div>
    </div>
  );
}

/* ── Segmented bar (LED style) ── */
export function SegBar({ value = 0, segs = 22, label = "" }) {
  const safe = Number.isFinite(value) ? value : 0;
  const lit = Math.max(0, Math.min(segs, Math.round((safe / 100) * segs)));
  return (
    <div className="sb">
      {label && <div className="sb-label">{label}</div>}
      <div className="sb-row">
        {Array.from({ length: segs }).map((_, i) => (
          <span key={i} className={`sb-seg ${i < lit ? "on" : ""} ${i >= segs - 3 ? "hot" : ""}`} />
        ))}
      </div>
    </div>
  );
}

/* ── Sparkline — plots a real history series (auto-scaled so small-but-real
   activity stays visible). Falls back to a gentle idle wave if no data given. ── */
export function Sparkline({ points = 42, height = 40, data: ext }) {
  const raw = ext && ext.length ? ext : Array.from({ length: points }, () => 0);
  const series = raw.map((p) => (Number.isFinite(p) ? p : 0)); // a single NaN would poison max + every coord
  const n = series.length;
  const max = Math.max(1, ...series); // auto-scale; floor avoids /0 + flatlines
  const w = 102;
  const path = series
    .map((p, i) => `${(i / Math.max(1, n - 1)) * w},${height - (Math.max(0, p) / max) * height}`)
    .join(" ");
  const area = `0,${height} ${path} ${w},${height}`;
  return (
    <svg
      className="spark"
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      width="100%"
      height={height}
    >
      <polygon points={area} fill="var(--ac)" opacity="0.10" />
      <polyline
        points={path}
        fill="none"
        stroke="var(--ac)"
        strokeWidth="3.4"
        vectorEffect="non-scaling-stroke"
        style={{ filter: "drop-shadow(0 0 5px var(--ac))" }}
      />
    </svg>
  );
}

/* ── Tick strip (decorative measure scale) ── */
export function TickStrip({ count = 42 }) {
  return (
    <div className="ts">
      {Array.from({ length: count }).map((_, i) => (
        <span key={i} className={`ts-t ${i % 5 === 0 ? "lg" : ""}`} />
      ))}
    </div>
  );
}

/* ── Key/value data row ── */
export function DataRow({ k, v, accent = false }) {
  return (
    <div className="dr">
      <span className="dr-k">{k}</span>
      <span className="dr-dots" />
      <span className={`dr-v ${accent ? "dr-v--ac" : ""}`}>{v}</span>
    </div>
  );
}

/* ── HUD panel frame with bracket corners + title ──
   When `collapsible`, the header becomes a toggle (chevron) and the body hides
   while collapsed. `open`/`onToggle` make it controllable (so JARVIS can drive
   it by voice); if `onToggle` is omitted it self-manages an internal state. ── */
export function CornerBox({
  title,
  code,
  children,
  className = "",
  slot,
  glow = false,
  collapsible = false,
  open: openProp,
  onToggle,
  action, // an extra header control beside the collapse toggle (can't nest in its <button>)
}) {
  const [openState, setOpenState] = _useState(true);
  const open = openProp === undefined ? openState : openProp;
  const toggle = () => (onToggle ? onToggle(!open) : setOpenState((o) => !o));
  return (
    <section
      className={`cbox ${glow ? "cbox--glow" : ""} ${collapsible ? "cbox--collapsible" : ""} ${open ? "" : "cbox--collapsed"} ${className}`}
      data-slot={slot}
    >
      <span className="cbox-c tl" />
      <span className="cbox-c tr" />
      <span className="cbox-c bl" />
      <span className="cbox-c br" />
      {(title || code) &&
        (collapsible ? (
          <div className="cbox-hd-row">
            <button
              className="cbox-hd cbox-hd--btn"
              onClick={toggle}
              aria-expanded={open}
              title={open ? "Collapse" : "Expand"}
            >
              <span className="cbox-title">{title}</span>
              <span className="cbox-hd-right">
                {code && <span className="cbox-code">{code}</span>}
                <span className={`cbox-chev ${open ? "" : "cbox-chev--closed"}`}>▾</span>
              </span>
            </button>
            {action}
          </div>
        ) : (
          <header className="cbox-hd">
            <span className="cbox-title">{title}</span>
            {code && <span className="cbox-code">{code}</span>}
          </header>
        ))}
      {open && <div className="cbox-body">{children}</div>}
    </section>
  );
}
