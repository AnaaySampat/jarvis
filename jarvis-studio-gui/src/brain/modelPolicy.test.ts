import { describe, expect, it } from "vitest";
import {
  isComplexTask,
  isDirectWeatherRequest,
  isDirectNotificationRequest,
  isImageGenerationRequest,
  modelClassFor,
  taskModelClass,
} from "./modelPolicy";

describe("model policy", () => {
  it("directly reads only a plain local notification request", () => {
    for (const text of [
      "can you read my notifications and tell me what they are?",
      "Read my notifications",
      "Please show me all my notifications",
      "List current notifications",
      "Jarvis, read my notifications aloud.",
    ])
      expect(isDirectNotificationRequest(text), text).toBe(true);
    for (const text of [
      "Read my WhatsApp notifications",
      "Read notifications from Mumma",
      "Read my notifications and reply to them",
      "How do I read notifications?",
      "Read my notifications and set a timer",
      "Compare my notifications",
    ])
      expect(isDirectNotificationRequest(text), text).toBe(false);
  });
  it("reserves completion review for synthesis and multiple requirements", () => {
    for (const text of [
      "What is the weather here?",
      "Set a timer for five minutes",
      "Open Settings",
      "What is my phone model and Android version?",
      "Read sample.txt and tell me its token and expected count.",
      "Read the file named token and count.txt",
      "Create an image of a cat and dog",
    ])
      expect(isComplexTask(text), text).toBe(false);
    for (const text of [
      "Compare these services",
      "Research notification access",
      "Open Notepad and save the comparison",
      "Check the weather then send it to Mom",
      "Create an image and email it",
      "Open Settings; inspect About phone",
      "First read the file, then summarize it",
    ])
      expect(isComplexTask(text), text).toBe(true);
  });
  it("only bypasses models for a single local weather lookup", () => {
    for (const text of [
      "What is the weather here?",
      "What's the weather like outside?",
      "weather today",
      "Please show me the local weather",
      "Jarvis, how is the weather right now?",
    ])
      expect(isDirectWeatherRequest(text), text).toBe(true);
    for (const text of [
      "What is the weather in Delhi?",
      "Weather and news",
      "What is the weather here and set a timer?",
      "What is the weather here and what should I wear?",
      "Compare today's weather with last week",
      "Tell me the weather; send it to Mom",
      "weather for next week",
    ])
      expect(isDirectWeatherRequest(text), text).toBe(false);
  });
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
