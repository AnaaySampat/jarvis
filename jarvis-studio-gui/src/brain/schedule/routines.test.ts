import { beforeEach, describe, expect, it } from "vitest";
import {
  addRoutine,
  claimRoutine,
  describeRoutines,
  dueRoutines,
  listRoutines,
  markRoutineRan,
  removeRoutine,
} from "./routines";

// 2026-09-30 is a Wednesday.
const at = (h: number, m: number) => new Date(2026, 8, 30, h, m);

beforeEach(() => {
  for (const r of listRoutines()) removeRoutine(r.name);
});

describe("addRoutine", () => {
  it("normalises the time and defaults days to daily", () => {
    const r = addRoutine({ name: "Morning", prompt: "weather and news", time: "8am" });
    expect(r.ok).toBe(true);
    expect(listRoutines()[0]).toMatchObject({ name: "Morning", time: "08:00", days: "daily" });
  });
  it("rejects bad input instead of saving it", () => {
    expect(addRoutine({ name: "", prompt: "x" }).ok).toBe(false);
    expect(addRoutine({ name: "a", prompt: "" }).ok).toBe(false);
    expect(addRoutine({ name: "a", prompt: "x", time: "after lunch" }).ok).toBe(false);
    expect(addRoutine({ name: "a", prompt: "x", days: "someday" }).ok).toBe(false);
    expect(listRoutines()).toHaveLength(0);
  });
  it("replaces a routine of the same name and is honest that nothing wakes the phone", () => {
    addRoutine({ name: "Gym", prompt: "one" });
    const r = addRoutine({ name: "gym", prompt: "two", time: "07:00" });
    expect(listRoutines()).toHaveLength(1);
    expect(r.summary).toMatch(/can't wake the phone/);
  });
});

describe("remove / claim", () => {
  it("refuses an ambiguous substring rather than guessing", () => {
    addRoutine({ name: "morning brief", prompt: "a" });
    addRoutine({ name: "morning gym", prompt: "b" });
    expect(removeRoutine("morning").ok).toBe(false);
    expect(listRoutines()).toHaveLength(2);
    expect(removeRoutine("morning gym").ok).toBe(true);
  });
  it("claim returns the steps and counts as today's run", () => {
    addRoutine({ name: "bedtime", prompt: "dnd on", time: "22:00" });
    const c = claimRoutine("bed", at(21, 0));
    expect(c.ok).toBe(true);
    expect(c.summary).toContain("dnd on");
    expect(dueRoutines(at(22, 5))).toHaveLength(0); // claimed today → not due again
  });
  it("describes an empty list", () => {
    expect(describeRoutines().summary).toMatch(/haven't saved/);
  });
});

describe("dueRoutines", () => {
  beforeEach(() => {
    addRoutine({ name: "brief", prompt: "x", time: "08:00", days: "weekdays" });
  });
  it("is due from its time until the catch-up window closes", () => {
    expect(dueRoutines(at(7, 59))).toHaveLength(0);
    expect(dueRoutines(at(8, 0))).toHaveLength(1);
    expect(dueRoutines(at(9, 59))).toHaveLength(1);
    expect(dueRoutines(at(10, 0))).toHaveLength(0);
  });
  it("fires once a day and only on its days", () => {
    markRoutineRan("brief", at(8, 1));
    expect(dueRoutines(at(8, 30))).toHaveLength(0);
    expect(dueRoutines(new Date(2026, 9, 3, 8, 30))).toHaveLength(0); // Saturday
  });
  it("never fires an untimed routine", () => {
    addRoutine({ name: "macro", prompt: "y" });
    expect(dueRoutines(at(8, 30)).map((r) => r.name)).toEqual(["brief"]);
  });
});
