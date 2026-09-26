import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrainConfig } from "./config";
import type { KV } from "./memory/store";
import { ProviderError } from "./errorClass";
import * as quota from "./quota";
import { catalogModels, setCatalog, setCatalogStorage } from "./providers/catalog";

const chat = vi.fn();
vi.mock("./providers", () => ({ providerFor: () => ({ chat }) }));

const { chatOverLadder, ExhaustedError, rejectsTools, fastFirst, noteLatency, resetLatency } = await import("./ask");

describe("fastFirst", () => {
  const r = (model: string) => ({ provider: "gemini", model, keyIndex: 0 });
  beforeEach(() => resetLatency());

  it("moves a route that was slow lately behind the others, keeping their order", () => {
    noteLatency(r("gemma-4-31b"), 16_600, 1_000);
    const out = fastFirst([r("gemma-4-31b"), r("gemini-2.5-flash"), r("gemma-4-26b")], 2_000);
    expect(out.map((x) => x.model)).toEqual(["gemini-2.5-flash", "gemma-4-26b", "gemma-4-31b"]);
  });

  it("forgets after an hour, and a fast answer clears a slow one", () => {
    noteLatency(r("a"), 20_000, 0);
    expect(fastFirst([r("a"), r("b")], 61 * 60_000)[0]!.model).toBe("a");
    noteLatency(r("a"), 20_000, 0);
    noteLatency(r("a"), 1_000, 1_000); // average 10.5s: still slow
    expect(fastFirst([r("a"), r("b")], 2_000)[0]!.model).toBe("b");
    noteLatency(r("a"), 1_000, 3_000); // average ~5.8s: fast again
    expect(fastFirst([r("a"), r("b")], 4_000)[0]!.model).toBe("a");
  });
});

const cfg: BrainConfig = {
  tier: "groq",
  model: "openai/gpt-oss-120b",
  keys: { groq: ["g1"] },
  autoSwitchModels: false, // one route: the wait is the only way through
};

const tpm429 = () =>
  new ProviderError("groq 429", {
    status: 429,
    retryAfterMs: 6_000,
    detail: "Rate limit reached … on tokens per minute (TPM): Limit 8000. Please try again in 6s.",
  });

function fakeKV(): KV {
  const mem = new Map<string, string>();
  return {
    get: (k) => mem.get(k) ?? null,
    set: (k, v) => void mem.set(k, v),
    remove: (k) => void mem.delete(k),
  };
}

describe("chatOverLadder under a per-minute limit", () => {
  beforeEach(() => {
    quota.setStorage(fakeKV());
    quota.reset();
    chat.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("waits out a short per-minute bench instead of reporting the quota spent", async () => {
    chat.mockRejectedValueOnce(tpm429()).mockResolvedValueOnce({ text: "hi", toolCalls: [] });
    const reply = chatOverLadder([{ role: "user", content: "hello" }], [], cfg);
    await vi.advanceTimersByTimeAsync(7_000);
    await expect(reply).resolves.toEqual({ text: "hi", toolCalls: [] });
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it("still gives up honestly when the wait would be long", async () => {
    chat.mockRejectedValue(
      new ProviderError("groq 429", {
        status: 429,
        detail: "Rate limit reached … on requests per day (RPD): Limit 1000",
      }),
    );
    await expect(
      chatOverLadder([{ role: "user", content: "hello" }], [], cfg),
    ).rejects.toBeInstanceOf(ExhaustedError);
    expect(chat).toHaveBeenCalledTimes(1);
  });
});

describe("chatOverLadder with a pooled model the key can't call", () => {
  beforeEach(() => {
    quota.setStorage(fakeKV());
    quota.reset();
    setCatalogStorage(fakeKV());
    chat.mockReset();
  });

  it("moves past a 410 Gone and stops routing to that model", async () => {
    // Live 2026-09-23: NVIDIA answered 410 and the raw "NVIDIA NIM 410" ended the turn.
    setCatalog({ nvidia: ["meta/llama-3.3-70b-instruct", "openai/gpt-oss-20b"] });
    const nv: BrainConfig = {
      tier: "groq",
      model: "openai/gpt-oss-120b",
      keys: { nvidia: ["n1"] },
    };
    chat
      .mockRejectedValueOnce(new ProviderError("NVIDIA NIM 410", { status: 410, detail: "Gone" }))
      .mockResolvedValueOnce({ text: "hello", toolCalls: [] });
    await expect(chatOverLadder([{ role: "user", content: "hi" }], [], nv)).resolves.toEqual({
      text: "hello",
      toolCalls: [],
    });
    expect(catalogModels("nvidia")).not.toContain("meta/llama-3.3-70b-instruct");
  });
});

describe("chatOverLadder after a model's 400", () => {
  beforeEach(() => {
    quota.setStorage(fakeKV());
    quota.reset();
    setCatalogStorage(fakeKV());
    resetLatency();
    chat.mockReset();
  });

  it("asks the next model instead of ending the turn, and doesn't bench the first", async () => {
    // Live 2026-09-26: Groq's 400 tool_use_failed ended chat turns with "I hit an error".
    const groq: BrainConfig = { tier: "groq", model: "openai/gpt-oss-120b", keys: { groq: ["g1"] } };
    chat.mockImplementation(async (_convo: unknown, _tools: unknown, o: { model: string }) => {
      if (o.model === "openai/gpt-oss-120b") {
        throw new ProviderError("Groq 400", {
          status: 400,
          detail: '{"error":{"message":"Failed to call a function.","code":"tool_use_failed"}}',
        });
      }
      return { text: "hello", toolCalls: [] };
    });
    await expect(chatOverLadder([{ role: "user", content: "hi" }], [], groq)).resolves.toEqual({
      text: "hello",
      toolCalls: [],
    });
    expect(quota.usable({ provider: "groq", model: "openai/gpt-oss-120b", keyIndex: 0 })).toBe(true);
  });
});

describe("chatOverLadder hedging a slow route", () => {
  beforeEach(() => {
    quota.setStorage(fakeKV());
    quota.reset();
    setCatalogStorage(fakeKV());
    resetLatency();
    chat.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("asks the next model after 6s and takes the first answer", async () => {
    // Live 2026-09-26: gemma-4-31b took 25.7s on a chat turn; the next route took ~1.6s.
    setCatalog({ nvidia: ["slow/model", "fast/model"] });
    const nv: BrainConfig = { tier: "groq", model: "openai/gpt-oss-120b", keys: { nvidia: ["n1"] } };
    let slowSignal: AbortSignal | undefined;
    chat.mockImplementation((_c: unknown, _t: unknown, o: { model: string; signal?: AbortSignal }) =>
      o.model === "slow/model"
        ? ((slowSignal = o.signal), new Promise((r) => setTimeout(() => r({ text: "late", toolCalls: [] }), 25_000)))
        : new Promise((r) => setTimeout(() => r({ text: "fast", toolCalls: [] }), 1_500)),
    );
    const reply = chatOverLadder([{ role: "user", content: "open settings" }], [], nv);
    await vi.advanceTimersByTimeAsync(7_600);
    await expect(reply).resolves.toEqual({ text: "fast", toolCalls: [] });
    expect(slowSignal?.aborted).toBe(true); // the loser is cancelled
    // …and the slow model now goes behind the fast one.
    expect(fastFirst([{ provider: "nvidia", model: "slow/model", keyIndex: 0 },
      { provider: "nvidia", model: "fast/model", keyIndex: 0 }])[0]!.model).toBe("fast/model");
  });

  it("doesn't hedge a route that answers in time", async () => {
    setCatalog({ nvidia: ["a/model", "b/model"] });
    const nv: BrainConfig = { tier: "groq", model: "openai/gpt-oss-120b", keys: { nvidia: ["n1"] } };
    chat.mockImplementation(() => new Promise((r) => setTimeout(() => r({ text: "ok", toolCalls: [] }), 2_000)));
    const reply = chatOverLadder([{ role: "user", content: "hi" }], [], nv);
    await vi.advanceTimersByTimeAsync(2_100);
    await expect(reply).resolves.toEqual({ text: "ok", toolCalls: [] });
    expect(chat).toHaveBeenCalledTimes(1);
  });
});

describe("rejectsTools", () => {
  const e400 = (detail: string) => new ProviderError("400", { status: 400, detail });
  it("marks only a model that says it can't call tools", () => {
    expect(rejectsTools(e400("Function calling is not enabled for models/gemma-4-31b-it"))).toBe(true);
    expect(rejectsTools(e400("This model does not support tools"))).toBe(true);
    // Request-shaped 400s that merely mention tools must not bench the model forever.
    expect(
      rejectsTools(
        e400("Please ensure that function call turn comes immediately after a user turn"),
      ),
    ).toBe(false);
    expect(rejectsTools(e400("Invalid JSON payload: tools[0].function_declarations"))).toBe(false);
  });
});
