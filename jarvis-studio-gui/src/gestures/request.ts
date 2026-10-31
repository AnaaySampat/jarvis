export interface GestureReply {
  ok: boolean;
  summary: string;
}
/** One-shot requests with correlated acknowledgements. There is no automatic
 * retry: retrying play/pause or mute could undo an already delivered action. */
export class GestureRequests {
  private pending = new Map<
    string,
    {
      resolve: (r: GestureReply) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  request(
    send: (data: Record<string, unknown>) => boolean,
    action: string,
    data: Record<string, unknown> = {},
  ): Promise<GestureReply> {
    const id = "gesture_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 14);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.pending.delete(id);
          reject(
            new Error("The PC did not acknowledge the gesture. Check its connection and version."),
          );
        },
        action === "read_aloud" ? 180000 : 10000,
      );
      this.pending.set(id, { resolve, reject, timer });
      try {
        if (!send({ ...data, action, request_id: id })) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(new Error("The PC is not connected or its control session is not armed."));
        }
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
  receive(data: unknown): boolean {
    if (!data || typeof data !== "object") return false;
    const r = data as Record<string, unknown>,
      pending = this.pending.get(String(r.request_id || ""));
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pending.delete(String(r.request_id));
    pending.resolve({ ok: r.ok === true, summary: String(r.summary || "No result was reported.") });
    return true;
  }
  close() {
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(new Error("The gesture connection closed."));
    }
    this.pending.clear();
  }
}
