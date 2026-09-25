import { useState, useEffect, useCallback, useRef } from "react";
import { reduceAgentEvent } from "./agentActivity";

const RECONNECT_MS = 3000;

async function resolveWsUrl() {
  let token = import.meta.env.VITE_JARVIS_WS_TOKEN || "";
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    token = (await invoke("get_ws_token")) || token;
  } catch {
    // Not running inside Tauri (e.g. Vite-only preview).
  }
  return { url: "ws://127.0.0.1:8765", token };
}
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

// Fold the backend's staged `setup_progress` events (first-run asset download)
// into one UI state: { total, order:[key], items:{key:{label,status,error}}, complete }.
function reduceSetupProgress(prev, data) {
  if (!data || typeof data !== "object") return prev;
  const stage = data.stage;
  // A "snapshot" is the backend replaying cumulative state to a late/reloading HUD
  // (so the setup screen survives the websocket-connect race). Adopt it wholesale.
  if (stage === "snapshot") {
    return {
      total: data.total || (data.order || []).length || 0,
      order: [...(data.order || [])],
      items: { ...(data.items || {}) },
      complete: !!data.complete,
    };
  }
  if (stage === "start") {
    return { total: data.total || 0, order: [], items: {}, complete: false };
  }
  const s =
    prev && !prev.complete
      ? { ...prev, order: [...prev.order], items: { ...prev.items } }
      : { total: data.total || 0, order: [], items: {}, complete: false };
  if (stage === "complete") {
    s.complete = true;
    return s;
  }
  const key = data.asset;
  if (key && (stage === "downloading" || stage === "done" || stage === "error")) {
    if (!s.items[key]) s.order.push(key);
    s.items[key] = { label: data.label || key, status: stage, error: data.error || "" };
  }
  return s;
}

export function useWebSocket() {
  const [status, setStatus] = useState("idle");
  const [messages, setMessages] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [sysInfo, setSysInfo] = useState({
    model_override: "",
    tts: "edge-tts",
    wakeWord: "hey_jarvis",
    ram: null,
    vram: null,
  });
  const [isConnected, setIsConnected] = useState(false);
  const [wakeTriggered, setWakeTriggered] = useState(0); // increments on each wake event
  const [telemetry, setTelemetry] = useState(null); // live CPU/RAM/GPU/disk/net/battery
  const [netInfo, setNetInfo] = useState(null); // local/public IP + location
  const [weather, setWeather] = useState(null); // current conditions + hourly
  const [schedule, setSchedule] = useState(null); // today's agenda items
  const [uiCommand, setUiCommand] = useState(null); // {cmd, nonce} — JARVIS controlling the app
  const [permissionRequest, setPermissionRequest] = useState(null); // {id, kind, description}
  const [clarifyRequest, setClarifyRequest] = useState(null); // {id, question} — autopilot mid-task question
  const [muted, setMutedState] = useState(false); // persistent mute toggle (speech off, text on)
  const [commands, setCommands] = useState([]); // executed-action log for the mini terminal
  const [recordings, setRecordings] = useState({}); // {audio,video,screen} active flags
  const [browserState, setBrowserState] = useState({
    open: false,
    url: "",
    title: "",
    available: false,
    approved: false,
  }); // JARVIS's own web browser
  const [controlState, setControlState] = useState({
    armed: false,
    available: false,
    seconds_left: 0,
    paused: false,
  }); // desktop mouse/keyboard control window
  const [screen, setScreen] = useState(null); // home-screen look & layout (accent/bg/density/panels/order)
  const [alwaysOn, setAlwaysOn] = useState(false); // continuous voice mode (no wake word)
  const [conversationMode, setConversationMode] = useState(false);
  const [activeApp, setActiveApp] = useState(null); // foreground app {app,title,on_jarvis} for the floating pill
  const [overlay, setOverlayState] = useState({ enabled: true, mode: "except", apps: [] }); // floating-pill config
  const [setupProgress, setSetupProgress] = useState(null); // first-run asset download {total, order, items, complete}
  const [agentTasks, setAgentTasks] = useState([]); // autopilot activity feed: steps + screenshots per task
  const [conversations, setConversations] = useState([]); // saved-chat "Recents" metadata [{id,title,ts,count}]

  const wsRef = useRef(null);
  const wsConfigRef = useRef(null);
  const retryTimer = useRef(null);

  // Named so the retry timers below can call it: the const isn't initialised yet
  // inside its own initialiser.
  const connect = useCallback(function openSocket() {
    const cfg = wsConfigRef.current;
    if (!cfg?.url) return;
    try {
      const ws = new WebSocket(cfg.url, cfg.token ? [`aura-token.${cfg.token}`] : undefined);
      wsRef.current = ws;

      ws.onopen = () => {
        if (wsRef.current !== ws) return;
        setIsConnected(true);
        clearTimeout(retryTimer.current);
      };

      ws.onmessage = (ev) => {
        if (wsRef.current !== ws) return;
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }

        switch (msg.event) {
          case "status":
            setStatus(msg.data);
            break;
          case "transcription": {
            // Normal pipeline sends a plain string → one user bubble per turn.
            // Native-audio sends {text, uid} as the live transcript builds, so we
            // UPSERT a single bubble (otherwise every partial — "Can", "Can you",
            // "Can you stop"… — would spawn its own bubble).
            const d = msg.data;
            if (d && typeof d === "object" && d.uid != null) {
              setMessages((prev) =>
                prev.some((m) => m.id === d.uid)
                  ? prev.map((m) => (m.id === d.uid ? { ...m, text: d.text } : m))
                  : [...prev, { role: "user", text: d.text, id: d.uid }],
              );
            } else {
              setMessages((prev) => [
                ...prev,
                { role: "user", text: d, id: Date.now() + Math.random() },
              ]);
            }
            break;
          }
          case "response":
            // Non-streamed reply (startup greeting, proactive alerts).
            setMessages((prev) => [
              ...prev,
              { role: "jarvis", text: msg.data, actions: [], id: Date.now() + Math.random() },
            ]);
            break;
          case "history":
            // Restored conversation from last session. Only apply when the log is
            // still empty so an HMR/StrictMode reconnect can't wipe a live chat.
            if (Array.isArray(msg.data) && msg.data.length === 0) {
              setMessages([]);
            } else if (Array.isArray(msg.data) && msg.data.length) {
              setMessages((prev) =>
                prev.length
                  ? prev
                  : msg.data.map((m, i) => ({
                      role: m.role,
                      text: m.text,
                      actions: [],
                      id: `hist_${i}`,
                    })),
              );
            }
            break;
          case "conversations":
            // The saved-chat "Recents" list (metadata only).
            setConversations(Array.isArray(msg.data) ? msg.data : []);
            break;
          case "conversation_loaded":
            // Reopened an archived chat — replace the visible log unconditionally
            // (unlike "history", which only fills an empty log on reconnect).
            setMessages(
              Array.isArray(msg.data)
                ? msg.data.map((m, i) => ({
                    role: m.role,
                    text: m.text,
                    actions: [],
                    id: `conv_${i}`,
                  }))
                : [],
            );
            break;
          case "stream_start": {
            // Idempotent: the backend stamps a stream id; dedupe so duplicate
            // socket deliveries don't create multiple bubbles.
            const sid = msg.data?.sid;
            setMessages((prev) =>
              prev.some((m) => m.id === sid)
                ? prev
                : [
                    ...prev,
                    {
                      role: "jarvis",
                      text: "",
                      actions: [],
                      streaming: true,
                      finalized: false,
                      id: sid,
                    },
                  ],
            );
            break;
          }
          case "stream_delta": {
            const sid = msg.data?.sid;
            if (sid == null) break;
            // Upsert: if the matching bubble doesn't exist yet (delta delivered
            // before its stream_start, or after a mid-stream reset cleared it),
            // create it instead of dropping the text on the floor.
            setMessages((prev) =>
              prev.some((m) => m.id === sid)
                ? prev.map((m) =>
                    m.id === sid && !m.finalized ? { ...m, text: msg.data.text } : m,
                  )
                : [
                    ...prev,
                    {
                      role: "jarvis",
                      text: msg.data.text,
                      actions: [],
                      streaming: true,
                      finalized: false,
                      id: sid,
                    },
                  ],
            );
            break;
          }
          case "response_end": {
            // Finalize + lock: a late/duplicate stream_delta can't overwrite this.
            // Upsert so the final text + action cards aren't lost if no bubble
            // matches sid (missed/deduped start, reset mid-stream, reordering).
            const sid = msg.data?.sid;
            if (sid == null) break;
            setMessages((prev) =>
              prev.some((m) => m.id === sid)
                ? prev.map((m) =>
                    m.id === sid
                      ? {
                          ...m,
                          text: msg.data.text,
                          actions: msg.data.actions || [],
                          streaming: false,
                          finalized: true,
                        }
                      : m,
                  )
                : [
                    ...prev,
                    {
                      role: "jarvis",
                      text: msg.data.text,
                      actions: msg.data.actions || [],
                      streaming: false,
                      finalized: true,
                      id: sid,
                    },
                  ],
            );
            break;
          }
          case "action":
            // Append action results to the most recent Jarvis message (post-approval).
            setMessages((prev) => {
              const next = [...prev];
              for (let i = next.length - 1; i >= 0; i--) {
                if (next[i].role === "jarvis") {
                  next[i] = { ...next[i], actions: [...(next[i].actions || []), ...msg.data] };
                  break;
                }
              }
              return next;
            });
            break;
          case "warning":
            setWarnings((prev) => [...prev, { text: msg.data, id: Date.now() + Math.random() }]);
            break;
          case "sysinfo":
          case "config":
            // Same payload shape; the backend emits both for legacy reasons.
            setSysInfo((prev) => ({ ...prev, ...msg.data }));
            break;
          case "wake_triggered":
            setWakeTriggered((prev) => prev + 1);
            break;
          case "telemetry":
            setTelemetry(msg.data);
            break;
          case "netinfo":
            setNetInfo(msg.data);
            break;
          case "weather":
            setWeather(msg.data);
            break;
          case "schedule":
            setSchedule(msg.data);
            break;
          case "ui_action":
            setUiCommand({ cmd: msg.data, nonce: Date.now() + Math.random() });
            break;
          case "permission_request":
            setPermissionRequest(msg.data);
            break;
          case "setup_progress":
            setSetupProgress((prev) => reduceSetupProgress(prev, msg.data));
            break;
          case "clarify_request":
            setClarifyRequest(msg.data);
            break;
          case "mute":
            setMutedState(!!msg.data);
            break;
          case "command_log":
            // Append executed actions; keep the most recent 100.
            setCommands((prev) =>
              [...prev, ...(Array.isArray(msg.data) ? msg.data : [msg.data])].slice(-100),
            );
            break;
          case "recordings":
            setRecordings(msg.data || {});
            break;
          case "browser_state":
            setBrowserState(
              msg.data || { open: false, url: "", title: "", available: false, approved: false },
            );
            break;
          case "control_state":
            setControlState(msg.data || { armed: false, available: false, seconds_left: 0 });
            break;
          case "screen":
            if (msg.data) setScreen(msg.data);
            break;
          case "always_on":
            setAlwaysOn(!!msg.data);
            break;
          case "conversation_mode":
            setConversationMode(!!msg.data);
            break;
          case "active_app":
            setActiveApp(msg.data || null);
            break;
          case "overlay":
            if (msg.data) setOverlayState(msg.data);
            break;
          // ── Agent Activity feed (autopilot steps + page screenshots) ──────
          case "agent_task":
          case "agent_step":
          case "agent_shot":
          case "agent_task_end":
            setAgentTasks((prev) => reduceAgentEvent(prev, { event: msg.event, data: msg.data }));
            break;
        }
      };

      ws.onclose = () => {
        // Guard against stale sockets (React StrictMode mounts effects twice)
        if (wsRef.current !== ws) return;
        setIsConnected(false);
        retryTimer.current = setTimeout(openSocket, RECONNECT_MS);
      };

      ws.onerror = () => ws.close();
    } catch {
      retryTimer.current = setTimeout(openSocket, RECONNECT_MS);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      wsConfigRef.current = await resolveWsUrl();
      if (!cancelled) connect();
    })();
    return () => {
      cancelled = true;
      clearTimeout(retryTimer.current);
      const sock = wsRef.current;
      wsRef.current = null;
      sock?.close();
    };
  }, [connect]);

  // The armed control window auto-expires after a bounded time, but the backend
  // only emits control_state on arm/disarm — so without this the "CONTROLLING"
  // banner could linger after the window already lapsed. Clear it locally when
  // its countdown runs out; a fresh arm pushes a new state and resets the timer.
  useEffect(() => {
    if (!controlState.armed || !controlState.seconds_left) return;
    const t = setTimeout(
      () => setControlState((s) => ({ ...s, armed: false, seconds_left: 0 })),
      controlState.seconds_left * 1000,
    );
    return () => clearTimeout(t);
  }, [controlState.armed, controlState.seconds_left]);

  const dismissWarning = useCallback((id) => {
    setWarnings((prev) => prev.filter((w) => w.id !== id));
  }, []);

  const clearAgentTasks = useCallback(() => setAgentTasks([]), []);

  // Single send guard for every outgoing message: serialise + write only when
  // the socket is open. Returns whether the payload was actually sent so callers
  // can couple local state updates to a successful send.
  const wsSend = useCallback((payload) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify(payload));
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }, []);

  const sendConfig = useCallback(
    (cfg) => {
      wsSend({ type: "set_config", data: cfg });
    },
    [wsSend],
  );

  // Ask the backend to re-discover the available models per the active keys
  // (Phase 3). The refreshed list arrives via a sysinfo/config push. Called when
  // the Settings panel opens; cheap (backend skips the network if creds unchanged).
  const refreshModels = useCallback(() => {
    wsSend({ type: "refresh_models" });
  }, [wsSend]);

  // Re-run first-run setup: re-fetch any missing/corrupt runtime asset (Chromium /
  // Whisper / Piper). Driven by the SetupProgress "Retry" button and the Settings
  // "Repair components" action; progress streams back as setup_progress events.
  const repairSetup = useCallback(() => {
    wsSend({ type: "rerun_setup" });
  }, [wsSend]);

  const sendMessage = useCallback(
    (text) => {
      if (wsSend({ type: "text_input", data: text })) {
        setMessages((prev) => [...prev, { role: "user", text, id: Date.now() + Math.random() }]);
      }
    },
    [wsSend],
  );

  // Fire a backend command (quick-action buttons) without echoing a user
  // bubble — the [ACTION] result + Jarvis reply surface on their own.
  const sendCommand = useCallback(
    (text) => {
      wsSend({ type: "text_input", data: text });
    },
    [wsSend],
  );

  const triggerListen = useCallback(() => {
    wsSend({ type: "trigger_listen" });
  }, [wsSend]);

  // End the current listening turn now and transcribe what was captured (overlay
  // ✓ button, and push-to-talk key release). Distinct from stopSpeech, which
  // cancels/drops the turn.
  const finishListen = useCallback(() => {
    wsSend({ type: "finish_listen" });
  }, [wsSend]);

  // Push-to-talk start (Ctrl+Space pressed): records until release (finishListen),
  // ignoring silence so a pause mid-sentence doesn't cut you off.
  const pttStart = useCallback(() => {
    wsSend({ type: "trigger_listen", data: { ptt: true } });
  }, [wsSend]);

  const stopSpeech = useCallback(() => {
    wsSend({ type: "stop_speech" });
  }, [wsSend]);

  // Panic stop for JARVIS's hands: disarm desktop mouse/keyboard control and
  // revoke browser-autopilot consent immediately. Optimistically clears local
  // state; the backend confirms via control_state / browser_state.
  const stopControl = useCallback(() => {
    setControlState({ armed: false, available: true, seconds_left: 0, paused: false });
    wsSend({ type: "stop_control" });
  }, [wsSend]);

  // Pause / resume the running computer-control autopilot loop (the control
  // overlay's Pause button). Optimistically reflects the flag; the backend
  // confirms via a control_state push.
  const pauseControl = useCallback(
    (paused) => {
      setControlState((s) => ({ ...s, paused: !!paused }));
      wsSend({ type: "pause_control", data: { paused: !!paused } });
    },
    [wsSend],
  );

  // Send a live correction to the running computer-control task (the overlay's
  // textbox) — injected into the operator's next step decision.
  const sendCorrection = useCallback(
    (text) => {
      const t = (text || "").trim();
      if (t) wsSend({ type: "agent_correction", data: { text: t } });
    },
    [wsSend],
  );

  // Persistent mute toggle. Optimistically flips local state; the backend
  // confirms via a "mute" event.
  const setMute = useCallback(
    (next) => {
      setMutedState(next);
      wsSend({ type: "set_mute", data: { muted: next } });
    },
    [wsSend],
  );

  const resetConversation = useCallback(() => {
    wsSend({ type: "reset" });
    setMessages([]);
  }, [wsSend]);

  // Save the current chat to Recents and start fresh (vs resetConversation, which
  // discards it). Optimistically clears the visible log.
  const newConversation = useCallback(() => {
    wsSend({ type: "new_conversation" });
    setMessages([]);
  }, [wsSend]);

  // Reopen an archived conversation (the current one is auto-saved to Recents).
  const openConversation = useCallback(
    (id) => {
      wsSend({ type: "open_conversation", data: { id } });
    },
    [wsSend],
  );

  // Permanently remove a conversation from Recents. Optimistic.
  const deleteConversation = useCallback(
    (id) => {
      setConversations((prev) => prev.filter((c) => c.id !== id));
      wsSend({ type: "delete_conversation", data: { id } });
    },
    [wsSend],
  );

  // Re-pull the Recents list (e.g. when the history drawer opens).
  const listConversations = useCallback(() => {
    wsSend({ type: "list_conversations" });
  }, [wsSend]);

  // Wipe the whole Recents archive. Optimistic.
  const clearConversations = useCallback(() => {
    setConversations([]);
    wsSend({ type: "clear_conversations" });
  }, [wsSend]);

  // Approve/Deny a gated dangerous action.
  const respondPermission = useCallback(
    (id, approved) => {
      wsSend({ type: "permission_response", data: { id, approved } });
      setPermissionRequest(null);
    },
    [wsSend],
  );

  // Answer (or skip) an autopilot mid-task clarify question.
  const respondClarify = useCallback(
    (id, answer) => {
      wsSend({ type: "clarify_response", data: { id, answer } });
      setClarifyRequest(null);
    },
    [wsSend],
  );

  // Run an action spec deterministically (Skills/Power buttons), bypassing the
  // LLM. Destructive actions still hit the Approve/Deny gate on the backend.
  const clearCommands = useCallback(() => setCommands([]), []);

  const runAction = useCallback(
    (spec) => {
      wsSend({ type: "run_action", data: { spec } });
    },
    [wsSend],
  );

  // Open or close JARVIS's own web browser from the HUD toggle.
  const setBrowserOpen = useCallback(
    (open) => {
      wsSend({ type: "browser_control", data: { open } });
    },
    [wsSend],
  );

  // Home-screen customization (accent/background/density/panels/order). Sends a
  // patch; the backend persists it and broadcasts the full new config back.
  const sendScreen = useCallback(
    (patch) => {
      wsSend({ type: "set_screen", data: patch });
    },
    [wsSend],
  );

  // Toggle always-on continuous voice mode (no wake word).
  const setAlwaysOnMode = useCallback(
    (on) => {
      wsSend({ type: "set_always_on", data: { on } });
    },
    [wsSend],
  );

  // Toggle natural conversation mode (shorter, chattier replies).
  const setConversationModeOn = useCallback(
    (on) => {
      wsSend({ type: "set_conversation_mode", data: { on } });
    },
    [wsSend],
  );

  // Send precise browser-GPS coordinates (+ accuracy in metres) so weather and
  // distances are accurate to the user.
  const sendLocation = useCallback(
    (lat, lon, accuracy) => {
      wsSend({ type: "set_location", data: { lat, lon, accuracy } });
    },
    [wsSend],
  );

  // Pin a manual location (by place name → backend geocodes it) or clear it.
  // Overrides browser-GPS/IP everywhere (weather, places, distances, autopilot).
  const sendManualLocation = useCallback(
    (data) => {
      wsSend({ type: "set_manual_location", data: data || {} });
    },
    [wsSend],
  );

  // Attach a file in chat: read it as a data URL and send to the backend (images
  // → vision, PDFs/text → extracted + answered). Shows a local "📎 file" bubble.
  const sendUpload = useCallback(
    (file, prompt = "") => {
      if (!file || wsRef.current?.readyState !== WebSocket.OPEN) return;
      if (file.size > MAX_UPLOAD_BYTES) {
        setWarnings((prev) => [
          ...prev,
          {
            text: `Upload too large. Please choose a file under ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`,
            id: Date.now() + Math.random(),
          },
        ]);
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => {
        setWarnings((prev) => [
          ...prev,
          { text: `Couldn't read ${file.name}.`, id: Date.now() + Math.random() },
        ]);
      };
      reader.onload = () => {
        if (wsRef.current?.readyState !== WebSocket.OPEN) return;
        setMessages((prev) => [
          ...prev,
          {
            role: "user",
            text: `📎 ${file.name}${prompt ? " — " + prompt : ""}`,
            id: Date.now() + Math.random(),
          },
        ]);
        wsSend({
          type: "chat_upload",
          data: { name: file.name, mime: file.type, data: reader.result, prompt },
        });
      };
      reader.readAsDataURL(file);
    },
    [wsSend],
  );

  return {
    status,
    messages,
    warnings,
    sysInfo,
    isConnected,
    wakeTriggered,
    telemetry,
    netInfo,
    weather,
    schedule,
    uiCommand,
    permissionRequest,
    clarifyRequest,
    muted,
    commands,
    clearCommands,
    recordings,
    browserState,
    controlState,
    screen,
    alwaysOn,
    conversationMode,
    activeApp,
    overlay,
    agentTasks,
    conversations,
    setupProgress,
    // Remote-PC pairing (Phase 3) is a phone-only feature; inert on desktop, where
    // the HUD already runs ON the PC. Keeps the shared App.jsx destructure safe.
    pcConfig: null,
    pcState: "idle",
    pairPC: () => {},
    unpairPC: () => {},
    dismissWarning,
    clearAgentTasks,
    sendConfig,
    refreshModels,
    repairSetup,
    sendMessage,
    sendCommand,
    triggerListen,
    stopSpeech,
    stopControl,
    pauseControl,
    sendCorrection,
    finishListen,
    pttStart,
    resetConversation,
    newConversation,
    openConversation,
    deleteConversation,
    listConversations,
    clearConversations,
    sendLocation,
    sendManualLocation,
    respondPermission,
    respondClarify,
    setMute,
    runAction,
    setBrowserOpen,
    sendUpload,
    sendScreen,
    setAlwaysOnMode,
    setConversationModeOn,
    wsSend,
  };
}
