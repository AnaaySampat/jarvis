import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrainConfig } from "./config";
import type { KV } from "./memory/store";
import { ProviderError } from "./errorClass";
import * as quota from "./quota";
import { catalogModels, setCatalog, setCatalogStorage } from "./providers/catalog";

const chat = vi.fn();
vi.mock("./providers", () => ({ providerFor: () => ({ chat }) }));

const { chatOverLadder, ExhaustedError, rejectsTools } = await import("./ask");

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
