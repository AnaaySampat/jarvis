import { describe, it, expect, beforeEach } from "vitest";
import { liveModelId, recordRemap, clearRemaps, remapEntries } from "./modelRemap";
import { retiredModelReplacement, ProviderError } from "./errorClass";

/** The exact body Google returned on 2026-09-22 when the pinned id was retired. */
const RETIRED_404 = (dead: string, live: string) =>
  new ProviderError(`Gemini ${dead} failed`, {
    status: 404,
    detail: JSON.stringify({
      error: {
        code: 404,
        message:
          `This model models/${dead} is no longer available. ` +
          `Please update your code to use models/${live}`,
        status: "NOT_FOUND",
      },
    }),
  });

describe("retiredModelReplacement", () => {
  it("reads the replacement Google names in its own 404", () => {
    expect(retiredModelReplacement(RETIRED_404("gemini-2.0-flash", "gemini-3.6-flash"))).toBe(
      "gemini-3.6-flash",
    );
    expect(
      retiredModelReplacement(RETIRED_404("gemini-2.0-flash-lite", "gemini-3.5-flash")),
    ).toBe("gemini-3.5-flash");
  });

  it("ignores non-404s and 404s that name no replacement", () => {
    expect(retiredModelReplacement(new ProviderError("nope", { status: 429 }))).toBeNull();
    expect(
      retiredModelReplacement(new ProviderError("gone", { status: 404, detail: "not found" })),
    ).toBeNull();
  });

  it("does not accept a non-Gemini id", () => {
    expect(
      retiredModelReplacement(
        new ProviderError("x", {
          status: 404,
          detail: "is no longer available. Please update your code to use models/evil-thing",
        }),
      ),
    ).toBeNull();
  });
});

describe("model remap table", () => {
  beforeEach(() => clearRemaps());

  it("returns the id unchanged when nothing is remapped", () => {
    expect(liveModelId("gemini-3.6-flash")).toBe("gemini-3.6-flash");
  });

  it("substitutes a recorded replacement", () => {
    recordRemap("gemini-2.0-flash", "gemini-3.6-flash");
    expect(liveModelId("gemini-2.0-flash")).toBe("gemini-3.6-flash");
  });

  it("follows a chain of retirements", () => {
    recordRemap("a-1", "a-2");
    recordRemap("a-2", "a-3");
    expect(liveModelId("a-1")).toBe("a-3");
  });

  it("does not loop forever on a cycle", () => {
    recordRemap("x-1", "x-2");
    recordRemap("x-2", "x-1");
    expect(["x-1", "x-2"]).toContain(liveModelId("x-1"));
  });

  it("ignores a self-map", () => {
    recordRemap("same", "same");
    expect(remapEntries()).toEqual([]);
  });

  it("survives a re-read (persisted, not in-memory only)", () => {
    recordRemap("gemini-2.0-flash", "gemini-3.6-flash");
    expect(remapEntries()).toEqual([["gemini-2.0-flash", "gemini-3.6-flash"]]);
  });
});
