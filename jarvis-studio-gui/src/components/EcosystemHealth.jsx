import { useCallback, useEffect, useState } from "react";
import {
  readEcosystemHealth,
  exportDiagnostics,
  androidPlatform,
  requestNotificationAccess,
} from "../brain/platform";
import { diagnosticReport, ecosystemHealth } from "../brain/ecosystemHealth";
import { Group } from "./Sheet";

export default function EcosystemHealth({
  sysInfo,
  pcState,
  pcVersion,
  tasks,
  onNavigate,
  onPair,
  onTest,
}) {
  const [native, setNative] = useState(null);
  const [message, setMessage] = useState("");
  const refresh = useCallback(async () => {
    const value = await readEcosystemHealth();
    setNative(value);
    if (!value?.ok)
      setMessage("Native health is unavailable. Reopen JARVIS on the phone and refresh.");
  }, []);
  useEffect(() => {
    let disposed = false;
    const read = () => {
      if (document.visibilityState !== "hidden")
        void readEcosystemHealth().then((value) => {
          if (!disposed) setNative(value);
        });
    };
    read();
    document.addEventListener("visibilitychange", read);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", read);
    };
  }, []);
  const rows = ecosystemHealth(native, sysInfo, pcState, pcVersion);
  const repair = async (action) => {
    if (action === "refresh") return refresh();
    if (action === "keys") return onNavigate("keys");
    if (action === "pair") return onPair();
    if (action === "test") return onTest?.();
    const result =
      action === "notification_access"
        ? await requestNotificationAccess()
        : action === "accessibility"
          ? await androidPlatform.openAccessibilitySettings()
          : await androidPlatform.system.control(action);
    setMessage(result.summary);
  };
  return (
    <>
      <Group title="Ecosystem Health">
        {rows.map((row) => (
          <div className="sp-field" key={row.id}>
            <div className="sp-row">
              <span className="sp-label">{row.label}</span>
              <span
                className={`sp-lamp ${row.status === "ready" ? "sp-lamp--on" : "sp-lamp--warn"}`}
              >
                {row.status === "ready"
                  ? "Ready"
                  : row.status === "attention"
                    ? "Needs attention"
                    : row.status === "unknown"
                      ? "Not verified"
                      : "Unavailable"}
              </span>
            </div>
            <p className="sp-desc">{row.detail}</p>
            {row.repair && (
              <button className="sp-btn" onClick={() => void repair(row.repair)}>
                {row.repair === "refresh"
                  ? "Refresh"
                  : row.repair === "test"
                    ? "Run connection test"
                    : row.repair === "pair"
                      ? "Open PC connection"
                      : row.repair === "keys"
                        ? "Open API keys"
                        : `Open ${row.label.toLowerCase()} settings`}
              </button>
            )}
          </div>
        ))}
      </Group>
      <Group title="Diagnostic export">
        <div className="sp-field">
          <p className="sp-desc">
            Includes versions, timings, error categories and report-local task identifiers.
            Credentials, prompts, messages, screenshots and document contents are excluded.
          </p>
          <button
            className="sp-btn"
            onClick={async () => {
              const report = diagnosticReport(
                rows,
                tasks || [],
                native?.appVersion || "",
                pcVersion || "",
              );
              const result = await exportDiagnostics(JSON.stringify(report));
              setMessage(result.summary);
            }}
          >
            Export diagnostics
          </button>
          {message && (
            <p className="sp-desc" role="status">
              {message}
            </p>
          )}
        </div>
      </Group>
    </>
  );
}
