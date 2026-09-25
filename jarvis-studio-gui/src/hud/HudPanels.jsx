/* HudPanels.jsx — all the ringing data panels + chat & OCR overlays.
   Ported from jarvis-hud/hud-panels.jsx and wired to LIVE backend data
   (telemetry / weather / netinfo / schedule / messages) passed in as props.
   Exports each panel (shared values live in hudConstants.js)  */

import { useState, useEffect, useRef, memo } from "react";
import { IS_MOBILE } from "../hooks/useAssistant";
import {
  CornerBox,
  RadialGauge,
  MiniRadial,
  SegBar,
  Sparkline,
  TickStrip,
  DataRow,
} from "./HudGauges";
import { Waveform } from "./HudCore";
import ResponseRenderer from "../components/ResponseRenderer";
import Icon from "../components/Icon";
import StateMessage from "../components/StateMessage";
import Sheet, { ActionRow, Field, Group, HeaderButton, Toggle } from "../components/Sheet";
import { STATUS_META } from "./hudConstants";

// Coerce a telemetry field to a finite number (→0). A partial frame missing
// cpu/ram/disk would otherwise blow up `d.cpu.toFixed(...)` and crash the panel
// — the gpu/net reads already use `?? 0`, so this just makes the rest consistent.
const n0 = (x) => (Number.isFinite(x) ? x : Number.isFinite(+x) ? +x : 0);

/* ───────── live clock ───────── */
function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/* ───────── rolling history of a live value (for real sparklines) ───────── */
function useHistory(value, points = 46) {
  const [hist, setHist] = useState(() => Array(points).fill(0));
  // Adjust state during render when the input changes (React's documented pattern)
  // instead of in an effect, which rendered every tick twice.
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setHist((h) => [...h.slice(1), Number.isFinite(value) ? value : 0]);
  }
  return hist;
}

export function ClockPanel() {
  const now = useClock();
  const hh = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const ss = String(now.getSeconds()).padStart(2, "0");
  const date = now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  const yr = now.getFullYear();
  return (
    <div className="clock">
      <div className="clock-main">
        <span className="clock-hh">{hh}</span>
        <span className="clock-ss">{ss}</span>
      </div>
      <div className="clock-date">
        {date} · {yr}
      </div>
      <TickStrip count={46} />
    </div>
  );
}

/* ───────── status + waveform ───────── */
export function StatusPanel({ status, rgb }) {
  const meta = STATUS_META[status] ?? STATUS_META.idle;
  return (
    <div className="statp">
      <div className="statp-row">
        <span
          className="statp-dot"
          style={{ background: meta.col, boxShadow: `0 0 12px ${meta.col}` }}
        />
        <span className="statp-label" style={{ color: meta.col }}>
          {meta.label}
        </span>
      </div>
      <Waveform status={status} bars={42} height={44} rgb={rgb} />
    </div>
  );
}

/* ───────── system stats (radials) ───────── */
export function SysStatsPanel({ d, collapsible, open, onToggle }) {
  if (IS_MOBILE) {
    const batt = d.batteryPct ?? 0;
    const battSub =
      d.batteryPct == null
        ? "NO DATA"
        : d.charging
          ? `CHARGING${d.remaining ? ` · ${d.remaining}` : ""}`
          : d.remaining || `${Math.round(batt)}%`;
    const tempVal = d.temp != null ? Math.min(100, Math.max(0, (d.temp - 20) * 2)) : 0;
    const tempSub = d.temp != null ? `${n0(d.temp).toFixed(0)}°C` : "NO DATA";
    const ramUsed = d.ramTotalGb ? Math.round((n0(d.ram) / 100) * d.ramTotalGb * 10) / 10 : null;
    const ramSub =
      ramUsed != null && d.ramTotalGb
        ? `${ramUsed} / ${Math.round(d.ramTotalGb)} GB`
        : `${n0(d.ram).toFixed(0)}% used`;
    const diskSub = d.diskTotalGb
      ? `${Math.round(n0(d.diskUsedGb))} / ${Math.round(n0(d.diskTotalGb))} GB`
      : `${n0(d.disk).toFixed(0)}% used`;
    const netSub =
      d.down > 0
        ? `${fmtMbps(d.down)} Mbps`
        : d.ping > 0
          ? `${d.ping} ms RTT`
          : d.linkLabel || "ONLINE";
    return (
      <CornerBox
        title="Device"
        code="SYS·01"
        slot="sysstats"
        collapsible={collapsible}
        open={open}
        onToggle={onToggle}
      >
        <div className="sys-grid">
          <RadialGauge value={tempVal} label="TEMP" size={106} sub={tempSub} />
          <RadialGauge value={d.ram} label="MEMORY" size={106} sub={ramSub} />
        </div>
        <div className="sys-mini">
          <MiniRadial value={batt} label="BATT" size={60} sub={battSub} />
          <MiniRadial value={d.disk} label="DISK" size={60} sub={diskSub} />
          <MiniRadial value={d.net} label="NET" size={60} sub={netSub} />
        </div>
        <p className="sys-mobile-note">
          {d.batteryPct != null
            ? `Power: ${battSub}`
            : "Live CPU, memory, storage and network from this device."}
        </p>
      </CornerBox>
    );
  }
  const tempSub = d.temp != null ? `${n0(d.temp).toFixed(0)}°C` : `${n0(d.cpu).toFixed(0)}% load`;
  const ramSub = d.ramTotalGb
    ? `${Math.round((n0(d.ram) / 100) * d.ramTotalGb * 10) / 10} / ${Math.round(d.ramTotalGb)} GB`
    : `${n0(d.ram).toFixed(0)}% used`;
  return (
    <CornerBox
      title="System"
      code="SYS·01"
      slot="sysstats"
      collapsible={collapsible}
      open={open}
      onToggle={onToggle}
    >
      <div className="sys-grid">
        <RadialGauge value={d.cpu} label="CPU" size={106} sub={tempSub} />
        <RadialGauge value={d.ram} label="MEMORY" size={106} sub={ramSub} />
      </div>
      <div className="sys-mini">
        <MiniRadial
          value={d.gpu ?? 0}
          label="GPU"
          size={60}
          sub={d.gpuName || `${n0(d.gpu ?? 0)}%`}
        />
        <MiniRadial
          value={d.diskActivity ?? 0}
          label="DISK"
          size={60}
          sub={
            d.diskTotalGb
              ? `${Math.round(n0(d.diskUsedGb))} / ${Math.round(n0(d.diskTotalGb))} GB`
              : `${n0(d.disk).toFixed(0)}% used`
          }
        />
        <MiniRadial
          value={d.net ?? 0}
          label="NET"
          size={60}
          sub={d.down > 0 ? `${fmtMbps(d.down)} Mbps` : d.linkLabel || "ONLINE"}
        />
      </div>
    </CornerBox>
  );
}

/* ───────── power / battery ───────── */
export function PowerPanel({ d, collapsible, open, onToggle }) {
  const pct = d.batteryPct;
  const hasBattery = pct != null;
  const shown = hasBattery ? pct : 0;
  const label = !hasBattery ? "BATTERY" : d.charging ? "CHARGING" : "BATTERY";
  return (
    <CornerBox
      title="Power"
      code="PWR"
      slot="power"
      collapsible={collapsible}
      open={open}
      onToggle={onToggle}
    >
      <div className="pwr">
        <RadialGauge value={shown} label={label} size={96} unit="%" />
        <div className="pwr-meta">
          <DataRow
            k="SOURCE"
            v={!hasBattery ? "UNKNOWN" : d.charging ? "AC / USB" : "CELL"}
            accent
          />
          <DataRow k="STATE" v={!hasBattery ? "—" : d.charging ? "CHARGING" : "DISCHARGING"} />
          <DataRow k="REMAINING" v={d.remaining || "—"} />
          <DataRow k="LEVEL" v={hasBattery ? `${Math.round(pct)}%` : "—"} accent />
        </div>
      </div>
      {hasBattery && <SegBar value={shown} segs={18} label="OUTPUT" />}
    </CornerBox>
  );
}

/* ───────── weather ───────── */
const DEFAULT_WEATHER = {
  temp: null,
  condition: "—",
  location: "LOCATING…",
  humidity: null,
  wind: "—",
  aqi: null,
  hours: [],
};
export function WeatherPanel({ weather, collapsible, open, onToggle }) {
  const w = weather || DEFAULT_WEATHER;
  return (
    <CornerBox
      title="Weather"
      code="ATM"
      slot="weather"
      collapsible={collapsible}
      open={open}
      onToggle={onToggle}
    >
      <div className="wx-now">
        <span className="wx-temp">{w.temp != null ? `${Math.round(w.temp)}°` : "—"}</span>
        <div className="wx-meta">
          <span className="wx-cond">{(w.condition || "—").toUpperCase()}</span>
          <span className="wx-loc">{(w.location || "—").toUpperCase()}</span>
        </div>
      </div>
      <div className="wx-stats">
        <DataRow k="HUMIDITY" v={w.humidity != null ? `${Math.round(w.humidity)}%` : "—"} />
        <DataRow k="WIND" v={w.wind || "—"} />
        {w.aqi != null && <DataRow k="AQI" v={`${w.aqi}`} accent />}
      </div>
      {w.hours?.length > 0 && (
        <div className="wx-hours">
          {w.hours.slice(0, 6).map((h, i) => (
            <div key={i} className="wx-h">
              <span className="wx-h-t">{h.t}</span>
              <span className="wx-h-i">{h.i}</span>
              <span className="wx-h-c">{h.c != null ? `${Math.round(n0(h.c))}°` : "—"}</span>
            </div>
          ))}
        </div>
      )}
    </CornerBox>
  );
}

/* ───────── network / connectivity ───────── */
// Live throughput: 1-decimal under 10 Mbps so background/idle traffic is still
// visible instead of rounding to a dead "0"; whole numbers once it's busy.
const fmtMbps = (v) => (v == null ? "0.0" : v < 10 ? v.toFixed(1) : v.toFixed(0));

export function NetworkPanel({ d, netInfo, collapsible, open, onToggle }) {
  const n = netInfo || {};
  const downHist = useHistory(d.down);
  return (
    <CornerBox
      title="Network"
      code="NET·LINK"
      slot="network"
      collapsible={collapsible}
      open={open}
      onToggle={onToggle}
    >
      <div className="net-rates">
        <div className="net-rate">
          <span className="net-arrow">▼</span>
          <span className="net-num">{fmtMbps(d.down)}</span>
          <span className="net-u">Mbps DOWN</span>
        </div>
        <div className="net-rate">
          <span className="net-arrow up">▲</span>
          <span className="net-num">{fmtMbps(d.up)}</span>
          <span className="net-u">Mbps UP</span>
        </div>
      </div>
      <Sparkline points={42} height={34} data={downHist} />
      <div className="net-meta">
        <DataRow k="PING" v={d.ping ? `${d.ping} ms` : "—"} accent />
        <DataRow k="LINK" v={d.linkLabel || (d.down > 0 ? "ACTIVE" : "—")} />
        <DataRow k="PUBLIC IP" v={n.publicIp || "—"} />
        <DataRow k="LOCATION" v={n.location || "—"} />
      </div>
    </CornerBox>
  );
}

/* ───────── schedule / agenda (editable) ───────── */
export function SchedulePanel({ items, collapsible, open, onToggle, runAction }) {
  const list = items || [];
  const editable = typeof runAction === "function";

  const addItem = () => {
    const task = window.prompt("New agenda item — what is it?");
    if (!task || !task.trim()) return;
    const time = (window.prompt("At what time? (e.g. 09:00 — leave blank for none)") || "").trim();
    runAction({ type: "schedule", do: "add", day: "today", time, task: task.trim() });
  };
  const editItem = (it) => {
    const task = (window.prompt("Edit task:", it.task) || "").trim();
    const time = (window.prompt("Edit time (e.g. 09:00):", it.time || "") || "").trim();
    if (!task && !time) return;
    runAction({
      type: "schedule",
      do: "edit",
      day: "today",
      match: it.task,
      new_task: task || it.task,
      new_time: time || it.time,
    });
  };
  const removeItem = (it) =>
    runAction({ type: "schedule", do: "remove", day: "today", match: it.task });

  return (
    <CornerBox
      title="Agenda"
      code="TODAY"
      slot="schedule"
      collapsible={collapsible}
      open={open}
      onToggle={onToggle}
    >
      <div className="sch">
        {list.length === 0 ? (
          <StateMessage variant="empty" icon="calendar" title="Nothing scheduled today">
            Ask JARVIS to remind you about something and it will show up here.
          </StateMessage>
        ) : (
          list.map((it, i) => (
            <div key={i} className={`sch-row ${it.now ? "now" : ""} ${it.done ? "done" : ""}`}>
              <span className="sch-t">{it.time}</span>
              <span className="sch-track">
                <span className="sch-dot" />
              </span>
              <span className="sch-task">{it.task}</span>
              {it.duration && <span className="sch-dur">{it.duration}</span>}
              {editable && (
                <span className="sch-edit">
                  <button title="Edit" onClick={() => editItem(it)}>
                    ✎
                  </button>
                  <button title="Remove" onClick={() => removeItem(it)}>
                    ✕
                  </button>
                </span>
              )}
            </div>
          ))
        )}
      </div>
      {editable && (
        <button className="sch-add" onClick={addItem}>
          ＋ Add item
        </button>
      )}
    </CornerBox>
  );
}

/* ───────── command log — JARVIS's mini "terminal" (collapsible) ───────── */
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
      className={`term-clear ${armed ? "term-clear--armed" : ""}`}
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        onClear();
      }}
      onBlur={() => setArmed(false)}
    >
      <Icon name="trash" size={14} />
      {armed ? "Clear log?" : "Clear"}
    </button>
  );
}

export function TerminalPanel({ commands = [], onClear, open, onToggle }) {
  const bodyRef = useRef(null);
  const [expanded, setExpanded] = useState(null); // index of the line shown in full
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
  return (
    <CornerBox
      title="Terminal"
      code="LOG"
      slot="terminal"
      collapsible
      open={open}
      onToggle={onToggle}
      action={open && onClear && commands.length > 0 ? <ClearLogButton onClear={onClear} /> : null}
    >
      <div className="term" ref={bodyRef}>
        {commands.length === 0 && (
          <StateMessage variant="empty" icon="terminal" title="Nothing run yet">
            Every action JARVIS takes for you is logged here, newest last.
          </StateMessage>
        )}
        {commands.map((c, i) => (
          <button
            type="button"
            key={i}
            className={`term-line ${c.ok === false ? "term-err" : ""} ${expanded === i ? "term-line--open" : ""}`}
            onClick={() => setExpanded(expanded === i ? null : i)}
            aria-expanded={c.message ? expanded === i : undefined}
          >
            <span className="term-head">
              <span className="term-prompt" aria-label={c.ok === false ? "Failed" : "Done"}>
                {c.ok === false ? "✗" : "›"}
              </span>
              <span className="term-cmd">
                {c.type}
                {c.target ? ` ${c.target}` : ""}
              </span>
              <span className="term-t">{fmtTime(c.ts)}</span>
            </span>
            {c.message && <span className="term-out">{c.message}</span>}
          </button>
        ))}
      </div>
    </CornerBox>
  );
}

/* ───────── bottom dock launcher (replaces the quick-actions grid) ───────── */
export function DockBar({
  onOpenSkills,
  onOpenCaps,
  onOpenPower,
  onOpenMemory,
  onOpenChat,
  chatCount = 0,
}) {
  const items = [
    { l: "SKILLS", i: "sparkle", on: onOpenSkills },
    { l: "MEMORY", i: "memory", on: onOpenMemory },
    { l: "CAPABILITIES", i: "help", on: onOpenCaps },
    { l: IS_MOBILE ? "DEVICE" : "POWER", i: "power", on: onOpenPower },
  ];
  return (
    <div className="dock" data-slot="dock">
      {items.map((it) => (
        <button key={it.l} className="dock-btn" onClick={it.on}>
          <span className="dock-i">
            <Icon name={it.i} size={18} />
          </span>
          <span className="dock-l">{it.l}</span>
        </button>
      ))}
      <button className="dock-btn dock-btn--chat" onClick={onOpenChat}>
        <span className="dock-i">
          <Icon name="chat" size={18} />
        </span>
        <span className="dock-l">CONVERSATION</span>
        {chatCount > 0 && <span className="dock-badge">{chatCount}</span>}
      </button>
    </div>
  );
}

/* ───────── Skills — quick tools, with their results shown in place ───────── */
export function SkillsOverlay({
  open,
  onClose,
  recordings = {},
  runAction,
  allowedDirs = [],
  onSaveDirs,
}) {
  const [qrText, setQrText] = useState("");
  const [qr, setQr] = useState(null); // {imageUrl, text}
  const [clip, setClip] = useState(null); // ToolResult
  const [dirPath, setDirPath] = useState("");
  const [newDir, setNewDir] = useState("");

  // The phone's runAction resolves to the tool's result; the desktop's is
  // fire-and-forget (the backend shows the outcome itself), so close there.
  const run = async (spec) => {
    const r = await runAction(spec);
    if (r === undefined) onClose();
    return r;
  };
  const makeQr = async () => {
    const t = qrText.trim();
    if (!t) return;
    const r = await run({ type: "qr_code", text: t });
    if (r?.ok && r.data?.imageUrl) setQr({ imageUrl: r.data.imageUrl, text: t });
  };
  const listDir = () => dirPath.trim() && run({ type: "list_dir", path: dirPath.trim() });
  const addDir = () => {
    const d = newDir.trim().replace(/^["']|["']$/g, "");
    if (d && !allowedDirs.includes(d)) onSaveDirs([...allowedDirs, d]);
    setNewDir("");
  };

  return (
    <Sheet open={open} title="Skills" onClose={onClose}>
      <div className="sp-sheet">
        <Group title="QR code">
          <Field hint="Anyone who scans it gets this link or text.">
            <div className="sp-inline">
              <input
                className="sp-input"
                value={qrText}
                placeholder="Link or text"
                onChange={(e) => setQrText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && makeQr()}
                aria-label="QR code contents"
              />
              <button type="button" className="sp-btn" onClick={makeQr} disabled={!qrText.trim()}>
                Make
              </button>
            </div>
          </Field>
          {qr && (
            <div className="sp-field skill-qr">
              <img src={qr.imageUrl} alt={`QR code for ${qr.text}`} width="200" height="200" />
              <span className="sp-desc">{qr.text}</span>
            </div>
          )}
        </Group>

        {IS_MOBILE && (
          <Group title="Clipboard">
            <ActionRow
              icon="clipboard"
              title="Read clipboard"
              desc="Shows the last thing you copied."
              onClick={async () => setClip(await run({ type: "clipboard" }))}
            />
            {clip && (
              <div className="sp-field">
                <span className={`sp-desc ${clip.ok === false ? "skill-err" : "skill-out"}`}>
                  {clip.summary}
                </span>
              </div>
            )}
          </Group>
        )}

        {!IS_MOBILE && (
          <>
            <Group title="Recording">
              {[
                ["audio", "Microphone"],
                ["video", "Webcam"],
                ["screen", "Screen"],
              ].map(([media, label]) => (
                <Toggle
                  key={media}
                  label={label}
                  checked={Boolean(recordings[media])}
                  onChange={(on) => runAction({ type: "record", media, do: on ? "start" : "stop" })}
                />
              ))}
              <div className="sp-field">
                <span className="sp-desc">
                  Runs until you switch it off. Saved to your Jarvis storage folder.
                </span>
              </div>
            </Group>
            <Group title="Quick tools">
              <ActionRow
                icon="camera"
                title="Take a screenshot"
                onClick={() => run({ type: "screenshot" })}
              />
              <Field label="List an approved folder">
                <div className="sp-inline">
                  <input
                    className="sp-input sp-mono"
                    value={dirPath}
                    placeholder="C:\Users\you\Documents"
                    onChange={(e) => setDirPath(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && listDir()}
                  />
                  <button
                    type="button"
                    className="sp-btn"
                    disabled={!dirPath.trim()}
                    onClick={listDir}
                  >
                    List
                  </button>
                </div>
              </Field>
            </Group>
            <Group title="Folders JARVIS can read">
              <Field hint="It can list these and read files inside, asking you each time. It can never run, write, move or delete anything.">
                <div className="dirlist">
                  {allowedDirs.length === 0 && (
                    <StateMessage variant="empty" icon="folder" title="No folders yet">
                      Add one to let JARVIS read files from it.
                    </StateMessage>
                  )}
                  {allowedDirs.map((d) => (
                    <div key={d} className="dirlist-row">
                      <span className="dirlist-path" title={d}>
                        {d}
                      </span>
                      <button
                        className="dirlist-rm"
                        aria-label={`Remove ${d}`}
                        onClick={() => onSaveDirs(allowedDirs.filter((x) => x !== d))}
                      >
                        <Icon name="close" size={14} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="sp-inline">
                  <input
                    className="sp-input sp-mono"
                    value={newDir}
                    placeholder="C:\Users\you\Documents"
                    onChange={(e) => setNewDir(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addDir()}
                  />
                  <button type="button" className="sp-btn" onClick={addDir}>
                    Add
                  </button>
                </div>
              </Field>
            </Group>
          </>
        )}
      </div>
    </Sheet>
  );
}

/* ───────── Capabilities — what to ask, with examples that fill the chat box ───────── */
// `say` is an example request. Tapping it puts it in the chat box to edit or send,
// never sends straight away: "Remind me at 6 pm" would really set a reminder.
const MOBILE_CAPABILITIES = [
  {
    group: "Talk and remember",
    items: [
      { t: "Answer questions and explain things", say: "Explain how a heat pump works" },
      { t: "Remember things you tell it", say: "What do you remember about me?" },
      {
        t: "Short, chatty replies",
        note: "Turn on conversation mode with the speech-bubble button at the top.",
      },
    ],
  },
  {
    group: "On this phone",
    items: [
      { t: "Open apps and websites", say: "Open YouTube" },
      {
        t: "Do tasks inside other apps",
        say: "Open Spotify and play lofi beats",
        note: "Needs app control, in Device.",
      },
      { t: "Set media volume or mute", say: "Set the volume to 30%" },
      { t: "Read your clipboard", say: "What's on my clipboard?" },
    ],
  },
  {
    group: "Out in the world",
    items: [
      { t: "Weather and forecasts", say: "Will it rain tomorrow?" },
      { t: "News headlines", say: "What's in the tech news today?" },
      { t: "Places nearby and directions", say: "Find a pharmacy near me" },
      { t: "Search the web", say: "Search the web for budget wireless earbuds" },
    ],
  },
  {
    group: "Agenda and alarms",
    items: [
      { t: "Reminders with a real alarm", say: "Remind me at 6 pm to call Mum" },
      { t: "Timers and alarms in your Clock app", say: "Set a timer for 10 minutes" },
      { t: "Today's agenda", say: "What's on my agenda today?" },
    ],
  },
  {
    group: "Your PC",
    items: [
      {
        t: "Run tasks on your paired Windows PC",
        say: "On my PC, open Notepad",
        note: "Pair it with the monitor button at the top.",
      },
    ],
  },
  {
    group: "This screen",
    items: [{ t: "Restyle the home screen", say: "Make the accent colour amber" }],
  },
];

const CAPABILITIES = [
  {
    group: "Conversation",
    items: [
      "Answer questions, explain, advise",
      "Render charts, tables, schedules and flowcharts",
      "Translate text, typed or from the camera",
      "Talk by wake word, Ctrl+Space, always-on listening, native voice, or chat",
      "Conversation mode: short, natural back-and-forth",
      "Speak with a British neural voice (offline Piper, or ElevenLabs)",
      "Attach an image or document in chat and ask about it",
    ],
  },
  {
    group: "Memory",
    items: [
      "Remember durable facts about you across sessions",
      "Recall recent conversation context",
      "Forget facts on request",
    ],
  },
  {
    group: "Your computer",
    items: [
      "Open and close apps and folders",
      "Search the web and open links",
      "Volume up and down, exact volume, mute, media keys",
      "Lock the screen",
      "Read your clipboard on request",
    ],
  },
  {
    group: "Web browser",
    items: [
      "Autopilot: give a whole task, like “play lofi on YouTube”, and it clicks and types until it's done",
      "You hear the outcome, not the steps",
      "Reads and summarises a page",
    ],
  },
  {
    group: "Desktop autopilot",
    items: [
      "Drives desktop apps by their named controls (asks once)",
      "Focuses or launches the right window itself",
      "Kill switch: slam the mouse into the top-left corner, press Stop, or say “disarm”",
    ],
  },
  { group: "Power (asks first)", items: ["Shut down, restart, sleep, hibernate, log off"] },
  {
    group: "Create and capture",
    items: [
      "Screenshots and QR codes",
      "Generate images (needs a Gemini key)",
      "Record audio, webcam or screen until you stop",
      "Make PDFs from text, and open files it created",
    ],
  },
  {
    group: "Read",
    items: [
      "Read and summarise PDFs",
      "List approved folders and read approved text files (asks first)",
      "Look at your screen and answer questions about it",
    ],
  },
  {
    group: "Out in the world",
    items: [
      "Current weather and a multi-day forecast",
      "Nearby places: food, cafés, pharmacies, ATMs, fuel",
      "Directions and travel time",
      "Latest news headlines by topic",
    ],
  },
  {
    group: "Clock, reminders and routines",
    items: [
      "Alarms and timers in your Clock app",
      "One-off reminders (agenda plus a real alarm)",
      "Recurring routines and spoken briefings",
      "Manage your daily agenda",
    ],
  },
  {
    group: "Learns and adapts",
    items: [
      "Playbooks: named multi-step recipes you teach it",
      "Restyle the HUD: colour, background, density",
      "Show, hide or rearrange panels by voice",
    ],
  },
  { group: "Apps", items: ["Spotify: play, pause, next, previous, play a song"] },
];

export function CapabilitiesOverlay({ open, onClose, onTry }) {
  const caps = IS_MOBILE ? MOBILE_CAPABILITIES : CAPABILITIES;
  return (
    <Sheet open={open} title="Capabilities" onClose={onClose}>
      <div className="sp-sheet">
        <p className="sp-lede">
          Ask in your own words, by voice or text.
          {onTry && IS_MOBILE ? " Tap an example to put it in the chat box." : ""}
        </p>
        {caps.map((c) => (
          <Group key={c.group} title={c.group}>
            {c.items.map((it) => {
              const item = typeof it === "string" ? { t: it } : it;
              const body = (
                <>
                  <span className="sp-label">{item.t}</span>
                  {item.say && <span className="cap-say">“{item.say}”</span>}
                  {item.note && <span className="sp-desc">{item.note}</span>}
                </>
              );
              return item.say && onTry ? (
                <button
                  type="button"
                  key={item.t}
                  className="sp-field cap-row"
                  onClick={() => onTry(item.say)}
                  aria-label={`${item.t}. Try: ${item.say}`}
                >
                  <span className="cap-text">{body}</span>
                  <Icon name="chat" size={18} className="cap-go" />
                </button>
              ) : (
                <div key={item.t} className="sp-field cap-row">
                  <span className="cap-text">{body}</span>
                </div>
              );
            })}
          </Group>
        ))}
      </div>
    </Sheet>
  );
}

/* ───────── Memory overlay — everything JARVIS has stored, with forget ─────────
   Port of the desktop's MemoryOverlay. The phone has no "learned routines" tab:
   verified workflows live in the Playbooks list with their status. */
const MEM_KINDS = [
  {
    key: "facts",
    kind: "fact",
    label: "About you",
    color: "var(--ac)",
    note: "JARVIS reads these before every reply.",
  },
  {
    key: "playbooks",
    kind: "playbook",
    label: "Playbooks",
    color: "#6ee7a8",
    note: "Routines you taught JARVIS. A playbook runs on its own only after three verified successes.",
  },
  {
    key: "conversations",
    kind: "conversation",
    label: "Saved chats",
    color: "#8fa9bd",
    note: "Past conversations. Open one to pick up where you left off.",
  },
];
const PLAYBOOK_STATUS = {
  draft: "Reference",
  candidate: "Learning",
  promoted: "Verified",
  disabled: "Disabled",
};

const memTitle = (key, x) =>
  key === "facts" ? x.text : key === "conversations" ? x.title : x.name;

function memDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

export function MemoryOverlay({
  open,
  onClose,
  memory,
  currentCount = 0,
  onRemember,
  onForget,
  onOpenConversation,
  onOpenChat,
}) {
  const [tab, setTab] = useState("facts");
  const [draft, setDraft] = useState("");
  const [armed, setArmed] = useState(null); // id awaiting its confirming second tap
  const [focus, setFocus] = useState(null); // id picked on the timeline
  const mainRef = useRef(null);
  const m = memory || {};
  const lists = {
    facts: [...(m.facts || [])].reverse(),
    playbooks: m.playbooks || [],
    conversations: m.conversations || [],
  };

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Scroll only the list pane — scrollIntoView would also scroll the HUD's
  // overflow:hidden ancestors and shift the whole stage sideways.
  useEffect(() => {
    const main = mainRef.current;
    const el = focus && main?.querySelector(`[data-mem="${CSS.escape(focus)}"]`);
    if (main && el) {
      main.scrollTo({ top: el.offsetTop - main.clientHeight / 3, behavior: "smooth" });
    }
  }, [focus, tab]);

  // Timeline: every dated memory as a tick between the oldest one and now.
  const now = m.now || 0; // set by listMemory (render must stay pure)
  const dated = MEM_KINDS.flatMap((k) => lists[k.key].filter((x) => x.ts).map((x) => ({ x, k })));
  const t0 = Math.min(now - 86400000, ...dated.map((d) => d.x.ts));
  const at = (ts) => `${((ts - t0) / (now - t0)) * 100}%`;

  const pick = (key) => {
    setTab(key);
    setFocus(null);
    setArmed(null);
    mainRef.current?.scrollTo(0, 0);
  };
  const forgetBtn = (kind, id, label = "Forget") => (
    <button
      type="button"
      className={`memx-forget ${armed === id ? "is-armed" : ""}`}
      onClick={() => {
        if (armed !== id) return setArmed(id);
        setArmed(null);
        onForget(kind, id);
      }}
      onBlur={() => armed === id && setArmed(null)}
    >
      {armed === id ? "Confirm" : label}
    </button>
  );
  const remember = (e) => {
    e.preventDefault();
    if (draft.trim()) {
      onRemember(draft.trim());
      setDraft("");
    }
  };
  const row = (id) => ({ "data-mem": id, className: focus === id ? "is-focus" : "" });
  const cur = MEM_KINDS.find((k) => k.key === tab);
  const list = lists[tab];

  return (
    <div className={`memx ${open ? "open" : ""}`} aria-hidden={!open}>
      <div className="memx-scrim" onClick={onClose} />
      <section className="memx-panel" role="dialog" aria-label="Memory">
        <header className="memx-hd">
          <div className="memx-hd-txt">
            <span className="memx-kicker">MEMORY</span>
            <h2 className="memx-title">What JARVIS knows</h2>
            <p className="memx-loc">Kept on this phone only.</p>
          </div>
          <button className="memx-close" onClick={onClose} aria-label="Close memory">
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="memx-tl" aria-hidden="true">
          <div className="memx-tl-track">
            {dated.map(({ x, k }) => (
              <button
                key={`${k.key}-${x.id}`}
                tabIndex={-1}
                className="memx-tick"
                style={{ left: at(x.ts), "--kc": k.color }}
                title={`${k.label} · ${memDate(x.ts)} — ${memTitle(k.key, x)}`}
                onClick={() => {
                  setTab(k.key);
                  setFocus(x.id);
                  setArmed(null);
                }}
              />
            ))}
          </div>
          <div className="memx-tl-axis">
            <span>{memDate(t0)}</span>
            <span>Today</span>
          </div>
        </div>

        <div className="memx-body">
          <nav className="memx-nav" aria-label="Memory sections">
            {MEM_KINDS.map((k) => (
              <button
                key={k.key}
                className={`memx-navbtn ${tab === k.key ? "is-on" : ""}`}
                aria-current={tab === k.key}
                onClick={() => pick(k.key)}
                style={{ "--kc": k.color }}
              >
                <span className="memx-sw" />
                <span className="memx-navl">{k.label}</span>
                <span className="memx-count">{memory ? lists[k.key].length : "–"}</span>
              </button>
            ))}
            <p className="memx-navnote">
              Forgetting is permanent. You can also say “forget that…”.
            </p>
          </nav>

          <div className="memx-main" ref={mainRef}>
            <div className="memx-sec-hd">
              <h3>{cur.label}</h3>
              <p>{cur.note}</p>
            </div>

            {tab === "facts" && (
              <form className="memx-add" onSubmit={remember}>
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  aria-label="New fact"
                  placeholder="Something JARVIS should always know — e.g. I'm vegetarian"
                  maxLength={300}
                />
                <button type="submit" disabled={!draft.trim()}>
                  Remember
                </button>
              </form>
            )}

            {tab === "conversations" && currentCount > 0 && (
              <div className="memx-row memx-row--current">
                <span className="memx-text">This conversation</span>
                <span className="memx-meta">{currentCount} messages</span>
                <button type="button" className="memx-open" onClick={onOpenChat}>
                  Open
                </button>
              </div>
            )}

            {!memory && <p className="memx-empty">Reading memory…</p>}
            {memory && list.length === 0 && (
              <p className="memx-empty">
                {
                  {
                    facts: "Nothing yet. Tell JARVIS “remember that…”, or add something above.",
                    playbooks: "No playbooks. Teach one by saying “learn a playbook called…”.",
                    conversations:
                      "No saved chats. Starting a new chat saves the current one here.",
                  }[tab]
                }
              </p>
            )}

            <ul className="memx-list">
              {tab === "facts" &&
                list.map((f) => (
                  <li key={f.id} {...row(f.id)}>
                    <div className="memx-row">
                      <span className="memx-text">{f.text}</span>
                      <span className="memx-meta">{memDate(f.ts)}</span>
                      {forgetBtn("fact", f.id)}
                    </div>
                  </li>
                ))}

              {tab === "playbooks" &&
                list.map((p) => (
                  <li key={p.id} {...row(p.id)}>
                    <div className="memx-card">
                      <div className="memx-row">
                        <span className="memx-name">{p.name}</span>
                        <span className="memx-badge">{PLAYBOOK_STATUS[p.status] || p.status}</span>
                        <span className="memx-meta">{memDate(p.ts)}</span>
                        {forgetBtn("playbook", p.id, "Remove")}
                      </div>
                      {p.triggers.length > 0 && (
                        <div className="memx-trig">
                          <span>When you say</span>
                          {p.triggers.map((t) => (
                            <em key={t}>{t}</em>
                          ))}
                        </div>
                      )}
                      {p.steps && <p className="memx-steps">{p.steps}</p>}
                    </div>
                  </li>
                ))}

              {tab === "conversations" &&
                list.map((c) => (
                  <li key={c.id} {...row(c.id)}>
                    <div className="memx-row">
                      <span className="memx-text">{c.title}</span>
                      <span className="memx-meta">
                        {c.count} messages · {memDate(c.ts)}
                      </span>
                      {forgetBtn("conversation", c.id, "Delete")}
                      <button
                        type="button"
                        className="memx-open"
                        onClick={() => onOpenConversation(c.id)}
                      >
                        Open
                      </button>
                    </div>
                  </li>
                ))}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}

/* ───────── Device (phone) / Power (desktop) ───────── */
/** "WIFI" / "4G" / "OFFLINE" … from deviceTelemetry → a readout for the Wi-Fi row. */
function networkReadout(label) {
  if (!label) return null;
  if (label === "WIFI") return { text: "On Wi-Fi", tone: "on" };
  if (/^[2-5]G$/.test(label)) return { text: `On ${label}`, tone: "on" };
  if (label === "OFFLINE") return { text: "Offline", tone: "warn" };
  return null;
}

export function PowerOverlay({ open, onClose, runAction, d = {} }) {
  const [note, setNote] = useState(null); // result of an action that stays in the sheet
  // Rows that open an Android settings screen leave JARVIS — close first.
  const openSettings = (target) => {
    onClose();
    runAction({ type: "system", target });
  };
  const power = (command) => {
    onClose();
    runAction({ type: "power", command });
  };

  if (!IS_MOBILE) {
    return (
      <Sheet open={open} title="Power" onClose={onClose}>
        <div className="sp-sheet">
          <Group title="This PC">
            <ActionRow icon="lock" title="Lock" onClick={() => power("lock")} />
            <ActionRow icon="moon" title="Sleep" onClick={() => power("sleep")} />
          </Group>
          <Group title="Asks before it runs">
            <ActionRow icon="restart" title="Restart" onClick={() => power("restart")} />
            <ActionRow
              icon="moon"
              title="Hibernate"
              desc="Saves your session, then powers off."
              onClick={() => power("hibernate")}
            />
            <ActionRow icon="logout" title="Log off" onClick={() => power("logoff")} />
            <ActionRow icon="power" title="Shut down" danger onClick={() => power("shutdown")} />
          </Group>
        </div>
      </Sheet>
    );
  }

  const net = networkReadout(d.linkLabel);
  const pct = d.batteryPct;
  const battery =
    pct == null
      ? null
      : {
          text: `${Math.round(pct)}%${d.charging ? ", charging" : ""}`,
          tone: pct < 20 && !d.charging ? "warn" : "on",
        };

  return (
    <Sheet open={open} title="Device" onClose={onClose}>
      <div className="sp-sheet">
        <Group title="Connections">
          <ActionRow
            icon="wifi"
            title="Wi-Fi"
            readout={net?.text}
            tone={net?.tone}
            leaves
            onClick={() => openSettings("wifi")}
          />
          <ActionRow
            icon="bluetooth"
            title="Bluetooth"
            leaves
            onClick={() => openSettings("bluetooth")}
          />
        </Group>
        <Group title="Sound">
          <ActionRow
            icon="volumeOff"
            title="Mute media"
            desc="Sets music and video volume to zero. Calls and alarms still ring."
            onClick={async () => setNote(await runAction({ type: "power", command: "mute" }))}
          />
          {note?.summary && (
            <div className="sp-field">
              <span className={`sp-desc ${note.ok === false ? "skill-err" : "skill-out"}`}>
                {note.summary}
              </span>
            </div>
          )}
          <ActionRow
            icon="volume"
            title="Sound settings"
            leaves
            onClick={() => openSettings("sound")}
          />
        </Group>
        <Group title="Battery">
          <ActionRow
            icon="battery"
            title="Battery settings"
            readout={battery?.text}
            tone={battery?.tone}
            leaves
            onClick={() => openSettings("battery")}
          />
        </Group>
        <Group title="Phone">
          <ActionRow
            icon="hand"
            title="App control"
            desc="Lets JARVIS tap and type in other apps. Turn on JARVIS in Accessibility."
            leaves
            onClick={() => {
              onClose();
              runAction({ type: "open_a11y_settings" });
            }}
          />
          <ActionRow
            icon="settings"
            title="All settings"
            leaves
            onClick={() => openSettings("settings")}
          />
        </Group>
        <p className="sp-desc sp-sheet-note">
          Android doesn&apos;t let apps shut down or restart the phone.
        </p>
      </div>
    </Sheet>
  );
}

/* ───────── Conversation ───────── */
// One message, memoized: during streaming only the live message's object identity
// changes (useWebSocket replaces just that entry), so finalized messages skip both
// re-render and ResponseRenderer's re-parse. runAction is a stable useCallback.
const ChatMessage = memo(function ChatMessage({ m, runAction }) {
  const user = m.role === "user";
  return (
    <div className={`cv-msg cv-msg--${user ? "user" : "jarvis"}`}>
      <span className="sp-sr">{user ? "You:" : "JARVIS:"}</span>
      <div className="cv-bubble">
        {user ? (
          m.text
        ) : (
          <ResponseRenderer text={m.text} actions={m.actions} runAction={runAction} />
        )}
      </div>
    </div>
  );
});

// Relative "time ago" for the history list (ts is epoch seconds).
function timeAgo(ts) {
  if (!ts) return "";
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return d === 1 ? "yesterday" : `${d} days ago`;
  return `${Math.floor(d / 7)} wk ago`;
}

const STARTERS = IS_MOBILE
  ? [
      "What's the weather today?",
      "What's on my agenda today?",
      "Open YouTube",
      "What's in the news?",
    ]
  : [
      "What's the weather today?",
      "Summarise my agenda",
      "Take a screenshot",
      "What's in the news?",
    ];

export function ChatOverlay({
  open,
  onClose,
  status,
  messages = [],
  onSend,
  onStop,
  onUpload,
  runAction,
  conversations = [],
  onNewChat,
  onOpenConversation,
  onDeleteConversation,
  onRefreshConversations,
  onClearConversations,
  prefill, // {text, n}: text to drop into the box (from Capabilities); n makes repeats count
}) {
  const [draft, setDraft] = useState("");
  const [histOpen, setHistOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const bodyRef = useRef(null);
  const fileRef = useRef(null);
  const inputRef = useRef(null);

  // A Capabilities example lands in the box, ready to edit or send. Adjusted while
  // rendering (not in an effect) so the box never paints with the old draft first.
  const [seenPrefill, setSeenPrefill] = useState(prefill);
  if (prefill !== seenPrefill) {
    setSeenPrefill(prefill);
    if (prefill?.text) {
      setDraft(prefill.text);
      setHistOpen(false);
    }
  }
  useEffect(() => {
    if (open && prefill?.text) inputRef.current?.focus();
  }, [open, prefill]);

  const startNewChat = () => {
    onNewChat?.();
    setHistOpen(false);
  };
  const showHistory = () => {
    setConfirmClear(false);
    onRefreshConversations?.();
    setHistOpen(true);
  };
  const openConv = (id) => {
    onOpenConversation?.(id);
    setHistOpen(false);
  };
  // Two taps so a stray one can't wipe the whole archive.
  const clearAll = () => {
    if (!confirmClear) return setConfirmClear(true);
    onClearConversations?.();
    setConfirmClear(false);
  };

  const pickFile = (e) => {
    const file = e.target.files?.[0];
    if (file && onUpload) onUpload(file, draft.trim());
    setDraft("");
    e.target.value = ""; // allow re-selecting the same file
  };

  // Keep the newest message in view.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages, status, open, histOpen]);

  const send = (text = draft) => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setDraft("");
  };

  // Mid-reply (thinking/working, or a message still streaming): Stop replaces Send.
  const busy = status === "thinking" || status === "working" || messages.some((m) => m.streaming);

  if (histOpen) {
    return (
      <Sheet
        open={open}
        title="History"
        onClose={onClose}
        onBack={() => setHistOpen(false)}
        backLabel="Conversation"
      >
        <div className="sp-sheet">
          <h2 className="sp-page-title">History</h2>
          <button type="button" className="sp-btn cv-newchat" onClick={startNewChat}>
            <Icon name="plus" size={16} />
            New chat
          </button>
          {conversations.length === 0 ? (
            <StateMessage variant="empty" icon="history" title="No saved chats yet">
              Start a new chat and the current one is saved here.
            </StateMessage>
          ) : (
            <Group title="Saved chats">
              {conversations.map((c) => (
                <div key={c.id} className="sp-field cv-hist-row">
                  <button type="button" className="cv-hist-open" onClick={() => openConv(c.id)}>
                    <span className="sp-label">{c.title}</span>
                    <span className="sp-desc">
                      {timeAgo(c.ts)}
                      {c.count ? `, ${c.count} message${c.count === 1 ? "" : "s"}` : ""}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="cv-hist-del"
                    aria-label={`Delete “${c.title}”`}
                    title="Delete"
                    onClick={() => onDeleteConversation?.(c.id)}
                  >
                    <Icon name="trash" size={17} />
                  </button>
                </div>
              ))}
            </Group>
          )}
          {conversations.length > 0 && (
            <button
              type="button"
              className={`sp-btn sp-btn--quiet cv-clearall ${confirmClear ? "is-armed" : ""}`}
              onClick={clearAll}
              onBlur={() => setConfirmClear(false)}
            >
              {confirmClear ? "Tap again to delete all" : "Delete all saved chats"}
            </button>
          )}
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      open={open}
      title="Conversation"
      onClose={onClose}
      className="sp--chat"
      bodyRef={bodyRef}
      actions={
        <>
          <HeaderButton icon="history" label="Chat history" onClick={showHistory} />
          <HeaderButton icon="plus" label="New chat (saves this one)" onClick={startNewChat} />
        </>
      }
      footer={
        <div className="cv-compose">
          {onUpload && !IS_MOBILE && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,.pdf,.txt,.md,.csv,.json,.log"
                onChange={pickFile}
                hidden
              />
              <button
                type="button"
                className="cv-attach"
                aria-label="Attach an image or document"
                title="Attach an image or document"
                onClick={() => fileRef.current?.click()}
              >
                <Icon name="paperclip" size={20} />
              </button>
            </>
          )}
          <input
            ref={inputRef}
            className="sp-input cv-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Message JARVIS"
            aria-label="Message JARVIS"
          />
          {busy && onStop ? (
            <button
              type="button"
              className="cv-send cv-send--stop"
              aria-label="Stop"
              onClick={onStop}
            >
              <Icon name="stop" size={18} />
            </button>
          ) : (
            <button
              type="button"
              className="cv-send"
              aria-label="Send"
              disabled={!draft.trim()}
              onClick={() => send()}
            >
              <Icon name="send" size={19} />
            </button>
          )}
        </div>
      }
    >
      <div className="cv" aria-live="polite">
        {messages.length === 0 ? (
          <div className="cv-empty">
            <p className="cv-empty-title">Ask JARVIS anything</p>
            <p className="sp-desc">Type below, tap the mic, or say “Hey Jarvis”.</p>
            <div className="cv-starters">
              {STARTERS.map((t) => (
                <button key={t} type="button" className="cv-starter" onClick={() => setDraft(t)}>
                  {t}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => <ChatMessage key={m.id} m={m} runAction={runAction} />)
        )}
        {status === "thinking" && (
          <div className="cv-msg cv-msg--jarvis">
            <span className="sp-sr">JARVIS is thinking</span>
            <div className="cv-typing" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}
