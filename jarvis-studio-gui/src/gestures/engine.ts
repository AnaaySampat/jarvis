/** Shared Android/Windows gesture policy. No commands, model prompts or script
 * text may be stored as a gesture binding. Hosts implement this small vocabulary. */
export const ACTIONS = {
  none: "No action",
  "voice.stop": "Stop speaking",
  "voice.listen": "Start / finish listening",
  "voice.ptt": "Hold to talk; release to send",
  feedback: "Detection feedback",
  "media.toggle": "Music: play / pause",
  "media.mute": "Music: mute / unmute",
  "media.next": "Music: next track",
  "media.previous": "Music: previous track",
  "media.up": "Music: volume up",
  "media.down": "Music: volume down",
  "phone.flashlightOn": "Phone: flashlight on",
  "phone.flashlightOff": "Phone: flashlight off",
  "phone.bright": "Phone: brightness 80%",
  "phone.dim": "Phone: brightness 30%",
  "phone.autoBrightness": "Phone: automatic brightness",
  "tv.toggle": "TV: play / pause",
  "tv.mute": "TV: mute / unmute",
  "tv.next": "TV: next",
  "tv.previous": "TV: previous",
  "tv.up": "TV: volume up",
  "tv.down": "TV: volume down",
  "pc.next": "PC: next slide",
  "pc.previous": "PC: previous slide",
  "pc.toggle": "PC: play / pause",
  "pc.mute": "PC: media mute",
  "pc.up": "PC: volume up",
  "pc.down": "PC: volume down",
  "steps.next": "Instructions: next step",
  "steps.previous": "Instructions: previous step",
  "steps.repeat": "Instructions: repeat step",
  "timer.start": "Start the configured timer",
  "reader.next": "Reader: next page",
  "reader.previous": "Reader: previous page",
  "reader.speak": "Reader: read this page",
  "reader.bookmark": "Reader: bookmark this page",
  "reader.scrollDown": "Scroll down",
  "reader.scrollUp": "Scroll up",
  "routine.run": "Run the selected saved routine",
  "photo.capture": "Take a photo after countdown",
  "mic.mute": "Mute microphone",
  "mic.unmute": "Unmute microphone",
} as const;
export type Action = keyof typeof ACTIONS;
export const hasOwn = (value: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);
export const POSES = [
  "OPEN_PALM",
  "PEACE",
  "THUMBS_UP",
  "THUMBS_DOWN",
  "POINT_UP",
  "LOVE",
  "SWIPE_LEFT",
  "SWIPE_RIGHT",
  "SWIPE_UP",
  "SWIPE_DOWN",
] as const;
export const MODES = {
  phone: "Phone controls",
  voice: "Voice",
  media: "Music",
  tv: "TV",
  pc: "PC / presentations",
  cooking: "Cooking / workshop",
  reading: "Reading / research",
  routines: "Routines",
  accessibility: "Accessibility",
  photo: "Photos",
  calls: "Calls / meetings",
  hud: "HUD: point, pinch and drag",
  custom: "Custom poses",
} as const;
export type Mode = keyof typeof MODES;
export type Point = [number, number, number];
export interface Frame {
  seq: number;
  observedAt: number;
  pose: string;
  score: number;
  landmarks: Point[];
  /** Present on current camera hosts. Missing fields support older native bridges. */
  handCount?: number;
  runnerUpScore?: number;
}
export interface PoseTemplate {
  id: string;
  name: string;
  features: number[];
}
export interface GestureConfig {
  version: 2;
  mode: Mode;
  holdMs: number;
  releaseMs: number;
  confidence: number;
  bindings: Record<string, Record<string, Action>>;
  customPoses: PoseTemplate[];
  steps: string;
  reader: string;
  timerSeconds: number;
  routineName: string;
  cameraId: string;
  mirror: boolean;
}
const voice = { OPEN_PALM: "voice.stop", PEACE: "voice.ptt", THUMBS_UP: "feedback" };
const media = (prefix: string) => ({
  OPEN_PALM: prefix + ".toggle",
  PEACE: prefix + ".next",
  THUMBS_UP: prefix + ".up",
  THUMBS_DOWN: prefix + ".down",
  POINT_UP: prefix + ".mute",
  LOVE: prefix + ".previous",
  SWIPE_LEFT: prefix + ".previous",
  SWIPE_RIGHT: prefix + ".next",
});
export function defaults(): GestureConfig {
  return {
    version: 2,
    mode: "voice",
    holdMs: 600,
    releaseMs: 400,
    confidence: 0.8,
    bindings: {
      phone: {
        OPEN_PALM: "media.toggle",
        PEACE: "phone.flashlightOn",
        POINT_UP: "phone.flashlightOff",
        THUMBS_UP: "media.up",
        THUMBS_DOWN: "media.down",
        LOVE: "phone.autoBrightness",
        SWIPE_UP: "phone.bright",
        SWIPE_DOWN: "phone.dim",
      },
      voice: { ...voice },
      media: media("media"),
      tv: media("tv"),
      pc: { ...media("pc"), PEACE: "pc.next", LOVE: "pc.previous" },
      cooking: {
        OPEN_PALM: "steps.repeat",
        PEACE: "steps.next",
        THUMBS_UP: "timer.start",
        THUMBS_DOWN: "steps.previous",
        POINT_UP: "voice.stop",
      },
      reading: {
        OPEN_PALM: "reader.speak",
        PEACE: "reader.next",
        THUMBS_UP: "reader.bookmark",
        THUMBS_DOWN: "reader.previous",
        POINT_UP: "voice.stop",
        SWIPE_LEFT: "reader.previous",
        SWIPE_RIGHT: "reader.next",
        SWIPE_UP: "reader.scrollDown",
        SWIPE_DOWN: "reader.scrollUp",
      },
      routines: { PEACE: "routine.run", OPEN_PALM: "voice.stop" },
      accessibility: { ...voice },
      photo: { PEACE: "photo.capture" },
      calls: { OPEN_PALM: "mic.mute", PEACE: "mic.unmute" },
      hud: { SWIPE_UP: "reader.scrollDown", SWIPE_DOWN: "reader.scrollUp" },
      custom: {},
    } as Record<string, Record<string, Action>>,
    customPoses: [],
    steps: "",
    reader: "",
    timerSeconds: 300,
    routineName: "",
    cameraId: "",
    mirror: true,
  };
}
const finite = (n: unknown, min: number, max: number, fallback: number) =>
  typeof n === "number" && Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
export function sanitizeConfig(raw: unknown): GestureConfig {
  const cfg = defaults();
  if (!raw || typeof raw !== "object") return cfg;
  const r = raw as Partial<GestureConfig>;
  if (r.mode && hasOwn(MODES, r.mode)) cfg.mode = r.mode;
  cfg.holdMs = Math.round(finite(r.holdMs, 200, 2000, 600));
  cfg.releaseMs = Math.round(finite(r.releaseMs, 200, 1500, 400));
  cfg.confidence = finite(r.confidence, 0.65, 0.98, 0.8);
  cfg.timerSeconds = Math.round(finite(r.timerSeconds, 5, 86400, 300));
  for (const key of ["steps", "reader", "routineName", "cameraId"] as const) {
    if (typeof r[key] === "string")
      cfg[key] = r[key].slice(0, key === "reader" ? 30000 : key === "steps" ? 15000 : 200);
  }
  cfg.mirror = r.mirror !== false;
  cfg.customPoses = Array.isArray(r.customPoses)
    ? r.customPoses
        .filter(
          (p) =>
            p &&
            /^custom_[a-z0-9_-]{1,64}$/.test(p.id) &&
            typeof p.name === "string" &&
            Array.isArray(p.features) &&
            p.features.length === 35 &&
            p.features.every((n) => Number.isFinite(n) && n >= 0 && n <= 4),
        )
        .slice(0, 12)
        .map((p) => ({ id: p.id, name: p.name.slice(0, 40), features: [...p.features] }))
    : [];
  for (const mode of Object.keys(MODES)) {
    const bindings = r.bindings?.[mode];
    if (!bindings || typeof bindings !== "object") continue;
    for (const pose of [...POSES, ...cfg.customPoses.map((p) => p.id)]) {
      const action = bindings[pose];
      if (typeof action === "string" && hasOwn(ACTIONS, action))
        cfg.bindings[mode][pose] = action as Action;
    }
  }
  return cfg;
}
export function loadConfig(storage?: Pick<Storage, "getItem">): GestureConfig {
  try {
    return sanitizeConfig(JSON.parse(storage?.getItem("jarvis.gestures.v2") || "null"));
  } catch {
    return defaults();
  }
}
export function saveConfig(config: GestureConfig, storage: Pick<Storage, "setItem">): void {
  storage.setItem("jarvis.gestures.v2", JSON.stringify(sanitizeConfig(config)));
}
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export function validLandmarks(points: unknown): points is Point[] {
  return (
    Array.isArray(points) &&
    points.length === 21 &&
    points.every(
      (p) =>
        Array.isArray(p) &&
        p.length === 3 &&
        p.every(Number.isFinite) &&
        p[0] >= -0.2 &&
        p[0] <= 1.2 &&
        p[1] >= -0.2 &&
        p[1] <= 1.2 &&
        Math.abs(p[2]) <= 2,
    )
  );
}
/** Pair distances are invariant to translation, scale, rotation and handedness.
 * Only derived hand geometry is persisted, never camera frames. */
export function poseFeatures(points: Point[]): number[] | null {
  if (!validLandmarks(points)) return null;
  const scale = distance(points[0], points[9]);
  if (scale < 0.025) return null;
  const pairs: [number, number][] = [];
  for (const tip of [4, 8, 12, 16, 20])
    for (const joint of [0, 5, 9, 13, 17]) pairs.push([tip, joint]);
  const tips = [4, 8, 12, 16, 20];
  for (let i = 0; i < tips.length; i++)
    for (let j = i + 1; j < tips.length; j++) pairs.push([tips[i], tips[j]]);
  return pairs.map(([a, b]) => Math.min(4, distance(points[a], points[b]) / scale));
}
export function featureDistance(a: number[], b: number[]): number {
  return a.length === 35 && b.length === 35
    ? Math.sqrt(a.reduce((s, n, i) => s + (n - b[i]) ** 2, 0) / 35)
    : Infinity;
}
export function calibratePose(name: string, samples: Point[][], id: string): PoseTemplate {
  const vectors = samples.map(poseFeatures).filter((v): v is number[] => v !== null);
  if (vectors.length < 8 || vectors.length !== samples.length)
    throw new Error("Hold one hand clearly in view for calibration.");
  const mean = vectors[0].map((_, i) => vectors.reduce((s, v) => s + v[i], 0) / vectors.length);
  if (vectors.some((v) => featureDistance(v, mean) > 0.12))
    throw new Error("The pose moved too much. Hold it still and try again.");
  if (!name.trim()) throw new Error("Give the pose a name.");
  return { id, name: name.trim().slice(0, 40), features: mean };
}
function customPose(points: Point[], poses: PoseTemplate[]): string | null {
  const features = poseFeatures(points);
  if (!features) return null;
  const matches = poses
    .map((p) => ({ id: p.id, d: featureDistance(features, p.features) }))
    .sort((a, b) => a.d - b.d);
  if (!(matches[0]?.d < 0.12)) return null;
  return !matches[1] || matches[1].d - matches[0].d > 0.04 ? matches[0].id : "UNKNOWN";
}
export type GestureEvent =
  | { kind: "action"; action: Action | "voice.finish" | "voice.cancel"; pose: string }
  | { kind: "pointer"; phase: "move" | "down" | "up"; x: number; y: number }
  | { kind: "stop" };
export interface RecognitionFeedback {
  pose: string;
  score: number;
  progress: number;
  phase: "idle" | "neutral" | "tracking" | "holding" | "recognized" | "uncertain" | "paused";
  hint: string;
}
export const idleRecognition = (): RecognitionFeedback => ({
  pose: "UNKNOWN",
  score: 0,
  progress: 0,
  phase: "idle",
  hint: "Start the camera to try a gesture.",
});

/** Holds count consecutive camera evidence, never elapsed polling time. A short
 * uncertain frame pauses a hold; a different pose or a camera gap breaks it. */
class PoseHold {
  pose = "UNKNOWN";
  duration = 0;
  samples = 0;
  private lastMatch: number | null = null;
  private interruptedAt: number | null = null;
  get isMatching() {
    return this.pose !== "UNKNOWN" && this.lastMatch !== null && this.interruptedAt === null;
  }
  reset() {
    this.pose = "UNKNOWN";
    this.duration = this.samples = 0;
    this.lastMatch = this.interruptedAt = null;
  }
  update(pose: string, at: number) {
    if (pose === "UNKNOWN") {
      if (this.interruptedAt === null) this.interruptedAt = at;
      if (at - this.interruptedAt > 180) this.reset();
      this.lastMatch = null;
      return;
    }
    if (pose !== this.pose || (this.interruptedAt !== null && at - this.interruptedAt > 180)) {
      this.reset();
      this.pose = pose;
    }
    if (this.lastMatch !== null) this.duration += at - this.lastMatch;
    this.samples++;
    this.lastMatch = at;
    this.interruptedAt = null;
  }
  ready(ms: number) {
    return this.samples >= 3 && this.duration >= ms;
  }
}
export class GestureEngine {
  private seq = -1;
  private lastFrame: number | null = null;
  private hold = new PoseHold();
  private emitted = "";
  private releaseAt: number | null = null;
  private ptt = false;
  private pinched = false;
  private pinchAt: number | null = null;
  private pointer: { x: number; y: number } | null = null;
  private anchor: { x: number; y: number; at: number; samples: number; moving: boolean } | null =
    null;
  private needsNeutral = true;
  private neutralSince: number | null = null;
  private neutralSamples = 0;
  recognition = idleRecognition();
  constructor(private config: GestureConfig) {}
  confirmPttStart(): boolean {
    if (
      this.needsNeutral ||
      !this.hold.isMatching ||
      this.emitted !== this.hold.pose ||
      this.config.bindings[this.config.mode][this.hold.pose] !== "voice.ptt"
    )
      return false;
    this.ptt = true;
    return true;
  }
  tick(now: number, visible = true, blocked = false): GestureEvent[] {
    if (!visible || blocked) {
      const events = this.reset();
      this.recognition = {
        ...idleRecognition(),
        phase: "paused",
        hint: "Gestures paused. Keep JARVIS visible and finish the current approval.",
      };
      return events;
    }
    if (this.lastFrame === null || now - this.lastFrame < 700) return [];
    const finish = this.ptt;
    this.ptt = false;
    const events = this.reset();
    this.recognition = {
      ...idleRecognition(),
      phase: "uncertain",
      hint: "Camera tracking stalled. Lower your hand and try again.",
    };
    if (finish) events.unshift({ kind: "action", action: "voice.finish", pose: "UNKNOWN" });
    return events;
  }
  reset(): GestureEvent[] {
    const events: GestureEvent[] = [];
    if (this.ptt) events.push({ kind: "action", action: "voice.cancel", pose: "UNKNOWN" });
    if (this.pinched || this.pointer) events.push({ kind: "pointer", phase: "up", x: -1, y: -1 });
    this.ptt = this.pinched = false;
    this.pinchAt = null;
    this.pointer = null;
    this.hold.reset();
    this.emitted = "";
    this.anchor = null;
    this.lastFrame = null;
    this.releaseAt = this.neutralSince = null;
    this.neutralSamples = 0;
    this.needsNeutral = true;
    this.recognition = idleRecognition();
    return events;
  }
  feed(frame: Frame, context: { visible: boolean; blocked: boolean; now: number }): GestureEvent[] {
    if (!Number.isFinite(frame.seq) || frame.seq <= this.seq) return [];
    this.seq = frame.seq;
    if (
      !context.visible ||
      context.blocked ||
      !Number.isFinite(frame.observedAt) ||
      !Number.isFinite(context.now) ||
      context.now - frame.observedAt > 600 ||
      context.now < frame.observedAt
    ) {
      const events = this.reset();
      this.recognition = {
        ...idleRecognition(),
        phase: "paused",
        hint: "Waiting for a fresh camera frame.",
      };
      return events;
    }
    const now = frame.observedAt;
    // A sequence increment is not evidence of elapsed capture time.
    if (this.lastFrame !== null && now <= this.lastFrame) return [];
    const gap = this.lastFrame === null ? 0 : now - this.lastFrame;
    const events: GestureEvent[] = gap > 350 ? this.reset() : [];
    this.lastFrame = now;
    const points = frame.landmarks;
    const hand = validLandmarks(points);
    const noHand =
      frame.handCount === 0 ||
      (frame.handCount === undefined && !points?.length && frame.pose === "UNKNOWN");
    const quality =
      hand &&
      distance(points[0], points[9]) >= 0.04 &&
      points.every((p) => p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1);
    const tracked = frame.handCount === undefined || (frame.handCount === 1 && quality);
    const score =
      Number.isFinite(frame.score) && frame.score >= 0 && frame.score <= 1 ? frame.score : 0;
    const margin =
      frame.runnerUpScore === undefined ||
      (Number.isFinite(frame.runnerUpScore) &&
        frame.runnerUpScore >= 0 &&
        frame.runnerUpScore <= 1 &&
        score - frame.runnerUpScore >= 0.12);
    let pose =
      tracked &&
      !noHand &&
      margin &&
      score >= this.config.confidence &&
      [...POSES.slice(0, 6), "FIST"].includes(frame.pose)
        ? frame.pose
        : "UNKNOWN";
    if (pose === "FIST" && score < Math.max(0.85, this.config.confidence)) pose = "UNKNOWN";
    if (
      quality &&
      this.config.customPoses.length &&
      frame.pose !== "FIST" &&
      (pose === "UNKNOWN" || this.config.mode === "custom") &&
      frame.handCount !== 0 &&
      (frame.handCount === undefined || frame.handCount === 1)
    ) {
      pose = customPose(points, this.config.customPoses) || pose;
    }
    this.hold.update(pose, now);
    const holdMs = pose === "FIST" ? Math.max(800, this.config.holdMs) : this.config.holdMs;
    this.recognition = {
      pose,
      score,
      progress: Math.min(1, this.hold.duration / holdMs),
      phase: "holding",
      hint: "Hold this pose steady.",
    };
    if (pose === "FIST") {
      this.anchor = null;
      if (this.hold.ready(holdMs)) return [...events, ...this.reset(), { kind: "stop" }];
      this.recognition.hint = "Keep your fist closed to stop the camera.";
      return events;
    }
    if (noHand) {
      this.hold.reset();
      this.anchor = null;
      if (this.neutralSince === null) this.neutralSince = now;
      this.neutralSamples++;
      const released = now - this.neutralSince >= this.config.releaseMs && this.neutralSamples >= 3;
      if (released) {
        this.needsNeutral = false;
        this.emitted = "";
        if (this.ptt) {
          this.ptt = false;
          events.push({ kind: "action", action: "voice.finish", pose: "UNKNOWN" });
        }
      }
      this.recognition = {
        pose: "UNKNOWN",
        score: 0,
        progress: 0,
        phase: released ? "tracking" : "neutral",
        hint: released
          ? "Ready. Raise one hand and hold a gesture."
          : "Lower your hand briefly to get ready.",
      };
    } else {
      this.neutralSince = null;
      this.neutralSamples = 0;
      if (this.needsNeutral || this.emitted) {
        this.recognition = {
          ...this.recognition,
          progress: this.emitted ? 1 : 0,
          phase: this.emitted ? "recognized" : "neutral",
          hint: this.emitted
            ? "Gesture recognized. Lower your hand before another command."
            : "Lower your hand out of view first.",
        };
      }
    }
    if (pose === "UNKNOWN") {
      if (!noHand)
        this.recognition = {
          pose,
          score,
          progress: 0,
          phase: "uncertain",
          hint:
            frame.handCount && frame.handCount > 1
              ? "Show only one hand at a time."
              : hand && !quality
                ? "Move back so your whole hand is clearly in view."
                : "Pose unclear. Face your hand toward the camera and improve the lighting.",
        };
      if (this.releaseAt === null) this.releaseAt = now;
      if (this.ptt && now - this.releaseAt >= this.config.releaseMs) {
        this.ptt = false;
        events.push({ kind: "action", action: "voice.finish", pose });
      }
    } else {
      this.releaseAt = null;
      if (this.ptt && this.config.bindings[this.config.mode][pose] !== "voice.ptt") {
        this.ptt = false;
        events.push({ kind: "action", action: "voice.finish", pose });
      }
    }
    if (this.needsNeutral) return events;
    if (
      this.config.mode === "hud" &&
      quality &&
      !noHand &&
      (frame.handCount === undefined || frame.handCount === 1)
    ) {
      const p = points[8],
        scale = distance(points[0], points[9]);
      const target = {
        x: Math.max(0, Math.min(1, this.config.mirror ? 1 - p[0] : p[0])),
        y: Math.max(0, Math.min(1, p[1])),
      };
      const alpha = this.pointer ? 1 - Math.exp(-gap / 75) : 1;
      const x = this.pointer ? this.pointer.x + alpha * (target.x - this.pointer.x) : target.x;
      const y = this.pointer ? this.pointer.y + alpha * (target.y - this.pointer.y) : target.y;
      this.pointer = { x, y };
      const ratio = distance(points[4], p) / scale;
      events.push({ kind: "pointer", phase: "move", x, y });
      if (!this.pinched && ratio < 0.22) {
        if (this.pinchAt === null) this.pinchAt = now;
        if (now - this.pinchAt >= 120) {
          this.pinched = true;
          events.push({ kind: "pointer", phase: "down", x, y });
        }
      } else if (this.pinched && ratio > 0.34) {
        this.pinched = false;
        this.pinchAt = null;
        events.push({ kind: "pointer", phase: "up", x, y });
      } else if (!this.pinched) this.pinchAt = null;
    } else {
      if (this.pinched || this.pointer) events.push({ kind: "pointer", phase: "up", x: -1, y: -1 });
      this.pinched = false;
      this.pinchAt = null;
      this.pointer = null;
    }
    if (this.emitted) return events;
    const bindings = this.config.bindings[this.config.mode];
    const hasSwipes = ["SWIPE_LEFT", "SWIPE_RIGHT", "SWIPE_UP", "SWIPE_DOWN"].some(
      (p) => bindings[p] && bindings[p] !== "none",
    );
    if (pose === "POINT_UP" && quality && hasSwipes) {
      // Track the palm, so bending a pointing finger cannot look like a swipe.
      const center = [0, 5, 9, 13, 17].reduce(
        (p, i) => ({ x: p.x + points[i][0] / 5, y: p.y + points[i][1] / 5 }),
        { x: 0, y: 0 },
      );
      const x = this.config.mirror ? 1 - center.x : center.x,
        y = center.y;
      if (!this.anchor || now - this.anchor.at > 700)
        this.anchor = { x, y, at: now, samples: 0, moving: false };
      this.anchor.samples++;
      const dx = x - this.anchor.x,
        dy = y - this.anchor.y;
      if (Math.hypot(dx, dy) > 0.07) this.anchor.moving = true;
      let swipe = "";
      if (this.anchor.samples >= 3 && now - this.anchor.at >= 120) {
        if (Math.abs(dx) > 0.23 && Math.abs(dy) < 0.13)
          swipe = dx > 0 ? "SWIPE_RIGHT" : "SWIPE_LEFT";
        if (Math.abs(dy) > 0.23 && Math.abs(dx) < 0.13) swipe = dy > 0 ? "SWIPE_DOWN" : "SWIPE_UP";
      }
      if (swipe && bindings[swipe] && bindings[swipe] !== "none") {
        this.emitted = swipe;
        this.anchor = null;
        this.hold.reset();
        this.recognition = {
          pose: swipe,
          score,
          progress: 1,
          phase: "recognized",
          hint: "Swipe recognized. Lower your hand before another command.",
        };
        events.push({ kind: "action", action: bindings[swipe], pose: swipe });
        return events;
      }
      if (this.anchor.moving) {
        this.hold.reset();
        this.recognition = {
          pose,
          score,
          progress: 0,
          phase: "tracking",
          hint: "Move your pointing hand smoothly to swipe.",
        };
        return events;
      }
    } else this.anchor = null;
    if (pose === "UNKNOWN" || !this.hold.ready(holdMs)) return events;
    this.emitted = pose;
    const action = bindings[pose];
    this.recognition = {
      pose,
      score,
      progress: 1,
      phase: "recognized",
      hint:
        action && action !== "none"
          ? "Gesture recognized. Lower your hand before another command."
          : "Pose recognized. No action is assigned in this mode.",
    };
    if (action && action !== "none") events.push({ kind: "action", action, pose });
    return events;
  }
}
export function readerPages(text: string): string[] {
  const paragraphs = text
    .trim()
    .split(/\n\s*\n/)
    .filter(Boolean);
  const pages: string[] = [];
  for (const para of paragraphs)
    for (let n = 0; n < para.length; n += 1600) pages.push(para.slice(n, n + 1600));
  return pages;
}
export function reorderCards(
  order: Record<string, string[]>,
  from: string,
  to: string,
): Record<string, string[]> {
  const allowed = ["system", "power", "agenda", "weather", "network", "terminal"];
  if (from === to || !allowed.includes(from) || !allowed.includes(to)) return order;
  const next = { left: [...(order.left || [])], right: [...(order.right || [])] };
  if (![...next.left, ...next.right].includes(from)) return order;
  const side = next.left.includes(to) ? "left" : next.right.includes(to) ? "right" : null;
  if (!side) return order;
  next.left = next.left.filter((k) => k !== from);
  next.right = next.right.filter((k) => k !== from);
  next[side].splice(next[side].indexOf(to), 0, from);
  return next;
}
