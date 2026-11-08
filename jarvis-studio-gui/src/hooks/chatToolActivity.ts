import { sanitizeActivity, type ToolActivityEvent, type ToolProgress } from "../brain/toolActivity";
export const LIVE_TOOL_STATES = new Set(["queued", "running", "waiting_for_approval"]);
export interface ChatToolRow extends ToolActivityEvent {
  startedAt: number;
  steps?: ToolProgress[];
}
export interface ToolChatMessage {
  id: string;
  role: string;
  text: string;
  toolActivity?: ChatToolRow[];
  streaming?: boolean;
  finalized?: boolean;
  actions?: unknown[];
}
/** Updates are keyed by invocation, so concurrent calls never replace one another. */
export function updateChatToolActivity<T extends ToolChatMessage>(
  messages: T[],
  replyId: string,
  event: ToolActivityEvent,
  allowCreate = false,
): Array<T | ToolChatMessage> {
  const safe = sanitizeActivity(event);
  if (!safe) return messages;
  event = safe;
  const exists = messages.some((m) => m.id === replyId);
  if (!exists && !allowCreate) return messages;
  const list: ToolChatMessage[] = exists
    ? messages
    : [...messages, { id: replyId, role: "jarvis", text: "", streaming: true, finalized: false }];
  return list.map((message) => {
    if (message.id !== replyId) return message;
    const rows = message.toolActivity ?? [];
    const previous = rows.find((row) => row.id === event.id);
    if (
      previous &&
      ((!LIVE_TOOL_STATES.has(previous.state) && LIVE_TOOL_STATES.has(event.state)) ||
        event.at < previous.at)
    )
      return message;
    const steps = previous?.steps ?? [];
    const next: ChatToolRow = {
      ...previous,
      ...event,
      startedAt: previous?.startedAt ?? event.at,
      ...(event.progress
        ? {
            steps: [
              ...steps.filter((step) => step.id !== event.progress!.id),
              event.progress,
            ].slice(-32),
          }
        : {}),
    };
    return {
      ...message,
      toolActivity: previous
        ? rows.map((row) => (row.id === event.id ? next : row))
        : [...rows, next],
    };
  });
}

export function safeToolRows(rows: unknown, interrupted = false): ChatToolRow[] {
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  const projected: ChatToolRow[] = rows.slice(0, 128).flatMap((raw) => {
    const event = sanitizeActivity(raw);
    if (!event || seen.has(event.id)) return [];
    seen.add(event.id);
    const row: ChatToolRow = {
      ...event,
      startedAt: Number.isFinite(raw.startedAt) ? raw.startedAt : event.at,
    };
    if (Array.isArray(raw.steps))
      row.steps = raw.steps.slice(-32).flatMap((step: ToolProgress) => {
        const safe = sanitizeActivity({ ...event, progress: step });
        return safe?.progress ? [safe.progress] : [];
      });
    if (interrupted && LIVE_TOOL_STATES.has(row.state)) {
      row.state = "unconfirmed";
      row.summary = "Interrupted. Check the saved task before retrying.";
      row.elapsedMs = row.elapsedMs ?? 0;
    }
    return [row];
  });
  for (const row of projected) {
    const visited = new Set([row.id]);
    let next = row.parentId;
    while (next) {
      if (visited.has(next) || visited.size > 4) {
        delete row.parentId;
        break;
      }
      visited.add(next);
      const parent = projected.find((p) => p.id === next);
      if (!parent) {
        delete row.parentId;
        break;
      }
      next = parent.parentId;
    }
  }
  return projected;
}
export function finishChatToolReply<T extends ToolChatMessage>(
  messages: T[],
  reply: ToolChatMessage,
): ToolChatMessage[] {
  const existing = messages.find((m) => m.id === reply.id);
  const toolActivity = existing?.toolActivity?.map((row): ChatToolRow =>
    LIVE_TOOL_STATES.has(row.state)
      ? {
          ...row,
          state: row.state === "queued" ? "not_run" : "unconfirmed",
          at: Date.now(),
          elapsedMs: Math.max(0, Date.now() - row.startedAt),
          summary:
            row.state === "queued"
              ? "Not run before the request ended."
              : "The request ended without a confirmed result.",
        }
      : row,
  );
  const next = {
    ...existing,
    ...reply,
    ...(toolActivity ? { toolActivity } : {}),
    streaming: false,
    finalized: true,
  };
  return existing ? messages.map((m) => (m.id === reply.id ? next : m)) : [...messages, next];
}
