import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const WORKFLOWS = ["phone_action", "saved_reminder", "sourced_research", "pc_handover", "routine_steps"];
export const REQUIRED_CHECKS = ["android_typecheck", "android_lint", "android_tests", "kotlin_tests", "apk_build", "persistence_migration", "windows_frontend", "windows_rust", "windows_backend", "protocol_fixtures", "upgrade_preservation", "permission_lifecycle", "tv_smoke", "whatsapp_smoke"];

/** Only measured live runs count. Scripted regressions cannot promote a release. */
export function evaluateFoundationGate(evidence) {
  const reasons = [];
  const build = evidence?.build_id;
  if (typeof build !== "string" || !build.trim()) reasons.push("Identify the exact candidate build.");
  const runs = Array.isArray(evidence?.runs) ? evidence.runs : [];
  const unique = new Set();
  const live = [];
  for (const run of runs) {
    if (!run || typeof run.id !== "string" || !run.id || unique.has(run.id)) {
      reasons.push("Run identifiers must be present and unique.");
      continue;
    }
    unique.add(run.id);
    if (run.kind !== "live" || run.build_id !== build || !WORKFLOWS.includes(run.workflow)) {
      reasons.push("Every submitted run must be live, supported and from the candidate build.");
      continue;
    }
    if (!Number.isFinite(run.acknowledgement_ms) || run.acknowledgement_ms < 0 || !["completed", "partial", "failed", "cancelled"].includes(run.outcome)) {
      reasons.push("Every run needs an outcome and a measured acknowledgement time.");
      continue;
    }
    if (![run.elapsed_ms, run.tool_count, run.intervention_count].every((value) => Number.isFinite(value) && value >= 0) || !["phone", "windows"].includes(run.executor) || !["none", "provider", "permission", "connection", "verification", "storage", "unsupported", "cancelled"].includes(run.failure_category)) {
      reasons.push("Each live run needs elapsed time, tool/intervention counts, executor and failure category.");
    }
    for (const key of ["duplicate_external_action", "unauthorized_action", "data_loss", "false_success"]) {
      if (run[key] !== false) reasons.push(`Zero ${key} incidents must be confirmed for every run.`);
    }
    live.push(run);
  }
  const completed = (run) => run.outcome === "completed" && run.verified === true;
  if (live.length < 100) reasons.push(`Record at least 100 live runs (${live.length} recorded).`);
  const overall = live.length ? live.filter(completed).length / live.length : 0;
  if (overall < 0.95) reasons.push("Overall verified completion is below 95%.");
  for (const workflow of WORKFLOWS) {
    const group = live.filter((run) => run.workflow === workflow);
    if (!group.length || group.filter(completed).length / group.length < 0.9) reasons.push(`${workflow} needs live evidence with at least 90% verified completion.`);
  }
  if (!live.length || live.filter((run) => run.acknowledgement_ms <= 2000).length / live.length < 0.95) reasons.push("At least 95% of acknowledgements must be within two seconds.");
  const stops = Array.isArray(evidence?.stops) ? evidence.stops : [];
  if (!stops.length || stops.some((stop) => stop.build_id !== build || !Number.isFinite(stop.dispatch_stopped_ms) || stop.dispatch_stopped_ms < 0 || stop.dispatch_stopped_ms > 2000 || stop.started_actions_reconciled !== true)) reasons.push("STOP needs measured two-second dispatch cessation and reconciliation evidence.");
  const devices = Array.isArray(evidence?.devices) ? evidence.devices : [];
  for (const role of ["samsung_phone", "windows_pc"]) {
    if (!devices.some((device) => device.role === role && device.build_id === build && device.acceptance_passed === true)) reasons.push(`Missing ${role} acceptance.`);
  }
  const checks = evidence?.checks ?? {};
  for (const check of REQUIRED_CHECKS) {
    if (checks[check]?.passed !== true || checks[check]?.build_id !== build) reasons.push(`Missing passing ${check} check for this build.`);
  }
  const battery = Array.isArray(evidence?.battery) ? evidence.battery : [];
  for (const enabled of [true, false]) {
    const sample = battery.find((entry) => entry.wake_word === enabled && entry.build_id === build);
    if (!sample || sample.hours !== 8 || sample.baseline_hours !== 8 || typeof sample.device_id !== "string" || sample.device_id !== sample.baseline_device_id || !Number.isFinite(sample.drain_pct) || !Number.isFinite(sample.baseline_drain_pct) || sample.drain_pct < 0 || sample.drain_pct > 100 || sample.baseline_drain_pct < 0 || sample.baseline_drain_pct > 100 || sample.drain_pct - sample.baseline_drain_pct > 1) reasons.push(`Missing matched eight-hour battery evidence with wake word ${enabled ? "enabled" : "disabled"}, or regression exceeds one point.`);
  }
  const passed = reasons.length === 0;
  return { passed, live_runs: live.length, completion_rate: overall, expanded_beta_ready: passed && devices.some((device) => device.role === "second_android" && device.build_id === build && device.acceptance_passed === true), reasons: [...new Set(reasons)] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2] || new URL("../docs/acceptance/foundation-evidence.json", import.meta.url);
  const result = evaluateFoundationGate(JSON.parse(readFileSync(path, "utf8")));
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.passed ? 0 : 1;
}
