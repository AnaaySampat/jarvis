/* HudApp.jsx — assembles the full HUD as two collapsible rails around the
   central reactor core, plus a bottom dock that opens the Skills / Capabilities
   / Power / OCR / Conversation panels. Data panels collapse to free space; App
   owns the open/collapse state so JARVIS can drive it all by voice. */

import { useState, useCallback } from "react";
import { IS_MOBILE } from "../hooks/useAssistant";
import "./hud.css";
import "./layouts.css";
import "./hud-mobile.css"; // ANDROID FORK: phone reflow (scoped to .hud-viewport--mobile)
import { ReactorCore, BootSequence } from "./HudCore";
import { STATUS_META, DEFAULT_TELEMETRY } from "./hudConstants";
import {
  ClockPanel,
  StatusPanel,
  ReadinessPanel,
  RoutinesPanel,
  SysStatsPanel,
  PowerPanel,
  WeatherPanel,
  NetworkPanel,
  SchedulePanel,
  TerminalPanel,
  DockBar,
  SkillsOverlay,
  CapabilitiesOverlay,
  PowerOverlay,
  MemoryOverlay,
  ChatOverlay,
} from "./HudPanels";

export function JarvisHUD({
  config,
  screen, // home-screen look & layout (accent/bg/density/panels/order)
  // live data
  status = "idle",
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
  // conversation history ("Recents")
  conversations = [],
  onNewChat,
  onOpenConversation,
  onDeleteConversation,
  onRefreshConversations,
  onClearConversations,
  // phone: the Status panel's sources, and where its rows lead
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
  const [isBoot, setIsBoot] = useState(true);
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
  const endBoot = useCallback(() => setIsBoot(false), []); // stable: BootSequence's timer depends on it

  // Unread = a turn ran while the chat was closed (usually a spoken one) and its
  // reply is in. Keyed on the turn, not the message count: the restored
  // conversation and the launch greeting both arrive after mount and aren't news.
  const [missed, setMissed] = useState(false);
  if (chatOpen && missed) setMissed(false);
  if (!chatOpen && !missed && (status === "thinking" || status === "working")) setMissed(true);
  const unread =
    missed && status !== "thinking" && messages[messages.length - 1]?.role === "jarvis";

  // The idle hint can't tell you to say "Hey Jarvis" when the wake word is off.
  const meta = STATUS_META[status] ?? STATUS_META.idle;
  const statusLabel =
    IS_MOBILE && status === "idle" && sysInfo?.wake_word === false
      ? "STANDBY — tap the mic"
      : meta.label;
  const p = (k, def = true) => (panels[k] === undefined ? def : panels[k]);
  const tog = (k) => (v) => onTogglePanel && onTogglePanel(k, v);

  // Screen layout config (visibility + per-rail order + background/density).
  const sc = screen || {};
  const vis = sc.panels || {};
  const order = sc.order || {
    left: ["system", "power", "agenda"],
    right: ["weather", "network", "terminal"],
  };
  const background = sc.background || "grid";
  const density = sc.density || "normal";
  const shown = (key) => vis[key] !== false;

  // name → the panel element (so rails can be rebuilt from `order` in any arrangement).
  const PANELS = {
    system: (
      <SysStatsPanel key="system" d={d} collapsible open={p("system")} onToggle={tog("system")} />
    ),
    power: <PowerPanel key="power" d={d} collapsible open={p("power")} onToggle={tog("power")} />,
    agenda: (
      <SchedulePanel
        key="agenda"
        items={schedule}
        collapsible
        open={p("agenda")}
        onToggle={tog("agenda")}
        runAction={runAction}
      />
    ),
    weather: (
      <WeatherPanel
        key="weather"
        weather={weather}
        collapsible
        open={p("weather")}
        onToggle={tog("weather")}
      />
    ),
    network: (
      <NetworkPanel
        key="network"
        d={d}
        netInfo={netInfo}
        collapsible
        open={p("network")}
        onToggle={tog("network")}
      />
    ),
    terminal: (
      <TerminalPanel
        key="terminal"
        commands={commands}
        onClear={onClearCommands}
        open={p("terminal", false)}
        onToggle={tog("terminal")}
      />
    ),
  };
  const railPanels = (rail) =>
    (order[rail] || [])
      .filter(shown)
      .map((k) => PANELS[k])
      .filter(Boolean);

  return (
    <div
      className={`hud ${c.layout} hud--bg-${background} hud--density-${density}`}
      style={{ "--ac": c.accent, "--ac2": c.accent2 }}
    >
      {/* ambient bg layers */}
      <div className="hud-bg" />
      <div className="hud-grid-bg" />
      <div className="hud-scanline" />

      {/* frame corners + edge ticks */}
      <div className="hud-frame" aria-hidden="true">
        <span className="fc tl" />
        <span className="fc tr" />
        <span className="fc bl" />
        <span className="fc br" />
        <span className="edge-label el-t">J.A.R.V.I.S DISPLAY SYSTEM · {c.name}</span>
        <span className="edge-label el-b">JUST A RATHER VERY INTELLIGENT SYSTEM · v3.0</span>
      </div>

      {/* central core */}
      <div className="hud-core-zone" data-slot="core">
        <ReactorCore status={status} size={IS_MOBILE ? 232 : 482} rgb={c.rgb} />
        <div className="core-readout">
          {/* The assistant's name, not the theme's ("REACTOR CORE" read as its name). */}
          <span className="core-name">JARVIS</span>
          <span className="core-sub">{statusLabel}</span>
        </div>
      </div>

      {/* ── left rail: clock + the panels assigned to the left (user/JARVIS arrangeable) ── */}
      <div className="hud-rail hud-rail--left">
        <ClockPanel rgb={c.rgb} />
        {IS_MOBILE && (
          <ReadinessPanel
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
        {IS_MOBILE && <RoutinesPanel status={status} runAction={runAction} onSend={onSend} />}
        {railPanels("left")}
      </div>

      {/* ── right rail: status + the panels assigned to the right ──
          (the phone shows status under the core and in the top bar already) */}
      <div className="hud-rail hud-rail--right">
        {!IS_MOBILE && <StatusPanel status={status} rgb={c.rgb} />}
        {railPanels("right")}
      </div>

      {/* ── bottom dock ── */}
      <DockBar
        onOpenSkills={() => setSkillsOpen(true)}
        onOpenCaps={() => setCapsOpen(true)}
        onOpenPower={() => setPowerOpen(true)}
        onOpenMemory={() => setMemoryOpen(true)}
        onOpenChat={() => setChatOpen(true)}
        unread={unread}
      />

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
        agentMode={Boolean(sysInfo?.agent_mode)}
        activeAgent={activeAgent}
        pcPaired={Boolean(pcConfig?.host)}
        onPickAgent={onPickAgent}
        onToggleAgents={onToggleAgents}
      />

      {/* boot overlay */}
      {isBoot && <BootSequence name="JARVIS" onDone={endBoot} />}
    </div>
  );
}
