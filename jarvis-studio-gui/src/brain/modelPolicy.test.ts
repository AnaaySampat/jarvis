import { describe, expect, it } from "vitest";
import { isImageGenerationRequest, modelClassFor, taskModelClass } from "./modelPolicy";

describe("model policy", () => {
  it("sorts chat and image models into the user-facing capability buckets", () => {
    expect(modelClassFor("openai/gpt-oss-20b")).toBe("dumb");
    expect(modelClassFor("gemini-2.0-flash")).toBe("smart");
    expect(modelClassFor("openai/gpt-oss-120b")).toBe("very-smart");
    expect(modelClassFor("gemini-2.5-flash-image")).toBe("image");
  });

  it("only sends actual image-creation requests to image generation", () => {
    expect(isImageGenerationRequest("Create a neon JARVIS wallpaper for my phone")).toBe(true);
    expect(isImageGenerationRequest("Can you make a logo for my coffee shop?")).toBe(true);
    expect(isImageGenerationRequest("How do I create a logo in Photoshop?")).toBe(false);
    expect(isImageGenerationRequest("What is an image model?")).toBe(false);
  });

  it("reserves the weak tier for throwaway chat", () => {
    expect(taskModelClass("hello")).toBe("dumb");
    expect(taskModelClass("Explain quantum computing")).toBe("smart");
    expect(taskModelClass("Compare these approaches and design an implementation plan")).toBe(
      "very-smart",
    );
  });
});
