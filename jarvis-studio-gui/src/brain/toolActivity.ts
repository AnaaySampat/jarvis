import type { ActionSpec, ToolResult } from "./types";
import { agentResult, resultId, type AgentResult } from "./results";

export type ToolActivityState =
  | "queued"
  | "running"
  | "waiting_for_approval"
  | "completed"
  | "failed"
  | "stopped"
  | "unconfirmed"
  | "not_run";
export interface ToolActivityContext {
  id: string;
  tool: string;
  title: string;
  input: string;
  parentId?: string;
  taskId?: string;
}
export interface ToolProgress {
  id: string;
  kind: "plan" | "tap" | "type" | "scroll" | "open" | "search" | "wait" | "check" | "step";
  state: "reported" | "failed" | "planned";
  at: number;
}
export interface ToolActivityEvent extends ToolActivityContext {
  state: ToolActivityState;
  at: number;
  summary?: string;
  elapsedMs?: number;
  progress?: ToolProgress;
}
export type ToolActivityObserver = (event: ToolActivityEvent) => void;
const TITLES: Record<string, string> = {
  web_search: "Search the web",
  read_webpage: "Read a web page",
  get_weather: "Check weather",
  get_news: "Read news",
  get_time: "Check the time",
  get_day: "Check the date",
  set_volume: "Set media volume",
  set_timer: "Set a timer",
  set_alarm: "Set an alarm",
  manage_clock: "Check or change Clock",
  device_control: "Control the phone",
  open_application: "Open an app",
  close_application: "Close an app",
  open_website: "Open a website",
  send_message: "Send a message",
  call_contact: "Place a call",
  navigate_to: "Start navigation",
  play_media: "Play media",
  read_notifications: "Read notifications",
  read_clipboard: "Read clipboard",
  read_file: "Read a file",
  list_directory: "List a folder",
  open_saved_file: "Open a saved file",
  manage_schedule: "Manage the agenda",
  set_reminder: "Set a reminder",
  manage_routine: "Manage a routine",
  manage_playbook: "Manage a playbook",
  remember_fact: "Remember information",
  forget_fact: "Forget information",
  generate_image: "Generate an image",
  make_qr_code: "Create a QR code",
  take_screenshot: "Take a screenshot",
  customize_screen: "Customize JARVIS",
  control_interface: "Control JARVIS",
  clear_conversation: "Clear the chat",
  phone_task: "Run a phone task",
  pc_task: "Run a PC task",
  pc_screenshot: "Check the PC screen",
  tv_control: "Control the TV",
  wake_pc: "Wake the PC",
  find_places: "Find places",
  get_directions: "Get directions",
  set_my_location: "Set location",
  consult_agent: "Consult an agent",
  read_agent_result: "Read saved results",
  check_action_outcome: "Check an action outcome",
  request_tool_access: "Request tool access",
  enable_phone_control: "Set up phone control",
  load_tools: "Load tool group",
};
const NAMES: Record<string, string> = {
  search_web: "web_search",
  weather: "get_weather",
  news: "get_news",
  time: "get_time",
  day: "get_day",
  open_app: "open_application",
  close_app: "close_application",
  open_url: "open_website",
  device: "device_control",
  message: "send_message",
  call: "call_contact",
  navigate: "navigate_to",
  notifications: "read_notifications",
  clipboard: "read_clipboard",
  list_dir: "list_directory",
  open_file: "open_saved_file",
  schedule: "manage_schedule",
  reminder: "set_reminder",
  routine: "manage_routine",
  playbook: "manage_playbook",
  remember: "remember_fact",
  forget: "forget_fact",
  screenshot: "take_screenshot",
  qr_code: "make_qr_code",
  screen: "customize_screen",
  ui: "control_interface",
};
export function activityToolName(spec: ActionSpec): string {
  if (spec.type === "clock")
    return spec.do === "timer" ? "set_timer" : spec.do === "alarm" ? "set_alarm" : "manage_clock";
  return Object.hasOwn(NAMES, spec.type) ? NAMES[spec.type] : spec.type;
}
/** Only explicitly harmless numeric inputs leave the execution layer. Never raw arguments. */
export function toolActivity(
  name: string,
  args: Record<string, unknown> = {},
  id: string = resultId(),
): ToolActivityContext {
  const tool = Object.hasOwn(TITLES, name) ? name : "unknown_tool";
  args = args && typeof args === "object" && !Array.isArray(args) ? args : {};
  const integer = (value: unknown, min: number, max: number) =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max
      ? value
      : undefined;
  let input = "Inputs kept private";
  const volume = integer(args.level, 0, 100),
    seconds = integer(args.seconds, 1, 2147483647);
  const hour = integer(args.hour, 0, 23),
    minute = integer(args.minute, 0, 59);
  if (tool === "set_volume" && volume !== undefined) input = `Media volume: ${volume}%`;
  else if (tool === "set_timer" && seconds !== undefined) input = `Duration: ${seconds} seconds`;
  else if (tool === "set_alarm" && hour !== undefined && minute !== undefined)
    input = `Time: ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  else if (
    tool === "consult_agent" &&
    ["research", "files", "scheduling", "content"].includes(String(args.agent))
  )
    input = `Agent: ${args.agent}`;
  else if (["get_time", "get_day", "get_weather"].includes(tool)) input = "No input required";
  return { id, tool, title: TITLES[tool] ?? "Unrecognized tool", input };
}
export function emitToolActivity(
  observer: ToolActivityObserver | undefined,
  context: ToolActivityContext,
  state: ToolActivityState,
  details: Pick<ToolActivityEvent, "summary" | "elapsedMs"> = {},
): void {
  try {
    observer?.({ ...context, state, at: Date.now(), ...details });
  } catch {
    /* Display observers must never change execution. */
  }
}

/** Classifies a task step without forwarding its screen text or message body. */
export function taskProgress(
  observer: ToolActivityObserver | undefined,
  context: ToolActivityContext,
  event: { event: string; data?: unknown; taskId?: string; seq?: number },
  sequence: number,
): void {
  const data =
    event.data && typeof event.data === "object" ? (event.data as Record<string, unknown>) : {};
  const kindName = String(data.event ?? data.type ?? data.kind ?? event.event);
  const payload =
    data.payload && typeof data.payload === "object"
      ? (data.payload as Record<string, unknown>)
      : data.data && typeof data.data === "object"
        ? (data.data as Record<string, unknown>)
        : data;
  const action =
    payload.action && typeof payload.action === "object"
      ? (payload.action as Record<string, unknown>)
      : {};
  const line = String(
    payload.line ?? action.type ?? action.action ?? payload.action ?? payload.description ?? "",
  ).toLowerCase();
  const taskId = event.taskId ?? (typeof data.id === "string" ? data.id : undefined);
  if (
    event.event === "agent_task" ||
    event.event === "task.accepted" ||
    event.event === "task.status"
  ) {
    emitToolActivity(observer, { ...context, taskId }, "running");
    return;
  }
  if (
    /approval.challenge|waiting_for_approval/.test(kindName) ||
    payload.state === "waiting_for_approval"
  ) {
    emitToolActivity(observer, { ...context, taskId }, "waiting_for_approval");
    return;
  }
  if (!/agent_step|step|progress/.test(kindName)) return;
  const kind: ToolProgress["kind"] = /^plan:/.test(line)
    ? "plan"
    : /tap|click/.test(line)
      ? "tap"
      : /type|input/.test(line)
        ? "type"
        : /scroll|swipe/.test(line)
          ? "scroll"
          : /open|navigat/.test(line)
            ? "open"
            : /search/.test(line)
              ? "search"
              : /wait/.test(line)
                ? "wait"
                : /check|verif|look|observe/.test(line)
                  ? "check"
                  : "step";
  const cursor =
    Number.isSafeInteger(event.seq) && event.seq! > 0
      ? event.seq
      : Number.isSafeInteger(data.stepSeq) && Number(data.stepSeq) > 0
        ? data.stepSeq
        : sequence;
  const progress: ToolProgress = {
    id: `${context.id}:step:${cursor}`,
    kind,
    state:
      kind === "plan"
        ? "planned"
        : payload.ok === false || /failed|failure|error/.test(kindName)
          ? "failed"
          : "reported",
    at: Date.now(),
  };
  try {
    observer?.({ ...context, taskId, state: "running", at: Date.now(), progress });
  } catch {
    /* Observer only. */
  }
}

/** Re-project on storage as well as emission; never trust arbitrary metadata. */
export function sanitizeActivity(event: ToolActivityEvent): ToolActivityEvent | null {
  const id = (v: unknown) =>
    typeof v === "string" && /^[a-zA-Z0-9_:.-]{1,200}$/.test(v) ? v : undefined;
  if (
    !event ||
    !id(event.id) ||
    !Number.isFinite(event.at) ||
    ![
      "queued",
      "running",
      "waiting_for_approval",
      "completed",
      "failed",
      "stopped",
      "unconfirmed",
      "not_run",
    ].includes(event.state)
  )
    return null;
  const base = toolActivity(event.tool, {}, event.id);
  if (
    /^(Media volume: (?:100|\d{1,2})%|Duration: \d{1,10} seconds|Time: (?:[01]\d|2[0-3]):[0-5]\d|Agent: (?:research|files|scheduling|content)|No input required)$/.test(
      event.input,
    )
  )
    base.input = event.input;
  const summary = {
    queued: "Waiting to run.",
    running: "The tool is running.",
    waiting_for_approval: "Waiting for your decision.",
    completed: "The tool's result was confirmed.",
    failed: "The tool reported a failure.",
    stopped: "Stopped; check any already-started action.",
    unconfirmed: "The outcome is unconfirmed. Check before retrying.",
    not_run: "The call was not run.",
  }[event.state];
  const progress =
    event.progress &&
    id(event.progress.id) &&
    ["plan", "tap", "type", "scroll", "open", "search", "wait", "check", "step"].includes(
      event.progress.kind,
    ) &&
    ["reported", "failed", "planned"].includes(event.progress.state) &&
    Number.isFinite(event.progress.at)
      ? {
          id: event.progress.id,
          kind: event.progress.kind,
          state: event.progress.state,
          at: event.progress.at,
        }
      : undefined;
  return {
    ...base,
    state: event.state,
    at: event.at,
    summary,
    ...(id(event.parentId) ? { parentId: event.parentId } : {}),
    ...(id(event.taskId) ? { taskId: event.taskId } : {}),
    ...(Number.isFinite(event.elapsedMs) && event.elapsedMs! >= 0
      ? { elapsedMs: Math.min(event.elapsedMs!, 604800000) }
      : {}),
    ...(progress ? { progress } : {}),
  };
}
export function finishToolActivity(
  observer: ToolActivityObserver | undefined,
  context: ToolActivityContext,
  result: ToolResult,
  started: number,
  ran = true,
): void {
  const receipt = agentResult(result, "", context.tool);
  const acted = (result.data as { acted?: boolean } | undefined)?.acted === true;
  const refused =
    !acted &&
    /^(blocked|not_offered|not_implemented|permission_required|capability_unavailable|approval_denied|approval_unavailable|accessibility_disabled)$/.test(
      result.error ?? "",
    );
  const state: ToolActivityState = !ran
    ? "not_run"
    : result.error === "cancelled"
      ? "stopped"
      : acted && !receipt.ok
        ? "unconfirmed"
        : refused
          ? "not_run"
          : receipt.status === "unverified" || receipt.status === "partial"
            ? "unconfirmed"
            : receipt.status === "blocked"
              ? "not_run"
              : receipt.ok
                ? "completed"
                : "failed";
  // Do not echo message bodies, file contents, model responses, URLs or exception payloads.
  const reasons: Record<string, string> = {
    invalid_tool_call: "Not run. The tool name or arguments were rejected.",
    not_offered: "Not run. This tool is unavailable for this request.",
    permission_required: "Not run. Access is required before this tool can run.",
    capability_unavailable: "Not run. This tool is unavailable on this installation.",
    approval_denied: "Not run. You did not approve this action.",
    approval_unavailable: "Not run. Approval could not be requested.",
    duplicate_operation: "Not run. This action was already attempted.",
    retry_refused: "Not run. Repeating the earlier action could duplicate its effects.",
    uncertain_previous_effect: "Not run. An earlier action still needs confirmation.",
    observe_before_continue: "Not run. Current state must be checked before continuing.",
  };
  const summary =
    state === "completed"
      ? "The tool returned a verified result."
      : state === "unconfirmed"
        ? "The requested outcome is not confirmed. Check before retrying."
        : state === "stopped"
          ? "Stopped. Any already-started action still needs its receipt."
          : state === "not_run"
            ? Object.hasOwn(reasons, result.error ?? "")
              ? reasons[result.error!]
              : "Not run. The call was blocked or already completed."
            : "The tool reported a failure.";
  emitToolActivity(observer, context, state, {
    summary,
    elapsedMs: Math.max(0, Date.now() - started),
  });
}

/** Only call with a receipt already normalized and committed by the workflow journal. */
export function reconcileToolActivity(
  observer: ToolActivityObserver | undefined,
  context: ToolActivityContext,
  receipt: AgentResult,
  started: number,
): void {
  const state =
    receipt.status === "succeeded"
      ? "completed"
      : receipt.status === "failed"
        ? "failed"
        : "unconfirmed";
  emitToolActivity(observer, context, state, {
    elapsedMs: Math.max(0, Date.now() - started),
    summary:
      state === "completed"
        ? "The original action's result was confirmed."
        : state === "failed"
          ? "The original action returned a failure."
          : "The original outcome is still unconfirmed.",
  });
}
