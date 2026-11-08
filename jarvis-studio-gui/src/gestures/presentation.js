import { ACTIONS, defaults } from "./engine";
export const POSE_LABELS = {
  OPEN_PALM: "Open palm",
  PEACE: "Peace sign",
  THUMBS_UP: "Thumbs up",
  THUMBS_DOWN: "Thumbs down",
  POINT_UP: "Point up",
  LOVE: "Love sign",
  SWIPE_LEFT: "Swipe left",
  SWIPE_RIGHT: "Swipe right",
  SWIPE_UP: "Swipe up",
  SWIPE_DOWN: "Swipe down",
  FIST: "Closed fist",
};
export const POSE_HELP = {
  OPEN_PALM: "Face your palm toward the camera with all five fingers spread.",
  PEACE: "Raise your index and middle fingers in a V. Fold the other fingers down.",
  THUMBS_UP: "Close your fingers and point your thumb upward.",
  THUMBS_DOWN: "Close your fingers and point your thumb downward.",
  POINT_UP: "Raise just your index finger. Keep the rest folded into your palm.",
  LOVE: "Raise your thumb, index finger and little finger. Fold the middle two fingers.",
  FIST: "Close all your fingers into your palm and hold to stop the camera.",
  SWIPE_LEFT: "Point your index finger up, then move your whole hand to the left.",
  SWIPE_RIGHT: "Point your index finger up, then move your whole hand to the right.",
  SWIPE_UP: "Point your index finger up, then move your whole hand upward.",
  SWIPE_DOWN: "Point your index finger up, then move your whole hand downward.",
};
export const ACTIVITIES = {
  phone: {
    name: "Phone",
    icon: "hand",
    description: "Control your phone’s sound, flashlight and screen brightness.",
    prompt:
      "No PC needed. Start music in its app, then return to JARVIS to control it. Keep JARVIS visible for hand gestures.",
  },
  voice: {
    name: "Voice",
    icon: "mic",
    description: "Talk to JARVIS with your hands.",
    prompt: "Voice controls.",
  },
  media: {
    name: "Music",
    icon: "volume",
    description: "Playback and volume, without reaching for your device.",
    prompt: "Start your music in its app, then use these controls.",
  },
  pc: {
    name: "Slides",
    icon: "screen",
    description: "Move through a presentation on your PC.",
    prompt: "Keep JARVIS visible and give the presentation window focus.",
  },
  reading: {
    name: "Read",
    icon: "note",
    description: "Read at your own pace. Turn pages or listen aloud.",
    prompt: "Paste something to read, or use JARVIS’s latest reply.",
  },
  photo: {
    name: "Photo",
    icon: "camera",
    description: "Get in the frame. Take a photo with a gesture.",
    prompt: "A three-second countdown gives you time to pose.",
  },
  cooking: {
    name: "Steps",
    icon: "check",
    description: "Keep your place while cooking or following instructions.",
    prompt: "Put one step on each line. Your current step stays on screen.",
  },
  tv: {
    name: "TV",
    icon: "screen",
    description: "Control your paired television.",
    prompt: "Connect your TV in Devices before using playback controls.",
  },
  routines: {
    name: "Routines",
    icon: "play",
    description: "Start a saved routine with one deliberate gesture.",
    prompt: "Choose a routine. Its usual approval checks still apply.",
  },
  calls: {
    name: "Microphone",
    icon: "mic",
    description: "Control the system microphone where supported.",
    prompt: "Keep JARVIS visible. Check which microphone your meeting app uses.",
  },
  hud: {
    name: "Point & pinch",
    icon: "cursor",
    description: "Move around JARVIS with your hand.",
    prompt: "Point to move. Pinch and release on a safe button or card.",
  },
  custom: {
    name: "My gestures",
    icon: "skills",
    description: "Use a comfortable hand shape of your own.",
    prompt: "Teach a distinct pose, then choose what it does.",
  },
  accessibility: {
    name: "Gentle controls",
    icon: "user",
    description: "Hands-free voice with a response speed that suits you.",
    prompt: "Use Tune to choose a longer hold or adjust recognition.",
  },
};
export const MODE_DESCRIPTIONS = Object.fromEntries(
  Object.entries(ACTIVITIES).map(([id, value]) => [id, value.description]),
);
export const MAIN_ACTIVITIES = ["voice", "media", "pc", "reading", "photo", "cooking"];
export const PHONE_ACTIVITIES = ["phone", "media", "voice", "reading", "photo", "cooking"];
export const QUICK_ACTIONS = {
  phone: [
    "media.down",
    "media.toggle",
    "media.up",
    "phone.flashlightOn",
    "phone.flashlightOff",
    "phone.autoBrightness",
    "phone.dim",
    "phone.bright",
  ],
  voice: ["voice.listen", "voice.stop"],
  accessibility: ["voice.listen", "voice.stop"],
  media: ["media.previous", "media.toggle", "media.next", "media.down", "media.up", "media.mute"],
  tv: ["tv.previous", "tv.toggle", "tv.next", "tv.down", "tv.up", "tv.mute"],
  pc: ["pc.previous", "pc.next", "pc.toggle", "pc.mute"],
  reading: ["reader.previous", "reader.speak", "reader.next", "reader.bookmark"],
  cooking: ["steps.previous", "steps.repeat", "steps.next", "timer.start"],
  photo: ["photo.capture"],
  calls: ["mic.mute", "mic.unmute"],
  routines: ["routine.run"],
  hud: [],
  custom: [],
};
const SHORT_ACTIONS = {
  none: "No action",
  feedback: "Test pose only",
  "voice.listen": "Start listening",
  "voice.ptt": "Hold to talk",
  "voice.stop": "Stop speaking",
  "photo.capture": "Take photo",
  "routine.run": "Run routine",
  "reader.speak": "Read aloud",
  "reader.bookmark": "Save bookmark",
  "timer.start": "Start timer",
  "mic.mute": "Mute microphone",
  "mic.unmute": "Unmute microphone",
};
export function actionLabel(action) {
  const label =
    SHORT_ACTIONS[action] ||
    ACTIONS[action]?.replace(/^(Phone|Music|PC|TV|Reader|Instructions): /, "") ||
    "No action";
  return label[0].toUpperCase() + label.slice(1);
}
export function poseLabel(pose, config) {
  return (
    config.customPoses.find((item) => item.id === pose)?.name || POSE_LABELS[pose] || "Your pose"
  );
}
export function relevantActions(mode) {
  return [
    ...new Set([
      ...Object.values(defaults().bindings[mode]),
      ...(QUICK_ACTIONS[mode] || []),
      "voice.stop",
      "none",
    ]),
  ].filter((a) => a !== "feedback");
}
export const RESPONSE_PRESETS = [
  {
    name: "Deliberate",
    detail: "Fewer accidental triggers",
    holdMs: 1000,
    releaseMs: 500,
    confidence: 0.9,
  },
  {
    name: "Balanced",
    detail: "A good place to start",
    holdMs: 600,
    releaseMs: 400,
    confidence: 0.8,
  },
  { name: "Quick", detail: "Shorter holds", holdMs: 350, releaseMs: 300, confidence: 0.8 },
];

export const TASKS = ["voice", "media", "reading", "cooking", "photo", "routines"];
export const DEVICE_TASKS = ["phone", "pc", "tv", "calls"];
export const PRIMARY_ACTIONS = {
  phone: ["media.down", "media.toggle", "media.up"],
  media: ["media.previous", "media.toggle", "media.next"],
  tv: ["tv.previous", "tv.toggle", "tv.next"],
  pc: ["pc.previous", "pc.next"],
  reading: ["reader.previous", "reader.speak", "reader.next"],
  cooking: ["steps.previous", "steps.repeat", "steps.next"],
  voice: ["voice.listen", "voice.stop"],
  accessibility: ["voice.listen", "voice.stop"],
  photo: ["photo.capture"],
  calls: ["mic.mute", "mic.unmute"],
  routines: ["routine.run"],
};
export const SECONDARY_ACTIONS = {
  media: ["media.down", "media.up", "media.mute"],
  tv: ["tv.down", "tv.up", "tv.mute"],
  pc: ["pc.toggle", "pc.mute"],
  reading: ["reader.bookmark", "voice.stop"],
  cooking: ["voice.stop"],
  phone: [
    "phone.flashlightOn",
    "phone.flashlightOff",
    "phone.dim",
    "phone.bright",
    "phone.autoBrightness",
  ],
};
export function poseForAction(config, action) {
  const bindings = config.bindings[config.mode] || {};
  const poses = ["SWIPE_LEFT", "SWIPE_RIGHT", "SWIPE_UP", "SWIPE_DOWN", ...Object.keys(bindings)];
  return (
    poses.find(
      (pose) =>
        bindings[pose] === action || (action === "voice.listen" && bindings[pose] === "voice.ptt"),
    ) || null
  );
}
