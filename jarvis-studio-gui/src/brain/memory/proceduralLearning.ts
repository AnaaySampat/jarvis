/**
 * Durable verified procedural learning.
 *
 * Chat-taught prose is reference-only. Executable workflows enter this store
 * through the typed candidate API and need three independent deterministic
 * receipts before they are exposed to either prompt matching or execution.
 */

import { makeKV, readJson, writeJson } from "./store";
import {
  PLAYBOOK_SCHEMA_VERSION,
  REQUIRED_VERIFIED_SUCCESSES,
  type Playbook,
  type WorkflowCandidate,
  type WorkflowDrift,
  type WorkflowEnvironment,
  type WorkflowFailure,
  type WorkflowMutationResult,
  type WorkflowSuccessHistory,
  type WorkflowSuccessReceipt,
} from "./proceduralTypes";
import {
  appMatches,
  clone,
  isRecordId,
  objectOf,
  qualifyingSuccesses,
  safeReference,
  validateWorkflow,
  validSuccess,
} from "./proceduralValidation";

export * from "./proceduralTypes";
export { validateWorkflow } from "./proceduralValidation";

const KEY = "jarvis.android.playbooks.v2";
const LEGACY_KEY = "jarvis.android.playbooks.v1";
// Superseded operator caches could contain raw accessibility indexes, typed text,
// targets and screen-derived traces. Nothing in production consumes them now.
const UNSAFE_REPLAY_KEYS = ["jarvis_phone_playbooks", "jarvis_phone_workflows_v2"];
const kv = makeKV();
let idCounter = 0;

function newWorkflowId(): string {
  idCounter += 1;
  return `wf_${Date.now().toString(36)}_${idCounter.toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function makeDraft(
  name: string,
  steps: string,
  triggers: string[],
  existing?: Playbook,
): Playbook {
  const timestamp = Date.now();
  const reference = safeReference(steps);
  return {
    schemaVersion: PLAYBOOK_SCHEMA_VERSION,
    workflowId: existing?.workflowId || newWorkflowId(),
    revision: (existing?.revision || 0) + 1,
    name: name.slice(0, 80),
    triggers: triggers.map((value) => value.slice(0, 100)).slice(0, 12),
    status: "draft",
    enabled: false,
    app: null,
    parameters: [],
    preconditions: [],
    procedure: [],
    risk: "R1",
    idempotency: "verify_before_retry",
    successHistory: existing?.successHistory || [],
    failureHistory: existing?.failureHistory || [],
    driftHistory: existing?.driftHistory || [],
    disabledReason:
      "Raw prose is reference-only; a typed workflow needs three verified successes.",
    savedAt: existing?.savedAt || timestamp,
    updatedAt: timestamp,
    steps: reference,
    reference: { format: "legacy_prose", text: reference },
  };
}

function normalizeV2(value: unknown): Playbook | null {
  const row = objectOf(value);
  if (
    !row ||
    row.schemaVersion !== PLAYBOOK_SCHEMA_VERSION ||
    typeof row.name !== "string" ||
    typeof row.workflowId !== "string"
  ) {
    return null;
  }
  const workflow = clone(row) as unknown as Playbook;
  workflow.triggers = Array.isArray(workflow.triggers)
    ? workflow.triggers.filter((item): item is string => typeof item === "string")
    : [];
  workflow.parameters = Array.isArray(workflow.parameters) ? workflow.parameters : [];
  workflow.preconditions = Array.isArray(workflow.preconditions) ? workflow.preconditions : [];
  workflow.procedure = Array.isArray(workflow.procedure) ? workflow.procedure : [];
  workflow.successHistory = Array.isArray(workflow.successHistory)
    ? workflow.successHistory
    : [];
  workflow.failureHistory = Array.isArray(workflow.failureHistory)
    ? workflow.failureHistory
    : [];
  workflow.driftHistory = Array.isArray(workflow.driftHistory) ? workflow.driftHistory : [];

  if (workflow.status === "draft" && workflow.reference?.format === "legacy_prose") {
    const reference = safeReference(
      typeof workflow.reference.text === "string"
        ? workflow.reference.text
        : typeof workflow.steps === "string"
          ? workflow.steps
          : "",
    );
    workflow.status = "draft";
    workflow.enabled = false;
    workflow.app = null;
    workflow.parameters = [];
    workflow.preconditions = [];
    workflow.procedure = [];
    workflow.steps = reference;
    workflow.reference = { format: "legacy_prose", text: reference };
    return workflow;
  }

  // Typed workflows never retain a prose fallback.
  workflow.steps = "";
  delete workflow.reference;
  const validation = validateWorkflow(workflow);
  if (!validation.ok) {
    workflow.status = "disabled";
    workflow.enabled = false;
    workflow.disabledReason = `Schema validation failed: ${validation.errors.join("; ")}`;
    return workflow;
  }
  const enoughEvidence =
    qualifyingSuccesses(workflow).length >= REQUIRED_VERIFIED_SUCCESSES;
  if (workflow.status === "promoted" && enoughEvidence) {
    workflow.enabled = true;
  } else if (workflow.status !== "disabled") {
    workflow.status = "candidate";
    workflow.enabled = false;
  }
  return workflow;
}

function save(playbooks: Playbook[]): void {
  writeJson(kv, KEY, playbooks);
}

function load(): Playbook[] {
  // Run on every read, not only when a workflow is saved, so an upgraded install
  // cannot retain captured content indefinitely if the user never teaches again.
  for (const key of UNSAFE_REPLAY_KEYS) {
    try {
      kv.remove(key);
    } catch {
      // Storage may be unavailable, but no replay path is enabled in that case.
    }
  }
  const rawV2 = readJson<unknown>(kv, KEY, []);
  const playbooks = (Array.isArray(rawV2) ? rawV2 : [])
    .map(normalizeV2)
    .filter((item): item is Playbook => Boolean(item));

  // One-way migration. The legacy key is always removed, including when corrupt,
  // so raw steps and secrets cannot linger in their original storage location.
  if (kv.get(LEGACY_KEY) !== null) {
    const rawLegacy = readJson<unknown>(kv, LEGACY_KEY, []);
    if (Array.isArray(rawLegacy)) {
      for (const raw of rawLegacy) {
        const row = objectOf(raw);
        const name = typeof row?.name === "string" ? row.name.trim() : "";
        const steps = typeof row?.steps === "string" ? row.steps.trim() : "";
        if (
          !name ||
          !steps ||
          playbooks.some((item) => item.name.toLowerCase() === name.toLowerCase())
        ) {
          continue;
        }
        const triggers = Array.isArray(row?.triggers)
          ? row.triggers.filter((item): item is string => typeof item === "string")
          : [];
        playbooks.push(makeDraft(name, steps, triggers));
      }
    }
    save(playbooks);
    kv.remove(LEGACY_KEY);
  }
  return playbooks;
}

export function listPlaybooks(): Playbook[] {
  return clone(load());
}

/** Compatibility API: prose is saved only as a disabled, redacted reference. */
export function addPlaybook(
  name: string,
  steps: string,
  triggersCsv: string,
): WorkflowMutationResult {
  const cleanName = name.trim();
  const cleanSteps = steps.trim();
  if (!cleanName || !cleanSteps) {
    return { ok: false, summary: "I need both a name and the steps to save a playbook." };
  }
  const playbooks = load();
  const existing = playbooks.find(
    (item) => item.name.toLowerCase() === cleanName.toLowerCase(),
  );
  if (existing && existing.status !== "draft") {
    return {
      ok: false,
      summary:
        "A typed workflow already uses that name; remove it explicitly before replacing it.",
    };
  }
  const draft = makeDraft(
    cleanName,
    cleanSteps,
    triggersCsv
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    existing,
  );
  save([...playbooks.filter((item) => item.workflowId !== draft.workflowId), draft]);
  return {
    ok: true,
    summary: `Saved “${cleanName}” as a disabled reference. It cannot run until a typed version has three independently verified successes.`,
    workflow: clone(draft),
    promoted: false,
  };
}

export function registerWorkflowCandidate(
  candidate: WorkflowCandidate,
): WorkflowMutationResult {
  const playbooks = load();
  const cleanName = String(candidate?.name || "").trim();
  const existing = playbooks.find(
    (item) => item.name.toLowerCase() === cleanName.toLowerCase(),
  );
  const timestamp = Date.now();
  const workflow: Playbook = {
    schemaVersion: PLAYBOOK_SCHEMA_VERSION,
    workflowId: existing?.workflowId || newWorkflowId(),
    revision: (existing?.revision || 0) + 1,
    name: cleanName,
    triggers: Array.isArray(candidate?.triggers) ? clone(candidate.triggers) : [],
    status: "candidate",
    enabled: false,
    app: candidate?.app ? clone(candidate.app) : null,
    parameters: Array.isArray(candidate?.parameters) ? clone(candidate.parameters) : [],
    preconditions: Array.isArray(candidate?.preconditions)
      ? clone(candidate.preconditions)
      : [],
    procedure: Array.isArray(candidate?.procedure) ? clone(candidate.procedure) : [],
    risk: candidate?.risk,
    idempotency: candidate?.idempotency,
    successHistory: existing?.successHistory || [],
    failureHistory: existing?.failureHistory || [],
    driftHistory: existing?.driftHistory || [],
    savedAt: existing?.savedAt || timestamp,
    updatedAt: timestamp,
    steps: "",
  };
  const validation = validateWorkflow(workflow);
  if (!validation.ok) {
    return {
      ok: false,
      summary: `Workflow rejected: ${validation.errors.join("; ")}`,
    };
  }
  save([
    ...playbooks.filter((item) => item.workflowId !== workflow.workflowId),
    workflow,
  ]);
  return {
    ok: true,
    summary: `Registered “${workflow.name}” as candidate revision ${workflow.revision}.`,
    workflow: clone(workflow),
    promoted: false,
  };
}

export function recordVerifiedWorkflowSuccess(
  workflowId: string,
  receipt: WorkflowSuccessReceipt,
): WorkflowMutationResult {
  const playbooks = load();
  const workflow = playbooks.find((item) => item.workflowId === workflowId);
  if (!workflow || workflow.status === "draft") {
    return { ok: false, summary: "Workflow candidate not found." };
  }
  if (workflow.status === "disabled" || !validateWorkflow(workflow).ok) {
    return {
      ok: false,
      summary: "Disabled or invalid workflows cannot collect success evidence.",
    };
  }
  const stored: WorkflowSuccessHistory = {
    ...clone(receipt),
    workflowRevision: receipt.workflowRevision ?? workflow.revision,
    verifiedAt: receipt.verifiedAt || Date.now(),
  };
  if (!validSuccess(workflow, stored)) {
    return {
      ok: false,
      summary: "Success receipt failed independent deterministic verification.",
    };
  }
  if (
    workflow.successHistory.some(
      (item) => item.runId === stored.runId || item.proofDigest === stored.proofDigest,
    )
  ) {
    return { ok: false, summary: "Duplicate success evidence was ignored." };
  }
  workflow.successHistory.push(stored);
  workflow.successHistory = workflow.successHistory.slice(-100);
  const verified = qualifyingSuccesses(workflow).length;
  const promoted = verified >= REQUIRED_VERIFIED_SUCCESSES;
  workflow.status = promoted ? "promoted" : "candidate";
  workflow.enabled = promoted;
  workflow.disabledReason = undefined;
  workflow.updatedAt = Date.now();
  save(playbooks);
  return {
    ok: true,
    summary: promoted
      ? `Promoted “${workflow.name}” after ${verified} independently verified successes.`
      : `Recorded verified success ${verified}/${REQUIRED_VERIFIED_SUCCESSES} for “${workflow.name}”.`,
    workflow: clone(workflow),
    promoted,
  };
}

export function recordWorkflowFailure(
  workflowId: string,
  failure: WorkflowFailure,
): WorkflowMutationResult {
  const playbooks = load();
  const workflow = playbooks.find((item) => item.workflowId === workflowId);
  if (
    !workflow ||
    !isRecordId(failure.runId || "") ||
    !["execution_failed", "postcondition_failed", "cancelled"].includes(failure.kind)
  ) {
    return { ok: false, summary: "Invalid workflow failure record." };
  }
  workflow.failureHistory.push({
    runId: failure.runId,
    workflowRevision: workflow.revision,
    kind: failure.kind,
    reason: String(failure.reason || "unspecified failure").slice(0, 300),
    failedAt: failure.failedAt || Date.now(),
  });
  workflow.failureHistory = workflow.failureHistory.slice(-100);
  if (failure.kind === "postcondition_failed") {
    workflow.status = "disabled";
    workflow.enabled = false;
    workflow.disabledReason =
      "A deterministic postcondition failed; review and retrain this workflow.";
  }
  workflow.updatedAt = Date.now();
  save(playbooks);
  return {
    ok: true,
    summary:
      failure.kind === "postcondition_failed"
        ? `Disabled “${workflow.name}” after a failed postcondition.`
        : "Recorded the workflow failure.",
    workflow: clone(workflow),
    promoted: false,
  };
}

export function recordWorkflowDrift(
  workflowId: string,
  drift: WorkflowDrift,
): WorkflowMutationResult {
  const playbooks = load();
  const workflow = playbooks.find((item) => item.workflowId === workflowId);
  if (
    !workflow ||
    !isRecordId(drift.runId || "") ||
    !["selector_missing", "selector_ambiguous", "app_version_changed", "ui_drift"].includes(
      drift.reason,
    )
  ) {
    return { ok: false, summary: "Invalid workflow drift record." };
  }
  workflow.driftHistory.push({
    runId: drift.runId,
    workflowRevision: workflow.revision,
    reason: drift.reason,
    detail: String(drift.detail || "UI drift detected").slice(0, 300),
    detectedAt: drift.detectedAt || Date.now(),
  });
  workflow.driftHistory = workflow.driftHistory.slice(-100);
  workflow.status = "disabled";
  workflow.enabled = false;
  workflow.disabledReason =
    "Stable selectors or app constraints drifted; review and retrain this workflow.";
  workflow.updatedAt = Date.now();
  save(playbooks);
  return {
    ok: true,
    summary: `Disabled “${workflow.name}” after UI drift.`,
    workflow: clone(workflow),
    promoted: false,
  };
}

export function getPromotedWorkflow(
  nameTriggerOrId: string,
  environment: WorkflowEnvironment,
): Playbook | null {
  const query = nameTriggerOrId.trim().toLowerCase();
  if (!query) return null;
  const workflow = load().find(
    (item) =>
      item.workflowId.toLowerCase() === query ||
      item.name.toLowerCase() === query ||
      item.triggers.some((trigger) => trigger.toLowerCase() === query),
  );
  if (
    !workflow ||
    workflow.status !== "promoted" ||
    !workflow.enabled ||
    !workflow.app ||
    !validateWorkflow(workflow).ok ||
    qualifyingSuccesses(workflow).length < REQUIRED_VERIFIED_SUCCESSES ||
    !appMatches(workflow.app, environment)
  ) {
    return null;
  }
  return clone(workflow);
}

export function removePlaybook(nameOrQuery: string): WorkflowMutationResult {
  const query = nameOrQuery.trim().toLowerCase();
  if (!query) return { ok: false, summary: "Which playbook should I forget?" };
  const playbooks = load();
  // Exact name wins. Otherwise a substring match is only acted on when it is
  // UNAMBIGUOUS: this used to filter out every playbook whose name contained the
  // query and still report the singular "Forgot the playbook.", so "forget the
  // meeting playbook" silently deleted both "morning meeting setup" and "team
  // meeting notes" — including a promoted workflow whose verified receipts cannot
  // be recovered.
  const exact = playbooks.filter((item) => item.name.toLowerCase() === query);
  const matches = exact.length ? exact : playbooks.filter((i) => i.name.toLowerCase().includes(query));

  if (!matches.length) {
    return {
      ok: false,
      summary: `I don't have a playbook matching “${nameOrQuery}”.`,
    };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      summary:
        `“${nameOrQuery}” matches ${matches.length} playbooks (${matches
          .map((i) => `“${i.name}”`)
          .join(", ")}). Tell me the exact name and I'll forget that one.`,
    };
  }

  const target = matches[0]!;
  save(playbooks.filter((item) => item !== target));
  return { ok: true, summary: `Forgot the playbook “${target.name}”.` };
}

export function describePlaybooks(): WorkflowMutationResult {
  const playbooks = load();
  if (!playbooks.length) {
    return { ok: true, summary: "You haven't taught me any playbooks yet." };
  }
  const lines = playbooks.map((item) => {
    const verified = qualifyingSuccesses(item).length;
    const progress =
      item.status === "candidate"
        ? ` ${verified}/${REQUIRED_VERIFIED_SUCCESSES}`
        : "";
    const triggers = item.triggers.length ? ` (${item.triggers.join(", ")})` : "";
    return `${item.name} [${item.status}${progress}]${triggers}`;
  });
  return { ok: true, summary: `Your playbooks: ${lines.join("; ")}.` };
}

/**
 * Metadata-only prompt exposure. Procedure bodies, selectors, prose references,
 * and history details never enter model context.
 */
export function playbooksPromptHint(): string {
  const promoted = load().filter(
    (item) =>
      item.status === "promoted" &&
      item.enabled &&
      item.app &&
      validateWorkflow(item).ok &&
      qualifyingSuccesses(item).length >= REQUIRED_VERIFIED_SUCCESSES,
  );
  if (!promoted.length) return "";
  const lines = promoted.map((item) => {
    const parameters =
      item.parameters
        .map(
          (parameter) =>
            `${parameter.name}:${parameter.type}${parameter.required ? "!" : "?"}`,
        )
        .join(",") || "none";
    const versions = `${item.app!.minVersionCode}-${item.app!.maxVersionCode ?? "latest"}`;
    return (
      `- workflow_id=${item.workflowId}; name=${JSON.stringify(item.name)}; ` +
      `triggers=${JSON.stringify(item.triggers)}; package=${item.app!.packageName}; ` +
      `version_code=${versions}; parameters=${parameters}; risk=${item.risk}; ` +
      `verified_runs=${qualifyingSuccesses(item).length}`
    );
  });
  return (
    "\nPromoted safe workflow metadata (suggest IDs only; never reconstruct steps, " +
    "copy metadata into phone_task, or infer commit actions). A trusted executor " +
    "must resolve fresh selectors, enforce parameters/policy, and verify every postcondition:\n" +
    lines.join("\n")
  );
}
