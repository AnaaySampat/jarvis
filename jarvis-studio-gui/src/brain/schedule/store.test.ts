import { describe, expect, it, vi } from "vitest";
import {
  agendaStartMillis,
  getTodaySchedule,
  normaliseTime,
  onScheduleChange,
  runSchedule,
} from "./store";

describe("change notification", () => {
  // The HUD Agenda panel holds React state. A spoken "add X to my agenda" writes
  // through the brain's tool dispatch, which the panel's own action handler never
  // sees — so without a store-level notification the write lands but the panel
  // keeps showing stale items, and JARVIS looks like it lied about adding it.
  it("notifies subscribers on every write", () => {
    const seen = vi.fn();
    const off = onScheduleChange(seen);
    runSchedule({ do: "add", day: "tuesday", task: "standup", time: "09:00" });
    expect(seen).toHaveBeenCalledTimes(1);
    runSchedule({ do: "remove", day: "tuesday", match: "standup" });
    expect(seen).toHaveBeenCalledTimes(2);
    off();
    runSchedule({ do: "add", day: "tuesday", task: "later", time: "10:00" });
    expect(seen).toHaveBeenCalledTimes(2);
    runSchedule({ do: "clear", day: "tuesday" });
  });

  it("does not notify for a read", () => {
    const seen = vi.fn();
    const off = onScheduleChange(seen);
    runSchedule({ do: "get", day: "tuesday" });
    expect(seen).not.toHaveBeenCalled();
    off();
  });

  it("survives a subscriber that throws", () => {
    const off = onScheduleChange(() => {
      throw new Error("panel blew up");
    });
    expect(() => runSchedule({ do: "add", day: "friday", task: "x", time: "08:00" })).not.toThrow();
    off();
    runSchedule({ do: "clear", day: "friday" });
  });
});

describe("runSchedule", () => {
  it("reports an empty day as nothing scheduled", () => {
    const r = runSchedule({ do: "get", day: "wednesday" });
    expect(r.ok).toBe(true);
    expect(r.summary).toMatch(/nothing/i);
  });

  it("adds an item and then finds it via get", () => {
    const day = "thursday";
    const add = runSchedule({ do: "add", day, task: "team standup", time: "09:00" });
    expect(add.ok).toBe(true);
    const get = runSchedule({ do: "get", day });
    expect(get.summary).toMatch(/1 item/i);
  });

  // The reported bug: "JARVIS said it added it, but the agenda is empty."
  // toSpec() lowers manage_schedule to `day: a.day ?? ""`, so a model that omits the
  // optional day — the common phrasing, "add gym to my agenda" — arrived with an
  // EMPTY STRING. `?? "today"` doesn't catch that, so the item was filed under the
  // key "" while the panel reads today's weekday. Every pre-existing test passed an
  // explicit day, which is why this survived.
  it("files a day-less add under today, where the panel actually looks", () => {
    const task = `blank-day-${Math.random().toString(36).slice(2)}`;
    const add = runSchedule({ do: "add", day: "", task, time: "08:15" });
    expect(add.ok).toBe(true);
    expect(getTodaySchedule().map((i) => i.task)).toContain(task);
    // and it must not report a nameless day back to the user
    expect(add.summary).not.toMatch(/your {2,}schedule|to your schedule\.$/);
  });

  it("resolves a blank day to a real moment so the calendar mirror still fires", () => {
    expect(agendaStartMillis("", "23:59")).toBeGreaterThan(0);
  });

  it("refuses to add an empty task", () => {
    const r = runSchedule({ do: "add", day: "friday", task: "" });
    expect(r.ok).toBe(false);
  });

  it("edits an existing item by matching its task text", () => {
    runSchedule({ do: "add", day: "saturday", task: "dentist appointment", time: "10:00" });
    const edit = runSchedule({
      do: "edit",
      day: "saturday",
      match: "dentist",
      new_time: "11:00",
    });
    expect(edit.ok).toBe(true);
    expect(edit.summary).toMatch(/11:00/);
  });

  it("fails to edit an item that doesn't exist", () => {
    const r = runSchedule({ do: "edit", day: "saturday", match: "nonexistent", new_time: "12:00" });
    expect(r.ok).toBe(false);
  });

  it("removes an item by match", () => {
    runSchedule({ do: "add", day: "sunday", task: "gym", time: "07:00" });
    const remove = runSchedule({ do: "remove", day: "sunday", match: "gym" });
    expect(remove.ok).toBe(true);
    const get = runSchedule({ do: "get", day: "sunday" });
    expect(get.summary).toMatch(/nothing/i);
  });

  it("clears a whole day's schedule", () => {
    runSchedule({ do: "add", day: "monday", task: "task a" });
    runSchedule({ do: "add", day: "monday", task: "task b" });
    const cleared = runSchedule({ do: "clear", day: "monday" });
    expect(cleared.ok).toBe(true);
    const get = runSchedule({ do: "get", day: "monday" });
    expect(get.summary).toMatch(/nothing/i);
  });

  it("reports an unknown action honestly instead of pretending success", () => {
    const r = runSchedule({ do: "teleport", day: "monday" });
    expect(r.ok).toBe(false);
    expect(r.summary).toMatch(/unknown/i);
  });
});

describe("clock-time normalisation", () => {
  // Every ordering in the store is a STRING compare, and "9:00" > "13:00"
  // lexicographically: a 9am item sorted below every afternoon entry and, because
  // `"9:00" < "14:00"` is false, was never marked done — the HUD showed a morning
  // item as the current activity all afternoon.
  it("zero-pads so times sort chronologically as strings", () => {
    expect(normaliseTime("9:00")).toBe("09:00");
    expect(normaliseTime("09:00") < normaliseTime("13:00")).toBe(true);
    expect("9:00" < "13:00").toBe(false); // the bug, for contrast
  });

  it("understands bare hours and am/pm, which a model does emit", () => {
    expect(normaliseTime("9am")).toBe("09:00");
    expect(normaliseTime("7:30 PM")).toBe("19:30");
    expect(normaliseTime("12am")).toBe("00:00");
    expect(normaliseTime("12pm")).toBe("12:00");
  });

  it("leaves free text and out-of-range values alone", () => {
    expect(normaliseTime("after lunch")).toBe("after lunch");
    expect(normaliseTime("25:00")).toBe("25:00");
    expect(normaliseTime("")).toBe("");
  });

  it("stores an unpadded time padded, so the agenda sorts right", () => {
    runSchedule({ do: "clear", day: "wednesday" });
    runSchedule({ do: "add", day: "wednesday", task: "late", time: "13:00" });
    runSchedule({ do: "add", day: "wednesday", task: "early", time: "9:00" });
    const summary = runSchedule({ do: "get", day: "wednesday" }).summary;
    expect(summary).toContain("2");
    runSchedule({ do: "clear", day: "wednesday" });
  });
});

describe("agenda entries do not recur weekly", () => {
  // Buckets are keyed by weekday NAME with nothing to say which week, and no path
  // ever retired one — so an item reappeared every week forever.
  it("stamps the concrete date it is for", () => {
    runSchedule({ do: "clear", day: "today" });
    const r = runSchedule({ do: "add", day: "today", task: "dentist", time: "10:00" });
    expect(r.item?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    runSchedule({ do: "clear", day: "today" });
  });

  it("drops an item once its date has passed", () => {
    // No localStorage in this env (makeKV falls back to an in-memory map), so move
    // the CLOCK instead of poking storage: add an item for today, then jump a week
    // and read that same weekday bucket back. Before the date stamp it was still
    // sitting there; now readRaw prunes it.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-03-02T09:00:00"));   // a Monday
      runSchedule({ do: "clear", day: "monday" });
      runSchedule({ do: "add", day: "today", task: "stale", time: "10:00" });
      expect(runSchedule({ do: "get", day: "monday" }).summary).toContain("1");

      vi.setSystemTime(new Date("2026-03-09T09:00:00")); // the NEXT Monday
      expect(runSchedule({ do: "get", day: "monday" }).summary).toContain("Nothing");
      expect(getTodaySchedule().some((i) => i.task === "stale")).toBe(false);
      runSchedule({ do: "clear", day: "monday" });
    } finally {
      vi.useRealTimers();
    }
  });
});

