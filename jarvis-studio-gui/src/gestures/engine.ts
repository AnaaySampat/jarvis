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
  return matches[0]?.d < 0.12 && (!matches[1] || matches[1].d - matches[0].d > 0.04)
    ? matches[0].id
    : null;
}
export type GestureEvent =
  | { kind: "action"; action: Action | "voice.finish" | "voice.cancel"; pose: string }
  | { kind: "pointer"; phase: "move" | "down" | "up"; x: number; y: number }
  | { kind: "stop" };
export class GestureEngine {
  private seq = -1;
  private lastFrame = 0;
  private candidate = "UNKNOWN";
  private since = 0;
  private emitted = "";
  private releaseAt = 0;
  private ptt = false;
  private pinched = false;
  private anchor: { x: number; y: number; at: number } | null = null;
  private lastSwipe = 0;
  private needsNeutral = true;
  private neutralSince = 0;
  constructor(private config: GestureConfig) {}
  confirmPttStart(): boolean {
    if (this.needsNeutral || this.config.bindings[this.config.mode][this.candidate] !== "voice.ptt")
      return false;
    this.ptt = true;
    return true;
  }
  tick(now: number, visible = true, blocked = false): GestureEvent[] {
    if (!visible || blocked) return this.reset();
    if (!this.lastFrame || now - this.lastFrame < Math.max(700, this.config.releaseMs)) return [];
    const finish = this.ptt;
    this.ptt = false;
    const events = this.reset();
    if (finish) events.unshift({ kind: "action", action: "voice.finish", pose: "UNKNOWN" });
    return events;
  }
  reset(): GestureEvent[] {
    const events: GestureEvent[] = [];
    if (this.ptt) events.push({ kind: "action", action: "voice.cancel", pose: "UNKNOWN" });
    if (this.pinched) events.push({ kind: "pointer", phase: "up", x: -1, y: -1 });
    this.ptt = false;
    this.pinched = false;
    this.candidate = "UNKNOWN";
    this.emitted = "";
    this.anchor = null;
    this.lastFrame = 0;
    this.needsNeutral = true;
    this.neutralSince = 0;
    return events;
  }
  feed(frame: Frame, context: { visible: boolean; blocked: boolean; now: number }): GestureEvent[] {
    if (frame.seq <= this.seq) return [];
    this.seq = frame.seq;
    if (
      !context.visible ||
      context.blocked ||
      context.now - frame.observedAt > 1500 ||
      context.now < frame.observedAt
    )
      return this.reset();
    const now = context.now;
    const events: GestureEvent[] =
      this.lastFrame && (now - this.lastFrame > 2000 || now < this.lastFrame) ? this.reset() : [];
    this.lastFrame = now;
    let pose = frame.score >= this.config.confidence ? frame.pose : "UNKNOWN";
    if (this.config.customPoses.length && pose !== "FIST")
      pose = customPose(frame.landmarks, this.config.customPoses) || pose;
    if (pose === "FIST") {
      // Fist remains reserved on every platform, including during calibration.
      if (this.candidate !== pose) {
        this.candidate = pose;
        this.since = now;
      }
      if (now - this.since >= this.config.holdMs) return [...this.reset(), { kind: "stop" }];
      return events;
    }
    if (this.needsNeutral) {
      if (pose === "UNKNOWN") {
        if (!this.neutralSince) this.neutralSince = now;
        if (now - this.neutralSince >= this.config.releaseMs) this.needsNeutral = false;
      } else this.neutralSince = 0;
      return events;
    }
    if (this.config.mode === "hud" && validLandmarks(frame.landmarks)) {
      const p = frame.landmarks[8],
        scale = distance(frame.landmarks[0], frame.landmarks[9]);
      const x = Math.max(0, Math.min(1, this.config.mirror ? 1 - p[0] : p[0])),
        y = Math.max(0, Math.min(1, p[1]));
      const ratio = scale > 0.025 ? distance(frame.landmarks[4], p) / scale : Infinity;
      events.push({ kind: "pointer", phase: "move", x, y });
      if (!this.pinched && ratio < 0.22) {
        this.pinched = true;
        events.push({ kind: "pointer", phase: "down", x, y });
      } else if (this.pinched && ratio > 0.34) {
        this.pinched = false;
        events.push({ kind: "pointer", phase: "up", x, y });
      }
    } else if (this.pinched) {
      this.pinched = false;
      events.push({ kind: "pointer", phase: "up", x: -1, y: -1 });
    }
    if (pose === "POINT_UP" && validLandmarks(frame.landmarks) && now - this.lastSwipe > 1000) {
      const tip = frame.landmarks[8],
        x = this.config.mirror ? 1 - tip[0] : tip[0],
        y = tip[1];
      if (!this.anchor || now - this.anchor.at > 700) this.anchor = { x, y, at: now };
      const dx = x - this.anchor.x,
        dy = y - this.anchor.y;
      let swipe = "";
      if (Math.abs(dx) > 0.23 && Math.abs(dy) < 0.13) swipe = dx > 0 ? "SWIPE_RIGHT" : "SWIPE_LEFT";
      if (Math.abs(dy) > 0.23 && Math.abs(dx) < 0.13) swipe = dy > 0 ? "SWIPE_DOWN" : "SWIPE_UP";
      if (swipe) {
        this.lastSwipe = now;
        this.anchor = null;
        this.candidate = "UNKNOWN";
        this.emitted = "";
        const action = this.config.bindings[this.config.mode][swipe];
        if (action && action !== "none") events.push({ kind: "action", action, pose: swipe });
        return events;
      }
    } else this.anchor = null;
    if (pose !== this.candidate) {
      this.candidate = pose;
      this.since = now;
    }
    if (pose === "UNKNOWN") {
      if (!this.releaseAt) this.releaseAt = now;
      if (now - this.releaseAt >= this.config.releaseMs) {
        this.emitted = "";
        if (this.ptt) {
          this.ptt = false;
          events.push({ kind: "action", action: "voice.finish", pose });
        }
      }
      return events;
    }
    this.releaseAt = 0;
    if (this.ptt && this.config.bindings[this.config.mode][pose] !== "voice.ptt") {
      this.ptt = false;
      events.push({ kind: "action", action: "voice.finish", pose });
    }
    if (now - this.since < this.config.holdMs || pose === this.emitted) return events;
    this.emitted = pose;
    const action = this.config.bindings[this.config.mode][pose];
    if (action && action !== "none") {
      events.push({ kind: "action", action, pose });
    }
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
