import { describe, expect, it } from "vitest";
import { parseReminderWhen } from "./reminderTime";

describe("parseReminderWhen", () => {
  const now = new Date(2026, 0, 1, 10, 0, 0); // Thursday 10:00am, Jan 1 2026

  it("parses 'in N minutes'", () => {
    const t = parseReminderWhen("in 10 minutes", now);
    expect(t).toBe(now.getTime() + 10 * 60 * 1000);
  });

  it("parses 'in 1 hour 30 minutes'", () => {
    const t = parseReminderWhen("in 1 hour 30 minutes", now);
    expect(t).toBe(now.getTime() + (3600 + 30 * 60) * 1000);
  });

  it("parses a 12-hour clock time later today", () => {
    const t = parseReminderWhen("at 3pm", now);
    const expected = new Date(now);
    expected.setHours(15, 0, 0, 0);
    expect(t).toBe(expected.getTime());
  });

  it("rolls a 12-hour clock time that has already passed to tomorrow", () => {
    const t = parseReminderWhen("at 9am", now);
    const expected = new Date(now);
    expected.setDate(expected.getDate() + 1);
    expected.setHours(9, 0, 0, 0);
    expect(t).toBe(expected.getTime());
  });

  it("parses a 24-hour clock time with minutes", () => {
    const t = parseReminderWhen("15:30", now);
    const expected = new Date(now);
    expected.setHours(15, 30, 0, 0);
    expect(t).toBe(expected.getTime());
  });

  it("parses an hour-only 'at N' as the top of that hour", () => {
    const t = parseReminderWhen("at 8", now);
    const expected = new Date(now);
    expected.setDate(expected.getDate() + 1); // 8am already passed today
    expected.setHours(8, 0, 0, 0);
    expect(t).toBe(expected.getTime());
  });

  it("prefers an explicit 'in N' over a stray clock-like token elsewhere", () => {
    const t = parseReminderWhen("remind me in 5 minutes about the 6pm meeting", now);
    expect(t).toBe(now.getTime() + 5 * 60 * 1000);
  });

  it("falls back to a bare relative duration anywhere in the string", () => {
    const t = parseReminderWhen("5 min", now);
    expect(t).toBe(now.getTime() + 5 * 60 * 1000);
  });

  it("returns null for an empty or unparseable string", () => {
    expect(parseReminderWhen("", now)).toBeNull();
    expect(parseReminderWhen("whenever", now)).toBeNull();
  });
});
