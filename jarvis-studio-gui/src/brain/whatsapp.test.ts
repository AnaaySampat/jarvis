import { describe, expect, it } from "vitest";
import { WA_STALE_MS, whatsappDecision } from "./whatsapp";

describe("whatsappDecision", () => {
  const now = 1_000_000_000;

  it("leaves a command to the PC only while the link to it is up", () => {
    expect(whatsappDecision("pc_off", "online", now, now)).toBe("leave");
    expect(whatsappDecision("pc_off", "offline", now, now)).toBe("run");
    expect(whatsappDecision("pc_off", "idle", now, now)).toBe("run");
    expect(whatsappDecision("always", "online", now, now)).toBe("run");
  });

  it("doesn't run what came in while JARVIS was asleep", () => {
    expect(whatsappDecision("always", "offline", now - WA_STALE_MS - 1, now)).toBe("stale");
    expect(whatsappDecision("always", "offline", now - WA_STALE_MS + 1_000, now)).toBe("run");
    // …unless the PC is there to have answered it.
    expect(whatsappDecision("pc_off", "online", now - WA_STALE_MS - 1, now)).toBe("leave");
  });
});
