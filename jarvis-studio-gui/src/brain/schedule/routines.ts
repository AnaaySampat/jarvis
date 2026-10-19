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
import {
  type RoutineAlarm,
  type RoutineSchedule,
  scheduleRoutineAlarms,
  syncArrivals,
} from "../platform";
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
  /** "home": runs when the phone gets home (ArrivalWatcher.kt) instead of at a time. */
  trigger?: "home";
  /** When it was last saved (ms) — the newest edit wins a sync (memory/sync.ts). */
  updatedAt?: number;
  /** The device whose clock fires it when timed: a routine synced from the PC is
   *  listed and runs by name here, but its time is the PC's. Absent = this phone. */
  origin?: "phone" | "pc";
}

export interface RoutineResult {
  ok: boolean;
  summary: string;
  routine?: Routine;
}

const KEY = "jarvis.android.routines.v1";
/** routine key → when it was removed (ms): tombstones for memory/sync.ts. */
const GONE_KEY = "jarvis.android.routines.gone.v1";
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
  void syncArrivals(homeRoutines(list));
}

/** The "when I get home" routines this phone watches for (not the PC's). */
export function homeRoutines(list: Routine[]): string[] {
  return list.filter((r) => r.trigger === "home" && r.origin !== "pc").map((r) => r.name);
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
    if (r.origin === "pc") return []; // the PC's clock fires it
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
export function routineWhen(r: Pick<Routine, "time" | "days" | "origin" | "trigger">): string {
  if (r.trigger === "home") return "When you get home";
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
  return `${days} at ${r.time}${r.origin === "pc" ? " (on your PC)" : ""}`;
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
  /** "home" (or a time like "when I get home") = run on getting home. */
  trigger?: string;
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
  const home = input.trigger === "home" || /\b(home|arriv)/i.test(input.time ?? "");
  let time: string | undefined;
  if (input.time?.trim() && !home) {
    time = normaliseTime(input.time);
    if (!/^\d{2}:\d{2}$/.test(time)) {
      return { ok: false, summary: `I couldn't read “${input.time}” as a time of day.` };
    }
  }

  const before = load();
  const prev = before.find((r) => r.name.toLowerCase() === name.toLowerCase());
  const routine: Routine = {
    name,
    prompt,
    days,
    ...(time ? { time } : {}),
    ...(home ? { trigger: "home" as const } : {}),
    updatedAt: Date.now(),
    origin: home ? "phone" : (prev?.origin ?? "phone"), // only the phone knows it got home
  };
  const list = before.filter((r) => r !== prev);
  save([...list, routine]);
  markRoutineGone([routineKey(name)], 0);
  return {
    ok: true,
    routine,
    summary: home
      ? `Saved “${name}” for when you get home: when the phone joins your home Wi-Fi I'll post a notification, and tapping it runs it. I learn which Wi-Fi is home when your TV or PC answers on it. Say “run ${name}” to run it any time.`
      : time
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
  const routine: Routine = {
    ...res.routine!,
    ...(list[at].lastRun ? { lastRun: list[at].lastRun } : {}),
    origin: list[at].origin ?? "phone",
  };
  if (key(list[at].name) !== key(routine.name)) markRoutineGone([routineKey(list[at].name)]);
  list[at] = routine; // `list` is the pre-add list, so this also drops the old name
  save(list);
  return { ...res, routine };
}

export function removeRoutine(query: string): RoutineResult {
  const list = load();
  const { hit, error } = resolve(list, query);
  if (!hit) return { ok: false, summary: error! };
  save(list.filter((r) => r !== hit));
  markRoutineGone([routineKey(hit.name)]);
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
    if (r.origin === "pc") return false; // the PC's clock fires it
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

// ── One memory with the PC (memory/sync.ts) ─────────────────────────────────

/** A routine's identity across devices: its name, lower-cased. */
export function routineKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 60);
}

function routineTombstones(): Record<string, number> {
  return readJson<Record<string, number>>(kv, GONE_KEY, {});
}

function markRoutineGone(keys: string[], at: number = Date.now()): void {
  const gone = routineTombstones();
  for (const k of keys) {
    if (!k) continue;
    if (at) gone[k] = Math.max(gone[k] ?? 0, at);
    else delete gone[k];
  }
  const cutoff = Date.now() - 90 * 86_400_000;
  writeJson(kv, GONE_KEY, Object.fromEntries(Object.entries(gone).filter(([, t]) => t >= cutoff)));
}

/** One routine as both devices send it: days as "daily" or "mon,wed,fri". */
export interface SyncedRoutine {
  key: string;
  ts: number;
  deleted?: boolean;
  name?: string;
  prompt?: string;
  time?: string;
  days?: string;
  trigger?: "home";
  origin?: "phone" | "pc";
}

const WEEK = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function daysOut(days: string): string {
  const set = parseDays(days);
  if (!set || set.size === 7) return "daily";
  return [1, 2, 3, 4, 5, 6, 0]
    .filter((i) => set.has(i))
    .map((i) => WEEK[(i + 6) % 7])
    .join(",");
}

/** A routine's change time. One saved before syncing existed counts as very old, and
 *  a starter nobody edited isn't sent at all (the PC has its own). */
function changedAt(r: Routine): number {
  if (r.updatedAt) return r.updatedAt;
  const starter = STARTER_ROUTINES.find((s) => s.name === r.name);
  return starter && starter.prompt === r.prompt ? 0 : 1;
}

/** Routines added, changed or removed here since `since` (ms; inclusive — a repeat
 *  is harmless). */
export function routineChanges(since: number): SyncedRoutine[] {
  const out: SyncedRoutine[] = [];
  for (const r of load()) {
    const ts = changedAt(r);
    if (!ts || ts < since) continue;
    out.push({
      key: routineKey(r.name),
      ts,
      name: r.name,
      prompt: r.prompt,
      time: r.time ?? "",
      days: daysOut(r.days),
      ...(r.trigger ? { trigger: r.trigger } : {}),
      origin: r.origin ?? "phone",
    });
  }
  for (const [key, ts] of Object.entries(routineTombstones())) {
    if (ts >= since) out.push({ key, ts, deleted: true });
  }
  return out;
}

/** Merge the PC's routine changes in, newest wins. True when anything here changed. */
export function applyRoutineChanges(entries: SyncedRoutine[]): boolean {
  const list = load();
  const gone = routineTombstones();
  let changed = false;
  for (const e of entries.slice(0, 1000)) {
    if (!e || typeof e.key !== "string" || !(Number(e.ts) > 0)) continue;
    const key = routineKey(e.key);
    const at = list.findIndex((r) => routineKey(r.name) === key);
    const local = at >= 0 ? list[at]! : undefined;
    if (local && changedAt(local) >= e.ts) continue;
    if (e.deleted) {
      if (local) {
        list.splice(at, 1);
        changed = true;
      }
      gone[key] = Math.max(gone[key] ?? 0, e.ts);
      continue;
    }
    if (!local && (gone[key] ?? 0) >= e.ts) continue;
    const name = String(e.name ?? "")
      .trim()
      .slice(0, 60);
    const prompt = String(e.prompt ?? "")
      .trim()
      .slice(0, 2000);
    const time = /^\d{2}:\d{2}$/.test(e.time ?? "") ? e.time : undefined;
    if (!name || !prompt || !parseDays(e.days ?? "daily")) continue;
    const next: Routine = {
      name,
      prompt,
      days: e.days || "daily",
      ...(time ? { time } : {}),
      ...(e.trigger === "home" ? { trigger: "home" as const } : {}),
      updatedAt: e.ts,
      origin: e.origin === "pc" ? "pc" : "phone",
      ...(local?.lastRun ? { lastRun: local.lastRun } : {}),
    };
    if (local) list[at] = next;
    else list.push(next);
    delete gone[key];
    changed = true;
  }
  if (changed) save(list);
  writeJson(kv, GONE_KEY, gone);
  return changed;
}
