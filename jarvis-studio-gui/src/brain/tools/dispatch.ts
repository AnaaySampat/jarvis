/**
 * Action dispatch — the single chokepoint that runs one ActionSpec and returns a
 * ToolResult. Port of `reference/python-backend-spec/actions/__init__.py:run_action`.
 *
 * Design rule (carried from Python): BOTH native function calls and text `[ACTION]`
 * tags lower to an ActionSpec (registry.toSpec) and arrive HERE. One path, one place
 * to gate permissions, one place that builds the truthful spoken confirmation.
 *
 * Routing is by the `type` of the spec, but the *mechanism* depends on the tool's
 * disposition: HTTP tools call `./http`, native tools call `../platform`, on-phone
 * control calls the AccessibilityService operator (Phase 2), remote tasks go over
 * the wss:// link to the Windows backend (Phase 3), and local tools touch memory.
 */

import type { ActionSpec, ToolResult } from "../types";
import { type BrainConfig, configReady } from "../config";
import type { Platform } from "../platform";
import type { MemoryStore } from "../memory/store";
import type { LocationService } from "./location";
import { agendaStartMillis, runSchedule } from "../schedule/store";
import { parseReminderDetail } from "../schedule/reminderTime";
import { addPlaybook, describePlaybooks, removePlaybook } from "../memory/playbooks";
import { applyScreenAction } from "../mobile/screenConfig";
import { benchFromNative } from "../ask";
import { usableRoutes } from "../routes";
import type {
  NativeRoute,
  PhoneApprovalDecision,
  PhonePolicyRequest,
} from "../operator/controller";
import { providerFor } from "../providers";
import * as quota from "../quota";
import * as http from "./http";
import type { HttpToolCtx } from "./http";

export interface DispatchDeps {
  platform: Platform;
  memory: MemoryStore;
  /** Active brain config — gives the HTTP tools the user's keys + selected model. */
  config: BrainConfig;
  /** The user's location source for weather / places / "near me" search. */
  location: LocationService;
  /** Phase 3: a connected remote-PC link, or null when no PC is paired. */
  remote?: { runTask(goal: string, kind?: "browser" | "computer"): Promise<ToolResult> } | null;
  /** Optional activity feed sink. Receives agent_* shaped events. */
  onAgentEvent?: (ev: { event: string; data?: Record<string, unknown> }) => void;
  /** JARVIS driving its OWN HUD: a `control_interface` action → the React layer
   *  (App.jsx's uiCommand effect) opens/closes panels, toggles mute, etc. */
  onUiCommand?: (cmd: string) => void;
  /** Fired whenever the primary LLM tier fails and a reply came from the fallback
   *  provider instead — surfaces a silent misconfiguration (wrong model/region,
   *  expired auth) that would otherwise look identical to a normal reply. */
  onFallback?: (msg: string) => void;
  /** Polled by a running `phone_task` so a HUD STOP button can interrupt it —
   *  mirrors the desktop's stop-control path, which the on-phone operator never had. */
  shouldStopPhoneTask?: () => boolean;
  /** Asks the user, UP FRONT, to approve a phone task whose goal has an external
   *  side effect (send, share, post, call). It can only be asked before the task
   *  starts: afterwards JARVIS's UI is behind the app being driven. Without this
   *  hook such tasks are refused. R3 (payments, credentials, deletion, security)
   *  is never pre-approved — the native operator suspends at that step instead. */
  authorizePhoneAction?: (request: PhonePolicyRequest) => Promise<PhoneApprovalDecision>;
  /** Fires after EVERY dispatched action, whoever called it.
   *
   *  dispatch() has two callers — the HUD's own action buttons and the brain's tool
   *  loop — and everything cross-cutting used to be wired only to the first. So the
   *  activity log recorded button presses and nothing JARVIS did by voice, and a
   *  spoken "make the HUD red" persisted without re-rendering. Hanging those
   *  concerns here instead of on one call site is what stops that recurring. */
  onDispatched?: (spec: ActionSpec, result: ToolResult) => void;
}

/**
 * Run one action and tell anyone who's listening that it happened.
 *
 * A thin wrapper rather than a notify call in each branch: dispatchInner returns
 * from ~40 places, and the whole point of `onDispatched` is that nobody has to
 * remember to wire a new one up.
 */
export async function dispatch(spec: ActionSpec, deps: DispatchDeps): Promise<ToolResult> {
  const result = await dispatchInner(spec, deps);
  try {
    deps.onDispatched?.(spec, result);
  } catch {
    /* an observer must never fail the action it's observing */
  }
  return result;
}

/**
 * Run one action. TODO(phase-1+): fill the stubbed branches as each tool is ported.
 * Anything not yet implemented returns ok:false with a clear message rather than a
 * fabricated success (the "says-it-did-but-didn't" guard).
 */
async function dispatchInner(spec: ActionSpec, deps: DispatchDeps): Promise<ToolResult> {
  const { platform, memory, remote } = deps;
  const httpCtx: HttpToolCtx = { config: deps.config, location: deps.location };
  switch (spec.type) {
    // ── HTTP info-tools (port from Python, pure network) ──
    case "weather":
      return http.getWeather(httpCtx);
    case "news":
      return http.getNews(String(spec.topic ?? ""));
    case "search_web":
      return http.webSearch(String(spec.query ?? ""), httpCtx);
    case "places":
      return http.findPlaces(String(spec.query ?? ""), httpCtx);
    case "directions":
      return http.getDirections(String(spec.destination ?? ""), httpCtx);
    case "qr_code":
      return http.makeQrCode(String(spec.text ?? ""));
    case "generate_image":
      return http.generateImage(String(spec.prompt ?? ""), httpCtx);

    // ── Location pin (drives weather / places / "near me" search) ──
    case "set_location":
      return setLocation(deps.location, String(spec.do ?? "set"), String(spec.place ?? ""));

    // ── Native Android tools (Kotlin plugins) ──
    case "screenshot":
      return platform.screen.screenshot();
    case "open_app":
      return platform.apps.open(String(spec.target ?? ""));
    case "close_app":
      return platform.apps.close(String(spec.target ?? ""));
    case "open_url":
      return platform.apps.openUrl(String(spec.url ?? ""));
    case "open_file":
      return platform.apps.openSavedFile(String(spec.target ?? ""));
    case "set_volume":
      return platform.system.setVolume(Number(spec.level));
    case "system":
      return platform.system.control(String(spec.target ?? ""));
    case "clipboard":
      return platform.system.readClipboard();
    case "record":
      return platform.system.record(String(spec.media), String(spec.do));
    case "read_file":
      return platform.files.read(String(spec.path ?? ""));
    case "list_dir":
      return platform.files.list(String(spec.path ?? ""));

    // ── Brain-local tools (memory / time / chat) ──
    case "remember":
      // Pass the service-account JSON so the embedding actually gets written. The
      // read side (brain/index.ts:89 memory.facts) always passes it, so omitting it
      // here left the vector store permanently empty while every turn still paid an
      // embedding round-trip to search it.
      return memory.remember(String(spec.text ?? ""), deps.config.vertexServiceAccountJson);
    case "forget":
      return memory.forget(String(spec.text ?? ""));
    case "ui":
      return controlInterface(deps, String(spec.do ?? ""));

    // ── Schedule / agenda (local store, mirrored to the system calendar) ──
    // The local store stays the source of truth — the HUD panel reads it and it
    // works with no permissions. The calendar mirror is best-effort on top, so an
    // agenda add still succeeds (and says so honestly) when the calendar refuses.
    case "schedule":
    case "agenda": {
      const payload = { ...(spec as Record<string, unknown>) };
      const action = String(payload.do ?? payload.action ?? "get").toLowerCase();
      const mirroring = deps.config.calendarSync !== false;

      if (mirroring && (action === "add" || action === "set" || action === "create")) {
        const startMillis = agendaStartMillis(
          String(payload.day ?? "today"),
          String(payload.time ?? ""),
        );
        if (startMillis) {
          const ev = await platform.calendar.add(String(payload.task ?? ""), startMillis);
          if (ev.ok && ev.eventId) payload.calendarEventId = ev.eventId;
          const r = runSchedule(payload);
          return {
            ok: r.ok,
            summary: ev.ok
              ? `${r.summary} It's in your calendar too.`
              : `${r.summary} (${ev.summary})`,
          };
        }
      }

      const r = runSchedule(payload);
      if (mirroring && (action === "remove" || action === "delete") && r.item?.calendarEventId) {
        await platform.calendar.remove(r.item.calendarEventId);
      }
      return { ok: r.ok, summary: r.summary };
    }

    // ── Clock: alarms and timers, set in the phone's REAL Clock app ─────────────
    case "clock": {
      const action = String(spec.do ?? "")
        .trim()
        .toLowerCase();
      const label = String(spec.label ?? "").trim();
      if (action === "timer") {
        const seconds = Number(spec.seconds ?? 0);
        if (!Number.isFinite(seconds) || seconds <= 0) {
          return { ok: false, summary: "How long should that timer run, sir?" };
        }
        return platform.clock.setTimer(Math.round(seconds), label);
      }
      if (action === "alarm") {
        const hour = Number(spec.hour ?? -1);
        const minute = Number(spec.minute ?? 0);
        if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
          return { ok: false, summary: "What time should I set that alarm for, sir?" };
        }
        return platform.clock.setAlarm(hour, minute, label, String(spec.days ?? ""));
      }
      if (action === "show_alarms") return platform.clock.showAlarms();
      if (action === "show_timers") return platform.clock.showTimers();
      if (action === "dismiss_timer") return platform.clock.dismissTimer();
      return { ok: false, summary: `I don't know the clock action '${action}'.` };
    }

    // ── Reminders — a real Clock alarm, plus an entry on the agenda ─────────────
    // Not an in-app notification: a reminder the user can't see or edit in their
    // Clock, and that dies on reboot, is worse than no reminder. The Clock owns
    // every time-based thing JARVIS sets.
    case "reminder": {
      const text = String(spec.text ?? "").trim();
      const when = String(spec.when ?? "").trim();
      if (!text) return { ok: false, summary: "What should I remind you about?" };
      const parsed = parseReminderDetail(when);
      // Store the RESOLVED clock time on the agenda, not the raw phrase — "in 2
      // minutes" left verbatim is meaningless once that moment has passed, and the
      // Agenda panel sorts/compares this field as an HH:MM clock time anyway.
      const at = parsed ? new Date(parsed.atMillis) : null;
      const agenda = runSchedule({
        do: "add",
        day: "today",
        time: at ? at.toTimeString().slice(0, 5) : when,
        task: `Reminder: ${text}`,
      });
      if (!parsed || !at) {
        // Couldn't resolve a concrete time — still on the agenda, but honest that
        // nothing will actually go off.
        return {
          ok: agenda.ok,
          summary: `${agenda.summary} I couldn't work out exactly when though, so nothing will go off — check the agenda.`,
        };
      }
      // A countdown is a TIMER, a time of day is an ALARM. Forcing "in 30 seconds"
      // through an alarm drops the seconds and lands on a minute that has already
      // started, which the Clock then schedules for tomorrow.
      const fired = parsed.relative
        ? await platform.clock.setTimer(parsed.seconds, text)
        : await platform.clock.setAlarm(at.getHours(), at.getMinutes(), text);
      const kind = parsed.relative ? "timer" : "clock alarm";
      return fired.ok
        ? { ok: true, summary: `${agenda.summary} I've set a ${kind} for it too.` }
        : { ok: agenda.ok, summary: `${agenda.summary} (${fired.summary})` };
    }

    // ── HUD screen customisation (local config) ──
    case "screen": {
      const r = applyScreenAction(
        String(spec.do ?? "get"),
        String(spec.value ?? ""),
        String(spec.panel ?? ""),
        String(spec.direction ?? ""),
      );
      return { ok: r.ok, summary: r.summary, data: r.config };
    }

    // ── Power menu (desktop) → device settings on Android ──
    case "power": {
      const cmd = String(spec.command ?? spec.target ?? "").toLowerCase();
      if (cmd.includes("sleep") || cmd.includes("hibernate")) {
        return {
          ok: false,
          summary:
            "Sleep and hibernate aren't available on Android — try locking the screen manually.",
        };
      }
      if (cmd.includes("shutdown") || cmd.includes("restart") || cmd.includes("logoff")) {
        return {
          ok: false,
          summary: "Power off and restart aren't available from the app on Android.",
        };
      }
      if (cmd.includes("lock")) {
        return {
          ok: true,
          summary: "Use your phone's power button to lock the screen, sir.",
        };
      }
      return platform.system.control(cmd || "settings");
    }

    case "time":
      return { ok: true, summary: new Date().toLocaleTimeString() };
    case "day":
      return {
        ok: true,
        summary: new Date().toLocaleDateString(undefined, {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        }),
      };

    // ── On-phone control (Phase 2 — AccessibilityService operator) ──
    case "phone_task":
      return runPhone(deps, String(spec.goal ?? ""), spec.stayInApp === true);
    case "open_a11y_settings":
      return deps.platform.openAccessibilitySettings();

    // ── Remote-control the PC (Phase 3) ──
    case "pc_task":
      if (!remote) return { ok: false, summary: "No PC is paired yet." };
      return remote.runTask(
        String(spec.goal ?? ""),
        spec.kind === "computer" ? "computer" : "browser",
      );

    // ── Not yet ported (Phase 2) — honest stub, not a fabricated success.
    // Descoped: a recurring native alarm needs either boot-persistence in Kotlin
    // or a native day-of-week scheduler — bigger lift than the one-shot reminder
    // this phase added, and a half-working recurrence would be worse than an
    // honest "not yet". ──
    case "routine":
      return notReady(
        "Recurring routines aren't available yet, sir — I can set a one-off reminder instead.",
      );

    // ── Playbooks — raw model/user prose is a disabled reference only. Promotion
    // is available solely to trusted deterministic receipt producers, never this tool. ──
    case "playbook": {
      const doAction = String(spec.do ?? "list").toLowerCase();
      if (doAction === "add") {
        return addPlaybook(
          String(spec.name ?? ""),
          String(spec.steps ?? ""),
          String(spec.triggers ?? ""),
        );
      }
      if (doAction === "remove") {
        return removePlaybook(String(spec.name ?? spec.query ?? ""));
      }
      return describePlaybooks();
    }

    default:
      return notReady(`'${spec.type}' is not implemented in the scaffold yet.`);
  }
}

function notReady(msg: string): ToolResult {
  return { ok: false, summary: msg, error: "not_implemented" };
}

/**
 * JARVIS controlling its OWN interface. Unlike phone_task (which drives OTHER apps
 * through the accessibility service — and can barely see JARVIS's own canvas HUD),
 * this speaks directly to the React layer: `deps.onUiCommand` hands the action to
 * App.jsx's uiCommand effect, which owns every panel/toggle. No a11y, no screenshots.
 */
function controlInterface(deps: DispatchDeps, action: string): ToolResult {
  const cmd = action.trim().toLowerCase();
  if (!cmd) return { ok: false, summary: "Which part of the interface, sir?" };
  if (!deps.onUiCommand) {
    return notReady("I can't reach my own interface controls right now, sir.");
  }
  deps.onUiCommand(cmd);
  return { ok: true, summary: UI_CONFIRM[cmd] ?? "Done, sir." };
}

/** Truthful spoken confirmation per self-control action. */
const UI_CONFIRM: Record<string, string> = {
  open_chat: "Opened the conversation log, sir.",
  close_chat: "Closed the conversation log.",
  open_settings: "Opened Settings, sir.",
  close_settings: "Closed Settings.",
  open_activity: "Opened Agent Activity, sir.",
  close_activity: "Closed Agent Activity.",
  open_customize: "Opened the home-screen customiser, sir.",
  close_customize: "Closed the customiser.",
  open_remote: "Opened the Remote PC screen, sir.",
  close_remote: "Closed the Remote PC screen.",
  listen: "Listening, sir.",
  stop_speaking: "Stopped.",
  mute: "Muted — I'll show replies as text, sir.",
  unmute: "Unmuted, sir.",
  conversation_mode_on: "Conversation mode on — I'll keep it brief, sir.",
  conversation_mode_off: "Conversation mode off, sir.",
  new_conversation: "Started a fresh conversation, sir.",
  clear_chat: "Cleared the conversation, sir.",
  expand_all: "Expanded every panel, sir.",
  collapse_all: "Minimised every panel, sir.",
};

/** How often the brain polls the native operator. Only matters while this WebView is
 *  awake — the task itself runs natively either way. */
const OPERATOR_POLL_MS = 500;
/** Consecutive failed status reads before giving up on a task we can't see. */
const OPERATOR_POLL_FAILURES = 20;
/** Journal deadline: the operator's hard wall-clock ceiling plus headroom. The
 *  journal rejects every checkpoint past it, so the old soft 180s deadline here
 *  silently capped the operator's adaptive time extensions. */
const OPERATOR_JOURNAL_DEADLINE_MS = 450_000;

const A11Y_OFF_SUMMARY =
  "I can't control your phone yet, sir — I don't have Accessibility access, so I can't " +
  "see or touch the screen, and I haven't done anything. Turn on “JARVIS” in " +
  "Settings ▸ Accessibility ▸ Installed apps, then ask me again.";

/** isEnabled() passed (the switch is on in Settings) but native has no bound
 *  service: Android stopped it after the app crashed or was force-stopped, and
 *  won't rebind until the switch is cycled. "Turn it on" would confuse — it IS on. */
const A11Y_STALE_SUMMARY =
  "I can't control your phone right now, sir, and I haven't done anything. JARVIS's " +
  "Accessibility switch is on, but Android has stopped the service (it does that after " +
  "the app crashes or is force-stopped). Turn “JARVIS” off and on again in Settings ▸ " +
  "Accessibility ▸ Installed apps, then ask me again.";

/**
 * The model routes the native operator may use, best first, each resolved to a
 * concrete URL + auth by its provider. Same ladder as a chat turn, in the "dumb"
 * class under Auto: one small JSON command per step is mechanical work.
 */
async function operatorRoutes(cfg: BrainConfig): Promise<NativeRoute[]> {
  const out: NativeRoute[] = [];
  for (const r of usableRoutes(cfg, "dumb", false)) {
    try {
      const w = await providerFor(cfg, r.provider).wire(r);
      out.push({ provider: r.provider, keyIndex: r.keyIndex, ...w });
    } catch {
      // A missing key or a failed Vertex token just drops this route.
    }
  }
  return out;
}

/**
 * Run a whole on-phone task. The loop runs NATIVELY (OperatorCore.kt): a phone task
 * drives some other app, and a hidden WebView is paused ~60s after it leaves the
 * foreground, so this only starts the task and relays its progress. If this WebView
 * is paused mid-task, the task still finishes; the result is waiting when it wakes,
 * and a notification tells the user in the meantime.
 */
async function runPhone(deps: DispatchDeps, goal: string, stayInApp = false): Promise<ToolResult> {
  const g = goal.trim();
  if (!g) return { ok: false, summary: "What should I do on the phone, sir?" };
  if (!configReady(deps.config)) {
    return {
      ok: false,
      summary: "I need an API key first — set one in Settings.",
      error: "no_key",
    };
  }
  const phone = deps.platform.phone;
  if (!(await phone.isEnabled())) {
    // Take the user straight to the switch they need rather than leaving it to the
    // model to (maybe) call open_a11y_settings afterwards.
    await deps.platform.openAccessibilitySettings().catch(() => {});
    return { ok: false, summary: A11Y_OFF_SUMMARY, error: "accessibility_disabled" };
  }
  const routes = await operatorRoutes(deps.config);
  if (!routes.length) {
    return { ok: false, summary: quota.exhaustedMessage(), error: "rate_limited" };
  }

  const id = `phone_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  deps.onAgentEvent?.({ event: "agent_task", data: { id, kind: "phone", goal: g } });
  const end = (result: ToolResult, stopped = false): ToolResult => {
    deps.onAgentEvent?.({
      event: "agent_task_end",
      data: { id, ok: result.ok, summary: result.summary, stopped },
    });
    return result;
  };

  const begun = phone.beginTask
    ? await phone.beginTask({
        taskId: id,
        idempotencyKey: id,
        goal: g,
        deadlineAtMs: Date.now() + OPERATOR_JOURNAL_DEADLINE_MS,
        risk: "", // Kotlin classifies — one classifier for journal and policy alike
        capabilityProfileJson: JSON.stringify({
          version: 1,
          capabilities: ["android.accessibility", "android.intents"],
        }),
        typedPlanJson: JSON.stringify({
          version: 1,
          strategy: "observe-plan-act-verify",
          steps: [],
        }),
      })
    : { ok: false, summary: "The native task journal is unavailable." };
  if (!begun.ok) {
    return end({
      ok: false,
      summary: `I couldn't start a durable phone task: ${begun.summary}`,
      error: "task_journal_unavailable",
    });
  }
  const taskId = String((begun.data as { taskId?: string } | undefined)?.taskId || id);
  const giveUp = async (result: ToolResult): Promise<ToolResult> => {
    await phone.finishTask?.(taskId, "failed", result.summary).catch(() => undefined);
    return end(result);
  };

  // ── Consent is taken UP FRONT, not mid-task ────────────────────────────────
  // From the moment the task starts, JARVIS's own UI is behind WhatsApp/Chrome/…,
  // so a mid-task prompt is a question nobody sees. Native decides whether the goal
  // needs it (an external side effect — send, share, post, call); we ask now, while
  // the user is still looking at JARVIS and has just said what they want.
  const routesJson = JSON.stringify(routes);
  let started = await phone.operatorStart({
    taskId,
    goal: g,
    consent: false,
    routesJson,
    stayInApp,
  });
  if (started.needsConsent) {
    const decision = deps.authorizePhoneAction
      ? await deps.authorizePhoneAction({
          taskId,
          risk: "R2",
          action: "task",
          target: g.slice(0, 240),
          reason: `run this on your phone: ${g.slice(0, 160)}`,
          untrustedScreenText: "",
        })
      : "deny";
    if (decision === "deny") {
      return giveUp({
        ok: false,
        summary: "I didn't run that, sir — you didn't approve it.",
        error: "approval_denied",
      });
    }
    started = await phone.operatorStart({ taskId, goal: g, consent: true, routesJson, stayInApp });
  }
  if (!started.ok) {
    if (started.error === "accessibility_disabled") {
      await deps.platform.openAccessibilitySettings().catch(() => {});
      return giveUp({ ok: false, summary: A11Y_STALE_SUMMARY, error: "accessibility_disabled" });
    }
    return giveUp({
      ok: false,
      summary: `I couldn't start that on the phone: ${started.summary}`,
      error: started.error || "operator_start_failed",
    });
  }

  // ── Relay progress until the native task finishes ─────────────────────────
  let since = 0;
  let misses = 0;
  let stopSent = false;
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, OPERATOR_POLL_MS));
    if (!stopSent && deps.shouldStopPhoneTask?.()) {
      stopSent = true; // the native loop checks the journal before every action
      await phone.cancelTask?.(taskId).catch(() => undefined);
    }
    const st = await phone.operatorStatus(taskId, since);
    if (!st.ok) {
      // The process (and the native run registry) can die with the task mid-flight;
      // the journal then records it as suspended. Don't spin forever on a ghost.
      if (++misses >= OPERATOR_POLL_FAILURES) {
        return end({
          ok: false,
          summary:
            "I lost track of that phone task, sir — it may have been interrupted. " +
            "Please check the screen before asking again.",
          error: "operator_lost",
        });
      }
      continue;
    }
    misses = 0;
    for (const s of st.steps ?? []) {
      deps.onAgentEvent?.({ event: "agent_step", data: { id, line: s.line, ok: s.ok } });
    }
    since += st.steps?.length ?? 0;
    if (!st.done || !st.result) continue;

    for (const b of st.benched ?? []) benchFromNative(b);
    const r = st.result;
    const result: ToolResult = {
      ok: r.ok,
      summary: r.summary,
      ...(r.error ? { error: r.error } : {}),
      ...(r.needsApproval ? { needsApproval: true } : {}),
      data: { findings: r.findings, verificationReceipt: r.verificationReceipt },
    };
    if (result.error === "accessibility_disabled") {
      await deps.platform.openAccessibilitySettings().catch(() => {});
    }
    return end(result, !r.ok && r.error === "cancelled");
  }
}

/** Pin or clear the user's location (the `set_my_location` tool). */
async function setLocation(
  location: LocationService,
  action: string,
  place: string,
): Promise<ToolResult> {
  if (action === "clear") {
    location.clearPinned();
    return { ok: true, summary: "Cleared your pinned location — I'll auto-detect it again, sir." };
  }
  const p = place.trim();
  if (!p) return { ok: false, summary: "Which place should I pin, sir?" };
  location.setPinned(p);
  // Confirm it resolves so we don't silently pin an un-geocodable name.
  const coords = await location.coords();
  if (!coords) {
    location.clearPinned();
    return { ok: false, summary: `I couldn't find “${p}” on the map, sir.` };
  }
  return { ok: true, summary: `Pinned your location to ${coords.place || p}, sir.` };
}
