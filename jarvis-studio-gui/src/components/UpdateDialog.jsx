import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { useAndroidBack } from "../hooks/useAndroidBack";
import { featureSummary, formatUpdateBytes } from "../brain/platform/appUpdate";
import Icon from "./Icon";
import "./update-dialog.css";

export default function UpdateDialog({ updater }) {
  const { state, busy, act, close, skip } = updater;
  const release = state.release;
  const [expanded, setExpanded] = useState(false);
  const panel = useRef(null);
  const closeRef = useRef(close);
  useEffect(() => { closeRef.current = close; }, [close]);
  useAndroidBack(true, close);
  useEffect(() => {
    const previous = document.activeElement;
    const container = panel.current;
    container?.querySelector("button")?.focus();
    const onKey = (event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
      if (event.key !== "Tab") return;
      const items = [...container.querySelectorAll("button:not(:disabled), a[href], input")];
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("keydown", onKey, true); previous?.focus?.(); };
  }, []);
  const features = release?.features || [];
  const fixes = release?.fixes || [];
  const downloading = state.phase === "downloading";
  const ready = ["ready", "awaiting_permission", "awaiting_confirmation"].includes(state.phase);
  const installing = state.phase === "installing";
  const progress = state.total > 0 ? Math.min(100, Math.max(0, Math.round((state.downloaded || 0) / state.total * 100))) : null;
  const highlights = expanded ? features : features.slice(0, 4);
  return createPortal(
    <div className="update-overlay" onClick={close}>
      <section className="update-dialog" ref={panel} role="dialog" aria-modal="true" aria-labelledby="update-title" aria-describedby="update-description" onClick={(event) => event.stopPropagation()}>
        <header className="update-header">
          <span className="update-symbol"><Icon name="download" size={25} /></span>
          <span className="update-kicker">JARVIS UPDATES</span>
          <button className="update-close" type="button" aria-label="Remind me tomorrow" onClick={close}><Icon name="close" size={20} /></button>
        </header>
        <div className="update-content">
          <h2 id="update-title">{release ? "A new update is available" : busy ? "Checking for updates…" : state.error ? "Couldn't check for updates" : "You're up to date"}</h2>
          <p id="update-description" className="update-meta">
            {release ? <>JARVIS {release.versionName}{release.channel === "beta" && <span className="update-beta">Beta</span>}{release.asset && ` · ${formatUpdateBytes(release.asset.size)}`}</> : `Installed: JARVIS ${state.currentVersion || "…"}`}
          </p>
          {release && <>
            <h3>{featureSummary(features)}</h3>
            <ul className="update-features">{highlights.map((item) => <li key={item.id}><Icon name="spark" size={17} /><div><strong>{item.title}</strong>{item.description && <p>{item.description}</p>}</div></li>)}</ul>
            {(features.length > 4 || fixes.length > 0) && <button className="update-link" type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "Show highlights" : "See all changes"}</button>}
            {expanded && fixes.length > 0 && <><h3>Fixes and improvements</h3><ul className="update-fixes">{fixes.map((item) => <li key={item.id}><strong>{item.title}</strong>{item.description && <p>{item.description}</p>}</li>)}</ul></>}
            {release.legacy && <p className="update-note">This release uses the original download page. Future releases include feature highlights and downloads inside JARVIS.</p>}
            {release.incompatible && <p className="update-note">This release doesn't support your device or Android version.</p>}
          </>}
          {downloading && <div className="update-transfer"><div className="update-progress" role="progressbar" aria-label="Update download" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress ?? undefined}><span style={{ width: `${progress ?? 0}%` }} /></div><p>{progress === null ? "Waiting for network…" : `${progress}% · ${formatUpdateBytes(state.downloaded)} of ${formatUpdateBytes(state.total)}`}</p></div>}
          {ready && <p className="update-note">{state.phase === "awaiting_permission" ? "Allow JARVIS to install updates in Android settings, then tap Install update again." : "Download verified. Android will ask you to confirm installation."}</p>}
          {installing && <p className="update-note">Continue in Android's installer. If JARVIS is in the background, tap the installation notification.</p>}
          <div aria-live="polite">{state.error && <p className="update-error" role="alert">{state.error}</p>}</div>
          {!release && Boolean(state.retryAt) && <p className="update-note">Next retry after {new Date(state.retryAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.</p>}
        </div>
        <footer className="update-actions">
          {release && !release.incompatible && !release.legacy && !downloading && !installing && <button className="update-primary" type="button" disabled={busy} onClick={() => void act(ready ? "install" : "download")}>{busy ? "Please wait…" : ready ? "Install update" : "Download update"}</button>}
          {release?.legacy && <button className="update-primary" type="button" onClick={() => void invoke("plugin:phone|open_url", { url: release.url }).catch(() => {})}>View release</button>}
          {downloading && <button className="update-secondary" type="button" disabled={busy} onClick={() => void act("cancel")}>Cancel download</button>}
          {release ? <div className="update-secondary-actions"><button type="button" onClick={close}>{downloading ? "Continue in background" : "Remind me tomorrow"}</button><button type="button" onClick={skip}>Skip this version</button></div> : <button className="update-primary" type="button" onClick={close}>Done</button>}
          {release && state.currentVersion && <p className="update-installed">Currently installed: {state.currentVersion}</p>}
        </footer>
      </section>
    </div>, document.body,
  );
}
