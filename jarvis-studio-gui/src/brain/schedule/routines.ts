/**
 * Named routines — one store for both "run my bedtime routine" (a voice macro) and
 * "brief me every morning at 8" (the same thing with a time attached).
 *
 * A routine is only saved text. Running it hands that text to an ordinary brain turn,
 * so every step still goes through tools/dispatch and reports its own real result —
 * there is deliberately no second execution path here (ARCHITECTURE §3).
 *
 * Timed routines fire from the WebView (useBrain), so they only fire while JARVIS is
 * open, or when it's opened within CATCH_UP_MIN of the due time. Nothing native wakes
 * the phone for them.
 */

import { makeKV, readJson, writeJson } from "../memory/store";
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

function load(): Routine[] {
  const raw = readJson<unknown>(kv, KEY, []);
  return (Array.isArray(raw) ? raw : []).filter(
    (r): r is Routine => !!r && typeof r.name === "string" && typeof r.prompt === "string",
  );
}

function save(list: Routine[]): void {
  writeJson(kv, KEY, list);
}

/** getDay() indexes a spec covers, or null when the spec isn't understood. */
function parseDays(spec: string): Set<number> | null {
  const s = spec.trim().toLowerCase();
  if (!s || s === "daily" || s === "everyday" || s === "every day") return new Set([0, 1, 2, 3, 4, 5, 6]);
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
    return { ok: false, summary: `I didn't understand “${days}” — use daily, weekdays, weekends, or e.g. mon,wed,fri.` };
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
      ? `Saved “${name}” for ${time} (${days}). It runs while JARVIS is open, or when you open me within ${CATCH_UP_MIN / 60} hours after — I can't wake the phone for it yet. Say “run ${name}” to run it any time.`
      : `Saved “${name}”. Say “run ${name}” to run it.`,
  };
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
