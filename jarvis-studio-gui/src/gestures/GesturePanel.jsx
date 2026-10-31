import { useState } from "react";
import { ACTIONS, MODES, POSES } from "./engine";
import { documentId } from "./storage";
import "./gestures.css";

export default function GesturePanel({ controls, routines = [] }) {
  const [poseName, setPoseName] = useState("");
  const { config: cfg, status, busy, message, supported, calibrating } = controls;
  const active = status.running || status.starting;
  const change = controls.changeConfig;
  const names = [...POSES, ...cfg.customPoses.map((p) => p.id)];
  return (
    <section className="gesture-settings" aria-label="Gesture controls">
      <h3>Hand gestures · Preview</h3>
      <p>
        Choose a mode, start the camera, then lower your hand before making a pose. Hold each pose
        briefly. A closed fist always stops the camera.
      </p>
      <label>
        Mode
        <select
          aria-label="Mode"
          value={cfg.mode}
          disabled={active}
          onChange={(e) => change({ mode: e.target.value })}
        >
          {Object.entries(MODES).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {controls.camera.devices && (
        <label>
          Webcam
          <select
            aria-label="Webcam"
            value={cfg.cameraId}
            disabled={active}
            onChange={(e) => change({ cameraId: e.target.value })}
          >
            <option value="">Default camera</option>
            {controls.camera.devices.map((d, i) => (
              <option value={d.deviceId} key={d.deviceId}>
                {d.label || "Camera " + (i + 1)}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="gesture-settings__row">
        <button
          type="button"
          disabled={busy || !supported}
          onClick={active ? controls.stop : controls.start}
        >
          {busy ? "Please wait..." : active ? "Stop camera" : "Start camera"}
        </button>
        <span role="status">
          {active ? (status.starting ? "Starting..." : "Camera on") : "Camera off"}
        </span>
      </div>
      <p role="status">{message || status.summary}</p>
      <p>
        Five-minute sessions. Recognition stays on this device. Images are saved only when you
        choose a photo action. Voice input uses your existing speech provider. Gestures cannot
        approve requests.
      </p>
      <details>
        <summary>Remap gestures and accessibility timing</summary>
        <label>
          Hold time: {cfg.holdMs} ms
          <input
            type="range"
            min="200"
            max="2000"
            step="100"
            value={cfg.holdMs}
            disabled={active}
            onChange={(e) => change({ holdMs: Number(e.target.value) })}
          />
        </label>
        <label>
          Release time: {cfg.releaseMs} ms
          <input
            type="range"
            min="200"
            max="1500"
            step="100"
            value={cfg.releaseMs}
            disabled={active}
            onChange={(e) => change({ releaseMs: Number(e.target.value) })}
          />
        </label>
        <label>
          Confidence: {Math.round(cfg.confidence * 100)}%
          <input
            type="range"
            min="65"
            max="98"
            value={Math.round(cfg.confidence * 100)}
            disabled={active}
            onChange={(e) => change({ confidence: Number(e.target.value) / 100 })}
          />
        </label>
        <label className="gesture-settings__check">
          <input
            type="checkbox"
            checked={cfg.mirror}
            disabled={active}
            onChange={(e) => change({ mirror: e.target.checked })}
          />
          Mirror pointer and swipe direction
        </label>
        <p>
          Swipes use a pointing index finger. HUD mode adds a pointer: pinch to select, hold the
          pinch to drag a HUD card onto another, then release.
        </p>
        {names.map((pose) => (
          <label className="gesture-settings__binding" key={pose}>
            {cfg.customPoses.find((p) => p.id === pose)?.name ||
              pose.replace(/_/g, " ").toLowerCase()}
            <select
              value={cfg.bindings[cfg.mode][pose] || "none"}
              disabled={active}
              onChange={(e) =>
                change((current) => ({
                  bindings: {
                    ...current.bindings,
                    [current.mode]: { ...current.bindings[current.mode], [pose]: e.target.value },
                  },
                }))
              }
            >
              {Object.entries(ACTIONS).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        ))}
        <p>
          Closed fist is reserved and cannot be remapped. Stop the session before changing its mode
          or timing.
        </p>
      </details>
      <details open={cfg.mode === "cooking"}>
        <summary>Cooking / workshop instructions and timer</summary>
        <label>
          One instruction per line
          <textarea
            aria-label="Instructions"
            rows="5"
            value={cfg.steps}
            maxLength={15000}
            onChange={(e) => change({ steps: e.target.value })}
          />
        </label>
        <label>
          Timer duration (seconds)
          <input
            type="number"
            min="5"
            max="86400"
            value={cfg.timerSeconds}
            onChange={(e) => change({ timerSeconds: Number(e.target.value) })}
          />
        </label>
      </details>
      <details open={cfg.mode === "reading"}>
        <summary>Reading / research text and bookmarks</summary>
        <button
          type="button"
          disabled={!controls.latestReply}
          onClick={() => change({ reader: controls.latestReply })}
        >
          Use latest JARVIS reply
        </button>
        <label>
          Reading text
          <textarea
            aria-label="Reading text"
            rows="6"
            value={cfg.reader}
            maxLength={30000}
            onChange={(e) => change({ reader: e.target.value })}
          />
        </label>
        {controls.bookmarks.map((b) => (
          <div key={b.at} className="gesture-settings__row">
            <button
              type="button"
              disabled={b.documentId !== documentId(cfg.reader)}
              title={
                b.documentId === documentId(cfg.reader)
                  ? "Open this page"
                  : "Paste the original document to open this bookmark."
              }
              onClick={() => controls.selectPage(b.page)}
            >
              Page {b.page + 1}: {b.excerpt}
            </button>
            <button type="button" onClick={() => controls.removeBookmark(b.at)}>
              Remove
            </button>
          </div>
        ))}
      </details>
      <details open={cfg.mode === "routines"}>
        <summary>Selected routine</summary>
        <label>
          Saved routine
          <select
            aria-label="Saved routine"
            value={cfg.routineName}
            disabled={active}
            onChange={(e) => change({ routineName: e.target.value })}
          >
            <option value="">Choose a saved routine</option>
            {routines.map((r) => (
              <option key={r.name} value={r.name}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <p>Each routine keeps its existing approval checks. Gestures never approve a risky step.</p>
      </details>
      <details open={cfg.mode === "custom"}>
        <summary>Calibrate personal poses</summary>
        <p>
          Start the camera, name your pose, then hold it still. Calibration stores hand geometry
          only. Use distinct poses; near-identical matches are rejected.
        </p>
        <label>
          Pose name
          <input value={poseName} maxLength={40} onChange={(e) => setPoseName(e.target.value)} />
        </label>
        <button
          type="button"
          disabled={!status.running || calibrating || !poseName.trim()}
          onClick={() => controls.calibrate(poseName)}
        >
          {calibrating ? "Hold still..." : "Capture pose"}
        </button>
        {cfg.customPoses.map((p) => (
          <div className="gesture-settings__row" key={p.id}>
            <span>{p.name}</span>
            <button type="button" disabled={active} onClick={() => controls.removePose(p.id)}>
              Delete pose
            </button>
          </div>
        ))}
      </details>
      <p>
        PC navigation needs an armed control session. Microphone controls affect the system default
        microphone where supported; they cannot guarantee an app has selected that microphone. Photo
        mode uses a three-second countdown.
      </p>
      {cfg.mode === "pc" && controls.armControl && (
        <button type="button" onClick={controls.armControl}>
          Open computer-control approval
        </button>
      )}
    </section>
  );
}
