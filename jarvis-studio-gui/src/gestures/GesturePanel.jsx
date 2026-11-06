import { useState } from "react";
import { Icon } from "./GestureIcon";
import { ACTIVITIES, TASKS, DEVICE_TASKS, poseForAction } from "./presentation";
import GesturePreferences from "./GesturePreferences";
import GestureGlyph from "./GestureGlyph";
import ActivityView from "./ActivityView";
import { ActivityContent, CameraView, SessionFeedback } from "./GestureSessionViews";
import "./gestures.css";
import "./tasks.css";

export default function GesturePanel({ controls, routines = [] }) {
  const [settings, setSettings] = useState(false);
  const { config, status } = controls;
  const active = Boolean(status.running || status.starting);
  const state =
    status.starting || controls.busy
      ? "Starting"
      : !active
        ? "Off"
        : controls.practice
          ? "Testing"
          : controls.paused || controls.blocked
            ? "Paused"
            : "On";
  const openSettings = () => setSettings(true);
  const closeSettings = () => setSettings(false);
  const toggleCamera = () => {
    if (active || controls.busy) {
      void controls.stop();
      return;
    }
    controls.setPractice(false);
    controls.setPaused(settings);
    void controls.start();
  };
  const chooseTask = (mode) => {
    setSettings(false);
    if (controls.practice) controls.setPractice(false);
    controls.switchMode(mode);
  };
  const local = ["reading", "cooking"].includes(config.mode);
  return (
    <section className="task-panel" aria-label="Gesture controls">
      <div className="task-toolbar">
        <label className="task-picker">
          <span className="sr-only">Activity</span>
          <select
            aria-label="Activity"
            value={config.mode}
            disabled={controls.calibrating || controls.busy}
            onChange={(event) => chooseTask(event.target.value)}
          >
            {TASKS.map((mode) => (
              <option key={mode} value={mode}>
                {ACTIVITIES[mode].name}
              </option>
            ))}
            <optgroup label="Devices">
              {DEVICE_TASKS.map((mode) => (
                <option key={mode} value={mode}>
                  {ACTIVITIES[mode].name}
                </option>
              ))}
            </optgroup>
            {![...TASKS, ...DEVICE_TASKS].includes(config.mode) && (
              <option value={config.mode}>{ACTIVITIES[config.mode].name}</option>
            )}
          </select>
        </label>
        <button
          type="button"
          role="switch"
          aria-label="Hands-free"
          aria-checked={active}
          className="task-camera-switch"
          data-state={state}
          disabled={!active && !controls.busy && !controls.supported}
          onClick={toggleCamera}
        >
          <span>
            Hands-free <strong>{state}</strong>
          </span>
          <span className="task-switch-track" aria-hidden="true">
            <span />
          </span>
        </button>
      </div>

      {settings ? (
        <GesturePreferences controls={controls} routines={routines} onDone={closeSettings} />
      ) : (
        <>
          {config.mode === "photo" && (
            <CameraView
              controls={controls}
              target={poseForAction(config, "photo.capture") || "PEACE"}
              simple
            />
          )}
          {local ? (
            <ActivityView controls={controls} />
          ) : (
            <ActivityContent
              controls={controls}
              editable
              routines={routines}
              location="panel"
              simple
            />
          )}
          <SessionFeedback controls={controls} />
          {controls.blocked && (
            <p className="task-state" role="status">
              Waiting for your response
            </p>
          )}
          {!controls.supported && !local && (
            <p className="task-state">Camera unavailable in this preview</p>
          )}
          <footer className="task-footer">
            <button
              type="button"
              className="task-settings-button"
              onClick={openSettings}
              aria-label="Gesture settings"
            >
              <Icon name="settings" size={18} /> Settings
            </button>
            {active && (
              <>
                <button
                  type="button"
                  onClick={() => controls.setPaused(!controls.paused)}
                  disabled={controls.busy || controls.blocked}
                >
                  <Icon name={controls.paused ? "play" : "eyeOff"} size={17} />
                  {controls.paused ? "Resume" : "Pause"}
                </button>
                <button
                  type="button"
                  className="task-stop"
                  aria-label="Stop"
                  onClick={controls.stop}
                >
                  <Icon name="stop" size={17} />
                  <GestureGlyph pose="FIST" size={24} /> Stop
                </button>
              </>
            )}
          </footer>
        </>
      )}
    </section>
  );
}
