/* useBrain — ANDROID FORK
 *
 * The on-device replacement for useWebSocket. On a phone there is no Python backend
 * to talk to over a WebSocket; the assistant "brain" runs in-app (TypeScript). This
 * hook exposes the SAME shape useWebSocket returns, so App.jsx and the whole HUD work
 * unchanged — but sendMessage() routes to the in-app brain instead of a socket.
 *
 * Phase 1 scope: text chat (BYO key → LLM → reply), local config + conversation.
 * Voice (STT/TTS), info-tools, and on-phone control land in later Phase 1/2 steps.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createBrain } from "../brain";
import { resolveBrainConfig } from "../brain/resolveConfig";
import * as quota from "../brain/quota";
import { dispatch } from "../brain/tools/dispatch";
import { androidPlatform } from "../brain/platform";
import { createStore, makeKV, readJson, writeJson } from "../brain/memory/store";
import { LocationService } from "../brain/tools/location";
import { getTodaySchedule, onScheduleChange } from "../brain/schedule/store";
import { loadScreenConfig, patchScreenConfig } from "../brain/mobile/screenConfig";
import { RemotePC } from "../brain/remote/pc";
import { RemoteScreen } from "../brain/remote/webrtcScreen";
import { invoke } from "@tauri-apps/api/core";
import { authenticate, checkStatus } from "@tauri-apps/plugin-biometric";
import { webSpeechTTS } from "../brain/platform/webspeech";
import { MicRecorder, transcribe } from "../brain/platform/stt";
import { syncWakeWord } from "../brain/platform/wakeword";
import { syncStopOverlay } from "../brain/platform/stopOverlay";
import { subscribeTelemetry } from "../brain/platform/deviceTelemetry";
import { resolveAmbientLocation, netInfoFrom, fetchPanelWeather } from "../brain/platform/ambient";
import { discoverModels } from "../brain/providers/models";
import { isDead as isModelDead, refreshCatalog } from "../brain/providers/catalog";
import { listPlaybooks, removePlaybook } from "../brain/memory/proceduralLearning";
import {
  estimateUnknown as estimateUnknownModels,
  subscribe as subscribeRanking,
  summary as rankingSummary,
} from "../brain/modelRanker";
import { agentImageSrc } from "./agentActivity";
import {
  ACTIVE_TASK_STATES,
  TERMINAL_TASK_STATES,
  bindNativeTask,
  clearKnownRemoteTaskCursors,
  loadKnownNativeTaskIds,
  loadKnownRemoteTaskCursors,
  loadRecoveredTaskShells,
  markTaskStopping,
  reduceNativeCheckpoint,
  reduceNativeStatus,
  reduceRemoteTaskEvent,
  reduceRemoteTaskSnapshot,
  reduceTaskCenterAgentEvent,
  rememberNativeTaskId,
  rememberRemoteTaskCursor,
} from "./taskCenter";
import { inTauri } from "../brain/tools/httpClient";
import { createControlLeaseTracker } from "./controlLease";
import {
  CONFIG_SECRET_FIELDS,
  hydrateConfigSecrets,
  loadAndAccumulateLegacyConfig,
  savePublicConfig,
} from "../brain/configSecrets";

// Nothing that parks a task on a promise may park it FOREVER. A prompt can go
// unanswered for reasons that have nothing to do with the user ignoring it — most
// importantly, a phone task drives another app, so an in-app prompt can sit behind
// WhatsApp where nobody can see it. Without a deadline that isn't a slow task, it's
// a permanently wedged one: the operator is stuck inside the await, so it never
// reaches its own STOP check either, and only a force-stop clears it. A timeout
// turns the worst case into a clean, honest refusal.
const PROMPT_TIMEOUT_MS = 90_000;
// Longest a single push-to-talk recording may run before it sends itself. Without
// a ceiling a forgotten second tap leaves listeningRef true, and isBusy() reads it,
// so "Hey Jarvis" goes quietly dead for the rest of the session.
const MAX_LISTEN_MS = 30_000;

const CONFIG_KEY = "jarvis.android.config.v1";
const PC_KEY = "jarvis.android.pc.v1";
const COMMANDS_KEY = "jarvis.android.commands.v1";

const kv = makeKV();
const pendingLegacyConfigSecrets = {};

const nativeConfigSecretBridge = {
  get: (name) => invoke("plugin:phone|config_secret_get", { name }),
  set: (name, value) => invoke("plugin:phone|config_secret_set", { name, value }),
  delete: (name) => invoke("plugin:phone|config_secret_delete", { name }),
};

function loadStored() {
  return loadAndAccumulateLegacyConfig(kv, CONFIG_KEY, pendingLegacyConfigSecrets, {});
}
function saveStored(cfg) {
  savePublicConfig(kv, CONFIG_KEY, cfg);
}

function loadCommands() {
  return readJson(kv, COMMANDS_KEY, []);
}
function saveCommands(list) {
  writeJson(kv, COMMANDS_KEY, list.slice(-80));
}

// Paired-PC records are public routing/identity pins only. This allowlist is also
// a one-way migration boundary: legacy bearer/TURN credentials and unknown fields
// are removed on first read and can never be written back to WebView storage.
export function sanitizePcConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const cleanText = (field, max = 4096) =>
    typeof field === "string" && field.trim() && field.trim().length <= max ? field.trim() : "";
  const cleanHost = (field) => {
    const host = cleanText(field, 253);
    // No whitespace, URL delimiters, backslash or control characters in a host.
    const bad = /[\s/?#@\\]/.test(host) || [...host].some((c) => c.charCodeAt(0) < 0x20);
    return host && !bad ? host : "";
  };
  const host = cleanHost(value.host);
  const hostId = cleanText(value.hostId, 256);
  const hostFingerprint = cleanText(value.hostFingerprint, 512);
  const hostPublicKey = cleanText(value.hostPublicKey, 8192);
  const pairingChallengeId = cleanText(value.pairingChallengeId, 512);
  const deviceName = cleanText(value.deviceName, 120);
  const port =
    value.port === undefined || value.port === null || value.port === ""
      ? 8765
      : Number(value.port);
  if (
    !host ||
    !hostId ||
    !hostFingerprint ||
    !hostPublicKey ||
    !pairingChallengeId ||
    !deviceName ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    return null;
  const result = {
    host,
    port,
    secure: Boolean(value.secure),
    hostId,
    hostFingerprint,
    hostPublicKey,
    pairingChallengeId,
    deviceName,
  };
  const altHost = cleanHost(value.altHost);
  if (altHost && altHost !== host) result.altHost = altHost;
  return result;
}

export function loadPcConfigFromStore(store = kv) {
  const clean = sanitizePcConfig(readJson(store, PC_KEY, null));
  if (!clean) {
    store.remove(PC_KEY);
    return null;
  }
  writeJson(store, PC_KEY, clean);
  return clean;
}

// null when no cryptographically pinned PC is paired.
function loadPcConfig() {
  return loadPcConfigFromStore(kv);
}
function savePcConfig(cfg) {
  if (!cfg) {
    kv.remove(PC_KEY);
    return false;
  }
  const clean = sanitizePcConfig(cfg);
  if (!clean) {
    kv.remove(PC_KEY);
    return false;
  }
  writeJson(kv, PC_KEY, clean);
  return true;
}

// Settings ▸ Models: every chat model the current keys reach, per provider. Read off
// smart routing's ranking, which holds exactly what each keyed provider's own model
// listing returned (non-chat models already dropped) and forgets a provider when its
// key goes. Pooled models that 404'd with this key are left out.
const PICKER_ORDER = ["gemini", "vertex", "groq", "openrouter", "nvidia", "mistral"];
function reachableModels(ranked = []) {
  return PICKER_ORDER.map((provider) => ({
    provider,
    models: ranked
      .filter((m) => m.provider === provider && !isModelDead(provider, m.model))
      .map((m) => m.model),
  })).filter((g) => g.models.length > 0);
}

// Stored keys → BrainConfig (tier follows provider_mode + selected model).
function toBrainConfig(stored) {
  const cfg = resolveBrainConfig(stored);
  return {
    ...cfg,
    conversationMode: Boolean(stored.conversationMode),
    // Absent means on: mirroring is the default, opting out is the deliberate act.
    calendarSync: stored.calendarSync !== false,
    // Same convention — falling back to a working model is the default.
    autoSwitchModels: stored.autoSwitchModels !== false,
  };
}

const uid = () => `${Date.now()}_${Math.floor(performance.now() * 1000) % 100000}`;

// True for a same-LAN address (RFC-1918 private range or loopback). Tailscale's
// 100.64.0.0/10 CGNAT range, public IPs and hostnames all read as "remote" — used to
// pick a lighter WebRTC screen stream off-LAN so it doesn't flicker (see startScreen).
function isPrivateLanHost(host) {
  const h = (host || "").trim().toLowerCase();
  if (h === "localhost" || h.startsWith("127.")) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false; // hostname / IPv6 / non-dotted → treat as remote
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  return false; // includes 100.64/10 (Tailscale) and all public IPs
}

export function useBrain() {
  const [stored, setStored] = useState(loadStored);
  const [secretsReady, setSecretsReady] = useState(() => !inTauri());
  const [status, setStatus] = useState("idle");
  const [messages, setMessages] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [muted, setMutedState] = useState(false);
  const mutedRef = useRef(false); // read inside async sendMessage (state would be stale)
  const [conversations, setConversations] = useState([]);
  const [agentTasks, setAgentTasks] = useState(loadRecoveredTaskShells);
  const [permissionRequest, setPermissionRequest] = useState(null);
  const [clarifyRequest, setClarifyRequest] = useState(null);
  // JARVIS driving its own HUD (control_interface tool). App.jsx watches uiCommand.nonce.
  const [uiCommand, setUiCommand] = useState(null);
  const emitUiCommand = useCallback((cmd) => {
    if (cmd) setUiCommand({ cmd, nonce: uid() });
  }, []);
  const [schedule, setSchedule] = useState(() => getTodaySchedule());
  const [commands, setCommands] = useState(() => loadCommands());
  const [screen, setScreen] = useState(() => loadScreenConfig());
  const [conversationMode, setConversationMode] = useState(() =>
    Boolean(loadStored().conversationMode),
  );

  // Live HUD-panel data the phone can actually source (see brain/platform/*).
  const [telemetry, setTelemetry] = useState(null); // battery / network / RAM
  const [netInfo, setNetInfo] = useState(null); // public IP + city
  const [weather, setWeather] = useState(null); // current + hourly
  // Per-key discovered models for the Settings dropdown (sysInfo.available_models).
  const [availableModels, setAvailableModels] = useState([]);
  // Smart routing's ranking (brain/modelRanker.ts) → sysInfo.routing for Settings.
  const [routing, setRouting] = useState(rankingSummary);
  useEffect(() => subscribeRanking(() => setRouting(rankingSummary())), []);

  const hasKey = secretsReady && Boolean(stored.geminiKey || stored.groqKey || stored.vertexSaJson);

  const memoryRef = useRef(createStore());
  const locationRef = useRef(new LocationService(stored.pinnedLocation || ""));

  const refreshSchedule = useCallback(() => {
    setSchedule(getTodaySchedule());
  }, []);

  // Follow the store rather than the caller. A spoken "add X to my agenda" runs
  // through the brain's tool dispatch, which never touched runAction's refresh —
  // so the write landed but the panel kept showing stale state.
  useEffect(() => onScheduleChange(refreshSchedule), [refreshSchedule]);

  const logCommand = useCallback((spec, result) => {
    const entry = {
      ts: Date.now() / 1000,
      type: spec.type,
      target: spec.target || spec.command || spec.task || "",
      ok: result?.ok !== false,
      message: result?.summary || "",
    };
    setCommands((prev) => {
      const next = [...prev, entry];
      saveCommands(next);
      return next;
    });
  }, []);

  // Terminal ▸ Clear. The log is display-only, so clearing it forgets nothing JARVIS uses.
  const clearCommands = useCallback(() => {
    setCommands([]);
    saveCommands([]);
  }, []);

  // Everything that must happen after ANY action, whoever dispatched it — the HUD's
  // own buttons or the brain's tool loop. Both used to be handled only in runAction,
  // so voice-driven actions never reached the activity log and a spoken HUD restyle
  // persisted without re-rendering. The agenda is deliberately NOT here: its store
  // notifies directly (onScheduleChange), covering writes this hook never sees.
  // Cards produced by tools during the CURRENT turn, drained when the reply lands.
  // brain.ask() returns only a string — runTurn's toolResults are dropped on the
  // floor — so an image the model generated had nowhere to go and the chat showed
  // the caption with no picture. onDispatched is the one hook that sees every tool
  // result, so collect here and attach when the message is built.
  const pendingCardsRef = useRef([]);
  const onDispatched = useCallback(
    (spec, result) => {
      logCommand(spec, result);
      if (spec?.type === "screen" && result?.data) setScreen(result.data);
      const imageUrl = result?.data?.imageUrl;
      if (imageUrl && (spec?.type === "generate_image" || spec?.type === "qr_code")) {
        pendingCardsRef.current.push({
          type: spec.type === "qr_code" ? "qr" : "generate_image",
          message: result.summary || "",
          ok: result.ok !== false,
          image: imageUrl,
        });
      }
    },
    [logCommand],
  );

  /** Take everything collected this turn (and reset for the next one). */
  const drainCards = useCallback(() => {
    const cards = pendingCardsRef.current;
    pendingCardsRef.current = [];
    return cards;
  }, []);

  const pushWarning = useCallback((text) => {
    setWarnings((prev) => [...prev, { text, id: uid() }]);
  }, []);

  // Credentials are hydrated only into React memory. A first launch after upgrade
  // migrates the already-purged legacy values into Android Keystore; React Strict
  // Mode may rerun this effect, so the captured ref is retained until a run settles.
  useEffect(() => {
    let cancelled = false;
    if (!inTauri()) return undefined; // secretsReady already starts true off-device
    const legacyForThisRun = { ...pendingLegacyConfigSecrets };
    void hydrateConfigSecrets(nativeConfigSecretBridge, legacyForThisRun)
      .then(({ secrets, failures }) => {
        const failed = new Set(failures.map(({ name }) => name));
        for (const name of CONFIG_SECRET_FIELDS) {
          if (!failed.has(name)) delete pendingLegacyConfigSecrets[name];
        }
        if (cancelled) return;
        setStored((prev) => ({ ...prev, ...secrets }));
        setSecretsReady(true);
        if (failures.length) {
          pushWarning(
            `Secure credential storage needs attention for: ${failures
              .map(({ name }) => name)
              .join(", ")}.`,
          );
        }
      })
      .catch(() => {
        if (cancelled) return;
        setSecretsReady(true);
        pushWarning("Android secure credential storage is unavailable.");
      });
    return () => {
      cancelled = true;
    };
  }, [pushWarning]);

  // ── Remote PC (Phase 3) ─────────────────────────────────────────────────────
  // A paired Windows PC is reached over a WebSocket to its (unchanged) Python
  // backend. The RemotePC client keeps a live connection; `pc_task` forwards a
  // whole goal to it, and its step events stream into the activity feed above.
  // A running phone_task polls this ref once per step so a HUD STOP button can
  // interrupt it (mirrors the desktop's stop-control path for pc_task, which the
  // on-phone accessibility operator never had). Reset false at the start of every
  // new phone task so a stale "stop" from a previous run can't cancel the next one.
  const phoneTaskStopRef = useRef(false);
  const requestPhoneStop = useCallback(() => {
    phoneTaskStopRef.current = true;
  }, []);

  // ── Consequential-action approval (R2/R3) ───────────────────────────────────
  // The operator classifies each action's risk and refuses to run an R2 (external
  // side effect: send/share/post/call) or R3 (payment, credentials, deletion,
  // security) one without an explicit human decision. Nothing used to supply that
  // decision, so the operator's `: "deny"` default fired every time and those
  // tasks dead-ended. This is the missing half: surface the request, park the
  // task on a promise, resolve it with whatever the user taps.
  const [phoneApproval, setPhoneApproval] = useState(null);
  const phoneApprovalResolveRef = useRef(null);

  const resolvePhoneApproval = useCallback((decision) => {
    const resolve = phoneApprovalResolveRef.current;
    phoneApprovalResolveRef.current = null;
    setPhoneApproval(null);
    // Anything that isn't an explicit allow is a denial — including dismissal.
    if (resolve) resolve(decision === "allow" || decision === "allow_task" ? decision : "deny");
  }, []);

  const authorizePhoneAction = useCallback((request) => {
    // A second request while one is already open would orphan the first task on a
    // promise that never settles. Tasks are single-flight, so this is defensive:
    // deny the newcomer rather than lose the pending one.
    if (phoneApprovalResolveRef.current) return Promise.resolve("deny");
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (phoneApprovalResolveRef.current !== settle) return;
        phoneApprovalResolveRef.current = null;
        setPhoneApproval(null);
        resolve("deny");
      }, PROMPT_TIMEOUT_MS);
      const settle = (decision) => {
        clearTimeout(timer);
        resolve(decision);
      };
      phoneApprovalResolveRef.current = settle;
      setPhoneApproval({
        risk: request.risk,
        action: request.action,
        target: request.target,
        reason: request.reason,
      });
    });
  }, []);

  const onAgentEvent = useCallback((ev) => {
    if (ev.event === "agent_task" && ev.data?.kind === "phone") {
      phoneTaskStopRef.current = false;
    }
    setAgentTasks((prev) => reduceTaskCenterAgentEvent(prev, ev));
  }, []);

  const phoneTaskActive = agentTasks.some(
    (task) => task.kind === "phone" && ACTIVE_TASK_STATES.has(task.status),
  );

  // A task that ends while an approval prompt is still open (STOP, timeout, crash)
  // must not leave the sheet stranded on screen with nothing listening behind it.
  useEffect(() => {
    if (!phoneTaskActive && phoneApprovalResolveRef.current) resolvePhoneApproval("deny");
  }, [phoneTaskActive, resolvePhoneApproval]);
  const taskCenterActive = agentTasks.some((task) => ACTIVE_TASK_STATES.has(task.status));

  // Intercept the native journal boundary inside the hook so the control panel
  // learns the opaque Room id even though the operator's legacy activity id is
  // intentionally separate. All calls still delegate to the same native plugin.
  const journaledPhone = useMemo(() => {
    const native = androidPlatform.phone;
    return {
      ...native,
      beginTask: native.beginTask
        ? async (spec) => {
            const result = await native.beginTask(spec);
            const resolvedTaskId = String(result?.data?.taskId || spec?.taskId || "");
            const durableSpec = { ...spec, taskId: resolvedTaskId };
            rememberNativeTaskId(resolvedTaskId);
            setAgentTasks((prev) => bindNativeTask(prev, durableSpec));
            const nativeState = String(result?.data?.state || "");
            if (result?.ok && ["succeeded", "failed", "cancelled"].includes(nativeState)) {
              setAgentTasks((prev) =>
                reduceNativeStatus(prev, {
                  ok: true,
                  ...result.data,
                  taskId: resolvedTaskId,
                  state: nativeState,
                }),
              );
            }
            if (!result?.ok && resolvedTaskId) {
              setAgentTasks((prev) =>
                reduceNativeStatus(prev, {
                  ok: true,
                  taskId: resolvedTaskId,
                  state: "failed",
                  result: result?.summary || "The native task journal rejected this task.",
                }),
              );
            }
            return result;
          }
        : undefined,
      checkpointTask: native.checkpointTask
        ? async (checkpoint) => {
            const result = await native.checkpointTask(checkpoint);
            if (result?.ok) {
              setAgentTasks((prev) => reduceNativeCheckpoint(prev, checkpoint));
            }
            return result;
          }
        : undefined,
      finishTask: native.finishTask
        ? async (taskId, state, resultText, verificationReceipt = "") => {
            const result = await native.finishTask(taskId, state, resultText, verificationReceipt);
            if (result?.ok) {
              setAgentTasks((prev) =>
                reduceNativeStatus(prev, {
                  ok: true,
                  taskId,
                  state,
                  result: resultText,
                  verified: state === "succeeded",
                  verificationReceipt: state === "succeeded" ? verificationReceipt : "",
                }),
              );
            }
            return result;
          }
        : undefined,
      cancelTask: native.cancelTask
        ? async (taskId) => {
            setAgentTasks((prev) => markTaskStopping(prev, taskId));
            const result = await native.cancelTask(taskId);
            if (result?.ok) {
              setAgentTasks((prev) =>
                reduceNativeStatus(prev, {
                  ok: true,
                  taskId,
                  state: "cancelled",
                  cancelRequested: true,
                  result: result.summary,
                }),
              );
            }
            return result;
          }
        : undefined,
    };
  }, []);

  const taskPlatform = useMemo(
    () => ({ ...androidPlatform, phone: journaledPhone }),
    [journaledPhone],
  );

  // Keep a current snapshot for STOP callbacks and the native-status poll without
  // rebuilding either callback for every streamed step/screenshot.
  const agentTasksRef = useRef(agentTasks);
  useEffect(() => {
    agentTasksRef.current = agentTasks;
  }, [agentTasks]);

  const reconcileNativeTasks = useCallback(async (recovered = false) => {
    if (!inTauri()) return;
    const ids = recovered
      ? loadKnownNativeTaskIds()
      : agentTasksRef.current
          .filter(
            (task) =>
              task.nativeTaskId &&
              (ACTIVE_TASK_STATES.has(task.status) || task.status === "recovering"),
          )
          .map((task) => task.nativeTaskId);
    const uniqueIds = [...new Set(ids)];
    if (!uniqueIds.length) return;
    const statuses = await Promise.all(
      uniqueIds.map(async (taskId) => {
        try {
          return await invoke("plugin:phone|task_status", { taskId });
        } catch {
          return null;
        }
      }),
    );
    setAgentTasks((prev) =>
      statuses.reduce(
        (tasks, taskStatus) =>
          taskStatus ? reduceNativeStatus(tasks, taskStatus, { recovered }) : tasks,
        prev,
      ),
    );
  }, []);

  // Activity/WebView recreation cannot be a state reset. Reconcile every retained
  // opaque id once, then poll only non-terminal tasks while this UI is mounted.
  useEffect(() => {
    let disposed = false;
    void reconcileNativeTasks(true);
    const timer = setInterval(() => {
      if (!disposed) void reconcileNativeTasks(false);
    }, 2500);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [reconcileNativeTasks]);

  const [pcConfig, setPcConfig] = useState(loadPcConfig);
  const [pcState, setPcState] = useState("idle");
  const pcRef = useRef(null);
  // The one-shot pairing PIN. Kept in a ref (never persisted to storage) and fed to
  // the RemotePC below; it's only needed for the first pairing.claim, after which
  // reconnects authenticate with a signed auth.response.
  const pcPinRef = useRef("");
  const pcConfigured = Boolean(pcConfig && pcConfig.host);

  // ── Remote desktop (live WebRTC screen view + direct control) ────────────────
  // The RemoteScreen owns a WebRTC PeerConnection whose signalling rides pcRef's
  // socket. Its inbound answer/ICE events arrive through the pc onEvent stream
  // below and get routed into it. `controlArmed`/`controlSecondsLeft` mirror the
  // desktop's control_state so the UI knows when direct input is permitted.
  const [screenState, setScreenState] = useState("idle"); // idle|connecting|streaming|failed|closed
  const [screenDetail, setScreenDetail] = useState(""); // human-readable connecting sub-stage
  const [screenStream, setScreenStream] = useState(null); // MediaStream or null
  const [controlArmed, setControlArmed] = useState(false);
  const [controlSecondsLeft, setControlSecondsLeft] = useState(0);
  const remoteScreenRef = useRef(null);
  const controlLeaseRef = useRef(createControlLeaseTracker());

  const clearControlLease = useCallback(() => {
    controlLeaseRef.current.clear();
    setControlArmed(false);
    setControlSecondsLeft(0);
  }, []);

  const nextControlLeaseEnvelope = useCallback(() => {
    const envelope = controlLeaseRef.current.nextEnvelope();
    if (!envelope) return envelope;
    // The host binds every armed-control lease to the screen session that
    // armed it (main.py's handle_disarm_control/_remote_control_error) and
    // rejects disarm/remote_input messages that don't echo it back.
    const screen = remoteScreenRef.current;
    return {
      ...envelope,
      ...(screen?.sessionId ? { screen_session_id: screen.sessionId } : {}),
      ...(screen?.taskId ? { task_id: screen.taskId } : {}),
    };
  }, []);

  // A new pairing starts from idle — reset during render, not in the effect below.
  const [pcStateFor, setPcStateFor] = useState(pcConfig);
  if (pcConfig !== pcStateFor) {
    setPcStateFor(pcConfig);
    setPcState("idle");
  }

  useEffect(() => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (!pcConfigured) return undefined;
    const pc = new RemotePC({
      host: pcConfig.host,
      altHost: pcConfig.altHost,
      port: pcConfig.port,
      secure: pcConfig.secure,
      hostId: pcConfig.hostId,
      hostFingerprint: pcConfig.hostFingerprint,
      hostPublicKey: pcConfig.hostPublicKey,
      pairingChallengeId: pcConfig.pairingChallengeId,
      pin: pcPinRef.current,
      deviceName: pcConfig.deviceName,
      onStateChange: (s) => {
        setPcState(s);
        if (s !== "online") {
          clearControlLease();
        } else {
          // The original React promise does not survive Activity/WebView death,
          // but the accepted host task does. Restore each opaque subscription and
          // request its current status; replay starts strictly after our cursor.
          // Defer one microtask because RemotePC emits `online` immediately before
          // it sends protocol.hello. The hello must bind the stable device identity
          // before the host authorizes any restored subscription.
          queueMicrotask(() => {
            if (pcRef.current !== pc || !pc.isOnline) return;
            for (const { taskId, lastSeq } of loadKnownRemoteTaskCursors()) {
              pc.signal("task.subscribe", { task_id: taskId, resume_after_seq: lastSeq });
              pc.signal("task.status", { task_id: taskId });
            }
          });
        }
      },
      onEvent: (ev) => {
        const e = ev.event;
        if (
          [
            "task.accepted",
            "task.status",
            "task.event",
            "task.cancelled",
            "approval.challenge",
            "approval.resolved",
            "clarification.challenge",
            "clarification.resolved",
          ].includes(e)
        ) {
          rememberRemoteTaskCursor(ev.taskId, ev.seq);
          setAgentTasks((prev) => reduceRemoteTaskEvent(prev, ev));
        }
        if (e === "task.snapshot") {
          const rows = Array.isArray(ev.data?.tasks) ? ev.data.tasks : [];
          const cursors = new Map(
            loadKnownRemoteTaskCursors().map(({ taskId, lastSeq }) => [taskId, lastSeq]),
          );
          setAgentTasks((prev) => reduceRemoteTaskSnapshot(prev, ev));
          for (const row of rows) {
            const taskId = row?.task_id || row?.taskId || row?.id;
            if (!taskId) continue;
            pc.signal("task.subscribe", {
              task_id: taskId,
              resume_after_seq: cursors.get(taskId) || 0,
            });
          }
        }
        if (e === "task.event" && ev.data && typeof ev.data === "object") {
          const kind = String(ev.data.kind || "").toLowerCase();
          const payload =
            ev.data.payload && typeof ev.data.payload === "object" ? ev.data.payload : {};
          if (kind === "approval.challenge") {
            setPermissionRequest({
              ...payload,
              id: payload.step_id,
              approvalId: payload.approval_id || payload.challenge_id,
              taskId: ev.taskId,
              description:
                payload.description ||
                payload.consequence ||
                payload.reason ||
                "perform a consequential action",
            });
          } else if (kind === "approval.resolved") {
            setPermissionRequest(null);
          } else if (kind === "clarification.challenge") {
            setClarifyRequest({
              ...payload,
              id: payload.prompt_id || payload.id || payload.request_id || ev.taskId,
              taskId: ev.taskId,
              question:
                payload.question || payload.reason || "Aura needs more information to continue.",
            });
          } else if (kind === "clarification.resolved") {
            setClarifyRequest(null);
          }
        }
        if (typeof e === "string" && e.startsWith("agent_")) {
          setAgentTasks((prev) =>
            reduceTaskCenterAgentEvent(prev, ev, { imageSrc: agentImageSrc }),
          );
          // The task ended → clear any dialog the PC left up.
          if (e === "agent_task_end") {
            setPermissionRequest(null);
            setClarifyRequest(null);
          }
        } else if (e === "approval.challenge") {
          const data = ev.data && typeof ev.data === "object" ? ev.data : {};
          setPermissionRequest({
            ...data,
            id: data.step_id,
            approvalId: data.approval_id || data.challenge_id,
            taskId: ev.taskId,
            description:
              data.description ||
              data.consequence ||
              data.reason ||
              "perform a consequential action",
          });
        } else if (e === "approval.resolved") {
          setPermissionRequest(null);
        } else if (e === "clarification.challenge") {
          const data = ev.data && typeof ev.data === "object" ? ev.data : {};
          setClarifyRequest({
            ...data,
            id: data.prompt_id || data.id || data.request_id || ev.taskId,
            taskId: ev.taskId,
            question: data.question || data.reason || "Aura needs more information to continue.",
          });
        } else if (e === "clarification.resolved") {
          setClarifyRequest(null);
        } else if (e === "permission_request") {
          // Legacy prompts are not bound to an exact signed task/step/digest and
          // therefore cannot become an actionable approval dialog.
          setPermissionRequest(null);
        } else if (e === "clarify_request") {
          setClarifyRequest(ev.data || null);
        } else if (e === "remote_task_settled") {
          // Synthetic event from RemotePC when a task ends ANY way (incl. timeouts) —
          // tidy up dialogs the PC never got to dismiss.
          setPermissionRequest(null);
          setClarifyRequest(null);
        } else if (e === "webrtc_answer" || e === "webrtc_ice") {
          // WebRTC signalling for the live-view PeerConnection → hand to RemoteScreen.
          void remoteScreenRef.current?.onSignal(e, ev.data);
        } else if (e === "control_state") {
          // The PC's arm/disarm state — direct input is only allowed while armed.
          const d = ev.data || {};
          const leaseId = d.lease_id || d.leaseId;
          if (!d.armed) {
            clearControlLease();
          } else if (leaseId) {
            controlLeaseRef.current.acquire(leaseId);
            setControlArmed(true);
            setControlSecondsLeft(Number(d.seconds_left) || 0);
          } else if (controlLeaseRef.current.leaseId) {
            setControlArmed(true);
            setControlSecondsLeft(Number(d.seconds_left) || 0);
          }
        } else if (e === "remote_input_ack") {
          // A direct-input result. Surface only failures (e.g. "not armed") so the
          // user isn't spammed on every successful click.
          const d = ev.data || {};
          const action = String(d.action || "").toLowerCase();
          const leaseId = d.lease_id || d.leaseId;
          if ((action === "arm" || action === "arm_control") && d.ok !== false && leaseId) {
            controlLeaseRef.current.acquire(leaseId);
            setControlArmed(true);
            setControlSecondsLeft(Number(d.seconds_left) || 0);
          } else if (
            d.ok === false ||
            action === "disarm" ||
            action === "disarm_control" ||
            action === "stop" ||
            action === "release"
          ) {
            clearControlLease();
          }
          if (d.ok === false && d.message) pushWarning(d.message);
        } else if (e === "warning" && typeof ev.data === "string") {
          pushWarning(ev.data);
        } else if (e === "webrtc_error") {
          // The PC rejected screen/ICE/stop signalling (stale session, no lease,
          // etc.) — previously silent; surface it and stop spinning on "connecting".
          const d = ev.data || {};
          if (d.message) pushWarning(d.message);
          setScreenState((prev) => (prev === "idle" || prev === "closed" ? prev : "failed"));
          clearControlLease();
        }
      },
    });
    pcRef.current = pc;
    pc.connect();
    return () => {
      pc.close();
      clearControlLease();
      if (pcRef.current === pc) pcRef.current = null;
    };
  }, [pcConfig, pcConfigured, pushWarning, clearControlLease]);

  // ── Fingerprint gate for PC control (security audit — Part A) ──────────────
  // Sending a task to the PC or arming direct mouse/keyboard control are the phone's
  // most powerful actions, so require the device fingerprint first — a borrowed or
  // unlocked phone then still can't drive the PC. Graceful by design: if no
  // fingerprint/lock is enrolled, or the plugin isn't present (web/desktop build),
  // it returns true rather than locking the user out. A cancelled/failed prompt
  // returns false (action denied).
  const requireBiometric = useCallback(async (reason) => {
    try {
      // No fingerprint/lock enrolled → graceful bypass (don't lock the user out).
      if (!(await checkStatus())?.isAvailable) return false;
    } catch {
      return false;
    }
    try {
      await authenticate(reason, {
        allowDeviceCredential: true, // fall back to the phone's PIN/pattern
        title: "Verify it's you",
        confirmationRequired: false,
      });
      return true; // resolved = authenticated
    } catch {
      return false; // cancelled or failed → deny the action
    }
  }, []);

  // Single chokepoint for "send a task to the PC": both the brain's pc_task tool and
  // the manual PC-command mode go through here, so the fingerprint gate can't be
  // sidestepped by either path.
  const runPcTask = useCallback(
    async (goal, kind = "browser") => {
      if (!pcRef.current) return { ok: false, summary: "No PC is paired yet, sir." };
      if (!(await requireBiometric("Confirm it's you to run a task on your PC"))) {
        return { ok: false, summary: "I need your fingerprint to run that on your PC, sir." };
      }
      return pcRef.current.runTask(goal, kind);
    },
    [requireBiometric],
  );

  // A stable handle for the brain: null when no PC is paired (so `pc_task` isn't
  // even advertised), else delegates to the live RemotePC instance. dispatch passes
  // kind ("browser"|"computer") as the 2nd arg — thread it through so a desktop task
  // ("open notepad") actually runs on the desktop instead of being forced into the
  // browser autopilot (which then Google-searches "online notepad" and fails).
  const remote = useMemo(() => {
    if (!pcConfigured) return null;
    return { runTask: (goal, kind) => runPcTask(goal, kind) };
  }, [pcConfigured, runPcTask]);

  // Optional TURN relay from the pairing config → ICE servers for internet use.
  const iceServers = useMemo(() => [], []);

  // Start the live screen: a fresh RemoteScreen whose signalling rides pcRef's socket.
  const startScreen = useCallback(async () => {
    if (!pcRef.current?.isOnline) {
      pushWarning("Pair and connect to your PC first, sir.");
      return;
    }
    try {
      await remoteScreenRef.current?.close(false);
    } catch {
      /* ignore */
    }
    setScreenStream(null);
    setScreenDetail("");
    // Match the stream weight to the path. A LAN link (private 192.168/10/172.16-31
    // IP) has the headroom for a smooth stream; a Tailscale/remote hop (100.64/10
    // CGNAT, a public IP, or a hostname) has far less uplink+jitter budget, and a
    // heavy stream over it is exactly what makes the video flicker (packet loss →
    // corrupt VP8 inter-frames) — visible ONLY off-LAN, which is the report. A
    // lighter stream keeps the picture stable there.
    //
    // Resolution is capped lower than before (1280/1000, not 1600/1200): software VP8
    // encode cost scales with pixel count, so a smaller frame is the cheapest way to
    // cut glass-to-glass latency for interactive control. fps is nudged up slightly
    // for a more responsive feel — the wall-clock pts fix (webrtc_screen.py) drops
    // frames under load instead of letting latency pile up, so a higher target is safe.
    const host = pcRef.current?.activeHost || "";
    const onLan = isPrivateLanHost(host);
    const quality = onLan ? { fps: 15, maxSide: 1280 } : { fps: 12, maxSide: 1000 };
    const screen = new RemoteScreen({
      signaller: { signal: (type, data) => pcRef.current?.signal(type, data) ?? false },
      iceServers,
      fps: quality.fps,
      maxSide: quality.maxSide,
      onStream: setScreenStream,
      onState: (next) => {
        setScreenState(next);
        if (next === "failed" || next === "closed") clearControlLease();
      },
      onDetail: setScreenDetail,
    });
    remoteScreenRef.current = screen;
    try {
      await screen.start();
    } catch (err) {
      pushWarning("Couldn't start the screen: " + (err?.message || err));
      setScreenState("failed");
    }
  }, [iceServers, pushWarning, clearControlLease]);

  const stopScreen = useCallback(async () => {
    const lease = nextControlLeaseEnvelope();
    if (lease) pcRef.current?.signal("disarm_control", lease);
    clearControlLease();
    try {
      await remoteScreenRef.current?.close(true);
    } catch {
      /* ignore */
    }
    remoteScreenRef.current = null;
    setScreenStream(null);
    setScreenDetail("");
    setScreenState("idle");
  }, [clearControlLease, nextControlLeaseEnvelope]);

  // Open/close the PC's bounded control window (its arm() consent) from the phone.
  const armControl = useCallback(
    async (minutes) => {
      const screen = remoteScreenRef.current;
      if (!screen?.sessionId) {
        pushWarning("Start viewing your PC's screen before arming control, sir.");
        return;
      }
      if (!(await requireBiometric("Confirm it's you to control your PC"))) {
        pushWarning("I need your fingerprint to control your PC, sir.");
        return;
      }
      clearControlLease();
      pcRef.current?.signal("arm_control", {
        ...(minutes ? { minutes } : {}),
        screen_session_id: screen.sessionId,
        ...(screen.taskId ? { task_id: screen.taskId } : {}),
      });
    },
    [requireBiometric, pushWarning, clearControlLease],
  );
  const disarmControl = useCallback(() => {
    const lease = nextControlLeaseEnvelope();
    pcRef.current?.signal("disarm_control", lease || {});
    clearControlLease();
  }, [clearControlLease, nextControlLeaseEnvelope]);

  // Emergency stop for the remote-desktop view: halts the PC's hands NOW — disarms
  // direct touch control AND breaks any running pc_task/autopilot loop at its next
  // step (mirrors the desktop HUD's own "STOP CONTROL" button, handle_stop_control
  // in main.py). Clears controlArmed locally right away so the UI updates instantly
  // instead of waiting on the control_state round-trip.
  const stopRemoteControl = useCallback(() => {
    const lease = nextControlLeaseEnvelope();
    // Cancel the in-flight PC task too — stop_control alone only disarms direct
    // input; a running browser/autopilot task (incl. live-view command-mode tasks,
    // which aren't in agentTasks) needs the correlated task.cancel to actually stop.
    // Disarm locally straight away — that part is ours and can't fail.
    clearControlLease();
    // Wait for the envelopes to actually reach the socket before claiming the PC was
    // told. These used to be fire-and-forget `send()`s that returned true the moment
    // they were queued, so a dropped native signing callback left the user reading
    // "hard stop sent" while the PC carried on running the task.
    const pc = pcRef.current;
    Promise.all([
      pc?.cancelTaskConfirmed("user_stop") ?? Promise.resolve(false),
      pc?.signalConfirmed("stop_control", lease || {}) ?? Promise.resolve(false),
    ]).then(([cancelled, disarmed]) => {
      pushWarning(
        cancelled || disarmed
          ? "Hard stop sent to your PC, sir — halting any running task and disarming control."
          : "I couldn't reach your PC to stop it, sir — the link looks down. Check it's on and paired.",
      );
    });
  }, [pushWarning, clearControlLease, nextControlLeaseEnvelope]);

  const stopPhoneTask = useCallback(() => {
    requestPhoneStop();
    const tasks = agentTasksRef.current.filter(
      (task) => task.kind === "phone" && !TERMINAL_TASK_STATES.has(task.status),
    );
    setAgentTasks((prev) => tasks.reduce((next, task) => markTaskStopping(next, task.id), prev));
    const nativeIds = [...new Set(tasks.map((task) => task.nativeTaskId).filter(Boolean))];
    void Promise.all(nativeIds.map((taskId) => journaledPhone.cancelTask?.(taskId)));
  }, [journaledPhone, requestPhoneStop]);

  const stopTask = useCallback(
    (id) => {
      const task = agentTasksRef.current.find((item) => item.id === id || item.nativeTaskId === id);
      if (!task || TERMINAL_TASK_STATES.has(task.status)) return;
      if (task.kind === "phone" || task.source === "phone") {
        setAgentTasks((prev) => markTaskStopping(prev, task.id));
        requestPhoneStop();
        if (task.nativeTaskId) void journaledPhone.cancelTask?.(task.nativeTaskId);
        return;
      }
      // RemotePC serializes one accepted PC task at a time. cancelTask sends the
      // correlated durable task.cancel; stop_control additionally revokes any
      // outstanding direct-input lease on the host.
      const sent =
        pcRef.current?.cancelTask("user_cancelled") ||
        pcRef.current?.signal("task.cancel", {
          task_id: task.id,
          reason: "user_cancelled",
        });
      if (sent) setAgentTasks((prev) => markTaskStopping(prev, task.id));
      else pushWarning("That PC task is still reconnecting; STOP could not reach the host yet.");
      const lease = nextControlLeaseEnvelope();
      pcRef.current?.signal("stop_control", lease || {});
      clearControlLease();
    },
    [journaledPhone, requestPhoneStop, clearControlLease, nextControlLeaseEnvelope, pushWarning],
  );

  const stopAllTasks = useCallback(() => {
    requestPhoneStop();
    const active = agentTasksRef.current.filter((task) => !TERMINAL_TASK_STATES.has(task.status));
    const phoneTasks = active.filter((task) => task.kind === "phone" || task.source === "phone");
    setAgentTasks((prev) =>
      phoneTasks.reduce((next, task) => markTaskStopping(next, task.id), prev),
    );
    const nativeIds = [...new Set(active.map((task) => task.nativeTaskId).filter(Boolean))];
    void Promise.all(nativeIds.map((taskId) => journaledPhone.cancelTask?.(taskId)));
    let cancelledPc = pcRef.current?.cancelTask("global_stop") || false;
    const stoppedPcIds = [];
    for (const task of active.filter((item) => item.source === "pc" || item.kind !== "phone")) {
      const sent = pcRef.current?.signal("task.cancel", {
        task_id: task.id,
        reason: "global_stop",
      });
      if (sent) {
        cancelledPc = true;
        stoppedPcIds.push(task.id);
      }
    }
    if (stoppedPcIds.length) {
      setAgentTasks((prev) =>
        stoppedPcIds.reduce((next, taskId) => markTaskStopping(next, taskId), prev),
      );
    }
    const lease = nextControlLeaseEnvelope();
    const releasedPc = pcRef.current?.signal("stop_control", lease || {}) || false;
    clearControlLease();
    if (active.length || cancelledPc || releasedPc) {
      pushWarning(
        "Global STOP requested: native phone leases invalidated and the PC control lease released.",
      );
    }
  }, [journaledPhone, pushWarning, requestPhoneStop, clearControlLease, nextControlLeaseEnvelope]);

  // One direct input event from the live-view canvas (guarded server-side by arm()).
  const sendRemoteInput = useCallback(
    (input) => {
      if (!input?.action) return false;
      const lease = nextControlLeaseEnvelope();
      if (!lease) return false;
      return pcRef.current?.signal("remote_input", { ...input, ...lease }) || false;
    },
    [nextControlLeaseEnvelope],
  );

  const buildDeps = useCallback(() => {
    const cfg = toBrainConfig(stored);
    if (cfg.pinnedLocation) locationRef.current.setPinned(cfg.pinnedLocation);
    else locationRef.current.unpin();
    return {
      platform: taskPlatform,
      memory: memoryRef.current,
      config: cfg,
      location: locationRef.current,
      onAgentEvent,
      onUiCommand: emitUiCommand,
      onFallback: pushWarning,
      shouldStopPhoneTask: () => phoneTaskStopRef.current,
      authorizePhoneAction,
      onDispatched,
      remote,
    };
  }, [
    stored,
    remote,
    onAgentEvent,
    emitUiCommand,
    pushWarning,
    taskPlatform,
    authorizePhoneAction,
    onDispatched,
  ]);

  const storedRef = useRef(stored);
  useEffect(() => {
    storedRef.current = stored;
  }, [stored]);

  // The brain uses a config getter so it always reads the latest credentials without needing recreation.
  const brainRef = useRef(null);
  useEffect(() => {
    brainRef.current = createBrain({
      getConfig: () => toBrainConfig(storedRef.current),
      platform: taskPlatform,
      memory: memoryRef.current,
      remote,
      onAgentEvent,
      onUiCommand: emitUiCommand,
      onFallback: pushWarning,
      shouldStopPhoneTask: () => phoneTaskStopRef.current,
      authorizePhoneAction,
      onDispatched,
    });
  }, [
    remote,
    onAgentEvent,
    emitUiCommand,
    pushWarning,
    taskPlatform,
    authorizePhoneAction,
    onDispatched,
  ]);

  const sysInfo = useMemo(() => {
    const cfg = toBrainConfig(stored);
    return {
      needs_setup: secretsReady && !hasKey,
      has_vertex_sa: Boolean(stored.vertexSaJson),
      vertex_project: cfg.vertexProject || "",
      has_groq_key: Boolean(stored.groqKey),
      has_gemini_key: Boolean(stored.geminiKey),
      has_openrouter_key: Boolean(stored.openrouterKey),
      has_mistral_key: Boolean(stored.mistralKey),
      has_nvidia_key: Boolean(stored.nvidiaKey),
      storage_dir: "device",
      model_override: stored.model || "",
      // The provider the user scoped routing to ("auto" or an id). Resolved, not
      // raw: a provider whose key was removed reads back as auto.
      provider_mode: cfg.providerScope || "auto",
      wake_word: stored.wakeWord !== false,
      auto_switch_models: stored.autoSwitchModels !== false,
      tts: "android",
      platform: "android",
      provider: cfg.tier,
      model: cfg.model,
      available_models: availableModels,
      reachable_models: reachableModels(routing.models),
      routing,
      manual_location: stored.pinnedLocation
        ? { label: stored.pinnedLocation, lat: null, lon: null }
        : null,
      allowed_dirs: [],
      calendar_sync: stored.calendarSync !== false,
    };
  }, [hasKey, secretsReady, stored, availableModels, routing]);

  // While the Remote Desktop live view is open, every command (typed OR spoken)
  // is meant for the PC on screen — so it goes STRAIGHT to the desktop's own
  // JARVIS as a task, bypassing the phone brain's routing entirely. The phone
  // LLM deciding whether to forward was exactly how "open Windows Explorer"
  // got a "web-based tasks only" refusal: the desktop can do it, the phone
  // model just never handed it over. A mode flag, not a prop, so the mic
  // transcription path routes identically to the text bar.
  const pcCommandModeRef = useRef(false);
  const setPcCommandMode = useCallback((on) => {
    pcCommandModeRef.current = Boolean(on);
  }, []);

  // The core: send a user turn to the in-app brain and append its reply.
  const busyRef = useRef(false);
  // True once the user has actively used JARVIS this run (not just the auto-greeting)
  // — used to gate the one-time "draw over other apps" permission prompt so it never
  // fires on the launch greeting, only after a real interaction.
  const userInteractedRef = useRef(false);
  const micRef = useRef(null); // MicRecorder (push-to-talk)
  const listeningRef = useRef(false);
  // Hard ceiling on one push-to-talk recording (see startListen).
  const listenTimerRef = useRef(undefined);
  const finishListenRef = useRef(null);
  const sendMessage = useCallback(
    async (text) => {
      const t = (text || "").trim();
      if (!t || busyRef.current) return;
      userInteractedRef.current = true; // gates the one-time overlay-permission prompt
      setMessages((prev) => [...prev, { role: "user", text: t, id: uid() }]);
      if (pcCommandModeRef.current) {
        busyRef.current = true;
        setStatus("thinking");
        let spoken = "";
        try {
          // Live-view command mode bypasses the phone brain, so there's no model to
          // pick a kind — send "auto" and let the DESKTOP classify browser vs native
          // (that's why "open Windows Explorer" no longer comes back as browser-only).
          const res = await runPcTask(t, "auto");
          spoken =
            (res?.summary || "").trim() ||
            (res?.ok ? "Done on your PC, sir." : "I couldn't finish that on your PC, sir.");
        } catch (err) {
          spoken = `That PC task failed: ${err?.message || err}`;
        }
        setMessages((prev) => [
          ...prev,
          { role: "jarvis", text: spoken, actions: [], finalized: true, id: uid() },
        ]);
        try {
          if (!mutedRef.current && spoken) {
            setStatus("speaking");
            await webSpeechTTS.speak(spoken);
          }
        } finally {
          busyRef.current = false;
          setStatus("idle");
        }
        return;
      }
      if (!brainRef.current) return;
      busyRef.current = true;
      setStatus("thinking");
      const replyId = uid();
      let spoken = "";
      try {
        const reply = await brainRef.current.ask(t);
        spoken = reply;
        setMessages((prev) => [
          ...prev,
          { role: "jarvis", text: reply, actions: drainCards(), finalized: true, id: replyId },
        ]);
      } catch (err) {
        spoken = `Sorry — I hit an error: ${err?.message || err}`;
        setMessages((prev) => [
          ...prev,
          { role: "jarvis", text: spoken, actions: drainCards(), finalized: true, id: replyId },
        ]);
      }
      // Speak the reply via the device TTS (unless muted). "speaking" status drives
      // the HUD waveform; it always returns to idle even if TTS stalls.
      try {
        if (!mutedRef.current && spoken) {
          setStatus("speaking");
          await webSpeechTTS.speak(spoken);
        }
      } finally {
        busyRef.current = false;
        setStatus("idle");
      }
    },
    [runPcTask, drainCards],
  );

  // Quick-action buttons fire a command without echoing a user bubble. On mobile we
  // just treat it as a normal turn (the brain decides whether to act/answer).
  const sendCommand = useCallback(
    (text) => {
      void sendMessage(text);
    },
    [sendMessage],
  );

  // Persist a key/model from the (mobile) onboarding or Settings. Field names match
  // the desktop set_config path (groq_api_key / gemini_api_key) so the UI is shared.
  const sendConfig = useCallback(
    async (cfg) => {
      if (!cfg || typeof cfg !== "object") return false;
      const requestedSecrets = [
        ["vertexSaJson", "vertex_sa_json"],
        ["groqKey", "groq_api_key"],
        ["geminiKey", "gemini_api_key"],
        ["openrouterKey", "openrouter_api_key"],
        ["mistralKey", "mistral_api_key"],
        ["nvidiaKey", "nvidia_api_key"],
      ]
        .filter(([, wireName]) => typeof cfg[wireName] === "string")
        .map(([name, wireName]) => [name, cfg[wireName].trim()]);
      if (requestedSecrets.length && inTauri() && !secretsReady) {
        pushWarning("Please wait for Android secure credential storage to finish loading.");
        return false;
      }

      const acceptedSecrets = Object.create(null);
      const failedSecrets = [];
      await Promise.all(
        requestedSecrets.map(async ([name, value]) => {
          if (!inTauri()) {
            acceptedSecrets[name] = value;
            return;
          }
          try {
            const response = value
              ? await nativeConfigSecretBridge.set(name, value)
              : await nativeConfigSecretBridge.delete(name);
            if (response?.ok === true) {
              acceptedSecrets[name] = value;
              delete pendingLegacyConfigSecrets[name];
            } else failedSecrets.push(name);
          } catch {
            failedSecrets.push(name);
          }
        }),
      );

      setStored((prev) => {
        const next = { ...prev };
        for (const name of CONFIG_SECRET_FIELDS) {
          if (!Object.prototype.hasOwnProperty.call(acceptedSecrets, name)) continue;
          if (acceptedSecrets[name]) next[name] = acceptedSecrets[name];
          else delete next[name];
        }
        if (typeof cfg.model_override === "string") next.model = cfg.model_override.trim();
        if (typeof cfg.pinned_location === "string")
          next.pinnedLocation = cfg.pinned_location.trim();
        if (typeof cfg.provider_mode === "string") next.providerMode = cfg.provider_mode.trim();
        if (typeof cfg.conversation_mode === "boolean")
          next.conversationMode = cfg.conversation_mode;
        if (typeof cfg.calendar_sync === "boolean") next.calendarSync = cfg.calendar_sync;
        if (typeof cfg.wake_word === "boolean") next.wakeWord = cfg.wake_word;
        if (typeof cfg.auto_switch_models === "boolean")
          next.autoSwitchModels = cfg.auto_switch_models;
        saveStored(next);
        return next;
      });
      if (Object.keys(acceptedSecrets).length) {
        // Saving keys is the user telling us they've fixed the cause — an escalated
        // bench from before must not keep a freshly-valid route out of rotation.
        quota.clear();
      }
      if (failedSecrets.length) {
        pushWarning(`Could not update secure credentials for: ${failedSecrets.join(", ")}.`);
      }
      return failedSecrets.length === 0;
    },
    [pushWarning, secretsReady],
  );

  const resetConversation = useCallback(() => {
    void memoryRef.current.clearConversation();
    setMessages([]);
  }, []);

  const listConversationsInner = async () => {
    const recents = await memoryRef.current.listRecents();
    setConversations(
      recents.map((r) => ({
        id: r.id,
        title: r.title,
        saved_at: r.savedAt,
        preview: (r.turns.find((t) => t.role === "user")?.content ?? "").slice(0, 80),
      })),
    );
  };
  const newConversation = useCallback(async () => {
    await memoryRef.current.archiveConversation();
    setMessages([]);
    void listConversationsInner();
  }, []);

  const turnsToMessages = (turns) =>
    turns.map((t) => ({
      role: t.role === "user" ? "user" : "jarvis",
      text: t.content,
      actions: [],
      finalized: true,
      id: uid(),
    }));

  const listConversations = useCallback(() => {
    void listConversationsInner();
  }, []);

  const openConversation = useCallback(async (id) => {
    const ok = await memoryRef.current.restoreRecent(id);
    if (!ok) return;
    const turns = await memoryRef.current.recentTurns();
    setMessages(turnsToMessages(turns));
  }, []);

  const deleteConversation = useCallback(async (id) => {
    await memoryRef.current.deleteRecent(id);
    void listConversationsInner();
  }, []);

  const clearConversations = useCallback(async () => {
    await memoryRef.current.clearRecents();
    setConversations([]);
  }, []);

  // ── Memory view (dock → MEMORY, or "open memory") ─────────────────────────────
  // One snapshot of everything stored: facts, playbooks, saved chats. Timestamps
  // are ms. Forget is exact — a fact by its full text, a playbook by its unique
  // name, a chat by id — so it can never take a look-alike with it.
  const [memory, setMemory] = useState(null);
  const listMemory = useCallback(async () => {
    const store = memoryRef.current;
    const [facts, recents] = await Promise.all([store.listFacts(), store.listRecents()]);
    setMemory({
      facts: facts.map((f) => ({ id: f.text, text: f.text, ts: f.ts })),
      playbooks: listPlaybooks().map((p) => ({
        id: p.workflowId,
        name: p.name,
        triggers: p.triggers,
        status: p.status,
        steps: p.steps,
        ts: p.savedAt,
      })),
      conversations: recents.map((r) => ({
        id: r.id,
        title: r.title,
        count: r.turns.length,
        ts: r.savedAt,
      })),
      now: Date.now(),
    });
  }, []);
  const rememberFact = useCallback(
    async (text) => {
      const res = await memoryRef.current.remember(text, stored.vertexSaJson);
      if (!res.ok) pushWarning(res.summary);
      await listMemory();
    },
    [listMemory, pushWarning, stored.vertexSaJson],
  );
  const forgetMemory = useCallback(
    async (kind, id) => {
      let res = { ok: true };
      if (kind === "fact") res = await memoryRef.current.deleteFact(id);
      else if (kind === "playbook") {
        const hit = listPlaybooks().find((p) => p.workflowId === id);
        if (hit) res = removePlaybook(hit.name);
      } else if (kind === "conversation") {
        await memoryRef.current.deleteRecent(id);
        void listConversationsInner();
      }
      if (!res.ok) pushWarning(res.summary);
      await listMemory();
    },
    [listMemory, pushWarning],
  );

  useEffect(() => {
    void listConversationsInner();
    // Hydrate the visible transcript from the active (unarchived) conversation's
    // persisted turns. The turns themselves always survived a restart (they back
    // the model's own context) — only the on-screen chat log was starting empty
    // every launch because nothing re-populated `messages` from them.
    void (async () => {
      const turns = await memoryRef.current.recentTurns();
      if (turns.length) setMessages(turnsToMessages(turns));
    })();
  }, []);
  const dismissWarning = useCallback(
    (id) => setWarnings((prev) => prev.filter((w) => w.id !== id)),
    [],
  );
  const setMute = useCallback((next) => {
    const v = Boolean(next);
    mutedRef.current = v;
    setMutedState(v);
    if (v) webSpeechTTS.stop(); // muting mid-sentence cuts current speech
  }, []);
  const stopSpeech = useCallback(() => {
    webSpeechTTS.stop();
    setStatus("idle");
  }, []);

  // Cross-app floating STOP: visible under the exact same condition as the in-app
  // banner (App.jsx), but backed by a native overlay so it still shows while some
  // OTHER app is in the foreground driving phone_task's actions.
  useEffect(() => {
    syncStopOverlay(
      taskCenterActive || status === "speaking",
      () => {
        stopAllTasks();
        stopSpeech();
      },
      {
        // Only offer the "draw over other apps" grant after the user has really used
        // JARVIS (so the launch greeting never pulls them into system settings), and
        // never mid phone-task (that path already has the free accessibility overlay).
        promptPermission: userInteractedRef.current && !taskCenterActive,
        onNeedsPermission: () =>
          pushWarning(
            "Opening a system setting so JARVIS can show a STOP button over other apps — turn on “Draw over other apps”, then it'll appear whenever JARVIS is speaking or busy.",
          ),
      },
    );
  }, [taskCenterActive, status, stopAllTasks, stopSpeech, pushWarning]);

  // ── Voice input (push-to-talk → mic → Groq Whisper → brain) ────────────────
  const startListen = useCallback(async () => {
    if (busyRef.current || listeningRef.current) return;
    if (!stored.groqKey && !stored.vertexSaJson) {
      pushWarning(
        "Voice input needs either a Vertex AI Service Account or Groq API key. Add one in Settings.",
      );
      return;
    }
    try {
      webSpeechTTS.stop(); // don't record JARVIS talking over you
      if (!micRef.current) micRef.current = new MicRecorder();
      await micRef.current.start();
      listeningRef.current = true;
      setStatus("listening");
      // Tap-to-talk needs a second tap to send. If it never comes, listeningRef
      // stays true — and since isBusy() reads it, "Hey Jarvis" goes silently dead
      // for the rest of the session. Send what we have instead of hanging.
      clearTimeout(listenTimerRef.current);
      listenTimerRef.current = setTimeout(() => {
        void finishListenRef.current?.();
      }, MAX_LISTEN_MS);
    } catch (e) {
      pushWarning("Couldn't access the microphone: " + (e?.message || e));
      listeningRef.current = false;
      setStatus("idle");
    }
    // vertexSaJson is read above but was missing here, so a Vertex-only user (who
    // never gets a Groq key) kept the pre-hydration closure all session and the mic
    // refused to start.
  }, [stored.groqKey, stored.vertexSaJson, pushWarning]);

  // Stop recording, transcribe, and send the recognised text as a turn.
  const finishListen = useCallback(async () => {
    if (!listeningRef.current || !micRef.current) return;
    clearTimeout(listenTimerRef.current);
    listeningRef.current = false;
    setStatus("thinking");
    let blob = null;
    try {
      blob = await micRef.current.stop();
    } catch {
      /* ignore */
    }
    if (!blob || (!stored.groqKey && !stored.vertexSaJson)) {
      setStatus("idle");
      return;
    }
    try {
      const text = await transcribe(blob, {
        groqKey: stored.groqKey,
        vertexSaJson: stored.vertexSaJson,
      });
      if (text) {
        await sendMessage(text); // appends the user bubble + asks the brain
      } else {
        setStatus("idle");
      }
    } catch (e) {
      pushWarning("Transcription failed: " + (e?.message || e));
      setStatus("idle");
    }
  }, [stored.groqKey, stored.vertexSaJson, sendMessage, pushWarning]);

  // startListen's auto-send timer needs finishListen, which is defined after it.
  useEffect(() => {
    finishListenRef.current = finishListen;
  }, [finishListen]);

  // Tap-to-talk: first tap starts listening, second tap stops + sends.
  const triggerListen = useCallback(() => {
    if (listeningRef.current) finishListen();
    else startListen();
  }, [startListen, finishListen]);

  // ── "Hey Jarvis" wake word (on-device openWakeWord via tauri-plugin-phone) ──
  // Runs whenever the toggle is on and a transcription credential exists. The
  // native engine listens locally for free; on detection we record the command,
  // transcribe it (Groq Whisper or Vertex Chirp) and hand it to the brain.
  const [wakeTriggered, setWakeTriggered] = useState(0);
  const alwaysOn = stored.wakeWord !== false; // default ON once a key exists
  const setAlwaysOnMode = useCallback((on) => {
    setStored((prev) => {
      const next = { ...prev, wakeWord: Boolean(on) };
      saveStored(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const groqKey = (stored.groqKey || "").trim();
    const saJson = (stored.vertexSaJson || "").trim();
    // Hand the desired state to the app-global singleton (brain/platform/wakeword).
    // We deliberately do NOT create/destroy the engine here or tear it down on
    // cleanup: the wake engine is an Android foreground service meant to outlive the
    // React tree, and coupling it to this effect's mount/unmount was the actual bug
    // (StrictMode + rapid startup re-renders tore its async native boot down
    // mid-flight, so start_wake_word never dispatched). syncWakeWord() is idempotent
    // by config signature — calling it every render is fine — and turns the engine
    // off itself when the toggle/keys go away (opts=null below).
    const wanted =
      alwaysOn && (groqKey || saJson)
        ? {
            groqKey,
            vertexSaJson: saJson,
            transcribe: (blob) => transcribe(blob, { groqKey, vertexSaJson: saJson }),
            isBusy: () => busyRef.current || listeningRef.current,
            onStatus: (s) => {
              if (s === "listening") setStatus("listening");
              else setStatus((cur) => (cur === "listening" ? "idle" : cur));
            },
            onCommand: (text) => {
              setWakeTriggered((n) => n + 1);
              void sendMessage(text);
            },
            onError: (msg) => pushWarning(`Wake word: ${msg}`),
            onFatal: (msg) => pushWarning(`“Hey Jarvis” stopped: ${msg}`),
          }
        : null;
    syncWakeWord(wanted);
    return undefined; // singleton owns lifecycle across re-renders — no teardown here
  }, [alwaysOn, stored.groqKey, stored.vertexSaJson, sendMessage, pushWarning]);

  // Speak a line via device TTS (unless muted). Used by the greeting + anywhere we
  // talk outside the sendMessage flow. Never gets the status stuck.
  const speak = useCallback(async (text) => {
    if (mutedRef.current || !text) return;
    try {
      setStatus("speaking");
      await webSpeechTTS.speak(text);
    } finally {
      if (!busyRef.current && !listeningRef.current) setStatus("idle");
    }
  }, []);

  // ── Greeting ────────────────────────────────────────────────────────────────
  // JARVIS introduces himself once, as soon as a key is configured (desktop greets
  // from the backend; on the phone there's none, so the brain greets itself).
  const greetedRef = useRef(false);
  useEffect(() => {
    if (greetedRef.current || !hasKey) return;
    greetedRef.current = true;
    const hour = new Date().getHours();
    const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    const text = `${part}, sir. JARVIS online and at your service. How can I help?`;
    setMessages((prev) =>
      prev.length ? prev : [{ role: "jarvis", text, actions: [], finalized: true, id: uid() }],
    );
    void speak(text);
  }, [hasKey, speak]);

  // ── Live HUD panels (battery / network / weather) ────────────────────────────
  // Real device signals so the Power, Network and Weather panels aren't dead zeros.
  useEffect(() => subscribeTelemetry(setTelemetry), []);
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const loc = await resolveAmbientLocation();
      if (cancelled || !loc) return;
      setNetInfo(netInfoFrom(loc));
      const w = await fetchPanelWeather(loc).catch(() => null);
      if (!cancelled && w) setWeather(w);
    };
    void tick();
    const iv = setInterval(tick, 15 * 60 * 1000); // refresh quarter-hourly
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, []);

  // ── Model discovery (per-key) ────────────────────────────────────────────────
  // Ask each configured provider which models its key can serve → Settings dropdown.
  // Also feeds smart routing (brain/modelRanker.ts), so it runs keyless too: a
  // removed last key must clear its models from the ranking.
  // Not before the Keystore secrets load, for the same reason as the catalog below.
  const refreshModels = useCallback(async () => {
    if (!secretsReady) return;
    try {
      const groups = await discoverModels({
        gemini: stored.geminiKey,
        groq: stored.groqKey,
        vertexSaJson: stored.vertexSaJson,
      });
      if (groups.length > 1) setAvailableModels(groups); // >Auto means a provider answered
    } catch {
      /* keep the curated fallback in Settings */
    }
    // No LLM lookup of unknown models here: it spent the same Gemini quota chat and
    // phone tasks need, on every launch. The benchmark ranking above is free; the
    // search-grounded estimate runs only from the Re-rank button.
  }, [secretsReady, stored.geminiKey, stored.groqKey, stored.vertexSaJson]);
  useEffect(() => {
    // Data fetching in an effect is the intended use; the rule can't see that the
    // only setState in refreshModels runs after an await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshModels();
  }, [refreshModels]);

  // The pooled free providers' routes come from their live model lists, re-read
  // whenever their keys change (and on every launch). Without this they add nothing.
  // Not before the Keystore secrets load: a keyless refresh CLEARS every provider's
  // candidates, and if the keyed refresh after it then failed, the provider had
  // nothing left to fall back on until the next launch.
  const refreshPooled = useCallback(async () => {
    if (!secretsReady) return;
    await refreshCatalog({
      openrouter: stored.openrouterKey,
      mistral: stored.mistralKey,
      nvidia: stored.nvidiaKey,
    });
  }, [secretsReady, stored.openrouterKey, stored.mistralKey, stored.nvidiaKey]);
  useEffect(() => {
    void refreshPooled();
  }, [refreshPooled]);

  // Smart routing: the ranking Settings shows, and the Re-rank button (re-discover,
  // then look up every model the benchmark catalog doesn't cover again).
  const rerankModels = useCallback(async () => {
    await Promise.all([refreshModels(), refreshPooled()]);
    await estimateUnknownModels(stored.geminiKey);
  }, [refreshModels, refreshPooled, stored.geminiKey]);

  // ── Repair / connection self-test (mobile) ───────────────────────────────────
  // On a phone there are no downloadable runtime components — "Repair" instead runs a
  // layered self-test (raw network → each AI key) and reports exactly what's reachable,
  // so a silent failure becomes a clear, actionable message.
  const repairSetup = useCallback(async () => {
    pushWarning("Running a connection self-test…");
    const lines = [];
    // 1. Keyless network reachability — proves the device can hit the internet at all
    //    (and that the HTTP transport works), independent of any API key.
    try {
      const loc = await resolveAmbientLocation();
      lines.push(
        loc ? `✓ Network OK${loc.place ? ` (${loc.place})` : ""}` : "⚠ Network: no response",
      );
    } catch {
      lines.push("⚠ Network unreachable");
    }
    // 2. AI keys — discovery doubles as a key-validity + reachability check.
    if (stored.geminiKey || stored.groqKey || stored.vertexSaJson) {
      try {
        const groups = await discoverModels({
          gemini: stored.geminiKey,
          groq: stored.groqKey,
          vertexSaJson: stored.vertexSaJson,
        });
        const prov = groups.filter((g) => g.kind !== "auto" && g.kind !== "image");
        if (prov.length) {
          setAvailableModels(groups);
          prov.forEach((g) => lines.push(`✓ ${g.label}: ${g.opts.length} models`));
        } else {
          lines.push("⚠ AI key set but no models returned — check the key is valid.");
        }
      } catch (e) {
        lines.push("⚠ AI service unreachable: " + (e?.message || e));
      }
    } else {
      lines.push("⚠ No API key yet — add one in Settings → API Keys.");
    }
    pushWarning(lines.join("   ·   "));
  }, [stored.geminiKey, stored.groqKey, stored.vertexSaJson, pushWarning]);

  const sendLocation = useCallback((lat, lon) => {
    locationRef.current.setDeviceCoords(lat, lon);
  }, []);

  const sendManualLocation = useCallback(
    (loc) => {
      if (loc?.clear) {
        setStored((prev) => {
          const next = { ...prev, pinnedLocation: "" };
          saveStored(next);
          return next;
        });
        locationRef.current.clearPinned();
        pushWarning("Location pin cleared — I'll auto-detect again.");
        return;
      }
      const place = (loc?.place ?? loc?.label ?? "").trim();
      if (!place) {
        setStored((prev) => {
          const next = { ...prev, pinnedLocation: "" };
          saveStored(next);
          return next;
        });
        locationRef.current.clearPinned();
        pushWarning("Location pin cleared — I'll auto-detect again.");
        return;
      }
      setStored((prev) => {
        const next = { ...prev, pinnedLocation: place };
        saveStored(next);
        return next;
      });
      locationRef.current.setPinned(place);
      pushWarning(`Pinned your location to ${place}.`);
    },
    [pushWarning],
  );

  const sendScreen = useCallback((patch) => {
    const next = patchScreenConfig(patch || {});
    setScreen(next);
  }, []);

  const runAction = useCallback(
    async (spec) => {
      if (!spec || !spec.type) return;
      try {
        // Logging and the screen/schedule re-render happen in onDispatched, which
        // fires for the brain's tool calls too — this path used to own them, which
        // is why anything JARVIS did by voice was invisible in the activity log.
        const result = await dispatch(spec, buildDeps());
        if (spec.type === "ui" && String(spec.do) === "clear_chat") setMessages([]);
        if (!result.ok && result.summary) pushWarning(result.summary);
        return result;
      } catch (err) {
        pushWarning(String(err?.message || err));
        return { ok: false, summary: String(err?.message || err) };
      }
    },
    [buildDeps, pushWarning],
  );

  const setConversationModeOn = useCallback((on) => {
    const v = Boolean(on);
    setConversationMode(v);
    setStored((prev) => {
      const next = { ...prev, conversationMode: v };
      saveStored(next);
      return next;
    });
  }, []);
  const clearAgentTasks = useCallback(
    () => setAgentTasks((prev) => prev.filter((task) => !TERMINAL_TASK_STATES.has(task.status))),
    [],
  );

  // ── Pairing controls (Phase 3) ──────────────────────────────────────────────
  // Pair (or re-pair) only from a complete expiring QR identity claim.
  const pairPC = useCallback((cfg) => {
    const next = sanitizePcConfig(cfg);
    if (!next || !savePcConfig(next)) return false;
    // Hold the PIN in memory only (sanitizePcConfig deliberately drops it, so it's
    // never written to storage). Used once for pairing.claim; reconnects don't need it.
    pcPinRef.current = String(cfg?.pin || "").trim();
    setPcConfig(next);
    return true;
  }, []);
  const unpairPC = useCallback(() => {
    void stopScreen();
    pcPinRef.current = "";
    savePcConfig(null);
    clearKnownRemoteTaskCursors();
    setPcConfig(null);
    setAgentTasks((prev) => prev.filter((task) => task.source !== "pc"));
    setPermissionRequest(null);
    setClarifyRequest(null);
  }, [stopScreen]);

  // Denials are immediate. Approvals require a fresh biometric and are cleared
  // only after RemotePC accepts an exact, unexpired challenge correlation.
  const respondPermission = useCallback(
    async (id, approved) => {
      const pc = pcRef.current;
      if (!pc) return false;
      if (approved && !(await requireBiometric("Approve this exact consequential PC action"))) {
        pushWarning("Approval was not sent because biometric verification failed.");
        return false;
      }
      const accepted = pc.respondPermission(id, approved);
      if (accepted) setPermissionRequest(null);
      else {
        // The exact challenge is gone (expired or superseded) — leaving the dialog
        // up with silently-dead buttons is how approvals get "lost". Say so.
        pushWarning("That approval window had already closed, sir — please submit the task again.");
        setPermissionRequest(null);
      }
      return accepted;
    },
    [pushWarning, requireBiometric],
  );
  const respondClarify = useCallback((id, answer, taskId) => {
    if (pcRef.current && taskId) {
      pcRef.current.signal("task.answer", {
        task_id: taskId,
        prompt_id: id,
        answer,
      });
    } else if (pcRef.current) {
      pcRef.current.respondClarify(id, answer);
    }
    setClarifyRequest(null);
  }, []);

  // Mirror useWebSocket's return shape exactly so the HUD works unchanged. Fields
  // that have no phone meaning (yet) return inert defaults.
  return {
    status,
    messages,
    warnings,
    sysInfo,
    isConnected: true, // in-app brain — always "connected" → boot overlay clears
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
    recordings: {},
    browserState: { open: false, url: "", title: "", available: false, approved: false },
    controlState: { armed: false, available: false, seconds_left: 0, paused: false },
    screen,
    alwaysOn,
    conversationMode,
    activeApp: null,
    overlay: { enabled: false, mode: "except", apps: [] },
    agentTasks,
    taskCenterTasks: agentTasks,
    taskCenterActive,

    // A consequential (R2/R3) phone action waiting on the user's decision, and the
    // resolver the approval sheet calls with "allow" / "allow_task" / "deny".
    phoneApproval,
    resolvePhoneApproval,
    conversations,
    memory,
    listMemory,
    rememberFact,
    forgetMemory,
    setupProgress: null,

    // Remote PC (Phase 3) — pairing state + controls for the pairing screen.
    pcConfig,
    pcState,
    pairPC,
    unpairPC,

    // Remote desktop (live WebRTC screen view + direct control).
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

    dismissWarning,
    clearAgentTasks,
    sendConfig,
    refreshModels,
    rerankModels,
    repairSetup,
    sendMessage,
    sendCommand,
    setPcCommandMode,
    triggerListen,
    stopSpeech,
    stopControl: stopRemoteControl,
    phoneTaskActive,
    stopPhoneTask,
    stopTask,
    stopAllTasks,
    pauseControl: () => {},
    sendCorrection: () => {},
    finishListen,
    pttStart: startListen,

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
    setBrowserOpen: () => {},
    sendUpload: () => pushWarning("File upload isn't available on the phone yet."),
    sendScreen,
    setAlwaysOnMode,
    setConversationModeOn,
    wsSend: () => false,
  };
}
