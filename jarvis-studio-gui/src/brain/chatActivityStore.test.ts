import { expect, it } from "vitest";
import { ChatActivityStore } from "./chatActivityStore";
import { makeKV } from "./memory/store";
import { toolActivity, taskProgress, type ToolActivityEvent } from "./toolActivity";
import { updateChatToolActivity, safeToolRows } from "../hooks/chatToolActivity";
it("persists only the closed projection and restores unfinished calls as uncertain without execution", () => {
  const kv = makeKV(),
    store = new ChatActivityStore(kv);
  const rows = [
    {
      ...toolActivity("set_volume", { level: 40 }, "volume"),
      state: "running" as const,
      at: 10,
      startedAt: 10,
      summary: "SECRET",
      raw: "SECRET",
      headers: { Authorization: "SECRET" },
    },
  ];
  store.begin("reply-persist");
  expect(store.save("reply-persist", rows, false)).toBe(true);
  expect(JSON.stringify(store.read("reply-persist"))).not.toContain("SECRET");
  store.release("reply-persist");
  expect(new ChatActivityStore(kv).read("reply-persist")?.[0].state).toBe("unconfirmed");
  store.save("reply-persist", [{ ...rows[0], state: "completed" }], true);
  expect(new ChatActivityStore(kv).read("reply-persist")?.[0].state).toBe("completed");
});
it("does not recreate deleted activity after a late callback and reports storage failures", () => {
  const store = new ChatActivityStore(makeKV());
  const rows = [
    { ...toolActivity("get_time", {}, "clock"), state: "completed" as const, at: 1, startedAt: 1 },
  ];
  store.save("deleted-trace", rows, false);
  store.remove(["deleted-trace"]);
  store.save("deleted-trace", rows, true);
  expect(store.read("deleted-trace")).toBeUndefined();
  const blocked = new ChatActivityStore({
    get: () => null,
    set: () => {
      throw new Error("full");
    },
    remove: () => {},
  });
  expect(blocked.save("full", rows, true)).toBe(false);
});
it("bounds task steps, deduplicates replay and never stores screen text or completed plans", () => {
  let messages = [{ id: "reply", role: "jarvis", text: "" }];
  const context = toolActivity("phone_task", {}, "phone");
  const receive = (event: ToolActivityEvent) => {
    messages = updateChatToolActivity(messages, "reply", event);
  };
  taskProgress(receive, context, { event: "agent_task", data: { id: "native-task" } }, 1);
  taskProgress(
    receive,
    context,
    { event: "agent_step", data: { stepSeq: 1, line: "Plan: SECRET", ok: true } },
    1,
  );
  taskProgress(
    receive,
    context,
    { event: "agent_step", data: { stepSeq: 1, line: "Plan: SECRET", ok: true } },
    1,
  );
  for (let i = 2; i < 40; i++)
    taskProgress(
      receive,
      context,
      { event: "agent_step", data: { stepSeq: i, line: "type SECRET", ok: true } },
      i,
    );
  const rows = safeToolRows((messages[0] as unknown as { toolActivity: unknown }).toolActivity);
  expect(rows[0].steps).toHaveLength(32);
  expect(rows[0].state).toBe("running");
  expect(JSON.stringify(rows)).not.toContain("SECRET");
  expect(rows[0].taskId).toBe("native-task");
});
it("breaks cyclic stored parent links instead of creating an invisible or recursive tree", () => {
  const rows = safeToolRows([
    { ...toolActivity("consult_agent", {}, "a"), parentId: "b", state: "completed", at: 1 },
    { ...toolActivity("get_time", {}, "b"), parentId: "a", state: "completed", at: 1 },
  ]);
  expect(rows.some((row) => !row.parentId)).toBe(true);
});
it("rolls back a record if its index cannot commit and avoids reading unrelated trace bodies", () => {
  const values = new Map<string, string>();
  let failIndex = false;
  const reads: string[] = [];
  const store = new ChatActivityStore({
    get: (key) => {
      reads.push(key);
      return values.get(key) ?? null;
    },
    set: (key, value) => {
      if (failIndex && key === "jarvis.android.chatActivity.v1") throw new Error("quota");
      values.set(key, value);
    },
    remove: (key) => {
      values.delete(key);
    },
  });
  const row = {
    ...toolActivity("get_time", {}, "call-index"),
    state: "running" as const,
    at: 1,
    startedAt: 1,
  };
  expect(store.save("index-a", [row], false)).toBe(true);
  expect(store.save("index-b", [row], false)).toBe(true);
  reads.length = 0;
  expect(store.save("index-a", [{ ...row, state: "completed" }], true)).toBe(true);
  expect(reads.some((key) => key.endsWith(":index-b"))).toBe(false);
  failIndex = true;
  expect(store.save("index-a", [{ ...row, state: "unconfirmed" }], true)).toBe(false);
  expect(store.read("index-a")?.[0].state).toBe("completed");
});
