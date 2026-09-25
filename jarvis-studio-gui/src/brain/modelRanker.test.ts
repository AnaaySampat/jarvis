import { beforeEach, describe, expect, it } from "vitest";
import type { KV } from "./memory/store";
import * as catalog from "./modelCatalog";
import {
  compute,
  hasRanking,
  ladder,
  markNoTools,
  parseEstimates,
  recordDiscovered,
  setRankerStorage,
} from "./modelRanker";
import { routesFor } from "./routes";
import type { BrainConfig } from "./config";

function memKV(): KV {
  const m = new Map<string, string>();
  return {
    get: (k) => m.get(k) ?? null,
    set: (k, v) => void m.set(k, v),
    remove: (k) => void m.delete(k),
  };
}

beforeEach(() => setRankerStorage(memKV()));

describe("model catalog", () => {
  it("scores known families from the benchmark table", () => {
    expect(catalog.lookup("openai/gpt-oss-120b")).toMatchObject({ score: 10, tier: "mid" });
    expect(catalog.lookup("gemini-3.8-flash-lite")).toMatchObject({ tier: "fast" });
    expect(catalog.lookup("nvidia/nemotron-3-super-120b-a12b:free")).toMatchObject({ score: 13 });
    expect(catalog.lookup("some-new-model")).toBeNull();
  });

  it("excludes non-chat models and moving aliases, but not Mistral's", () => {
    expect(catalog.excluded("whisper-large-v3-turbo")).toBe(true);
    expect(catalog.excluded("gemini-flash-latest")).toBe(true);
    expect(catalog.excluded("mistral-small-latest")).toBe(false);
  });

  it("matches speed words as whole tokens only", () => {
    expect(catalog.tierFor("acme-mini-9", 40)).toBe("fast");
    expect(catalog.tierFor("acmegemini-9", 40)).toBe("flagship");
  });
});

describe("ranking + ladder", () => {
  const available = {
    gemini: [
      "gemini-3.8-flash",
      "gemini-3.6-flash",
      "gemini-3.5-flash-lite",
      "gemini-embedding-001",
    ],
    groq: ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "mystery-model"],
  };

  it("ranks by score, drops non-chat, guesses unknowns low", () => {
    const rows = compute(available);
    expect(rows[0]).toMatchObject({ model: "gemini-3.8-flash", source: "benchmark" });
    expect(rows.some((r) => r.model.includes("embedding"))).toBe(false);
    expect(rows.find((r) => r.model === "mystery-model")).toMatchObject({
      source: "guess",
      score: 6,
    });
  });

  it("tries the needed tier first, then stronger, then weaker", () => {
    recordDiscovered(available);
    const order = ladder("mid", false, () => true).map((r) => r.model);
    expect(order.slice(0, 2)).toEqual(["gemini-3.6-flash", "openai/gpt-oss-120b"]);
    expect(order.indexOf("gemini-3.8-flash")).toBeLessThan(order.indexOf("gemini-3.5-flash-lite"));
    expect(ladder("fast", false, () => true)[0]!.model).toBe("gemini-3.5-flash-lite");
  });

  it("routes past a model that rejected tools, only for tool turns", () => {
    recordDiscovered(available);
    markNoTools("gemini", "gemini-3.6-flash");
    expect(ladder("mid", true, () => true)[0]!.model).toBe("openai/gpt-oss-120b");
    expect(ladder("mid", false, () => true)[0]!.model).toBe("gemini-3.6-flash");
    recordDiscovered({ groq: ["openai/gpt-oss-20b"] }); // survives a recompute
    expect(ladder("mid", true, () => true)[0]!.model).not.toBe("gemini-3.6-flash");
  });

  it("clears a provider whose key was removed, keeps one whose listing failed", () => {
    recordDiscovered(available);
    recordDiscovered({ gemini: null, groq: [] });
    const models = ladder("mid", false, () => true).map((r) => r.provider);
    expect(new Set(models)).toEqual(new Set(["gemini"]));
    recordDiscovered({ gemini: [] });
    expect(hasRanking()).toBe(false);
  });

  it("leads Auto routes with the ranking, only over keyed providers", () => {
    recordDiscovered(available);
    const cfg: BrainConfig = {
      tier: "gemini",
      model: "auto",
      autoModel: true,
      keys: { groq: ["k"] }, // no Gemini key → Gemini models are unreachable
    };
    const routes = routesFor(cfg, "smart");
    expect(routes[0]).toMatchObject({ provider: "groq", model: "openai/gpt-oss-120b" });
    expect(routes.every((r) => r.provider === "groq")).toBe(true);
  });

  it("keeps pooled free providers behind the user's own keys", () => {
    // 2026-09-25: an OpenRouter :free model outscored everything on Groq and led
    // every turn into upstream 429s.
    recordDiscovered({ ...available, openrouter: ["qwen/qwen3.8-27b:free"] });
    const cfg: BrainConfig = {
      tier: "gemini",
      model: "auto",
      autoModel: true,
      keys: { groq: ["k"], openrouter: ["k"] },
    };
    const providers = routesFor(cfg, "smart").map((r) => r.provider);
    expect(providers[0]).toBe("groq");
    expect(providers.slice(0, providers.lastIndexOf("groq"))).not.toContain("openrouter");
  });

  it("never routes to a model scoring below the floor", () => {
    recordDiscovered({ groq: ["allam-2-7b", "openai/gpt-oss-20b"] });
    const models = ladder("fast", false, () => true).map((r) => r.model);
    expect(models).toEqual(["openai/gpt-oss-20b"]);
  });

  it("drops Gemini Omni as non-chat", () => {
    expect(catalog.lookup("gemini-omni-1.1-flash")).toEqual({ chat: false });
    expect(catalog.lookup("nvidia/nemotron-3-nano-omni-30b-a3b-reasoning")).not.toEqual({
      chat: false,
    });
  });
});

describe("parseEstimates", () => {
  it("keeps asked-about ids, marks non-chat, rejects off-scale batches", () => {
    const ids = ["mystery-model", "voice-x"];
    const text =
      '```json\n[{"id":"mystery-model","score":21,"basis":"size"},{"id":"voice-x","chat":false},{"id":"other","score":5}]\n```';
    expect(parseEstimates(text, ids)).toEqual({
      "mystery-model": { score: 21, basis: "est. size" },
      "voice-x": { chat: false },
    });
    expect(parseEstimates('[{"id":"mystery-model","score":1250}]', ids)).toEqual({});
  });
});
