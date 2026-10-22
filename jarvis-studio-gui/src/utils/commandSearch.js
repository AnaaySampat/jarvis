// Ranking for the command palette (Ctrl+K). Every word of the query has to be found
// in a command's label, group or keywords; a hit at the start of the label ranks
// highest, then the start of any word, then anywhere. Ties keep the list's order.

const norm = (s) => (s || "").toLowerCase();

function wordScore(word, label, rest) {
  if (label.startsWith(word)) return 4;
  if (label.split(/[^a-z0-9]+/).some((w) => w.startsWith(word))) return 3;
  if (label.includes(word)) return 2;
  if (rest.split(/[^a-z0-9]+/).some((w) => w.startsWith(word))) return 1.5;
  if (rest.includes(word)) return 1;
  return 0;
}

export function rankCommands(commands, query) {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return commands;
  const scored = [];
  commands.forEach((c, i) => {
    const label = norm(c.label);
    const rest = norm(`${c.group || ""} ${c.keywords || ""}`);
    let total = 0;
    for (const w of words) {
      const s = wordScore(w, label, rest);
      if (!s) return;
      total += s;
    }
    scored.push([total, i, c]);
  });
  scored.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  return scored.map(([, , c]) => c);
}
