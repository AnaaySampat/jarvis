import { makeKV, type KV } from "./memory/store";
import { safeToolRows, type ChatToolRow } from "../hooks/chatToolActivity";
const KEY = "jarvis.android.chatActivity.v1";
const live = new Set<string>();
const removed = new Set<string>();
interface TraceIndex {
  id: string;
  updated: number;
  size: number;
}
/** UI-only, bounded records. Live progress never reparses all archived steps. */
export class ChatActivityStore {
  private kv: KV;
  constructor(kv?: KV) {
    this.kv =
      kv ??
      (typeof localStorage === "undefined"
        ? makeKV()
        : {
            get: (k) => localStorage.getItem(k),
            set: (k, v) => localStorage.setItem(k, v),
            remove: (k) => localStorage.removeItem(k),
          });
  }
  private index(): TraceIndex[] {
    try {
      const rows: unknown = JSON.parse(this.kv.get(KEY) ?? "[]");
      return Array.isArray(rows)
        ? rows
            .filter(
              (r) =>
                r &&
                typeof r.id === "string" &&
                /^[a-zA-Z0-9_:.-]{1,200}$/.test(r.id) &&
                Number.isFinite(r.updated) &&
                Number.isSafeInteger(r.size) &&
                r.size >= 0,
            )
            .slice(-640)
            .map((r) => ({ id: r.id, updated: r.updated, size: r.size }))
        : [];
    } catch {
      return [];
    }
  }
  begin(id: string): void {
    live.add(id);
  }
  save(id: string, rows: ChatToolRow[], finished: boolean): boolean {
    if (!/^[a-zA-Z0-9_:.-]{1,200}$/.test(id)) return false;
    if (removed.has(id)) return true;
    if (finished) live.delete(id);
    const key = `${KEY}:${id}`;
    try {
      const value = JSON.stringify({ id, finished, rows: safeToolRows(rows) });
      if (value.length > 1500000) return false;
      const before = this.index();
      let kept = [
        ...before.filter((r) => r.id !== id),
        { id, updated: Date.now(), size: value.length },
      ].slice(-640);
      while (kept.length > 1 && kept.reduce((n, r) => n + r.size, 0) > 1500000)
        kept = kept.slice(1);
      const previous = this.kv.get(key);
      this.kv.set(key, value);
      try {
        this.kv.set(KEY, JSON.stringify(kept));
      } catch (error) {
        try {
          if (previous === null) this.kv.remove(key);
          else this.kv.set(key, previous);
        } catch {
          /* A read requires a committed index. */
        }
        throw error;
      }
      const ids = new Set(kept.map((r) => r.id));
      for (const old of before) if (!ids.has(old.id)) this.kv.remove(`${KEY}:${old.id}`);
      return true;
    } catch {
      return false;
    }
  }
  read(id: string): ChatToolRow[] | undefined {
    if (removed.has(id) || !this.index().some((r) => r.id === id)) return undefined;
    try {
      const trace = JSON.parse(this.kv.get(`${KEY}:${id}`) ?? "null");
      return trace?.id === id
        ? safeToolRows(trace.rows, trace.finished !== true && !live.has(id))
        : undefined;
    } catch {
      return undefined;
    }
  }
  release(id: string): void {
    live.delete(id);
  }
  isRemoved(id: string): boolean {
    return removed.has(id);
  }
  remove(ids: string[]): boolean {
    const drop = new Set(ids);
    for (const id of ids) {
      live.delete(id);
      removed.add(id);
    }
    try {
      this.kv.set(KEY, JSON.stringify(this.index().filter((r) => !drop.has(r.id))));
      for (const id of ids) this.kv.remove(`${KEY}:${id}`);
      return true;
    } catch {
      return false;
    }
  }
}
