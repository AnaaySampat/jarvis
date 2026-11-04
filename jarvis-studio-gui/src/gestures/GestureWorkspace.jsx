import { useEffect, useRef, useState } from "react";
import { MODES } from "./engine";
import ActivityView from "./ActivityView";
import GestureTune from "./GestureTune";
import GestureSessionOverlay from "./GestureSessionOverlay";
import PoseGuide from "./PoseGuide";
import { practicePoses, poseName } from "./poseGuides";
import "./gestures.css";

export default function GestureWorkspace({
  controls,
  open = false,
  onClose,
  onOpen,
  routines = [],
}) {
  const video = useRef(null),
    dialog = useRef(null);
  const [tab, setTab] = useState("control");
  const [target, setTarget] = useState(practicePoses[0]);

  const { config, status, cursor } = controls;
  const active = status.running || status.starting;
  const activeTimers =
    controls.timers?.timers.filter((t) => t.state === "running" && t.deadline > controls.timers.now)
      .length || 0;
  useEffect(() => {
    if (status.running && video.current) controls.camera.preview?.(video.current);
  }, [status.running, controls.camera, open, tab]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    dialog.current?.querySelector("button")?.focus();
    const key = (event) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        event.stopPropagation();
        onClose?.();
      }
      if (event.key !== "Tab") return;
      const focusable = [
        ...(dialog.current?.querySelectorAll(
          "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea, summary, [tabindex='0']",
        ) || []),
      ].filter((node) => node.getClientRects().length);
      const first = focusable[0],
        last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    const node = dialog.current;
    node?.addEventListener("keydown", key);
    return () => {
      node?.removeEventListener("keydown", key);
      previous?.focus?.();
    };
  }, [open, onClose]);
  const selectTab = (next) => {
    setTab(next);
    controls.setPractice(next === "learn");
    if (next === "learn") controls.setPracticeTarget(target);
  };
  if (!open) return <GestureSessionOverlay controls={controls} onOpen={onOpen} />;
  const passed = controls.practicePassed?.includes(target) || false;
  return (
    <>
      {cursor && active && config.mode === "hud" && !controls.practice && !controls.paused && (
        <div
          aria-hidden="true"
          className={`gesture-cursor${cursor.down ? " is-down" : ""}`}
          style={{ left: cursor.x, top: cursor.y }}
        />
      )}
      {open && <div className="hands-free-scrim" />}
      <section
        ref={dialog}
        className={open ? "hands-free" : "gesture-workspace"}
        role={open ? "dialog" : "region"}
        aria-modal={open || undefined}
        aria-label={open ? "Hands-free" : "Active gesture session"}
      >
        <header className="activity-bar hands-free-header">
          <h2>{open ? "Hands-free" : MODES[config.mode]}</h2>
          {activeTimers > 0 && (
            <span>
              {activeTimers} timer{activeTimers === 1 ? "" : "s"}
            </span>
          )}
          {open ? (
            <button type="button" onClick={onClose} aria-label="Close Hands-free">
              Close
            </button>
          ) : (
            <button type="button" onClick={onOpen}>
              Open Hands-free
            </button>
          )}
        </header>
        {open && (
          <>
            <p>Read, follow steps or control music. Buttons work with the camera off.</p>
            <label>
              Activity
              <select
                aria-label="Activity"
                value={config.mode}
                disabled={active}
                onChange={(e) => controls.changeConfig({ mode: e.target.value })}
              >
                {Object.entries(MODES).map(([key, label]) => (
                  <option key={key} value={key}>
                    {key === "reading" ? "Read" : key === "cooking" ? "Steps" : label}
                  </option>
                ))}
              </select>
            </label>
            {active && <small>Stop the camera to change activity.</small>}
            <div className="activity-bar" role="group" aria-label="Hands-free views">
              {[
                ["control", "Control"],
                ["learn", "Learn"],
                ["tune", "Tune"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={tab === value}
                  onClick={() => selectTab(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </>
        )}
        <div className="hands-free-body">
          {
            <section className="activity-camera" aria-label="Camera controls">
              <div className="activity-bar">
                <button
                  type="button"
                  disabled={controls.busy || (!active && !controls.supported)}
                  onClick={active ? controls.stop : controls.start}
                >
                  {controls.busy
                    ? "Please wait…"
                    : active
                      ? "Stop camera"
                      : controls.practice
                        ? "Start practice camera"
                        : "Start gestures"}
                </button>
                {status.running && !controls.practice && (
                  <button type="button" onClick={() => controls.setPaused(!controls.paused)}>
                    {controls.paused ? "Resume gestures" : "Pause gestures"}
                  </button>
                )}
                <span>
                  {status.starting
                    ? "Starting camera…"
                    : status.running
                      ? controls.paused
                        ? "Camera on · gestures paused"
                        : controls.practice
                          ? "Camera on · practice only"
                          : "Camera on"
                      : "Camera off"}
                </span>
              </div>
              {controls.camera.preview && active && (
                <video
                  ref={video}
                  autoPlay
                  muted
                  playsInline
                  className="gesture-workspace__video"
                />
              )}
              {open && controls.camera.devices && (
                <label>
                  Webcam
                  <select
                    aria-label="Webcam"
                    value={config.cameraId}
                    disabled={active}
                    onChange={(e) => controls.changeConfig({ cameraId: e.target.value })}
                  >
                    <option value="">Default camera</option>
                    {controls.camera.devices.map((device, i) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label || `Camera ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {controls.paused && <p>Camera stays on. Buttons still work.</p>}
              {!controls.supported && (
                <p>
                  Reading and steps are available. Camera gestures need the native Android app or
                  Windows webcam preview.
                </p>
              )}
            </section>
          }
          {(tab === "control" || !open) && !controls.practice && controls.timers && (
            <ActivityView controls={controls} compact={!open} />
          )}
          {tab === "learn" && open && (
            <section aria-label="Gesture practice">
              <h3>Practice without running actions</h3>
              <p>
                Show one whole hand, face the camera, light your hand from the front and lower it
                between attempts. A closed fist stops the camera.
              </p>
              <label>
                Practice pose
                <select
                  aria-label="Practice pose"
                  value={target}
                  onChange={(e) => {
                    setTarget(e.target.value);
                    controls.setPracticeTarget(e.target.value);
                  }}
                >
                  {practicePoses.map((pose) => (
                    <option key={pose} value={pose}>
                      {poseName(pose)}
                    </option>
                  ))}
                </select>
              </label>
              <PoseGuide pose={target} />
              <p role="status">
                {passed
                  ? "Recognized. Lower your hand before the next pose."
                  : `Hold the ${poseName(target).toLowerCase()} briefly.`}
              </p>
              <button
                type="button"
                disabled={!passed}
                onClick={() => {
                  const next =
                    practicePoses[(practicePoses.indexOf(target) + 1) % practicePoses.length];
                  setTarget(next);
                  controls.setPracticeTarget(next);
                }}
              >
                Next gesture
              </button>
            </section>
          )}
          {tab === "tune" && open && <GestureTune controls={controls} routines={routines} />}
          {tab === "control" && open && (
            <details className="activity-mappings">
              <summary>Gesture actions for this activity</summary>
              {Object.entries(config.bindings[config.mode])
                .filter(([, action]) => action !== "none")
                .map(([pose, action]) => (
                  <PoseGuide key={pose} pose={pose} action={action} />
                ))}
            </details>
          )}
        </div>
        <p role="status">{controls.message || status.summary}</p>
        <small>
          Recognition stays on this device. Sessions last up to five minutes. Gestures cannot
          approve requests. Read-aloud uses your configured speech provider.
        </small>
      </section>
    </>
  );
}
