# Hands-free usability implementation

Scope: the simulated-user REVIEW.md, checked against the Windows and Android source.
The daily activity workspace shares the current gesture controller with Settings
and the compact session overlay. Gesture recognition and native camera upgrades
from main are retained; matching modules stay aligned across repositories.

## Delivery order

1. Reachability: responsive Home/header/Chat; local exploration; recoverable startup.
2. Daily activities: one Hands-free workspace, camera-independent controls, durable
   timer state, nearby bookmarks and restored reading position.
3. Guidance: Control / Learn / Tune, safe practice, symptom-based presets,
   activity-specific feedback and accessible labels/focus/contrast.
4. Verification: focused UI and state regressions, frontend builds/typechecks,
   Windows timer/backend tests, browser journeys at desktop and narrow widths.

## Acceptance

- Home, Chat and Settings fit 320px and 390px widths and remain usable at 1280px.
- Hands-free is reachable from Home, Skills and command search.
- Read and Steps work with camera off; changing views never duplicates the engine.
- Timers retain their step/deadline through navigation and reload; Cancel targets
  only the selected Windows timer. Android system Clock handoffs never claim
  confirmed cancellation without native confirmation.
- Bookmarks are next to page navigation; restoring one focuses the restored page;
  names and saved pages survive reload and remain tied to their document.
- Practice never dispatches activity actions; fist/Stop still stop the camera.
- Missing AI credentials or optional assets do not block local reading/practice.
- Keyboard focus, labels, readable help and activity-specific status are checked.

Physical hand accuracy, sustained comfort/battery and Android permissions/device
camera acceptance require real devices. Browser and synthetic-camera checks do
not establish those outcomes. Native packaging is checked by GitHub Actions.

## Delivered

1. **Reachability and startup:** a responsive header menu and viewport-bound Chat;
   a banner in document flow; explicit, persistent local exploration; Retry and
   optional-component continuation. Startup waits for configuration readiness as
   well as the socket. The Android fork's browser preview uses its local brain at
   every viewport width; native desktop retains its sidecar.
2. **Daily activities:** Home, Skills, Settings and command search open one
   Hands-free workspace. Activity content/manual controls are separate from
   optional camera recognition. Bookmarks sit beside page controls, can be named,
   and restore/focus the correct page after reload.
3. **Timers:** Windows returns structured IDs/deadlines through the existing
   correlated gesture request path and reminder scheduler. Snapshots reconcile
   reloads; start tokens prevent replay duplicates; cancellation matches one ID.
   Timer cards retain their original step independently of navigation or speech.
   Android's system Clock handoff is explicitly an estimate with Manage in Clock.
4. **Guidance and accessibility:** Control / Learn / Tune; action-free practice
   with pose drawings and successful-recognition feedback; camera pause/resume;
   symptom-based presets and confidence guidance; matching visible/accessibility
   labels, focus trapping/restoration, readable help and activity-specific status.
   Fist/Stop and the existing approval boundaries remain active.

## Verification (2026-11-04)

- Both frontend builds and TypeScript checks pass. Android lint is clean; Windows
  lint completes with zero errors and 26 warnings in the existing codebase.
- Windows frontend: **150 tests pass**. Android frontend: **717 pass, 9 skip**.
  Test discovery now includes the new JavaScript and component startup tests.
- Windows backend: **719 tests run; 715 pass, 3 skip, 1 fails**. The failure is the
  unchanged `test_files.FilesTests.test_a_pattern_moves_every_match_or_nothing`,
  which expects Windows drive paths and rejects Linux `/tmp` paths. All changed
  timer/reminder/transport checks pass. The declared CI test dependencies were
  installed in the workspace's existing test virtual environment.
- Chromium journeys pass at **1280 × 900, 390 × 844 and 320 × 844** in both apps,
  with zero page errors. Checks cover header/Settings reachability, Chat bounds,
  reading/navigation, named bookmark restoration after reload, step navigation,
  Tune choices, safe Learn entry and keyboard focus restoration. Windows also
  starts/stops the real camera worker using a synthetic feed.
- The real Windows backend was run with a disposable config and no AI keys. Its
  browser journey verifies timer start, deliberate second start, exact-ID
  cancellation, reload recovery, expiry and completion delivery to Chat.
  Optional speech/browser packages are unavailable in this Linux environment;
  read-aloud quality was not evaluated.
- `git diff --check` (recognizing the Android README’s original CRLF endings)
  and Python compilation pass. `graphify update .` could not
  run because graphify is not installed in this environment.

Browser acceptance is reproducible with `scripts/check-hands-free.py` (Python
Playwright and Chromium; Vite must be running). Set `CHROMIUM_PATH` when needed.
Use `--url http://127.0.0.1:1422` for the Android preview. Add `--timers` only with
Windows's real backend and a fresh disposable `JARVIS_CONFIG_DIR`.

Native build targets are Android ARM64 2.5.4 and Windows x64 0.3.2. Artifact-only
GitHub Actions builds check native packaging and the Windows backend suite on
Windows; no release publication or physical-device installation is implied.
Actual hand comfort/recognition, permissions and sustained-device acceptance
remain separate from these browser results and earlier device evidence.
