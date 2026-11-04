const outlines = {
  OPEN_PALM:
    "M25 57 16 44q-4-6 1-9 4-2 8 3l5 6V18q0-6 5-6t5 6v22-29q0-6 5-6t5 6v29-25q0-6 5-6t5 6v28-18q0-5 5-5t5 5v29q0 14-9 23v11H35V69q-6-5-10-12Z",
  PEACE:
    "M30 46 21 17q-2-6 3-8 5-1 7 5l10 24 4-28q1-6 6-5 5 0 4 6l-3 32q4-6 9-2l5 5q9-3 10 5v10q0 12-11 20v7H38v-8q-8-4-12-11L17 54q-3-5 1-8 4-2 8 2l8 9",
  POINT_UP:
    "M30 47V13q0-7 6-7t6 7v29q4-6 10-2 7-3 11 3 9-2 10 6v12q0 12-11 19v8H36v-8q-7-3-11-10L17 55q-4-6 1-9 4-2 8 3l8 10",
  FIST: "M23 46V35q0-7 6-7 5 0 5 6v-4q0-7 6-7 6 0 6 7v-1q0-6 6-6t6 6v4q0-6 6-6t6 6v25q0 11-10 19v10H32V77q-11-7-11-19V48q0-6 6-6h20q6 0 6 6t-6 6H34m0-20v8m12-12v12m12-9v12",
  THUMBS_UP:
    "M30 43 42 26V12q0-6 5-6 8 0 8 12l-3 17h17q10 0 8 10l-6 27q-1 7-9 7H39l-9-5V43Zm-14 0h14v36H16V43Z",
  LOVE: "M28 48 19 29q-3-6 2-8 4-2 7 3l5 9V13q0-6 5-6t5 6v31q4-7 10-3 6-5 11 1V20q0-6 5-6t5 6v39q0 12-12 21v8H36v-8q-6-4-10-11L16 54q-3-6 2-8 4-2 7 3l7 9",
};

/** Finger-placement illustrations; these never represent a live camera detection. */
export default function GestureGlyph({ pose = "OPEN_PALM", size = 76, className = "" }) {
  const swipe = pose.startsWith("SWIPE_");
  const key = swipe ? "POINT_UP" : pose === "THUMBS_DOWN" ? "THUMBS_UP" : pose;
  const path = outlines[key] || outlines.OPEN_PALM;
  const rotation = pose === "THUMBS_DOWN" ? "rotate(180 46 46)" : undefined;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 92 96"
      fill="none"
      aria-hidden="true"
      className={`gesture-glyph ${className}`}
    >
      <g transform={rotation}>
        <path
          d={path}
          fill="currentColor"
          fillOpacity=".09"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M38 75h20"
          stroke="currentColor"
          strokeOpacity=".3"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </g>
      {swipe && (
        <path
          d={
            pose === "SWIPE_LEFT"
              ? "M27 85H5m7-7-7 7 7 7"
              : pose === "SWIPE_RIGHT"
                ? "M65 85h22m-7-7 7 7-7 7"
                : pose === "SWIPE_UP"
                  ? "M83 36V9m-6 7 6-7 6 7"
                  : "M83 10v27m-6-7 6 7 6-7"
          }
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}
