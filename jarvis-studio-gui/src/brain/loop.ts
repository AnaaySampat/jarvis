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
import { groupOf, LOAD_TOOLS, requestedGroups, toSpec, turnPalette } from "./tools/registry";
import { dispatch, type DispatchDeps } from "./tools/dispatch";
import { chatOverLadder } from "./ask";

const MAX_TOOL_ROUNDS = 3; // backstop against runaway tool loops (cf. cycle guard)

export interface TurnResult {
  reply: string;
  toolResults: ToolResult[];
  /** Every tool the model called this turn (load_tools included). */
  calledTools: string[];
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

/** A phone task that went through with at least one action on the phone and then failed.
 *  Running another — reworded or not — repeats what it already did. Live 2026-10-19, "click
 *  a photo": the first task stopped after 4 shutter taps, and the chat model re-ran it with
 *  a new goal 6 s later, which took 4 more. */
function actedAndFailed(r: ToolResult): boolean {
  return !r.ok && (r.data as { acted?: boolean } | undefined)?.acted === true;
}

/** Fed back in place of a phone_task that was refused, never run. */
const PHONE_RETRY_REFUSED: ToolResult = {
  ok: false,
  error: "retry_refused",
  summary:
    "Not run. The phone task before this one already acted on the phone and then failed, so " +
    "another one now (even reworded) could repeat what it did — another photo, another message. " +
    "Tell the user what that task did and that it couldn't be confirmed, and ask them to check " +
    "the phone before you try again.",
};

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
    "rearrange|update|edit|apply|" +
    // Media follow-ups. Live 2026-09-30: "Resume" got "Resumed — back to Arcane on
    // Netflix" with no tool call (and the wrong show), and neither word was listed.
    "resume|unpause|skip|rewind|fast\\s*forward|louder|quieter|" +
    // Messaging and calls. Live 2026-10-18: "can you reply to <contact>'s notification by
    // saying …" got "I've sent the reply" with no tool call — none of these were listed.
    "send|message|text|reply|respond|answer|call|dial|ring|whatsapp|sms|email|forward|share|post)\\b",
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
    "recolou?red|recolou?ring|moved|moving|hidden|hiding|shown|showing|" +
    "resumed|resuming|unpaused|skipped|skipping|rewound|rewinding|" +
    "sent|sending|messaged|messaging|texted|texting|replied|replying|calling|called|" +
    "dial(?:l)?ing|dial(?:l)?ed|forwarded|forwarding|shared|sharing|posted|posting|" +
    "routing|routed|navigating|navigated|heading)\\b|" +
    // A reply that opens with an acknowledgement and asks nothing is a claim too.
    // Live 2026-10-18: "increase the volume" → "OK." and "set a route to …" → "Got it —
    // routing you to …", both with no tool call. "OK — for what time?" is a question.
    "^\\s*(?:ok(?:ay)?|sure(?: thing)?|got it|will do|alright|certainly|of course|understood)" +
    "\\b(?![^?]*\\?))",
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

/** A request about the user's own phone — its settings, its state, an app on it. It used
 *  to need "on my phone"/"my phone's", so "what model is my phone?" or "what's my battery
 *  at?" got no recheck — the phrasings a fallback model is likeliest to answer from memory. */
const PHONE_REF_RE = new RegExp(
  "\\b(?:my|this) (?:phone|device)\\b|\\b(?:on|in|from) the phone\\b|\\b(?:in|from) (?:the )?settings\\b|" +
    "\\bin the [\\w ]{1,20}? app\\b|\\bandroid version\\b|" +
    "\\bmy (?:battery|storage|wi-?fi|bluetooth|ringtone|wallpaper|screen timeout|uptime|data usage)\\b|" +
    // What's showing changes minute to minute. Live 2026-10-18: "can you check my
    // notifications?" got "there are none" from the previous turn, with no tool call.
    "\\b(?:my|any|new|unread) (?:notifications?|messages|texts|missed calls)\\b",
  "i",
);

/**
 * "Answered about the phone without looking": the user asked about their phone and the
 * reply came with no tool call. Live 2026-09-26, on a fallback chat model: "Android 14"
 * for a phone on 16, and an uptime of "3 hours 29 minutes" for one up almost four days.
 */
export function answeredPhoneWithoutLooking(userText: string, ranTools: boolean): boolean {
  return !ranTools && PHONE_REF_RE.test(userText);
}

/** A question or request about the TV. Live 2026-10-19 on a fallback model (Groq
 *  qwen3.8-27b): "what's on my TV right now?" got "there's nothing playing on the TV"
 *  with no tool call, while the TV wasn't even reachable. */
const TV_REF_RE = /\b(?:my|the) (?:tv|television)\b/i;

/** "Answered about the TV without looking" — the TV twin of the phone check below. */
export function answeredTvWithoutLooking(userText: string, ranTools: boolean): boolean {
  return !ranTools && TV_REF_RE.test(userText);
}

const TV_CHECK_NOTE =
  "(Automatic check, not from the user.) The user asked about their TV, but you called no " +
  "tool in this turn, so your reply didn't come from the TV. Call tv_control now: status for " +
  "what's playing, look to see the screen, or the action they asked for. Otherwise answer " +
  "again without stating anything about the TV you haven't read.";

const PHONE_CHECK_NOTE =
  "(Automatic check, not from the user.) The user asked about their phone, but you called " +
  "no tool in this turn, so your reply didn't come from the phone. If the answer depends on " +
  "what is on the phone right now (a setting, a value, what an app shows) or asks you to do " +
  "something there, call the matching phone tool now (device_control, send_message, " +
  "read_notifications, … or phone_task). Otherwise answer again without stating any phone " +
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
  /** The whole palette, when `tools` is this turn's slice of it (turnPalette): what
   *  load_tools can add from. Without it, load_tools isn't on offer. */
  fullTools?: ToolDeclaration[],
): Promise<TurnResult> {
  const convo = [...messages];
  const toolResults: ToolResult[] = [];
  const calledTools: string[] = [];
  const callHistory: CallRecord[] = [];
  const userText = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  let claimChecked = false;
  let phoneActedAndFailed = false;
  // tv_control is only on offer with a TV set up; without one there's nothing to look at.
  const tvOffered = [...tools, ...(fullTools ?? [])].some((t) => t.name === "tv_control");
  // Loaded groups widen the palette for the rest of the turn. A round spent only on
  // load_tools doesn't count against the cap, once.
  const loaded = new Set<string>();
  let freeLoadRound = true;

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
            : tvOffered && answeredTvWithoutLooking(userText, ranTools)
              ? TV_CHECK_NOTE
              : null;
      if (note) {
        claimChecked = true;
        console.warn("[turn] reply made no tool call where one was due — rechecking");
        convo.push({ role: "assistant", content: reply.text });
        convo.push({ role: "user", content: note });
        continue;
      }
      return { reply: reply.text, toolResults, calledTools };
    }

    // The model wants to act. Run each call through the single dispatcher, then
    // feed the REAL results back so the model speaks from truth, not assumption.
    convo.push({ role: "assistant", content: reply.text, toolCalls: reply.toolCalls });
    if (freeLoadRound && reply.toolCalls.every((c) => c.name === LOAD_TOOLS)) {
      freeLoadRound = false;
      round--;
    }
    for (const call of reply.toolCalls) {
      calledTools.push(call.name);
      const isPhoneTask = call.name === "phone_task";
      let result: ToolResult;
      if (call.name === LOAD_TOOLS && fullTools) {
        // Not an action: nothing is dispatched and it isn't one of toolResults.
        const groups = requestedGroups(call.args);
        groups.forEach((g) => loaded.add(g));
        const before = new Set(tools.map((t) => t.name));
        tools = turnPalette(fullTools, new Set([...activeGroups(tools), ...loaded]));
        const added = tools.filter((t) => !before.has(t.name)).map((t) => t.name);
        result = groups.length
          ? { ok: true, summary: `Now available: ${added.join(", ") || "already loaded"}.` }
          : { ok: false, summary: "No such group." };
      } else if (isPhoneTask && phoneActedAndFailed) {
        result = PHONE_RETRY_REFUSED; // nothing ran, so it isn't one of toolResults
      } else {
        result = await dispatch(toSpec(call.name, call.args), deps);
        toolResults.push(result);
        if (isPhoneTask && actedAndFailed(result)) phoneActedAndFailed = true;
        // The user pressed STOP: the turn ends on the task's own words. Another round
        // called it "I wasn't able to complete that task" and offered a retry (TV task,
        // live 2026-10-20).
        if (result.error === "cancelled")
          return { reply: result.summary, toolResults, calledTools };
      }
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
          calledTools,
        };
      }
      callHistory.push({ sig, resultSig });
    }
  }

  // Hit the round cap. The canned "couldn't fully finish" threw away everything the tools
  // had found — live 2026-09-26, "read my Chrome screen and search up the time" ended that
  // way. One last turn answers from the results; if the model still reaches for a tool (or
  // can't be reached), say what the tools returned rather than nothing.
  convo.push({ role: "user", content: FINAL_ANSWER_NOTE });
  try {
    const last = await chatOverLadder(convo, tools, deps.config, onFallback);
    if (!last.toolCalls.length && last.text.trim())
      return { reply: last.text, toolResults, calledTools };
  } catch {
    // Fall through to the tools' own words.
  }
  return { reply: partialReply(toolResults), toolResults, calledTools };
}

/** The groups whose tools a palette already carries. */
function activeGroups(tools: ToolDeclaration[]): string[] {
  return tools.map((t) => groupOf(t.name)).filter((g): g is string => Boolean(g));
}

const FINAL_ANSWER_NOTE =
  "(Automatic note, not from the user.) You have used every tool call this request allows. " +
  "Answer the user now, in plain words, from the tool results above: give whatever they found, " +
  "and say plainly what you couldn't do. Do not call any tool.";

/** What the tools returned, when the model can't be asked to put it in words. */
export function partialReply(results: ToolResult[]): string {
  const said = results
    .filter((r) => r.summary?.trim())
    .slice(-3)
    .map((r) => `${r.ok ? "" : "(failed) "}${r.summary.trim()}`);
  return said.length
    ? `I couldn't finish all of that, sir. Here's what I did get: ${said.join(" — ")}`
    : "I worked on that but couldn't fully finish it.";
}
