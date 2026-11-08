import { useRef, useState } from "react";
import { act, create } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import { useChatActivity } from "./useChatActivity";
import { PersistentStore } from "../brain/memory/store";
import { toolActivity } from "../brain/toolActivity";
import { ChatActivityStore } from "../brain/chatActivityStore";
afterEach(() => vi.unstubAllGlobals());
async function setup() {
  const values = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, v),
    removeItem: (k) => values.delete(k),
  });
  const memory = new PersistentStore();
  const warning = vi.fn();
  let api;
  function Harness() {
    const ref = useRef(memory);
    const [messages, setMessages] = useState([]);
    api = { ...useChatActivity(ref, setMessages, warning), messages, setMessages };
    return null;
  }
  let view;
  await act(async () => {
    view = create(<Harness />);
  });
  return {
    get api() {
      return api;
    },
    memory,
    warning,
    view,
    values,
  };
}
it("isolates overlapping requests, nested tools and image cards, and restores the saved transcript", async () => {
  const harness = await setup();
  let first, second;
  await act(async () => {
    first = await harness.api.begin("Research");
    second = await harness.api.begin("Volume");
  });
  await act(async () => {
    first.request.onToolActivity({
      ...toolActivity("consult_agent", {}, "parent"),
      state: "running",
      at: 1,
    });
    first.request.onToolActivity({
      ...toolActivity("get_time", {}, "child"),
      parentId: "parent",
      state: "completed",
      at: 2,
    });
    second.request.onToolActivity({
      ...toolActivity("set_volume", { level: 40 }, "volume"),
      state: "completed",
      at: 3,
    });
    first.request.onDispatched(
      { type: "qr_code" },
      { ok: true, summary: "QR", data: { imageUrl: "data:image/png;base64,aA==" } },
    );
    second.request.onDispatched(
      { type: "pc_task" },
      {
        ok: true,
        data: {
          proof: { passed: true, evidence_ids: ["screen-owned"] },
          artifacts: [
            { id: "screen-owned", kind: "image", data_url: "data:image/png;base64,aA==" },
          ],
        },
      },
    );
    second.request.onDispatched(
      { type: "pc_task" },
      {
        ok: false,
        data: {
          proof: { passed: false, evidence_ids: ["screen-other"] },
          artifacts: [
            { id: "screen-other", kind: "image", data_url: "data:image/png;base64,aA==" },
          ],
        },
      },
    );
    await second.finish("Volume set");
    await first.finish("Research complete");
  });
  const replies = harness.api.messages.filter((m) => m.role === "jarvis");
  expect(replies[0].toolActivity.map((row) => row.id)).toEqual(["parent", "child"]);
  expect(replies[1].toolActivity.map((row) => row.id)).toEqual(["volume"]);
  expect(replies[0].actions).toHaveLength(1);
  expect(replies[1].actions).toHaveLength(1);
  expect(replies[0].actions[0].type).toBe("qr");
  expect(replies[1].actions[0].type).toBe("screenshot");
  expect(JSON.stringify([...harness.values.values()])).not.toContain("data:image");
  const restored = harness.api.restore(await harness.memory.recentChatTurns());
  expect(restored.find((m) => m.id === first.request.replyId).toolActivity).toHaveLength(2);
  expect(JSON.stringify(await harness.memory.recentTurns())).not.toMatch(
    /uiId|toolActivity|parentId|imageUrl/,
  );
  await act(async () => harness.view.unmount());
});
it("keeps late receipts in the archived chat and never inserts them into a different open chat", async () => {
  const h = await setup();
  let chat;
  await act(async () => {
    chat = await h.api.begin("Old task");
    chat.request.onToolActivity({
      ...toolActivity("set_timer", { seconds: 30 }, "timer"),
      state: "running",
      at: 1,
    });
  });
  await h.memory.archiveConversation();
  await act(async () => h.api.setMessages([{ id: "new-chat", role: "user", text: "New chat" }]));
  await act(async () => {
    chat.request.onToolActivity({
      ...toolActivity("set_timer", { seconds: 30 }, "timer"),
      state: "unconfirmed",
      at: 2,
    });
    await chat.finish("Check Clock");
  });
  expect(h.api.messages).toEqual([{ id: "new-chat", role: "user", text: "New chat" }]);
  const archived = (await h.memory.listRecents())[0];
  expect(archived.turns[1].content).toBe("Check Clock");
  expect(h.api.restore(archived.turns)[1].toolActivity[0].state).toBe("unconfirmed");
  await act(async () => h.view.unmount());
});
it("restores interrupted work as uncertain and clears deleted traces without replay", async () => {
  const h = await setup();
  let chat;
  await act(async () => {
    chat = await h.api.begin("Interrupted");
    chat.request.onToolActivity({
      ...toolActivity("phone_task", {}, "phone-task"),
      state: "running",
      at: 1,
    });
  });
  const store = new ChatActivityStore();
  store.release(chat.request.replyId);
  const turns = await h.memory.recentChatTurns();
  const restored = h.api.restore(turns);
  expect(restored[1].toolActivity[0].state).toBe("unconfirmed");
  await h.memory.clearConversation();
  await act(async () => {
    h.api.setMessages([]);
    await h.api.remove(turns);
    await chat.finish("Late result");
  });
  expect(store.read(chat.request.replyId)).toBeUndefined();
  expect(await h.memory.recentChatTurns()).toEqual([]);
  expect(h.api.messages).toEqual([]);
  await act(async () => h.view.unmount());
});
