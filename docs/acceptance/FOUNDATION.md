# Foundation acceptance

Status: **gate closed; physical-device evidence pending** (2026-10-31).

## Repeatable checks

From `jarvis-studio-gui`:

```powershell
npm run typecheck
npm run lint
npm test
npm run test:foundation
npm run test:contracts
npm run test:release-gate
npm run build
npx tauri android build --debug --apk --target aarch64
```

From `jarvis-studio-gui/src-tauri/gen/android`, with Java 17 and the SDK configured:

```powershell
.\gradlew.bat :tauri-plugin-phone:testDebugUnitTest
.\gradlew.bat :tauri-plugin-phone:connectedDebugAndroidTest
```

From the sibling Windows backend:

```powershell
python -m unittest discover -s . -p "test_*.py" -t .
```

Retain the Windows frontend lint/tests/build and `cargo check` / `cargo test --lib`.
From the Android repository root,
`node scripts/check-contracts.mjs ../aura` additionally verifies byte-for-byte
matching contract pins and fixtures across the working copies.

## Five live workflows

Use synthetic test material and the user's authorized accounts/devices. Record
the actual result independently of the assistant's wording. Keep raw task bodies,
credentials, screenshots and document content out of acceptance metrics.

| ID | Repeatable request and setup | Required observation | Deterministic coverage |
|---|---|---|---|
| `phone_action` | Type and speak a supported direct phone control; repeat with app control permission denied, accepted, revoked | Actual device state agrees with the result; refusal is explicit; STOP does not affect the next request | `index`, `dispatch`, `loop`, native operator/policy tests |
| `saved_reminder` | Create a clearly labelled reminder/calendar entry, inspect it, then remove the synthetic item through its normal UI | Saved ID or verified result; an opened calendar draft does not count as saved; refusal/revocation stays honest | `schedule/store`, `reminderTime`, `dispatch`, native tests |
| `sourced_research` | Ask a bounded question whose facts can be checked against two accessible sources | Source URLs survive the answer, unavailable sources remain failures, unsupported claims are marked unconfirmed | `loop`, `completion`, `results`, replay fixtures |
| `pc_handover` | Request a harmless PC task from the phone with PC online; repeat offline, then disconnect just after acceptance | Correlated host result and evidence; ownership stays with accepted executor; reconnect inspects rather than dispatching a duplicate | `remote/pc`, `taskCenter`, Windows workflow/phone-link tests |
| `routine_steps` | Save and run a routine with a supported phone step and a PC step; repeat with PC unavailable | Each step has an actual result; completed work survives partial completion; unavailable work is visible | `schedule/routines`, `loop`, `workflow`, Windows workflow tests |

Run recovery variants: background, screen lock, process death (do not use Android
`am force-stop`, which disables accessibility on the test phone), reboot, network
switch and disconnect immediately after an action. Exercise duplicate submissions,
delayed/reordered events, missing receipts, malformed model responses, denied and
revoked permissions, cancellation and current/previous-version interoperability.
Use a test installation for process-death/upgrade checks; never clear production
app data. Verify settings, all memory stores, paired identities, routines, outputs
and unfinished work before and after an in-place signed upgrade.

TV smoke: status and existing playback/control route. WhatsApp smoke: disabled
mode refuses commands, an unlisted contact cannot execute, and enabled listed
contacts retain the existing narrow tool scope. Sending real messages requires the
user's existing explicit authorization; scripted tests do not send messages.

## Measured evidence and promotion

`foundation-evidence.json` is the actual evidence ledger. It is intentionally empty.
`npm run check:foundation-gate` prints missing requirements and exits nonzero until
the gate passes. Unit-test fixtures in `scripts/foundation-gate.test.mjs` are
synthetic and must never be copied into that ledger as live results.

Set `build_id` to an immutable identifier for **both** candidate binaries/source
revisions (including the Android APK SHA-256). Every record must use that exact
identifier. Each live run has a unique opaque `id`, `kind: "live"`, one workflow ID,
`outcome` (`completed`, `partial`, `failed`, `cancelled`), independently confirmed
`verified`, measured `acknowledgement_ms`, and explicit false values for
`duplicate_external_action`, `unauthorized_action`, `data_loss`, `false_success`.
No outcome may be counted twice or borrowed from another build.
Each run also records `elapsed_ms`, `tool_count`, `intervention_count`, `executor`
(`phone` or `windows`), `failure_category` (`none`, `provider`, `permission`,
`connection`, `verification`, `storage`, `unsupported`, `cancelled`) and
`provider_cost` (null when unknown).

Each `checks` entry is `{ "build_id": "...", "passed": true }` after its actual
check passes. Required keys are exported as `REQUIRED_CHECKS` by the gate module.
`stops` records contain `dispatch_stopped_ms` and `started_actions_reconciled`.
`devices` records use `role` (`samsung_phone`, `windows_pc`, `second_android`) and
`acceptance_passed`. `battery` records use `wake_word`, `device_id`,
`baseline_device_id`, `hours`, `baseline_hours`, `drain_pct`, `baseline_drain_pct`.
Both durations must be eight hours on the same device and matched conditions;
measure wake word enabled and disabled separately.

Promotion requires 100 runs across all five workflows, at least 95% verified
completion overall and 90% per workflow, zero trust/data-loss incidents, 95% of
acknowledgements within two seconds, all measured STOP dispatch cessation within
two seconds with reconciliation, passing candidate checks and device acceptance,
and no battery regression exceeding one percentage point. Expanded beta additionally
requires the second handset. Record live model quality, tools, interventions,
executor and failure category separately; unknown provider cost remains null.

## Results from this implementation

Validation is being recorded here after the final checks. Live-run and battery
counts remain zero until measured on the required hardware.
