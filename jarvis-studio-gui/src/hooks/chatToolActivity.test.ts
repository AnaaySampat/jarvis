import { expect, it } from "vitest";
import {
  finishChatToolReply,
  updateChatToolActivity,
  type ToolChatMessage,
} from "./chatToolActivity";
import { toolActivity, type ToolActivityEvent } from "../brain/toolActivity";
const event = (id: string, state: ToolActivityEvent["state"], at = 10): ToolActivityEvent => ({
  ...toolActivity("get_time", {}, id),
  state,
  at,
});
it("keeps parallel calls independent and attaches the final answer to the same reply", () => {
  let messages: ToolChatMessage[] = [{ id: "u", role: "user", text: "Check time and date" }];
  messages = updateChatToolActivity(messages, "reply", event("a", "running"), true);
  messages = updateChatToolActivity(messages, "reply", event("b", "running"));
  messages = updateChatToolActivity(messages, "reply", event("b", "completed", 20));
  expect(messages[1].toolActivity?.map((r) => r.state)).toEqual(["running", "completed"]);
  messages = updateChatToolActivity(messages, "reply", event("a", "completed", 21));
  messages = finishChatToolReply(messages, {
    id: "reply",
    role: "jarvis",
    text: "Here are both results",
    actions: [{ image: "artifact" }],
  });
  expect(messages).toHaveLength(2);
  expect(messages[1]).toMatchObject({
    finalized: true,
    streaming: false,
    text: "Here are both results",
    actions: [{ image: "artifact" }],
  });
  expect(messages[1].toolActivity).toHaveLength(2);
});
it("never regresses a finished row or attaches late updates to the next reply", () => {
  let messages = updateChatToolActivity([], "old", event("a", "completed"), true);
  messages = updateChatToolActivity(messages, "old", event("a", "running", 11));
  expect(messages[0].toolActivity?.[0].state).toBe("completed");
  messages = updateChatToolActivity(messages, "new", event("b", "running", 12), true);
  messages = updateChatToolActivity(messages, "old", event("a", "unconfirmed", 13));
  expect(messages[1].toolActivity?.[0].id).toBe("b");
  expect(updateChatToolActivity([], "old", event("a", "completed", 20))).toEqual([]);
});
it("does not fabricate success for calls left pending when the turn ends", () => {
  let messages = updateChatToolActivity([], "reply", event("a", "queued"), true);
  messages = updateChatToolActivity(messages, "reply", event("b", "running"));
  messages = finishChatToolReply(messages, { id: "reply", role: "jarvis", text: "Stopped" });
  expect(messages[0].toolActivity?.map((r) => r.state)).toEqual(["not_run", "unconfirmed"]);
  messages = updateChatToolActivity(messages, "reply", event("b", "completed", Date.now() + 1));
  expect(messages[0].toolActivity?.[1].state).toBe("completed");
});
