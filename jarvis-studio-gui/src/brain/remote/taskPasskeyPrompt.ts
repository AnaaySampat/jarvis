/** A per-request secret prompt. Only the goal is published to UI state. */
export class TaskPasskeyPrompt {
  private pending: ((value: string | null) => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(
    private onChange: (request: { goal: string } | null) => void,
    private timeoutMs = 90_000,
  ) {}

  request(goal: string): Promise<string | null> {
    if (this.pending) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.pending = resolve;
      this.timer = setTimeout(() => this.respond(null), this.timeoutMs);
      this.onChange({ goal });
    });
  }

  respond(value: string | null): boolean {
    if (!this.pending) return false;
    if (value !== null && (typeof value !== "string" || value.length < 8 || value.length > 128)) return false;
    const resolve = this.pending;
    this.pending = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.onChange(null);
    resolve(value);
    return true;
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending?.(null);
    this.pending = null;
  }
}
