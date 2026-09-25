import { useState } from "react";
import StateMessage from "./StateMessage";
import ModalPanel from "./ModalPanel";
import { stepIcon } from "../hooks/agentActivity";

const STATUS = {
  accepted: { label: "accepted", cls: "activity-pill--run" },
  queued: { label: "queued", cls: "activity-pill--run" },
  recovering: { label: "recovering…", cls: "activity-pill--run" },
  planning: { label: "planning…", cls: "activity-pill--run" },
  policy_check: { label: "policy check…", cls: "activity-pill--run" },
  executing: { label: "executing…", cls: "activity-pill--run" },
  verifying: { label: "verifying…", cls: "activity-pill--run" },
  waiting_for_unlock: { label: "waiting for unlock", cls: "activity-pill--wait" },
  waiting_for_approval: { label: "approval needed", cls: "activity-pill--wait" },
  suspended: { label: "suspended safely", cls: "activity-pill--wait" },
  cancelling: { label: "stopping…", cls: "activity-pill--fail" },
  cancelled: { label: "cancelled", cls: "activity-pill--fail" },
  succeeded: { label: "verified ✓", cls: "activity-pill--ok" },
  running: { label: "running…", cls: "activity-pill--run" },
  done: { label: "done ✓", cls: "activity-pill--ok" },
  failed: { label: "failed ✕", cls: "activity-pill--fail" },
  stopped: { label: "stopped", cls: "activity-pill--fail" },
};

const TERMINAL = new Set(["succeeded", "failed", "cancelled", "done", "stopped"]);
const ACTUATING = new Set([
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

function taskIcon(task) {
  if (task.kind === "phone" || task.source === "phone") return "PH";
  if (task.kind === "browser") return "WEB";
  return "PC";
}

function printable(value) {
  if (typeof value === "string") return value;
  try {
    const text = JSON.stringify(value);
    return text.length > 600 ? `${text.slice(0, 600)}…` : text;
  } catch {
    return String(value || "");
  }
}

function planLines(plan) {
  if (!Array.isArray(plan)) return [];
  return plan.map((step, index) => {
    if (typeof step === "string") return step;
    if (!step || typeof step !== "object") return `Step ${index + 1}`;
    return step.description || step.action || step.type || step.step_id || `Step ${index + 1}`;
  });
}

function approvalExpiry(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

export default function AgentActivity({ tasks, onClose, onClear, onStopTask, onStopAll }) {
  const [zoom, setZoom] = useState(null);
  const ordered = [...(tasks || [])].sort(
    (a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0),
  );
  const hasActive = ordered.some((task) => ACTUATING.has(task.status));

  return (
    <ModalPanel
      title="Task Center"
      onClose={onClose}
      className="activity-panel"
      actions={
        <div className="activity-hdr-actions">
          {hasActive && onStopAll && (
            <button className="activity-stop-all" onClick={onStopAll}>
              STOP ALL
            </button>
          )}
          {ordered.length > 0 && (
            <button className="activity-clear" onClick={onClear}>
              Clear finished
            </button>
          )}
        </div>
      }
    >
      <>
        {ordered.length === 0 ? (
          <StateMessage variant="empty" icon="inbox" title="No tasks yet">
            PC and phone work you hand to JARVIS appears here with live progress, recovery
            details and the evidence it verified against.
          </StateMessage>
        ) : (
          <div className="activity-list">
            {ordered.map((task) => {
              const status = STATUS[task.status] || STATUS.running;
              const plan = planLines(task.plan);
              const canStop = !TERMINAL.has(task.status);
              return (
                <article key={task.id} className="activity-task">
                  <div className="activity-task-hd">
                    <span className="activity-task-ico">{taskIcon(task)}</span>
                    <span className="activity-task-goal">{task.goal || "Aura task"}</span>
                    <span className={`activity-pill ${status.cls}`}>{status.label}</span>
                    {canStop && onStopTask && (
                      <button
                        className="activity-task-stop"
                        onClick={() => onStopTask(task.id)}
                        aria-label={`Stop ${task.goal || "task"}`}
                      >
                        Stop
                      </button>
                    )}
                  </div>

                  <div className="activity-meta">
                    <span>
                      {task.source === "phone" || task.kind === "phone"
                        ? "On this phone"
                        : "Windows host"}
                    </span>
                    {Number.isFinite(Number(task.currentStep)) && Number(task.currentStep) > 0 && (
                      <span>
                        Step {task.currentStep}
                        {plan.length ? ` of ${plan.length}` : ""}
                      </span>
                    )}
                    {task.risk && <span>{task.risk}</span>}
                  </div>

                  {task.recoveryInfo && (
                    <div className="activity-notice activity-notice--recovery">
                      Recovery: {task.recoveryInfo}
                    </div>
                  )}
                  {task.retryInfo && <div className="activity-notice">Retry: {task.retryInfo}</div>}
                  {task.waitingReason && (
                    <div className="activity-notice activity-notice--waiting">
                      Waiting: {task.waitingReason}
                    </div>
                  )}

                  {task.approval && (
                    <div className="activity-approval" role="status">
                      <div className="activity-approval-title">
                        {task.approval.risk || "R2"} approval required
                      </div>
                      {task.approval.action && <div>Action: {task.approval.action}</div>}
                      {task.approval.target && <div>Target: {task.approval.target}</div>}
                      {task.approval.consequence && (
                        <div>Consequence: {task.approval.consequence}</div>
                      )}
                      {task.approval.expiresAt && (
                        <div>Expires: {approvalExpiry(task.approval.expiresAt)}</div>
                      )}
                      <div className="activity-approval-note">
                        Display only — approve this exact action on the trusted host.
                      </div>
                    </div>
                  )}

                  {plan.length > 0 && (
                    <ol className="activity-plan" aria-label="Current plan">
                      {plan.map((line, index) => (
                        <li
                          key={`${index}:${line}`}
                          className={
                            index < Number(task.currentStep || 0) ? "activity-plan--done" : ""
                          }
                        >
                          {line}
                        </li>
                      ))}
                    </ol>
                  )}

                  {task.summary && task.status !== "running" && (
                    <div className="activity-summary">{task.summary}</div>
                  )}
                  {task.proof && (
                    <div className="activity-proof">
                      <span>Verification evidence</span>
                      {printable(task.proof)}
                    </div>
                  )}

                  <div className="activity-timeline">
                    {(task.items || []).map((item, index) =>
                      item.kind === "shot" ? (
                        <img
                          key={item.receiptKey || index}
                          className="activity-shot"
                          src={item.image}
                          alt="Task evidence screenshot"
                          loading="lazy"
                          onClick={() => setZoom(item.image)}
                        />
                      ) : (
                        <div
                          key={item.receiptKey || index}
                          className={`activity-step${item.ok === false ? " activity-step--fail" : ""}`}
                        >
                          <span className="activity-step-ico">{stepIcon(item.line)}</span>
                          <span className="activity-step-txt">{item.line}</span>
                        </div>
                      ),
                    )}
                    {ACTUATING.has(task.status) && (
                      <div className="activity-step activity-step--live">
                        <span className="activity-step-ico">⏳</span>
                        <span className="activity-step-txt">
                          {task.status === "verifying"
                            ? "checking postconditions and collecting proof…"
                            : task.status === "cancelling"
                              ? "invalidating actuator lease…"
                              : "working from the last verified checkpoint…"}
                        </span>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <div className="activity-foot">
          Tasks survive interface recreation and reconnects. Aura reports success only after
          verification. Approval cards are read-only until signed device approvals are available.
        </div>

        {zoom && (
          <div
            className="activity-lightbox"
            onClick={(event) => {
              event.stopPropagation();
              setZoom(null);
            }}
          >
            <img src={zoom} alt="Task evidence" onClick={(event) => event.stopPropagation()} />
            <button
              className="activity-lightbox-x"
              onClick={(event) => {
                event.stopPropagation();
                setZoom(null);
              }}
              aria-label="Close evidence preview"
            >
              ✕
            </button>
          </div>
        )}
      </>
    </ModalPanel>
  );
}
