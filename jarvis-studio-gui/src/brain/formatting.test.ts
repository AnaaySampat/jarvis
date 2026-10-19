import { describe, expect, it } from "vitest";
import { inlineMarkdownSegments, splitMarkdownTables, stripMarkdownForSpeech } from "./formatting";

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

  it("splits Markdown pipe tables out of a reply", () => {
    const reply =
      "Here you go:\n\n| Phone | Price |\n|:---|---:|\n| **Pixel** | $499 |\n| Galaxy \\| S | $799 | extra |\n| Nokia |\n\nCheapest is the Pixel.";
    expect(splitMarkdownTables(reply)).toEqual([
      { kind: "text", content: "Here you go:" },
      {
        kind: "table",
        header: ["Phone", "Price"],
        rows: [
          ["**Pixel**", "$499"],
          ["Galaxy | S", "$799"],
          ["Nokia", ""],
        ],
      },
      { kind: "text", content: "Cheapest is the Pixel." },
    ]);
    // A lone pipe or a rule is not a table.
    expect(splitMarkdownTables("a | b\nnext line")).toEqual([
      { kind: "text", content: "a | b\nnext line" },
    ]);
    expect(splitMarkdownTables("Intro\n---\nmore")[0]!.kind).toBe("text");
  });

  it("reads a table aloud row by row, without pipes", () => {
    expect(stripMarkdownForSpeech("| Day | Temp |\n|---|---|\n| Mon | 20 |")).toBe(
      "Day, Temp.\nMon, 20",
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
