import { beforeEach, describe, expect, it } from "vitest";
import type { KV } from "../memory/store";
import type { BrainConfig } from "../config";
import { routesFor } from "../routes";
import {
  markModelDead,
  pickMistral,
  pickNvidia,
  pickOpenRouter,
  setCatalog,
  setCatalogStorage,
} from "./catalog";
// OpenRouter's real /models listing on 2026-09-23 (trimmed to id + tool support).
import openrouterModels from "./openrouter-models.fixture.json";

function fakeKV(): KV {
  const mem = new Map<string, string>();
  return {
    get: (k) => mem.get(k) ?? null,
    set: (k, v) => void mem.set(k, v),
    remove: (k) => void mem.delete(k),
  };
}

beforeEach(() => setCatalogStorage(fakeKV()));

describe("model pickers", () => {
  it("picks free, tool-capable, general, mid-to-large OpenRouter models", () => {
    const picks = pickOpenRouter(openrouterModels);
    // Ranked candidates, not just the two routed: spares replace a pick that 404s.
    expect(picks.length).toBeGreaterThan(2);
    expect(picks.length).toBeLessThanOrEqual(8);
    for (const id of picks) {
      expect(id.endsWith(":free")).toBe(true);
      expect(id).not.toMatch(/safety|code|-vl|-fin|sante|mini/i);
    }
    // Stated sizes in the 20–150B band come first, largest first.
    expect(picks[0]).toBe("nvidia/nemotron-3-super-120b-a12b:free");
    expect(picks[1]).toBe("google/gemma-4-31b-it:free");
  });

  it("never picks a paid OpenRouter model", () => {
    const picks = pickOpenRouter({
      data: [{ id: "openai/gpt-6-luna-pro", supported_parameters: ["tools"] }],
    });
    expect(picks).toEqual([]);
  });

  it("prefers Mistral's stable -latest aliases and skips deprecated or tool-less models", () => {
    const picks = pickMistral({
      data: [
        { id: "codestral-latest", capabilities: { completion_chat: true, function_calling: true } },
        {
          id: "mistral-large-latest",
          capabilities: { completion_chat: true, function_calling: true },
        },
        { id: "open-mistral-7b", capabilities: { completion_chat: true, function_calling: false } },
        {
          id: "mistral-small-latest",
          capabilities: { completion_chat: true, function_calling: true },
        },
        { id: "mistral-old", capabilities: { completion_chat: true }, deprecation: "2026-01-01" },
      ],
    });
    expect(picks).toEqual(["mistral-small-latest", "mistral-large-latest"]);
  });

  it("chooses instruct-tuned NVIDIA models inside the size band", () => {
    const picks = pickNvidia({
      data: [
        { id: "nvidia/nv-embedqa-e5-v5" },
        { id: "meta/llama-3.1-8b-instruct" },
        { id: "meta/llama-3.3-70b-instruct" },
        { id: "meta/llama-3.1-405b-instruct" },
        { id: "openai/gpt-oss-120b" },
      ],
    });
    expect(picks).toEqual([
      "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
      "openai/gpt-oss-120b",
      "meta/llama-3.3-70b-instruct",
    ]);
  });

  it("leads with the one NVIDIA model a free key could call, though its name is filtered", () => {
    // 2026-09-23: every listed pick 404'd or timed out; nemotron-3-nano-omni answered.
    const picks = pickNvidia({ data: [{ id: "nvidia/llama-3.1-nemotron-70b-instruct" }] });
    expect(picks).toEqual([
      "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
      "nvidia/llama-3.1-nemotron-70b-instruct",
    ]);
  });
});

describe("route ladder with pooled providers", () => {
  const base: BrainConfig = {
    tier: "gemini",
    model: "gemini-3.5-flash",
    keys: { gemini: ["k1"], groq: ["g1"] },
  };

  it("is unchanged when no extra keys are set", () => {
    setCatalog({ openrouter: ["x/model:free"] });
    expect(routesFor(base).some((r) => r.provider === "openrouter")).toBe(false);
  });

  it("appends each keyed provider's discovered models after Gemini and Groq", () => {
    setCatalog({
      openrouter: ["a/model-70b:free"],
      nvidia: ["meta/llama-3.3-70b-instruct"],
      mistral: ["mistral-small-latest"],
    });
    const routes = routesFor({
      ...base,
      keys: { ...base.keys, openrouter: ["o1"], nvidia: ["n1"], mistral: ["m1"] },
    });
    const providers = routes.map((r) => r.provider);
    const firstExtra = providers.findIndex((p) => ["openrouter", "nvidia", "mistral"].includes(p));
    // Pooled providers are fallbacks: nothing from Gemini/Groq comes after them.
    expect(providers.slice(firstExtra)).toEqual(["openrouter", "nvidia", "mistral"]);
    expect(routes.find((r) => r.provider === "openrouter")?.model).toBe("a/model-70b:free");
  });

  it("replaces a model that 404s for this key with the next candidate, for a week", () => {
    // 2026-09-23: both NVIDIA picks answered "Function not found for account".
    setCatalog({
      nvidia: ["nvidia/dead-70b-instruct", "meta/llama-3.3-70b-instruct", "x/third-30b-instruct"],
    });
    const keyed = { ...base, keys: { ...base.keys, nvidia: ["n1"] } };
    const nvidia = () =>
      routesFor(keyed)
        .filter((r) => r.provider === "nvidia")
        .map((r) => r.model);
    expect(nvidia()).toEqual(["nvidia/dead-70b-instruct", "meta/llama-3.3-70b-instruct"]);

    const t0 = Date.now();
    markModelDead("nvidia", "nvidia/dead-70b-instruct", t0);
    expect(nvidia()).toEqual(["meta/llama-3.3-70b-instruct", "x/third-30b-instruct"]);

    markModelDead("nvidia", "unrelated/other", t0 + 8 * 24 * 3600_000); // prunes expired marks
    expect(nvidia()[0]).toBe("nvidia/dead-70b-instruct");
  });

  it("adds nothing for a keyed provider whose models aren't discovered yet", () => {
    setCatalog({});
    const routes = routesFor({ ...base, keys: { ...base.keys, openrouter: ["o1"] } });
    expect(routes.some((r) => r.provider === "openrouter")).toBe(false);
  });

  it("stays pinned to the configured model when switching is off", () => {
    setCatalog({ openrouter: ["a/model-70b:free"] });
    const routes = routesFor({
      ...base,
      autoSwitchModels: false,
      keys: { ...base.keys, openrouter: ["o1"] },
    });
    expect(routes.every((r) => r.model === "gemini-3.5-flash")).toBe(true);
  });
});
