import { reduceAgentEvent } from "./agentActivity";

// Only opaque native task identifiers are retained in WebView storage. Goals,
// receipts, screenshots, proof and results remain in Room / process memory so a
// WebView backup cannot become a second, unredacted audit database.
const NATIVE_TASK_IDS_KEY = "jarvis.android.task_ids.v2";
const REMOTE_TASK_CURSORS_KEY = "jarvis.android.remote_task_cursors.v2";
const TASK_CAP = 40;
const NATIVE_ID_CAP = 24;

export const TERMINAL_TASK_STATES = new Set([
  "succeeded",
  "failed",
  "cancelled",
  "done",
  "stopped",
]);
export const ACTIVE_TASK_STATES = new Set([
  "accepted",
  "queued",
  "recovering",
  "planning",
  "policy_check",
  "executing",
  "verifying",
  "running",
  "cancelling",
]);

function objectOf(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function textOf(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function numeric(value, fallback = -1) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeTaskState(state, fallback = "queued") {
  const s = String(state || "")
    .trim()
    .toLowerCase()
    .replaceAll("-", "_");
  if (s === "done" || s === "complete" || s === "completed") return "succeeded";
  if (s === "stopped") return "cancelled";
  if (s === "waiting_for_approval") return "suspended";
  return s || fallback;
}

function taskIndex(tasks, id, nativeTaskId = "") {
  return tasks.findIndex(
    (task) => task.id === id || (nativeTaskId && task.nativeTaskId === nativeTaskId),
  );
}

function replaceTask(tasks, task) {
  return [...tasks.filter((item) => item.id !== task.id), task].slice(-TASK_CAP);
}

function appendReceipt(items, receipt, key, ok = true) {
  if (!receipt) return items || [];
  if ((items || []).some((item) => item.receiptKey === key)) return items || [];
  return [...(items || []), { kind: "step", line: receipt, ok, receiptKey: key }];
}

/** Fold legacy agent_* events without allowing an executor-end event to forge a
 * terminal result for a task already governed by the durable protocol. */
export function reduceTaskCenterAgentEvent(prev, event, opts = {}) {
  const before = prev || [];
  const id = event?.data?.id;
  const existing = id ? before.find((task) => task.id === id) : null;
  const folded = reduceAgentEvent(before, event, opts);
  if (!id) return folded;
  return folded.map((task) => {
    if (task.id !== id) return task;
    if (event.event === "agent_task") {
      const state = existing?.durable
        ? normalizeTaskState(existing.status, "executing")
        : "running";
      return {
        ...existing,
        ...task,
        durable: Boolean(existing?.durable),
        source: existing?.source || (task.kind === "phone" ? "phone" : "pc"),
        nativeTaskId: existing?.nativeTaskId,
        status: existing?.durable ? (state === "queued" ? "executing" : state) : "running",
        state: existing?.durable ? (state === "queued" ? "executing" : state) : "running",
        items: task.items?.length ? task.items : existing?.items || [],
        lastSeq: existing?.lastSeq ?? -1,
        updatedAt: Date.now(),
      };
    }
    if (event.event === "agent_task_end" && existing?.durable) {
      // The durable native/desktop terminal event is the proof boundary. Preserve
      // its state even if a legacy agent_task_end arrives first.
      const durableState = normalizeTaskState(existing.status, "verifying");
      const terminal = TERMINAL_TASK_STATES.has(durableState);
      return {
        ...task,
        ...existing,
        items: task.items || existing.items || [],
        status: terminal ? durableState : "verifying",
        state: terminal ? durableState : "verifying",
        summary: terminal
          ? existing.summary || task.summary
          : "Executor finished; waiting for durable verification evidence.",
        updatedAt: Date.now(),
      };
    }
    return { ...task, source: task.source || (task.kind === "phone" ? "phone" : "pc") };
  });
}

/** Bind the generated Room task id to the activity row created immediately before
 * runPhoneTask. This keeps the step feed and native checkpoints in one card. */
export function bindNativeTask(prev, spec) {
  if (!spec?.taskId) return prev || [];
  const tasks = [...(prev || [])];
  let index = tasks.findIndex((task) => task.nativeTaskId === spec.taskId);
  if (index < 0) {
    for (let i = tasks.length - 1; i >= 0; i -= 1) {
      const task = tasks[i];
      if (
        task.kind === "phone" &&
        !task.nativeTaskId &&
        !TERMINAL_TASK_STATES.has(normalizeTaskState(task.status, "running")) &&
        (!spec.goal || task.goal === spec.goal)
      ) {
        index = i;
        break;
      }
    }
  }
  const existing = index >= 0 ? tasks[index] : null;
  const task = {
    ...(existing || {}),
    id: existing?.id || `native:${spec.taskId}`,
    nativeTaskId: spec.taskId,
    durable: true,
    source: "phone",
    kind: "phone",
    goal: spec.goal || existing?.goal || "Recovered phone task",
    status: "planning",
    state: "planning",
    risk: spec.risk || existing?.risk || "R1",
    deadlineAt: spec.deadlineAtMs || existing?.deadlineAt,
    items: existing?.items || [],
    summary: existing?.summary || "",
    nativeEventSeq: existing?.nativeEventSeq ?? -1,
    updatedAt: Date.now(),
  };
  if (index >= 0) tasks.splice(index, 1);
  return replaceTask(tasks, task);
}

export function reduceNativeCheckpoint(prev, checkpoint) {
  const id = checkpoint?.taskId;
  if (!id) return prev || [];
  const tasks = [...(prev || [])];
  const index = taskIndex(tasks, `native:${id}`, id);
  const existing = index >= 0 ? tasks[index] : null;
  const state = normalizeTaskState(checkpoint.state, existing?.status || "executing");
  const step = Math.max(0, numeric(checkpoint.step, existing?.currentStep || 0));
  const receipt = textOf(checkpoint.receipt);
  const waitingReason =
    state === "suspended" ? receipt.replace(/^approval:/i, "") || "Task safely suspended." : "";
  const task = {
    ...(existing || {}),
    id: existing?.id || `native:${id}`,
    nativeTaskId: id,
    durable: true,
    source: "phone",
    kind: "phone",
    goal: existing?.goal || "Recovered phone task",
    status: state,
    state,
    currentStep: step,
    receipt,
    items: appendReceipt(existing?.items, receipt, `native-local:${step}:${receipt}`),
    waitingReason,
    approval:
      state === "suspended" && /^approval:/i.test(receipt)
        ? {
            risk: existing?.risk || "R2",
            consequence: waitingReason,
          }
        : existing?.approval,
    updatedAt: Date.now(),
  };
  if (index >= 0) tasks.splice(index, 1);
  return replaceTask(tasks, task);
}

/** Apply a Room task_status response. Event sequence prevents an old async poll
 * from rewinding a newer checkpoint. */
export function reduceNativeStatus(prev, status, { recovered = false } = {}) {
  if (!status?.ok || !status.taskId) return prev || [];
  const tasks = [...(prev || [])];
  const index = taskIndex(tasks, `native:${status.taskId}`, status.taskId);
  const existing = index >= 0 ? tasks[index] : null;
  const seq = numeric(status.eventSeq, existing?.nativeEventSeq ?? -1);
  if (existing && seq >= 0 && seq < (existing.nativeEventSeq ?? -1)) return prev;
  let state = normalizeTaskState(status.state, existing?.status || "suspended");
  if (status.cancelRequested && !TERMINAL_TASK_STATES.has(state)) state = "cancelling";
  const receipt = textOf(status.receipt);
  const verificationReceipt = textOf(status.verificationReceipt);
  const verificationDigest = textOf(status.verificationDigest);
  const hasReceipt = /^aura\.verify\.v1:(model|deterministic):[a-f0-9]{64}$/.test(
    verificationReceipt,
  );
  const hasDigest = /^[a-f0-9]{64}$/.test(verificationDigest);
  const verified = Boolean(status.verified && (hasReceipt || hasDigest));
  const unverifiedSuccess = state === "succeeded" && !verified;
  if (unverifiedSuccess) state = "failed";
  const result = unverifiedSuccess
    ? "Completion was withheld because the native record has no verified evidence. Please run the task again."
    : textOf(status.result);
  const terminal = TERMINAL_TASK_STATES.has(state);
  const waitingReason =
    state === "suspended" ? receipt.replace(/^approval:/i, "") || "Safely suspended." : "";
  const task = {
    ...(existing || {}),
    id: existing?.id || `native:${status.taskId}`,
    nativeTaskId: status.taskId,
    durable: true,
    source: "phone",
    kind: "phone",
    goal: existing?.goal || "Recovered phone task",
    status: state,
    state,
    currentStep: Math.max(0, numeric(status.step, existing?.currentStep || 0)),
    receipt,
    result,
    summary: result || existing?.summary || "",
    proof:
      state === "succeeded"
        ? verificationReceipt || `Verification receipt SHA-256: ${verificationDigest}`
        : "",
    verified,
    verifiedAt: numeric(status.verifiedAtMs, existing?.verifiedAt || 0),
    items: appendReceipt(existing?.items, receipt, `native:${seq}:${receipt}`, state !== "failed"),
    nativeEventSeq: seq,
    cancelRequested: Boolean(status.cancelRequested),
    waitingReason,
    approval:
      state === "suspended" && /^approval:/i.test(receipt)
        ? {
            risk: existing?.risk || "R2",
            consequence: waitingReason,
          }
        : existing?.approval,
    recoveryInfo: recovered
      ? state === "suspended"
        ? "Recovered after interface/process loss and left safely suspended for re-observation."
        : terminal
          ? "Recovered from the native task journal."
          : "Reattached to the native supervisor after the interface restarted."
      : existing?.recoveryInfo || "",
    recovered: recovered || Boolean(existing?.recovered),
    updatedAt: numeric(status.updatedAtMs, Date.now()),
  };
  if (index >= 0) tasks.splice(index, 1);
  return replaceTask(tasks, task);
}

export function markTaskStopping(prev, id) {
  return (prev || []).map((task) =>
    task.id === id || task.nativeTaskId === id
      ? { ...task, status: "cancelling", state: "cancelling", updatedAt: Date.now() }
      : task,
  );
}

/** Fold task.accepted/task.status/task.event and approval/clarification events
 * emitted by RemotePC. Monotonic positive sequences are authoritative; seq=0 is
 * a current status snapshot and may refresh state without moving the cursor. */
export function reduceRemoteTaskEvent(prev, event) {
  const eventName = String(event?.event || "").toLowerCase();
  if (
    ![
      "task.accepted",
      "task.status",
      "task.event",
      "task.cancelled",
      "approval.challenge",
      "approval.resolved",
      "clarification.challenge",
      "clarification.resolved",
    ].includes(eventName)
  ) {
    return prev || [];
  }
  const data = objectOf(event.data);
  const payload = objectOf(data.payload);
  const nested = objectOf(data.data);
  const id = textOf(event.taskId, data.task_id, data.taskId, payload.task_id, nested.task_id);
  if (!id) return prev || [];
  const tasks = [...(prev || [])];
  const index = taskIndex(tasks, id);
  const existing = index >= 0 ? tasks[index] : null;
  const seq = numeric(event.seq ?? data.seq, 0);
  if (existing && seq > 0 && seq <= (existing.lastSeq ?? -1)) return prev;

  const eventKind = textOf(
    data.kind,
    data.event_type,
    data.eventType,
    payload.kind,
    nested.kind,
  ).toLowerCase();
  let state = normalizeTaskState(
    textOf(data.state, payload.state, nested.state),
    eventName === "task.accepted" ? "accepted" : existing?.status || "executing",
  );
  if (eventName === "task.cancelled") state = "cancelled";
  if (eventName === "approval.challenge" || eventKind === "approval.challenge") state = "suspended";

  const line = textOf(payload.message, nested.message, data.message, payload.line, nested.line);
  // A clarification challenge's actual prompt lives in `question`, not `reason` —
  // without this, a missed live dialog (e.g. app backgrounded) leaves only the
  // generic "Waiting for attention on the PC" fallback below, with no way to
  // learn what was actually being asked.
  const reason = textOf(
    payload.question, nested.question, data.question,
    payload.reason, nested.reason, data.reason, line,
  );
  const summary = textOf(payload.summary, nested.summary, data.summary, existing?.summary);
  const proof =
    payload.proof ??
    payload.evidence ??
    nested.proof ??
    nested.evidence ??
    data.proof ??
    existing?.proof;
  const step = numeric(payload.step ?? nested.step ?? data.step, existing?.currentStep || 0);
  const receiptKey = `pc:${seq}:${eventKind}:${line}`;
  const isWaiting =
    state === "suspended" || eventKind.includes("challenge") || eventKind.includes("waiting");
  const approvalSource = objectOf(payload.approval || nested.approval || data.approval);
  const approval =
    eventName === "approval.challenge" ||
    eventKind === "approval.challenge" ||
    Object.keys(approvalSource).length
      ? {
          risk: textOf(approvalSource.risk, payload.risk, nested.risk, data.risk),
          action: textOf(approvalSource.action, payload.action, nested.action, data.action),
          target: textOf(approvalSource.target, payload.target, nested.target, data.target),
          consequence: textOf(
            approvalSource.consequence,
            payload.consequence,
            nested.consequence,
            data.consequence,
            reason,
          ),
          expiresAt:
            approvalSource.expires_at || payload.expires_at || nested.expires_at || data.expires_at,
        }
      : existing?.approval;
  const task = {
    ...(existing || {}),
    id,
    durable: true,
    source: "pc",
    kind: textOf(data.task_kind, payload.task_kind, existing?.kind, "computer"),
    goal: textOf(data.goal, payload.goal, nested.goal, existing?.goal, "Remote PC task"),
    status: state,
    state,
    summary,
    proof,
    currentStep: Math.max(0, step),
    plan: data.plan || payload.plan || nested.plan || existing?.plan,
    retryInfo: textOf(payload.retry, nested.retry, data.retry, existing?.retryInfo),
    recoveryInfo: textOf(payload.recovery, nested.recovery, data.recovery, existing?.recoveryInfo),
    waitingReason: isWaiting ? reason || "Waiting for attention on the PC." : "",
    approval,
    items: appendReceipt(existing?.items, line, receiptKey, state !== "failed"),
    lastSeq: seq > 0 ? seq : (existing?.lastSeq ?? -1),
    updatedAt: data.created_at || data.updated_at || Date.now(),
  };
  if (index >= 0) tasks.splice(index, 1);
  return replaceTask(tasks, task);
}

/** Fold the host's authenticated task.list response after Android process loss.
 * Snapshot rows are current state, not journal events, so they refresh without
 * advancing the replay cursor; task.subscribe will replay the missing sequences. */
export function reduceRemoteTaskSnapshot(prev, event) {
  const data = objectOf(event?.data);
  const rows = Array.isArray(data.tasks) ? data.tasks : [];
  return rows.reduce((tasks, row) => {
    const taskId = textOf(row?.task_id, row?.taskId, row?.id);
    if (!taskId) return tasks;
    const next = reduceRemoteTaskEvent(tasks, {
      event: "task.status",
      taskId,
      seq: 0,
      data: row,
    });
    return next.map((task) =>
      task.id === taskId
        ? {
            ...task,
            recovered: true,
            recoveryInfo: "Recovered from the Windows host's durable task index.",
          }
        : task,
    );
  }, prev || []);
}

export function rememberNativeTaskId(id, storage = globalThis.localStorage) {
  const taskId = String(id || "").trim();
  if (!taskId || !storage) return;
  let ids = [];
  try {
    const parsed = JSON.parse(storage.getItem(NATIVE_TASK_IDS_KEY) || "[]");
    if (Array.isArray(parsed)) ids = parsed.filter((item) => typeof item === "string");
    ids = [...ids.filter((item) => item !== taskId), taskId].slice(-NATIVE_ID_CAP);
    storage.setItem(NATIVE_TASK_IDS_KEY, JSON.stringify(ids));
  } catch {
    // Task execution must not depend on optional WebView history storage.
  }
}

export function loadKnownNativeTaskIds(storage = globalThis.localStorage) {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(NATIVE_TASK_IDS_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => typeof item === "string" && item.trim()).slice(-NATIVE_ID_CAP);
  } catch {
    return [];
  }
}

export function rememberRemoteTaskCursor(id, seq = 0, storage = globalThis.localStorage) {
  const taskId = String(id || "").trim();
  if (!taskId || !storage) return;
  try {
    const parsed = JSON.parse(storage.getItem(REMOTE_TASK_CURSORS_KEY) || "[]");
    const rows = Array.isArray(parsed) ? parsed : [];
    const existing = rows.find((row) => row && row.taskId === taskId);
    const lastSeq = Math.max(0, numeric(seq, 0), numeric(existing?.lastSeq, 0));
    const next = [
      ...rows.filter((row) => row && typeof row.taskId === "string" && row.taskId !== taskId),
      { taskId, lastSeq },
    ].slice(-NATIVE_ID_CAP);
    storage.setItem(REMOTE_TASK_CURSORS_KEY, JSON.stringify(next));
  } catch {
    // Reconnect remains best-effort if optional WebView storage is unavailable.
  }
}

export function loadKnownRemoteTaskCursors(storage = globalThis.localStorage) {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(REMOTE_TASK_CURSORS_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((row) => row && typeof row.taskId === "string" && row.taskId.trim())
      .map((row) => ({ taskId: row.taskId, lastSeq: Math.max(0, numeric(row.lastSeq, 0)) }))
      .slice(-NATIVE_ID_CAP);
  } catch {
    return [];
  }
}

export function clearKnownRemoteTaskCursors(storage = globalThis.localStorage) {
  try {
    storage?.removeItem(REMOTE_TASK_CURSORS_KEY);
  } catch {
    // Unpairing still clears the live connection even if WebView storage failed.
  }
}

export function loadRecoveredTaskShells(storage = globalThis.localStorage) {
  return [
    ...loadKnownNativeTaskIds(storage).map((nativeTaskId) => ({
      id: `native:${nativeTaskId}`,
      nativeTaskId,
      durable: true,
      recovered: true,
      source: "phone",
      kind: "phone",
      goal: "Recovered phone task",
      status: "recovering",
      state: "recovering",
      summary: "Reading the verified native checkpoint…",
      items: [],
      nativeEventSeq: -1,
      updatedAt: 0,
    })),
    ...loadKnownRemoteTaskCursors(storage).map(({ taskId, lastSeq }) => ({
      id: taskId,
      durable: true,
      recovered: true,
      source: "pc",
      kind: "computer",
      goal: "Recovered PC task",
      status: "recovering",
      state: "recovering",
      summary: "Reconnecting to the Windows host for verified status…",
      items: [],
      lastSeq,
      updatedAt: 0,
    })),
  ].slice(-TASK_CAP);
}
