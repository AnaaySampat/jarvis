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
  const feed = (pose: string, offset: number, score = 1, landmarks: Point[] = []) =>
    engine.feed(
      { seq: ++seq, observedAt: T + offset, pose, score, landmarks },
      { visible: true, blocked: false, now: T + offset },
    );
  feed("UNKNOWN", 0);
  feed("UNKNOWN", 400);
  return { engine, feed };
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
    const { feed } = stream();
    expect(feed("OPEN_PALM", 500)).toEqual([]);
    expect(feed("OPEN_PALM", 1100)).toEqual([
      { kind: "action", action: "voice.stop", pose: "OPEN_PALM" },
    ]);
    expect(feed("OPEN_PALM", 1200)).toEqual([]);
    feed("UNKNOWN", 1300);
    feed("UNKNOWN", 1700);
    feed("OPEN_PALM", 1800);
    expect(feed("OPEN_PALM", 2400)).toHaveLength(1);
  });
  it("finishes only admitted PTT when a camera stops producing frames", () => {
    const { engine, feed } = stream();
    feed("PEACE", 500);
    expect(feed("PEACE", 1100)[0]).toMatchObject({ action: "voice.ptt" });
    expect(engine.confirmPttStart()).toBe(true);
    expect(engine.tick(T + 1801)).toContainEqual({
      kind: "action",
      action: "voice.finish",
      pose: "UNKNOWN",
    });
    expect(engine.tick(T + 3000)).toEqual([]);
  });
  it("does not finish a PTT request that the host rejected", () => {
    const { engine, feed } = stream();
    feed("PEACE", 500);
    feed("PEACE", 1100);
    expect(engine.tick(T + 1801)).toEqual([]);
    feed("UNKNOWN", 1900);
    feed("UNKNOWN", 2400);
    expect(engine.confirmPttStart()).toBe(false);
  });
  it("cancels owned capture on blocked or hidden state without submitting it", () => {
    const { engine, feed } = stream();
    feed("PEACE", 500);
    feed("PEACE", 1100);
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
    engine.feed(f(1), { visible: true, blocked: false, now: T + 100 });
    expect(engine.feed(f(7), { visible: true, blocked: false, now: T + 700 })).toContainEqual({
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
    old.feed("OPEN_PALM", 1100);
    const fresh = stream();
    fresh.feed("OPEN_PALM", 500);
    expect(fresh.feed("OPEN_PALM", 1100)[0]).toMatchObject({ action: "voice.stop" });
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
    expect(feed("UNKNOWN", 500, 1, points)).toContainEqual({
      kind: "pointer",
      phase: "down",
      x: 0.6,
      y: 0.5,
    });
    expect(
      feed("UNKNOWN", 600, 1, points).some((e) => e.kind === "pointer" && e.phase === "down"),
    ).toBe(false);
    expect(engine.tick(T + 1400)).toContainEqual({ kind: "pointer", phase: "up", x: -1, y: -1 });
  });
  it("turns a pointing swipe into one page action with a cooldown", () => {
    const cfg = defaults();
    cfg.mode = "reading";
    cfg.mirror = false;
    const { feed } = stream(cfg),
      start = hand(),
      end = hand();
    start[8] = [0.2, 0.5, 0];
    end[8] = [0.5, 0.5, 0];
    expect(feed("POINT_UP", 500, 1, start)).toEqual([]);
    expect(feed("POINT_UP", 700, 1, end)).toContainEqual({
      kind: "action",
      action: "reader.next",
      pose: "SWIPE_RIGHT",
    });
    expect(feed("POINT_UP", 800, 1, start)).toEqual([]);
  });
});
describe("personal poses and storage", () => {
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
