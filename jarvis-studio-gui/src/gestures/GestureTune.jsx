import { useId, useState } from "react";
import { ACTIONS, POSES } from "./engine";
import { poseName } from "./poseGuides";
import "./gestures.css";

const PRESETS = {
  Deliberate: { holdMs: 1000, releaseMs: 700, confidence: 0.85 },
  Balanced: { holdMs: 600, releaseMs: 400, confidence: 0.8 },
  Quick: { holdMs: 300, releaseMs: 250, confidence: 0.75 },
};

export default function GestureTune({ controls, routines = [] }) {
  const { config: cfg, status } = controls;
  const [pose, setPose] = useState("");
  const id = useId();
  const active = status.running || status.starting;
  const change = controls.changeConfig;
  return (
    <section className="gesture-settings" aria-label="Tune gestures">
      <h3>Make gestures comfortable</h3>
      <p>
        Stop the camera before changing recognition or mappings. Your choices save automatically.
      </p>
      <div className="activity-bar" role="group" aria-label="Recognition presets">
        {Object.entries(PRESETS).map(([name, values]) => (
          <button
            type="button"
            key={name}
            disabled={active}
            aria-pressed={Object.entries(values).every(([key, value]) => cfg[key] === value)}
            onClick={() => change(values)}
          >
            {name}
          </button>
        ))}
      </div>
      <ul className="gesture-help">
        <li>
          Accidental actions or repeats: try Deliberate, then lower your hand fully between poses.
        </li>
        <li>
          Missed poses: light your hand from the front, show the whole hand and face the camera. Try
          Balanced before lowering confidence a little.
        </li>
        <li>
          Comfortable and want less waiting: try Quick. It can accept accidental poses more easily.
        </li>
      </ul>
      <details>
        <summary>Fine-tune recognition</summary>
        <label>
          Hold time: {cfg.holdMs} ms
          <input
            type="range"
            min={200}
            max={2000}
            step={100}
            value={cfg.holdMs}
            disabled={active}
            onChange={(e) => change({ holdMs: Number(e.target.value) })}
          />
        </label>
        <p>How long to hold a pose before its action runs.</p>
        <label>
          Release time: {cfg.releaseMs} ms
          <input
            type="range"
            min={200}
            max={1500}
            step={100}
            value={cfg.releaseMs}
            disabled={active}
            onChange={(e) => change({ releaseMs: Number(e.target.value) })}
          />
        </label>
        <p>How long to lower your hand before the same pose can run again.</p>
        <label>
          Recognition confidence: {Math.round(cfg.confidence * 100)}%
          <input
            type="range"
            min={65}
            max={98}
            aria-describedby={`${id}-confidence`}
            value={Math.round(cfg.confidence * 100)}
            disabled={active}
            onChange={(e) => change({ confidence: Number(e.target.value) / 100 })}
          />
        </label>
        <p id={`${id}-confidence`}>
          Higher requires a stronger match and reduces accidental triggers, but can miss poses.
          Lower accepts more matches, including mistakes.
        </p>
        <label className="gesture-settings__check">
          <input
            type="checkbox"
            checked={cfg.mirror}
            disabled={active}
            onChange={(e) => change({ mirror: e.target.checked })}
          />
          Mirror pointer and swipe direction
        </label>
      </details>
      <details>
        <summary>Change gesture actions</summary>
        {[...POSES, ...cfg.customPoses.map((p) => p.id)].map((name) => (
          <label key={name}>
            {cfg.customPoses.find((p) => p.id === name)?.name || poseName(name)}
            <select
              value={cfg.bindings[cfg.mode][name] || "none"}
              disabled={active}
              onChange={(e) =>
                change((current) => ({
                  bindings: {
                    ...current.bindings,
                    [current.mode]: {
                      ...current.bindings[current.mode],
                      [name]: e.target.value,
                    },
                  },
                }))
              }
            >
              {Object.entries(ACTIONS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        ))}
        <p>
          A closed fist always stops the camera and cannot be remapped. Gestures cannot approve
          requests.
        </p>
      </details>
      {cfg.mode === "routines" && (
        <label>
          Saved routine
          <select
            value={cfg.routineName}
            disabled={active}
            onChange={(e) => change({ routineName: e.target.value })}
          >
            <option value="">Choose a saved routine</option>
            {routines.map((r) => (
              <option key={r.id || r.name} value={r.name}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {cfg.mode === "custom" && (
        <section>
          <h3>Personal poses</h3>
          <p>
            Name a distinct pose, start the camera and hold still for calibration. Only hand
            geometry is saved.
          </p>
          <label>
            Pose name
            <input maxLength={40} value={pose} onChange={(e) => setPose(e.target.value)} />
          </label>
          <button
            type="button"
            disabled={!status.running || controls.calibrating || controls.practice || !pose.trim()}
            onClick={() => controls.calibrate(pose)}
          >
            {controls.calibrating ? "Hold still…" : "Capture pose"}
          </button>
          {cfg.customPoses.map((p) => (
            <div key={p.id} className="activity-bar">
              <span>{p.name}</span>
              <button type="button" disabled={active} onClick={() => controls.removePose(p.id)}>
                Delete {p.name}
              </button>
            </div>
          ))}
        </section>
      )}
      {cfg.mode === "pc" && controls.armControl && (
        <button type="button" onClick={controls.armControl}>
          Open computer-control approval
        </button>
      )}
      <p>
        Microphone controls affect the default input; a meeting app can use a different microphone.
        Photo actions use a three-second countdown. Routines retain their existing approval checks.
      </p>
    </section>
  );
}
