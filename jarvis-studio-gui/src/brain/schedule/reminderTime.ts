/**
 * Parse a natural-language "when" string into a concrete future time. Port of
 * `reference/python-backend-spec/reminders.py`'s `_parse_when`/`_relative_seconds` —
 * same three-tier strategy: an explicit "in N ..." relative time first (so a stray
 * clock token elsewhere can't hijack it), then an absolute clock time (12h or 24h),
 * then a bare relative duration anywhere in the string.
 */

const REL_RE =
  /(\d+)\s*(hour|hours|hr|hrs|h|minute|minutes|min|mins|m|second|seconds|sec|secs|s)\b/g;

function relativeSeconds(s: string): number {
  let total = 0;
  for (const m of s.matchAll(REL_RE)) {
    const n = Number(m[1]);
    const unit = m[2];
    if (/^(hour|hr|h)/.test(unit)) total += n * 3600;
    else if (/^(min|m)/.test(unit)) total += n * 60;
    else total += n;
  }
  return total;
}

/**
 * A parsed "when", including WHICH kind it was.
 *
 * The kind matters because the two map to different Clock primitives. An absolute
 * time is an alarm. A relative one is a countdown, and forcing it through an alarm
 * loses the seconds: at 21:30:10, "in 30 seconds" resolves to 21:30:40, whose
 * HH:MM is 21:30 — a minute that has already begun, so the Clock schedules it for
 * TOMORROW. Timers have no such problem, and are what the user meant anyway.
 */
export interface ParsedWhen {
  /** Epoch ms of the target moment. */
  atMillis: number;
  /** True for "in N minutes" style input, false for "at 3pm". */
  relative: boolean;
  /** Seconds from `now` to the target — the timer length, for relative input. */
  seconds: number;
}

export function parseReminderDetail(when: string, now: Date = new Date()): ParsedWhen | null {
  const s = (when || "").trim().toLowerCase();
  if (!s) return null;

  const rel = (total: number): ParsedWhen => ({
    atMillis: now.getTime() + total * 1000,
    relative: true,
    seconds: total,
  });

  if (/\bin\s+\d/.test(s)) {
    const total = relativeSeconds(s);
    if (total > 0) return rel(total);
  }

  let h: number | null = null;
  let mi = 0;
  let m = s.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (m) {
    h = Number(m[1]);
    mi = Number(m[2] || 0);
    const ap = m[3];
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
  } else {
    m = s.match(/\b(?:at\s+)?(\d{1,2}):(\d{2})\b/);
    if (m) {
      h = Number(m[1]);
      mi = Number(m[2]);
    } else {
      m = s.match(/\bat\s+(\d{1,2})\b/);
      if (m) {
        h = Number(m[1]);
        mi = 0;
      }
    }
  }
  if (h !== null && h >= 0 && h <= 23 && mi >= 0 && mi <= 59) {
    const target = new Date(now);
    target.setHours(h, mi, 0, 0);
    if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
    return {
      atMillis: target.getTime(),
      relative: false,
      seconds: Math.round((target.getTime() - now.getTime()) / 1000),
    };
  }

  const total = relativeSeconds(s);
  if (total > 0) return rel(total);
  return null;
}

/** Epoch-ms target only — the original signature, kept for callers that don't care
 *  which kind of "when" it was. */
export function parseReminderWhen(when: string, now: Date = new Date()): number | null {
  return parseReminderDetail(when, now)?.atMillis ?? null;
}
