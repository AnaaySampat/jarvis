import type { ChatMessage } from "./types";

const SETUP_ACK = /^(?:done|enabled|fixed|it(?:['’]s| is) (?:on|enabled|done)|(?:the )?(?:accessibility|permission|access)(?: is)? (?:done|enabled|on)|i (?:have )?enabled (?:accessibility|permission|access))[.!\s]*$/i;
const SETUP = /\b(?:accessibility|permissions?|folder access|notification access)\b/i;
const NOT_STARTED = /\b(?:not run|no actions?|haven['’]?t done anything|didn['’]?t (?:run|do|start)|couldn['’]?t (?:start|control)|request_tool_access)\b/i;
const UNCERTAIN = /\b(?:may|might|could) (?:already )?have\b|\b(?:unknown outcome|outcome (?:(?:is|remains) )?unknown|check (?:the )?(?:screen|phone) before|already (?:sent|saved|executed|completed))\b/i;

/** Resolve only an acknowledgment of setup that prevented execution. This changes
 *  the objective checked by the normal loop; it never dispatches or grants access. */
export function conversationObjective(messages: ChatMessage[]): string {
  let userIndex = messages.length - 1;
  while (userIndex >= 0 && messages[userIndex].role !== "user") userIndex--;
  if (userIndex < 0) return "";
  const current = messages[userIndex].content;
  if (!SETUP_ACK.test(current.trim())) return current;
  const earlier = messages.slice(0, userIndex);
  let replyIndex = earlier.length - 1;
  while (replyIndex >= 0 && earlier[replyIndex].role !== "assistant") replyIndex--;
  if (replyIndex < 0) return current;
  const reply = earlier[replyIndex].content;
  if (!SETUP.test(reply) || !NOT_STARTED.test(reply) || UNCERTAIN.test(reply)) return current;
  return conversationObjective(earlier.slice(0, replyIndex)) || current;
}
