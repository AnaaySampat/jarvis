import { describe, expect, it } from "vitest";
import { inlineMarkdownSegments, stripMarkdownForSpeech } from "./formatting";

describe("reply formatting", () => {
  it("turns paired Markdown emphasis into plain speech", () => {
    expect(stripMarkdownForSpeech("That is **very important**, sir.")).toBe(
      "That is very important, sir.",
    );
    expect(stripMarkdownForSpeech("***Absolutely*** ready.")).toBe("Absolutely ready.");
  });

  it("keeps the readable words while removing other common Markdown decoration", () => {
    expect(stripMarkdownForSpeech("# Status\n- Read the [report](https://example.com)")).toBe(
      "Status\nRead the report",
    );
  });

  it("exposes bold segments for the safe React renderer", () => {
    expect(inlineMarkdownSegments("Use **this** setting.")).toEqual([
      { kind: "text", content: "Use " },
      { kind: "bold", content: "this" },
      { kind: "text", content: " setting." },
    ]);
  });
});
