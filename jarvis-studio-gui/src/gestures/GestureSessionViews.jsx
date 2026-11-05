import { useEffect, useRef, useState } from "react";
import { Icon } from "./GestureIcon";
import { readerPages } from "./engine";
import { QUICK_ACTIONS, ACTIVITIES, actionLabel } from "./presentation";
import GestureGlyph from "./GestureGlyph";
import GestureFeedback from "./GestureFeedback";

const ACTION_ICONS = {
  "voice.listen": "mic",
  "voice.stop": "stop",
  "photo.capture": "camera",
  "routine.run": "play",
  "reader.speak": "volume",
  "reader.bookmark": "pin",
  "steps.repeat": "volume",
  "timer.start": "clock",
  "mic.mute": "mute",
  "mic.unmute": "mic",
  "phone.flashlightOn": "power",
  "phone.flashlightOff": "power",
  "phone.bright": "sun",
  "phone.dim": "moon",
  "phone.autoBrightness": "sun",
};
const actionIcon = (action) =>
  ACTION_ICONS[action] ||
  (action.endsWith(".previous")
    ? "arrowLeft"
    : action.endsWith(".next")
      ? "arrowRight"
      : action.endsWith(".down")
        ? "minus"
        : action.endsWith(".up")
          ? "plus"
          : action.endsWith(".mute")
            ? "mute"
            : "play");

function SourceEditor({ initialOpen, children, summary }) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <details className="gesture-source" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{summary}</summary>
      {children}
    </details>
  );
}

export function QuickControls({ controls }) {
  const cfg = controls.config;
  const pages = readerPages(cfg.reader);
  const steps = cfg.steps
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const actions = QUICK_ACTIONS[cfg.mode] || [];
  if (!actions.length) return null;
  const unavailable = controls.availability?.[cfg.mode]?.ready === false;
  return (
    <div className="gesture-quick" role="group" aria-label="Touch controls">
      {actions.map((action) => {
        const empty =
          (action.startsWith("reader.") && !pages.length) ||
          (action.startsWith("steps.") && !steps.length) ||
          (action === "routine.run" && !cfg.routineName);
        const boundary =
          (action === "reader.previous" && controls.page <= 0) ||
          (action === "reader.next" && controls.page >= pages.length - 1) ||
          (action === "steps.previous" && controls.step <= 0) ||
          (action === "steps.next" && controls.step >= steps.length - 1);
        const label =
          action === "timer.start"
            ? `Start ${Math.round((cfg.timerSeconds / 60) * 10) / 10} min timer`
            : action === "voice.listen" && controls.listening
              ? "Finish listening"
              : actionLabel(action);
        return (
          <button
            key={action}
            type="button"
            data-gesture-safe="true"
            aria-label={label}
            className={
              action.endsWith(".toggle") || action === "photo.capture" || action === "reader.speak"
                ? "gesture-quick__main"
                : ""
            }
            disabled={
              controls.supported === false ||
              (action === "photo.capture" && !controls.status.running) ||
              controls.practice ||
              controls.blocked ||
              unavailable ||
              empty ||
              boundary
            }
            onClick={() => controls.act(action)}
          >
            <Icon name={actionIcon(action)} size={19} />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function CameraView({ controls, target }) {
  const video = useRef(null);
  const running = controls.status.running;
  useEffect(() => {
    const element = video.current;
    if (running && element) controls.camera.preview?.(element);
    return () => {
      if (element) element.srcObject = null;
    };
  }, [running, controls.camera]);
  return (
    <div className={`gesture-camera ${running ? "is-live" : ""}`} aria-label="Camera view">
      {running && controls.camera.preview ? (
        <video
          ref={video}
          autoPlay
          playsInline
          muted
          style={{ transform: controls.config.mirror ? "scaleX(-1)" : "none" }}
        />
      ) : (
        <div className="gesture-camera__placeholder">
          <GestureGlyph pose={target || "OPEN_PALM"} size={92} />
          <strong>
            {controls.status.starting
              ? "Opening camera…"
              : running
                ? "Keep your whole hand in view"
                : "Your camera is off"}
          </strong>
          <span>
            {running
              ? "Use the floating camera preview on your phone. You can move or collapse it."
              : "Recognition runs on your device."}
          </span>
        </div>
      )}
      <div className="gesture-camera__badge">
        <span className={running ? "is-live" : ""} />
        {running
          ? controls.practice
            ? "Practice · no actions"
            : controls.paused
              ? "Paused · camera on"
              : "Camera on"
          : "Camera off"}
      </div>
      {running && controls.camera.preview && (
        <span className="gesture-camera__framing" aria-hidden="true" />
      )}
    </div>
  );
}

export function ActivityContent({
  controls,
  editable = false,
  routines = [],
  location = "workspace",
}) {
  const { config: cfg, page = 0, step = 0 } = controls;
  const pages = readerPages(cfg.reader);
  const steps = cfg.steps
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const readiness = controls.availability?.[cfg.mode];
  const change = controls.changeConfig;
  return (
    <>
      {readiness?.detail && (
        <div className="gesture-connection" data-ready={readiness.ready}>
          <Icon name={readiness.ready ? "check" : "info"} size={17} />
          <div>
            <p>{readiness.detail}</p>
            {readiness.setup && readiness.ready !== true && (
              <button type="button" onClick={readiness.setup}>
                {readiness.setupLabel || "Set up connection"}
                <Icon name="arrowRight" size={15} />
              </button>
            )}
          </div>
        </div>
      )}
      {cfg.mode === "reading" && (
        <section className="gesture-content" aria-label="Reading session">
          {pages.length > 0 && (
            <>
              <div className="gesture-section-title">
                <strong>Your reading</strong>
                <span>
                  Page {page + 1} of {pages.length}
                </span>
              </div>
              <div
                className="gesture-workspace__text gesture-reader"
                data-gesture-reader={location}
                tabIndex={0}
              >
                {pages[page]}
              </div>
            </>
          )}
          {editable && (
            <SourceEditor
              key="reader-source"
              initialOpen={!pages.length}
              summary={pages.length ? "Change reading text" : "Add something to read"}
            >
              <label>
                Reading text
                <textarea
                  aria-label="Reading text"
                  rows={4}
                  value={cfg.reader}
                  maxLength={30000}
                  placeholder="Paste an article, a note, or a reply…"
                  onChange={(e) => change({ reader: e.target.value })}
                />
              </label>
              <button
                type="button"
                disabled={!controls.latestReply}
                onClick={() => change({ reader: controls.latestReply })}
              >
                <Icon name="chat" size={16} />
                Use latest reply
              </button>
            </SourceEditor>
          )}
        </section>
      )}
      {cfg.mode === "cooking" && (
        <section className="gesture-content" aria-label="Instruction session">
          {steps.length > 0 && (
            <>
              <div className="gesture-section-title">
                <strong>Your next step</strong>
                <span>
                  {step + 1} of {steps.length}
                </span>
              </div>
              <p className="gesture-step">{steps[step]}</p>
              <progress aria-label="Steps completed" value={step + 1} max={steps.length} />
            </>
          )}
          {editable && (
            <SourceEditor
              key="steps-source"
              initialOpen={!steps.length}
              summary={steps.length ? "Edit instructions & timer" : "Add your steps"}
            >
              <label>
                One step per line
                <textarea
                  aria-label="Instructions"
                  value={cfg.steps}
                  maxLength={15000}
                  rows={4}
                  placeholder={"Prepare ingredients\nMix together\nCook for five minutes"}
                  onChange={(e) => change({ steps: e.target.value })}
                />
              </label>
              <label>
                Timer (minutes)
                <input
                  aria-label="Timer minutes"
                  type="number"
                  min={0.1}
                  max={1440}
                  step={0.5}
                  value={cfg.timerSeconds / 60}
                  onChange={(e) => change({ timerSeconds: Number(e.target.value) * 60 })}
                />
              </label>
            </SourceEditor>
          )}
        </section>
      )}
      {cfg.mode === "routines" && editable && (
        <section className="gesture-content">
          <label>
            Routine to run
            <select
              aria-label="Saved routine"
              value={cfg.routineName}
              onChange={(e) => change({ routineName: e.target.value })}
            >
              <option value="">Choose a saved routine</option>
              {routines.map((r) => (
                <option value={r.name} key={r.id || r.name}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          {!routines.length && (
            <p className="gesture-muted">
              Save a routine in JARVIS first. You can still practice the gesture here.
            </p>
          )}
        </section>
      )}
      {!["reading", "cooking", "routines", "custom"].includes(cfg.mode) && (
        <p className="gesture-activity-hint">{ACTIVITIES[cfg.mode].prompt}</p>
      )}
      <QuickControls controls={controls} />
      {!controls.status.running && (QUICK_ACTIONS[cfg.mode] || []).length > 0 && (
        <p className="gesture-muted gesture-touch-hint">
          {cfg.mode === "photo"
            ? "Start the camera to take a photo."
            : "These buttons work with the camera off. Start the camera when you want gestures."}
        </p>
      )}
      {controls.practice && (
        <p className="gesture-muted gesture-touch-hint">
          Touch actions are off while you practice.
        </p>
      )}
      {controls.status.running && !controls.practice && (
        <p className="gesture-muted gesture-touch-hint">
          You can tap these controls too. Keep JARVIS visible.
        </p>
      )}
    </>
  );
}

export function SessionFeedback({ controls }) {
  return (
    <>
      <GestureFeedback controls={controls} />
      {controls.message && (
        <p className="gesture-result" role="status">
          {controls.message}
        </p>
      )}
      {!controls.message && !controls.status.running && (
        <p className="gesture-result" role="status">
          {controls.status.summary}
        </p>
      )}
    </>
  );
}
