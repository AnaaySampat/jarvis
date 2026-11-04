import { useEffect, useState } from "react";
import "./setup-progress.css";

export default function BootOverlay({
  connected,
  onContinue,
  localAssistant = false,
}) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (connected) return;
    const start = Date.now();
    const timer = setInterval(
      () => setSecs(Math.floor((Date.now() - start) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [connected]);
  if (connected) return null;
  const native = Boolean(window.__TAURI_INTERNALS__);
  return (
    <div className="setup-overlay">
      <div
        className="setup-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="boot-title"
      >
        <div className="setup-kicker">
          {secs < 40 ? "Starting" : "Connection needs attention"}
        </div>
        <h1 id="boot-title" className="setup-title">
          JARVIS
        </h1>
        <p className="setup-sub" role="status">
          {secs < 40
            ? "Connecting to the assistant…"
            : localAssistant
              ? "The local assistant could not finish startup. Retry or use reading and steps."
              : "The desktop backend has not connected. You can retry or use local activities."}
        </p>
        <button type="button" className="setup-retry" onClick={onContinue}>
          Continue with local features
        </button>
        <button
          type="button"
          className="setup-retry"
          onClick={() => window.location.reload()}
        >
          Retry startup
        </button>
        <details className="setup-foot">
          <summary>Connection help</summary>
          <p>
            {localAssistant
              ? "The assistant runs in this app. Retry startup if local configuration could not load; you can still use reading and steps."
              : native
                ? "Restart JARVIS if the backend is unavailable. Backend diagnostics are in the app's backend.log."
                : "This desktop preview needs its backend running on this computer. Reading and steps work without it. The Android preview runs its assistant in the browser."}
          </p>
        </details>
      </div>
    </div>
  );
}
