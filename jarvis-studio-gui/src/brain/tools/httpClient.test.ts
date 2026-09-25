import { afterEach, describe, expect, it, vi } from "vitest";
import { platformFetch } from "./httpClient";

/** A fetch that never answers on its own — it settles only when aborted. */
function hangingFetch() {
  return vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
      ),
  );
}

describe("platformFetch timeout", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps the 30s default, but honours a longer per-call ceiling", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", hangingFetch());

    let defaultDone = false;
    let longDone = false;
    platformFetch()("https://x.test").catch(() => (defaultDone = true));
    platformFetch(90_000)("https://x.test").catch(() => (longDone = true));

    await vi.advanceTimersByTimeAsync(31_000);
    expect(defaultDone).toBe(true);
    // The operator's call must survive past the chat-turn default…
    expect(longDone).toBe(false);

    await vi.advanceTimersByTimeAsync(60_000);
    // …and still be cut off, so a dead route fails over.
    expect(longDone).toBe(true);
  });
});
