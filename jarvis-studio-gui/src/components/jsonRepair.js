/* Tolerant JSON parsing for model-emitted blocks.
 *
 * Lifted out of ResponseRenderer so the chart renderer can live in its own
 * lazily-loaded chunk without dragging the whole renderer along with it.
 * Behaviour is unchanged - this is a move, not a rewrite.
 */

// LLMs occasionally emit JSON with a dropped closing bracket/brace (e.g. a
// TABLE whose "rows" array is never closed) or get truncated mid-output. This
// rebuilds the string with a type-aware bracket stack, auto-inserting the
// missing closers in the right place. Brackets inside strings are ignored, and
// already-valid JSON passes through unchanged.
export function repairJSON(raw) {
  const stack = [];
  let out = "";
  let inStr = false,
    esc = false;
  const closerFor = { "{": "}", "[": "]" };
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inStr) {
      out += ch;
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      out += ch;
      continue;
    }
    if (ch === "{" || ch === "[") {
      stack.push(ch);
      out += ch;
      continue;
    }
    if (ch === "}" || ch === "]") {
      // Close any inner brackets whose own closer was dropped before this one.
      while (stack.length && closerFor[stack[stack.length - 1]] !== ch) {
        out += closerFor[stack.pop()];
      }
      if (stack.length) {
        stack.pop();
        out += ch;
      } // else: stray closer — drop it
      continue;
    }
    out += ch;
  }
  if (inStr) out += '"'; // close an unterminated string
  while (stack.length) out += closerFor[stack.pop()]; // close anything truncated at the end
  return out;
}

export function parseJSON(raw) {
  const trimmed = raw.trim();
  try {
    return [JSON.parse(trimmed), null];
  } catch (e) {
    try {
      return [JSON.parse(repairJSON(trimmed)), null];
    } catch {
      return [null, e.message];
    } // report the original error
  }
}
