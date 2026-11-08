/**
 * The observe → act loop. One "turn" = the model thinks, optionally calls tools,
 * sees the real results, and produces a final spoken reply.
 *
 * Ports two loops from the Python brain:
 *   - the conversational route loop in `main.py` (single round of tool calls), and
 *   - the multi-step agent loop in `autopilot.py` (the `phone_task`/`pc_task` path),
 *     which adds cycle/loop guards, a redo-guard, and the vision-first operator.
 *
 * Ordinary turns start with three rounds and can earn up to six through new
 * successful steps. Explicit scoped budgets remain exact. Independent reads can
 * overlap in batches of three; effects are sequential. All turns also have a
 * 24-call ceiling and repeat guards, with receipts checkpointed before use.
 */

import type { ChatMessage, ToolResult } from "./types";
import type { ToolDeclaration } from "./types";
import { groupOf, LOAD_TOOLS, requestedGroups, toSpec, turnPalette } from "./tools/registry";
import { validateToolCall } from "./tools/validation";
import { hasSideEffect, operationKey, setsAbsoluteState, canonical } from "./tools/operations";
import { dispatch, type DispatchDeps } from "./tools/dispatch";
import { chatOverLadder } from "./ask";
import { agentResult, modelToolResult, type ResultStatus } from "./results";
import { WorkflowJournal, type Workflow } from "./workflow";
import { count } from "./toolMetrics";
import { parallelRead, TOOL_CALL_LIMIT, ADAPTIVE_ROUND_LIMIT, progressing } from "./orchestration";
import { registerRecovery, continuationTools } from "./recovery";
import { conversationObjective } from "./conversation";
import { toolActivity, emitToolActivity, finishToolActivity, reconcileToolActivity, type ToolActivityContext } from "./toolActivity";

const MAX_TOOL_ROUNDS = 3; // backstop against runaway tool loops (cf. cycle guard)

export interface TurnResult {
  status?: ResultStatus;
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
  return `${name}:${JSON.stringify(canonical(args))}`;
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

/** Fed back for a call outside a scoped turn's tools (deps.onlyTools), never run. */
const NOT_OFFERED: ToolResult = {
  ok: false,
  error: "not_offered",
  summary:
    "Not run: that tool isn't available for this request. Do it with the tools you have, " +
    "or say plainly that it can't be done from here.",
};

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
  // Rendering requested text/visuals IS the work. Keep real-world action claims
  // guarded even in a mixed request such as "draft a table and email it".
  const inlineContent =
    /\b(chart|table|flowchart|diagram|draft|poem|story|essay|outline|schedule)\b/i.test(userText) &&
    !/\b(send|save|publish|post|call|dial|open|close|launch|delete|remember|forget|remind|alarm|timer|calendar|install|download|upload)\b|\bschedule\s+(a|an|my|this|the)\b|(?:^|\b(?:and|then|also|please)\s+)(?:email|forward|share|text|message)\b/i.test(
      userText,
    );
  if (
    inlineContent &&
    !/\b(sent|saved|published|posted|called|dialled|deleted|installed|uploaded)\b/i.test(reply)
  )
    return false;
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
  const journal = deps.journal ?? new WorkflowJournal();
  const objective = deps.resumeRun?.objective ?? conversationObjective(messages);
  const run = deps.resumeRun ?? journal.begin(objective);
  if (deps.resumeRun && (!run.scope || run.state !== "running" || !journal.isLive(run.id)))
    throw new Error("Continuation must claim a checked workflow first.");
  // The caller has already included the previous verdict in continuation context.
  if (deps.resumeRun) run.completion = undefined;
  run.scope ??= { onlyTools: deps.onlyTools ? [...deps.onlyTools] : null, informationOnly: !!deps.informationOnly };
  journal.save(run);
  const executionResults: ToolResult[] = run.results.map((result) => ({ ok: result.ok, summary: result.summary, result }));
  const resultActivities = new Map<string, { context: ToolActivityContext; started: number }>();
  const scopedDeps = {
    ...deps,
    ...(deps.resumeRun ? { onlyTools: new Set(continuationTools(run,
      [...(fullTools ?? tools)].map((tool) => tool.name)).filter((name) => !deps.onlyTools || deps.onlyTools.has(name))) } : {}),
    informationOnly: !!deps.informationOnly || !!run.scope.informationOnly,
    shouldStopPhoneTask: () => journal.shouldStop(run.id) || Boolean(deps.shouldStopPhoneTask?.()),
    readAgentResult: (id: string) => journal.readResult(run.id, id),
    reconcileActionOutcome: async (id: string): Promise<ToolResult> => {
      if (run.state !== "running") {
        if (journal.isLive(run.id)) return { ok: false, summary: "A continuation is running; check its current receipts." };
        const saved = journal.list().find((item) => item.id === run.id);
        if (saved) Object.assign(run, saved);
      }
      const operation = run.operations?.find((op) => op.resultId === id);
      const original = run.results.find((r) => r.result_id === id);
      if (!operation?.nativeOutcomeId || !original || !deps.platform?.reconcileOutcome)
        return {
          ok: false,
          error: "no_native_receipt",
          summary:
            "No checkable native receipt exists for that result in this workflow. Check the phone before retrying.",
        };
      if (original.status !== "unverified")
        return {
          ok: true,
          summary: `Recorded action outcome: ${original.status}. ${original.summary}`,
        };
      const execution = executionResults.find((r) => r.result?.result_id === id);
      const actual = execution?.reconcileOutcome
        ? await execution.reconcileOutcome()
        : await deps.platform.reconcileOutcome(operation.nativeOutcomeId);
      if (run.state !== "running" && journal.isLive(run.id))
        return { ok: false, summary: "A continuation is running; check its current receipts." };
      if (run.state !== "running") {
        const saved = journal.list().find((item) => item.id === run.id);
        if (saved) Object.assign(run, saved);
      }
      const current = run.results.find((r) => r.result_id === id)!;
      if (current.status !== "unverified")
        return {
          ok: true,
          summary: `Recorded action outcome: ${current.status}. ${current.summary}`,
        };
      const verified = agentResult(actual, original.remaining[0] ?? objective, operation.tool);
      verified.result_id = original.result_id;
      if (verified.status === "unverified")
        verified.completed = [...new Set([...original.completed, ...verified.completed])];
      const index = run.results.findIndex((r) => r.result_id === id);
      const previous = run.results[index]!;
      const previousReason = run.reason;
      run.results[index] = verified;
      if (run.state === "suspended")
        run.reason =
          verified.status === "unverified"
          ? "The phone still hasn't confirmed this action. Check it before retrying."
          : "The phone replied after the chat ended. Its action result is updated; the full task still needs review.";
      try {
        journal.save(run);
      } catch (error) {
        run.results[index] = previous;
        run.reason = previousReason;
        throw error;
      }
      if (execution) {
        execution.result = verified;
        execution.ok = verified.ok;
        execution.summary = verified.summary;
        execution.error = actual.error;
        execution.verification = actual.verification;
        execution.nativeOutcomeId =
          verified.status === "unverified" ? operation.nativeOutcomeId : undefined;
      }
      const activity = resultActivities.get(id);
      if (activity) reconcileToolActivity(deps.onToolActivity, activity.context, verified, activity.started);
      return {
        ok: true,
        summary: `Original action outcome: ${verified.status}. ${verified.summary}`,
        data: {
          findings: [
            `Original result: ${id}`,
            `Action outcome: ${verified.status}`,
            verified.summary,
          ],
        },
      };
    },
  };
  registerRecovery(run.id, scopedDeps.reconcileActionOutcome);
  try {
    const output = await runTurnSteps(
      messages,
      tools,
      scopedDeps,
      onFallback,
      fullTools,
      journal,
      run,
      executionResults,
      resultActivities,
    );
    if (
      !scopedDeps.shouldStopPhoneTask() &&
      run.state !== "suspended" &&
      run.results.length &&
      (run.results.length > 1 || run.results[0]!.ok) &&
      !run.pending &&
      !output.toolResults.some((r) => r.error === "cancelled")
    ) {
      const uncertain = run.results.some(
        (r) => r.status === "unverified" || r.status === "blocked",
      );
      if (run.metrics && deps.verifyCompletion && !uncertain) run.metrics.model_decisions++;
      const verificationStarted = Date.now();
      const verdict = uncertain
        ? {
            status: "unverified" as const,
            completed: [],
            remaining: ["An earlier action could not be verified"],
          }
        : deps.verifyCompletion
          ? await deps.verifyCompletion(objective, run.results, output.reply,
              (event) => count(run.metrics, event === "request" ? "model_requests" : event === "fallback" ? "fallbacks" : "hedges"))
          : {
              status: "unverified" as const,
              completed: [],
              remaining: ["Objective completion review is unavailable"],
            };
      count(run.metrics, "verifying_ms", Date.now() - verificationStarted);
      run.completion = verdict;
      if (verdict.status !== "succeeded") {
        run.state = "suspended";
        run.reason = `${verdict.status}: ${verdict.remaining.join("; ")}`;
        const readOnly =
          output.calledTools.every((name) =>
            [
              "get_weather",
              "get_news",
              "web_search",
              "read_webpage",
              "read_file",
              "list_directory",
              "get_time",
              "get_day",
              LOAD_TOOLS,
            ].includes(name),
          ) &&
          !/\b(send|save|publish|post|email|share|forward|call|dial|open|close|launch|delete|remember|forget|remind|alarm|timer|calendar|install|download|upload)\b|\b(create|make|write|edit|update)\s+(?:(a|an|the|my|this)\s+)?(file|folder|document|workbook)\b/i.test(
            objective,
          );
        output.reply =
          (readOnly && output.reply.trim() ? output.reply : partialReply(output.toolResults)) +
          (verdict.remaining.length
            ? ` Still unconfirmed: ${verdict.remaining.join("; ")}`
            : " Completion could not be verified.");
      }
    }
    if (output.calledTools.length && !run.results.length) {
      run.state = "suspended";
      run.reason = "No requested tool call passed validation and execution.";
      if (claimedWithoutActing(objective, output.reply, false))
        output.reply = "No action was executed. I couldn't confirm that the request was completed.";
    }
    run.state =
      run.state === "suspended" ||
      run.pending ||
      (run.completion
        ? run.completion.status !== "succeeded"
        : output.toolResults.some((r) => !r.ok))
        ? "suspended"
        : "succeeded";
    // A tool receipt proves its own action. Objective review proves the user's task.
    // Never let final model wording promote a failed or denied action.
    const single = run.results.length === 1 ? run.results[0] : undefined;
    if (!run.completion && single && !single.ok) output.reply = single.summary;
    output.status =
      run.completion?.status ??
      (single && (run.state === "succeeded" || !single.ok)
        ? single.status
        : run.state === "succeeded"
          ? "succeeded"
          : "unverified");
    run.outcome = output.status;
    if (
      scopedDeps.shouldStopPhoneTask() ||
      output.toolResults.some((r) => r.error === "cancelled")
    ) {
      run.state = "suspended";
      run.outcome = "cancelled";
      run.reason = "Stopped by the user. Already-started actions must be checked before retrying.";
      output.status = "unverified";
      if (!output.toolResults.some((r) => r.error === "cancelled")) output.reply = "Stopped.";
    }
    return output;
  } catch (error) {
    run.reason = "Execution interrupted. Inspect completed and pending work before retrying.";
    run.outcome = run.pending ? "unverified" : "failed";
    throw error;
  } finally {
    if (run.state === "running") run.state = "suspended";
    journal.save(run);
  }
}

async function runTurnSteps(
  messages: ChatMessage[],
  tools: ToolDeclaration[],
  deps: DispatchDeps,
  onFallback: ((msg: string) => void) | undefined,
  fullTools: ToolDeclaration[] | undefined,
  journal: WorkflowJournal,
  run: Workflow,
  toolResults: ToolResult[],
  resultActivities: Map<string, { context: ToolActivityContext; started: number }>,
): Promise<TurnResult> {
  const convo = [...messages];
  const calledTools: string[] = [];
  const callHistory: CallRecord[] = [];
  let lastRefusal: ToolResult | undefined;
  const userText = run.objective;
  let claimChecked = false;
  let phoneActedAndFailed = false;
  let completedPhoneTask: ToolResult | undefined;
  let uncertainEffect = Boolean(run.operations?.some((op) => !op.resultId || run.results.find((r) => r.result_id === op.resultId)?.status === "unverified"));
  let observedForContinuation = !deps.resumeRun;
  // tv_control is only on offer with a TV set up; without one there's nothing to look at.
  const tvOffered = [...tools, ...(fullTools ?? [])].some((t) => t.name === "tv_control");
  // Loaded groups widen the palette for the rest of the turn. A round spent only on
  // load_tools doesn't count against the cap, once.
  const loaded = new Set<string>();
  let freeLoadRound = true;
  let maxRounds = Number.isFinite(deps.maxToolRounds)
    ? Math.max(1, Math.min(12, Math.floor(deps.maxToolRounds!)))
    : MAX_TOOL_ROUNDS;
  const progressSignatures: string[] = [];
  let attempted = 0;
  const ask = async () => {
    const started = Date.now();
    try {
      return await chatOverLadder(convo, tools, deps.config, onFallback, {
        onRouteEvent: (event) => count(run.metrics, event === "request" ? "model_requests" : event === "fallback" ? "fallbacks" : "hedges"),
      });
    } finally { count(run.metrics, "choosing_ms", Date.now() - started); }
  };

  for (let round = 0; round < maxRounds; round++) {
    if (deps.shouldStopPhoneTask?.()) {
      run.state = "suspended";
      run.reason = "Stopped by the user.";
      return { reply: "Stopped.", toolResults, calledTools };
    }
    if (run.metrics) run.metrics.model_decisions++;
    const reply = await ask();
    if (deps.shouldStopPhoneTask?.()) {
      run.state = "suspended";
      return { reply: "Stopped.", toolResults, calledTools };
    }

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
      if (
        claimChecked &&
        (claimedWithoutActing(userText, reply.text, ranTools) ||
          answeredPhoneWithoutLooking(userText, ranTools) ||
          (tvOffered && answeredTvWithoutLooking(userText, ranTools)))
      ) {
        run.reason = "The assistant claimed an action without an execution result.";
        run.state = "suspended";
        return {
          reply: "I couldn't confirm that anything was done. Please check before retrying.",
          toolResults,
          calledTools,
        };
      }
      return {
        reply: !ranTools && lastRefusal ? lastRefusal.summary : reply.text,
        toolResults,
        calledTools,
      };
    }

    // The model wants to act. Run each call through the single dispatcher, then
    // feed the REAL results back so the model speaks from truth, not assumption.
    convo.push({ role: "assistant", content: reply.text, toolCalls: reply.toolCalls });
    if (freeLoadRound && reply.toolCalls.every((c) => c.name === LOAD_TOOLS)) {
      freeLoadRound = false;
      round--;
    }
    const successful: string[] = [];
    // Start only contiguous, validated independent reads. A write is always a barrier.
    const startedReads = new Map<number, Promise<ToolResult>>();
    const activities = new Map<number, { context: ToolActivityContext; started: number }>();
    const announce = (index: number) => {
      let entry = activities.get(index);
      if (!entry) {
        const next = reply.toolCalls[index];
        entry = { context: toolActivity(next.name, next.args), started: Date.now() };
        activities.set(index, entry);
        emitToolActivity(deps.onToolActivity, entry.context, "queued");
      }
      return entry;
    };
    const authorized = [...(fullTools ?? tools), ...tools.filter((tool) => tool.name === LOAD_TOOLS)];
    for (let callIndex = 0; callIndex < reply.toolCalls.length; callIndex++) {
      const call = reply.toolCalls[callIndex];
      // STOP may arrive during a model call or the preceding tool in this batch.
      if (deps.shouldStopPhoneTask?.()) {
        run.state = "suspended";
        return { reply: "Stopped.", toolResults, calledTools };
      }
      if (++attempted > TOOL_CALL_LIMIT) {
        run.state = "suspended";
        run.reason = "Tool-call budget reached. Review saved work before continuing.";
        return { reply: partialReply(toolResults), toolResults, calledTools };
      }
      count(run.metrics, "proposed_calls");
      const activity = announce(callIndex);
      let didDispatch = startedReads.has(callIndex);
      calledTools.push(call.name);
      const isPhoneTask = call.name === "phone_task";
      let result: ToolResult;
      const invalid = validateToolCall(call, [
        ...(fullTools ?? tools),
        ...tools.filter((tool) => tool.name === LOAD_TOOLS),
      ]);
      if (deps.onlyTools && call.name !== LOAD_TOOLS && !deps.onlyTools.has(call.name)) {
        count(run.metrics, "scope_rejections");
        result = NOT_OFFERED;
        lastRefusal = result;
      } else if (invalid) {
        count(run.metrics, "invalid_calls");
        result = invalid;
        lastRefusal = result;
      } else if (call.name === LOAD_TOOLS && fullTools) {
        // Not an action: nothing is dispatched and it isn't one of toolResults.
        const groups = requestedGroups(call.args);
        groups.forEach((g) => loaded.add(g));
        const before = new Set(tools.map((t) => t.name));
        tools = turnPalette(fullTools, new Set([...activeGroups(tools), ...loaded]));
        const added = tools.filter((t) => !before.has(t.name)).map((t) => t.name);
        result = groups.length
          ? { ok: true, summary: `Now available: ${added.join(", ") || "already loaded"}.` }
          : { ok: false, summary: "No such group." };
      } else if (isPhoneTask && completedPhoneTask) {
        // phone_task owns the whole phone goal. A reworded handoff must not
        // drive the phone again after its verified success (IMEI lookup, 2026-11-08).
        count(run.metrics, "duplicates_prevented");
        result = {
          ok: false,
          error: "phone_task_already_completed",
          summary: "Not run. The whole phone task already completed in this request. " +
            "Use its saved answer and findings; do not reopen apps or repeat it with another goal. " +
            `Existing result: ${completedPhoneTask.summary}`,
        };
        lastRefusal = result;
      } else if (isPhoneTask && phoneActedAndFailed) {
        result = PHONE_RETRY_REFUSED; // nothing ran, so it isn't one of toolResults
        lastRefusal = result;
      } else if (!observedForContinuation && hasSideEffect(toSpec(call.name, call.args))) {
        result = { ok: false, error: "observe_before_continue",
          summary: "Not run. Inspect current state with a read-only tool before continuing saved work." };
        lastRefusal = result;
      } else if (
        uncertainEffect &&
        run.operations?.some(
          (op) => run.results.find((r) => r.result_id === op.resultId)?.status === "unverified",
        ) &&
        hasSideEffect(toSpec(call.name, call.args))
      ) {
        result = {
          ok: false,
          error: "uncertain_previous_effect",
          summary:
            "Not run. An earlier action in this request may already have taken effect. Do not retry it through another tool or run further changes. Report the existing results and ask the user to check before starting a new request. Read-only checks remain available.",
        };
        lastRefusal = result;
      } else {
        const spec = toSpec(call.name, call.args);
        const key = hasSideEffect(spec) ? await operationKey(spec) : undefined;
        if (deps.shouldStopPhoneTask?.()) {
          run.state = "suspended";
          return { reply: "Stopped.", toolResults, calledTools };
        }
        const previous =
          key &&
          (setsAbsoluteState(spec)
            ? run.operations?.at(-1)?.key === key
              ? run.operations.at(-1)
              : undefined
            : run.operations?.find((op) => op.key === key));
        if (previous) {
          count(run.metrics, "duplicates_prevented");
          const original = run.results.find((r) => r.result_id === previous.resultId);
          result = original?.ok
            ? {
                ok: true,
                summary: `Already completed once in this request; no additional action ran. ${original.summary}`,
                result: {
                  ...original,
                  summary: `Already completed once; no additional action ran. ${original.summary}`,
                },
              }
            : {
                ok: false,
                error: "duplicate_operation",
                summary:
                  "Not run: this action was already attempted in this request. Check its existing outcome before retrying; it may already have taken effect.",
              };
          lastRefusal = result;
        } else {
          const operation: NonNullable<Workflow["operations"]>[number] | undefined = key
            ? { id: `${run.id}:${key}:${run.operations?.length ?? 0}`, key, tool: call.name }
            : undefined;
          if (operation) (run.operations ??= []).push(operation);
          if (!startedReads.has(callIndex) && parallelRead(call.name)) {
            const batch: number[] = [];
            const seen = new Set<string>();
            for (let i = callIndex; i < Math.min(reply.toolCalls.length, callIndex + 3, callIndex + TOOL_CALL_LIMIT - attempted + 1); i++) {
              const next = reply.toolCalls[i];
              const signature = callSig(next.name, next.args);
              if (!parallelRead(next.name) || validateToolCall(next, authorized) ||
                  (deps.onlyTools && !deps.onlyTools.has(next.name)) || seen.has(signature)) break;
              seen.add(signature);
              batch.push(i);
            }
            for (const i of batch) run.plan.push(reply.toolCalls[i].name);
            journal.save(run);
            if (batch.length > 1) count(run.metrics, "parallel_reads", batch.length);
            const reads = batch.map(async (i) => {
              const next = reply.toolCalls[i];
              const nextActivity = announce(i);
              const started = Date.now();
              const receipt: ToolResult = await dispatch(toSpec(next.name, next.args), { ...deps, toolActivity: nextActivity.context })
                .catch(() => ({ ok: false, error: "read_failed", summary: "The read failed. No change was requested." }));
              count(run.metrics, "executing_ms", Date.now() - started);
              return receipt;
            });
            // Drain the bounded batch even after STOP so every started read keeps its receipt.
            const receipts = await Promise.all(reads);
            batch.forEach((i, index) => {
              const next = reply.toolCalls[i];
              const receipt = receipts[index];
              receipt.result = agentResult(receipt, JSON.stringify(next.args), next.name);
              receipt.ok = receipt.result.ok;
              receipt.summary = receipt.result.summary;
              run.results.push(receipt.result);
              toolResults.push(receipt);
              startedReads.set(i, Promise.resolve(receipt));
            });
            journal.save(run);
          }
          if (!startedReads.has(callIndex)) {
            run.pending = { id: operation?.id ?? call.id, tool: call.name, state: "intent_recorded", effect: !!operation };
            run.plan.push(call.name);
            journal.save(run); // commit before the first possible side effect
          }
          const started = Date.now();
          didDispatch = true;
          try { result = await (startedReads.get(callIndex) ?? dispatch(spec, { ...deps, operationId: operation?.id, toolActivity: activity.context })); }
          finally { if (!startedReads.has(callIndex)) count(run.metrics, "executing_ms", Date.now() - started); }
          if (!startedReads.has(callIndex)) result.result = agentResult(result, JSON.stringify(call.args), call.name);
          if (!result.result!.ok && result.ok) {
            result = {
              ...result,
              ok: false,
              summary: result.result!.summary,
              error: "unverified_success",
            };
          }
          if (!startedReads.has(callIndex)) run.results.push(result.result!);
          if (operation) {
            operation.resultId = result.result!.result_id;
            if (result.nativeOutcomeId) operation.nativeOutcomeId = result.nativeOutcomeId;
          }
          run.pending = null;
          journal.save(run); // commit before another agent/model consumes it
          if (!startedReads.has(callIndex)) toolResults.push(result);
          if (result.ok) successful.push(callSig(call.name, call.args));
          if (result.ok && !hasSideEffect(spec)) observedForContinuation = true;
          if (result.nativeOutcomeId) {
            const id = result.result!.result_id;
            resultActivities.set(id, activity);
            deps.platform?.watchOutcome?.(result.nativeOutcomeId, () => {
              void deps.reconcileActionOutcome?.(id).catch(() => {
                // Keep the saved uncertain receipt when reconciliation/storage is unavailable.
              });
            });
          }
          uncertainEffect = Boolean(
            run.operations?.some(
              (op) => run.results.find((r) => r.result_id === op.resultId)?.status === "unverified",
            ),
          );
          if (call.name === "check_action_outcome")
            phoneActedAndFailed = Boolean(
              run.operations?.some(
                (op) =>
                  op.tool === "phone_task" &&
                  toolResults.some((r) => r.result?.result_id === op.resultId && actedAndFailed(r)),
              ),
            );
          if (isPhoneTask && actedAndFailed(result)) phoneActedAndFailed = true;
          if (isPhoneTask && result.ok) completedPhoneTask = result;
          // The user pressed STOP: the turn ends on the task's own words. Another round
          // called it "I wasn't able to complete that task" and offered a retry (TV task,
          // live 2026-10-20).
          if (result.error === "cancelled")
            return { reply: result.summary, toolResults, calledTools };
        }
      }
      if (!didDispatch) finishToolActivity(deps.onToolActivity, activity.context, result, activity.started,
        call.name === LOAD_TOOLS && !!fullTools && result.ok);
      convo.push({
        role: "tool",
        toolCallId: call.id,
        toolName: call.name,
        content: JSON.stringify(modelToolResult(result, JSON.stringify(call.args), call.name)),
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
    if (!Number.isFinite(deps.maxToolRounds) && round === maxRounds - 1 && maxRounds < ADAPTIVE_ROUND_LIMIT &&
        !uncertainEffect && progressing(progressSignatures, successful)) {
      maxRounds++;
      count(run.metrics, "budget_extensions");
    }
    progressSignatures.push(...successful);
  }

  // Hit the round cap. The canned "couldn't fully finish" threw away everything the tools
  // had found — live 2026-09-26, "read my Chrome screen and search up the time" ended that
  // way. One last turn answers from the results; if the model still reaches for a tool (or
  // can't be reached), say what the tools returned rather than nothing.
  convo.push({ role: "user", content: FINAL_ANSWER_NOTE });
  try {
    if (run.metrics) run.metrics.model_decisions++;
    const last = await ask();
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
    .map(
      (r) =>
        `${r.ok ? "" : "(failed) "}${r.summary.trim().slice(0, 800)}${r.summary.trim().length > 800 ? "…" : ""}`,
    );
  return said.length
    ? `I couldn't finish all of that, sir. Here's what I did get: ${said.join(" — ")}`
    : "I worked on that but couldn't fully finish it.";
}
