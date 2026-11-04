import { describe, expect, it } from "vitest";
import {
  defaults,
  GestureEngine,
  sanitizeConfig,
  calibratePose,
  poseFeatures,
  featureDistance,
  reorderCards,
  type Point,
  type Frame,
} from "./engine";
import { clampIndex, documentId, loadBookmarks } from "./storage";
const T = 1_800_000_000_000;
function stream(config = defaults()) {
  const engine = new GestureEngine(config);
  let seq = 0;
  const feed = (
    pose: string,
    offset: number,
    score = 1,
    landmarks: Point[] = [],
    extra: Partial<Frame> = {},
  ) =>
    engine.feed(
      { seq: ++seq, observedAt: T + offset, pose, score, landmarks, ...extra },
      { visible: true, blocked: false, now: T + offset },
    );
  const hold = (
    pose: string,
    from: number,
    to: number,
    score = 1,
    landmarks: Point[] = [],
    extra: Partial<Frame> = {},
  ) => {
    const events = [];
    for (let at = from; at <= to; at += 100)
      events.push(...feed(pose, at, score, landmarks, extra));
    return events;
  };
  hold("UNKNOWN", 0, 400);
  return { engine, feed, hold };
}
function hand(): Point[] {
  return Array.from({ length: 21 }, (_, i) => [
    0.3 + (i % 4) * 0.035,
    0.2 + Math.floor(i / 4) * 0.06,
    (i % 3) * 0.005,
  ]);
}
describe("gesture session policy", () => {
  it("requires a hold, emits once, and can rearm after release", () => {
    const { feed, hold } = stream();
    expect(feed("OPEN_PALM", 500)).toEqual([]);
    expect(hold("OPEN_PALM", 600, 1100)).toEqual([
      { kind: "action", action: "voice.stop", pose: "OPEN_PALM" },
    ]);
    expect(feed("OPEN_PALM", 1200)).toEqual([]);
    feed("UNKNOWN", 1300);
    hold("UNKNOWN", 1400, 1700);
    feed("OPEN_PALM", 1800);
    expect(hold("OPEN_PALM", 1900, 2400)).toHaveLength(1);
  });
  it("pauses a hold across a brief low-confidence frame without counting the gap", () => {
    const { feed, hold } = stream();
    hold("OPEN_PALM", 500, 800);
    expect(feed("OPEN_PALM", 900, 0.5)).toEqual([]);
    expect(feed("OPEN_PALM", 1000)).toEqual([]);
    expect(hold("OPEN_PALM", 1100, 1200)).toEqual([]);
    expect(feed("OPEN_PALM", 1300)).toEqual([
      { kind: "action", action: "voice.stop", pose: "OPEN_PALM" },
    ]);
    feed("UNKNOWN", 1350);
    feed("OPEN_PALM", 1450);
    expect(feed("OPEN_PALM", 2000)).toEqual([]);
  });
  it("restarts the hold after sustained tracking loss or another recognized pose", () => {
    const { feed, hold } = stream();
    hold("OPEN_PALM", 500, 700);
    feed("UNKNOWN", 800);
    feed("UNKNOWN", 1000);
    expect(hold("OPEN_PALM", 1100, 1600)).toEqual([]);
    feed("THUMBS_UP", 1700);
    expect(hold("OPEN_PALM", 1800, 2300)).toEqual([]);
    expect(feed("OPEN_PALM", 2400)[0]).toMatchObject({ action: "voice.stop" });
  });
  it("does not admit a delayed push-to-talk start during a tracking dropout", () => {
    const { engine, feed, hold } = stream();
    expect(hold("PEACE", 500, 1100)).toContainEqual({
      kind: "action",
      action: "voice.ptt",
      pose: "PEACE",
    });
    feed("PEACE", 1200, 0.5);
    expect(engine.confirmPttStart()).toBe(false);
  });
  it("does not count bridge delays as time holding a gesture", () => {
    const { engine, feed } = stream();
    feed("OPEN_PALM", 500);
    const delayed = (seq: number, capture: number, delivered: number) =>
      engine.feed(
        { seq, observedAt: T + capture, pose: "OPEN_PALM", score: 1, landmarks: [] },
        { visible: true, blocked: false, now: T + delivered },
      );
    expect(delayed(7, 800, 1300)).toEqual([]);
    expect(delayed(8, 1100, 1400)[0]).toMatchObject({ action: "voice.stop" });
  });
  it("finishes only admitted PTT when a camera stops producing frames", () => {
    const { engine, feed, hold } = stream();
    feed("PEACE", 500);
    expect(hold("PEACE", 600, 1100)[0]).toMatchObject({ action: "voice.ptt" });
    expect(engine.confirmPttStart()).toBe(true);
    expect(engine.tick(T + 1801)).toContainEqual({
      kind: "action",
      action: "voice.finish",
      pose: "UNKNOWN",
    });
    expect(engine.tick(T + 3000)).toEqual([]);
  });
  it("does not finish a PTT request that the host rejected", () => {
    const { engine, feed, hold } = stream();
    feed("PEACE", 500);
    hold("PEACE", 600, 1100);
    expect(engine.tick(T + 1801)).toEqual([]);
    feed("UNKNOWN", 1900);
    hold("UNKNOWN", 2000, 2400);
    expect(engine.confirmPttStart()).toBe(false);
  });
  it("cancels owned capture on blocked or hidden state without submitting it", () => {
    const { engine, feed, hold } = stream();
    feed("PEACE", 500);
    hold("PEACE", 600, 1100);
    engine.confirmPttStart();
    expect(engine.tick(T + 1200, false)).toContainEqual({
      kind: "action",
      action: "voice.cancel",
      pose: "UNKNOWN",
    });
    expect(engine.tick(T + 3000)).toEqual([]);
  });
  it("reserves fist stop even before neutral and regardless of its binding", () => {
    const engine = new GestureEngine(defaults());
    const f = (n: number): Frame => ({
      seq: n,
      observedAt: T + n * 100,
      pose: "FIST",
      score: 1,
      landmarks: [],
    });
    for (let n = 1; n < 9; n++)
      engine.feed(f(n), { visible: true, blocked: false, now: T + n * 100 });
    expect(engine.feed(f(9), { visible: true, blocked: false, now: T + 900 })).toContainEqual({
      kind: "stop",
    });
  });
  it("rejects stale and monotonic-clock timestamps", () => {
    const { engine } = stream();
    expect(
      engine.feed(
        { seq: 50, observedAt: performance.now(), pose: "OPEN_PALM", score: 1, landmarks: [] },
        { visible: true, blocked: false, now: T },
      ),
    ).toEqual([]);
  });
  it("accepts a restarted counter in a fresh session", () => {
    const old = stream();
    old.feed("OPEN_PALM", 500);
    old.hold("OPEN_PALM", 600, 1100);
    const fresh = stream();
    fresh.feed("OPEN_PALM", 500);
    expect(fresh.hold("OPEN_PALM", 600, 1100)[0]).toMatchObject({ action: "voice.stop" });
  });
  it("rejects unsafe stored commands and clamps accessibility timing", () => {
    const config = sanitizeConfig({
      holdMs: 1,
      releaseMs: 999999,
      confidence: NaN,
      bindings: { voice: { PEACE: "approve", FIST: "power.shutdown" } },
    });
    expect(config.holdMs).toBe(200);
    expect(config.releaseMs).toBe(1500);
    expect(config.bindings.voice.PEACE).toBe("voice.ptt");
    expect(config.bindings.voice.FIST).toBeUndefined();
  });
  it("tracks pinch hysteresis, mirroring and release after a hand disappears", () => {
    const cfg = defaults();
    cfg.mode = "hud";
    const { engine, feed } = stream(cfg),
      points = hand();
    points[8] = [0.4, 0.5, 0];
    points[4] = [0.401, 0.5, 0];
    expect(
      feed("UNKNOWN", 500, 1, points).some((e) => e.kind === "pointer" && e.phase === "down"),
    ).toBe(false);
    feed("UNKNOWN", 600, 1, points);
    expect(feed("UNKNOWN", 700, 1, points)).toContainEqual({
      kind: "pointer",
      phase: "down",
      x: 0.6,
      y: 0.5,
    });
    expect(
      feed("UNKNOWN", 800, 1, points).some((e) => e.kind === "pointer" && e.phase === "down"),
    ).toBe(false);
    expect(engine.tick(T + 1600)).toContainEqual({ kind: "pointer", phase: "up", x: -1, y: -1 });
  });
  it("turns a palm translation into one page action until released", () => {
    const cfg = defaults();
    cfg.mode = "reading";
    cfg.mirror = false;
    const { feed } = stream(cfg),
      start = hand(),
      middle = hand().map(([x, y, z]) => [x + 0.15, y, z] as Point),
      end = hand().map(([x, y, z]) => [x + 0.3, y, z] as Point);
    expect(feed("POINT_UP", 500, 1, start)).toEqual([]);
    expect(feed("POINT_UP", 600, 1, middle)).toEqual([]);
    expect(feed("POINT_UP", 700, 1, end)).toContainEqual({
      kind: "action",
      action: "reader.next",
      pose: "SWIPE_RIGHT",
    });
    expect(feed("POINT_UP", 800, 1, start)).toEqual([]);
  });
});
describe("recognition reliability", () => {
  it("rejects two sparse detections and requires neutral after tracking gaps", () => {
    const { feed, hold } = stream();
    feed("OPEN_PALM", 500);
    expect(feed("OPEN_PALM", 1100)).toEqual([]);
    expect(hold("OPEN_PALM", 1200, 2000)).toEqual([]);
    hold("UNKNOWN", 2100, 2500);
    expect(hold("OPEN_PALM", 2600, 3200)).toHaveLength(1);
  });
  it("pauses a hold for brief confidence flicker without counting the missing evidence", () => {
    const { feed, hold } = stream();
    hold("OPEN_PALM", 500, 800);
    feed("OPEN_PALM", 900, 0.5);
    expect(hold("OPEN_PALM", 1000, 1200)).toEqual([]);
    expect(feed("OPEN_PALM", 1300)).toHaveLength(1);
  });
  it("requires a real release between different poses", () => {
    const { hold } = stream();
    expect(hold("OPEN_PALM", 500, 1100)).toHaveLength(1);
    expect(hold("PEACE", 1200, 2000)).toEqual([]);
    hold("UNKNOWN", 2100, 2500);
    expect(hold("PEACE", 2600, 3200)[0]).toMatchObject({ action: "voice.ptt" });
  });
  it("does not rearm on an uncertain hand or a partial/cropped hand", () => {
    const { hold } = stream();
    const points = hand();
    expect(hold("OPEN_PALM", 500, 1100, 1, points, { handCount: 1 })).toHaveLength(1);
    hold("UNKNOWN", 1200, 1700, 1, points, { handCount: 1 });
    expect(hold("OPEN_PALM", 1800, 2500, 1, points, { handCount: 1 })).toEqual([]);
    const partial = points.map(([x, y, z]) => [x - 0.4, y, z] as Point);
    expect(hold("OPEN_PALM", 2600, 3300, 1, partial, { handCount: 1 })).toEqual([]);
  });
  it("rejects multiple hands, ambiguous classifiers and invalid scores", () => {
    for (const extra of [
      { handCount: 2 },
      { handCount: 0 },
      { runnerUpScore: 0.88 },
      { runnerUpScore: NaN },
    ]) {
      const { hold } = stream();
      expect(hold("OPEN_PALM", 500, 1400, 0.95, hand(), extra)).toEqual([]);
    }
    for (const score of [NaN, Infinity, 1.1, -0.1]) {
      expect(stream().hold("OPEN_PALM", 500, 1400, score)).toEqual([]);
    }
  });
  it("uses capture timestamps and ignores duplicate capture times", () => {
    const { engine, feed, hold } = stream();
    hold("OPEN_PALM", 500, 800);
    expect(feed("OPEN_PALM", 1000, 1, [], { observedAt: T + 800 })).toEqual([]);
    expect(feed("OPEN_PALM", 1100, 1, [], { observedAt: T + 900 })).toEqual([]);
    expect(feed("OPEN_PALM", 1200, 1, [], { observedAt: T + 1000 })).toEqual([]);
    expect(feed("OPEN_PALM", 1300, 1, [], { observedAt: T + 1100 })).toHaveLength(1);
    expect(engine.recognition.phase).toBe("recognized");
  });
  it("requires stronger and longer fist evidence even with responsive settings", () => {
    const cfg = defaults();
    cfg.holdMs = 200;
    cfg.confidence = 0.65;
    const { feed, hold } = stream(cfg);
    expect(hold("FIST", 500, 1400, 0.8)).toEqual([]);
    expect(hold("FIST", 1500, 2200, 0.95)).toEqual([]);
    expect(feed("FIST", 2300, 0.95)).toContainEqual({ kind: "stop" });
  });
  it("does not turn finger flexing or a two-frame jump into a swipe", () => {
    const cfg = defaults();
    cfg.mode = "reading";
    const { feed } = stream(cfg);
    const a = hand(),
      b = hand();
    b[8][0] += 0.3;
    feed("POINT_UP", 500, 1, a);
    expect(feed("POINT_UP", 600, 1, b)).toEqual([]);
    expect(feed("POINT_UP", 700, 1, a)).toEqual([]);
  });
  it("reports hold progress and never admits PTT after reset", () => {
    const { engine, hold } = stream();
    hold("PEACE", 500, 800);
    expect(engine.recognition.progress).toBe(0.5);
    engine.reset();
    expect(engine.confirmPttStart()).toBe(false);
  });
});
describe("personal poses and storage", () => {
  it("rejects ambiguous custom matches without falling through to a built-in action", () => {
    const cfg = defaults();
    cfg.mode = "custom";
    const features = poseFeatures(hand())!;
    cfg.customPoses = [
      { id: "custom_one", name: "One", features },
      { id: "custom_two", name: "Two", features },
    ];
    cfg.bindings.custom = { PEACE: "voice.stop", custom_one: "voice.listen" };
    const { hold } = stream(cfg);
    expect(hold("PEACE", 500, 1400, 1, hand(), { handCount: 1 })).toEqual([]);
  });
  it("normalizes translation, scale, rotation and mirroring", () => {
    const a = hand(),
      b = a.map(([x, y, z]) => [0.8 - y * 0.7, 0.1 + x * 0.7, -z * 0.7] as Point);
    expect(featureDistance(poseFeatures(a)!, poseFeatures(b)!)).toBeLessThan(0.000001);
  });
  it("requires eight steady, finite samples", () => {
    const h = hand();
    expect(calibratePose("My pose", Array(8).fill(h), "custom_test").features).toHaveLength(35);
    expect(() => calibratePose("My pose", Array(7).fill(h), "custom_test")).toThrow();
    expect(() => calibratePose("My pose", Array(8).fill([]), "custom_test")).toThrow();
  });
  it("stores compact bookmark identities and clamps invalid pages", () => {
    const text = "Private paragraph ".repeat(1000),
      id = documentId(text);
    expect(id.length).toBeLessThan(50);
    expect(id).not.toContain("Private");
    expect(documentId(text + "x")).not.toBe(id);
    expect(clampIndex(999, 2)).toBe(1);
    expect(clampIndex(NaN, 2)).toBe(0);
    expect(clampIndex(-4, 0)).toBe(0);
    expect(
      loadBookmarks({
        getItem: () =>
          JSON.stringify([{ documentId: id, page: 1, excerpt: "Note", at: T, document: text }]),
      })[0],
    ).not.toHaveProperty("document");
  });
  it("ignores malformed bookmarks", () => {
    expect(loadBookmarks({ getItem: () => "{broken" })).toEqual([]);
    expect(loadBookmarks({ getItem: () => "[null,1,{}]" })).toEqual([]);
  });
  it("only rearranges known HUD cards and preserves both columns", () => {
    const order = {
      left: ["system", "power", "agenda"],
      right: ["weather", "network", "terminal"],
    };
    expect(reorderCards(order, "system", "weather")).toEqual({
      left: ["power", "agenda"],
      right: ["system", "weather", "network", "terminal"],
    });
    expect(reorderCards(order, "approve", "weather")).toBe(order);
  });
});
