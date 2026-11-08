import { resultId } from "../results";
import type { ToolResult } from "../types";

export interface NativeActionReply {
  ok?: boolean;
  summary?: string;
  code?: string;
  error?: string;
  nativeOutcomeId?: string;
  verification?: ToolResult["verification"];
}

interface Entry {
  state: "pending" | "settled" | "unknown";
  reply?: NativeActionReply;
  inspect?: () => Promise<string | undefined>;
  listeners?: Set<() => void>;
}

/** Keeps the original promise alive after the watchdog. Reconciliation never reissues it.
 * Replies stay in memory only; the workflow journal persists the opaque reference.
 * A missing reference after process death remains unknown rather than becoming a failure.
 */
export class NativeOutcomeTracker {
  private entries = new Map<string, Entry>();

  private unknown(
    id: string,
    detail = "The phone has not confirmed this action. It may still complete.",
  ): NativeActionReply {
    return {
      ok: false,
      code: "native_outcome_unknown",
      error: "native_outcome_unknown",
      summary: `${detail} Check the existing action outcome before retrying.`,
      nativeOutcomeId: id,
      verification: { status: "unverified", method: "native_reply_unavailable" },
    };
  }

  async call<T extends NativeActionReply>(
    invoke: () => Promise<T>,
    timeoutMs: number,
    inspect?: Entry["inspect"],
  ): Promise<NativeActionReply> {
    // Bound retained completed receipts, preserving every unresolved call.
    if (this.entries.size >= 128) {
      for (const [id, entry] of this.entries) {
        if (entry.state === "settled") this.entries.delete(id);
        if (this.entries.size < 96) break;
      }
    }
    const id = resultId();
    const entry: Entry = { state: "pending", inspect };
    this.entries.set(id, entry);
    const completion = Promise.resolve()
      .then(invoke)
      .then(
        (reply) => {
          if (!reply || typeof reply.ok !== "boolean") {
            entry.state = "unknown";
            entry.listeners?.clear();
            return this.unknown(
              id,
              "The phone returned no usable action receipt; completion is unknown.",
            );
          }
          entry.state = "settled";
          entry.reply = reply;
          for (const listener of entry.listeners ?? []) {
            try {
              listener();
            } catch {
              /* Receipt observers cannot change the native outcome. */
            }
          }
          entry.listeners?.clear();
          return reply;
        },
        () => {
          entry.state = "unknown";
          entry.listeners?.clear();
          return this.unknown(
            id,
            "The connection lost the action's receipt; the action may have taken effect.",
          );
        },
      );
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        completion,
        new Promise<NativeActionReply>((resolve) => {
          timer = setTimeout(() => resolve(this.unknown(id)), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  watch(id: string, listener: () => void): () => void {
    const entry = this.entries.get(id);
    if (!entry || entry.state === "unknown") return () => {};
    if (entry.state === "settled") {
      void Promise.resolve().then(() => {
        try {
          listener();
        } catch {
          /* Observer only. */
        }
      });
      return () => {};
    }
    (entry.listeners ??= new Set()).add(listener);
    return () => {
      entry.listeners?.delete(listener);
    };
  }

  async check(id: string): Promise<NativeActionReply> {
    const entry = this.entries.get(id);
    if (!entry)
      return this.unknown(
        id,
        "The original native receipt is unavailable, possibly after an app restart. Check the phone directly.",
      );
    if (entry.state === "settled" && entry.reply) return entry.reply;
    const state = await entry.inspect?.().catch(() => undefined);
    // A reply may have arrived while the read-only inspection was in progress.
    if (entry.reply) return entry.reply;
    return this.unknown(
      id,
      state
        ? `${state} The original action's receipt is still unavailable, so completion remains unknown.`
        : undefined,
    );
  }
}
