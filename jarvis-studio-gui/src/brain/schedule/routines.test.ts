import { beforeEach, describe, expect, it, vi } from "vitest";

// The native scheduler (RoutineAlarms.kt): null = off-device, as in the browser.
const schedule = vi.hoisted(() => vi.fn(async (_list: unknown[]): Promise<unknown> => null));
const arrivals = vi.hoisted(() => vi.fn(async (_names: string[]): Promise<unknown> => null));
vi.mock("../platform", () => ({ scheduleRoutineAlarms: schedule, syncArrivals: arrivals }));

import {
  addRoutine,
  claimRoutine,
  describeRoutines,
  dueRoutines,
  listRoutines,
  markRoutineRan,
  removeRoutine,
  homeRoutines,
  routineAlarms,
  routineWhen,
  routinesPromptHint,
  saveRoutine,
  tappedRoutine,
  timedRoutineNote,
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
  it("replaces a routine of the same name", () => {
    addRoutine({ name: "Gym", prompt: "one" });
    addRoutine({ name: "gym", prompt: "two", time: "07:00" });
    expect(listRoutines()).toHaveLength(1);
  });
});

describe("native routine alarms", () => {
  beforeEach(() => schedule.mockReset().mockResolvedValue(null));

  it("hands every save's timed routines to the native scheduler, days as getDay numbers", () => {
    addRoutine({ name: "macro", prompt: "x" });
    addRoutine({ name: "brief", prompt: "y", time: "07:30", days: "weekdays" });
    expect(schedule).toHaveBeenLastCalledWith([
      { name: "brief", hour: 7, minute: 30, days: [1, 2, 3, 4, 5], lastRun: "" },
    ]);
    claimRoutine("brief", at(9, 0));
    expect(schedule.mock.lastCall?.[0]).toEqual([
      expect.objectContaining({ lastRun: "2026-09-30" }),
    ]);
    removeRoutine("brief");
    expect(schedule).toHaveBeenLastCalledWith([]);
  });
  it("maps day lists and skips untimed routines", () => {
    expect(
      routineAlarms([
        { name: "a", prompt: "x", time: "18:05", days: "sun,sat" },
        { name: "b", prompt: "x", days: "daily" },
      ]),
    ).toEqual([{ name: "a", hour: 18, minute: 5, days: [0, 6], lastRun: "" }]);
  });
  it("only promises a notification the phone said it can post", async () => {
    const r = addRoutine({ name: "check", prompt: "say the time", time: "19:21" }).routine!;
    expect(await timedRoutineNote(r)).toMatch(/can't schedule it on this device/);

    schedule.mockResolvedValue({
      ok: true,
      summary: "",
      exact: true,
      notifications: true,
      nextAt: 1,
    });
    addRoutine({ name: "check", prompt: "say the time", time: "19:21" });
    expect(await timedRoutineNote(r)).toBe(
      "At 19:21 I'll post a notification; tap it and I'll run the routine.",
    );

    schedule.mockResolvedValue({
      ok: true,
      summary: "",
      exact: false,
      notifications: true,
      nextAt: 1,
    });
    addRoutine({ name: "check", prompt: "say the time", time: "19:21" });
    expect(await timedRoutineNote(r)).toMatch(/may hold it a few minutes/);

    schedule.mockResolvedValue({
      ok: true,
      summary: "",
      exact: true,
      notifications: false,
      nextAt: 1,
    });
    addRoutine({ name: "check", prompt: "say the time", time: "19:21" });
    expect(await timedRoutineNote(r)).toMatch(/notifications are off/);
  });
  it("a tapped notification runs its routine once, and never one that's gone", () => {
    addRoutine({ name: "check", prompt: "say the time", time: "19:21" });
    expect(tappedRoutine("check", "2026-09-30")?.name).toBe("check");
    markRoutineRan("check", at(19, 22));
    expect(tappedRoutine("check", "2026-09-30")).toBeUndefined(); // same tap read again
    expect(tappedRoutine("check", "2026-09-29")).toBeUndefined(); // yesterday's, after today's run
    expect(tappedRoutine("check", "2026-10-01")?.name).toBe("check");
    expect(tappedRoutine("gone", "2026-09-30")).toBeUndefined();
  });
});

describe("saveRoutine (the on-screen form)", () => {
  it("renames in place, keeps today's run, and never overwrites another routine", () => {
    addRoutine({ name: "first", prompt: "a" });
    addRoutine({ name: "gym", prompt: "b", time: "07:00" });
    addRoutine({ name: "last", prompt: "c" });
    markRoutineRan("gym", at(7, 0));

    expect(saveRoutine({ name: "Last", prompt: "x" }, "gym").ok).toBe(false); // taken
    expect(saveRoutine({ name: "workout", prompt: "" }, "gym").ok).toBe(false); // invalid
    expect(listRoutines().map((r) => r.name)).toEqual(["first", "gym", "last"]);

    const r = saveRoutine(
      { name: "workout", prompt: "b2", time: "07:30", days: "weekdays" },
      "gym",
    );
    expect(r.ok).toBe(true);
    expect(listRoutines().map((x) => x.name)).toEqual(["first", "workout", "last"]);
    expect(listRoutines()[1]).toMatchObject({ prompt: "b2", time: "07:30", lastRun: "2026-09-30" });
    expect(dueRoutines(at(7, 45))).toHaveLength(0); // already ran today under its old name
  });
  it("adds a new one, and changing only a name's case is still an edit", () => {
    expect(saveRoutine({ name: "first", prompt: "a" }).ok).toBe(true);
    expect(saveRoutine({ name: "First", prompt: "x" }).ok).toBe(false);
    expect(saveRoutine({ name: "First", prompt: "x" }, "first").ok).toBe(true);
    expect(listRoutines()).toMatchObject([{ name: "First", prompt: "x" }]);
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

describe("starter routines", () => {
  // A fresh module = a fresh in-memory store, i.e. a first launch.
  const firstLaunch = async () => {
    vi.resetModules();
    return import("./routines");
  };

  it("seeds movie night and bedtime once, and a removed starter stays removed", async () => {
    const m = await firstLaunch();
    expect(m.listRoutines().map((r) => r.name)).toEqual(["movie night", "bedtime"]);
    expect(m.removeRoutine("bedtime").ok).toBe(true);
    expect(m.listRoutines().map((r) => r.name)).toEqual(["movie night"]);
  });
  it("never overwrites the user's own routine of the same name", async () => {
    const m = await firstLaunch();
    expect(m.addRoutine({ name: "Movie Night", prompt: "mine" }).ok).toBe(true);
    const mine = m.listRoutines().filter((r) => r.name.toLowerCase() === "movie night");
    expect(mine).toHaveLength(1);
    expect(mine[0].prompt).toBe("mine");
  });
  it("claiming a starter doesn't mutate the built-in definition", async () => {
    const m = await firstLaunch();
    m.claimRoutine("movie night", at(20, 0));
    expect(m.STARTER_ROUTINES[0].lastRun).toBeUndefined();
  });
});

describe("routinesPromptHint", () => {
  it("names the saved routines so saying one alone runs it", () => {
    addRoutine({ name: "date night", prompt: "x" });
    expect(routinesPromptHint()).toContain("“date night”");
    expect(routinesPromptHint()).toContain("manage_routine");
  });
  it("is empty with no routines", () => {
    expect(routinesPromptHint()).toBe("");
  });
});

describe("routineWhen", () => {
  it("says when each kind of routine runs", () => {
    expect(routineWhen({ days: "daily" })).toBe("When you ask");
    expect(routineWhen({ time: "08:00", days: "daily" })).toBe("Every day at 08:00");
    expect(routineWhen({ time: "07:30", days: "weekdays" })).toBe("Weekdays at 07:30");
    expect(routineWhen({ time: "10:00", days: "weekends" })).toBe("Weekends at 10:00");
    expect(routineWhen({ time: "18:30", days: "fri,mon,wed" })).toBe("Mon, Wed, Fri at 18:30");
  });
});

describe("when I get home", () => {
  it("a 'home' routine has no time, says so, and is handed to the arrival watcher", () => {
    const res = addRoutine({ name: "Welcome", prompt: "turn on the TV", time: "when I get home" });
    expect(res.ok).toBe(true);
    expect(res.routine).toMatchObject({ trigger: "home", origin: "phone" });
    expect(res.routine!.time).toBeUndefined();
    expect(res.summary).toContain("when you get home");
    expect(routineWhen(res.routine!)).toBe("When you get home");
    expect(arrivals).toHaveBeenLastCalledWith(["Welcome"]);
    expect(routineAlarms(listRoutines())).toEqual([]); // never on the clock
    expect(dueRoutines(at(23, 0))).toEqual([]);
  });

  it("the PC's home routines aren't watched here", () => {
    expect(
      homeRoutines([
        { name: "a", prompt: "x", days: "daily", trigger: "home" },
        { name: "b", prompt: "x", days: "daily", trigger: "home", origin: "pc" },
        { name: "c", prompt: "x", days: "daily", time: "08:00" },
      ]),
    ).toEqual(["a"]);
  });
});
