/** Version 1 matches Windows agent_results.py. Never forward arbitrary tool data. */
import type { ToolResult } from "./types";

export type ResultStatus = "succeeded" | "partial" | "failed" | "blocked" | "unverified";
export interface Evidence {
  id: string;
  kind: string;
  source: string;
  detail: string;
}
export interface Artifact {
  uri: string;
  kind?: string;
}
export interface AgentResult {
  version: 1;
  result_id: string;
  status: ResultStatus;
  ok: boolean;
  summary: string;
  findings: string[];
  artifacts: Artifact[];
  completed: string[];
  remaining: string[];
  evidence: Evidence[];
}

const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && !!s.trim()) : [];
export const resultId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`;

export function agentResult(r: ToolResult, task = "", tool = ""): AgentResult {
  const data = object(r.data);
  const delegated = tool === "phone_task" || tool === "pc_task";
  const proof = object(data.proof);
  const nativeReceipt =
    typeof data.verificationReceipt === "string" &&
    /^aura\.verify\.v1:(model|deterministic):[a-f0-9]{64}$/.test(data.verificationReceipt);
  const remoteReceipt = proof.passed === true && strings(proof.evidence_ids).length > 0;
  const verified = !delegated || nativeReceipt || remoteReceipt;
  const status: ResultStatus = r.ok
    ? verified
      ? "succeeded"
      : "unverified"
    : r.needsApproval || /approval|blocked/.test(r.error ?? "")
      ? "blocked"
      : /unverified|operator_lost|verification/.test(r.error ?? "")
        ? "unverified"
        : "failed";
  const evidence =
    r.ok && verified
      ? [
          {
            id: nativeReceipt
              ? String(data.verificationReceipt)
              : (strings(proof.evidence_ids)[0] ?? resultId()),
            kind: delegated ? "completion_check" : "tool_result",
            source: tool,
            detail: r.summary,
          },
        ]
      : [];
  const artifacts = Array.isArray(data.artifacts)
    ? data.artifacts.flatMap((a) => {
        const item = object(a);
        return typeof item.uri === "string"
          ? [{ uri: item.uri, kind: String(item.kind ?? "file") }]
          : [];
      })
    : [];
  const findings = strings(data.findings);
  if (Array.isArray(data.sources)) {
    for (const raw of data.sources) {
      const source = object(raw);
      if (typeof source.uri === "string")
        findings.push(`${String(source.title ?? "")} ${source.uri}`.trim());
    }
  }
  // File/web readers return their actual content here. Keep it, not just "Read file".
  for (const key of ["content", "text", "answer"]) {
    if (typeof data[key] === "string" && data[key]) findings.push(data[key] as string);
  }
  return {
    version: 1,
    result_id: resultId(),
    status,
    ok: status === "succeeded",
    summary:
      r.ok && !verified ? "Completion could not be verified. Check before retrying." : r.summary,
    findings,
    artifacts,
    evidence,
    completed: strings(data.completed).length
      ? strings(data.completed)
      : status === "succeeded" && task
        ? [task]
        : [],
    remaining: strings(data.remaining).length
      ? strings(data.remaining)
      : status !== "succeeded" && task
        ? [task]
        : [],
  };
}

export function modelToolResult(r: ToolResult, task: string, tool: string): AgentResult {
  const { ok, summary, ...details } = r.result ?? agentResult(r, task, tool);
  return { ok, summary, ...details };
}
