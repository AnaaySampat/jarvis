# Gesture controls (preview)

Gesture controls are optional, off at launch, and available on Android and Windows.
They help when a phone or webcam is on a desk or kitchen stand and touch or speech
is inconvenient. Physical-device accuracy and battery testing are still required.

## Start a session

1. Open **Settings → Voice → Hand gestures**, choose a mode and review its mappings.
2. On Windows, select a webcam. On Android, grant camera permission and, when
   requested, display-over-other-apps access, then return and start again.
3. Start the camera, lower your hand for the release interval, then hold a pose.
   Defaults are 600 ms hold, 400 ms release and 80% classifier confidence.
4. Lower your hand before repeating. **Closed fist always means Stop**, including
   during calibration. Settings and the session panel also have Stop controls;
   Android adds a native preview and notification Stop.

Sessions last at most five minutes. Android stops on screen lock or removal from
recents and never restarts after process death or reboot. Its preview stays visible
when switching apps, but commands run only while JARVIS is visible and focused.
Windows stops on minimize, navigation, permission loss or camera disconnect.
Both platforms block commands while approval or clarification is pending.

## Modes and defaults

Poses and swipes can be remapped to the fixed action menu. Fist cannot be remapped.
Stop the camera before changing mode, timing, confidence or bindings.

| Mode                  | Default controls / setup                                                                                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Voice / accessibility | Palm stops speech; peace holds push-to-talk, release sends; thumbs up gives feedback. Remap poses and adjust timing.                                                                                                                  |
| Music                 | Palm play/pause; peace next; love sign previous; thumbs up/down volume; pointing up mute. Controls the device running this camera.                                                                                                    |
| TV                    | The same controls use the existing TV bridge. Configure its connection first.                                                                                                                                                         |
| PC / presentations    | Peace / love sign next/previous slide; palm media play/pause; pointing up mute; thumbs up/down volume. Requires an armed control session. Push-to-talk can be assigned to a pose.                                                     |
| Cooking / workshop    | Enter one instruction per line. Palm repeats, peace advances, thumbs down goes back, thumbs up starts the configured timer, pointing up stops speech. Use Read step for the first instruction.                                        |
| Reading / research    | Paste text or use the latest reply. Palm reads this page; peace / thumbs down turn pages; thumbs up bookmarks; pointing up stops reading. Pointing swipes turn pages or scroll.                                                       |
| Routines              | Choose an existing saved routine. Peace requests it through the normal routine flow, including its approvals.                                                                                                                         |
| Photos                | Peace requests a photo with a visible three-second countdown. Android saves JPEG to Pictures/JARVIS (app pictures on older Android); Windows requests a JPEG save/download. Uses the analysis camera, not full camera-app resolution. |
| Calls / meetings      | Palm mutes and peace unmutes the default system microphone where supported. An error appears if the API cannot confirm it. A meeting app may use a different input.                                                                   |
| HUD                   | Index fingertip moves the cursor. Pinch thumb/index to select safe navigation or a HUD card; hold the pinch, move onto another card, and release to reorder. Approval buttons are excluded.                                           |
| Custom poses          | Name a pose, start calibration, prepare during the three-second countdown and hold still for eight usable frames. Stop the camera and assign its action. Stores up to 12 geometry templates.                                          |

Swipes use a pointing index finger, displacement threshold and cooldown. Mirror
changes pointer/swipe direction. Calibration skips fists, low classifier scores and
invalid landmarks; use distinct shapes. Ambiguous custom matches trigger no action.

Reader text is limited to 30,000 characters; instructions to 15,000. Up to 50
bookmarks store a compact document identity, page and short excerpt. Paste matching
original text to reopen bookmarks. Saves are debounced; storage failures appear
in the UI.

## Platform integration

Android uses CameraX, a bundled MediaPipe model and a sequential worker at up to
eight analysis frames per second. Raw landmarks, epoch timestamps and monotonic
sequences pass through Kotlin → Rust → Tauri. Native fist and Stop controls remain
independent of JavaScript polling. Images are saved only for explicit photo actions.
Model provenance and license are in the native assets/GESTURE-MODEL.md file.

Windows uses a separate getUserMedia camera and MediaPipe WASM worker. The pinned
npm runtime and verified model are copied locally by predev/prebuild; no CDN is
needed. One transferable bitmap is in flight at a time. Inference uses a monotonic
clock; transported timestamps use epoch milliseconds. Camera permission and
save/download behavior depend on WebView2 and Windows privacy settings.
Model provenance and license are in public/gesture-assets/GESTURE-MODEL.md.

Android-to-PC gesture commands require the Windows dev implementation from this
change. They use signed pairing, the existing live-view/biometric control lease,
an allowlist and correlated acknowledgements. Old companions time out visibly.
The gesture camera cannot grant computer-control access.

A hold emits once. Every poll ticks the engine even without new frames, so tracking
loss releases push-to-talk and cursor state. New sessions accept restarted frame
counters. Host identity changes and text edits do not discard holds. Reading and
instruction commands interrupt current speech and queue the latest navigation.

## Privacy and approvals

Frames remain on-device without automatic uploads or recording. Explicit photos
save an image; calibration saves normalized geometry only. Text, settings and
bookmark excerpts stay in local storage. Voice input and reading use existing
configured speech providers, which can use network services.

Bindings accept built-in actions only, without arbitrary shortcuts, shell commands,
model prompts, approval responses or file paths. Routines retain their approval
checks. Recognition is not identity verification: a bystander can make a gesture.

## Validation and remaining acceptance

Automated tests cover hold/release, restart counters, stale frames and clock types,
silent gaps, admitted/rejected push-to-talk, unstable host identity, batched config
updates, debounced saves, calibration fist-stop, queued navigation, manual-event
allowlisting, compact bookmarks, storage failure, pinch/dropout, swipes, request
timeouts and webcam cleanup. Android JUnit compiles the service; Windows backend
tests cover action allowlists, control leases, replay, timers and speech interruption.

The Windows worker/model also loads and processes a blank frame in headless Chrome.
This checks the bundled WASM path, not camera permission or hand accuracy.

Physical acceptance remains: both hands and varied lighting; permission denial and
revocation; camera occupied; rapid start/stop; minimize/lock/recents; fist during
calibration/photos; notification Stop; expiry; real TV/media/slides; default mic
state in the selected meeting app; photo saving; touch/voice fallback; thermal and
battery cost; and Android 16 KB page-size devices.
