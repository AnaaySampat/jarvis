import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateFoundationGate, REQUIRED_CHECKS, WORKFLOWS } from "./foundation-gate.mjs";

function candidate() {
  const build_id = "test-fixture-only";
  return {
    build_id,
    runs: Array.from({ length: 100 }, (_, i) => ({ id: `fixture-${i}`, build_id, kind: "live", workflow: WORKFLOWS[i % 5], outcome: "completed", verified: true, acknowledgement_ms: 100, elapsed_ms: 500, tool_count: 1, intervention_count: 0, executor: "phone", failure_category: "none", provider_cost: null, duplicate_external_action: false, unauthorized_action: false, data_loss: false, false_success: false })),
    checks: Object.fromEntries(REQUIRED_CHECKS.map((name) => [name, { build_id, passed: true }])),
    stops: [{ build_id, dispatch_stopped_ms: 100, started_actions_reconciled: true }],
    devices: ["samsung_phone", "windows_pc"].map((role) => ({ role, build_id, acceptance_passed: true })),
    battery: [true, false].map((wake_word) => ({ build_id, wake_word, device_id: "fixture", baseline_device_id: "fixture", hours: 8, baseline_hours: 8, drain_pct: 3, baseline_drain_pct: 2 })),
  };
}
test("empty evidence cannot open the foundation gate", () => { assert.equal(evaluateFoundationGate({}).passed, false); });
test("threshold fixture passes but expanded beta requires a second Android", () => {
  const result = evaluateFoundationGate(candidate());
  assert.equal(result.passed, true);
  assert.equal(result.expanded_beta_ready, false);
});
test("one unsafe action, duplicate evidence, scripted runs and stale checks each block promotion", () => {
  for (const mutate of [
    (data) => { data.runs[0].duplicate_external_action = true; },
    (data) => { data.runs[1].id = data.runs[0].id; },
    (data) => { data.runs[0].kind = "scripted"; },
    (data) => { data.checks.apk_build.build_id = "old"; },
    (data) => { data.battery[0].drain_pct = 3.01; },
    (data) => { data.stops[0].dispatch_stopped_ms = 2001; },
    (data) => { data.runs.slice(0, 6).forEach((run) => { run.acknowledgement_ms = 2001; }); },
    (data) => { data.runs.filter((run) => run.workflow === WORKFLOWS[0]).slice(0, 3).forEach((run) => { run.verified = false; }); },
  ]) {
    const data = candidate(); mutate(data);
    assert.equal(evaluateFoundationGate(data).passed, false);
  }
});
