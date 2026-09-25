import { describe, expect, it, vi, beforeEach } from "vitest";

const resilientFetch = vi.fn();
const postJson = vi.fn();

vi.mock("./httpClient", () => ({
  resilientFetch: (...a: unknown[]) => resilientFetch(...a),
  postJson: (...a: unknown[]) => postJson(...a),
  getJson: vi.fn(),
  getText: vi.fn(),
  isOffline: () => false,
}));

import { generateImage, webSearch } from "./http";
import type { HttpToolCtx } from "./http";

const ctx = (): HttpToolCtx =>
  ({
    config: { tier: "gemini", model: "gemini-3.6-flash", keys: { gemini: ["k"] }, pinnedLocation: "" },
    location: { pinnedPlace: "", coords: async () => null },
  }) as unknown as HttpToolCtx;

/** The live free-tier rejection: not a spent allowance — an allocation of zero. */
const LIMIT_ZERO = JSON.stringify({
  error: {
    code: 429,
    status: "RESOURCE_EXHAUSTED",
    message:
      "Quota exceeded for metric: generativelanguage.googleapis.com/" +
      "generate_content_free_tier_requests, limit: 0, model: gemini-2.5-flash-image",
  },
});

const rejected = (body: string, status = 429) => ({ ok: false, status, text: async () => body });
const drew = () => ({
  ok: true,
  status: 200,
  json: async () => ({
    candidates: [{ content: { parts: [{ inline_data: { data: "AAA", mime_type: "image/png" } }] } }],
  }),
});

const urlOf = (call: unknown[]) => String(call[0]);

beforeEach(() => {
  resilientFetch.mockReset();
  postJson.mockReset();
});

describe("generateImage — free tier allocates some image models nothing", () => {
  it("walks past a limit:0 model instead of failing the request on it", async () => {
    resilientFetch.mockResolvedValueOnce(rejected(LIMIT_ZERO)).mockResolvedValueOnce(drew());

    const r = await generateImage("a red fox", ctx());

    expect(r.ok).toBe(true);
    expect((r.data as { imageUrl?: string })?.imageUrl).toBe("data:image/png;base64,AAA");
    expect(resilientFetch).toHaveBeenCalledTimes(2);
    // Two DIFFERENT models — a retry of the same id would be refused identically.
    expect(urlOf(resilientFetch.mock.calls[0]!)).not.toBe(urlOf(resilientFetch.mock.calls[1]!));
  });

  it("never calls a zero-allocation quota 'used up' when every model refuses", async () => {
    resilientFetch.mockResolvedValue(rejected(LIMIT_ZERO));

    const r = await generateImage("a red fox", ctx());

    expect(r.ok).toBe(false);
    expect(r.summary).toMatch(/free tier/i);
    expect(r.summary).toMatch(/billing/i);
    // The bug this replaces: the raw 429 reached the chat model, which relayed it as
    // an exhausted allowance that would "free up" — it never will.
    expect(r.summary).not.toMatch(/used up|try again later|free up/i);
  });

  it("surfaces the API's own reason for a non-quota failure", async () => {
    resilientFetch.mockResolvedValue(
      rejected(JSON.stringify({ error: { message: "API key not valid" } }), 400),
    );

    expect((await generateImage("x", ctx())).summary).toMatch(/API key not valid/);
  });
});

describe("webSearch — the grounded call must leave room to answer", () => {
  it("sends no maxOutputTokens, so thinking can't eat the whole reply budget", async () => {
    postJson.mockResolvedValue({ candidates: [{ content: { parts: [{ text: "42" }] } }] });

    const r = await webSearch("who won", ctx());

    expect(r.ok).toBe(true);
    const body = JSON.parse(String(postJson.mock.calls[0]![1]));
    expect(body.generationConfig?.maxOutputTokens).toBeUndefined();
    expect(body.tools).toEqual([{ google_search: {} }]);
  });

  it("reports WHY an empty answer came back rather than a bare shrug", async () => {
    postJson.mockResolvedValue({ candidates: [{ finishReason: "MAX_TOKENS", content: {} }] });

    expect((await webSearch("who won", ctx())).summary).toMatch(/MAX_TOKENS/);
  });
});
