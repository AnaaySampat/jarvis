import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useAssistant, IS_MOBILE } from "./hooks/useAssistant";
import ViewportScale from "./hud/ViewportScale";
import { JarvisHUD } from "./hud/HudApp";
import { DEFAULT_DIRECTION } from "./hud/hudConstants";
import Settings from "./components/Settings";
import Onboarding from "./components/Onboarding";
import MobileOnboarding from "./components/MobileOnboarding";
import MobileRemotePC from "./components/MobileRemotePC";
import RemoteDesktop from "./components/RemoteDesktop";
import SetupProgress from "./components/SetupProgress";
import BootOverlay from "./components/BootOverlay";
import Customize from "./components/Customize";
import AgentActivity from "./components/AgentActivity";
import { syncBrowserPanel } from "./components/browserPanelWindow";
import { syncControlOverlay } from "./components/controlOverlayWindow";
import Icon from "./components/Icon";

// Section name (as JARVIS says it) → panels-state key. Module-scope constant —
// it never changes, so there's no reason to rebuild it on every render.
const SECTION_KEY = {
  system: "system",
  power_panel: "power",
  weather: "weather",
  network: "network",
  agenda: "agenda",
  schedule: "agenda",
  terminal: "terminal",
};

const TASK_ACTIVE_STATES = new Set([
  "accepted",
  "queued",
  "recovering",
  "planning",
  "policy_check",
  "executing",
  "verifying",
  "running",
  "cancelling",
]);

// Mid-task clarify dialog: the autopilot hit genuine ambiguity and asked ONE
// question. Holds its own input state so typing doesn't re-render the whole app.
function ClarifyPrompt({ request, onRespond }) {
  const [answer, setAnswer] = useState(""); // fresh per question: the caller keys on its id
  if (!request) return null;
  const submit = () => onRespond(request.id, answer.trim(), request.taskId);
  return (
    <div className="perm-overlay">
      <div className="perm-dialog" role="alertdialog" aria-label="JARVIS needs your input">
        <div className="perm-icon">
          <Icon name="help" size={26} />
        </div>
        <div className="perm-kicker">JARVIS NEEDS YOUR INPUT</div>
        <div className="perm-desc">{request.question}</div>
        <input
          className="clarify-input"
          autoFocus
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && answer.trim()) submit();
          }}
          placeholder="Type your answer…"
        />
        <div className="perm-actions">
          <button className="perm-deny" onClick={() => onRespond(request.id, "", request.taskId)}>
            SKIP
          </button>
          <button className="perm-approve" disabled={!answer.trim()} onClick={submit}>
            SEND
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const {
    status,
    messages,
    warnings,
    sysInfo,
    isConnected,
    telemetry,
    netInfo,
    weather,
    schedule,
    uiCommand,
    permissionRequest,
    clarifyRequest,
    phoneApproval,
    resolvePhoneApproval,
    muted,
    commands,
    clearCommands,
    recordings,
    browserState,
    controlState,
    screen,
    conversationMode,
    overlay,
    agentTasks,
    taskCenterTasks,
    taskCenterActive,
    conversations,
    memory,
    listMemory,
    rememberFact,
    forgetMemory,
    setupProgress,
    dismissWarning,
    clearAgentTasks,
    sendConfig,
    refreshModels,
    rerankModels,
    repairSetup,
    sendMessage,
    resetConversation,
    newConversation,
    openConversation,
    deleteConversation,
    listConversations,
    clearConversations,
    sendLocation,
    sendManualLocation,
    triggerListen,
    stopSpeech,
    stopControl,
    finishListen,
    pttStart,
    respondPermission,
    respondClarify,
    setMute,
    runAction,
    setBrowserOpen,
    sendUpload,
    sendScreen,
    setConversationModeOn,
    wsSend,
    pcConfig,
    pcState,
    pairPC,
    unpairPC,
    setPcCommandMode,
    screenState,
    screenDetail,
    screenStream,
    controlArmed,
    controlSecondsLeft,
    startScreen,
    stopScreen,
    armControl,
    disarmControl,
    sendRemoteInput,
    phoneTaskActive,
    stopPhoneTask,
    stopTask,
    stopAllTasks,
  } = useAssistant();

  const unifiedTasks = taskCenterTasks || agentTasks || [];
  const anyTaskActive =
    taskCenterActive ?? unifiedTasks.some((task) => TASK_ACTIVE_STATES.has(task.status));

  // App owns the overlay state so JARVIS can drive them via ui_action too.
  const [chatOpen, setChatOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [capsOpen, setCapsOpen] = useState(false);
  const [powerOpen, setPowerOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [remoteOpen, setRemoteOpen] = useState(false); // Remote-PC pairing (mobile)
  const [screenOpen, setScreenOpen] = useState(false); // Remote-desktop live view (mobile)

  // Effective HUD config: the base preset recolored by the user/JARVIS screen
  // settings. Memoized so it keeps a stable identity across the many re-renders
  // driven by the websocket hot path (telemetry ~1.5s, stream_delta many/sec) —
  // otherwise a fresh object every render cascades new props through the whole
  // HUD tree and defeats any child memoization.
  const hudConfig = useMemo(
    () => ({
      ...DEFAULT_DIRECTION,
      accent: screen?.accent || DEFAULT_DIRECTION.accent,
      accent2: screen?.accent2 || DEFAULT_DIRECTION.accent2,
      rgb: screen?.rgb || DEFAULT_DIRECTION.rgb,
    }),
    [screen?.accent, screen?.accent2, screen?.rgb],
  );

  // ── Publish the accent to :root so it drives the WHOLE app ──────────────────
  // The accent was only ever applied as an inline style on `.hud`, so it coloured
  // the HUD subtree and nothing else. The fixed top bar, the mic FAB and every
  // modal are siblings of <ViewportScale>, not descendants of `.hud` — they read
  // index.css's own `--accent`, a hardcoded cyan literal. Picking "amber" recoloured
  // the panels and left the entire chrome cyan.
  //
  // Setting the variables on documentElement makes one source of truth for both
  // trees: `.hud`'s inline style still wins inside the HUD (same value), and
  // everything else finally inherits. --border/--border-soft/--accent-dim are
  // derived from --accent in the stylesheet, so they follow without listing here.
  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty("--ac", hudConfig.accent);
    root.setProperty("--ac2", hudConfig.accent2);
    root.setProperty("--accent", hudConfig.accent);
    root.setProperty("--accent-soft", hudConfig.accent2);
  }, [hudConfig.accent, hudConfig.accent2]);

  // Collapsible data panels — expanded by default; terminal starts collapsed.
  const [panels, setPanels] = useState({
    system: true,
    power: true,
    weather: true,
    network: true,
    agenda: true,
    terminal: false,
  });
  const togglePanel = useCallback(
    (key, val) => setPanels((p) => ({ ...p, [key]: val === undefined ? !p[key] : val })),
    [],
  );

  // Mobile shell classes: safe-area viewport + scroll lock while overlays are open.
  useEffect(() => {
    if (!IS_MOBILE) return undefined;
    document.documentElement.classList.add("app-mobile");
    return () => document.documentElement.classList.remove("app-mobile");
  }, []);

  const hudOverlayOpen = chatOpen || skillsOpen || capsOpen || powerOpen || memoryOpen;

  // Memory view: pull a fresh snapshot on open, and again as the chat moves while
  // it's open (a spoken "remember…"/"forget…" changes what it shows).
  useEffect(() => {
    if (memoryOpen) listMemory?.();
  }, [memoryOpen, messages.length, listMemory]);
  useEffect(() => {
    if (!IS_MOBILE) return undefined;
    document.documentElement.classList.toggle("app-mobile--overlay-open", hudOverlayOpen);
    return () => document.documentElement.classList.remove("app-mobile--overlay-open");
  }, [hudOverlayOpen]);

  // Save the read-only-terminal directory allowlist (Skills panel + Settings).
  const saveDirs = useCallback((dirs) => sendConfig({ allowed_dirs: dirs }), [sendConfig]);

  // ── Precise location for accurate weather + distances (browser GPS → backend) ─
  // enableHighAccuracy:true asks Windows for WiFi-based positioning (~tens–hundreds
  // of metres) instead of coarse IP geolocation, which was 2–3 km off. maximumAge:0
  // forces a fresh fix (not a stale cached one); we keep the MOST accurate reading
  // and let watchPosition refine it for ~30 s (the first fix is often coarse and
  // tightens as more readings arrive), then stop the sensor.
  const coordsRef = useRef(null);
  useEffect(() => {
    if (!IS_MOBILE || !navigator.geolocation) return;
    let best = null;
    const opts = { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 };
    const onPos = (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      if (!best || accuracy < best.accuracy) {
        // keep the tightest fix seen
        best = { lat: latitude, lon: longitude, accuracy };
        coordsRef.current = best;
        sendLocation(best.lat, best.lon, accuracy);
      }
    };
    navigator.geolocation.getCurrentPosition(onPos, () => {}, opts);
    const watchId = navigator.geolocation.watchPosition(onPos, () => {}, opts);
    const stop = setTimeout(() => navigator.geolocation.clearWatch(watchId), 30000);
    return () => {
      navigator.geolocation.clearWatch(watchId);
      clearTimeout(stop);
    };
  }, [sendLocation]);

  // ── Global Ctrl+Space (registered in Rust) → push-to-talk ───────────────────
  // Hold to talk: pressing emits "ptt-start" (begin recording, ignore silence),
  // releasing emits "ptt-stop" (finish + transcribe what was said). Works even
  // when JARVIS is in the background. "trigger-listen" is kept as a back-compat
  // single-shot (tap-to-listen) in case an older binary emits it.
  useEffect(() => {
    const unlisteners = [];
    let disposed = false;
    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisteners.push(await listen("ptt-start", () => pttStart()));
        unlisteners.push(await listen("ptt-stop", () => finishListen()));
        unlisteners.push(await listen("trigger-listen", () => triggerListen()));
        if (disposed) unlisteners.forEach((u) => u && u());
      } catch {
        /* browser dev preview — no Tauri runtime */
      }
    })();
    return () => {
      disposed = true;
      unlisteners.forEach((u) => u && u());
    };
  }, [pttStart, finishListen, triggerListen]);

  // ── Bring JARVIS to the front when it needs your approval ───────────────────
  // FALLBACK only: the floating overlay pill now shows the Approve/Deny card
  // wherever the user is, so the main window doesn't need to steal focus. Only
  // when the overlay is disabled in Settings do we surface this window instead
  // (otherwise the prompt would sit unseen behind other apps).
  useEffect(() => {
    if (IS_MOBILE) return; // one Activity on a phone — the dialog shows in-app
    if (!permissionRequest) return;
    if (overlay?.enabled !== false) return; // overlay pill is handling it
    (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        await win.show();
        await win.unminimize();
        await win.setFocus();
      } catch {
        /* browser dev preview — no Tauri runtime */
      }
    })();
  }, [permissionRequest, overlay?.enabled]);

  // ── Browser companion panel (right rail beside Playwright Chromium) ─────────
  // Desktop-only: it positions a secondary Tauri window that doesn't exist on a
  // phone (one Activity), so skip the sync on mobile (it would call Tauri invoke
  // on a non-existent window and throw).
  const browserPanelOpen =
    !!browserState.open ||
    (agentTasks || []).some((t) => t.kind === "browser" && t.status === "running");
  useEffect(() => {
    if (IS_MOBILE) return;
    syncBrowserPanel(browserPanelOpen, wsSend);
  }, [browserPanelOpen, wsSend]);

  // ── "JARVIS CONTROLLING" overlay (shown during desktop computer control) ────
  // Driven from the main window (a hidden window can't reliably show itself).
  // Desktop-only secondary window — skip on mobile.
  const controlOverlayActive =
    !!controlState.armed ||
    (agentTasks || []).some((t) => t.kind === "computer" && t.status === "running");
  useEffect(() => {
    if (IS_MOBILE) return;
    syncControlOverlay(controlOverlayActive);
  }, [controlOverlayActive]);

  // Re-send coords once the socket (re)connects, in case GPS resolved first.
  useEffect(() => {
    if (isConnected && coordsRef.current) {
      sendLocation(coordsRef.current.lat, coordsRef.current.lon);
    }
  }, [isConnected, sendLocation]);

  // ── JARVIS controlling its own interface (ui_action events) ────────────────
  useEffect(() => {
    if (!uiCommand) return;
    const cmd = uiCommand.cmd;
    /* eslint-disable react-hooks/set-state-in-effect -- uiCommand is an EVENT that two
       transports (useBrain on the phone, useWebSocket on desktop) deliver as state, and
       some branches have side effects (listen, stop speech), so it can't be applied
       during render. The real fix is a subscriber callback through both hooks. */
    // Generic expand_/collapse_/toggle_<section>
    const m = /^(expand|collapse|toggle)_(.+)$/.exec(cmd || "");
    if (m) {
      // "minimize/expand ALL the panels" — apply the verb to every panel at once.
      if (m[2] === "all") {
        setPanels((p) =>
          Object.fromEntries(
            Object.keys(p).map((k) => [k, m[1] === "toggle" ? !p[k] : m[1] === "expand"]),
          ),
        );
        return;
      }
      const key = SECTION_KEY[m[2]] || m[2];
      if (m[1] === "expand") togglePanel(key, true);
      else if (m[1] === "collapse") togglePanel(key, false);
      else togglePanel(key);
      // terminal lives in a rail too — toggling its panel is enough
      return;
    }
    switch (cmd) {
      case "open_chat":
      case "open_conversation":
      case "conversation":
        setChatOpen(true);
        break;
      case "close_chat":
        setChatOpen(false);
        break;
      case "open_settings":
      case "settings":
        setShowSettings(true);
        break;
      case "close_settings":
        setShowSettings(false);
        break;
      case "open_skills":
      case "skills":
        setSkillsOpen(true);
        break;
      case "close_skills":
        setSkillsOpen(false);
        break;
      case "open_capabilities":
      case "capabilities":
        setCapsOpen(true);
        break;
      case "close_capabilities":
        setCapsOpen(false);
        break;
      case "open_power":
      case "power_menu":
        setPowerOpen(true);
        break;
      case "close_power":
        setPowerOpen(false);
        break;
      case "open_memory":
      case "memory":
        setMemoryOpen(true);
        break;
      case "close_memory":
        setMemoryOpen(false);
        break;
      case "open_terminal":
      case "terminal":
        togglePanel("terminal", true);
        break;
      case "close_terminal":
        togglePanel("terminal", false);
        break;
      case "open_activity":
      case "activity":
        setActivityOpen(true);
        break;
      case "close_activity":
        setActivityOpen(false);
        break;
      case "open_customize":
      case "customize":
        setCustomizeOpen(true);
        break;
      case "close_customize":
        setCustomizeOpen(false);
        break;
      case "open_remote":
      case "remote":
        setRemoteOpen(true);
        break;
      case "close_remote":
        setRemoteOpen(false);
        break;
      case "listen":
      case "mic":
        triggerListen();
        break;
      case "stop_speaking":
      case "stop":
        stopSpeech();
        break;
      case "mute":
        setMute(true);
        break;
      case "unmute":
        setMute(false);
        break;
      case "conversation_mode_on":
        setConversationModeOn(true);
        break;
      case "conversation_mode_off":
        setConversationModeOn(false);
        break;
      case "clear_chat":
      case "new_conversation":
      case "reset":
        resetConversation();
        break;
      default:
        break;
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [uiCommand?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <ViewportScale>
        <JarvisHUD
          config={hudConfig}
          screen={screen}
          status={status}
          telemetry={telemetry}
          weather={weather}
          netInfo={netInfo}
          schedule={schedule}
          messages={messages}
          commands={commands}
          onClearCommands={clearCommands}
          recordings={recordings}
          isConnected={isConnected}
          allowedDirs={sysInfo.allowed_dirs || []}
          panels={panels}
          onTogglePanel={togglePanel}
          chatOpen={chatOpen}
          setChatOpen={setChatOpen}
          skillsOpen={skillsOpen}
          setSkillsOpen={setSkillsOpen}
          capsOpen={capsOpen}
          setCapsOpen={setCapsOpen}
          powerOpen={powerOpen}
          setPowerOpen={setPowerOpen}
          memoryOpen={memoryOpen}
          setMemoryOpen={setMemoryOpen}
          memory={memory}
          onRemember={rememberFact}
          onForget={forgetMemory}
          onSend={sendMessage}
          onStop={stopSpeech}
          onReset={resetConversation}
          onUpload={sendUpload}
          runAction={runAction}
          onSaveDirs={saveDirs}
          conversations={conversations}
          onNewChat={newConversation}
          onOpenConversation={openConversation}
          onDeleteConversation={deleteConversation}
          onRefreshConversations={listConversations}
          onClearConversations={clearConversations}
        />
      </ViewportScale>

      {/* Fixed controls layered above the scaled stage. Hidden while the chat
          panel is open — they're window-fixed (z 200) and would otherwise draw
          on top of the chat header. */}
      {!chatOpen && !memoryOpen && (
        <div className="hud-fixed-controls">
          {/* Tap-to-cut: stop whatever JARVIS is saying right now (only while speaking) */}
          {status === "speaking" && (
            <button
              className="hud-fixed-btn hud-fixed-btn--silence"
              title="Stop speaking now"
              onClick={stopSpeech}
            >
              <Icon name="stop" />
            </button>
          )}
          {/* Persistent mute toggle: keeps speech off (text still shows) until untoggled */}
          <button
            className={`hud-fixed-btn ${muted ? "hud-fixed-btn--muted" : ""}`}
            title={muted ? "Unmute Jarvis" : "Mute Jarvis (text only)"}
            aria-pressed={muted}
            onClick={() => setMute(!muted)}
          >
            <Icon name={muted ? "volumeOff" : "volume"} />
          </button>
          {/* Natural conversation mode (shorter, chattier replies) */}
          <button
            className={`hud-fixed-btn ${conversationMode ? "hud-fixed-btn--listening" : ""}`}
            title={
              conversationMode
                ? "Conversation mode ON"
                : "Conversation mode (natural, brief replies)"
            }
            aria-pressed={conversationMode}
            onClick={() => setConversationModeOn(!conversationMode)}
          >
            <Icon name="chat" />
          </button>
          {/* Conversation log — always reachable on mobile (dock is far down the scroll) */}
          <button
            className={`hud-fixed-btn ${chatOpen ? "hud-fixed-btn--armed" : ""}`}
            title="Open conversation log"
            aria-pressed={chatOpen}
            onClick={() => setChatOpen(true)}
          >
            <Icon name="terminal" />
          </button>
          {/* JARVIS's own web browser: open / close */}
          {browserState.available && (
            <button
              className={`hud-fixed-btn ${browserState.open ? "hud-fixed-btn--armed" : ""}`}
              title={
                browserState.open
                  ? "JARVIS's browser is open — click to close it"
                  : "Open JARVIS's web browser"
              }
              aria-pressed={browserState.open}
              onClick={() => setBrowserOpen(!browserState.open)}
            >
              <Icon name="globe" />
            </button>
          )}
          {/* Agent Activity — JARVIS's autopilot steps + the screenshots it saw */}
          <button
            className={`hud-fixed-btn ${anyTaskActive ? "hud-fixed-btn--armed" : ""}`}
            title="Task Center — durable progress, recovery, proof, and STOP"
            aria-pressed={activityOpen}
            onClick={() => setActivityOpen(true)}
          >
            <Icon name="activity" />
          </button>
          {/* ANDROID FORK: pair + drive the user's Windows PC from the phone (Phase 3) */}
          {IS_MOBILE && (
            <button
              className={`hud-fixed-btn ${pcState === "online" ? "hud-fixed-btn--armed" : ""}`}
              title={
                pcState === "online"
                  ? "Remote PC — online (tap to manage)"
                  : pcConfig
                    ? `Remote PC — ${pcState}`
                    : "Pair a Windows PC to control it from here"
              }
              aria-pressed={remoteOpen}
              onClick={() => setRemoteOpen(true)}
            >
              <Icon name="monitor" />
            </button>
          )}
          <button
            className="hud-fixed-btn"
            title="Customize the home screen"
            onClick={() => setCustomizeOpen(true)}
          >
            <Icon name="palette" />
          </button>
          <button className="hud-fixed-btn" title="Settings" onClick={() => setShowSettings(true)}>
            <Icon name="settings" />
          </button>
        </div>
      )}

      {/* ANDROID FORK: push-to-talk mic. Tap to start listening, tap again to send.
          Mic → Groq Whisper → brain (see useBrain). */}
      {IS_MOBILE && !hudOverlayOpen && (
        <button
          className={`mobile-mic${status === "listening" ? " mobile-mic--listening" : ""}${
            status === "thinking" || status === "speaking" ? " mobile-mic--busy" : ""
          }`}
          onClick={triggerListen}
          aria-label={status === "listening" ? "Stop and send" : "Tap to talk"}
          title={status === "listening" ? "Listening — tap to send" : "Tap to talk"}
        >
          <Icon name={status === "listening" ? "stop" : "mic"} size={28} strokeWidth={1.8} />
        </button>
      )}

      {(browserState.open || controlState.armed || !isConnected) && !IS_MOBILE && (
        <div className="hud-top-stack" role="status">
          {controlState.armed && (
            <div className="hud-armed-banner hud-armed-banner--control">
              <span className="hud-armed-dot" />
              <span>⌨ JARVIS IS CONTROLLING YOUR MOUSE &amp; KEYBOARD</span>
              <button className="hud-armed-disarm hud-armed-disarm--stop" onClick={stopControl}>
                STOP
              </button>
            </div>
          )}
          {browserState.open && (
            <div className="hud-armed-banner">
              <span className="hud-armed-dot" />
              <span>
                BROWSER · {browserState.title || browserState.url || "ready"} · panel on the right
              </span>
              <button className="hud-armed-disarm" onClick={() => setBrowserOpen(false)}>
                CLOSE
              </button>
            </div>
          )}
          {!isConnected && (
            <div className="hud-offline">
              ⚠ CORE OFFLINE — start <code>python main.py</code> in{" "}
              <code>jarvis-studio-backend/</code>
            </div>
          )}
        </div>
      )}

      {/* JARVIS is actively driving the phone's own screen (phone_task) — the
          desktop has an always-visible "controlling" overlay + STOP for this;
          the phone had neither, so a runaway/undesired task had no interrupt.
          Stays up through `status === "speaking"` too, not just the task's own
          running flag — JARVIS keeps talking (reading out what it did) after the
          task itself finishes, and the STOP control disappearing mid-sentence
          left no way to cut that off. */}
      {IS_MOBILE && (anyTaskActive || status === "speaking") && (
        <div className="phone-control-banner">
          <span className="pcb-label">
            <Icon
              name={anyTaskActive ? (phoneTaskActive ? "robot" : "monitor") : "volume"}
              size={15}
            />
            {anyTaskActive
              ? phoneTaskActive
                ? "Phone task active"
                : "PC task active"
              : "Speaking"}
          </span>
          <button
            className="pcb-stop"
            onClick={() => {
              if (stopAllTasks) stopAllTasks();
              else stopPhoneTask();
              stopSpeech();
            }}
            aria-label="Stop"
          >
            STOP
          </button>
        </div>
      )}

      {/* Dependency / runtime warnings from the backend */}
      {warnings.length > 0 && (
        <div className="hud-warns">
          {warnings.map((w) => (
            <div key={w.id} className="hud-warn">
              <span>
                <Icon name="alert" size={15} /> {w.text}
              </span>
              <button aria-label="Dismiss" onClick={() => dismissWarning(w.id)}>
                <Icon name="close" size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {showSettings && (
        <Settings
          sysInfo={sysInfo}
          onClose={() => setShowSettings(false)}
          onSave={(cfg) => sendConfig(cfg)}
          onSetLocation={sendManualLocation}
          onRefreshModels={refreshModels}
          onRerankModels={rerankModels}
          onRepairSetup={repairSetup}
        />
      )}

      {customizeOpen && (
        <Customize
          screen={screen}
          onClose={() => setCustomizeOpen(false)}
          onPatch={(patch) => sendScreen(patch)}
        />
      )}

      {activityOpen && (
        <AgentActivity
          tasks={unifiedTasks}
          onClose={() => setActivityOpen(false)}
          onClear={clearAgentTasks}
          onStopTask={stopTask}
          onStopAll={stopAllTasks}
        />
      )}

      {remoteOpen && IS_MOBILE && (
        <MobileRemotePC
          pcConfig={pcConfig}
          pcState={pcState}
          onPair={pairPC}
          onUnpair={unpairPC}
          onViewScreen={() => {
            setRemoteOpen(false);
            setScreenOpen(true);
            void startScreen();
          }}
          onClose={() => setRemoteOpen(false)}
        />
      )}

      {screenOpen && IS_MOBILE && (
        <RemoteDesktop
          hostLabel={pcConfig ? `${pcConfig.host}:${pcConfig.port || 8765}` : ""}
          screenState={screenState}
          screenDetail={screenDetail}
          screenStream={screenStream}
          controlArmed={controlArmed}
          controlSecondsLeft={controlSecondsLeft}
          onArm={armControl}
          onDisarm={disarmControl}
          onInput={sendRemoteInput}
          onStop={stopControl}
          onClose={() => {
            void stopScreen();
            setScreenOpen(false);
          }}
          hudStatus={status}
          onSendMessage={sendMessage}
          onTriggerListen={triggerListen}
          onCommandMode={setPcCommandMode}
        />
      )}

      {/* Booting: shown until the backend WebSocket connects (frozen backend start
          + first-run download). Client-side only, so it shows even if the backend
          is slow or failed to start. */}
      <BootOverlay connected={isConnected} />

      {/* First-run setup: API keys. On a phone there's no Windows storage folder to
          pick, so use the slim mobile key-entry; on desktop, the full Onboarding. */}
      {isConnected &&
        sysInfo.needs_setup &&
        (IS_MOBILE ? (
          <MobileOnboarding sysInfo={sysInfo} onSave={(cfg) => sendConfig(cfg)} />
        ) : (
          <Onboarding sysInfo={sysInfo} onSave={(cfg) => sendConfig(cfg)} />
        ))}

      {/* First-run asset download (Chromium / Whisper / Piper) — desktop only;
          a phone bundles no such runtime assets. */}
      {!IS_MOBILE && isConnected && !sysInfo.needs_setup && (
        <SetupProgress progress={setupProgress} onRepair={repairSetup} />
      )}

      {/* ── Approve/Deny gate for dangerous actions ── */}
      {permissionRequest && (
        <div className="perm-overlay">
          <div className="perm-dialog" role="alertdialog" aria-label="Permission required">
            <div className="perm-icon">
              <Icon name="alert" size={26} />
            </div>
            <div className="perm-kicker">AUTHORISATION REQUIRED</div>
            <div className="perm-desc">
              JARVIS wants to <strong>{permissionRequest.description}</strong>.
            </div>
            {/* The v2 protocol accepts an exact signed approval from the task's
                own source device (aura main.py handle_task_approval), verified
                per-message and gated behind a fresh fingerprint in
                useBrain.respondPermission — so the submitting phone approves
                here. (The old "approve on your PC" notice predated that handler
                and left every consequential remote task stranded: the PC never
                shows a prompt for phone-submitted tasks.) */}
            {
              <>
                <div className="perm-sub">This action needs your explicit approval.</div>
                <div className="perm-actions">
                  <button
                    className="perm-deny"
                    onClick={() => respondPermission(permissionRequest.id, false)}
                  >
                    DENY
                  </button>
                  <button
                    className="perm-approve"
                    onClick={() => respondPermission(permissionRequest.id, true)}
                  >
                    APPROVE
                  </button>
                </div>
              </>
            }
          </div>
        </div>
      )}

      {/* ── On-phone operator: approve one consequential (R2/R3) action ──
          The operator refuses to send/share/pay/delete or to tap raw coordinates
          without an explicit decision. Until this existed it had nothing to ask,
          so every such action was auto-denied and the task stalled. */}
      {phoneApproval && (
        <div className="perm-overlay">
          <div className="perm-dialog" role="alertdialog" aria-label="Action approval required">
            <div className="perm-icon">
              <Icon name={phoneApproval.risk === "R3" ? "shield" : "alert"} size={26} />
            </div>
            <div className="perm-kicker">
              {phoneApproval.risk === "R3" ? "CRITICAL ACTION" : "CONFIRM ACTION"}
            </div>
            <div className="perm-desc">
              JARVIS wants to <strong>{phoneApproval.reason}</strong>.
            </div>
            <div className="perm-sub">
              {phoneApproval.risk === "R3"
                ? "This can move money, change credentials, or delete things. Approve only if you asked for it."
                : "This has an effect outside the phone (sending, sharing, posting or calling)."}
            </div>
            <div className="perm-actions">
              <button className="perm-deny" onClick={() => resolvePhoneApproval("deny")}>
                DENY
              </button>
              <button className="perm-approve" onClick={() => resolvePhoneApproval("allow")}>
                ALLOW ONCE
              </button>
            </div>
            {/* Never offered for R3 — a payment/credential/deletion step re-asks
                every time, however many the task needs. */}
            {phoneApproval.risk === "R2" && (
              <div className="perm-actions">
                <button className="perm-approve" onClick={() => resolvePhoneApproval("allow_task")}>
                  ALLOW FOR THIS TASK
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Mid-task clarify: the autopilot needs one answer to proceed ── */}
      <ClarifyPrompt key={clarifyRequest?.id} request={clarifyRequest} onRespond={respondClarify} />
    </>
  );
}
