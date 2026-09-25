import { describe, expect, it } from "vitest";
import {
  bindNativeTask,
  loadKnownNativeTaskIds,
  loadKnownRemoteTaskCursors,
  loadRecoveredTaskShells,
  reduceNativeStatus,
  reduceRemoteTaskEvent,
  reduceRemoteTaskSnapshot,
  reduceTaskCenterAgentEvent,
  rememberNativeTaskId,
  rememberRemoteTaskCursor,
} from "./taskCenter.js";

class MemoryStorage {
  values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, String(value));
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

describe("Android Task Center reducer", () => {
  it("persists only opaque native ids and builds privacy-safe recovery shells", () => {
    const storage = new MemoryStorage();
    rememberNativeTaskId("native-123", storage as unknown as Storage);

    expect(loadKnownNativeTaskIds(storage as unknown as Storage)).toEqual(["native-123"]);
    expect(JSON.stringify([...storage.values.values()])).not.toContain("private goal");
    expect(loadRecoveredTaskShells(storage as unknown as Storage)).toEqual([
      expect.objectContaining({
        id: "native:native-123",
        nativeTaskId: "native-123",
        goal: "Recovered phone task",
        status: "recovering",
      }),
    ]);
  });

  it("binds the Room id to the existing phone activity instead of duplicating it", () => {
    const current = [
      {
        id: "legacy-phone-1",
        kind: "phone",
        goal: "Open Notes and save a draft",
        status: "running",
        items: [],
      },
    ];
    const next = bindNativeTask(current, {
      taskId: "room-1",
      goal: "Open Notes and save a draft",
      risk: "R1",
      deadlineAtMs: 1234,
    });

    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      id: "legacy-phone-1",
      nativeTaskId: "room-1",
      durable: true,
      status: "planning",
    });
  });

  it("retains only a PC task id/cursor and advances the reconnect cursor monotonically", () => {
    const storage = new MemoryStorage();
    rememberRemoteTaskCursor("pc-task-7", 9, storage as unknown as Storage);
    rememberRemoteTaskCursor("pc-task-7", 4, storage as unknown as Storage);

    expect(loadKnownRemoteTaskCursors(storage as unknown as Storage)).toEqual([
      { taskId: "pc-task-7", lastSeq: 9 },
    ]);
    expect(loadRecoveredTaskShells(storage as unknown as Storage)).toEqual([
      expect.objectContaining({
        id: "pc-task-7",
        source: "pc",
        goal: "Recovered PC task",
        status: "recovering",
        lastSeq: 9,
      }),
    ]);
    const raw = JSON.stringify([...storage.values.values()]);
    expect(raw).not.toContain("private goal");
    expect(raw).not.toContain("proof");
  });

  it("reconciles a safely suspended native task and ignores stale status polls", () => {
    let tasks = reduceNativeStatus(
      [],
      {
        ok: true,
        taskId: "room-2",
        state: "suspended",
        step: 4,
        receipt: "approval:send the final message",
        eventSeq: 8,
        updatedAtMs: 100,
      },
      { recovered: true },
    );

    expect(tasks[0]).toMatchObject({
      status: "suspended",
      currentStep: 4,
      waitingReason: "send the final message",
      nativeEventSeq: 8,
      recovered: true,
    });
    expect(tasks[0].recoveryInfo).toMatch(/safely suspended/i);

    tasks = reduceNativeStatus(tasks, {
      ok: true,
      taskId: "room-2",
      state: "executing",
      eventSeq: 7,
    });
    expect(tasks[0].status).toBe("suspended");
  });

  it("shows success proof only from a native-confirmed verification receipt", () => {
    const receipt =
      "aura.verify.v1:model:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const tasks = reduceNativeStatus([], {
      ok: true,
      taskId: "room-verified",
      state: "succeeded",
      result: "Saved the document.",
      receipt: "claim:Saved the document.",
      verified: true,
      verificationReceipt: receipt,
      eventSeq: 5,
    });

    expect(tasks[0]).toMatchObject({
      status: "succeeded",
      verified: true,
      proof: receipt,
    });
    expect(tasks[0].proof).not.toContain("claim:");
  });

  it("withholds legacy native success when no verification evidence exists", () => {
    const tasks = reduceNativeStatus([], {
      ok: true,
      taskId: "room-unverified",
      state: "succeeded",
      result: "Executor claimed success.",
      receipt: "claim:Executor claimed success.",
      verified: false,
      eventSeq: 2,
    });

    expect(tasks[0].status).toBe("failed");
    expect(tasks[0].proof).toBe("");
    expect(tasks[0].summary).toMatch(/withheld.*no verified evidence/i);
  });

  it("correlates interleaved PC tasks and deduplicates replay sequences", () => {
    let tasks = reduceRemoteTaskEvent([], {
      event: "task.accepted",
      taskId: "pc-a",
      seq: 1,
      data: { state: "queued", goal: "Create the report" },
    });
    tasks = reduceRemoteTaskEvent(tasks, {
      event: "task.accepted",
      taskId: "pc-b",
      seq: 1,
      data: { state: "queued", goal: "Organize Downloads" },
    });
    tasks = reduceRemoteTaskEvent(tasks, {
      event: "task.event",
      taskId: "pc-a",
      seq: 2,
      data: { state: "executing", payload: { message: "Opened Word" } },
    });
    tasks = reduceRemoteTaskEvent(tasks, {
      event: "task.event",
      taskId: "pc-a",
      seq: 2,
      data: { state: "failed", payload: { message: "stale duplicate" } },
    });

    expect(tasks.find((task) => task.id === "pc-a")).toMatchObject({
      status: "executing",
      lastSeq: 2,
    });
    expect(tasks.find((task) => task.id === "pc-b")).toMatchObject({ status: "queued" });
  });

  it("restores the authenticated host task index without forging replay cursors", () => {
    const tasks = reduceRemoteTaskSnapshot([], {
      event: "task.snapshot",
      data: {
        tasks: [
          {
            task_id: "pc-recovered",
            goal: "Create a local document",
            state: "succeeded",
            summary: "Saved report.docx",
            proof: "File exists and re-opened",
            event_seq: 12,
          },
        ],
      },
    });

    expect(tasks[0]).toMatchObject({
      id: "pc-recovered",
      status: "succeeded",
      summary: "Saved report.docx",
      proof: "File exists and re-opened",
      recovered: true,
      lastSeq: -1,
    });
  });

  it("keeps approvals display-only and does not accept legacy executor success as proof", () => {
    let tasks = reduceRemoteTaskEvent([], {
      event: "task.accepted",
      taskId: "pc-c",
      seq: 1,
      data: { state: "queued", goal: "Draft and send a post" },
    });
    tasks = reduceTaskCenterAgentEvent(tasks, {
      event: "agent_task",
      data: { id: "pc-c", kind: "computer", goal: "Draft and send a post" },
    });
    tasks = reduceTaskCenterAgentEvent(tasks, {
      event: "agent_task_end",
      data: { id: "pc-c", ok: true, summary: "Executor says done" },
    });
    expect(tasks[0].status).toBe("verifying");

    tasks = reduceRemoteTaskEvent(tasks, {
      event: "approval.challenge",
      taskId: "pc-c",
      seq: 3,
      data: {
        state: "suspended",
        risk: "R2",
        action: "publish",
        target: "Company page",
        consequence: "Makes the draft public",
      },
    });
    expect(tasks[0]).toMatchObject({
      status: "suspended",
      approval: {
        risk: "R2",
        action: "publish",
        target: "Company page",
        consequence: "Makes the draft public",
      },
    });
  });
});
