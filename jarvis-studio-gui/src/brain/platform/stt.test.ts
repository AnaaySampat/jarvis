import { describe, expect, it } from "vitest";
import { isNoiseTranscript } from "./stt";

describe("isNoiseTranscript", () => {
  it("screens an echo of the Whisper prompt", () => {
    expect(isNoiseTranscript("A voice command for a phone assistant.")).toBe(true);
    expect(isNoiseTranscript("open YouTube")).toBe(false);
  });
});
