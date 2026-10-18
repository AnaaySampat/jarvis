/**
 * Named routines — one store for both "run my bedtime routine" (a voice macro) and
 * "brief me every morning at 8" (the same thing with a time attached).
 *
 * A routine is only saved text. Running it hands that text to an ordinary brain turn,
 * so every step still goes through tools/dispatch and reports its own real result —
 * there is deliberately no second execution path here (ARCHITECTURE §3).
 *
 * Timed routines fire from the WebView (useBrain) while JARVIS is open, or when it's
 * opened within CATCH_UP_MIN of the due time. While it's closed the WebView is paused, so
 * every save also hands the timed ones to a native alarm (RoutineAlarms.kt) that posts
 * "Time for <name>" at the time. Tapping it opens JARVIS, and useBrain runs the routine
 * the same way as any other: nothing runs, and nothing counts as run, until then.
 */

import { makeKV, readJson, writeJson } from "../memory/store";
import { type RoutineAlarm, type RoutineSchedule, scheduleRoutineAlarms } from "../platform";
import { localISODate, normaliseTime } from "./store";

export interface Routine {
  name: string;
  /** The steps, in plain English — becomes the user turn when the routine runs. */
  prompt: string;
  /** HH:MM, or absent for a routine that only runs when asked. */
  time?: string;
  /** "daily" | "weekdays" | "weekends" | "mon,wed,fri". */
  days: string;
  /** Local date (YYYY-MM-DD) it last ran, so it fires once a day. */
  lastRun?: string;
}

export interface RoutineResult {
  ok: boolean;
  summary: string;
  routine?: Routine;
}

const KEY = "jarvis.android.routines.v1";
const kv = makeKV();

/** How long after its due time a routine still counts as "due" — so opening JARVIS at
 *  8:40 catches an 8:00 briefing, but opening it at 22:00 doesn't brief you on the
 *  morning. */
export const CATCH_UP_MIN = 120;

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Seeded once so a new user has something to say on day one; after that they're
 *  ordinary routines — edit or remove them like any other. Steps name a device only
 *  "if" it's set up: tv_control / pc_task aren't advertised without one, and the
 *  model reports the skip instead of pretending. */
export const STARTER_ROUTINES: readonly Routine[] = [
  {
    name: "movie night",
    prompt:
      "If the TV is set up, open Netflix on the TV. If a PC is paired, set the PC's volume to 0. " +
      "Turn on Do Not Disturb on this phone. Say which steps you skipped because a device isn't set up.",
    days: "daily",
  },
  {
    name: "bedtime",
    prompt:
      "If the TV is set up, turn the TV off. If a PC is paired, lock the PC. " +
      "Turn on Do Not Disturb on this phone. Say which steps you skipped because a device isn't set up.",
    days: "daily",
  },
];
const STARTERS_KEY = "jarvis.android.routines.starters.v1";

function load(): Routine[] {
  const raw = readJson<unknown>(kv, KEY, []);
  const list = (Array.isArray(raw) ? raw : []).filter(
    (r): r is Routine => !!r && typeof r.name === "string" && typeof r.prompt === "string",
  );
  if (!readJson(kv, STARTERS_KEY, false)) {
    writeJson(kv, STARTERS_KEY, true);
    const have = new Set(list.map((r) => r.name.toLowerCase()));
    list.push(...STARTER_ROUTINES.filter((r) => !have.has(r.name)).map((r) => ({ ...r })));
    save(list);
  }
  return list;
}

function save(list: Routine[]): void {
  writeJson(kv, KEY, list);
  schedule(list);
}

/** The native scheduler's reply to the latest save. */
let scheduled: Promise<RoutineSchedule | null> = Promise.resolve(null);

/** save() is the one place the list changes, so it's the one place that reschedules. */
function schedule(list: Routine[]): void {
  scheduled = scheduleRoutineAlarms(routineAlarms(list));
}

/** On launch: the native alarms may predate this store (an upgrade, a reinstall). */
export function syncRoutineAlarms(): void {
  schedule(load());
}

/** getDay() indexes a spec covers, or null when the spec isn't understood. The form
 *  reads a saved spec back into its day picker with it. */
export function parseDays(spec: string): Set<number> | null {
  const s = spec.trim().toLowerCase();
  if (!s || s === "daily" || s === "everyday" || s === "every day")
    return new Set([0, 1, 2, 3, 4, 5, 6]);
  if (s === "weekdays") return new Set([1, 2, 3, 4, 5]);
  if (s === "weekends") return new Set([0, 6]);
  const out = new Set<number>();
  for (const part of s.split(/[\s,]+/).filter(Boolean)) {
    const i = DAYS.findIndex((d) => part.length >= 3 && d.startsWith(part));
    if (i < 0) return null;
    out.add(i);
  }
  return out.size ? out : null;
}

/** The timed routines in the shape RoutineAlarms.kt takes. */
export function routineAlarms(list: Routine[]): RoutineAlarm[] {
  return list.flatMap((r) => {
    const days = r.time ? parseDays(r.days) : null;
    if (!r.time || !days) return [];
    return [
      {
        name: r.name,
        hour: Number(r.time.slice(0, 2)),
        minute: Number(r.time.slice(3)),
        days: [...days].sort((a, b) => a - b),
        lastRun: r.lastRun ?? "",
      },
    ];
  });
}

/** What a just-saved timed routine will really do, from the native scheduler's reply to
 *  that save, so it never promises a notification the phone can't post. */
export async function timedRoutineNote(r: Routine): Promise<string> {
  const s = await scheduled;
  if (s?.ok && s.notifications) {
    return `At ${r.time} I'll post a notification${s.exact ? "" : " (Android may hold it a few minutes)"}; tap it and I'll run the routine.`;
  }
  const why = s?.ok ? "notifications are off for JARVIS" : "I can't schedule it on this device";
  return `It runs while JARVIS is open, or when you open me within ${CATCH_UP_MIN / 60} hours after — ${why}.`;
}

/** The routine a tapped notification is for, unless it's gone or already ran on or after
 *  the notification's day (a WebView reload reads the same tap again). */
export function tappedRoutine(name: string, date: string): Routine | undefined {
  const r = load().find((x) => x.name === name);
  return r && !(r.lastRun && r.lastRun >= date) ? r : undefined;
}

/** When a routine runs, in words for the screen: "When you ask", "Every day at 08:00",
 *  "Mon, Wed, Fri at 18:30". Reads days with the same parser that schedules them. */
export function routineWhen(r: Pick<Routine, "time" | "days">): string {
  if (!r.time) return "When you ask";
  const s = (r.days || "daily").trim().toLowerCase();
  const set = parseDays(s);
  let days: string;
  if (!set || set.size === 7) days = "Every day";
  else if (s === "weekdays") days = "Weekdays";
  else if (s === "weekends") days = "Weekends";
  else {
    days = [1, 2, 3, 4, 5, 6, 0]
      .filter((i) => set.has(i))
      .map((i) => DAYS[i].charAt(0).toUpperCase() + DAYS[i].slice(1, 3))
      .join(", ");
  }
  return `${days} at ${r.time}`;
}

/** Exact name wins; otherwise a substring is only accepted when it names one routine. */
function resolve(list: Routine[], query: string): { hit?: Routine; error?: string } {
  const q = query.trim().toLowerCase();
  if (!q) return { error: "Which routine, sir?" };
  const exact = list.filter((r) => r.name.toLowerCase() === q);
  const hits = exact.length ? exact : list.filter((r) => r.name.toLowerCase().includes(q));
  if (!hits.length) return { error: `I don't have a routine matching “${query}”.` };
  if (hits.length > 1) {
    return {
      error: `“${query}” matches ${hits.length} routines (${hits.map((r) => `“${r.name}”`).join(", ")}). Tell me the exact name.`,
    };
  }
  return { hit: hits[0] };
}

export function listRoutines(): Routine[] {
  return load();
}

export function addRoutine(input: {
  name: string;
  prompt: string;
  time?: string;
  days?: string;
}): RoutineResult {
  const name = input.name.trim().slice(0, 60);
  const prompt = input.prompt.trim().slice(0, 600);
  if (!name) return { ok: false, summary: "What should I call this routine?" };
  if (!prompt) return { ok: false, summary: "What should the routine do?" };

  const days = (input.days ?? "").trim().toLowerCase() || "daily";
  if (!parseDays(days)) {
    return {
      ok: false,
      summary: `I didn't understand “${days}” — use daily, weekdays, weekends, or e.g. mon,wed,fri.`,
    };
  }
  let time: string | undefined;
  if (input.time?.trim()) {
    time = normaliseTime(input.time);
    if (!/^\d{2}:\d{2}$/.test(time)) {
      return { ok: false, summary: `I couldn't read “${input.time}” as a time of day.` };
    }
  }

  const routine: Routine = { name, prompt, days, ...(time ? { time } : {}) };
  const list = load().filter((r) => r.name.toLowerCase() !== name.toLowerCase());
  save([...list, routine]);
  return {
    ok: true,
    routine,
    summary: time
      ? `Saved “${name}” for ${time} (${days}). Say “run ${name}” to run it any time.`
      : `Saved “${name}”. Say “run ${name}” to run it.`,
  };
}

/** The on-screen form's save. Unlike a spoken "make a routine…" it won't overwrite a
 *  different routine that already has the typed name. An edit (`was` = its old name)
 *  keeps the routine's place in the list and today's run — so changing the steps of a
 *  routine that already ran doesn't run it again, and one re-timed later today waits
 *  for tomorrow — and the old name only goes once the new one has passed addRoutine's
 *  checks. */
export function saveRoutine(input: Parameters<typeof addRoutine>[0], was?: string): RoutineResult {
  const key = (s: string) => s.trim().slice(0, 60).toLowerCase();
  const list = load();
  const at = was === undefined ? -1 : list.findIndex((r) => key(r.name) === key(was));
  if (list.some((r, i) => i !== at && key(r.name) === key(input.name))) {
    return {
      ok: false,
      summary: `You already have a routine called “${input.name.trim()}”. Edit that one, or pick another name.`,
    };
  }
  const res = addRoutine(input);
  if (!res.ok || at < 0) return res;
  const routine = { ...res.routine!, ...(list[at].lastRun ? { lastRun: list[at].lastRun } : {}) };
  list[at] = routine; // `list` is the pre-add list, so this also drops the old name
  save(list);
  return { ...res, routine };
}

export function removeRoutine(query: string): RoutineResult {
  const list = load();
  const { hit, error } = resolve(list, query);
  if (!hit) return { ok: false, summary: error! };
  save(list.filter((r) => r !== hit));
  return { ok: true, summary: `Removed the routine “${hit.name}”.` };
}

export function describeRoutines(): RoutineResult {
  const list = load();
  if (!list.length) return { ok: true, summary: "You haven't saved any routines yet." };
  const lines = list.map((r) => (r.time ? `${r.name} (${r.time}, ${r.days})` : r.name));
  return { ok: true, summary: `Your routines: ${lines.join("; ")}.` };
}

/** Lets "movie night" on its own run the routine — without the names in the prompt the
 *  model can't tell a routine from an ordinary request. Names are the user's own text. */
export function routinesPromptHint(): string {
  const names = load().map((r) => `“${r.name}”`);
  if (!names.length) return "";
  return (
    `SAVED ROUTINES\nThe user's routines: ${names.join(", ")}. When the user says a routine's ` +
    "name on its own or asks to run one, call manage_routine with action 'run' and that name."
  );
}

/** The turn a run hands the brain. */
export function routineTurn(r: Routine): string {
  return `Run my routine “${r.name}”. Do these now with your tools, in order, and tell me what actually happened: ${r.prompt}`;
}

/** Look a routine up for a voice run, and count it as today's run. */
export function claimRoutine(query: string, now: Date = new Date()): RoutineResult {
  const list = load();
  const { hit, error } = resolve(list, query);
  if (!hit) return { ok: false, summary: error! };
  hit.lastRun = localISODate(now);
  save(list);
  return { ok: true, routine: hit, summary: routineTurn(hit) };
}

/** Timed routines whose moment has come and that haven't run today. */
export function dueRoutines(now: Date = new Date()): Routine[] {
  const today = localISODate(now);
  const mins = now.getHours() * 60 + now.getMinutes();
  return load().filter((r) => {
    if (!r.time || r.lastRun === today || !parseDays(r.days)?.has(now.getDay())) return false;
    const due = Number(r.time.slice(0, 2)) * 60 + Number(r.time.slice(3));
    return mins >= due && mins < due + CATCH_UP_MIN;
  });
}

export function markRoutineRan(name: string, now: Date = new Date()): void {
  const list = load();
  const r = list.find((x) => x.name === name);
  if (!r) return;
  r.lastRun = localISODate(now);
  save(list);
}
