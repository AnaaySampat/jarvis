# Ecosystem maturity implementation

The program follows [the supplied plan](ECOSYSTEM-PLAN.md) in milestone order.
The foundation gate is **closed**. Milestones 2–4 must not ship until the preceding
acceptance gate passes. No live acceptance runs have been invented or inferred
from scripted tests. Existing native phone execution, signed PC task execution,
provider choices, pairing, TV, WhatsApp and routine ownership are retained.

## Foundation changes

- Settings → Ecosystem Health → **Foundation preview** explicitly enables the new
  conversation task cards, health checks and diagnostic export. It defaults off.
- Tasks combines conversation checkpoints with native phone and PC activity.
  The displayed states are Queued, Running, Needs you, Completed, Partially
  completed, Failed and Cancelled. Cards retain results, remaining work, executor
  and update time. Review opens the conversation without executing anything.
  Clear finished only hides finished conversation cards for this session; it does
  not erase checkpoints or unresolved work.
- STOP is checked after a model response and before every tool, including tools
  batched in the same response. Workflow cancellation is scoped to its identifier;
  an old card cannot cancel a subsequent workflow. Already-started native/PC
  actions retain their existing cancellation and reconciliation paths. Unknown
  effects remain Needs you; interrupted actions are never automatically replayed.
- Health reads installed Android version, permission state, notification access,
  battery exemption and OS background restrictions through the existing bridge.
  It refreshes on opening and return from Android settings. The PC version comes
  only from its authenticated signed handshake; older hosts can omit it. Provider
  credentials being present is not reported as proof of provider availability.
- Diagnostics contain a closed projection of versions, numeric timings/counts,
  error categories and report-local task IDs. Both TypeScript and Kotlin rebuild
  the export from an allow-list. Prompts, goals, raw errors, provider route IDs,
  results, messages, screenshots, document bodies and credentials are excluded.
  Export opens Android's share/save chooser and grants access to that one file.
- The canonical versioned JSON schemas and golden fixtures live in
  `contracts/ecosystem-v1`. Windows vendors an identical SHA-256-pinned copy.
  These define future portable interfaces; they do not enable portable execution.
- CI adds lint, contract/gate checks, Kotlin tests, debug APK compilation and
  emulator persistence/migration/secure-storage instrumentation. Windows keeps
  its frontend, Rust and backend checks and gains shared fixtures plus an actual
  SQLite interruption integration test.
- Stable tagged releases require passing measured foundation evidence. Tags with
  a prerelease suffix publish as GitHub prereleases. Manual dry runs do not publish.
  Updates default to stable; Settings → Ecosystem Health → Include beta updates
  opts into prerelease notices with a separate daily check. Installation remains
  manual and prerelease ordering handles beta.10 after beta.2 and stable after beta.

## Baseline and verification

Source baseline: Android **2.5.0**, Windows GUI **0.3.0**, existing signed task
protocol **v2**, conversation checkpoint schema **v1**, native Room schema **v3**.
Both repositories contained substantial uncommitted changes before this work;
those changes were retained. Provider secrets and private configuration were not
copied into this report.

The existing Samsung SM-E156B and paired Windows setup are documented in
`STATUS.md`. No physical handset was connected during this implementation. The
existing `jarvis_test` emulator is used only for instrumented storage tests;
emulator results do not substitute for the physical-device gate.

Validation results for this change are recorded in
[the acceptance report](acceptance/FOUNDATION.md). The machine-readable evidence
file starts empty and the promotion command deliberately fails until measured
evidence is entered. Missing evidence is a release blocker, not a code pass.

The submitted **JARVIS v2.5.0** release APK is preserved. Its SHA-256 is
`48ad34e6f004caca3031eded9c777c1d5ec91903147b3020c1e960d9927f9223`.
Development builds use the debug output only. No APK was installed on a real
phone and nothing was released or submitted for distribution.

## Remaining gates and implementation

Foundation still requires the current-candidate physical-device scenarios,
upgrade/pairing/settings preservation, 100 supported live workflow runs, latency
and STOP measurements, matched eight-hour battery runs with wake word on and
off, and the two-week daily-use pilot after promotion. A second Android handset
is required before expanded beta. See the acceptance procedure for every case.
The CI emulator job must also pass on the hosted runner before release.

After that gate, milestone 2 adds observed capability routing, registered file
transfer, Room-backed portable jobs with transactional checkpoint migration,
WorkManager scheduling and platform-local Google authorization. Milestone 3 adds
capture, Today, meeting preparation and reusable workflows. Milestone 4 adds
project workspaces, synchronized selected content, evidence-preserving research,
and validated document/spreadsheet outputs. These features remain unavailable;
no WebView-based background runner or token synchronization has been introduced.

Google developer configuration/consent, signing credentials and extra hardware
are external prerequisites. Installation review remains separate from code and
workflow acceptance. Preserve retained installers and backups; use forward fixes
instead of unsafe schema downgrades.
