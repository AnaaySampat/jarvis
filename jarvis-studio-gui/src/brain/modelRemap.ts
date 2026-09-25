/**
 * Retired-model remapping.
 *
 * Google retires Gemini model ids on a schedule. Every id this app pins is a
 * time bomb: `gemini-2.0-flash` and `gemini-2.0-flash-lite` both went 404 on
 * 2026-09-22, which benched the whole Gemini tier for a day, pushed 100% of
 * traffic onto Groq, and blew Groq's tokens-per-minute ceiling within a minute —
 * so the user's first symptom was "rate limits ran out" on a phone task, several
 * layers away from the actual cause. The same shape took the app down in
 * 2026-07-04 with a dead Vertex default.
 *
 * Re-pinning a fresh constant just resets the timer. Instead: Google's own 404
 * names the replacement, so record it and apply it from then on. The remap is
 * persisted, so the fix survives a restart and costs one failed request total
 * rather than one per launch.
 *
 * This is a self-healing layer, NOT a substitute for keeping the constants
 * current — it only engages after one request has already failed.
 */

import { makeKV, readJson, writeJson } from "./memory/store";

const KEY = "jarvis.android.model_remap.v1";
const kv = makeKV();

/** Guard against a pathological chain (a → b → c → …) and unbounded growth. */
const MAX_ENTRIES = 24;

type RemapTable = Record<string, string>;

function load(): RemapTable {
  const raw = readJson<RemapTable>(kv, KEY, {});
  return raw && typeof raw === "object" ? raw : {};
}

/**
 * The id to actually call for `model`, following the recorded chain.
 * Cycle-safe: stops if it revisits an id or runs past the table size.
 */
export function liveModelId(model: string): string {
  const table = load();
  let id = model;
  const seen = new Set<string>([id]);
  for (let i = 0; i < MAX_ENTRIES; i += 1) {
    const next = table[id];
    if (!next || seen.has(next)) break;
    seen.add(next);
    id = next;
  }
  return id;
}

/** Remember that `from` is retired in favour of `to`. No-op for a self-map. */
export function recordRemap(from: string, to: string): void {
  const a = (from || "").trim();
  const b = (to || "").trim();
  if (!a || !b || a === b) return;
  const table = load();
  if (table[a] === b) return;
  table[a] = b;
  // Oldest-first trim; insertion order is preserved for string keys here.
  const keys = Object.keys(table);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) delete table[k];
  writeJson(kv, KEY, table);
}

/** Everything currently remapped — for Settings/diagnostics. */
export function remapEntries(): Array<[string, string]> {
  return Object.entries(load());
}

/** Drop the table (e.g. after the user edits keys or model settings). */
export function clearRemaps(): void {
  try {
    kv.remove(KEY);
  } catch {
    /* storage unavailable — nothing persisted to clear */
  }
}
