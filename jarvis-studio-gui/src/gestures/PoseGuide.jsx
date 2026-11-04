import { ACTIONS } from "./engine";
import { POSE_GUIDES, poseName } from "./poseGuides";

export default function PoseGuide({ pose, action }) {
  const entry = POSE_GUIDES[pose];
  return (
    <article className="pose-guide">
      {entry && (
        <svg
          viewBox="0 0 100 110"
          aria-hidden="true"
          className={`pose-drawing${pose === "THUMBS_DOWN" ? " is-down" : ""}`}
        >
          <rect
            x="27"
            y="53"
            width="48"
            height="40"
            rx="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
          />
          {entry[2].slice(1).map((open, i) => (
            <path
              key={i}
              d={`M${33 + i * 12} 62 V${open ? 16 + Math.abs(i - 1) * 7 : 50}`}
              stroke="currentColor"
              strokeWidth="9"
              strokeLinecap="round"
            />
          ))}
          <path
            d={entry[2][0] ? "M30 72 L15 42" : "M30 72 L48 65"}
            stroke="currentColor"
            strokeWidth="10"
            strokeLinecap="round"
          />
          <path
            d="M36 91 V105 M66 91 V105"
            stroke="currentColor"
            strokeWidth="4"
          />
        </svg>
      )}
      <div>
        <b>{poseName(pose)}</b>
        <p>
          {entry?.[1] ||
            "Point your index finger and move your hand in the named direction."}
        </p>
        {action && <p className="pose-action">{ACTIONS[action] || action}</p>}
      </div>
    </article>
  );
}
