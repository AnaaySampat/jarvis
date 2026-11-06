import { Icon } from "./GestureIcon";
import GestureGlyph from "./GestureGlyph";
import { actionLabel } from "./presentation";

export default function GestureFeedback({ controls }) {
  const recognition = controls.recognition;
  if (!controls.status.running || !recognition) return null;
  const paused = controls.paused || recognition.phase === "paused";
  const progress = paused ? 0 : Math.max(0, Math.min(1, recognition.progress || 0));
  const hasPose = recognition.pose && recognition.pose !== "UNKNOWN";
  const action = controls.config.bindings[controls.config.mode][recognition.pose];
  return (
    <div className="gesture-feedback" data-phase={paused ? "paused" : recognition.phase}>
      <div className="gesture-feedback__heading">
        <strong role="status">
          <Icon
            name={paused ? "eyeOff" : recognition.phase === "recognized" ? "check" : "activity"}
            size={15}
          />
          {paused
            ? "Paused"
            : controls.listening
              ? "Listening"
              : recognition.pose === "FIST"
                ? "Stop camera"
                : hasPose
                  ? action && !["none", "feedback"].includes(action)
                    ? actionLabel(action)
                    : "No shortcut"
                  : recognition.phase === "neutral"
                    ? "Resetting"
                    : recognition.phase === "uncertain"
                      ? "Hand not clear"
                      : "Ready"}
        </strong>
        {!paused && ["neutral", "recognized"].includes(recognition.phase) && (
          <span className="task-release-cue" aria-label="Waiting for hand release">
            <GestureGlyph pose="OPEN_PALM" size={22} />
            <Icon name="arrowDown" size={14} />
          </span>
        )}
      </div>
      <div
        role="progressbar"
        aria-label="Gesture hold progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        className="gesture-feedback__track"
      >
        <span style={{ width: `${progress * 100}%` }} />
      </div>
    </div>
  );
}
