import { ActionRow, Field, Toggle } from "./Sheet";

export default function UpdateSettings({ updater, onCloseSettings }) {
  const { state, busy, act, open, check } = updater;
  return <>
    <Field label={`JARVIS ${state.currentVersion || "…"}`} hint={state.currentCode ? `Build ${state.currentCode}` : undefined} />
    <ActionRow icon="refresh" title="Check now" disabled={busy} desc={state.checkedAt ? `Last checked ${new Date(state.checkedAt).toLocaleString()}` : "Check GitHub for a newer release"} onClick={() => { onCloseSettings(); void check(); }} />
    {state.release && <ActionRow icon="download" title={`JARVIS ${state.release.versionName} available`} desc={state.phase === "ready" ? "Downloaded and ready to install" : "View features and update"} onClick={() => { onCloseSettings(); open(); }} />}
    <Toggle label="Check for updates automatically" checked={state.automatic !== false} onChange={(automatic) => void act("preferences", { automatic })} hint="Check when JARVIS opens and periodically in the background." />
    <Toggle label="Automatically download on Wi-Fi" checked={state.autoDownload === true} onChange={(autoDownload) => void act("preferences", { autoDownload })} hint="Prepare updates on Wi-Fi. Installation always asks for your confirmation." />
    {state.error && <Field label="Update status" hint={state.error} />}
  </>;
}
