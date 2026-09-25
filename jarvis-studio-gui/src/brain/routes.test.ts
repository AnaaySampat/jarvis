import { beforeEach, describe, expect, it } from "vitest";
import type { BrainConfig } from "./config";
import type { KV } from "./memory/store";
import { setRankerStorage } from "./modelRanker";
import { setCatalog, setCatalogStorage } from "./providers/catalog";
import { GEMINI_DEFAULT } from "./resolveConfig";
import { routesFor } from "./routes";

function memKV(): KV {
  const m = new Map<string, string>();
  return {
    get: (k) => m.get(k) ?? null,
    set: (k, v) => void m.set(k, v),
    remove: (k) => void m.delete(k),
  };
}

function cfg(overrides: Partial<BrainConfig> = {}): BrainConfig {
  return {
    tier: "groq",
    model: "openai/gpt-oss-120b",
    autoModel: true,
    keys: { groq: ["test-key"] },
    autoSwitchModels: false,
    ...overrides,
  };
}

describe("Auto model routes", () => {
  it("uses the dumb Groq route only for simple turns", () => {
    expect(routesFor(cfg(), "dumb")[0]).toMatchObject({
      provider: "groq",
      model: "openai/gpt-oss-20b",
    });
  });

  it("uses the strongest available Groq route for smart and very-smart turns", () => {
    expect(routesFor(cfg(), "smart")[0]?.model).toBe("openai/gpt-oss-120b");
    expect(routesFor(cfg(), "very-smart")[0]?.model).toBe("openai/gpt-oss-120b");
  });

  it("does not override an explicitly selected model", () => {
    const manual = cfg({ autoModel: false, model: "openai/gpt-oss-20b" });
    expect(routesFor(manual, "very-smart")[0]?.model).toBe("openai/gpt-oss-20b");
  });

  it("will not route a manually supplied image id through chat", () => {
    const unsafe = cfg({
      tier: "gemini",
      model: "gemini-2.5-flash-image",
      autoModel: false,
      keys: { gemini: ["test-key"] },
    });
    expect(routesFor(unsafe, "smart")[0]?.model).toBe(GEMINI_DEFAULT);
  });
});

describe("Provider scope", () => {
  const both = (overrides: Partial<BrainConfig> = {}) =>
    cfg({
      tier: "groq",
      keys: { groq: ["g"], gemini: ["a"], openrouter: ["o"] },
      autoSwitchModels: true,
      ...overrides,
    });
  const providers = (c: BrainConfig) => [...new Set(routesFor(c, "smart").map((r) => r.provider))];

  beforeEach(() => {
    setRankerStorage(memKV());
    setCatalogStorage(memKV());
    setCatalog({ openrouter: ["qwen/qwen3.8-27b:free"] });
  });

  it("Auto on one provider with fallback off never leaves that provider", () => {
    expect(
      providers(both({ providerScope: "gemini", tier: "gemini", autoSwitchModels: false })),
    ).toEqual(["gemini"]);
  });

  it("Auto on one provider leads with it, then falls back when allowed", () => {
    const p = providers(both({ providerScope: "gemini", tier: "gemini" }));
    expect(p[0]).toBe("gemini");
    expect(p).toContain("groq");
  });

  it("a pooled provider can be the chosen one", () => {
    const routes = routesFor(
      both({ providerScope: "openrouter", autoSwitchModels: false }),
      "smart",
    );
    expect(routes.map((r) => r.provider)).toEqual(["openrouter"]);
    expect(routes[0]?.model).toBe("qwen/qwen3.8-27b:free");
  });

  it("Auto on Auto ignores the fallback switch — there is no choice to pin", () => {
    const p = providers(both({ providerScope: "auto", autoSwitchModels: false }));
    expect(p).toEqual(expect.arrayContaining(["groq", "gemini", "openrouter"]));
  });

  it("a picked model on a provider falls back to that provider's others first", () => {
    const r = routesFor(
      both({ providerScope: "groq", autoModel: false, model: "llama-3.3-70b-versatile" }),
      "smart",
    );
    expect(r[0]).toMatchObject({ provider: "groq", model: "llama-3.3-70b-versatile" });
    expect(r[1]?.provider).toBe("groq");
  });
});
