/**
 * PhoneController — the brain's handle on the NATIVE on-phone operator.
 *
 * The operator loop itself (observe → one model command → act → verify) runs in
 * Kotlin: OperatorCore.kt / NativeOperator.kt in tauri-plugin-phone. It used to run
 * here, and a phone task is backgrounded by definition — it drives some other app —
 * while on-device Chromium pauses a hidden WebView's whole task queue ~60s after it
 * leaves the foreground. So the brain only STARTS a task and polls its progress; the
 * task finishes whether or not this WebView is awake.
 *
 * Keep this file dependency-light (only ../types) so both dispatch and the platform
 * facade can import it without a cycle.
 */

import type { ToolResult } from "../types";

export type PhoneRisk = "R0" | "R1" | "R2" | "R3";

/** The user's answer to the up-front consent prompt. `allow_task` is accepted for
 *  the UI's sake and means the same as `allow`: consent covers this one task. */
export type PhoneApprovalDecision = "allow" | "deny" | "allow_task";

export interface PhonePolicyRequest {
  taskId: string;
  risk: PhoneRisk;
  action: string;
  target: string;
  reason: string;
  /** Screen-derived text is explicitly untrusted and never grants capabilities. */
  untrustedScreenText: string;
}

export interface NativeTaskSpec {
  taskId: string;
  /** Exactly-once submission key. Defaults to taskId for legacy callers. */
  idempotencyKey?: string;
  goal: string;
  deadlineAtMs: number;
  /** Empty lets Kotlin classify the goal itself — one classifier, not two. */
  risk: PhoneRisk | "";
  /** Empty lets Kotlin bind the native Keystore-backed device identity. */
  sourceDeviceId?: string;
  capabilityProfileJson?: string;
  retryBudget?: number;
  typedPlanJson?: string;
}

export interface NativeTaskCheckpoint {
  taskId: string;
  state: "planning" | "policy_check" | "executing" | "verifying" | "suspended";
  step: number;
  receipt: string;
  /** Typed privacy-safe checkpoint; never screen text, secrets, or image data. */
  verifiedCheckpoint?: string;
}

/** One model route, resolved by the brain (which owns endpoints and auth) for the
 *  native operator, which only shapes the request body. Held in native memory only. */
export interface NativeRoute {
  provider: string;
  model: string;
  keyIndex: number;
  url: string;
  headers: Record<string, string>;
  format: "gemini" | "openai";
  /** openai format: which body field caps output (providers disagree). */
  maxTokensField?: "max_completion_tokens" | "max_tokens";
  /** openai format: send reasoning_effort with this value (Groq gpt-oss/qwen only). */
  reasoningEffort?: string;
}

/** A route the native ladder benched mid-task — fed back to the brain's quota table. */
export interface NativeBench {
  provider: string;
  model: string;
  keyIndex: number;
  status: number;
  detail: string;
  retryAfterMs: number | null;
}

export interface OperatorStartResult {
  ok: boolean;
  summary: string;
  /** e.g. accessibility_disabled, needs_consent, no_routes, operator_busy */
  error?: string;
  /** The goal has an external side effect (R2) and the user hasn't approved it yet. */
  needsConsent?: boolean;
}

export interface OperatorStatus {
  ok: boolean;
  summary?: string;
  done?: boolean;
  stepCount?: number;
  steps?: Array<{ line: string; ok: boolean }>;
  benched?: NativeBench[];
  result?: {
    ok: boolean;
    summary: string;
    error: string | null;
    needsApproval: boolean;
    findings: string[];
    verificationReceipt: string;
  };
}

export interface PhoneController {
  /** Is the JARVIS AccessibilityService enabled in system Settings? */
  isEnabled(): Promise<boolean>;
  /** Start the native operator on a journal task begun with beginTask. */
  operatorStart(spec: {
    taskId: string;
    goal: string;
    consent: boolean;
    routesJson: string;
    /** Leave the user in the driven app on success instead of returning to JARVIS. */
    stayInApp: boolean;
  }): Promise<OperatorStartResult>;
  /** Progress since `since` step lines, and the result once done. */
  operatorStatus(taskId: string, since: number): Promise<OperatorStatus>;
  /** Native task journal (Room). The operator checkpoints natively; the brain begins
   *  tasks, finishes ones that never started, and cancels on the in-app STOP. */
  beginTask?(spec: NativeTaskSpec): Promise<ToolResult>;
  checkpointTask?(checkpoint: NativeTaskCheckpoint): Promise<ToolResult>;
  finishTask?(
    taskId: string,
    state: "succeeded" | "failed" | "suspended" | "cancelled",
    result: string,
    verificationReceipt?: string,
  ): Promise<ToolResult>;
  cancelTask?(taskId: string): Promise<ToolResult>;
  isTaskCancelled?(taskId: string): Promise<boolean>;
}
