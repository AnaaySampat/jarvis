/**
 * The observe → act loop. One "turn" = the model thinks, optionally calls tools,
 * sees the real results, and produces a final spoken reply.
 *
 * Ports two loops from the Python brain:
 *   - the conversational route loop in `main.py` (single round of tool calls), and
 *   - the multi-step agent loop in `autopilot.py` (the `phone_task`/`pc_task` path),
 *     which adds cycle/loop guards, a redo-guard, and the vision-first operator.
 *
 * This scaffold implements the SHAPE (bounded tool-call rounds with a truthful
 * final answer) plus a same-repeat guard mirroring the phone operator's cycle guard
 * (scaled down: with only MAX_TOOL_ROUNDS=3 rounds there's no room for the
 * operator's longer window-based cycle detector to matter — the useful signal at
 * this scale is "the model just repeated an identical call and got an identical
 * result", which means one more round won't help either).
 */

import type { ChatMessage, ToolResult } from "./types";
import type { ToolDeclaration } from "./types";
import { toSpec } from "./tools/registry";
import { dispatch, type DispatchDeps } from "./tools/dispatch";
import { chatOverLadder } from "./ask";

const MAX_TOOL_ROUNDS = 3; // backstop against runaway tool loops (cf. cycle guard)

export interface TurnResult {
  reply: string;
  toolResults: ToolResult[];
}

interface CallRecord {
  sig: string;
  resultSig: string;
}

/** Coarse signature for a tool call — same shape twice in a row is the stuck signal. */
function callSig(name: string, args: Record<string, unknown>): string {
  return `${name}:${JSON.stringify(args)}`;
}

/** True when the last recorded call had the exact same call + result as this one. */
function stuckOnRepeat(history: CallRecord[], sig: string, resultSig: string): boolean {
  const last = history[history.length - 1];
  return last !== undefined && last.sig === sig && last.resultSig === resultSig;
}

/** An action-shaped request. Port of groq_bridge.py `_ACTIONY_RE`. */
const ACTIONY_RE = new RegExp(
  "\\b(open|close|launch|start|stop|play|pause|search|google|set|turn|mute|" +
    "unmute|volume|screenshot|capture|record|remind|reminder|timer|schedule|" +
    "shut\\s*down|shutdown|restart|reboot|sleep|lock|delete|remember|forget|click|" +
    "type|scroll|browse|browser|navigate|go\\s+to|show|hide|expand|collapse|" +
    "clear|wipe|empty|reset|watch|find|look\\s+up|check|visit|buy|order|book|" +
    "generate|create|make|draw|read|list|directions|news|weather|nearby|" +
    "change|switch|adjust|recolou?r|colou?r|rename|move|swap|increase|decrease|" +
    "raise|lower|enable|disable|toggle|customi[sz]e|dim|brighten|resize|" +
    "rearrange|update|edit|apply)\\b",
  "i",
);

/** A reply asserting the deed is done. Port of main.py `_COMPLETION_CLAIM_RE`: kept
 *  to completion-claim verbs so Q&A that merely mentions a command word passes. */
const COMPLETION_CLAIM_RE = new RegExp(
  "(?:\\bi['’]?ve\\b|\\bi have\\b|\\bdone\\b|\\ball set\\b|\\bconsider it done\\b|" +
    "\\bright away\\b|\\bas you wish\\b|\\bhere you go\\b|\\bthere you go\\b|\\bon it\\b|" +
    "\\b(?:is|are|it['’]?s)\\s+now\\b|" +
    "\\b(?:set|changed|changing|switched|switching|turned|turning|toggled|toggling|" +
    "opened|opening|closed|closing|started|starting|stopped|stopping|" +
    "launched|launching|played|playing|paused|pausing|muted|muting|unmuted|" +
    "unmuting|created|creating|made|making|generated|generating|enabled|enabling|" +
    "disabled|disabling|adjusted|adjusting|updated|updating|applied|applying|" +
    "recolou?red|recolou?ring|moved|moving|hidden|hiding|shown|showing)\\b)",
  "i",
);

/**
 * "Said it did it but didn't": an action-shaped request, no tool ran this turn, and
 * a reply that claims the deed is done. Live 2026-09-23: Groq gpt-oss-120b answered
 * a phone task with "I've opened Android's Accessibility settings…" and no tool
 * call — a copy of an earlier (true) assistant turn in the history it was sent.
 */
export function claimedWithoutActing(userText: string, reply: string, ranTools: boolean): boolean {
  return !ranTools && ACTIONY_RE.test(userText) && COMPLETION_CLAIM_RE.test(reply);
}

const CLAIM_CHECK_NOTE =
  "(Automatic check, not from the user.) Your reply said something was done, but you " +
  "called no tool in this turn, so nothing has happened. If the request needs an " +
  "action, call the right tool now. Otherwise answer without saying you did anything.";

/** A request about the user's own phone — its settings, an app on it. */
const PHONE_REF_RE =
  /\b(?:on|in|from) (?:my|the) phone\b|\bmy phone['’]?s\b|\b(?:in|from) (?:the )?settings\b|\bin the [\w ]{1,20}? app\b/i;

/**
 * "Answered about the phone without looking": the user asked about their phone and the
 * reply came with no tool call. Live 2026-09-26, on a fallback chat model: "Android 14"
 * for a phone on 16, and an uptime of "3 hours 29 minutes" for one up almost four days.
 */
export function answeredPhoneWithoutLooking(userText: string, ranTools: boolean): boolean {
  return !ranTools && PHONE_REF_RE.test(userText);
}

const PHONE_CHECK_NOTE =
  "(Automatic check, not from the user.) The user asked about their phone, but you called " +
  "no tool in this turn, so your reply didn't come from the phone. If the answer depends on " +
  "what is on the phone right now (a setting, a value, what an app shows) or asks you to do " +
  "something there, call phone_task now. Otherwise answer again without stating any phone " +
  "value you haven't read.";

/**
 * Run one user turn to completion. `tools` is the tier-tailored palette; `deps`
 * carries platform+memory+remote (and the config the route ladder is built from).
 *
 * TODO(phase-1): streaming partial speech; the summary-incompleteness guard.
 */
export async function runTurn(
  messages: ChatMessage[],
  tools: ToolDeclaration[],
  deps: DispatchDeps,
  onFallback?: (msg: string) => void,
): Promise<TurnResult> {
  const convo = [...messages];
  const toolResults: ToolResult[] = [];
  const callHistory: CallRecord[] = [];
  const userText = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  let claimChecked = false;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const reply = await chatOverLadder(convo, tools, deps.config, onFallback);

    if (!reply.toolCalls.length) {
      // One silent recovery round, as main.py did: the claim is never spoken, and the
      // model gets to either make the call it skipped or answer honestly.
      const ranTools = toolResults.length > 0;
      const note = claimChecked
        ? null
        : claimedWithoutActing(userText, reply.text, ranTools)
          ? CLAIM_CHECK_NOTE
          : answeredPhoneWithoutLooking(userText, ranTools)
            ? PHONE_CHECK_NOTE
            : null;
      if (note) {
        claimChecked = true;
        console.warn("[turn] reply made no tool call where one was due — rechecking");
        convo.push({ role: "assistant", content: reply.text });
        convo.push({ role: "user", content: note });
        continue;
      }
      return { reply: reply.text, toolResults };
    }

    // The model wants to act. Run each call through the single dispatcher, then
    // feed the REAL results back so the model speaks from truth, not assumption.
    convo.push({ role: "assistant", content: reply.text, toolCalls: reply.toolCalls });
    for (const call of reply.toolCalls) {
      const spec = toSpec(call.name, call.args);
      const result = await dispatch(spec, deps);
      toolResults.push(result);
      convo.push({
        role: "tool",
        toolCallId: call.id,
        toolName: call.name,
        content: JSON.stringify({ ok: result.ok, summary: result.summary }),
        ...(result.images ? { images: result.images } : {}),
      });

      const sig = callSig(call.name, call.args);
      const resultSig = `${result.ok}:${result.summary}`;
      if (stuckOnRepeat(callHistory, sig, resultSig)) {
        // Identical call, identical result, back to back — another round won't
        // change the outcome. Degrade gracefully instead of burning the budget.
        return {
          reply:
            "I caught myself repeating the same step with no change, sir — stopping here rather than going in circles.",
          toolResults,
        };
      }
      callHistory.push({ sig, resultSig });
    }
  }

  // Hit the round cap — summarise honestly rather than claim completion.
  return {
    reply: "I worked on that but couldn't fully finish it.",
    toolResults,
  };
}
