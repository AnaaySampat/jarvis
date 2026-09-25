import { useEffect, useRef, useState } from "react";
import "./setup-progress.css";

// Shown from app launch until the GUI first connects to the backend WebSocket.
// The frozen backend takes a moment to start (heavy imports) and, on first launch,
// downloads its components — so without this the window looks dead/"can't connect".
// Purely client-side: it needs no backend connection to render (that's the point).
export default function BootOverlay({ connected }) {
  const [secs, setSecs] = useState(0);
  const startRef = useRef(null);

  useEffect(() => {
    if (connected) return; // connected → unmount; nothing to time
    if (startRef.current == null) startRef.current = Date.now();
    const t = setInterval(() => {
      setSecs(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [connected]);

  if (connected) return null;

  const msg =
    secs < 12
      ? "Starting up, sir…"
      : secs < 40
        ? "Setting things up — the first launch downloads a few components."
        : "Still starting. If this doesn't clear, the backend may have failed to start.";

  return (
    <div className="setup-overlay">
      <div className="setup-card" role="status" aria-label="Starting JARVIS">
        <div className="setup-ring" aria-hidden="true">
          <span className="setup-ring-core" />
        </div>
        <div className="setup-kicker">BOOTING</div>
        <div className="setup-title">J.A.R.V.I.S</div>
        <div className="setup-sub">{msg}</div>
        <div className="setup-bar">
          <div className="setup-bar-fill setup-bar-fill--indet" />
        </div>
        {secs >= 40 && (
          <div className="setup-foot">
            Diagnostics: open <code>backend.log</code> in the JARVIS install folder (
            <code>resources\jarvis-backend</code>).
          </div>
        )}
      </div>
    </div>
  );
}
