/* HudApp.jsx — the home screen, as on the desktop (its hud/HudApp.jsx): a header
   (logo + quick controls), JARVIS at the centre (time, the orb, what it's doing, its
   last reply and an ask box) and the live cards. A phone stacks it in one scrolling
   column and puts the menus (Chat, Memory, Skills, Capabilities) in a bottom bar
   around the mic, since they don't fit beside the controls. App owns every
   open/collapse state so JARVIS can drive the screen by voice; `screen` (Customize)
   holds the look (colours, font, corners, glow, card style, centrepiece, gauges,
   background) and the layout (density, which cards show, and in what order). */

import { useState, useEffect, useCallback, useRef } from "react";
import { IS_MOBILE } from "../hooks/useAssistant";
import "./hud.css";
import "./home.css";
import "./ironman.css";
import Orb from "./Orb";
import Reactor, { Waveform } from "./Reactor";
import Icon from "../components/Icon";
import { DEFAULT_TELEMETRY } from "./hudConstants";
import {
  SystemWidget,
  PowerWidget,
  AgendaWidget,
  WeatherWidget,
  NetworkWidget,
  LogWidget,
  ReadinessWidget,
  RoutinesWidget,
} from "./widgets";
import {
  SkillsOverlay,
  CapabilitiesOverlay,
  PowerOverlay,
  MemoryOverlay,
  ChatOverlay,
  AgentRow,
} from "./HudPanels";
import { agentById } from "../brain/agents";
import { stripMarkdownForSpeech } from "../brain/formatting";

const STATUS_TEXT = {
  idle: [
    "Standing by",
    IS_MOBILE ? "Say “Hey Jarvis”, or tap the orb." : "Say “Hey Jarvis”, or click the orb.",
  ],
  listening: [
    "Listening…",
    IS_MOBILE ? "Go ahead. Tap the orb when you're done." : "Go ahead. Click the orb to cancel.",
  ],
  thinking: ["Thinking…", IS_MOBILE ? "Tap the orb to stop." : "Click the orb to stop."],
  speaking: ["Speaking", IS_MOBILE ? "Tap the orb to stop." : "Click the orb to stop."],
  working: ["Working on it…", IS_MOBILE ? "Tap the orb to stop." : "Click the orb to stop."],
};

const STARTERS = [
  "What's on my agenda today?",
  "What's the weather this week?",
  "Play lofi on YouTube",
];

const plain = (text) => stripMarkdownForSpeech(text || "").replace(/\s+/g, " ");

function greeting(h) {
  return h < 5
    ? "Good evening"
    : h < 12
      ? "Good morning"
      : h < 17
        ? "Good afternoon"
        : "Good evening";
}

/* Ticks on its own so the rest of the screen doesn't re-render every second. */
function HeroClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const parts = new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" }).formatToParts(
    now,
  );
  const time = parts
    .filter((p) => p.type !== "dayPeriod")
    .map((p) => p.value)
    .join("")
    .trim();
  const period = parts.find((p) => p.type === "dayPeriod")?.value;
  return (
    <div className="hero-clock">
      <div className="hero-greet">{greeting(now.getHours())}</div>
      <div className="hero-time">
        {time}
        {period && <span>{period}</span>}
      </div>
      <div className="hero-date">
        {now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
      </div>
    </div>
  );
}

/* The ask box: a message goes straight to JARVIS and the reply appears above it. */
function AskBar({ onSend, onListen, status, placeholder }) {
  const [text, setText] = useState("");
  const submit = (e) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText("");
  };
  return (
    <form className="ask" onSubmit={submit}>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        aria-label="Ask JARVIS"
        enterKeyHint="send"
      />
      <button
        type="button"
        className={`ask-btn${status === "listening" ? " is-on" : ""}`}
        onClick={onListen}
        aria-label={status === "listening" ? "Stop and send" : "Talk"}
      >
        <Icon name={status === "listening" ? "stop" : "mic"} size={17} />
      </button>
      <button
        type="submit"
        className="ask-btn ask-btn--send"
        disabled={!text.trim()}
        aria-label="Send"
      >
        <Icon name="send" size={17} />
      </button>
    </form>
  );
}

const NAV = [
  { id: "chat", label: "Chat", icon: "chat" },
  { id: "memory", label: "Memory", icon: "memory" },
  { id: "skills", label: "Skills", icon: "skills" },
  { id: "caps", label: "Capabilities", icon: "caps" },
];

export function JarvisHUD({
  config,
  screen, // home-screen look & layout (see the header comment)
  toolbar, // the quick controls (App owns their state)
  // live data
  status = "idle",
  activeTask, // a running task {goal}, if any
  telemetry,
  weather,
  netInfo,
  schedule,
  messages = [],
  commands = [],
  onClearCommands,
  recordings = {},
  allowedDirs = [],
  // collapsible data-panel state (controlled by App so JARVIS can toggle them)
  panels = {},
  onTogglePanel,
  // overlays (App owns these so JARVIS can drive them too)
  chatOpen,
  setChatOpen,
  skillsOpen,
  setSkillsOpen,
  capsOpen,
  setCapsOpen,
  powerOpen,
  setPowerOpen,
  memoryOpen,
  setMemoryOpen,
  // memory view
  memory,
  onRemember,
  onForget,
  // handlers
  onSend,
  onStop,
  onReset,
  onUpload,
  runAction,
  onSaveDirs,
  onNotify,
  // conversation history ("Recents")
  conversations = [],
  onNewChat,
  onOpenConversation,
  onDeleteConversation,
  onRefreshConversations,
  onClearConversations,
  // phone: the Status card's sources, and where its rows lead
  sysInfo,
  appControlOn,
  pcConfig,
  pcState,
  tvConfig,
  onOpenSettings,
  onOpenRemote,
  onListen,
  conversationMode,
  onConversationMode,
  activeAgent,
  onPickAgent,
  onToggleAgents,
}) {
  const c = config;
  const d = telemetry || DEFAULT_TELEMETRY;
  const closeMemory = useCallback(() => setMemoryOpen(false), [setMemoryOpen]);
  const mainRef = useRef(null);
  // A Capabilities example on its way into the chat box. `n` makes tapping the same
  // example twice count as a new prefill.
  const [prefill, setPrefill] = useState(null);
  const tryExample = useCallback(
    (text) => {
      setPrefill((prev) => ({ text, n: (prev?.n ?? 0) + 1 }));
      setCapsOpen(false);
      setChatOpen(true);
    },
    [setCapsOpen, setChatOpen],
  );

  // Unread = a turn ran while the chat was closed (usually a spoken one) and its
  // reply is in. Keyed on the turn, not the message count: the restored
  // conversation and the launch greeting both arrive after mount and aren't news.
  const [missed, setMissed] = useState(false);
  if (chatOpen && missed) setMissed(false);
  if (!chatOpen && !missed && (status === "thinking" || status === "working")) setMissed(true);
  const unread =
    missed && status !== "thinking" && messages[messages.length - 1]?.role === "jarvis";

  const p = (k, def = true) => (panels[k] === undefined ? def : panels[k]);
  const tog = (k) => (v) => onTogglePanel && onTogglePanel(k, v);

  // Screen config: the look, then the layout (visibility + order + density).
  const sc = screen || {};
  const vis = sc.panels || {};
  const order = sc.order || {
    left: ["system", "power", "agenda"],
    right: ["weather", "network", "terminal"],
  };
  const background = sc.background || "grid";
  const density = sc.density || "normal";
  const hudCards = sc.cards === "hud";
  const reactor = sc.core === "reactor";
  const Core = reactor ? Reactor : Orb;
  const rings = sc.gauges === "rings";
  const agentMode = Boolean(sysInfo?.agent_mode);
  const lookStyle = {
    "--ac": c.accent,
    "--ac2": c.accent2,
    "--h-r": `${sc.corners ?? 14}px`,
    "--glow": (sc.glow ?? 40) / 100,
    // the store only keeps a base64 image data: URL, so it can't break out of url("")
    ...(background === "image" && sc.image ? { "--bg-img": `url("${sc.image}")` } : {}),
  };
  const shown = (key) => vis[key] !== false;

  const CARDS = {
    system: (
      <SystemWidget
        key="system"
        d={d}
        live={!!telemetry}
        open={p("system")}
        onToggle={tog("system")}
        rings={rings}
      />
    ),
    power: (
      <PowerWidget key="power" d={d} open={p("power")} onToggle={tog("power")} rings={rings} />
    ),
    agenda: (
      <AgendaWidget
        key="agenda"
        items={schedule}
        open={p("agenda")}
        onToggle={tog("agenda")}
        runAction={runAction}
      />
    ),
    weather: (
      <WeatherWidget
        key="weather"
        weather={weather}
        open={p("weather")}
        onToggle={tog("weather")}
      />
    ),
    network: (
      <NetworkWidget
        key="network"
        d={d}
        live={!!telemetry}
        netInfo={netInfo}
        open={p("network")}
        onToggle={tog("network")}
      />
    ),
    terminal: (
      <LogWidget
        key="terminal"
        commands={commands}
        onClear={onClearCommands}
        open={p("terminal", false)}
        onToggle={tog("terminal")}
      />
    ),
  };
  const column = (side) =>
    (order[side] || [])
      .filter(shown)
      .map((k) => CARDS[k])
      .filter(Boolean);

  // A task from the PC or the operator runs without a turn of its own, so the status
  // can be idle while it works: the running task still says what JARVIS is doing.
  const shownStatus = status === "idle" && activeTask ? "working" : status;
  const [title, orbHint] = STATUS_TEXT[shownStatus] || STATUS_TEXT.idle;
  const wakeOff = IS_MOBILE && shownStatus === "idle" && sysInfo?.wake_word === false;
  const hint = (wakeOff ? "Tap the orb to talk." : orbHint).replace(
    "the orb",
    reactor ? "the reactor" : "the orb",
  );
  const busy = shownStatus !== "idle" && shownStatus !== "listening";
  const lastReplyAt = messages.map((m) => m.role === "jarvis").lastIndexOf(true);
  const lastReply = lastReplyAt >= 0 ? messages[lastReplyAt] : null;
  const lastAsk = messages
    .slice(0, lastReplyAt >= 0 ? lastReplyAt : messages.length)
    .reverse()
    .find((m) => m.role === "user");
  const replyText = lastReply ? plain(lastReply.text) : "";
  const replyExtras = lastReply?.actions?.length || 0;
  const openNav = {
    chat: [chatOpen, () => setChatOpen(true)],
    memory: [memoryOpen, () => setMemoryOpen(true)],
    skills: [skillsOpen, () => setSkillsOpen(true)],
    caps: [capsOpen, () => setCapsOpen(true)],
  };
  const ask = (t) => {
    onSend(t);
    mainRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div
      className={`hud home home--bg-${background} home--${density} home--font-${sc.font || "clean"} home--cards-${sc.cards || "clean"}${IS_MOBILE ? " home--phone" : ""}`}
      style={lookStyle}
    >
      <div className="home-bg" aria-hidden="true" />
      {hudCards && <div className="im-frame" aria-hidden="true" />}

      <header className="home-top">
        <div className="home-brand">
          <span className="home-logo" aria-hidden />
          <span className="home-name">JARVIS</span>
          {!IS_MOBILE && (
            <button
              type="button"
              className={`home-conn home-conn--btn${agentMode ? " is-on" : ""}`}
              onClick={onToggleAgents}
              aria-pressed={agentMode}
              title={
                agentMode
                  ? "Agent mode: each request goes to a specialist agent."
                  : "Simple mode. Click for agent mode."
              }
            >
              Agents
            </button>
          )}
        </div>
        {!IS_MOBILE && (
          <nav className="home-nav" aria-label="Menus">
            {NAV.map((n) => (
              <button
                key={n.id}
                className={`home-nav-btn${openNav[n.id][0] ? " is-on" : ""}`}
                onClick={openNav[n.id][1]}
                title={n.label}
              >
                <Icon name={n.icon} size={16} />
                <span>{n.label}</span>
              </button>
            ))}
          </nav>
        )}
        <div className="home-tools">{toolbar}</div>
      </header>

      <main className="home-main" ref={mainRef}>
        <aside className="home-col home-col--left" aria-label="Cards">
          {IS_MOBILE && (
            <ReadinessWidget
              sysInfo={sysInfo}
              appControlOn={appControlOn}
              pcConfig={pcConfig}
              pcState={pcState}
              tvConfig={tvConfig}
              onOpenSettings={onOpenSettings}
              onOpenRemote={onOpenRemote}
              onOpenAppControl={() => runAction({ type: "open_a11y_settings" })}
            />
          )}
          {IS_MOBILE && <RoutinesWidget status={status} runAction={runAction} onSend={onSend} />}
          {column("left")}
        </aside>

        <section className="home-hero" aria-label="JARVIS">
          <HeroClock />
          <Core
            status={shownStatus}
            rgb={c.rgb}
            onClick={busy ? onStop : onListen}
            label={busy ? "Stop" : "Talk to JARVIS"}
          />
          <div className="hero-status" role="status">
            {hudCards && <Waveform status={shownStatus} />}
            <div className={`hero-title hero-title--${shownStatus}`}>
              <span className="hero-dot" />
              {title}
            </div>
            <div className="hero-hint">
              {shownStatus === "working" && activeTask?.goal ? activeTask.goal : hint}
            </div>
          </div>

          {lastReply && (
            <button type="button" className="hero-reply" onClick={() => setChatOpen(true)}>
              {lastAsk && <span className="hero-reply-q">{plain(lastAsk.text)}</span>}
              <span className="hero-reply-a">
                {replyText ||
                  (lastReply.streaming
                    ? "…"
                    : replyExtras
                      ? "Done — see the result in the chat."
                      : "…")}
              </span>
              <span className="hero-reply-more">
                {replyExtras > 0 && `${replyExtras} result${replyExtras === 1 ? "" : "s"} · `}Open
                conversation
                <Icon name="arrowRight" size={13} />
              </span>
            </button>
          )}

          {agentMode && (
            <AgentRow
              active={activeAgent}
              pcPaired={Boolean(pcConfig?.host)}
              onPick={onPickAgent}
            />
          )}
          <AskBar
            onSend={ask}
            onListen={onListen}
            status={status}
            placeholder={
              agentMode && activeAgent !== "auto"
                ? `Ask the ${agentById(activeAgent).name} agent…`
                : "Ask JARVIS anything…"
            }
          />

          {!messages.some((m) => m.role === "user") && (
            <div className="hero-starters">
              {STARTERS.map((s) => (
                <button key={s} className="hero-starter" onClick={() => ask(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}
          {hudCards && (
            <div className="im-tag" aria-hidden="true">
              Just A Rather Very Intelligent System
            </div>
          )}
        </section>

        <aside className="home-col home-col--right" aria-label="More cards">
          {column("right")}
        </aside>
      </main>

      {IS_MOBILE && (
        <nav className="home-tabs" aria-label="Menus">
          {NAV.slice(0, 2).map((n) => (
            <TabButton key={n.id} n={n} on={openNav[n.id]} badge={n.id === "chat" && unread} />
          ))}
          <button
            type="button"
            className={`home-tab-mic home-tab-mic--${shownStatus}`}
            onClick={busy ? onStop : onListen}
            aria-label={status === "listening" ? "Stop and send" : busy ? "Stop" : "Tap to talk"}
          >
            <Icon
              name={status === "listening" || busy ? "stop" : "mic"}
              size={24}
              strokeWidth={1.8}
            />
          </button>
          {NAV.slice(2).map((n) => (
            <TabButton key={n.id} n={n} on={openNav[n.id]} />
          ))}
        </nav>
      )}

      {/* ── overlays ── */}
      <SkillsOverlay
        open={skillsOpen}
        onClose={() => setSkillsOpen(false)}
        recordings={recordings}
        runAction={runAction}
        allowedDirs={allowedDirs}
        onSaveDirs={onSaveDirs}
      />
      <CapabilitiesOverlay open={capsOpen} onClose={() => setCapsOpen(false)} onTry={tryExample} />
      <PowerOverlay
        open={powerOpen}
        onClose={() => setPowerOpen(false)}
        runAction={runAction}
        d={d}
        appControlOn={appControlOn}
      />
      <MemoryOverlay
        open={memoryOpen}
        onClose={closeMemory}
        memory={memory}
        currentCount={messages.length}
        onRemember={onRemember}
        onForget={onForget}
        onOpenChat={() => {
          closeMemory();
          setChatOpen(true);
        }}
        onOpenConversation={(id) => {
          onOpenConversation(id);
          closeMemory();
          setChatOpen(true);
        }}
      />
      <ChatOverlay
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        status={status}
        messages={messages}
        onSend={onSend}
        onStop={onStop}
        onReset={onReset}
        onUpload={onUpload}
        runAction={runAction}
        onNotify={onNotify}
        conversations={conversations}
        onNewChat={onNewChat}
        onOpenConversation={onOpenConversation}
        onDeleteConversation={onDeleteConversation}
        onRefreshConversations={onRefreshConversations}
        onClearConversations={onClearConversations}
        prefill={prefill}
        onListen={onListen}
        conversationMode={conversationMode}
        onConversationMode={onConversationMode}
        agentMode={agentMode}
        activeAgent={activeAgent}
        pcPaired={Boolean(pcConfig?.host)}
        onPickAgent={onPickAgent}
        onToggleAgents={onToggleAgents}
      />
    </div>
  );
}

function TabButton({ n, on: [isOn, open], badge }) {
  return (
    <button
      type="button"
      className={`home-tab${isOn ? " is-on" : ""}`}
      onClick={open}
      aria-label={badge ? `${n.label}, new reply` : n.label}
    >
      <Icon name={n.icon} size={19} />
      <span>{n.label}</span>
      {badge && <span className="home-tab-badge" aria-hidden="true" />}
    </button>
  );
}
