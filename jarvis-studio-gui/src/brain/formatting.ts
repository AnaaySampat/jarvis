/**
 * Presentation helpers shared by the chat renderer and text-to-speech.
 *
 * The model is allowed to use normal Markdown for a readable transcript, but a
 * speech engine should receive the words, not Markdown punctuation. Keeping the
 * parsing here means the visible and spoken versions cannot drift apart.
 */

export type InlineMarkdownSegment =
  | { kind: "text"; content: string }
  | { kind: "bold"; content: string }
  | { kind: "boldItalic"; content: string };

/**
 * Split the small, safe Markdown subset that JARVIS renders inline. We only need
 * emphasis here; structured [CHART]/[TABLE] blocks are handled by
 * ResponseRenderer itself. No HTML is ever interpreted.
 */
export function inlineMarkdownSegments(text: string): InlineMarkdownSegment[] {
  const source = text ?? "";
  const out: InlineMarkdownSegment[] = [];
  // Long markers must come first: otherwise ***important*** would be parsed as
  // ** + *important rather than bold+italic text.
  const emphasis = /(\*\*\*|___|\*\*|__)(?=\S)([\s\S]*?\S)\1/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = emphasis.exec(source)) !== null) {
    if (match.index > cursor)
      out.push({ kind: "text", content: source.slice(cursor, match.index) });
    const marker = match[1];
    out.push({
      kind: marker.length === 3 ? "boldItalic" : "bold",
      content: match[2],
    });
    cursor = match.index + match[0].length;
  }

  if (cursor < source.length) out.push({ kind: "text", content: source.slice(cursor) });
  return out.length ? out : [{ kind: "text", content: source }];
}

export type TextBlock =
  { kind: "text"; content: string } | { kind: "table"; header: string[]; rows: string[][] };

const TABLE_DIVIDER = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

/** One pipe-table row's cells; `\|` is a literal pipe inside a cell. */
function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));
}

/**
 * Split GitHub-style pipe tables (a header row, a `|---|:--:|` divider, body rows) out of
 * a reply. Models write them for any comparison, and shown raw they were rows of pipes.
 */
export function splitMarkdownTables(text: string): TextBlock[] {
  const lines = (text ?? "").split("\n");
  const out: TextBlock[] = [];
  let prose: string[] = [];
  const flush = () => {
    const content = prose.join("\n").trim();
    if (content) out.push({ kind: "text", content });
    prose = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const divider = lines[i + 1];
    if (
      !line.includes("|") ||
      divider === undefined ||
      !divider.includes("|") ||
      !TABLE_DIVIDER.test(divider)
    ) {
      prose.push(line);
      continue;
    }
    const header = tableCells(line);
    const rows: string[][] = [];
    for (i += 2; i < lines.length && lines[i]!.includes("|") && lines[i]!.trim(); i++) {
      // Every row as wide as the header, so a short row doesn't shift its neighbours.
      const cells = tableCells(lines[i]!);
      rows.push(header.map((_, c) => cells[c] ?? ""));
    }
    i--;
    flush();
    out.push({ kind: "table", header, rows });
  }
  flush();
  return out.length ? out : [{ kind: "text", content: text ?? "" }];
}

/** Remove common Markdown decoration before sending a reply to TTS. */
export function stripMarkdownForSpeech(text: string): string {
  // A table is read row by row, its cells separated by pauses rather than "vertical bar".
  let spoken = splitMarkdownTables(text ?? "")
    .map((b) =>
      b.kind === "text" ? b.content : [b.header, ...b.rows].map((r) => r.join(", ")).join(".\n"),
    )
    .join("\n");

  // Say a link's useful label, never its punctuation or URL. Images work the
  // same way: their alt text is the only spoken portion.
  spoken = spoken
    .replace(/!\[([^\]]*)\]\([^\s)]+(?:\s+[^)]*)?\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^\s)]+(?:\s+[^)]*)?\)/g, "$1")
    .replace(/\x60{1,3}([^\x60]+)\x60{1,3}/g, "$1")
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^(\s*)[-+]\s+/gm, "$1")
    .replace(/^(\s*)\d+[.)]\s+/gm, "$1");

  // Markdown bold/italic markers are formatting, not words. Run the longest
  // marker first so ***bold*** is consumed as one unit. The single-marker cases
  // deliberately require paired markers, preserving genuine arithmetic symbols.
  for (const marker of ["***", "___", "**", "__", "*", "_"]) {
    const escaped = marker.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
    const re = new RegExp("(^|[^\\w\\\\])" + escaped + "(?=\\S)([\\s\\S]*?\\S)" + escaped, "gm");
    spoken = spoken.replace(re, "$1$2");
  }

  return spoken
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
