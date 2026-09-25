/**
 * On-device agenda / schedule — port of `actions/skills.py` schedule helpers.
 * Persisted in localStorage so the Agenda panel and `manage_schedule` tool work
 * without the Python backend.
 */

import { makeKV, readJson, writeJson } from "../memory/store";

export interface ScheduleItem {
  time: string;
  task: string;
  duration?: string | null;
  /** Calendar date this item is FOR, as YYYY-MM-DD.
   *
   *  Buckets are keyed by weekday name only ("friday"), with nothing to say WHICH
   *  Friday, and no code path ever retired a bucket — so "dentist at 10:00 on
   *  friday" reappeared every Friday forever. Stamping the concrete date lets
   *  readRaw drop an item once its day has passed. Absent on rows written before
   *  this existed; those are left alone rather than guessed at. */
  date?: string;
  /** Id of the mirrored event in the system calendar, when one was created. Kept
   *  so a later remove deletes the real event instead of orphaning it. */
  calendarEventId?: number;
}

export interface HudScheduleItem extends ScheduleItem {
  done?: boolean;
  now?: boolean;
}

const KEY = "jarvis.android.schedule.v1";
const kv = makeKV();

/** Local calendar date as YYYY-MM-DD (NOT toISOString, which is UTC and would roll
 *  over at the wrong moment for anyone not on UTC). */
function localISODate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function readRaw(): Record<string, ScheduleItem[]> {
  const data = readJson<Record<string, ScheduleItem[]>>(kv, KEY, {});
  // Drop items whose date has passed. Pruning HERE covers every reader at once —
  // getTodaySchedule, the get/list count, and findItem — instead of each having to
  // remember. In-memory only: the next ordinary write persists it, and doing it
  // without a write avoids re-entering writeRaw from a read.
  const today = localISODate();
  for (const day of Object.keys(data)) {
    const kept = (data[day] ?? []).filter((it) => !it.date || it.date >= today);
    if (kept.length !== (data[day] ?? []).length) data[day] = kept;
  }
  return data;
}

// ── Change notification ──────────────────────────────────────────────────────
// The agenda is written from two unrelated places: the HUD's own action buttons
// (useBrain's runAction) and, far more often, a tool call inside a conversation
// turn (loop.ts → dispatch). Only the first had a refresh hook, so asking JARVIS
// to "add X to my agenda" wrote to storage, answered "added", and left the panel
// showing stale React state until the next remount — it looked like a lie.
//
// Notifying from the STORE fixes every caller at once, including any added later,
// which a refresh call sprinkled at each call site would not.
type Listener = () => void;
const listeners = new Set<Listener>();

/** Subscribe to agenda changes. Returns an unsubscribe function. */
export function onScheduleChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function writeRaw(data: Record<string, ScheduleItem[]>): void {
  writeJson(kv, KEY, data);
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* a broken subscriber must not roll back a write that already happened */
    }
  }
}

const DAY_NAMES = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

function isoWeekday(date: Date): string {
  return DAY_NAMES[date.getDay() === 0 ? 6 : date.getDay() - 1];
}

function normaliseDay(day?: string): string {
  // Blank counts as "today", not as a day named "".
  //
  // This is the "JARVIS said it added it but the agenda is empty" bug. `manage_schedule`
  // lowers to a spec with `day: a.day ?? ""`, so a model that omits the optional `day`
  // (the common case — "add gym to my agenda") arrives here with an EMPTY STRING, which
  // `?? "today"` does not catch. The item was then filed under the key "" while
  // getTodaySchedule() reads the key "sunday" — written, never shown, and reported as a
  // success because the write genuinely succeeded. It also zeroed agendaStartMillis(),
  // so the calendar mirror silently no-opped too.
  //
  // Guarding here rather than at the call site fixes add/edit/remove/clear/get at once,
  // since every action routes through this one function.
  const raw = (day ?? "").trim().toLowerCase();
  const d = raw || "today";
  if (d === "today") {
    return isoWeekday(new Date());
  }
  if (d === "tomorrow") {
    const n = new Date();
    n.setDate(n.getDate() + 1);
    return isoWeekday(n);
  }
  return d;
}

function findItem(items: ScheduleItem[], payload: Record<string, unknown>): number | null {
  const match = String(payload.match ?? payload.task ?? "")
    .trim()
    .toLowerCase();
  if (!match) return null;
  const idx = items.findIndex((it) => it.task.toLowerCase().includes(match));
  return idx >= 0 ? idx : null;
}

/**
 * Epoch ms for an agenda item's "day" + "HH:MM", or 0 when there's no usable time.
 *
 * A calendar event needs a concrete moment; the agenda only stores a weekday name
 * and a clock time. Resolves to the NEXT occurrence of that weekday (today when it
 * matches and the time hasn't passed), which is what "put gym on Friday" means.
 */
export function agendaStartMillis(day: string, time: string, now: Date = new Date()): number {
  const hhmm = /^(\d{1,2}):(\d{2})$/.exec((time || "").trim());
  if (!hhmm) return 0;
  const h = Number(hhmm[1]);
  const mi = Number(hhmm[2]);
  if (h > 23 || mi > 59) return 0;

  const target = new Date(now);
  target.setHours(h, mi, 0, 0);

  const wanted = DAY_NAMES.indexOf(normaliseDay(day) as (typeof DAY_NAMES)[number]);
  if (wanted < 0) return 0;
  const todayIdx = DAY_NAMES.indexOf(isoWeekday(now) as (typeof DAY_NAMES)[number]);
  let delta = (wanted - todayIdx + 7) % 7;
  // Same weekday but the time has already gone → a week out, not in the past.
  if (delta === 0 && target.getTime() <= now.getTime()) delta = 7;
  target.setDate(target.getDate() + delta);
  return target.getTime();
}

/**
 * Zero-pad a clock time to HH:MM so it can be SORTED and COMPARED as a string.
 *
 * Every ordering in this file is `localeCompare` / `<` on the raw stored string, and
 * the model writes whatever it likes — "9:00" is lexicographically GREATER than
 * "13:00", so a 9am item sorted below every afternoon entry and, because
 * `"9:00" < "14:00"` is false, never got marked done: the HUD showed it as the
 * current activity all afternoon. Also accepts "9am" / "7:30 PM" for the same reason.
 * Returns the input untouched when it isn't a clock time at all (a free-text "after
 * lunch" stays as the user wrote it).
 */
export function normaliseTime(raw: string): string {
  const s = (raw || "").trim();
  if (!s) return "";
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(s);
  if (!m) return s;
  let h = Number(m[1]);
  const mi = Number(m[2] ?? 0);
  const ampm = m[3]?.toLowerCase();
  if (ampm === "pm" && h < 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;
  if (h > 23 || mi > 59) return s;
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
}

/** Structured view for the HUD Agenda panel (today only). */
export function getTodaySchedule(): HudScheduleItem[] {
  const day = normaliseDay("today");
  const items = [...(readRaw()[day] ?? [])];
  const out: HudScheduleItem[] = items.map((it) => ({
    // Normalise on READ too, so rows written before this existed still sort right.
    time: normaliseTime(it.time ?? ""),
    task: (it.task ?? "").trim(),
    duration: it.duration ?? null,
  }));
  out.sort((a, b) => (a.time || "~").localeCompare(b.time || "~"));
  const nowHhmm = new Date().toTimeString().slice(0, 5);
  let markedNow = false;
  for (const entry of out) {
    const t = entry.time;
    if (t && t < nowHhmm) entry.done = true;
    else if (!markedNow && t) {
      entry.now = true;
      markedNow = true;
    }
  }
  return out;
}

export interface ScheduleResult {
  ok: boolean;
  summary: string;
  /** The item just added or removed. Lets the caller mirror the change into the
   *  system calendar — which is async, so it can't happen in here. */
  item?: ScheduleItem;
}

/** Run a schedule action from the HUD or the `manage_schedule` tool. */
export function runSchedule(payload: Record<string, unknown>): ScheduleResult {
  const action = String(payload.do ?? payload.action ?? "get").toLowerCase();
  const day = normaliseDay(String(payload.day ?? "today"));
  const data = readRaw();

  if (action === "get" || action === "list") {
    const n = (data[day] ?? []).length;
    return {
      ok: true,
      summary: n ? `You have ${n} item(s) on ${day}.` : `Nothing on ${day}'s schedule.`,
    };
  }

  if (action === "add" || action === "set" || action === "create") {
    const task = String(payload.task ?? "").trim();
    const when = normaliseTime(String(payload.time ?? ""));
    if (!task) return { ok: false, summary: "What should I add to your schedule?" };
    const eventId = Number(payload.calendarEventId ?? 0);
    // Stamp WHICH day this is for, so it retires instead of recurring weekly.
    // agendaStartMillis already resolves "the next <weekday>" for us; fall back to
    // today when there's no usable clock time to resolve against.
    const startMs = agendaStartMillis(String(payload.day ?? "today"), when);
    const item: ScheduleItem = {
      time: when,
      task,
      date: localISODate(startMs ? new Date(startMs) : new Date()),
    };
    if (Number.isFinite(eventId) && eventId > 0) item.calendarEventId = eventId;
    const list = data[day] ?? [];
    list.push(item);
    list.sort((a, b) => (a.time || "").localeCompare(b.time || ""));
    data[day] = list;
    writeRaw(data);
    return {
      ok: true,
      summary: `Added '${task}'${when ? ` at ${when}` : ""} to your ${day} schedule.`,
      item,
    };
  }

  if (action === "edit" || action === "update" || action === "change" || action === "reschedule") {
    const items = data[day] ?? [];
    const idx = findItem(items, payload);
    if (idx == null)
      return { ok: false, summary: "I couldn't find that item on your schedule to edit." };
    const old = { ...items[idx] };
    const newTask = String(payload.new_task ?? payload.task ?? "").trim();
    const newTime = normaliseTime(String(payload.new_time ?? payload.time ?? ""));
    if (newTask) items[idx].task = newTask;
    if (newTime) items[idx].time = newTime;
    if (!newTask && !newTime)
      return { ok: false, summary: "Tell me the new time or task for that item." };
    items.sort((a, b) => (a.time || "").localeCompare(b.time || ""));
    data[day] = items;
    writeRaw(data);
    return {
      ok: true,
      summary: `Updated '${old.task}'${newTime ? ` to ${newTime}` : ""}.`,
    };
  }

  if (action === "remove" || action === "delete") {
    const items = data[day] ?? [];
    const idx = findItem(items, payload);
    if (idx == null) return { ok: false, summary: "I couldn't find that item to remove." };
    const removed = items.splice(idx, 1)[0]!;
    data[day] = items;
    writeRaw(data);
    return { ok: true, summary: `Removed '${removed.task}' from ${day}.`, item: removed };
  }

  if (action === "clear") {
    data[day] = [];
    writeRaw(data);
    return { ok: true, summary: `Cleared ${day}'s schedule.` };
  }

  return { ok: false, summary: `Unknown schedule action '${action}'.` };
}
