# TV follow-up and model-switch alerts — 2026-10-24

Continues [the regression fixes](FIXES-2026-10-24.md). The user confirmed the TV is
free for testing again. Device: the existing USB-connected SM-E156B, Android 16;
TV: saved Sony BRAVIA 4K 2015 at 192.168.1.8. No credential, account or TV settings
changes requested. Preserve existing uncommitted work.

## Model-switch alerts

Android `useBrain.js` now sends the fallback callback to diagnostic logging rather
than `pushWarning`, both for ordinary chat and direct actions / TV vision. Automatic
provider/model fallback remains enabled. Genuine failures and approval warnings still
use the existing warning path.

- Typecheck and lint passed.
- Routing and TV suites: **51 tests passed** in two files.
- Web/native APK build passed and installed in place, preserving data and app control.
  SHA-256: `2C8CC81DB3C483E27C52F2E4532BDE7DFE26F142DC8B1F313EA700435A96B159`.
- Graph updated: 3,446 nodes, 8,172 edges, 180 communities.
- Post-install chat answered 13 × 17 = 221 without a model-switch popup. This turn
  did not itself fall back; the callback wiring is the source-level change.

## TV connection and baseline

Initially the TV answered the PC but not the phone, despite both using the same
saved Wi-Fi network. The normal app wake request did not fix it. Reconnecting the
phone's already-enabled Wi-Fi restored direct phone-to-TV ping (7 ms) and native
ADB control. Wi-Fi returned to its saved network. No competing PC ADB TV connection
was left open.

Baseline read from the TV: **on, home screen, volume 59, unmuted**. Playback tests
use volume 5; restore 59 and unmuted, with playback stopped and the home screen
visible, when complete.

## Live checks

| Check | Result |
|---|---|
| Status | Pass: on / home screen / volume 59. |
| Volume down/up | Pass: 59 → 57 → 59, each read back. |
| Mute/unmute | Pass: false → true → false, each read back. |
| Set volume | Pass: explicit level 5 read back. |
| Remote buttons | Right, Back and Home reported sent; do not treat a key receipt as proof of a particular UI transition. |
| Launch YouTube | Pass: YouTube focused. |
| Search/play | Pass: top result for “lofi instrumental” reached playing media state. |
| Pause / already paused / resume | Pass: paused, repeated pause stayed paused, resume reached playing, then paused again. |
| YouTube URL and timestamp | Pass: public video link with `t=60` played from 1:00, verified against TV media position. |
| Phone-current-video handoff | Positive case unavailable: phone has no installed supported YouTube/Netflix player. Opening the public URL did not create a video media session. Unsupported Spotify media was refused without changing TV playback. Phone volume restored to 10/15 after the silent setup attempt. |
| Launch Netflix | Pass: Netflix focused. |
| Netflix title URL | Initial startup reported playing, but playback later stopped and returned to Home. Subsequent pause/resume from Home only reported key forwarding; these are **not** Netflix playback-control passes. Reopening Netflix and Resume did not restore playback. |
| Netflix screenshot | Correctly reports copy protection; no picture is claimed. |
| TV look on Home | Pass after explicit permission: describes Android TV home / favorite-app row. |
| Visual YouTube search | First attempt from a protected playback screen refused honestly. After leaving that player with Back, a fresh task successfully searched **NASA Earth** and left results visible. Capture metadata confirmed a nonblank, unblocked frame. |
| Standby / wake | Pass: Power off reported “Turned the TV off”; separate Status confirmed standby; Power on reported “Turned the TV on.” |
| Final Netflix named episode | **Pass after fixes:** “Stranger Things season 1, episode 1 (Chapter One: The Vanishing of Will Byers)” reported playing. Independent readback confirmed Netflix focused with state 3 and position 766,513 ms. |
| Final Netflix controls | **Pass:** Paused Netflix; repeated pause stayed paused; Resume reported playing; final Pause verified. |

Automatic approval review initially rejected the screenshot/vision test because it
would send potentially private TV screen contents to the app's configured AI providers.
The user then explicitly approved screenshots for these tests. Only after that approval
were look/visual tests run. The successful visual task triggered **two real model
fallback notices in diagnostic logs and zero model-switch popups**, verifying the
alert change under actual fallback conditions.

## Additional fixes found during TV tests

Grounded search returned the Netflix **season** ID 81297917 for “Stranger Things”,
while Netflix's own page identifies parent series ID 80057281. The original lookup
refused the season ID because it could not match a Show/Movie with that ID. Lookup
now normalizes a season candidate only when Netflix supplies **one unambiguous
topLevelVideoId and matching parent title data**. The existing requested-title match
is still required; absent or ambiguous evidence is refused. Regression cases cover
valid normalization, exact IDs, missing parent/title data and ambiguous parents.

Netflix completion now also requires the Netflix package to remain in front, so a
moving/background media session cannot claim playback while the launcher is visible.
The regression suite includes this false-positive case. Netflix exposes no useful
accessible error text here and blocks screenshots, so unresolved account/playback
errors may still need the user to read the physical TV.

The unsupported-phone-player message now says a cached track is **from** that app,
rather than falsely saying it is playing when the session is paused.

TV fixes were built and installed in place. SHA-256:
`A9939A68337ACA23D3BEE7C75FF2EBAA8E905CFA2611608EA1AADA34D0843F36`.
The live Netflix retest above used this APK. The later notification-reading fix
below retains all of these TV and alert changes.

## Notification-reading follow-up

The user reported unreadable notifications and requested one sample test. Android
notification access was enabled; the native reader worked. The actual failed chat
request was “can you read my notifications and tell me what they are?” Its workflow
had **zero tool calls**, two model decisions, and ended at the false completion-claim
guard (“I couldn't confirm that anything was done”).

Plain local notification-read requests now dispatch the existing native reader
directly and return its readable, verification-code-redacted text, with the same
workflow journal and chat history. No model receives notification bodies on this
simple route. Permission failures are preserved. Filtered, compound and remote/scoped
requests retain their existing tool routing; restricted contacts gain no read access.

Sample posted: **JARVIS sample test 7429**, with known text about a blue notebook.
The native reader receives its title and full text intact. After installing the fix,
the exact previously failing chat request was run once. **Pass:** the reply contained
the sample title and complete body, with no unconfirmed-action warning. The workflow
succeeded in **174 ms**, with **one notification tool call, zero model decisions and
zero unverified results**. The visible chat paragraph used 15 px text, 24.75 px line
height, light text on the dark chat background, and wrapped within its width.

The final APK retains the TV fixes and quiet model routing. Installed in place:
SHA-256 `E235F9A442D4B6C739C6128E46ED168178BC3A91E4CE476352909C6EE8AD2ED9`.
Only the two disposable Android Shell test notifications were dismissed; unrelated
notifications were left alone. The sample result remains in chat. Temporary phone
and TV UI dumps were removed. Spoken replies were restored, phone media volume was
confirmed at its original 10/15, and JARVIS was left idle. Final TV status: **on,
home screen, volume 59, unmuted**, with test playback paused.

Final TypeScript suite including notification fix: **522 passed / 9 skipped**.
Typecheck and lint passed; no native source changed in this follow-up.
Web/native APK build passed. Final graph: **3,455 nodes, 8,189 edges, 176 communities**.

Logs: GUI `.test-tmp/notifications-tests.log`, `.test-tmp/notifications-apk.log`,
`.test-tmp/tv-final-live-results.json`; root `.test-tmp/notifications-graph.log`.
