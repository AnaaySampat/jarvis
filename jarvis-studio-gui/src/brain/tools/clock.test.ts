/**
 * Clock routing: everything time-based must reach the phone's real Clock app.
 *
 * The rule these pin down is "no internal timers" — JARVIS must not keep time in
 * its own process, because such a timer is invisible to the user, uneditable, and
 * dies on reboot. So the checks assert the platform CLOCK calls happen, and that a
 * reminder still lands on the agenda alongside its alarm.
 */

import { describe, expect, it, vi } from "vitest";
import { dispatch, type DispatchDeps } from "./dispatch";
import { toSpec } from "./registry";
import { runSchedule } from "../schedule/store";
import type { Platform } from "../platform";
import type { BrainConfig } from "../config";

function makeDeps(over: Partial<BrainConfig> = {}) {
  const clock = {
    setAlarm: vi.fn(async () => ({ ok: true, summary: "Alarm set for 07:30 in your clock app." })),
    setTimer: vi.fn(async () => ({ ok: true, summary: "Timer started for 5 minutes." })),
    showAlarms: vi.fn(async () => ({ ok: true, summary: "Opened your alarms." })),
    showTimers: vi.fn(async () => ({ ok: true, summary: "Opened your timers." })),
    dismissTimer: vi.fn(async () => ({ ok: true, summary: "Timer dismissed." })),
  };
  const calendar = {
    // eventId is optional on the real interface — the permission-less fallback
    // opens a picker and has no id to give back, which this mock must be able
    // to express or the "calendar refused" case can't be tested.
    add: vi.fn(
      async (): Promise<{ ok: boolean; summary: string; eventId?: number }> => ({
        ok: true,
        summary: "Added to your calendar.",
        eventId: 42,
      }),
    ),
    remove: vi.fn(async () => ({ ok: true, summary: "Removed from your calendar." })),
    show: vi.fn(async () => ({ ok: true, summary: "Opened your calendar." })),
  };
  const platform = { clock, calendar } as unknown as Platform;
  const config: BrainConfig = { tier: "groq", model: "m", keys: { groq: ["k"] }, ...over };
  return { clock, calendar, deps: { platform, config } as unknown as DispatchDeps };
}

describe("tool lowering", () => {
  it("lowers set_timer to a clock spec", () => {
    expect(toSpec("set_timer", { seconds: 300, label: "pasta" })).toEqual({
      type: "clock",
      do: "timer",
      seconds: 300,
      label: "pasta",
    });
  });

  it("lowers set_alarm to a clock spec, repeat days included", () => {
    expect(toSpec("set_alarm", { hour: 7, minute: 30, label: "gym", days: "weekdays" })).toEqual({
      type: "clock",
      do: "alarm",
      hour: 7,
      minute: 30,
      label: "gym",
      days: "weekdays",
    });
  });
});

describe("clock dispatch", () => {
  it("starts a timer in the Clock app", async () => {
    const { clock, deps } = makeDeps();
    const r = await dispatch({ type: "clock", do: "timer", seconds: 300, label: "pasta" }, deps);
    expect(clock.setTimer).toHaveBeenCalledWith(300, "pasta");
    expect(r.ok).toBe(true);
  });

  it("sets an alarm in the Clock app", async () => {
    const { clock, deps } = makeDeps();
    await dispatch({ type: "clock", do: "alarm", hour: 7, minute: 30, label: "gym", days: "" }, deps);
    expect(clock.setAlarm).toHaveBeenCalledWith(7, 30, "gym", "");
  });

  it("asks instead of guessing when the length or time is missing", async () => {
    const { clock, deps } = makeDeps();
    const noLength = await dispatch({ type: "clock", do: "timer", seconds: 0 }, deps);
    expect(noLength.ok).toBe(false);
    const noTime = await dispatch({ type: "clock", do: "alarm", hour: -1 }, deps);
    expect(noTime.ok).toBe(false);
    expect(clock.setTimer).not.toHaveBeenCalled();
    expect(clock.setAlarm).not.toHaveBeenCalled();
  });

  it("rejects an hour outside 0-23 rather than passing it to the Clock", async () => {
    const { clock, deps } = makeDeps();
    const r = await dispatch({ type: "clock", do: "alarm", hour: 25, minute: 0 }, deps);
    expect(r.ok).toBe(false);
    expect(clock.setAlarm).not.toHaveBeenCalled();
  });

  it("opens the alarm and timer lists", async () => {
    const { clock, deps } = makeDeps();
    await dispatch({ type: "clock", do: "show_alarms" }, deps);
    await dispatch({ type: "clock", do: "show_timers" }, deps);
    await dispatch({ type: "clock", do: "dismiss_timer" }, deps);
    expect(clock.showAlarms).toHaveBeenCalled();
    expect(clock.showTimers).toHaveBeenCalled();
    expect(clock.dismissTimer).toHaveBeenCalled();
  });
});

describe("reminders", () => {
  it("sets a real Clock alarm and puts it on the agenda", async () => {
    const { clock, deps } = makeDeps();
    runSchedule({ do: "clear", day: "today" });
    const r = await dispatch({ type: "reminder", when: "at 3pm", text: "call mum" }, deps);
    expect(r.ok).toBe(true);
    // 15:00 — the resolved wall-clock time, not the raw phrase.
    expect(clock.setAlarm).toHaveBeenCalledWith(15, 0, "call mum");
    expect(runSchedule({ do: "get", day: "today" }).summary).toMatch(/1 item/);
  });

  it("uses a TIMER for a countdown, never an alarm", async () => {
    // An alarm keeps only HH:MM. "in 30 seconds" lands inside the current minute,
    // which the Clock treats as already past and schedules for TOMORROW.
    const { clock, deps } = makeDeps();
    const r = await dispatch({ type: "reminder", when: "in 30 seconds", text: "stir" }, deps);
    expect(clock.setTimer).toHaveBeenCalledWith(30, "stir");
    expect(clock.setAlarm).not.toHaveBeenCalled();
    expect(r.ok).toBe(true);
  });

  it("uses a timer for minute-scale countdowns too", async () => {
    const { clock, deps } = makeDeps();
    await dispatch({ type: "reminder", when: "in 10 minutes", text: "pasta" }, deps);
    expect(clock.setTimer).toHaveBeenCalledWith(600, "pasta");
    expect(clock.setAlarm).not.toHaveBeenCalled();
  });

  it("is honest when it cannot work out when", async () => {
    const { clock, deps } = makeDeps();
    const r = await dispatch({ type: "reminder", when: "sometime later", text: "x" }, deps);
    expect(clock.setAlarm).not.toHaveBeenCalled();
    expect(r.summary).toMatch(/nothing will go off/i);
  });

  it("still reports the agenda entry when the Clock refuses", async () => {
    const { clock, deps } = makeDeps();
    clock.setAlarm.mockResolvedValueOnce({ ok: false, summary: "No clock app." });
    const r = await dispatch({ type: "reminder", when: "at 9am", text: "standup" }, deps);
    // The agenda write really happened, so don't claim total failure — but do
    // surface that the alarm part didn't.
    expect(r.summary).toMatch(/No clock app/);
  });
});

describe("calendar mirroring", () => {
  it("writes an agenda add into the real calendar and keeps the event id", async () => {
    const { calendar, deps } = makeDeps();
    runSchedule({ do: "clear", day: "monday" });
    const r = await dispatch(
      { type: "schedule", do: "add", day: "monday", time: "18:00", task: "gym" },
      deps,
    );
    expect(calendar.add).toHaveBeenCalledWith("gym", expect.any(Number));
    expect(r.ok).toBe(true);
    expect(r.summary).toMatch(/calendar/i);
    // The id must be stored, or a later remove orphans the real event.
    const removed = runSchedule({ do: "remove", day: "monday", match: "gym" });
    expect(removed.item?.calendarEventId).toBe(42);
  });

  it("keeps the agenda entry when the calendar refuses, and says so", async () => {
    // The local store is the source of truth — a declined permission must not
    // lose the item, and must not be reported as a success either.
    const { calendar, deps } = makeDeps();
    calendar.add.mockResolvedValueOnce({ ok: false, summary: "No calendar permission." });
    runSchedule({ do: "clear", day: "tuesday" });
    const r = await dispatch(
      { type: "schedule", do: "add", day: "tuesday", time: "09:00", task: "standup" },
      deps,
    );
    expect(r.ok).toBe(true);
    expect(r.summary).toMatch(/No calendar permission/);
    expect(runSchedule({ do: "get", day: "tuesday" }).summary).toMatch(/1 item/);
  });

  it("deletes the real event when the agenda item is removed", async () => {
    const { calendar, deps } = makeDeps();
    runSchedule({ do: "clear", day: "wednesday" });
    await dispatch(
      { type: "schedule", do: "add", day: "wednesday", time: "12:00", task: "lunch" },
      deps,
    );
    await dispatch({ type: "schedule", do: "remove", day: "wednesday", match: "lunch" }, deps);
    expect(calendar.remove).toHaveBeenCalledWith(42);
  });

  it("does nothing to the calendar when the user turned mirroring off", async () => {
    const { calendar, deps } = makeDeps({ calendarSync: false });
    runSchedule({ do: "clear", day: "thursday" });
    const r = await dispatch(
      { type: "schedule", do: "add", day: "thursday", time: "08:00", task: "run" },
      deps,
    );
    expect(calendar.add).not.toHaveBeenCalled();
    expect(r.ok).toBe(true);
  });

  it("skips the calendar for an item with no usable time", async () => {
    const { calendar, deps } = makeDeps();
    const r = await dispatch(
      { type: "schedule", do: "add", day: "friday", task: "someday" },
      deps,
    );
    expect(calendar.add).not.toHaveBeenCalled();
    expect(r.ok).toBe(true);
  });
});
