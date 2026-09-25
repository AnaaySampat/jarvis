import { describe, expect, it } from "vitest";
import { GEMINI_DEFAULT, GROQ_DEFAULT, VERTEX_DEFAULT, resolveBrainConfig } from "./resolveConfig";

describe("resolveBrainConfig", () => {
  it("honors an explicit vertex provider_mode with the picked Gemini model", () => {
    const cfg = resolveBrainConfig({
      providerMode: "vertex",
      vertexSaJson: JSON.stringify({ project_id: "proj-1" }),
      model: "gemini-2.5-flash",
    });
    expect(cfg.tier).toBe("vertex");
    expect(cfg.model).toBe("gemini-2.5-flash");
    expect(cfg.vertexProject).toBe("proj-1");
  });

  it("falls back to the Vertex default on vertex + auto", () => {
    const cfg = resolveBrainConfig({
      providerMode: "vertex",
      vertexSaJson: "{}",
      model: "auto",
    });
    expect(cfg.tier).toBe("vertex");
    expect(cfg.model).toBe(VERTEX_DEFAULT);
  });

  it("falls back to the Vertex default on vertex + a foreign (Groq) model id", () => {
    const cfg = resolveBrainConfig({
      providerMode: "vertex",
      vertexSaJson: "{}",
      model: "llama3.1",
    });
    expect(cfg.model).toBe(VERTEX_DEFAULT);
  });

  it("never accepts an image model as a conversational model", () => {
    const cfg = resolveBrainConfig({
      providerMode: "gemini",
      geminiKey: "AIza_x",
      model: "gemini-2.5-flash-image",
    });
    expect(cfg.model).toBe(GEMINI_DEFAULT);
  });

  it("ignores vertex provider_mode without a service-account JSON", () => {
    const cfg = resolveBrainConfig({ providerMode: "vertex", groqKey: "gsk_x" });
    expect(cfg.tier).toBe("groq");
  });

  it("honors explicit gemini provider_mode with a gemini key", () => {
    const cfg = resolveBrainConfig({ providerMode: "gemini", geminiKey: "AIza_x" });
    expect(cfg.tier).toBe("gemini");
    expect(cfg.model).toBe(GEMINI_DEFAULT);
  });

  it("honors explicit groq provider_mode, coercing a non-Groq picked model to the default", () => {
    const cfg = resolveBrainConfig({
      providerMode: "groq",
      groqKey: "gsk_x",
      model: "gemini-2.5-flash",
    });
    expect(cfg.tier).toBe("groq");
    expect(cfg.model).toBe(GROQ_DEFAULT);
  });

  // Regression: `auto || isGroqModel(picked) ? GROQ_DEFAULT : picked` parsed as
  // `(auto || isGroqModel(picked))`, so a VALID Groq pick was thrown away and
  // GROQ_DEFAULT came back in every case. The case above passed anyway because it
  // only ever fed a non-Groq id.
  it("honors explicit groq provider_mode with a VALID picked Groq model", () => {
    const cfg = resolveBrainConfig({
      providerMode: "groq",
      groqKey: "gsk_x",
      model: "llama-3.3-70b-versatile",
    });
    expect(cfg.tier).toBe("groq");
    expect(cfg.model).toBe("llama-3.3-70b-versatile");
  });

  it("infers gemini tier from a picked gemini model with no explicit provider_mode", () => {
    const cfg = resolveBrainConfig({ geminiKey: "AIza_x", model: "gemini-2.5-flash" });
    expect(cfg.tier).toBe("gemini");
    expect(cfg.model).toBe("gemini-2.5-flash");
  });

  it("infers groq tier from a picked groq-family model", () => {
    const cfg = resolveBrainConfig({ groqKey: "gsk_x", model: "llama3.1-70b" });
    expect(cfg.tier).toBe("groq");
    expect(cfg.model).toBe("llama3.1-70b");
  });

  it("prefers groq when only a groq key is present and nothing else applies", () => {
    const cfg = resolveBrainConfig({ groqKey: "gsk_x" });
    expect(cfg.tier).toBe("groq");
    expect(cfg.model).toBe(GROQ_DEFAULT);
  });

  it("prefers gemini when only a gemini key is present", () => {
    const cfg = resolveBrainConfig({ geminiKey: "AIza_x" });
    expect(cfg.tier).toBe("gemini");
    expect(cfg.model).toBe(GEMINI_DEFAULT);
  });

  it("defaults to gemini when no keys are configured at all", () => {
    const cfg = resolveBrainConfig({});
    expect(cfg.tier).toBe("gemini");
    expect(cfg.model).toBe(GEMINI_DEFAULT);
  });

  it("carries the pinned location through unchanged", () => {
    const cfg = resolveBrainConfig({ groqKey: "gsk_x", pinnedLocation: "Mumbai" });
    expect(cfg.pinnedLocation).toBe("Mumbai");
  });

  it("scopes routing to a pooled provider the user picked, keeping a keyed tier", () => {
    const cfg = resolveBrainConfig({
      providerMode: "openrouter",
      openrouterKey: "sk-or-x",
      groqKey: "gsk_x",
    });
    expect(cfg.providerScope).toBe("openrouter");
    expect(cfg.tier).toBe("groq");
    expect(cfg.autoModel).toBe(true);
  });

  it("falls back to auto when the picked provider's key is gone", () => {
    const cfg = resolveBrainConfig({ providerMode: "mistral", geminiKey: "AIza_x" });
    expect(cfg.providerScope).toBe("auto");
    expect(cfg.tier).toBe("gemini");
  });

  it("uses Vertex as the Google surface when it is the only Google credential", () => {
    const cfg = resolveBrainConfig({ providerMode: "auto", vertexSaJson: "{}", groqKey: "gsk_x" });
    expect(cfg.tier).toBe("vertex");
    expect(cfg.providerScope).toBe("auto");
  });

  it("keeps a Groq pick that matches no family pattern when Groq is the provider", () => {
    const cfg = resolveBrainConfig({ providerMode: "groq", groqKey: "gsk_x", model: "allam-2-7b" });
    expect(cfg.model).toBe("allam-2-7b");
  });
});
