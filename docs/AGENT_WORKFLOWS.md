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

The assistant uses a second completion model only for complex objectives (research,
comparison, planning or several requested actions) or turns that execute multiple
tools. Simple single-tool turns use the tool's actual status; failed/denied/unverified
receipts cannot be promoted by the assistant's wording. Native operator verification
and user approvals remain independent of this conversational policy. A plain local
weather question goes through the same dispatcher and journal, then returns the
weather tool's readable answer directly: no model wording or completion calls.
Plain local notification reads use the same direct dispatcher/journal/history path,
returning the native reader's formatted, verification-code-redacted text without
sending the bodies to a model. Filtered, compound and remote/scoped requests retain
the existing routing and permission limits.

For complex work, the assistant reviews both the answer and executed tool evidence
against the original task. Missing
requirements or an unavailable completion checker leave the workflow suspended and
produce a partial/unverified reply. A repeated claim made without any tool execution
is replaced with an honest unconfirmed result.

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
never replayed. Native Room/foreground-service recovery still handles phone actions.
The saved goal, pending call and completed results support inspection before a fresh
attempt. Conversation orchestration remains subject to Android WebView lifecycle;
the native operator continues independently while the WebView is backgrounded.

Workflow metrics record elapsed time, logical TypeScript model decisions, tool
calls and unverified outcomes. Native operator inference has its own diagnostics;
these counts do not include its model requests. Provider cost is `null` when usage
accounting is unavailable.

## Evaluation

From `jarvis-studio-gui`:

```powershell
npm run test:workflow
npm run typecheck
npm test
```

Workflow scenarios check long handovers, exact values and sources, artifact transfer,
cross-workflow isolation, missing receipts, storage failures, partial completion and
checker outages. The ordinary loop and dispatcher suites also test STOP, duplicate
actions and tool restrictions. Tests use scripted provider replies and local storage;
they measure regression behavior rather than live model quality, device latency or
provider cost. The existing live replay suite remains available as `npm run test:live`.

## Research on the phone

The Research agent searches and reads public sources on Android even while a PC is
paired. Its tool scope contains only `web_search`, `read_webpage` and
`read_agent_result`; it cannot dispatch PC tasks or change the phone. It has ten
tool rounds (ordinary turns retain three), followed by the evidence completion
review when the objective or executed work is complex. STOP is checked between
rounds, and research replies are saved in the chat. Read-only findings survive a
checker outage with an explicit unverified note rather than a raw-page dump.

The Android-only `phone-research` capability permits source URLs beyond the API
host list. The page reader checks each URL, including redirects, refuses private
hosts and embedded credentials, and bounds redirect chains. It reads HTML text;
sites requiring JavaScript, login or anti-bot challenges may still need another
source. Failed pages remain failures in the evidence rather than successful reads.
