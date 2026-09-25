import { useEffect, useState } from "react";
import "./setup-progress.css";

// First-run setup screen: the installer bundles the runtime components (browser
// engine, speech model, neural voice), but if one is ever missing/corrupt JARVIS
// re-fetches it here. Driven by the backend's `setup_progress` websocket events
// (see provisioning.py). `onRepair` re-runs setup for any failed component.
export default function SetupProgress({ progress, onRepair }) {
  const [dismissed, setDismissed] = useState(false);
  const [retried, setRetried] = useState(false);

  const order = progress?.order || [];
  const items = progress?.items || {};
  const anyError = order.some((k) => items[k]?.status === "error");

  // Linger a beat after a CLEAN completion, then fade out. A completion WITH errors
  // stays put so the user can read it and hit Retry — never auto-dismissed.
  useEffect(() => {
    if (!progress?.complete || anyError) return;
    const t = setTimeout(() => setDismissed(true), 1900);
    return () => clearTimeout(t);
  }, [progress, progress?.complete, anyError]);

  // Each new progress frame: un-dismiss unless it's a clean finish, and clear the
  // "retrying…" affordance once a fresh run streams again. Done during render.
  const [seenProgress, setSeenProgress] = useState(progress);
  if (progress !== seenProgress) {
    setSeenProgress(progress);
    if (progress && !(progress.complete && !anyError)) setDismissed(false);
    if (progress && !progress.complete) setRetried(false);
  }

  if (!progress || dismissed) return null;

  const total = progress.total || order.length || 1;
  const done = order.filter((k) => {
    const st = items[k]?.status;
    return st === "done" || st === "error";
  }).length;
  const pct = progress.complete ? 100 : Math.round((done / total) * 100);
  const failed = order.filter((k) => items[k]?.status === "error");
  const showRetry = progress.complete && anyError && !!onRepair;

  const handleRetry = () => {
    if (onRepair) onRepair();
    setRetried(true);
  };

  return (
    <div className="setup-overlay">
      <div className="setup-card" role="status" aria-label="First-run setup">
        <div className="setup-ring" aria-hidden="true">
          <span className="setup-ring-core" />
        </div>
        <div className="setup-kicker">{anyError ? "SETUP — ACTION NEEDED" : "FIRST-RUN SETUP"}</div>
        <div className="setup-title">Initialising J.A.R.V.I.S</div>
        <div className="setup-sub">
          {anyError
            ? "A component couldn't be set up, sir. The rest are ready — retry the missing one below."
            : "Preparing a few one-time components, sir. This happens only once."}
        </div>

        <ul className="setup-list">
          {order.map((k) => {
            const it = items[k] || {};
            return (
              <li key={k} className={`setup-row setup-row--${it.status}`}>
                <span className="setup-row-icon" aria-hidden="true">
                  {it.status === "done" ? (
                    "✓"
                  ) : it.status === "error" ? (
                    "!"
                  ) : (
                    <span className="setup-spinner" />
                  )}
                </span>
                <span className="setup-row-label">{it.label || k}</span>
                <span className="setup-row-status">
                  {it.status === "downloading"
                    ? "downloading…"
                    : it.status === "done"
                      ? "ready"
                      : it.status === "error"
                        ? "failed"
                        : "queued"}
                </span>
              </li>
            );
          })}
        </ul>

        {anyError && failed.some((k) => items[k]?.error) && (
          <div className="setup-error-detail">
            {failed.map((k) => items[k]?.error).filter(Boolean)[0]}
          </div>
        )}

        <div className="setup-bar">
          <div className="setup-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="setup-foot">
          {progress.complete
            ? anyError
              ? `${failed.length} component${failed.length === 1 ? "" : "s"} need setup`
              : "All set, sir."
            : `${done} of ${total} ready`}
        </div>

        {showRetry && (
          <button className="setup-retry" onClick={handleRetry} disabled={retried}>
            {retried ? "Retrying…" : "Retry setup"}
          </button>
        )}
      </div>
    </div>
  );
}
