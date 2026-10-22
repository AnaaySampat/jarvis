/* widgets.jsx — the home screen's cards, in the desktop's card shell (its
   hud/widgets.jsx): each one collapses to a one-line summary in its header, and
   JARVIS can expand/collapse them by voice too (App owns the open state). The phone
   fills them with what a phone can read: Device instead of System (Android hides
   CPU load), Battery instead of Power, network estimates, plus the phone's own
   Status and Routines cards. Customize ▸ Gauges swaps bars for rings. */

import { useState, useEffect, useRef, useId } from "react";
import { IS_MOBILE } from "../hooks/useAssistant";
import Icon from "../components/Icon";
import { listRoutines, parseDays, routineWhen, saveRoutine } from "../brain/schedule/routines";
import { localISODate } from "../brain/schedule/store";

// Coerce a telemetry field to a finite number (→0): a partial frame missing a
// field must not render "NaN" or crash a card.
const n0 = (x) => (Number.isFinite(x) ? x : Number.isFinite(+x) ? +x : 0);
const pct = (x) => `${Math.round(n0(x))}%`;
const gb = (x) => {
  const v = n0(x);
  return v >= 10 ? Math.round(v) : Math.round(v * 10) / 10;
};

/* Rolling history of a live value, for the sparklines. `value` is null until the
   first telemetry frame; that first reading fills the line, so it starts level
   instead of climbing from a made-up zero. Adjusted during render (React's pattern
   for state derived from a changing prop), not in an effect. */
function useHistory(value, points = 40) {
  const [hist, setHist] = useState(null);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (value != null) {
      const v = Number.isFinite(value) ? value : 0;
      setHist((h) => (h ? [...h.slice(1), v] : Array(points).fill(v)));
    }
  }
  return hist || Array(points).fill(0);
}

/* ───────── building blocks ───────── */
export function Widget({ id, icon, title, meta, summary, open, onToggle, action, children }) {
  return (
    <section className={`wd${open ? "" : " wd--closed"}`} data-panel={id}>
      <button
        type="button"
        className="wd-hd"
        onClick={() => onToggle && onToggle(!open)}
        aria-expanded={open}
      >
        <span className="wd-ico">
          <Icon name={icon} size={15} />
        </span>
        <span className="wd-title">{title}</span>
        <span className="wd-meta">{open ? meta : summary}</span>
        <Icon name="chevDown" size={14} className="wd-chev" />
      </button>
      {open && (
        <div className="wd-body">
          {children}
          {action}
        </div>
      )}
    </section>
  );
}

function Bar({ value, tone }) {
  const v = Math.max(0, Math.min(100, n0(value)));
  return (
    <div className="bar" role="presentation">
      <span className={tone ? `bar--${tone}` : ""} style={{ width: `${v}%` }} />
    </div>
  );
}

const loadTone = (v) => (n0(v) >= 90 ? "err" : n0(v) >= 75 ? "warn" : "");

/* A sparkline of a real series, auto-scaled so small-but-real activity shows. */
function Spark({ data, height = 34 }) {
  const id = useId();
  const series = data.map((p) => (Number.isFinite(p) ? Math.max(0, p) : 0));
  const max = Math.max(1, ...series);
  const w = 100;
  const pts = series.map(
    (p, i) =>
      `${(i / Math.max(1, series.length - 1)) * w},${height - (p / max) * (height - 2) - 1}`,
  );
  return (
    <svg
      className="spark2"
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      height={height}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--ac)" stopOpacity="0.28" />
          <stop offset="1" stopColor="var(--ac)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${height} ${pts.join(" ")} ${w},${height}`} fill={`url(#${id})`} />
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke="var(--ac)"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* Gauges ▸ Rings: a 270° ring gauge with tick marks and the value in the middle. */
function Ring({ value, label, sub, size = 104, stroke = 7 }) {
  const v = Math.max(0, Math.min(100, n0(value)));
  const r = size / 2 - stroke - 5,
    c = 2 * Math.PI * r,
    arc = c * 0.75,
    mid = size / 2;
  return (
    <div className="ring" style={{ width: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
        <g transform={`rotate(135 ${mid} ${mid})`}>
          <circle
            cx={mid}
            cy={mid}
            r={r}
            className="ring-track"
            strokeWidth={stroke}
            strokeDasharray={`${arc} ${c}`}
          />
          <circle
            cx={mid}
            cy={mid}
            r={r}
            className="ring-fill"
            strokeWidth={stroke}
            strokeDasharray={`${(v / 100) * arc} ${c}`}
          />
        </g>
        {Array.from({ length: 11 }).map((_, i) => {
          const a = ((135 + i * 27) * Math.PI) / 180,
            r1 = r + stroke / 2 + 2,
            r2 = r1 + (i % 5 ? 3 : 5);
          return (
            <line
              key={i}
              className="ring-tick"
              x1={mid + Math.cos(a) * r1}
              y1={mid + Math.sin(a) * r1}
              x2={mid + Math.cos(a) * r2}
              y2={mid + Math.sin(a) * r2}
            />
          );
        })}
      </svg>
      <div className="ring-c">
        <b>
          {Math.round(v)}
          <small>%</small>
        </b>
        {sub && <span>{sub}</span>}
      </div>
      {label && <div className="ring-l">{label}</div>}
    </div>
  );
}

/* Gauges ▸ Rings: an LED segment strip for the battery. */
function Leds({ value, segs = 20 }) {
  const lit = Math.round((Math.max(0, Math.min(100, n0(value))) / 100) * segs);
  return (
    <div className="leds" aria-hidden="true">
      {Array.from({ length: segs }).map((_, i) => (
        <span key={i} className={i < lit ? "on" : ""} />
      ))}
    </div>
  );
}

function Stat({ label, value, sub, bar, tone }) {
  return (
    <div className="stat">
      <div className="stat-l">{label}</div>
      <div className="stat-v">{value}</div>
      {bar != null && <Bar value={bar} tone={tone} />}
      {sub && <div className="stat-s">{sub}</div>}
    </div>
  );
}

function KV({ k, v, mono, tone }) {
  return (
    <div className="kv2-row">
      <span>{k}</span>
      <span
        className={`${mono ? "kv2-mono" : ""}${tone ? ` kv2--${tone}` : ""}`}
        title={typeof v === "string" ? v : undefined}
      >
        {v}
      </span>
    </div>
  );
}

/* ───────── System (desktop) / Device (phone) ───────── */
export function SystemWidget({ d, live, open, onToggle, rings }) {
  const cpuHist = useHistory(live && !IS_MOBILE ? n0(d.cpu) : null);
  const total = n0(d.ramTotalGb);
  const used = (n0(d.ram) / 100) * total;
  if (IS_MOBILE) {
    // Battery has its own card; CPU isn't readable by apps since Android 8.
    const known = d.diskTotalGb > 0;
    const free = gb(n0(d.diskTotalGb) - n0(d.diskUsedGb));
    return (
      <Widget
        id="system"
        icon="phone"
        title="Device"
        open={open}
        onToggle={onToggle}
        meta={known ? `${free} GB free` : null}
        summary={known ? `Memory ${pct(d.ram)} · Storage ${pct(d.disk)}` : "No readings yet"}
      >
        {!known ? (
          <div className="wd-empty">Memory and storage come from the phone itself.</div>
        ) : rings ? (
          <div className="rings">
            <Ring value={d.ram} label="Memory" sub={`${gb(used)} GB`} />
            <Ring value={d.disk} label="Storage" sub={`${free} GB free`} />
          </div>
        ) : (
          <div className="stat-pair">
            <Stat
              label="Memory"
              value={pct(d.ram)}
              bar={d.ram}
              tone={loadTone(d.ram)}
              sub={`${gb(used)} of ${gb(total)} GB`}
            />
            <Stat
              label="Storage"
              value={pct(d.disk)}
              bar={d.disk}
              tone={loadTone(d.disk)}
              sub={`${gb(d.diskUsedGb)} of ${gb(d.diskTotalGb)} GB`}
            />
          </div>
        )}
      </Widget>
    );
  }
  return (
    <Widget
      id="system"
      icon="cpu"
      title="System"
      open={open}
      onToggle={onToggle}
      meta={d.temp != null ? `${Math.round(n0(d.temp))}°C` : null}
      summary={`CPU ${pct(d.cpu)} · RAM ${pct(d.ram)}`}
    >
      {rings ? (
        <>
          <div className="rings">
            <Ring
              value={d.cpu}
              label="CPU"
              sub={d.temp != null ? `${Math.round(n0(d.temp))}°C` : null}
            />
            <Ring value={d.ram} label="Memory" sub={total ? `${Math.round(total)} GB` : null} />
          </div>
          <div className="rings rings--mini">
            <Ring value={d.gpu} label="GPU" size={70} stroke={5} />
            <Ring value={d.diskActivity} label="Disk I/O" size={70} stroke={5} />
            <Ring value={d.disk} label="Storage" size={70} stroke={5} />
          </div>
        </>
      ) : (
        <>
          <div className="stat-pair">
            <Stat
              label="CPU"
              value={pct(d.cpu)}
              bar={d.cpu}
              tone={loadTone(d.cpu)}
              sub={d.temp != null ? `${Math.round(n0(d.temp))}°C` : "Processor load"}
            />
            <Stat
              label="Memory"
              value={pct(d.ram)}
              bar={d.ram}
              tone={loadTone(d.ram)}
              sub={total ? `${used.toFixed(1)} of ${Math.round(total)} GB` : "In use"}
            />
          </div>
          <Spark data={cpuHist} />
          <div className="mini3">
            <div title={d.gpuName || "Graphics"}>
              <span>GPU</span>
              <b>{d.gpu != null ? pct(d.gpu) : "—"}</b>
            </div>
            <div title="How busy the disk is">
              <span>Disk I/O</span>
              <b>{pct(d.diskActivity)}</b>
            </div>
            <div>
              <span>Storage</span>
              <b>{pct(d.disk)}</b>
            </div>
          </div>
        </>
      )}
    </Widget>
  );
}

/* ───────── Power (desktop) / Battery (phone) ───────── */
export function PowerWidget({ d, open, onToggle, rings }) {
  const level = d.batteryPct;
  const has = level != null;
  const state = !has
    ? IS_MOBILE
      ? "No reading"
      : "Plugged in"
    : d.charging
      ? "Charging"
      : "On battery";
  const sub = !has
    ? IS_MOBILE
      ? "The level shows here once the phone reports it."
      : "No battery detected"
    : d.charging
      ? "Connected to power"
      : d.remaining && d.remaining !== "On AC"
        ? /\bleft\b/.test(d.remaining) // the phone's telemetry already says it
          ? d.remaining
          : `${d.remaining} left`
        : IS_MOBILE
          ? "Not charging"
          : "Estimating time left…";
  const tone = has && !d.charging ? (level < 15 ? "err" : level < 30 ? "warn" : "") : "";
  const hot = IS_MOBILE && d.temp != null && d.temp >= 45;
  return (
    <Widget
      id="power"
      icon={d.charging || !has ? "charging" : "battery"}
      title={IS_MOBILE ? "Battery" : "Power"}
      open={open}
      onToggle={onToggle}
      meta={state}
      summary={has ? `${Math.round(level)}% · ${state.toLowerCase()}` : state}
    >
      <div className="pwr2">
        {rings && has ? (
          <Ring value={level} size={88} stroke={6} />
        ) : (
          <span className="pwr2-v">{has ? `${Math.round(level)}%` : IS_MOBILE ? "—" : "AC"}</span>
        )}
        <span className="pwr2-txt">
          <b>{state}</b>
          <span>{sub}</span>
        </span>
      </div>
      {has && (rings ? <Leds value={level} /> : <Bar value={level} tone={tone} />)}
      {IS_MOBILE && d.temp != null && (
        <div className="kv2">
          <KV
            k="Temperature"
            v={`${Math.round(d.temp)} °C${hot ? ", hot" : ""}`}
            tone={hot ? "warn" : undefined}
          />
        </div>
      )}
    </Widget>
  );
}

/* ───────── Agenda (editable) ───────── */
// Add / edit an agenda item in place.
function AgendaForm({ initial, onSave, onCancel }) {
  const [task, setTask] = useState(initial?.task || "");
  const [time, setTime] = useState(
    /^\d{1,2}:\d{2}$/.test(initial?.time || "") ? initial.time.padStart(5, "0") : "",
  );
  const submit = (e) => {
    e.preventDefault();
    if (task.trim()) onSave({ task: task.trim(), time });
  };
  return (
    <form
      className="ag-form"
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
    >
      <input
        type="time"
        className="ag-form-time"
        value={time}
        onChange={(e) => setTime(e.target.value)}
        aria-label="Time (optional)"
      />
      <input
        className="ag-form-task"
        value={task}
        onChange={(e) => setTask(e.target.value)}
        autoFocus
        placeholder={initial ? "Task" : "What is it?"}
        aria-label="Task"
        maxLength={120}
      />
      <button
        type="submit"
        className="ag-btn ag-btn--ok"
        disabled={!task.trim()}
        aria-label={initial ? "Save" : "Add"}
      >
        <Icon name="check" size={15} strokeWidth={2} />
      </button>
      <button type="button" className="ag-btn" onClick={onCancel} aria-label="Cancel">
        <Icon name="close" size={14} strokeWidth={2} />
      </button>
    </form>
  );
}

export function AgendaWidget({ items, open, onToggle, runAction }) {
  const list = items || [];
  const editable = typeof runAction === "function";
  const [editing, setEditing] = useState(null); // null | "new" | index of the row being edited
  const next = list.find((it) => it.now) || list.find((it) => !it.done);

  const addItem = ({ task, time }) => {
    runAction({ type: "schedule", do: "add", day: "today", time, task });
    setEditing(null);
  };
  const editItem = (it, { task, time }) => {
    runAction({
      type: "schedule",
      do: "edit",
      day: "today",
      match: it.task,
      new_task: task || it.task,
      new_time: time || it.time,
    });
    setEditing(null);
  };
  const removeItem = (it) =>
    runAction({ type: "schedule", do: "remove", day: "today", match: it.task });

  return (
    <Widget
      id="agenda"
      icon="calendar"
      title="Agenda"
      open={open}
      onToggle={onToggle}
      meta={list.length ? `${list.length} item${list.length === 1 ? "" : "s"}` : null}
      summary={next ? `${next.time ? `${next.time} · ` : ""}${next.task}` : "Nothing scheduled"}
      action={
        editable &&
        editing !== "new" && (
          <button className="wd-add" onClick={() => setEditing("new")}>
            <Icon name="plus" size={14} />
            Add to today
          </button>
        )
      }
    >
      <div className="ag">
        {list.length === 0 && editing !== "new" && (
          <div className="wd-empty">
            Nothing scheduled today. Ask JARVIS to remind you and it shows up here.
          </div>
        )}
        {list.map((it, i) =>
          editing === i ? (
            <AgendaForm
              key={i}
              initial={it}
              onSave={(v) => editItem(it, v)}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <div key={i} className={`ag-row${it.now ? " is-now" : ""}${it.done ? " is-done" : ""}`}>
              <span className="ag-t">{it.time || "—"}</span>
              <span className="ag-dot" aria-hidden />
              <span className="ag-task">
                {it.task}
                {it.now && <span className="ag-now">Now</span>}
              </span>
              {it.duration && <span className="ag-dur">{it.duration}</span>}
              {editable && (
                <span className="ag-edit">
                  <button aria-label={`Edit ${it.task}`} onClick={() => setEditing(i)}>
                    <Icon name="edit" size={13} />
                  </button>
                  <button aria-label={`Remove ${it.task}`} onClick={() => removeItem(it)}>
                    <Icon name="trash" size={13} />
                  </button>
                </span>
              )}
            </div>
          ),
        )}
        {editing === "new" && <AgendaForm onSave={addItem} onCancel={() => setEditing(null)} />}
      </div>
    </Widget>
  );
}

/* ───────── Weather ───────── */
// Condition glyphs (the desktop's weather.py, and the phone brain's WMO emoji) → icons.
const WX_GLYPH = {
  "○": "sun",
  "◔": "cloudSun",
  "◑": "cloudSun",
  "☁": "cloud",
  "▒": "fog",
  "˙": "drizzle",
  "☂": "rain",
  "❄": "snow",
  "⚡": "storm",
  "☀": "sun",
  "☀️": "sun",
  "⛅": "cloudSun",
  "🌤": "cloudSun",
  "🌥": "cloud",
  "🌧": "rain",
  "🌦": "rain",
  "⛈": "storm",
  "🌩": "storm",
  "🌨": "snow",
  "🌫": "fog",
};
/** The icon for a glyph (or, failing that, the condition's words); clear and partly
 *  cloudy turn to night after dark when the hour ("HH:MM") is known. */
function wxIcon(glyph, condition = "", hhmm = "") {
  const c = condition.toLowerCase();
  let name = WX_GLYPH[glyph];
  if (!name) {
    if (/thunder/.test(c)) name = "storm";
    else if (/snow/.test(c)) name = "snow";
    else if (/rain|shower/.test(c)) name = "rain";
    else if (/drizzle/.test(c)) name = "drizzle";
    else if (/fog/.test(c)) name = "fog";
    else if (/partly|mainly/.test(c)) name = "cloudSun";
    else if (/cloud|overcast/.test(c)) name = "cloud";
    else name = "sun";
  }
  const h = Number(String(hhmm).slice(0, 2));
  const night = /^\d{2}:/.test(String(hhmm)) && (h < 6 || h >= 19);
  if (night && name === "sun") return "moon";
  if (night && name === "cloudSun") return "cloud";
  return name;
}
const aqiTone = (a) =>
  a <= 50 ? "Good" : a <= 100 ? "Moderate" : a <= 150 ? "Unhealthy for some" : "Unhealthy";
const sentence = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : "");

export function WeatherWidget({ weather, open, onToggle }) {
  const w = weather || {};
  const has = w.temp != null;
  const temp = has ? `${Math.round(n0(w.temp))}°` : "—";
  const hours = (w.hours || []).slice(0, 6);
  // "Now" is the current observation everywhere on the card, not the hourly
  // forecast for this hour, which can disagree.
  const icon = wxIcon(w.icon || hours[0]?.i, w.condition || "", hours[0]?.t);
  const hourLabel = (h, i) =>
    i === 0 || h.t === "NOW" ? "Now" : /^\d+$/.test(String(h.t)) ? `${h.t}:00` : h.t;
  return (
    <Widget
      id="weather"
      icon={icon}
      title="Weather"
      open={open}
      onToggle={onToggle}
      meta={w.location && w.location !== "—" ? w.location.split(",")[0] : null}
      summary={has ? `${temp} ${sentence(w.condition)}` : "Locating…"}
    >
      {!has ? (
        <div className="wd-empty">
          {IS_MOBILE
            ? "Finding your location. If no forecast appears, set one in Settings ▸ Files & Location."
            : "Finding your location…"}
        </div>
      ) : (
        <>
          <div className="wx2">
            <Icon name={icon} size={38} strokeWidth={1.3} className="wx2-ico" />
            <span className="wx2-temp">{temp}</span>
            <span className="wx2-txt">
              <b>{sentence(w.condition) || "—"}</b>
              <span title={w.location}>{w.location || "—"}</span>
            </span>
          </div>
          <div className="wx2-facts">
            <span>
              <Icon name="droplet" size={14} />
              {w.humidity != null ? `${Math.round(n0(w.humidity))}%` : "—"}
            </span>
            <span>
              <Icon name="wind" size={14} />
              {w.wind || "—"}
            </span>
            {w.aqi != null && (
              <span title={`Air quality: ${aqiTone(n0(w.aqi))}`}>
                <Icon name="leaf" size={14} />
                AQI {w.aqi}
              </span>
            )}
          </div>
          {hours.length > 0 && (
            <div className="wx2-hours">
              {hours.map((h, i) => {
                const c = i === 0 && has ? w.temp : h.c;
                return (
                  <div key={i} className="wx2-h">
                    <span>{hourLabel(h, i)}</span>
                    <Icon
                      name={wxIcon(i === 0 && w.icon ? w.icon : h.i, "", h.t)}
                      size={17}
                      strokeWidth={1.4}
                    />
                    <b>{c != null ? `${Math.round(n0(c))}°` : "—"}</b>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </Widget>
  );
}

/* ───────── Network ───────── */
// 1 decimal under 10 Mbps so idle traffic is still visible; whole numbers once busy.
const mbps = (v) => (v == null ? "0.0" : v < 10 ? n0(v).toFixed(1) : n0(v).toFixed(0));

// deviceTelemetry's link labels, in words.
function linkName(label) {
  if (label === "WIFI") return "Wi-Fi";
  if (/^[2-5]G$/.test(label || "")) return `Mobile data, ${label}`;
  if (label === "OFFLINE") return "Offline";
  return "Connected";
}

export function NetworkWidget({ d, live, netInfo, open, onToggle }) {
  const n = netInfo || {};
  const downHist = useHistory(live && !IS_MOBILE ? n0(d.down) : null);
  if (IS_MOBILE) {
    // The WebView only estimates speed and latency (Chromium caps the speed estimate
    // at 10 Mbps) and can't see upload at all, so the card says "about" and shows no
    // live graph or upload figure it doesn't have.
    const link = linkName(d.linkLabel);
    return (
      <Widget
        id="network"
        icon="wifi"
        title="Network"
        open={open}
        onToggle={onToggle}
        meta={d.ping > 0 ? `about ${d.ping} ms` : null}
        summary={link}
      >
        <div className="kv2">
          <KV k="Connection" v={link} tone={d.linkLabel === "OFFLINE" ? "warn" : undefined} />
          {d.down > 0 && (
            <KV k="Speed, estimated" v={d.down >= 10 ? "10+ Mbps" : `about ${mbps(d.down)} Mbps`} />
          )}
          {d.ping > 0 && <KV k="Latency, estimated" v={`about ${d.ping} ms`} />}
          <KV k="Public IP" v={n.publicIp || "—"} mono />
          <KV k="Located near" v={n.location || "—"} />
        </div>
      </Widget>
    );
  }
  return (
    <Widget
      id="network"
      icon="wifi"
      title="Network"
      open={open}
      onToggle={onToggle}
      meta={d.ping ? `${d.ping} ms` : null}
      summary={`↓ ${mbps(d.down)} · ↑ ${mbps(d.up)} Mbps`}
    >
      <div className="net2">
        <div>
          <Icon name="arrowDown" size={15} />
          <b>{mbps(d.down)}</b>
          <span>Mbps down</span>
        </div>
        <div>
          <Icon name="arrowUp" size={15} />
          <b>{mbps(d.up)}</b>
          <span>Mbps up</span>
        </div>
      </div>
      <Spark data={downHist} />
      <div className="kv2">
        <KV k="Ping" v={d.ping ? `${d.ping} ms` : "—"} />
        <KV k="Local IP" v={n.localIp || "—"} mono />
        <KV k="Public IP" v={n.publicIp || "—"} mono />
        <KV k="Location" v={n.location || "—"} />
      </div>
    </Widget>
  );
}

/* ───────── Action log ───────── */
/** Two taps to clear: the first arms it, the second (within a few seconds) clears. */
function ClearLogButton({ onClear }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      className={`wd-add${armed ? " is-armed" : ""}`}
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        onClear();
      }}
      onBlur={() => setArmed(false)}
    >
      <Icon name="trash" size={14} />
      {armed ? "Tap again to clear the log" : "Clear the log"}
    </button>
  );
}

export function LogWidget({ commands = [], onClear, open, onToggle }) {
  const bodyRef = useRef(null);
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [commands, open]);
  const fmtTime = (ts) => {
    try {
      return new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  };
  const last = commands[commands.length - 1];
  return (
    <Widget
      id="terminal"
      icon="terminal"
      title={IS_MOBILE ? "Action log" : "Command log"}
      open={open}
      onToggle={onToggle}
      meta={commands.length ? `${commands.length}` : null}
      summary={
        !last
          ? "Nothing run yet"
          : last.ok === false
            ? `${last.type} failed`
            : last.message || last.type
      }
      action={onClear && commands.length > 0 && <ClearLogButton onClear={onClear} />}
    >
      <div className="log" ref={bodyRef}>
        {commands.length === 0 && (
          <div className="wd-empty">Every action JARVIS takes for you shows up here.</div>
        )}
        {commands.slice(-40).map((c, i) => (
          <div key={i} className={`log-row${c.ok === false ? " is-err" : ""}`}>
            <span className="log-ico">
              <Icon name={c.ok === false ? "close" : "check"} size={12} strokeWidth={2} />
            </span>
            <span className="log-txt">
              <code>
                {c.type}
                {c.target ? ` ${c.target}` : ""}
              </code>
              {c.message && <span>{c.message}</span>}
            </span>
            <span className="log-t">{fmtTime(c.ts)}</span>
          </div>
        ))}
      </div>
    </Widget>
  );
}

/* ───────── Status (phone): what JARVIS can do right now ─────────
   Every request depends on one of these. A row that's off says so here, before a
   request fails on it, and tapping it goes to where it's fixed. */
// A PC that's switched off isn't something to fix from the phone, so only a
// rejected pairing reads as a warning.
const PC_READOUT = {
  idle: ["Not paired", "off"],
  connecting: ["Connecting…", "off"],
  online: ["Online", "on"],
  offline: ["Offline", "off"],
  unauthorized: ["Pairing rejected", "warn"],
};

export function ReadinessWidget({
  sysInfo = {},
  appControlOn,
  pcConfig,
  pcState,
  tvConfig,
  onOpenSettings,
  onOpenRemote,
  onOpenAppControl,
}) {
  // Not in App's panel map, so it keeps its own open state.
  const [open, setOpen] = useState(true);
  const wake = sysInfo.wake_word !== false;
  const ranked = sysInfo.routing?.models?.length ?? 0;
  const pinned = sysInfo.model_override !== "auto" && sysInfo.model_override;
  const [pcText, pcTone] = pcConfig ? PC_READOUT[pcState] || PC_READOUT.offline : PC_READOUT.idle;
  const rows = [
    {
      icon: "mic",
      label: "Voice",
      value: wake ? "Wake word on" : "Mic button only",
      tone: wake ? "on" : "off",
      onClick: () => onOpenSettings("voice"),
    },
    {
      icon: "hand",
      label: "App control",
      value: appControlOn == null ? "Checking…" : appControlOn ? "On" : "Off, tap to allow",
      tone: appControlOn ? "on" : appControlOn === false ? "warn" : "off",
      onClick: onOpenAppControl,
    },
    {
      icon: "spark",
      label: "Model",
      value: pinned || (ranked ? `Auto · ${ranked} models` : "Auto"),
      tone: "on",
      onClick: () => onOpenSettings("models"),
    },
    { icon: "monitor", label: "PC", value: pcText, tone: pcTone, onClick: onOpenRemote },
    {
      icon: "tv",
      label: "TV",
      value: tvConfig ? tvConfig.model || "Set up" : "Not set up",
      tone: tvConfig ? "on" : "off",
      onClick: onOpenRemote,
    },
  ];
  const toFix = rows.filter((r) => r.tone === "warn").length;
  return (
    <Widget
      id="readiness"
      icon="shield"
      title="Status"
      open={open}
      onToggle={setOpen}
      meta={toFix ? `${toFix} to check` : "Ready"}
      summary={toFix ? `${toFix} to check` : "Ready"}
    >
      <div className="rdy2">
        {rows.map((r) => (
          <button key={r.label} type="button" className="rdy2-row" onClick={r.onClick}>
            <Icon name={r.icon} size={16} className="rdy2-ico" />
            <span className="rdy2-l">{r.label}</span>
            <span className={`rdy2-v rdy2-v--${r.tone}`}>{r.value}</span>
            <Icon name="chevRight" size={14} className="rdy2-chev" />
          </button>
        ))}
      </div>
    </Widget>
  );
}

/* ───────── Routines (phone): the saved ones, one tap to run ─────────
   Run goes the way a timed routine does: the routine's steps become an ordinary
   turn (routines.ts), so each step still reports its own real result. */
const DAY_MODES = [
  ["daily", "Every day"],
  ["weekdays", "Weekdays"],
  ["weekends", "Weekends"],
  ["custom", "Custom"],
];
const WEEK = [1, 2, 3, 4, 5, 6, 0]; // getDay() indexes, Monday first
const DAY_SPEC = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_NAME = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function Seg({ label, value, options, onPick }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map(([id, text, aria]) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id || (value instanceof Set && value.has(id))}
          aria-label={aria}
          className={`seg-btn${value === id || (value instanceof Set && value.has(id)) ? " is-on" : ""}`}
          onClick={() => onPick(id)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** Add/edit one routine, saved by routines.ts's own checks — when they refuse, their
 *  words show here instead of the form quietly doing nothing. */
function RoutineForm({ routine, onSaved, onCancel }) {
  const spec = (routine?.days || "daily").trim().toLowerCase();
  const savedSet = parseDays(spec) || new Set(WEEK);
  const savedMode =
    savedSet.size === 7 ? "daily" : spec === "weekdays" || spec === "weekends" ? spec : "custom";
  const [name, setName] = useState(routine?.name || "");
  const [steps, setSteps] = useState(routine?.prompt || "");
  const [time, setTime] = useState(routine?.time || "");
  const [home, setHome] = useState(routine?.trigger === "home");
  const [mode, setMode] = useState(savedMode);
  const [picked, setPicked] = useState(savedMode === "custom" ? savedSet : new Set());
  const [error, setError] = useState("");
  const edit = (set) => (v) => {
    setError("");
    set(v);
  };
  const pickMode = (m) => {
    // Custom starts from the days already chosen: Weekdays, then Custom, then untick Friday.
    if (m === "custom" && mode !== "custom") setPicked(parseDays(mode) || new Set());
    edit(setMode)(m);
  };
  const toggleDay = (i) =>
    edit(setPicked)((p) => {
      const next = new Set(p);
      if (!next.delete(i)) next.add(i);
      return next;
    });
  const days =
    mode === "custom"
      ? WEEK.filter((i) => picked.has(i))
          .map((i) => DAY_SPEC[i])
          .join(",")
      : mode;
  const ready = name.trim() && steps.trim() && !(time && mode === "custom" && !picked.size);
  const submit = (e) => {
    e.preventDefault();
    const res = saveRoutine(
      { name, prompt: steps, time: home ? "" : time, days, trigger: home ? "home" : undefined },
      routine?.name,
    );
    if (res.ok) onSaved(res.routine);
    else setError(res.summary);
  };

  return (
    <form className="rt-form" onSubmit={submit}>
      <input
        className="rt-in"
        value={name}
        onChange={(e) => edit(setName)(e.target.value)}
        placeholder="Name, like bedtime"
        aria-label="Routine name"
        maxLength={60}
        autoFocus={!routine}
      />
      <textarea
        className="rt-in"
        value={steps}
        onChange={(e) => edit(setSteps)(e.target.value)}
        placeholder="What it does, in plain words: turn on Do Not Disturb and set an alarm for 7"
        aria-label="Steps"
        maxLength={600}
        rows={3}
      />
      <Seg
        label="When it runs"
        value={home ? "home" : "time"}
        options={[
          ["time", "At a time or when asked"],
          ["home", "When I get home"],
        ]}
        onPick={(v) => edit(setHome)(v === "home")}
      />
      {home ? (
        <p className="rt-note">
          When the phone joins your home Wi-Fi you get a notification; tap it and JARVIS runs this.
          Home is the Wi-Fi where your TV or PC answers.
        </p>
      ) : (
        <>
          <div className="rt-time">
            <input
              className="rt-in"
              type="time"
              value={time}
              onChange={(e) => edit(setTime)(e.target.value)}
              aria-label="Time (optional)"
            />
            {time && (
              <button type="button" className="rt-btn" onClick={() => edit(setTime)("")}>
                No time
              </button>
            )}
          </div>
          {!time ? (
            <p className="rt-note">No time: it runs only when you ask.</p>
          ) : (
            <>
              <Seg label="Days" value={mode} options={DAY_MODES} onPick={pickMode} />
              {mode === "custom" && (
                <Seg
                  label="Pick days"
                  value={picked}
                  options={WEEK.map((i) => [i, DAY_NAME[i].slice(0, 2), DAY_NAME[i]])}
                  onPick={toggleDay}
                />
              )}
            </>
          )}
        </>
      )}
      {error && (
        <p className="rt-err" role="alert">
          {error}
        </p>
      )}
      <div className="rt-go">
        <button type="button" className="rt-btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="rt-btn rt-btn--go" disabled={!ready}>
          {routine ? "Save" : "Add"}
        </button>
      </div>
    </form>
  );
}

export function RoutinesWidget({ status, runAction, onSend }) {
  // Not in App's panel map, so it keeps its own open state.
  const [open, setOpen] = useState(true);
  const [, refresh] = useState(0);
  const [openName, setOpenName] = useState(null); // the routine showing its steps
  const [armed, setArmed] = useState(null); // name awaiting Remove's confirming tap
  const [editing, setEditing] = useState(null); // null | true (a new one) | the name being edited
  // ponytail: re-read on every HUD render (a few hundred bytes from localStorage), so a
  // routine added or removed by voice shows without a subscription.
  const list = listRoutines();
  const today = localISODate(new Date());
  const busy = status === "thinking" || status === "working" || status === "speaking";

  const run = async (r) => {
    const res = await runAction({ type: "routine", do: "run", name: r.name });
    if (res?.ok) onSend(res.summary, `Run ${r.name}`);
    refresh((n) => n + 1);
  };
  const remove = async (r) => {
    if (armed !== r.name) return setArmed(r.name);
    setArmed(null);
    await runAction({ type: "routine", do: "remove", name: r.name });
    refresh((n) => n + 1);
  };
  const saved = (r) => {
    setEditing(null);
    setOpenName(r.name);
  };
  const cancel = () => setEditing(null);

  return (
    <Widget
      id="routines"
      icon="play"
      title="Routines"
      open={open}
      onToggle={setOpen}
      meta={list.length ? `${list.length} saved` : null}
      summary={list.length ? list.map((r) => r.name).join(" · ") : "None yet"}
      action={
        editing === null && (
          <button type="button" className="wd-add" onClick={() => setEditing(true)}>
            <Icon name="plus" size={14} />
            Add a routine
          </button>
        )
      }
    >
      {list.length === 0 && editing !== true ? (
        <div className="wd-empty">
          No routines yet. Add one below, or say “make a routine called bedtime that turns on Do Not
          Disturb every day at 10 pm”.
        </div>
      ) : (
        <div className="rt">
          {list.map((r) => {
            const expanded = openName === r.name;
            if (editing === r.name) {
              return <RoutineForm key={r.name} routine={r} onSaved={saved} onCancel={cancel} />;
            }
            return (
              <div key={r.name} className={`rt-item${expanded ? " is-open" : ""}`}>
                <div className="rt-row">
                  <button
                    type="button"
                    className="rt-main"
                    aria-expanded={expanded}
                    onClick={() => {
                      setOpenName(expanded ? null : r.name);
                      setArmed(null);
                    }}
                  >
                    <span className="rt-name">{r.name}</span>
                    <span className="rt-when">
                      {routineWhen(r)}
                      {r.time && r.lastRun === today ? " · ran today" : ""}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="rt-run"
                    disabled={busy}
                    onClick={() => run(r)}
                    aria-label={`Run ${r.name}`}
                  >
                    <Icon name="play" size={12} />
                    Run
                  </button>
                </div>
                {expanded && (
                  <div className="rt-detail">
                    <p className="rt-steps">{r.prompt}</p>
                    <div className="rt-acts">
                      <button
                        type="button"
                        className="rt-btn"
                        onClick={() => {
                          setArmed(null);
                          setEditing(r.name);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className={`rt-btn rt-btn--danger${armed === r.name ? " is-armed" : ""}`}
                        onClick={() => remove(r)}
                        onBlur={() => armed === r.name && setArmed(null)}
                      >
                        {armed === r.name ? "Tap again to remove" : "Remove"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {editing === true && <RoutineForm onSaved={saved} onCancel={cancel} />}
          <p className="rt-note">
            Run one by saying its name. At its time a timed one runs if JARVIS is open, and
            otherwise posts a notification: tap it to run.
          </p>
        </div>
      )}
    </Widget>
  );
}
