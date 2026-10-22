import { describe, expect, it } from "vitest";
import { rankCommands } from "./commandSearch";

const CMDS = [
  { id: "chat", label: "Open conversation", group: "Panels", keywords: "chat talk messages" },
  {
    id: "keys",
    label: "Settings: API Keys",
    group: "Settings",
    keywords: "groq gemini credentials",
  },
  { id: "mute", label: "Mute JARVIS", group: "Voice", keywords: "silence speech" },
  { id: "shot", label: "Take a screenshot", group: "Tools", keywords: "capture screen" },
  { id: "rec", label: "Start screen recording", group: "Tools", keywords: "capture video" },
];
const ids = (q: string) => rankCommands(CMDS, q).map((c) => c.id);

describe("rankCommands", () => {
  it("keeps the list as it is for an empty query", () => {
    expect(ids("  ")).toEqual(["chat", "keys", "mute", "shot", "rec"]);
  });

  it("finds a command by a keyword that isn't in its label", () => {
    expect(ids("groq")).toEqual(["keys"]);
    expect(ids("chat")).toEqual(["chat"]);
  });

  it("needs every word of the query to match", () => {
    expect(ids("screen record")).toEqual(["rec"]);
    expect(ids("mute nothing-like-this")).toEqual([]);
  });

  it("ranks a hit at the start of the label above one inside it", () => {
    // "screen…" starts a word in "Take a screenshot" and "Start screen recording";
    // "capture" is only a keyword for both, so the label hits decide the order.
    expect(ids("scr")).toEqual(["shot", "rec"]);
    expect(ids("start")).toEqual(["rec"]);
    expect(ids("s")[0]).toBe("keys"); // "Settings: …" starts with it
  });
});
