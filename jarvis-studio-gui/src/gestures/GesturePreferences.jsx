import { useEffect, useRef, useState } from "react";
import { ACTIONS, POSES, defaults } from "./engine";
import { ConfirmButton } from "../components/controls";
import { Icon } from "./GestureIcon";
import GestureGlyph from "./GestureGlyph";
import GestureActionEditor from "./GestureActionEditor";
import { CameraView } from "./GestureSessionViews";
import GestureFeedback from "./GestureFeedback";
import { actionLabel, poseLabel, RESPONSE_PRESETS } from "./presentation";

export default function GesturePreferences({ controls, onDone }) {
  const [editing, setEditing] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [poseName, setPoseName] = useState("");
  const [poseAction, setPoseAction] = useState("media.toggle");
  const latest = useRef(controls);
  useEffect(() => {
    latest.current = controls;
  }, [controls]);
  useEffect(() => {
    const initial = latest.current;
    const wasActive = initial.status.running || initial.status.starting;
    const wasPaused = Boolean(initial.paused);
    if (wasActive && !wasPaused) initial.setPaused(true);
    return () => {
      const current = latest.current;
      if (current.calibrating) current.cancelCalibration?.();
      if (current.practice) current.setPractice(false);
      if (!wasActive && (current.status.running || current.status.starting)) void current.stop();
      else if (wasActive && (current.status.running || current.status.starting))
        current.setPaused(wasPaused);
    };
  }, []);
  const cfg = controls.config;
  const active = controls.status.running || controls.status.starting;
  const names = [...POSES, ...cfg.customPoses.map((pose) => pose.id)];
  const assigned = names.filter(
    (pose) =>
      cfg.bindings[cfg.mode][pose] && !["none", "feedback"].includes(cfg.bindings[cfg.mode][pose]),
  );
  const test = (pose) => {
    setEditing(null);
    if (pose.startsWith("custom_")) controls.switchMode("custom");
    controls.setPractice(true);
    controls.setPracticeTarget(pose);
    if (!active) void controls.start();
  };
  const endTest = () => {
    controls.setPractice(false);
    controls.setPaused(true);
  };
  return (
    <section className="task-preferences" aria-label="Gesture settings">
      <div className="task-preferences-heading">
        <h3>Gesture settings</h3>
        <button type="button" aria-label="Back" onClick={onDone}>
          <Icon name="arrowLeft" size={16} /> Back
        </button>
      </div>
      {controls.practice && (
        <section className="task-test" aria-label="Test gesture">
          <div className="task-preferences-heading">
            <strong>{poseLabel(controls.practiceTarget || "OPEN_PALM", cfg)}</strong>
            <button type="button" onClick={endTest}>
              End test
            </button>
          </div>
          <CameraView controls={controls} target={controls.practiceTarget} simple />
          <GestureFeedback controls={controls} />
          {controls.practicePassed?.includes(controls.practiceTarget) && (
            <p role="status">
              Detected <Icon name="check" size={16} />
            </p>
          )}
        </section>
      )}
      {editing ? (
        <GestureActionEditor pose={editing} controls={controls} onClose={() => setEditing(null)} />
      ) : (
        <details className="task-preference-section" open>
          <summary>Gesture actions</summary>
          <div className="task-mappings">
            {(showAll ? names : assigned).map((pose) => (
              <div className="task-mapping" key={pose}>
                <GestureGlyph pose={pose} size={34} />
                <span>
                  <strong>{poseLabel(pose, cfg)}</strong>
                  <small>{actionLabel(cfg.bindings[cfg.mode][pose] || "none")}</small>
                </span>
                <button
                  type="button"
                  disabled={controls.calibrating}
                  aria-label={`Change ${poseLabel(pose, cfg)}`}
                  onClick={() => setEditing(pose)}
                >
                  <Icon name="edit" size={17} />
                </button>
                <button
                  type="button"
                  disabled={!controls.supported || controls.calibrating || controls.busy}
                  aria-label={`Test ${poseLabel(pose, cfg)}`}
                  onClick={() => test(pose)}
                >
                  <Icon name="play" size={17} />
                </button>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setShowAll(!showAll)}>
            {showAll ? "Fewer gestures" : "All gestures"}
          </button>
          <ConfirmButton
            title="Restore default actions"
            confirmLabel="Restore these actions?"
            onConfirm={() =>
              controls.changeConfig((current) => ({
                bindings: {
                  ...current.bindings,
                  [current.mode]: defaults().bindings[current.mode],
                },
              }))
            }
          >
            Restore defaults
          </ConfirmButton>
        </details>
      )}
      <details className="task-preference-section">
        <summary>Response</summary>
        <div className="task-presets">
          {RESPONSE_PRESETS.map((preset) => (
            <button
              key={preset.name}
              type="button"
              aria-label={`Use ${preset.name} response`}
              aria-pressed={["holdMs", "releaseMs", "confidence"].every(
                (key) => cfg[key] === preset[key],
              )}
              disabled={active}
              onClick={() =>
                controls.changeConfig({
                  holdMs: preset.holdMs,
                  releaseMs: preset.releaseMs,
                  confidence: preset.confidence,
                })
              }
            >
              {preset.name}
            </button>
          ))}
        </div>
        <details>
          <summary>Fine-tune</summary>
          {[
            ["holdMs", "Hold time", 200, 2000, 100],
            ["releaseMs", "Release time", 200, 1500, 100],
            ["confidence", "Confidence", 65, 98, 1],
          ].map(([key, label, min, max, step]) => (
            <label key={key}>
              {label}{" "}
              <output>
                {key === "confidence" ? `${Math.round(cfg[key] * 100)}%` : `${cfg[key]} ms`}
              </output>
              <input
                aria-label={label}
                type="range"
                min={min}
                max={max}
                step={step}
                disabled={active}
                value={key === "confidence" ? Math.round(cfg[key] * 100) : cfg[key]}
                onChange={(event) =>
                  controls.changeConfig({
                    [key]: Number(event.target.value) / (key === "confidence" ? 100 : 1),
                  })
                }
              />
            </label>
          ))}
        </details>
        <label className="task-checkbox">
          <input
            type="checkbox"
            checked={cfg.mirror}
            disabled={active}
            onChange={(event) => controls.changeConfig({ mirror: event.target.checked })}
          />
          Mirror camera and hand motion
        </label>
        {controls.camera.devices?.length > 0 && (
          <label>
            Camera
            <select
              aria-label="Webcam"
              value={cfg.cameraId}
              disabled={active}
              onChange={(event) => controls.changeConfig({ cameraId: event.target.value })}
            >
              <option value="">Default camera</option>
              {controls.camera.devices.map((device, index) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Camera ${index + 1}`}
                </option>
              ))}
            </select>
          </label>
        )}
      </details>
      <details className="task-preference-section">
        <summary>My gestures</summary>
        <label>
          Pose name
          <input
            aria-label="Pose name"
            value={poseName}
            maxLength={40}
            disabled={controls.calibrating}
            onChange={(event) => setPoseName(event.target.value)}
          />
        </label>
        <label>
          Action
          <select
            aria-label="Custom pose action"
            value={poseAction}
            disabled={controls.calibrating}
            onChange={(event) => setPoseAction(event.target.value)}
          >
            {Object.entries(ACTIONS)
              .filter(([action]) => !["none", "feedback"].includes(action))
              .map(([action, label]) => (
                <option key={action} value={action}>
                  {label}
                </option>
              ))}
          </select>
        </label>
        {!active && (
          <button
            type="button"
            disabled={controls.busy || !controls.supported}
            onClick={() => {
              controls.setPractice(true);
              void controls.start();
            }}
          >
            Start camera
          </button>
        )}
        <button
          type="button"
          disabled={
            !controls.status.running ||
            controls.calibrating ||
            !poseName.trim() ||
            cfg.customPoses.length >= 12
          }
          onClick={() => {
            controls.setPractice(true);
            controls.calibrate(poseName, poseAction);
          }}
        >
          {controls.calibrating ? "Capturing…" : "Capture pose"}
        </button>
        {controls.calibration && (
          <div className="task-calibration" role="status">
            <strong>
              {controls.calibration.phase === "prepare"
                ? `${controls.calibration.remaining}`
                : controls.calibration.phase === "capture"
                  ? "Capturing"
                  : controls.calibration.phase === "saved"
                    ? `${controls.calibration.name} saved`
                    : controls.calibration.message}
            </strong>
            {controls.calibrating && (
              <>
                <progress
                  aria-label="Pose capture progress"
                  max={8}
                  value={controls.calibration.samples || 0}
                />
                <button type="button" onClick={controls.cancelCalibration}>
                  Cancel
                </button>
              </>
            )}
            {controls.calibration.phase === "saved" && (
              <button type="button" onClick={() => test(controls.calibration.poseId)}>
                Test saved pose
              </button>
            )}
          </div>
        )}
        {cfg.customPoses.length > 0 && (
          <button
            type="button"
            onClick={() => {
              controls.switchMode("custom");
              onDone();
            }}
          >
            Use my gestures
          </button>
        )}
        {cfg.customPoses.map((pose) => (
          <div key={pose.id} className="task-mapping">
            <span>{pose.name}</span>
            <ConfirmButton
              title={`Delete ${pose.name}`}
              confirmLabel="Delete this pose?"
              disabled={active}
              onConfirm={() => controls.removePose(pose.id)}
            >
              Delete
            </ConfirmButton>
          </div>
        ))}
      </details>
      <details className="task-preference-section">
        <summary>Point & pinch</summary>
        <button
          type="button"
          disabled={controls.calibrating}
          onClick={() => {
            controls.switchMode("hud");
            onDone();
          }}
        >
          Use pointer controls
        </button>
      </details>
      {controls.history?.length > 0 && (
        <details className="task-preference-section">
          <summary>Recent actions</summary>
          {controls.history.map((item) => (
            <div key={item.id} data-state={item.state}>
              <strong>{actionLabel(item.action)}</strong>
              <p>{item.summary}</p>
            </div>
          ))}
        </details>
      )}
    </section>
  );
}
