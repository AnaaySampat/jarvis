import { describe, expect, it } from "vitest";
import { diagnosticReport, ecosystemHealth } from "./ecosystemHealth";
import type { NativeHealth } from "./platform";

const native: NativeHealth = {
  ok: true,
  appVersion: "2.5.0",
  sdk: 36,
  permissions: {
    microphone: true,
    calendar: true,
    accessibility: true,
    notifications: true,
    notificationAccess: true,
  },
  batteryExempt: true,
  backgroundRestricted: false,
  wakeListening: true,
  portableBackground: false,
};
describe("Ecosystem Health", () => {
  it("reports permission refusal and revocation independently from pairing and configured keys", () => {
    const ready = ecosystemHealth(native, { has_groq_key: true }, "online");
    expect(ready.find((r) => r.id === "microphone")?.status).toBe("ready");
    const revoked = ecosystemHealth(
      { ...native, permissions: { ...native.permissions, microphone: false } },
      {},
      "offline",
    );
    expect(revoked.find((r) => r.id === "microphone")).toMatchObject({
      status: "attention",
      repair: "app_permissions",
    });
    expect(revoked.find((r) => r.id === "pc")?.status).toBe("attention");
    expect(ready.find((r) => r.id === "providers")?.status).toBe("unknown");
    expect(ready.find((r) => r.id === "google")?.status).toBe("unavailable");
  });
  it("never invents readiness when native access fails or the OS restricts background work", () => {
    expect(ecosystemHealth(null, {}, "idle").find((r) => r.id === "calendar")?.status).toBe(
      "unknown",
    );
    expect(
      ecosystemHealth({ ...native, backgroundRestricted: true }, {}, "offline").find(
        (r) => r.id === "background",
      )?.status,
    ).toBe("attention");
  });
  it("exports only the closed diagnostic projection, including opaque report-local IDs", () => {
    const secret = "SECRET prompt body image path token";
    const report = diagnosticReport(
      ecosystemHealth(native, {}, "offline"),
      [
        {
          status: "suspended",
          metrics: { elapsed_ms: 2400, tool_calls: 2, provider_cost: 42, raw_prompt: secret },
          ...{
            id: secret,
            goal: secret,
            summary: secret,
            proof: secret,
            items: [{ image: secret }],
          },
        },
      ],
      "2.5.0",
      secret,
    );
    expect(JSON.stringify(report)).not.toContain(secret);
    expect(report.tasks[0]).toMatchObject({
      id: "task-1",
      status: "needs_you",
      elapsed_ms: 2400,
      provider_cost: null,
    });
    expect(report.versions.windows).toBe("");
  });
});
