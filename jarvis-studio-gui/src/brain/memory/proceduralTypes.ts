/** Typed, versioned records for verified procedural learning. */

export const PLAYBOOK_SCHEMA_VERSION = 2 as const;
export const REQUIRED_VERIFIED_SUCCESSES = 3;

export type WorkflowRisk = "R0" | "R1";
export type WorkflowIdempotency = "repeatable" | "verify_before_retry";
export type WorkflowStatus = "draft" | "candidate" | "promoted" | "disabled";
export type ParameterType = "text" | "number" | "boolean" | "url";
export type WorkflowAction =
  | "open_app"
  | "tap"
  | "long_press"
  | "set_text"
  | "clear_text"
  | "scroll"
  | "back"
  | "home"
  | "wait_for"
  | "read_element";

export interface AppVersionConstraint {
  packageName: string;
  minVersionCode: number;
  maxVersionCode?: number;
  versionNamePattern?: string;
}

export interface WorkflowParameter {
  name: string;
  type: ParameterType;
  required: boolean;
}

export interface ParameterReference {
  parameter: string;
}

/** Semantic anchors only: indexes, paths, bounds, and coordinates are absent. */
export interface StableSelector {
  packageName: string;
  resourceId?: string;
  contentDescription?: string;
  testTag?: string;
  role?: "button" | "field" | "list" | "list_item" | "tab" | "switch" | "text";
}

export type WorkflowCondition =
  | { kind: "app_foreground"; packageName: string }
  | { kind: "element_present" | "element_absent"; selector: StableSelector }
  | {
      kind: "element_state";
      selector: StableSelector;
      state: "enabled" | "selected" | "checked" | "focused" | "scrollable";
      equals: boolean;
    }
  | { kind: "element_value"; selector: StableSelector; value: ParameterReference }
  | { kind: "structure_changed"; scope: "active_window" | "target_window" };

export interface WorkflowStep {
  stepId: string;
  action: WorkflowAction;
  packageName?: string;
  selector?: StableSelector;
  value?: ParameterReference;
  direction?: "up" | "down" | "left" | "right";
  postconditions: WorkflowCondition[];
}

export interface WorkflowSuccessReceipt {
  runId: string;
  workflowRevision?: number;
  proofDigest: string;
  independentlyVerified: boolean;
  deterministic: boolean;
  verifier: "native_accessibility" | "deterministic_adapter" | "model";
  executorId: string;
  verifierId: string;
  packageName: string;
  versionCode: number;
  versionName?: string;
  checkedPostconditions: number;
  verifiedAt?: number;
}

export interface WorkflowSuccessHistory extends WorkflowSuccessReceipt {
  workflowRevision: number;
  verifiedAt: number;
}

export interface WorkflowFailureHistory {
  runId: string;
  workflowRevision: number;
  kind: "execution_failed" | "postcondition_failed" | "cancelled";
  reason: string;
  failedAt: number;
}

export interface WorkflowDriftHistory {
  runId: string;
  workflowRevision: number;
  reason: "selector_missing" | "selector_ambiguous" | "app_version_changed" | "ui_drift";
  detail: string;
  detectedAt: number;
}

export interface Playbook {
  schemaVersion: typeof PLAYBOOK_SCHEMA_VERSION;
  workflowId: string;
  revision: number;
  name: string;
  triggers: string[];
  status: WorkflowStatus;
  enabled: boolean;
  app: AppVersionConstraint | null;
  parameters: WorkflowParameter[];
  preconditions: WorkflowCondition[];
  procedure: WorkflowStep[];
  risk: WorkflowRisk;
  idempotency: WorkflowIdempotency;
  successHistory: WorkflowSuccessHistory[];
  failureHistory: WorkflowFailureHistory[];
  driftHistory: WorkflowDriftHistory[];
  disabledReason?: string;
  savedAt: number;
  updatedAt: number;
  /** Compatibility/display only. Never sent to a model or executor. */
  steps: string;
  reference?: { format: "legacy_prose"; text: string };
}

export interface WorkflowCandidate {
  name: string;
  triggers?: string[];
  app: AppVersionConstraint;
  parameters?: WorkflowParameter[];
  preconditions: WorkflowCondition[];
  procedure: WorkflowStep[];
  risk: WorkflowRisk;
  idempotency: WorkflowIdempotency;
}

export interface WorkflowEnvironment {
  packageName: string;
  versionCode: number;
  versionName?: string;
}

export interface WorkflowMutationResult {
  ok: boolean;
  summary: string;
  workflow?: Playbook;
  promoted?: boolean;
}

export interface WorkflowFailure {
  runId: string;
  kind: WorkflowFailureHistory["kind"];
  reason: string;
  failedAt?: number;
}

export interface WorkflowDrift {
  runId: string;
  reason: WorkflowDriftHistory["reason"];
  detail: string;
  detectedAt?: number;
}
