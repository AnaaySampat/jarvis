# JARVIS ecosystem maturity plan

## 1. Outcome and agreed approach

Make JARVIS dependable for you and a small beta group, then expand its everyday-work capabilities through gated releases.

The agreed behavior is:

- Prefer the PC when it is connected and can perform the task.
- Otherwise execute supported work on the phone, including background execution.
- Complete portable steps even when Windows-only steps are unavailable; preserve and explain the remaining work.
- Support Google email and calendar first.
- Scheduled workflows may read authorized sources, prepare local outputs, and notify. External writes and interactive actions retain their approval requirements.
- Deliver both workflow packages: capture/meeting preparation/follow-ups, followed by research/documents/spreadsheets.

Keep the existing Android native operator, Windows backend, device authentication, and model-provider choices. Develop against both repositories without replacing their execution engines.

## 2. Delivery sequence

### Milestone 1 — Dependable foundation

**Establish the baseline.** Record the current build, configuration, supported devices, and results for five existing workflows:

1. Voice or typed request → direct phone action.
2. Reminder/calendar request → verified saved result.
3. Research request → sourced answer.
4. Phone request → PC task → result returned.
5. Saved routine → individual step results, including unavailable devices.

Turn these into repeatable acceptance scenarios. Separate deterministic regression tests from live model and device evaluations.

**Improve task recovery and visibility.**

- Extend the existing Tasks view to include conversation workflows alongside phone and PC tasks.
- Present **Queued, Running, Needs you, Completed, Partially completed, Failed, and Cancelled** consistently.
- Show the executing device, completed work, remaining work, last update, and recovery action.
- Reconcile interrupted operations before continuing. Never automatically repeat an operation whose external effect is uncertain.
- Keep STOP available during execution and ensure cancellation cannot affect subsequent tasks.

**Add Ecosystem Health.**

Show connection status, installed versions, compatibility, permission problems, provider availability, connector health, and background-execution readiness. Each actionable problem gets a focused repair action.

Diagnostic exports contain versions, timings, error categories, and opaque task identifiers. Exclude credentials, message bodies, screenshots, document contents, and raw prompts by default.

**Strengthen release checks.**

- Android: typecheck, lint, TypeScript tests, Kotlin unit tests, APK compilation, and instrumented persistence/migration tests.
- Windows: retain frontend, Rust, and backend checks; add shared protocol fixtures and integration tests.
- Test upgrades without deleting settings, memories, paired identities, routines, or unfinished work.
- Add plain-language permission disclosures and verify acceptance, refusal, and revocation behavior.

**Exit gate:** the foundation acceptance suite meets the reliability criteria below. New daily-work features begin only after this gate passes.

### Milestone 2 — Continuous work across devices

**Add capability-aware routing.**

Each device advertises supported operations, available connections, required permissions, and supported contract versions. Route using observed capability and readiness, rather than model guesses about which device can help.

**Make results portable.**

Add shared task summaries, project references, and downloadable generated files. The phone must be able to open a document produced by Windows; a Windows filesystem path alone is insufficient.

**Implement native phone background execution.**

Add a bounded Kotlin runner for portable workflows: source reading, research, synthesis, local document creation, and notifications. Reuse native provider clients, persistence, cancellation, and verification components where possible.

The TypeScript dispatcher starts and observes these jobs through the existing phone bridge. The runner must not depend on a live WebView.

Use WorkManager for durable scheduled execution and checkpointed steps; provide progress and cancellation notifications for active work. Surface OS delays honestly. Android background scheduling and quotas prevent a guarantee of uninterrupted or exact-time execution. [Android background-work guidance](https://developer.android.com/develop/background-work/background-tasks/persistent).

**Add portable Google connections.**

- Implement Google authorization on both platforms using their supported system-browser/native flows.
- Begin with Gmail read access and calendar read access.
- Keep credentials in each platform’s secure storage; never synchronize tokens as ordinary application data.
- Retain existing Windows email connections.
- Phone fallback requires authorization on the phone; missing access appears as a specific setup requirement.
- Draft replies remain local until the user explicitly chooses an external action.

**Exit gate:** identical portable workflows succeed with the PC connected and with it unavailable; task interruption cannot cause duplicate external actions.

### Milestone 3 — Capture, meeting preparation, and follow-up

**Expand Share to JARVIS.**

Accept text, URLs, images, and PDFs through Android sharing. Preserve the existing TV action for supported media links.

Offer five explicit actions: summarize, extract tasks, draft a reply, create a reminder, and save to a project. Preview proposed reminders and external changes before committing them.

**Introduce Today.**

Combine upcoming calendar events, saved follow-ups, prepared drafts, and tasks needing attention. Every item links to its source and has a useful action. Show stale or unavailable sources explicitly.

Refresh on opening Today and through user-enabled background refresh; avoid continuous polling.

**Ship meeting preparation.**

For a selected event, gather relevant email, attached project material, previous decisions, and outstanding commitments. Produce a brief containing context, talking points, questions, and source links.

Afterward, accept typed notes or a voice memo and prepare action items and a follow-up draft. Recording meetings automatically is outside this milestone.

**Add reusable workflow creation.**

Let users save a successful workflow with named inputs, selected sources, output format, and optional schedule. Keep existing imported skills as instructions; a skill must not silently become an executable automation.

**Exit gate:** the full capture → preparation → review → reminder/follow-up journey passes on both execution routes.

### Milestone 4 — Projects, research, and deliverables

**Add project workspaces.**

Store project instructions, selected documents, sources, decisions, tasks, and generated outputs together. Users explicitly associate content with a project; unrelated private content is not added automatically.

**Improve research completion.**

Preserve source URLs and relevant evidence through research, comparison, synthesis, and export. Distinguish unavailable sources and unsupported claims from verified findings.

**Produce usable files.**

Support text, Markdown, PDF, DOCX, CSV, and XLSX inputs within documented limits. Produce Markdown/PDF/DOCX reports and CSV/XLSX tables.

For the initial version, document output supports headings, paragraphs, lists, and tables; spreadsheets support typed cells, basic formatting, and supported formulas. Advanced presentations, macros, and arbitrary template fidelity are deferred.

Generate files from validated structured content, then verify they can be reopened. The phone supports the same basic report/table outputs; an unsupported requested format must be reported rather than silently substituted.

**Exit gate:** users can compare provided material, inspect supporting evidence, and open/edit the resulting report or spreadsheet from either device.

## 3. Shared interfaces and execution rules

**Shared contracts.** Add versioned JSON schemas and golden fixtures for capability descriptions, portable work requests, task summaries, artifact manifests, and workflow templates. Keep the canonical contract bundle in the Android repository and vendor a version-pinned copy into Windows; CI verifies matching versions and fixture behavior.

**Protocol evolution.** Extend the existing signed task protocol through negotiated capabilities. Preserve current task IDs, idempotency keys, event cursors, and verified completion results. Older compatible clients retain existing functionality; new features remain unavailable until both peers support them.

**Routing rule.** At task start, use the PC only when authenticated, responsive, and capable of the required work. Otherwise use the phone. Honor requests naming a particular device. Show the execution choice in the task card.

**Execution ownership.** Once an executor accepts a task, connection loss does not trigger a second execution elsewhere. Reconnect and inspect its recorded status. Safe portable work can continue on another device only after the prior execution is reconciled or explicitly stopped.

**Schedules.** New portable schedules are owned by the phone, which selects the executor when they become due. Windows-only schedules remain PC-owned. Each occurrence has a stable identifier to prevent duplicate runs. Existing routines retain their current ownership and behavior.

**Storage.** Persist portable phone jobs and checkpoints in Room; retain Windows’ SQLite journal. Migrate existing Android conversation checkpoints transactionally, retaining the original data until migration succeeds. Preserve completed outputs and unresolved work across updates.

**Artifacts.** Register files by opaque artifact ID, with filename, media type, size, checksum, producing task, and owning device. Transfer only authorized registered files over the existing TLS or verified Tailscale transport. Support interrupted downloads and checksum verification; reject arbitrary path requests.

**Project synchronization.** Synchronize selected project metadata and attachments over the paired connection. Preserve deletions and surface conflicting edits for selection. Do not silently merge conflicting instructions or overwrite files.

## 4. Validation and release gates

Every milestone includes automated checks, device acceptance evidence, and updated feature-status documentation.

| Area | Required scenarios |
|---|---|
| Routing | PC available, offline, incompatible, missing a connector, and explicitly selected by the user. |
| Recovery | App backgrounding, screen lock, process death, reboot, network switching, and disconnect immediately after an action. |
| Correctness | Duplicate submissions, delayed/reordered events, partial completion, missing evidence, and malformed model responses. |
| Access | Denied/revoked permissions, expired Google authorization, wrong account, disconnected folders, and unavailable sources. |
| Scheduling | Duplicate triggers, time-zone changes, delayed Android execution, cancellation, and missed execution windows. |
| Files | Interrupted transfer, checksum mismatch, unsupported format, insufficient storage, and reopening every generated format. |
| Updates | Fresh installation, upgrade from the current release, preserved pairing/data, and current/previous-version interoperability. |

Proposed beta promotion criteria:

- At least **100 live supported-workflow runs**, distributed across the five foundation workflows.
- At least **95% completion overall**, with no workflow below **90%**.
- Zero observed duplicate external actions, unauthorized actions, data-loss regressions, or false success claims.
- Progress acknowledgement within two seconds for at least 95% of requests.
- STOP prevents dispatch of additional steps within two seconds; already-started external operations are reconciled and reported.
- Battery measurements recorded separately with wake-word listening enabled and disabled; no unexplained regression exceeding one battery percentage point over matched eight-hour runs.
- Validation on the existing Samsung phone and Windows setup, plus a second Android handset before expanding the beta.

Track live model quality separately from scripted tests. Capture elapsed time, tool count, intervention count, execution device, and failure category. Provider cost remains unknown when usage data is unavailable.

## 5. Rollout and boundaries

- Implement each milestone through small, reviewable changes across the two repositories, preserving existing uncommitted work.
- Release features behind explicit beta flags until their milestone gate passes.
- Provide stable and beta update channels, compatible-version information, retained installers, and migration backups. Use forward fixes when a schema downgrade would be unsafe.
- Run a two-week daily-use pilot after the foundation gate; use reported failures to prioritize subsequent fixes.
- Keep bring-your-own model keys and existing pairing. No hosted execution service or new account system is included.
- Preserve current TV and WhatsApp functionality and cover it with regression smoke tests; expand neither during this program.
- Google developer configuration, account consent, signing credentials, and additional test hardware are external prerequisites. Their absence leaves the relevant acceptance gate incomplete.
- Installation acceptance and distribution reviews are tracked separately from code quality. Preserve the currently submitted APK while its review is pending.
- Publish each milestone’s tested capabilities, known limitations, and acceptance results. Progress is determined by passing these gates rather than a fixed calendar deadline.
