import { useEffect, useRef } from "react";
import { MODES, readerPages } from "./engine";
import "./gestures.css";

export default function GestureWorkspace({ controls }) {
  const video = useRef(null);
  const { config, status, step, page, cursor } = controls;
  const active = status.running || status.starting;
  useEffect(() => {
    if (status.running && video.current) controls.camera.preview?.(video.current);
  }, [status.running, controls.camera]);
  const pages = readerPages(config.reader);
  const steps = config.steps
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  return (
    <>
      {cursor && active && config.mode === "hud" && (
        <div
          aria-hidden="true"
          className={"gesture-cursor" + (cursor.down ? " is-down" : "")}
          style={{ left: cursor.x, top: cursor.y }}
        />
      )}
      {active && (
        <aside className="gesture-workspace" aria-label="Active gesture session">
          <div className="gesture-settings__row">
            <b>{MODES[config.mode]}</b>
            <button type="button" onClick={controls.stop}>
              Stop camera
            </button>
          </div>
          {controls.camera.preview && (
            <video ref={video} autoPlay muted playsInline className="gesture-workspace__video" />
          )}
          {config.mode === "reading" && (
            <>
              <div className="gesture-workspace__text" tabIndex={0}>
                {pages[page] || "Add text in gesture settings."}
              </div>
              <div className="gesture-settings__row">
                <button
                  type="button"
                  data-gesture-safe="true"
                  onClick={() => controls.selectPage(Math.max(0, page - 1))}
                >
                  Previous
                </button>
                <span>{pages.length ? `${page + 1} / ${pages.length}` : "No pages"}</span>
                <button
                  type="button"
                  data-gesture-safe="true"
                  onClick={() => controls.selectPage(Math.min(pages.length - 1, page + 1))}
                >
                  Next
                </button>
              </div>
              <button
                type="button"
                data-gesture-safe="true"
                onClick={() => controls.act("reader.speak")}
              >
                Read aloud
              </button>
              <button
                type="button"
                data-gesture-safe="true"
                onClick={() => controls.act("reader.bookmark")}
              >
                Bookmark
              </button>
            </>
          )}
          {config.mode === "cooking" && (
            <>
              <div className="gesture-workspace__text">
                {steps[step] || "Add instructions in gesture settings."}
              </div>
              <div className="gesture-settings__row">
                <button
                  type="button"
                  data-gesture-safe="true"
                  onClick={() => controls.selectStep(Math.max(0, step - 1))}
                >
                  Previous
                </button>
                <span>{steps.length ? `${step + 1} / ${steps.length}` : "No instructions"}</span>
                <button
                  type="button"
                  data-gesture-safe="true"
                  onClick={() => controls.selectStep(Math.min(steps.length - 1, step + 1))}
                >
                  Next
                </button>
              </div>
              <button
                type="button"
                data-gesture-safe="true"
                onClick={() => controls.act("steps.repeat")}
              >
                Read step
              </button>
              <button
                type="button"
                data-gesture-safe="true"
                onClick={() => controls.act("timer.start")}
              >
                Start {config.timerSeconds}s timer
              </button>
            </>
          )}
          <p role="status">{controls.message || status.summary}</p>
          <small>Closed fist stops the camera. Lower your hand before repeating a pose.</small>
        </aside>
      )}
    </>
  );
}
