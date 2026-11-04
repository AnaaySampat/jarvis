import { Icon } from "./GestureIcon";
import { poseLabel } from "./presentation";

export default function GestureFeedback({ controls }) {
  const recognition = controls.recognition;
  if (!controls.status.running || !recognition) return null;
  const paused = controls.paused || recognition.phase === "paused";
  const progress = paused ? 0 : Math.max(0, Math.min(1, recognition.progress || 0));
  const hasPose = recognition.pose && recognition.pose !== "UNKNOWN";
  return (
    <div className="gesture-feedback" data-phase={paused ? "paused" : recognition.phase}>
      <div className="gesture-feedback__heading">
        <strong>
          <Icon
            name={paused ? "eyeOff" : recognition.phase === "recognized" ? "check" : "activity"}
            size={15}
          />
          {paused
            ? "Gestures paused"
            : hasPose
              ? poseLabel(recognition.pose, controls.config)
              : recognition.phase === "neutral"
                ? "Lower your hand to begin"
                : "Ready for your hand"}
        </strong>
        {hasPose && !paused && <small>{Math.round((recognition.score || 0) * 100)}%</small>}
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
      <p role="status">
        {paused
          ? "Resume when you’re ready. The buttons still work."
          : recognition.hint || "Keep one whole hand in view."}
      </p>
    </div>
  );
}
