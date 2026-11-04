export const POSE_GUIDES = {
  OPEN_PALM: [
    "Open palm",
    "Face your palm toward the camera with all five fingers open.",
    [1, 1, 1, 1, 1],
  ],
  PEACE: [
    "Peace sign",
    "Raise your index and middle fingers; fold the others.",
    [0, 1, 1, 0, 0],
  ],
  THUMBS_UP: [
    "Thumbs up",
    "Close your fingers and point your thumb up.",
    [1, 0, 0, 0, 0],
  ],
  THUMBS_DOWN: [
    "Thumbs down",
    "Close your fingers and point your thumb down.",
    [1, 0, 0, 0, 0],
  ],
  POINT_UP: [
    "Point up",
    "Raise your index finger and fold the others.",
    [0, 1, 0, 0, 0],
  ],
  LOVE: [
    "Love sign",
    "Raise your thumb, index and little finger.",
    [1, 1, 0, 0, 1],
  ],
};
export const practicePoses = Object.keys(POSE_GUIDES);
export function poseName(pose) {
  return POSE_GUIDES[pose]?.[0] || pose.replaceAll("_", " ").toLowerCase();
}
