import { useState } from "react";
import { Icon } from "./GestureIcon";
import GestureGlyph from "./GestureGlyph";
import { ACTIVITIES } from "./presentation";
import { ActivityContent, CameraView, SessionFeedback } from "./GestureSessionViews";
import "./gestures.css";

export default function GestureSessionOverlay({ controls, onOpen }) {
  const [minimized, setMinimized] = useState(false);
  const { config, status, cursor } = controls;
  const active = status.running || status.starting;
  return (
    <>
      {cursor && active && config.mode === "hud" && !controls.paused && !controls.practice && (
        <div
          aria-hidden="true"
          className={`gesture-cursor ${cursor.down ? "is-down" : ""}`}
          style={{ left: cursor.x, top: cursor.y }}
        />
      )}
      {active && (
        <aside
          className={`gesture-workspace ${minimized ? "is-minimized" : ""}`}
          data-native={!controls.camera.preview}
          aria-label="Active gesture session"
        >
          <header className="gesture-workspace__header">
            <div>
              <span className={`gesture-status-dot ${controls.paused ? "" : "is-on"}`}>
                {controls.practice ? "Practice" : controls.paused ? "Paused" : "Gestures"}
              </span>
              <strong>{ACTIVITIES[config.mode].name}</strong>
            </div>
            <div className="gesture-workspace__buttons">
              {onOpen && (
                <button type="button" onClick={onOpen}>
                  Open activities
                </button>
              )}
              <button
                type="button"
                aria-label={controls.paused ? "Resume gestures" : "Pause gestures"}
                onClick={() => controls.setPaused(!controls.paused)}
              >
                <Icon name={controls.paused ? "play" : "eyeOff"} size={16} />
              </button>
              <button
                type="button"
                aria-label={minimized ? "Expand gesture session" : "Minimize gesture session"}
                aria-expanded={!minimized}
                onClick={() => setMinimized(!minimized)}
              >
                <Icon name={minimized ? "chevUp" : "chevDown"} size={16} />
              </button>
              <button
                type="button"
                className="gesture-stop"
                aria-label="Stop camera"
                onClick={controls.stop}
              >
                <Icon name="stop" size={14} />
                <GestureGlyph pose="FIST" size={24} />
                Stop camera
              </button>
            </div>
          </header>
          {!minimized && (
            <div className="gesture-workspace__body">
              <SessionFeedback controls={controls} />
              {controls.practice ? (
                <p className="gesture-notice">Testing · actions off</p>
              ) : (
                <ActivityContent controls={controls} location="workspace" simple />
              )}
              {controls.camera.preview && (
                <details className="gesture-source">
                  <summary>Camera</summary>
                  <CameraView controls={controls} simple />
                </details>
              )}
            </div>
          )}
        </aside>
      )}
    </>
  );
}
