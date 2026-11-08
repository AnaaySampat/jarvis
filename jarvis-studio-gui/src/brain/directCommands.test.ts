import { describe, expect, it } from "vitest";
import { directCommand } from "./directCommands";

describe("unambiguous direct commands", () => {
  it.each([
    ["Set volume to 40%", "set_volume", { level: 40 }],
    ["Please change my media volume to 0 percent.", "set_volume", { level: 0 }],
    ["set a timer for 5 minutes", "set_timer", { seconds: 300 }],
    ["Start timer for 2 hours please!", "set_timer", { seconds: 7200 }],
  ])("parses %s", (input, name, args) => expect(directCommand(input as string)).toMatchObject({ name, args }));
  it.each([
    "set volume to 101", "set volume to -5", "set volume to 4.5", "increase the volume",
    "set volume to 40 and start music", "set volume to 40 on the TV", 'say "set volume to 40"',
    "how do I set volume to 40", "set a timer for 0 minutes", "set a timer for 1.5 hours",
    "set a timer for 1 hour 20 minutes", "set a timer for 9999999 hours", "set a timer for 5 minutes tomorrow",
    "set a timer for 5 minutes and call Mom", "cancel my timer", "set alarm for 7", "set volume to 40?",
  ])("leaves ambiguous or compound input to the model: %s", (input) => expect(directCommand(input)).toBeUndefined());
});
