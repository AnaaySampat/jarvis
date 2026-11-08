import { useEffect, useState } from "react";
import { LIVE_TOOL_STATES } from "../hooks/chatToolActivity";
import "./chat-tool-activity.css";

const LABELS = {
  queued: "Queued",
  running: "Running",
  waiting_for_approval: "Waiting for approval",
  completed: "Completed",
  failed: "Failed",
  stopped: "Stopped",
  unconfirmed: "Unconfirmed",
  not_run: "Not run",
};
const ICONS = {
  queued: "○",
  running: "◌",
  waiting_for_approval: "◷",
  completed: "✓",
  failed: "×",
  stopped: "■",
  unconfirmed: "?",
  not_run: "–",
};
const ATTENTION = new Set(["failed", "stopped", "unconfirmed", "not_run", "waiting_for_approval"]);
const duration = (ms) =>
  ms < 1000 ? `${Math.max(0, Math.round(ms))} ms` : `${(ms / 1000).toFixed(1)} s`;

export default function ChatToolActivity({ rows = [], finished = false, onOpenTasks, onStopTask }) {
  const active = !finished && rows.some((row) => LIVE_TOOL_STATES.has(row.state));
  const attention = rows.some((row) => ATTENTION.has(row.state));
  const [choice, setChoice] = useState(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [active]);
  if (!rows.length) return null;
  const expanded = choice ?? (!finished || attention);
  const roots = rows.filter(
    (row) => !row.parentId || !rows.some((parent) => parent.id === row.parentId),
  );
  const visible = expanded
    ? roots
    : roots.filter(
        (row) =>
          ATTENTION.has(row.state) ||
          rows.some((child) => child.parentId === row.id && ATTENTION.has(child.state)),
      );
  const completed = rows.filter((row) => row.state === "completed").length;
  return (
    <section className="chat-tools" aria-label="Tools used">
      <button
        type="button"
        className="chat-tools-toggle"
        aria-expanded={expanded}
        onClick={() => setChoice(!expanded)}
      >
        <span>
          Tools used <span className="chat-tools-count">{rows.length}</span>
        </span>
        <span className="chat-tools-overview">
          {!finished ? "Working…" : `${completed} completed`}
          {attention ? " · Needs attention" : ""} {expanded ? "⌃" : "⌄"}
        </span>
      </button>
      {visible.length > 0 && (
        <ul className="chat-tools-list">
          {visible.map((row) => (
            <li key={row.id} className={`chat-tool chat-tool--${row.state}`}>
              <details>
                <summary>
                  <span className="chat-tool-icon" aria-hidden="true">
                    {ICONS[row.state] || "?"}
                  </span>
                  <span className="chat-tool-name">
                    <span>{row.title}</span>
                    <code>{row.tool}</code>
                  </span>
                  <span className="chat-tool-state">{LABELS[row.state] || "Unconfirmed"}</span>
                </summary>
                <dl className="chat-tool-details">
                  <dt>Input</dt>
                  <dd>{row.input}</dd>
                  <dt>Result</dt>
                  <dd>
                    {row.summary ||
                      (row.state === "waiting_for_approval"
                        ? "Waiting for your decision."
                        : "No result yet.")}
                  </dd>
                  <dt>Elapsed</dt>
                  <dd>{duration(row.elapsedMs ?? Math.max(0, now - row.startedAt))}</dd>
                </dl>
                {row.steps?.length > 0 && (
                  <ol className="chat-tool-progress" aria-label="Task progress">
                    {row.steps.map((step) => (
                      <li key={step.id}>
                        <span>
                          {
                            {
                              plan: "Plan received",
                              tap: "Tap step",
                              type: "Text entry step",
                              scroll: "Scroll step",
                              open: "Navigation step",
                              search: "Search step",
                              wait: "Wait step",
                              check: "Check step",
                              step: "Task step",
                            }[step.kind]
                          }
                        </span>
                        <span>
                          {step.state === "planned"
                            ? "Planned"
                            : step.state === "failed"
                              ? "Failed"
                              : "Reported"}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
                {row.taskId && (
                  <div className="chat-tool-controls">
                    {onOpenTasks && (
                      <button type="button" onClick={onOpenTasks}>
                        View tasks
                      </button>
                    )}
                    {!finished && LIVE_TOOL_STATES.has(row.state) && onStopTask && (
                      <button type="button" onClick={() => onStopTask(row.taskId)}>
                        Stop task
                      </button>
                    )}
                  </div>
                )}
                {rows.some((child) => child.parentId === row.id) && (
                  <ChatToolActivity
                    rows={rows
                      .filter(
                        (child) =>
                          child.parentId === row.id ||
                          rows.some(
                            (parent) => parent.parentId === row.id && child.parentId === parent.id,
                          ),
                      )
                      .map((child) =>
                        child.parentId === row.id ? { ...child, parentId: undefined } : child,
                      )}
                    finished={finished}
                    onOpenTasks={onOpenTasks}
                    onStopTask={onStopTask}
                  />
                )}
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
