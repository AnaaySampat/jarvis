import { useId, useState } from "react";
import { Icon } from "./GestureIcon";
import { ACTIVITIES, TASKS, DEVICE_TASKS, poseForAction } from "./presentation";
import GesturePreferences from "./GesturePreferences";
import GestureGlyph from "./GestureGlyph";
import ActivityView from "./ActivityView";
import { ActivityContent, CameraView, SessionFeedback } from "./GestureSessionViews";
import "./gestures.css";
import "./tasks.css";
import "./hands-free.css";

const SHORTCUTS = ["voice", "media", "reading", "cooking", "photo", "phone"];

export default function GesturePanel({ controls, routines = [] }) {
  const [settings, setSettings] = useState(false);
  const [choosingActivity, setChoosingActivity] = useState(true);
  const cameraHintId = useId();
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
    setChoosingActivity(false);
    if (controls.practice) controls.setPractice(false);
    controls.switchMode(mode);
  };
  const local = ["reading", "cooking"].includes(config.mode);
  const activity = ACTIVITIES[config.mode];
  const cameraHint =
    state === "Starting"
      ? "Connecting camera · tap to cancel"
      : state === "Off"
        ? controls.supported
          ? "Turn on to use hand gestures"
          : "Camera unavailable in this preview"
        : state === "Testing"
          ? "Practice only · actions are off"
          : state === "Paused"
            ? "Camera on · actions paused"
            : "Camera on · ready for your gestures";
  return (
    <section className="task-panel" aria-label="Gesture controls">
      <div className="task-toolbar">
        <button
          type="button"
          role="switch"
          aria-label="Hands-free"
          aria-checked={active}
          className="task-camera-switch"
          data-state={state}
          aria-describedby={cameraHintId}
          disabled={!active && !controls.busy && !controls.supported}
          onClick={toggleCamera}
        >
          <span className="task-camera-emblem" aria-hidden="true">
            <Icon name="hand" size={27} />
          </span>
          <span className="task-camera-copy">
            <span className="task-camera-label">GESTURE CAMERA</span>
            <strong>
              Hands-free <span className="task-camera-state">{state}</span>
            </strong>
            <span id={cameraHintId}>{cameraHint}</span>
          </span>
          <span className="task-switch-track" aria-hidden="true">
            <span />
          </span>
        </button>
      </div>

      <section className="task-activity-picker" aria-label="Choose an activity">
        <div className="task-section-heading">
          <button
            type="button"
            className="task-activity-toggle"
            aria-label="Change activity"
            aria-expanded={choosingActivity && !settings}
            onClick={() => {
              setSettings(false);
              setChoosingActivity(settings || !choosingActivity);
            }}
          >
            {choosingActivity && !settings ? (
              <span className="task-section-index">01 / CHOOSE AN ACTIVITY</span>
            ) : (
              <>
                <Icon name={activity.icon} size={19} />
                <span>{activity.name}</span>
                <small>Change</small>
              </>
            )}
          </button>
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
                <option value={config.mode}>{activity.name}</option>
              )}
            </select>
            <span className="task-picker-caption" aria-hidden="true">
              All activities <Icon name="chevDown" size={13} />
            </span>
          </label>
        </div>
        {choosingActivity && !settings && (
          <div className="task-shortcuts" role="group" aria-label="Quick activities">
            {SHORTCUTS.map((mode) => (
              <button
                type="button"
                key={mode}
                aria-label={`${ACTIVITIES[mode].name} activity`}
                aria-pressed={config.mode === mode}
                disabled={controls.calibrating || controls.busy}
                onClick={() => chooseTask(mode)}
              >
                <Icon name={ACTIVITIES[mode].icon} size={21} />
                <span>{ACTIVITIES[mode].name}</span>
              </button>
            ))}
          </div>
        )}
      </section>
      {settings ? (
        <GesturePreferences controls={controls} routines={routines} onDone={closeSettings} />
      ) : (
        <>
          <div className="task-current-activity">
            <span className="task-section-index">02 / CONTROLS</span>
            <h3>{activity.name === "Read" ? "Reading" : activity.name} controls</h3>
            <p>{activity.description}</p>
          </div>
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
          <footer className="task-footer">
            <button
              type="button"
              className="task-settings-button"
              onClick={openSettings}
              aria-label="Gesture settings"
            >
              <Icon name="settings" size={18} /> Gesture settings
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
          <p className="task-local-note">
            <Icon name="shield" size={13} /> Gesture recognition stays on your device
          </p>
        </>
      )}
    </section>
  );
}
