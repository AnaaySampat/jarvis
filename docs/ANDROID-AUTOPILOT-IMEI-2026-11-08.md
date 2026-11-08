# Android IMEI lookup repeated; STOP disappeared

Inspected the USB-connected phone's existing logcat on 2026-11-08. Installed app:
`com.jarvis.app`, version `2.5.6-rc.3`, version code `2005008` (release build).
The task was not replayed on the phone during this investigation.

## Device evidence

Phone-local timestamps, 2026-11-08:

| Time | Observed event |
| --- | --- |
| 13:06:10.768 | Accessibility STOP overlay added. |
| 13:06:10.980 | First native phone task started. |
| 13:06:26.954 | First task finished `ok=true`: “Found the IMEI information section in the phone settings.” No IMEI values in the returned summary. |
| 13:06:26.964 | WindowManager removed the STOP overlay from `JarvisAccessibilityService.hideStopOverlay`. |
| 13:06:29.181 | Second native phone task started under the same conversation workflow, with a different operation hash and sequence suffix. |
| 13:06:49.210 | Second task's completion claim rejected for not providing the IMEI number visible on screen. |
| 13:06:51.881 | Second task finished successfully with both IMEI values. Values omitted here. |

There is no intervening STOP-overlay add event during the second task.
The two task IDs share the workflow prefix and end in operation indices `_0`
and `_1`: this was a second conversation-level handoff, rather than replay of
one native start acknowledgement.

The complete original task text and the first operator's pre-verification claim
are not recorded in these logs. Therefore the logs cannot distinguish a narrowed
delegated goal, an incomplete operator claim, and a checker summary that dropped
values. The returned navigation-only summary and second native run are confirmed.

## Code findings and changes

- The conversation loop deduplicated exact action hashes, but a successful whole
  `phone_task` could be delegated again with different wording. It now retains
  that successful receipt and refuses another phone handoff in the same request.
  New requests and failures that never acted remain eligible for a phone task.
- Native completion replaced the operator's verified lookup answer with the
  checker's short summary, capped at 240 characters. Successful lookups now retain
  the verified answer up to the same 1,000-character evidence limit used by the
  checker. State-changing tasks still use the independent checker's account.
- Tool and verifier instructions now explicitly require the requested values,
  including a single requested value, rather than just finding their page.
- Native completion hid STOP, while the JavaScript overlay helper only sent show
  on a desired-visibility transition. Consecutive work could keep that desired
  state true after the native view had been removed. Each native run now shows
  STOP before acting; delayed WebView hide requests cannot remove it during a
  native run. Completion cleanup finishes before publishing the final result.
- Native polling now reports actual overlay visibility through the Rust bridge.
  JavaScript restores a missing overlay while work or speech still owns it, uses
  the current stop handler, and ignores stale poll replies from previous runs.

## Verification

Regression tests cover reworded and same-batch duplicate phone handoffs, a fresh
subsequent request, lookup answer preservation, unchanged state-change reporting,
overlay restoration, current stop callbacks, stale polls, and Rust serialization.

Passed checks:

- `npm test`: 935 passed, 9 skipped.
- `npm run typecheck` and `npm run build`: passed.
- `gradlew.bat :tauri-plugin-phone:testReleaseUnitTest --offline --console=plain`:
  174 tests, no failures or errors; Android Kotlin compilation passed.
- `cargo test --manifest-path tauri-plugin-phone/Cargo.toml --lib --offline`:
  3 Rust bridge tests passed.

Changed source files pass `git diff --check`. The web build retains its existing
chunk-size and mixed-import warnings. No live model request or on-phone replay
was used for these regression checks.

The raw device log and identifier-redacted excerpts are kept only in the ignored
`.test-tmp/autopilot-imei/` directory. No device identifiers are included in test
fixtures or this report; numeric test values are synthetic.

This is a source fix. No replacement APK has been installed on the phone.
