/**
 * On-device memory + conversation history.
 *
 * Port of `reference/python-backend-spec/memory_store.py`. The LOGIC ports directly;
 * only the STORAGE backend changes: the Python version writes JSON files in an
 * app-data dir, the Android version persists to the WebView's `localStorage` (the
 * phone's app-private storage — survives relaunch). If storage is unavailable
 * (blocked, or a non-DOM dev context) it transparently falls back to in-memory, so
 * the brain still runs.
 *
 * Two things live here (as in the Python brain):
 *   1. durable FACTS about the user (remember/forget),
 *   2. CONVERSATION history (recent turns, archived "Recents").
 * (Playbooks live in ./playbooks.ts — a separate small store, not part of this class.)
 *
 * Context tuning carried from project memory: store ~40 turns, keep replies clipped
 * to ~2800 chars so a long answer can't blow up the persisted history.
 */

import type { ChatMessage, ToolResult } from "../types";

export interface MemoryStore {
  // ── Durable facts ──
  remember(text: string, saJson?: string): Promise<ToolResult>;
  forget(text: string): Promise<ToolResult>;
  facts(query?: string, saJson?: string): Promise<string[]>;
  /** Every fact with when it was learned (ms; absent for facts older than the
   *  timestamps) — for the Memory view. */
  listFacts(): Promise<Array<{ text: string; ts?: number }>>;
  /** Forget exactly this fact — never a substring twin (the Memory view's Forget). */
  deleteFact(text: string): Promise<ToolResult>;

  // ── Conversation history ──
  /** The recent turns to send to the model (clipped). */
  recentTurns(limit?: number): Promise<ChatMessage[]>;
  appendTurn(message: ChatMessage): Promise<void>;
  /** "New chat" archives; voice "clear" destroys (mirrors S39 behaviour). */
  archiveConversation(): Promise<void>;
  clearConversation(): Promise<ToolResult>;
  /** Saved threads for the chat Recents drawer. */
  listRecents(): Promise<ArchivedThread[]>;
  loadRecent(id: string): Promise<ChatMessage[] | null>;
  deleteRecent(id: string): Promise<void>;
  clearRecents(): Promise<void>;
  /** Restore a saved thread as the active conversation turns. */
  restoreRecent(id: string): Promise<boolean>;
}

const FACTS_KEY = "jarvis.android.facts.v1";
/** fact text → when it was learned. Separate from FACTS_KEY so the fact list keeps
 *  its plain string[] shape (recall, prompts and existing installs all read it). */
const FACT_TIMES_KEY = "jarvis.android.facts.at.v1";
const TURNS_KEY = "jarvis.android.turns.v1";
const RECENTS_KEY = "jarvis.android.recents.v1";

const MAX_TURNS = 40; // store ~40 turns (project context-tuning note)
const CLIP_CHARS = 2800; // clip a single turn's content before persisting
const MAX_RECENTS = 30; // cap the archived "Recents" list

/** Minimal string KV — localStorage when available, else an in-process Map. */
export interface KV {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export function makeKV(): KV {
  try {
    if (typeof localStorage !== "undefined") {
      const probe = "__jarvis_probe__";
      localStorage.setItem(probe, "1");
      localStorage.removeItem(probe);
      return {
        get: (k) => localStorage.getItem(k),
        set: (k, v) => localStorage.setItem(k, v),
        remove: (k) => localStorage.removeItem(k),
      };
    }
  } catch {
    /* storage blocked (private mode / no DOM) — fall through to memory */
  }
  const mem = new Map<string, string>();
  return {
    get: (k) => (mem.has(k) ? (mem.get(k) as string) : null),
    set: (k, v) => {
      mem.set(k, v);
    },
    remove: (k) => {
      mem.delete(k);
    },
  };
}

export function readJson<T>(kv: KV, key: string, fallback: T): T {
  try {
    const raw = kv.get(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Persist `value`. Returns FALSE when the write failed (quota exceeded, storage
 *  blocked, unserialisable value) so callers that report success to the user can
 *  tell the truth. Callers that genuinely don't care may ignore the result. */
export function writeJson(kv: KV, key: string, value: unknown): boolean {
  try {
    kv.set(key, JSON.stringify(value));
    return true;
  } catch {
    /* quota / serialization failure — the caller decides whether it matters */
    return false;
  }
}

/** Dynamically import vectorStore.ts and run `fn`, swallowing any failure. */
async function withVectorStore<T>(
  fn: (mod: typeof import("./vectorStore")) => Promise<T> | T,
  onError?: (e: unknown) => void,
): Promise<T | undefined> {
  try {
    const mod = await import("./vectorStore");
    return await fn(mod);
  } catch (e) {
    onError?.(e);
    return undefined;
  }
}

function clip(text: string): string {
  return text.length > CLIP_CHARS ? text.slice(0, CLIP_CHARS) + "…" : text;
}

// Filtered out of both sides before scoring so common words (the, a, is, what)
// don't drown out genuine keyword overlap.
const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "i",
  "me",
  "my",
  "you",
  "your",
  "he",
  "she",
  "it",
  "we",
  "they",
  "them",
  "and",
  "or",
  "but",
  "if",
  "of",
  "at",
  "by",
  "for",
  "with",
  "about",
  "to",
  "from",
  "in",
  "on",
  "up",
  "down",
  "out",
  "so",
  "than",
  "that",
  "this",
  "these",
  "those",
  "what",
  "when",
  "where",
  "who",
  "how",
  "do",
  "does",
  "did",
  "can",
  "could",
  "will",
  "would",
  "should",
  "just",
]);

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9']+/g) ?? []).filter(
    (w) => w.length > 1 && !STOPWORDS.has(w),
  );
}

/**
 * Embeddings-free fact ranker for tiers without Vertex (no semantic search
 * available). Scores each fact by how many distinct query keywords it shares and
 * returns the top K. Falls back to `facts` unranked when nothing overlaps at all —
 * better to hand over everything than to arbitrarily drop facts the ranker has no
 * real signal about.
 */
export function keywordRank(query: string, facts: string[], k = 3): string[] {
  const qWords = new Set(tokenize(query));
  if (qWords.size === 0) return facts;
  const scored = facts.map((f) => ({ f, score: tokenize(f).filter((w) => qWords.has(w)).length }));
  if (!scored.some((s) => s.score > 0)) return facts;
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((s) => s.f);
}

export interface ArchivedThread {
  id: string;
  title: string;
  savedAt: number;
  turns: ChatMessage[];
}

/** Persistent store backed by localStorage (with an in-memory fallback). */
export class PersistentStore implements MemoryStore {
  private kv: KV;

  constructor() {
    this.kv = makeKV();
  }

  // ── Durable facts ──
  async remember(text: string, saJson?: string): Promise<ToolResult> {
    const t = text.trim();
    if (!t) return { ok: false, summary: "Nothing to remember." };
    const facts = readJson<string[]>(this.kv, FACTS_KEY, []);
    if (!facts.includes(t)) {
      facts.push(t);
      const times = readJson<Record<string, number>>(this.kv, FACT_TIMES_KEY, {});
      times[t] = Date.now();
      writeJson(this.kv, FACT_TIMES_KEY, times);
      // The write can genuinely fail (localStorage quota is shared with archived
      // threads and fills up). Reporting ok:true regardless meant JARVIS promised to
      // remember something that was gone on the next read.
      if (!writeJson(this.kv, FACTS_KEY, facts)) {
        return {
          ok: false,
          summary: "I couldn't save that, sir — my on-device storage is full.",
          error: "storage_full",
        };
      }

      // Also generate embedding for semantic search if we have Vertex credentials
      if (saJson) {
        await withVectorStore(
          async (m) =>
            m.addVectorRecord(String(Date.now()), t, await m.generateEmbedding(t, saJson)),
          (e) => console.error("Vector embedding failed, but fact was saved:", e),
        );
      }
    }
    return { ok: true, summary: "Got it — I'll remember that." };
  }

  async forget(text: string): Promise<ToolResult> {
    const t = text.trim().toLowerCase();
    if (t === "everything") {
      writeJson(this.kv, FACTS_KEY, []);
      await withVectorStore((m) => m.clearVectors());
      return { ok: true, summary: "Forgotten everything I knew about you." };
    }
    const facts = readJson<string[]>(this.kv, FACTS_KEY, []);
    const kept = facts.filter((f) => !f.toLowerCase().includes(t));
    writeJson(this.kv, FACTS_KEY, kept);

    await withVectorStore((m) => {
      const removed = facts.filter((f) => f.toLowerCase().includes(t));
      for (const factText of removed) m.deleteVectorRecordByText(factText);
    });

    // A no-op deletion is not a success: the model is told tool results are the
    // source of truth, so ok:true here had it report the fact as deleted.
    return kept.length === facts.length
      ? { ok: false, summary: "I don't have anything matching that, sir.", error: "no_match" }
      : { ok: true, summary: "Forgotten." };
  }

  async listFacts(): Promise<Array<{ text: string; ts?: number }>> {
    const times = readJson<Record<string, number>>(this.kv, FACT_TIMES_KEY, {});
    return readJson<string[]>(this.kv, FACTS_KEY, []).map((text) => ({ text, ts: times[text] }));
  }

  async deleteFact(text: string): Promise<ToolResult> {
    const facts = readJson<string[]>(this.kv, FACTS_KEY, []);
    if (!facts.includes(text))
      return { ok: false, summary: "That fact is already gone.", error: "no_match" };
    writeJson(
      this.kv,
      FACTS_KEY,
      facts.filter((f) => f !== text),
    );
    const times = readJson<Record<string, number>>(this.kv, FACT_TIMES_KEY, {});
    delete times[text];
    writeJson(this.kv, FACT_TIMES_KEY, times);
    await withVectorStore((m) => m.deleteVectorRecordByText(text));
    return { ok: true, summary: "Forgotten." };
  }

  async facts(query?: string, saJson?: string): Promise<string[]> {
    const allFacts = readJson<string[]>(this.kv, FACTS_KEY, []);
    if (!query || allFacts.length < 5) {
      // Fast path: if no query or very few facts, just return all of them
      return allFacts;
    }
    if (!saJson) return keywordRank(query, allFacts);

    const top = await withVectorStore(
      async (m) => m.searchTopK(await m.generateEmbedding(query, saJson), 3),
      (e) => console.error("Semantic search failed, falling back to keyword rank:", e),
    );
    if (top && top.length > 0) return top.map((r) => r.text);

    return keywordRank(query, allFacts);
  }

  // ── Conversation history ──
  async recentTurns(limit = MAX_TURNS): Promise<ChatMessage[]> {
    const turns = readJson<ChatMessage[]>(this.kv, TURNS_KEY, []);
    return turns.slice(-limit);
  }

  async appendTurn(message: ChatMessage): Promise<void> {
    const turns = readJson<ChatMessage[]>(this.kv, TURNS_KEY, []);
    turns.push({ ...message, content: clip(message.content) });
    // Keep only the last MAX_TURNS so persisted history stays bounded.
    writeJson(this.kv, TURNS_KEY, turns.slice(-MAX_TURNS));
  }

  async archiveConversation(): Promise<void> {
    const turns = readJson<ChatMessage[]>(this.kv, TURNS_KEY, []);
    if (turns.length) {
      const recents = readJson<ArchivedThread[]>(this.kv, RECENTS_KEY, []);
      const firstUser = turns.find((t) => t.role === "user");
      const title = (firstUser?.content ?? "Conversation").slice(0, 60);
      recents.push({ id: threadId(), title, savedAt: Date.now(), turns });
      writeJson(this.kv, RECENTS_KEY, recents.slice(-MAX_RECENTS));
    }
    writeJson(this.kv, TURNS_KEY, []);
  }

  async clearConversation(): Promise<ToolResult> {
    writeJson(this.kv, TURNS_KEY, []);
    return { ok: true, summary: "Conversation cleared." };
  }

  async listRecents(): Promise<ArchivedThread[]> {
    return readJson<ArchivedThread[]>(this.kv, RECENTS_KEY, []).slice().reverse();
  }

  async loadRecent(id: string): Promise<ChatMessage[] | null> {
    const recents = readJson<ArchivedThread[]>(this.kv, RECENTS_KEY, []);
    const hit = recents.find((r) => r.id === id);
    return hit ? [...hit.turns] : null;
  }

  async deleteRecent(id: string): Promise<void> {
    const recents = readJson<ArchivedThread[]>(this.kv, RECENTS_KEY, []);
    writeJson(
      this.kv,
      RECENTS_KEY,
      recents.filter((r) => r.id !== id),
    );
  }

  async clearRecents(): Promise<void> {
    writeJson(this.kv, RECENTS_KEY, []);
  }

  async restoreRecent(id: string): Promise<boolean> {
    const turns = await this.loadRecent(id);
    if (!turns) return false;
    writeJson(this.kv, TURNS_KEY, turns);
    return true;
  }
}

function threadId(): string {
  return `t_${Date.now().toString(36)}`;
}

/** The default store the brain uses: persistent when storage is available. */
export function createStore(): MemoryStore {
  return new PersistentStore();
}
