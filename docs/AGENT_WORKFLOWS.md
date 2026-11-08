# Agent workflow contracts

The TypeScript assistant and native Kotlin phone operator keep their existing
execution paths. Conversation-level checkpoints in `jarvis.android.workflows.v1`
supplement the native Room task journal. They record the objective, tool plan,
pending call and full results before a later model or specialist consumes them.
Provider messages, API keys and request headers are excluded from these checkpoints.

Version-1 results share these fields with Windows: `result_id`, `status`, `ok`,
`summary`, `findings`, `artifacts`, `completed`, `remaining`, `evidence`.
The status vocabulary is `succeeded`, `partial`, `failed`, `blocked`, `unverified`.
Structured findings and artifact references are included in model tool messages;
arbitrary tool `data` is not forwarded. Native phone completion requires a valid
verification receipt, and PC completion requires the signed host's passed evidence
proof. A plain boolean success claim is insufficient for these delegated tasks.

The assistant reviews every successful model-routed tool turn against the original
objective, including a single tool: a successful open cannot prove a requested save.
Failed/denied/unverified receipts cannot be promoted by the assistant's wording. Native operator verification
and user approvals remain independent of this conversational policy. A plain local
weather question goes through the same dispatcher and journal, then returns the
weather tool's readable answer directly: no model wording or completion calls.
Plain local notification reads use the same direct dispatcher/journal/history path,
returning the native reader's formatted, verification-code-redacted text without
sending the bodies to a model. Filtered, compound and remote/scoped requests retain
the existing routing and permission limits.

Unambiguous whole local commands for absolute media volume and single-unit timers
also bypass model calls, using the same schema, dispatcher and operation journal.
They return the actual native result; an accepted Clock intent remains unverified.
Compound/relative commands, photos, picked agents and incoming requests retain model
routing. These deterministic commands work without an AI key.

Ordinary turns start with three rounds and can earn extensions to six for new
successful steps without uncertain effects. Explicit scoped budgets remain exact;
all turns have a 24-proposal ceiling. Up to three adjacent independent HTTP/time/file
reads can run concurrently. Effects, native UI reads and scope changes remain ordered.
STOP prevents queued effects and retains all started read receipts.

For tool-backed work, the assistant reviews both the answer and executed tool evidence
against the original task. Missing
requirements or an unavailable completion checker leave the workflow suspended and
produce a partial/unverified reply. A repeated claim made without any tool execution
is replaced with an honest unconfirmed result.

Before dispatch, the model's tool name and arguments must match the authorized full
palette's schema and action requirements. Errors are returned as tool feedback for
correction; unknown/internal action names never pass through to dispatch. Effect
identities are canonical action hashes recorded before dispatch, with stable operation
IDs and result references. Duplicate effects are handled before execution, including
duplicates across model rounds; uncertain attempts are not replayed. Read-only calls
remain repeatable, and absolute state may be restored after another mutation.
After an uncertain side effect, further changes in the same request are refused,
including retries through a different tool; read-only checks can still run.
Interrupted operation records survive journal recovery without automatic replay.

Native state-readback verification is retained across the Rust/TypeScript bridge.
The actual media stream index must match the requested quantized volume. An accepted
Clock intent is unverified and asks the user to check Clock; it is not a saved-alarm
or running-timer receipt. A saved agenda entry alone cannot complete a reminder whose
alarm/timer is unconfirmed.

Tool screenshots, like user photos, require a client that transmits images on every
route, fallback and hedge. The text-only compatible client refuses those requests.
Runtime availability filters unavailable tools and annotates missing access; the
dispatcher rechecks access before execution. `request_tool_access` opens the existing
Android permission or folder setup and does not grant it. Recording is not advertised;
image generation and web search depend on the credentials their implementations use.

Native timeouts and lost transport acknowledgements are unknown outcomes. The
original promise remains live; the workflow operation stores only an opaque receipt
reference. `check_action_outcome(result_id)` reads the original reply, updates that
action's result under its original ID and checkpoints it before another consumer
sees it. Current state alone does not prove an unfinished invocation is finished.
Late replies also backfill action evidence after the chat ends, without running
another action or spending a model call; overall task completion still needs review.
Callbacks and raw receipts are not serialized. A process restart that loses a generic
receipt leaves it unknown; native phone-task Room verification can still be checked.
A lost start acknowledgement polls the original phone task instead of replaying it.
Compound agenda/calendar changes retain uncertainty, and a late event ID is attached
only to one unchanged agenda row without creating another event or row.

`consult_agent` asks Research, Files, Scheduling or Content for information or a
draft. Helpers use an isolated task package and a restricted read-only palette.
The dispatcher also enforces that restriction, including the action of agenda
tools. Each parent turn permits at most two consultations; helpers cannot recurse.
Helper conversations are not appended to the user's chat history. A consultation
does not grant permission to execute more work on the phone or PC.

`read_agent_result(result_id)` retrieves full results within the current workflow.
Specialists receive their responsibility and completion condition without unrelated
conversation history, routines, playbooks or user facts. Existing user-requested
phone and PC actions retain their authorization paths.

On app initialization, interrupted TypeScript workflows become suspended. Live
workflows in the same JavaScript runtime are preserved when React recreates the
brain after a connection or configuration change. Interrupted workflows are
never automatically replayed. New records retain their original tool limits. Tasks
shows completed, uncertain and remaining work, with explicit outcome checks and
continuation. Checking never dispatches a new action. A single-use 60-second ticket
binds continuation to an unchanged checked checkpoint; it synchronously claims that
same workflow. Pending effects, missing legacy scope, unresolved native receipts and
blocked approvals prevent continuation. A fresh read precedes new changes, and
completed action families plus broad alternate executors are withheld. Work that
needs a protected action again requires a fresh user request. Completed opaque phone/PC
tasks permit read-only continuation. Native Room/foreground-service recovery still
handles phone actions. Conversation orchestration remains subject to Android WebView lifecycle;
the native operator continues independently while the WebView is backgrounded.

New workflow metrics also record choosing, summed tool-execution and completion-review
time, actual TypeScript provider requests, fallback replies, hedges, invalid and duplicate
attempts, parallel reads, extensions and recovery. Tasks summarizes measured tool work
in its list, excluding legacy/text-only turns. Diagnostic exports allow numeric counters
only in both TypeScript and Kotlin. Native operator inference has separate diagnostics;
these counts exclude its model requests. Provider cost stays `null` without accounting.
Unlabelled production turns have no invented selection-accuracy score.

## Evaluation

From `jarvis-studio-gui`:

```powershell
npm run test:workflow
npm run test:tool-evals
npm run typecheck
npm test
```

Workflow scenarios check long handovers, exact values and sources, artifact transfer,
cross-workflow isolation, missing receipts, storage failures, partial completion and
checker outages. The ordinary loop and dispatcher suites also test STOP, duplicate
actions and tool restrictions. Tests use scripted provider replies and local storage;
they measure regression behavior rather than live model quality, device latency or
provider cost. Recorded first-reply selection scores use fixture labels and do not
represent current model quality; replay still checks that guards produce the expected
execution. `npm run test:live` reports labelled selection accuracy and latency from
actual model replies when explicitly run with a provider key. Neither suite executes
real device actions.

## Research on the phone

The Research agent searches and reads public sources on Android even while a PC is
paired. Its tool scope contains only `web_search`, `read_webpage` and
`read_agent_result`; it cannot dispatch PC tasks or change the phone. It has ten
tool rounds (ordinary turns start with three and can earn up to six), followed by the evidence completion
review. STOP is checked between
rounds, and research replies are saved in the chat. Read-only findings survive a
checker outage with an explicit unverified note rather than a raw-page dump.

The Android-only `phone-research` capability permits source URLs beyond the API
host list. The page reader checks each URL, including redirects, refuses private
hosts and embedded credentials, and bounds redirect chains. It reads HTML text;
sites requiring JavaScript, login or anti-bot challenges may still need another
source. Failed pages remain failures in the evidence rather than successful reads.
