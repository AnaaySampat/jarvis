import { describe, expect, it } from "vitest";
import { agentResult, modelToolResult } from "./results";

describe("agent handover evaluations", () => {
  it("passes the last finding and artifact to the next model without private tool fields", () => {
    const result = modelToolResult(
      {
        ok: true,
        summary: "Read research",
        data: {
          findings: ["A".repeat(4000), "₹4,210, source https://example.com/flight"],
          artifacts: [
            {
              uri: "content://documents/comparison",
              kind: "document",
              headers: { Authorization: "secret" },
            },
          ],
          headers: { Authorization: "secret" },
        },
      },
      "Read comparison",
      "read_file",
    );
    expect(result.findings.at(-1)).toContain("₹4,210");
    expect(result.artifacts[0]?.uri).toBe("content://documents/comparison");
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("does not call a claimed PC or phone result successful without a receipt", () => {
    for (const tool of ["pc_task", "phone_task"]) {
      expect(agentResult({ ok: true, summary: "Sent!" }, "Send once", tool)).toMatchObject({
        ok: false,
        status: "unverified",
        completed: [],
      });
    }
  });

  it("accepts a native completion receipt and preserves findings", () => {
    const result = agentResult(
      {
        ok: true,
        summary: "Timer running",
        data: {
          findings: ["02:00 counting down"],
          verificationReceipt: `aura.verify.v1:deterministic:${"a".repeat(64)}`,
        },
      },
      "Set timer",
      "phone_task",
    );
    expect(result.status).toBe("succeeded");
    expect(result.evidence).toHaveLength(1);
  });
});
