/* Shared agent-activity-feed reducer — used by both useWebSocket (desktop/paired-PC
 * events over the socket) and useBrain (in-app brain / RemotePC events on the phone),
 * so autopilot tasks render identically no matter which transport produced them. */

export const AGENT_TASK_CAP = 10; // keep the last N autopilot tasks in the activity feed

/** Emoji for a browser/phone-operator step line — shared by AgentActivity and
 *  BrowserPanel (both render the same kind of step feed). ControlOverlay keeps its
 *  own mapping: it covers desktop computer-control steps, a different vocabulary
 *  where the same words (e.g. "open") mean something else (launching an app, not
 *  navigating a page), so merging it in would silently change its icons. */
export function stepIcon(line) {
  const s = (line || "").toLowerCase();
  if (s.startsWith("plan:")) return "🧭";
  if (s.startsWith("✗") || s.includes("failed") || s.includes("couldn't")) return "✕";
  if (s.includes("click")) return "🖱";
  if (s.includes("type") || s.includes("typed")) return "⌨";
  if (s.includes("scroll")) return "↕";
  if (s.includes("search")) return "🔍";
  if (s.includes("navigat") || s.includes("open") || s.includes("goto") || s.includes("went"))
    return "🌐";
  if (s.includes("wait")) return "⏳";
  if (s.includes("back")) return "↩";
  if (s.includes("look") || s.includes("screenshot") || s.includes("see")) return "📷";
  if (s.includes("note")) return "📝";
  if (s.includes("done")) return "✓";
  return "•";
}

/** Normalise a raw base64 `agent_shot` payload into an <img>-ready src. */
export function agentImageSrc(image) {
  const s = String(image || "").trim();
  if (!s) return "";
  if (/^(data:|blob:|https?:)/i.test(s)) return s;
  return `data:image/jpeg;base64,${s}`;
}

/**
 * Fold an agent_task/agent_step/agent_shot/agent_task_end event into the activity feed
 * (one task → steps + shots + final status). `opts.imageSrc` lets a caller normalise the
 * `agent_shot` image payload (the phone's RemotePC events arrive as bare base64; the
 * desktop socket's are already a ready-to-use src) — defaults to passing it through as-is.
 */
export function reduceAgentEvent(prev, ev, opts = {}) {
  const toImageSrc = opts.imageSrc || ((image) => image);
  const d = ev.data || {};
  switch (ev.event) {
    case "agent_task":
      if (!d.id) return prev;
      return [
        ...prev.filter((t) => t.id !== d.id),
        { id: d.id, kind: d.kind, goal: d.goal || "", items: [], status: "running", summary: "" },
      ].slice(-AGENT_TASK_CAP);
    case "agent_step":
      return prev.map((t) =>
        t.id === d.id
          ? { ...t, items: [...t.items, { kind: "step", line: d.line || "", ok: d.ok !== false }] }
          : t,
      );
    case "agent_shot": {
      const image = toImageSrc(d.image);
      if (!image) return prev;
      return prev.map((t) => {
        if (t.id !== d.id) return t;
        return { ...t, items: [...t.items, { kind: "shot", image }] };
      });
    }
    case "agent_task_end":
      return prev.map((t) =>
        t.id === d.id
          ? {
              ...t,
              status: d.stopped ? "stopped" : d.ok ? "done" : "failed",
              summary: d.summary || "",
            }
          : t,
      );
    default:
      return prev;
  }
}
