/** Fail-closed schema and evidence checks for procedural learning v2. */

import type {
  ParameterReference,
  Playbook,
  StableSelector,
  WorkflowCondition,
  WorkflowEnvironment,
  WorkflowSuccessHistory,
} from "./proceduralTypes";

const ID = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/;
const PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/;
const RESOURCE = /^(?:[A-Za-z][A-Za-z0-9_.]*:id\/)?[A-Za-z][A-Za-z0-9_.:-]{0,127}$/;
const PROOF = /^[A-Za-z0-9_-]{16,128}$/;
const ROLES = new Set(["button", "field", "list", "list_item", "tab", "switch", "text"]);
const SELECTOR_ACTIONS = new Set([
  "tap",
  "long_press",
  "set_text",
  "clear_text",
  "scroll",
  "wait_for",
  "read_element",
]);
const ACTIONS = new Set(["open_app", ...SELECTOR_ACTIONS, "back", "home"]);
const CONSEQUENCE =
  /\b(send|submit|publish|post|share|upload|delete|trash|erase|remove|purchase|pay|buy|checkout|transfer|install|uninstall|password|passcode|otp|one time|verification code|credential|log in|login|sign in|security|administrator|root|permission)\b/i;
const SENSITIVE_PARAMETER =
  /\b(password|passcode|pin|otp|token|secret|credential|api key|card|cvv|account number|auth)\b/i;
const BANNED_KEYS = new Set([
  "x",
  "y",
  "left",
  "top",
  "right",
  "bottom",
  "bounds",
  "coordinate",
  "coordinates",
  "index",
  "path",
  "rawtext",
  "literaltext",
  "message",
  "secret",
]);

export function objectOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function isRecordId(value: string): boolean {
  return ID.test(value);
}

function metadata(value: unknown, max = 128): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    !/[\r\n\u0000-\u001f]/.test(value)
  );
}

function semantic(value: string): string {
  return value.replace(/[_./:\-]+/g, " ");
}

function consequential(value: string): boolean {
  return CONSEQUENCE.test(semantic(value));
}

function hasBannedShape(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasBannedShape);
  const record = objectOf(value);
  return Boolean(
    record &&
      Object.entries(record).some(
        ([key, child]) => BANNED_KEYS.has(key.toLowerCase()) || hasBannedShape(child),
      ),
  );
}

function validateSelector(
  value: unknown,
  packageName: string,
  where: string,
  errors: string[],
): value is StableSelector {
  const selector = objectOf(value);
  if (!selector) {
    errors.push(`${where} needs a stable selector`);
    return false;
  }
  const allowed = new Set([
    "packageName",
    "resourceId",
    "contentDescription",
    "testTag",
    "role",
  ]);
  if (Object.keys(selector).some((key) => !allowed.has(key))) {
    errors.push(`${where} contains a non-stable selector field`);
  }
  if (selector.packageName !== packageName) {
    errors.push(`${where} package does not match the workflow`);
  }
  const anchors = [
    ["resource id", selector.resourceId],
    ["content description", selector.contentDescription],
    ["test tag", selector.testTag],
  ] as const;
  if (!anchors.some(([, field]) => field)) {
    errors.push(`${where} needs a resource id, test tag, or content description`);
  }
  for (const [label, field] of anchors) {
    if (field === undefined) continue;
    if (!metadata(field)) errors.push(`${where} has an invalid ${label}`);
    if (typeof field === "string" && consequential(field)) {
      errors.push(`${where} targets a consequential action`);
    }
  }
  if (
    selector.resourceId !== undefined &&
    (typeof selector.resourceId !== "string" || !RESOURCE.test(selector.resourceId))
  ) {
    errors.push(`${where} has an invalid resource id`);
  }
  if (selector.role !== undefined && !ROLES.has(String(selector.role))) {
    errors.push(`${where} has an unsupported role`);
  }
  return true;
}

function validateParameterRef(
  value: unknown,
  parameters: Set<string>,
  where: string,
  errors: string[],
): value is ParameterReference {
  const ref = objectOf(value);
  if (
    !ref ||
    Object.keys(ref).length !== 1 ||
    typeof ref.parameter !== "string" ||
    !parameters.has(ref.parameter)
  ) {
    errors.push(`${where} must reference one declared parameter`);
    return false;
  }
  return true;
}

function validateCondition(
  value: unknown,
  packageName: string,
  parameters: Set<string>,
  where: string,
  errors: string[],
): value is WorkflowCondition {
  const condition = objectOf(value);
  const kind = condition?.kind;
  if (!condition || typeof kind !== "string") {
    errors.push(`${where} must be a typed condition`);
    return false;
  }
  if (kind === "app_foreground") {
    if (condition.packageName !== packageName) errors.push(`${where} checks the wrong package`);
    return true;
  }
  if (kind === "structure_changed") {
    if (condition.scope !== "active_window" && condition.scope !== "target_window") {
      errors.push(`${where} has an invalid structure scope`);
    }
    return true;
  }
  if (!["element_present", "element_absent", "element_state", "element_value"].includes(kind)) {
    errors.push(`${where} has an unsupported condition kind`);
    return false;
  }
  validateSelector(condition.selector, packageName, `${where}.selector`, errors);
  if (kind === "element_state") {
    if (
      !["enabled", "selected", "checked", "focused", "scrollable"].includes(
        String(condition.state),
      ) ||
      typeof condition.equals !== "boolean"
    ) {
      errors.push(`${where} has an invalid element state assertion`);
    }
  }
  if (kind === "element_value") {
    validateParameterRef(condition.value, parameters, `${where}.value`, errors);
  }
  return true;
}

export function validateWorkflow(workflow: Playbook): {
  ok: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const app = workflow.app;
  if (!app || !PACKAGE.test(app.packageName)) errors.push("a valid package name is required");
  if (!app || !Number.isInteger(app.minVersionCode) || app.minVersionCode < 1) {
    errors.push("minVersionCode must be a positive integer");
  }
  if (
    app?.maxVersionCode !== undefined &&
    (!Number.isInteger(app.maxVersionCode) || app.maxVersionCode < app.minVersionCode)
  ) {
    errors.push("maxVersionCode must be at least minVersionCode");
  }
  if (app?.versionNamePattern !== undefined) {
    if (!metadata(app.versionNamePattern, 80)) errors.push("invalid version name pattern");
    else {
      try {
        new RegExp(app.versionNamePattern);
      } catch {
        errors.push("invalid version name pattern");
      }
    }
  }
  if (workflow.risk !== "R0" && workflow.risk !== "R1") {
    errors.push("only R0/R1 workflows can be learned");
  }
  if (
    workflow.idempotency !== "repeatable" &&
    workflow.idempotency !== "verify_before_retry"
  ) {
    errors.push("an idempotency rule is required");
  }
  if (workflow.risk === "R1" && workflow.idempotency !== "verify_before_retry") {
    errors.push("R1 workflows must verify before retrying");
  }
  if (!metadata(workflow.name, 80) || consequential(workflow.name)) {
    errors.push("workflow name is unsafe");
  }
  if (!Array.isArray(workflow.triggers) || workflow.triggers.length > 12) {
    errors.push("invalid trigger list");
  }
  for (const trigger of workflow.triggers || []) {
    if (!metadata(trigger, 100) || consequential(trigger)) errors.push("unsafe trigger metadata");
  }

  const parameters = new Set<string>();
  if (!Array.isArray(workflow.parameters) || workflow.parameters.length > 16) {
    errors.push("invalid parameter list");
  }
  for (const parameter of workflow.parameters || []) {
    if (
      !ID.test(parameter?.name || "") ||
      SENSITIVE_PARAMETER.test(semantic(parameter?.name || ""))
    ) {
      errors.push("parameter names cannot represent secrets or credentials");
    }
    if (!["text", "number", "boolean", "url"].includes(parameter?.type)) {
      errors.push("invalid parameter type");
    }
    if (typeof parameter?.required !== "boolean") errors.push("parameter required flag is missing");
    if (parameters.has(parameter?.name)) errors.push("duplicate parameter name");
    parameters.add(parameter?.name);
  }

  const packageName = app?.packageName || "";
  if (!Array.isArray(workflow.preconditions) || workflow.preconditions.length === 0) {
    errors.push("at least one typed precondition is required");
  }
  for (const [index, condition] of (workflow.preconditions || []).entries()) {
    validateCondition(
      condition,
      packageName,
      parameters,
      `preconditions[${index}]`,
      errors,
    );
  }
  if (
    !Array.isArray(workflow.procedure) ||
    workflow.procedure.length < 1 ||
    workflow.procedure.length > 24
  ) {
    errors.push("a workflow needs 1-24 typed steps");
  }
  const stepIds = new Set<string>();
  for (const [index, raw] of (workflow.procedure || []).entries()) {
    const step = objectOf(raw);
    const where = `procedure[${index}]`;
    if (!step) {
      errors.push(`${where} must be an object`);
      continue;
    }
    const allowed = new Set([
      "stepId",
      "action",
      "packageName",
      "selector",
      "value",
      "direction",
      "postconditions",
    ]);
    if (Object.keys(step).some((key) => !allowed.has(key))) {
      errors.push(`${where} has unsupported or unsafe fields`);
    }
    const stepId = typeof step.stepId === "string" ? step.stepId : "";
    if (!ID.test(stepId) || stepIds.has(stepId)) {
      errors.push(`${where} needs a unique stable step id`);
    }
    stepIds.add(stepId);
    const action = String(step.action || "");
    if (!ACTIONS.has(action)) errors.push(`${where} has an unsafe action`);
    if (SELECTOR_ACTIONS.has(action)) {
      validateSelector(step.selector, packageName, `${where}.selector`, errors);
    } else if (step.selector !== undefined) {
      errors.push(`${where} does not accept a selector`);
    }
    if (action === "open_app") {
      if (step.packageName !== packageName) errors.push(`${where} opens the wrong package`);
    } else if (step.packageName !== undefined) {
      errors.push(`${where} has an unexpected packageName`);
    }
    if (action === "set_text") {
      validateParameterRef(step.value, parameters, `${where}.value`, errors);
    } else if (step.value !== undefined) {
      errors.push(`${where} cannot contain literal or captured text`);
    }
    if (action === "scroll") {
      if (!["up", "down", "left", "right"].includes(String(step.direction))) {
        errors.push(`${where} needs a scroll direction`);
      }
    } else if (step.direction !== undefined) {
      errors.push(`${where} has an unexpected direction`);
    }
    const postconditions = Array.isArray(step.postconditions) ? step.postconditions : [];
    if (!postconditions.length) errors.push(`${where} needs a deterministic postcondition`);
    for (const [conditionIndex, condition] of postconditions.entries()) {
      validateCondition(
        condition,
        packageName,
        parameters,
        `${where}.postconditions[${conditionIndex}]`,
        errors,
      );
    }
  }
  if (hasBannedShape(workflow.preconditions) || hasBannedShape(workflow.procedure)) {
    errors.push("coordinates, indexes, paths, raw text, and captured messages are forbidden");
  }
  const unique = [...new Set(errors)];
  return { ok: unique.length === 0, errors: unique };
}

export function safeReference(text: string): string {
  return text
    .slice(0, 2000)
    .replace(
      /\b(api.?key|password|passcode|token|secret|otp)\s*[:=]\s*\S+/gi,
      "$1=[redacted]",
    )
    .replace(/\b\d{6}\b/g, "[redacted-code]");
}

export function appMatches(
  app: NonNullable<Playbook["app"]>,
  environment: WorkflowEnvironment,
): boolean {
  if (
    environment.packageName !== app.packageName ||
    !Number.isInteger(environment.versionCode) ||
    environment.versionCode < app.minVersionCode ||
    (app.maxVersionCode !== undefined && environment.versionCode > app.maxVersionCode)
  ) {
    return false;
  }
  if (!app.versionNamePattern) return true;
  try {
    return new RegExp(app.versionNamePattern).test(environment.versionName || "");
  } catch {
    return false;
  }
}

function postconditionCount(workflow: Playbook): number {
  return workflow.procedure.reduce((total, step) => total + step.postconditions.length, 0);
}

export function validSuccess(
  workflow: Playbook,
  receipt: WorkflowSuccessHistory,
): boolean {
  return Boolean(
    receipt.workflowRevision === workflow.revision &&
      ID.test(receipt.runId || "") &&
      PROOF.test(receipt.proofDigest || "") &&
      receipt.independentlyVerified === true &&
      receipt.deterministic === true &&
      ["native_accessibility", "deterministic_adapter"].includes(receipt.verifier) &&
      ID.test(receipt.executorId || "") &&
      ID.test(receipt.verifierId || "") &&
      receipt.executorId !== receipt.verifierId &&
      Number.isInteger(receipt.checkedPostconditions) &&
      receipt.checkedPostconditions >= postconditionCount(workflow) &&
      workflow.app &&
      appMatches(workflow.app, receipt),
  );
}

export function qualifyingSuccesses(workflow: Playbook): WorkflowSuccessHistory[] {
  const runs = new Set<string>();
  const proofs = new Set<string>();
  return workflow.successHistory.filter((receipt) => {
    if (
      !validSuccess(workflow, receipt) ||
      runs.has(receipt.runId) ||
      proofs.has(receipt.proofDigest)
    ) {
      return false;
    }
    runs.add(receipt.runId);
    proofs.add(receipt.proofDigest);
    return true;
  });
}
