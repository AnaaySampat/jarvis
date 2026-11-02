/**
 * One memory across the phone and the PC: remembered facts and routines, merged over
 * the paired PC link. Mirrors the desktop's memory_sync.py, which documents the rules:
 * facts keyed by their normalised text, routines by name, the newest change wins, a
 * deletion is a dated tombstone, and a timed routine keeps the device that fires it
 * (`origin`). The phone starts each exchange — `memory.sync` with what changed here
 * since it last sent and the PC's cursor — and the PC answers `memory.synced` with its
 * own changes and a new cursor. Playbooks stay per device (different shapes).
 */

import { factKey, factTombstones, markFactGone, type MemoryStore } from "./store";
import { applyRoutineChanges, routineChanges, type SyncedRoutine } from "../schedule/routines";

export interface SyncedFact {
  key: string;
  ts: number;
  text?: string;
  deleted?: boolean;
}

export interface MemoryChanges {
  facts: SyncedFact[];
  routines: SyncedRoutine[];
}

const MAX = 1000;

interface SyncRequest {
  connection: object;
  host: string;
  id: string;
  startedAt: number;
}

/** One acknowledged cursor per exchange. A late reply must not acknowledge
 * facts collected by a later request (or by a replacement connection). */
export class MemorySyncExchange {
  private pending: SyncRequest | null = null;
  private sequence = 0;

  begin(connection: object, host: string, now = Date.now()): SyncRequest | null {
    if (this.pending?.connection === connection && this.pending.host === host &&
      now - this.pending.startedAt < 30_000) return null;
    this.pending = { connection, host, id: `memory-${now}-${++this.sequence}`, startedAt: now };
    return this.pending;
  }

  discard(request: SyncRequest): void {
    if (this.pending === request) this.pending = null;
  }

  reset(): void {
    this.pending = null;
  }

  acknowledge(connection: object, host: string, reply: { request_id?: unknown; now?: unknown }):
    { sent: number; pc: number } | null {
    const pending = this.pending;
    if (!pending || pending.connection !== connection || pending.host !== host ||
      typeof reply.now !== "number" || !Number.isSafeInteger(reply.now) || reply.now <= 0 ||
      (reply.request_id !== undefined && reply.request_id !== pending.id)) return null;
    this.pending = null;
    // Older hosts don't echo ids. Resend local facts on their next exchange so
    // an uncorrelated late reply cannot skip unsent changes; merges are idempotent.
    return { sent: reply.request_id === pending.id ? pending.startedAt : 0, pc: reply.now };
  }
}

/** Facts and routines added, changed or forgotten here since `since` (ms, inclusive). */
export async function localChanges(memory: MemoryStore, since: number): Promise<MemoryChanges> {
  const facts: SyncedFact[] = (await memory.listFacts())
    .map((f) => ({ key: factKey(f.text), text: f.text, ts: f.ts ?? 1 }))
    .filter((f) => f.ts >= since);
  for (const [key, ts] of Object.entries(factTombstones())) {
    if (ts >= since) facts.push({ key, ts, deleted: true });
  }
  return { facts: facts.slice(0, MAX), routines: routineChanges(since).slice(0, MAX) };
}

/** Merge the PC's changes in. True when anything on the phone changed (so the
 *  Memory view and routine list should refresh). */
export async function applyRemote(
  remote: Partial<MemoryChanges>,
  memory: MemoryStore,
  saJson?: string,
): Promise<boolean> {
  let changed = false;
  const listed = await memory.listFacts();
  const gone = factTombstones();
  for (const e of (Array.isArray(remote.facts) ? remote.facts : []).slice(0, MAX)) {
    if (!e || typeof e.key !== "string" || !(Number(e.ts) > 0)) continue;
    const key = factKey(e.key);
    const local = listed.filter((f) => factKey(f.text) === key);
    if (e.deleted) {
      for (const f of local.filter((x) => (x.ts ?? 1) <= e.ts)) {
        if ((await memory.deleteFact(f.text)).ok) changed = true;
      }
      markFactGone([key], e.ts);
      continue;
    }
    const text = String(e.text ?? "").trim();
    if (!text || local.length || (gone[key] ?? 0) >= e.ts) continue;
    if ((await memory.remember(text.slice(0, 300), saJson)).ok) changed = true;
  }
  if (Array.isArray(remote.routines) && applyRoutineChanges(remote.routines)) changed = true;
  return changed;
}
