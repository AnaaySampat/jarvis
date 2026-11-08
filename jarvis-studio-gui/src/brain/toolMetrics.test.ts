import { expect, it } from "vitest";
import { count, newMetrics, toolPerformance } from "./toolMetrics";
import { diagnosticReport } from "./ecosystemHealth";

it("reports only instrumented tool work, with actual counts and no fabricated selection accuracy", () => {
  const metrics = newMetrics();
  count(metrics, "model_requests", 3);
  count(metrics, "duplicates_prevented");
  count(metrics, "choosing_ms", 25);
  const aggregate = toolPerformance([
    { source: "workflow", hasWork: true, status: "succeeded", metrics },
    { source: "workflow", hasWork: false, status: "succeeded", metrics },
    { source: "phone", hasWork: true, status: "succeeded", metrics },
    { source: "workflow", hasWork: true, status: "running", metrics },
    { source: "workflow", hasWork: true, status: "failed" },
  ]);
  expect(aggregate).toMatchObject({ tasks: 1, verified: 1, requests: 3, duplicates: 1, choosing_ms: 25 });
  expect(aggregate).not.toHaveProperty("selection_accuracy");
});
it("exports only finite numeric allowlisted metrics, never payloads or provider identifiers", () => {
  const secret = "private prompt or provider key";
  const report = diagnosticReport([], [{ status: "suspended", metrics: {
    ...newMetrics(), choosing_ms: 15, executing_ms: 37, verifying_ms: Infinity,
    fallbacks: 2, model_requests: 3, provider: secret, prompt: secret, route: secret,
  } }], "2.5.6", "");
  expect(report.tasks[0]).toMatchObject({ choosing_ms: 15, executing_ms: 37, fallbacks: 2, model_requests: 3 });
  expect(JSON.stringify(report)).not.toContain(secret);
  expect(report.tasks[0].provider_cost).toBeNull();
});
