import { afterEach, describe, expect, it, vi } from "vitest";
import { isNoiseTranscript, transcribe } from "./stt";

describe("isNoiseTranscript", () => {
  it("screens an echo of the Whisper prompt", () => {
    expect(isNoiseTranscript("A voice command for a phone assistant.")).toBe(true);
    expect(isNoiseTranscript("open YouTube")).toBe(false);
  });
});

afterEach(() => vi.unstubAllGlobals());

it("transcribes with the first of several pasted Groq keys", async () => {
  const auth: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      auth.push((init?.headers as Record<string, string>).Authorization);
      return new Response(JSON.stringify({ text: "open youtube" }));
    }),
  );
  expect(await transcribe(new Blob(["x"]), { groqKey: "gsk_first\ngsk_second" })).toBe(
    "open youtube",
  );
  expect(auth).toEqual(["Bearer gsk_first"]);
});
