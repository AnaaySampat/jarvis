import { describe, it, expect, vi } from "vitest";

let body: unknown = null;
vi.mock("../tools/httpClient", () => ({
  platformFetch: () => async () => new Response(JSON.stringify(body), { status: 200 }),
}));

import { OpenAICompatProvider } from "./openaiCompat";
import { isRetryable, ProviderError } from "../errorClass";
import type { BrainConfig } from "../config";

const cfg = { keys: { openrouter: ["k"] } } as unknown as BrainConfig;
const ask = () =>
  new OpenAICompatProvider(cfg, "openrouter").chat([{ role: "user", content: "hi" }], [], {
    model: "some/model:free",
  });

describe("OpenAICompatProvider — empty replies", () => {
  it("treats a 200 with no text and no tool calls as a retryable failure", async () => {
    // Seen live 2026-09-23: OpenRouter's free nemotron answered 200 with nothing in it.
    body = { choices: [{ message: { role: "assistant", content: null }, finish_reason: "stop" }] };
    const err = await ask().catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(isRetryable(err)).toBe(true);
  });

  it("still returns a real answer", async () => {
    body = { choices: [{ message: { role: "assistant", content: " Hello. " } }] };
    await expect(ask()).resolves.toEqual({ text: "Hello.", toolCalls: [] });
  });
});
