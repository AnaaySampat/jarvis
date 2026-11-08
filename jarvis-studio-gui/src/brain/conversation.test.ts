import { describe, expect, it } from "vitest";
import type { ChatMessage } from "./types";
import { conversationObjective } from "./conversation";

const objective = "Open Settings and freshly read both IMEI numbers from the phone screen";
const blocked = "I couldn't finish. (failed) Call request_tool_access for this tool, then enable JARVIS in Android Accessibility settings. Still unconfirmed: read both IMEI numbers.";
const messages = (reply: string, followup = "Done"): ChatMessage[] => [
  { role: "user", content: objective }, { role: "assistant", content: reply },
  { role: "user", content: followup },
];

describe("conversation objective", () => {
  it.each(["Done", "It is enabled", "The accessibility is done"])(
    "retains the unstarted request after setup acknowledgment %s", (followup) => {
      expect(conversationObjective(messages(blocked, followup))).toBe(objective);
    },
  );
  it("recognizes the stopped Accessibility service response", () => {
    expect(conversationObjective(messages("I can't control your phone, and I haven't done anything. Turn JARVIS off and on again in Accessibility, then ask again."))).toBe(objective);
  });
  it.each([
    "Both IMEI numbers were read and reported.",
    "The message may already have been sent. Enable Accessibility and check the phone before retrying. Not run again.",
    "Not run again. The outcome is unknown. Enable permission before another request.",
    "Not run again; the message was already sent. Enable Accessibility.",
    "I'm ready when you are.",
  ])("does not resume completed, uncertain or unrelated work: %s", (reply) => {
    expect(conversationObjective(messages(reply))).toBe("Done");
  });
  it("does not turn thanks or a new task into a continuation", () => {
    expect(conversationObjective(messages(blocked, "Thanks"))).toBe("Thanks");
    expect(conversationObjective(messages(blocked, "Accessibility"))).toBe("Accessibility");
    expect(conversationObjective(messages(blocked, "Now check the weather"))).toBe("Now check the weather");
  });
  it("uses only the supplied conversation, without searching older unrelated requests", () => {
    expect(conversationObjective([{ role: "user", content: "Done" }])).toBe("Done");
    expect(conversationObjective([...messages(blocked), { role: "assistant", content: "No action ran. Enable Accessibility first." }, { role: "user", content: "Done" }])).toBe(objective);
  });
});
