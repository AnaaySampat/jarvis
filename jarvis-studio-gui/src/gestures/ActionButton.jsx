import { Icon } from "./GestureIcon";
import GestureGlyph from "./GestureGlyph";
import { poseForAction } from "./presentation";

export default function ActionButton({
  controls,
  action,
  label,
  icon,
  disabled,
  onClick,
  primary = false,
}) {
  const pose = poseForAction(controls.config, action);
  const recognition = controls.recognition;
  const detected = Boolean(
    pose &&
    controls.status.running &&
    !controls.paused &&
    !controls.practice &&
    !controls.blocked &&
    recognition?.pose === pose,
  );
  const result = controls.history?.find((item) => item.action === action);
  return (
    <button
      type="button"
      className={`task-action${primary ? " is-primary" : ""}${detected ? " is-detected" : ""}`}
      aria-label={label}
      data-gesture-safe="true"
      data-action={action}
      data-state={result?.state}
      disabled={disabled}
      onClick={onClick || (() => controls.act(action))}
      style={{
        "--gesture-progress": `${detected ? Math.round((recognition.progress || 0) * 100) : 0}%`,
      }}
    >
      <span className="task-action-symbols" aria-hidden="true">
        <Icon name={icon} size={24} />
        {pose && <GestureGlyph pose={pose} size={34} />}
      </span>
      <span>{label}</span>
      {result?.state === "pending" && (
        <span className="task-action-result" aria-hidden="true">
          <Icon name="clock" size={13} />
        </span>
      )}
      {result?.state === "done" && (
        <span className="task-action-result" aria-hidden="true">
          <Icon name="check" size={13} />
        </span>
      )}
      {result?.state === "failed" && (
        <span className="task-action-result" aria-hidden="true">
          <Icon name="info" size={13} />
        </span>
      )}
      <span className="task-action-progress" aria-hidden="true" />
    </button>
  );
}
