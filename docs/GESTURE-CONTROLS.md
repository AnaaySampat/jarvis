# Gesture controls (preview)

Gesture controls are optional, off at launch, and available on Android and Windows.
They help when a phone or webcam is on a desk or kitchen stand and touch or speech
is inconvenient. Physical-device accuracy and battery testing are still required.

## Start using controls

1. On Android, tap **Gestures** in the single top action row. You can also open
   **Settings → Gestures**, or find **Settings: Gestures** in the command palette.
   Android puts Phone, Music, Voice, Read, Photo and Steps first; Slides and other
   activities are under **More activities**. Voice settings also link to this page.
   Open **Guide** or **Set up, learn & calibrate** for numbered instructions covering
   phone placement, practice, gesture-to-action mapping and custom calibration.
   Built-in hand shapes do not need calibration. Guide pauses an active session;
   returning to Control restores its prior pause state. Stop remains available.
2. **Control** has illustrated gesture cards and real touch buttons for the current
   activity. Buttons work with the camera off, except photo capture. Read lets you
   paste text and turn pages; Steps keeps the current instruction and timer at hand.
   Actual command results appear below the preview and in **Recent actions**.
3. Open **Learn**, or tap **Learn** on a gesture card. Practice targets one pose at a
   time, shows finger placement and hold progress, and confirms only the target
   actually recognized. Start practice explicitly to turn on the camera. Commands
   stay off; closed fist still stops the camera. **Next gesture** moves on and
   **Use gestures** returns to normal control. Lower your hand between attempts.
4. Press **Start gestures** to enable recognition. On Windows, choose a camera in
   Tune if needed. Android requests camera/overlay permission. The phone's compact
   native preview can be dragged by its handle and expanded/collapsed. Its Stop
   button remains visible. Windows shows an inline live preview.
5. **Pause gestures** keeps the camera on for framing while blocking hand-triggered
   commands. Touch buttons keep working. **Resume gestures** requires a fresh hand
   release. Change activity directly without stopping/reloading the camera.
6. **Stop camera** closes the session, including while startup is still pending.
   **Closed fist** always stops it too: hold at least 800 ms at 85% confidence (or
   higher configured values). Starting, stopping, switching activities or leaving
   practice cannot replay an old held pose.

Sessions last at most five minutes. Android stops on screen lock or removal from
recents and never restarts after process death or reboot. Its preview stays visible
when switching apps, but gestures run only while JARVIS is visible and focused.
Windows stops its camera on minimize, navigation, permission loss or disconnect.
Both platforms block commands while approval or clarification is pending. TV and
PC activities show connection/setup instructions; setup does not bypass approvals.

## Modes and defaults

Tap **Change** on a gesture card to edit its action in place. Actions relevant to
that activity appear first; **More actions** adds search across the fixed action
vocabulary. Editing pauses active gestures; Save or Cancel restores the prior
unpaused state and requires neutral. Closed fist is reserved. **See all gestures**
reveals additional poses. In My gestures, new captures appear immediately with an
action to assign, even before they have a binding.

**Tune** offers Deliberate, Balanced and Quick response presets, camera selection,
mirroring and optional detailed sliders. Stop the camera before changing timing or
camera settings. Defaults are 600 ms hold, 400 ms release and 80% confidence.
Restore default actions affects only the selected activity. The floating session
panel includes Pause/Resume, Stop, touch controls and gesture reminders, and can be
minimized. The duplicate panel hides while gesture settings are open.

### Calibrate your own hand shape

1. Open **My gestures**, either under More activities or from Guide. Give the pose
   a name and choose **What should it do?** before starting capture.
2. Tap **Start camera for setup**. Commands stay off in practice. Face the front
   camera with one complete, well-lit hand and keep JARVIS visible.
3. Tap **Capture my pose**. The countdown gives three seconds to prepare; the bar
   then fills as eight usable frames are collected. Keep your shape still. Cancel
   capture saves nothing; Stop camera and closed fist remain available.
4. The saved-pose confirmation shows its assigned action. Tap **Test my saved
   pose**, lower your hand, then repeat the shape until it is recognized. Practice
   does not run the action. **Use gestures** enables the saved mapping after a
   fresh hand release. Change on its card can edit the action afterward.

Calibration saves the pose and selected action together in My gestures. Shapes
that collide with an existing template are rejected with an explanation. The
countdown also advances when no hand is visible; a capture with no usable frames
times out visibly instead of appearing stuck.

| Mode                  | Default controls / setup                                                                                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phone (Android)       | Palm play/pause; thumbs up/down volume; peace flashlight on; pointing up flashlight off; love sign automatic brightness; pointing swipes up/down set brightness to 80%/30%. No PC required. Brightness can require Android's Modify system settings permission; return to JARVIS and retry after granting it. |
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
| Custom poses          | Name a pose and choose its action, start calibration, prepare during the three-second countdown and hold still for eight usable frames. Test the saved mapping in practice. Stores up to 12 geometry templates.                                          |

To swipe, point your index finger and move your whole hand smoothly. A swipe
requires at least three samples and palm translation; finger flexing or a two-frame
jump cannot trigger it. Moving a pointing hand suppresses its stationary pose
action. Lower your hand after a swipe to rearm. Mirror changes pointer/swipe
direction. HUD cursor motion is smoothed and pinch must persist for 120 ms before
selection; releasing a lost hand never clicks.

Calibration skips fists, invalid landmarks and multiple hands, but accepts clearly
tracked custom shapes even if the canned classifier is uncertain. Similar saved
templates are rejected with an explanation; ambiguous custom matches trigger no
action. In Custom poses mode, templates can override a built-in label. Other modes
prefer confident built-in labels.

Reader text is limited to 30,000 characters; instructions to 15,000. Up to 50
bookmarks store a compact document identity, page and short excerpt. Paste matching
original text to reopen bookmarks. Saves are debounced; storage failures appear
in the UI.

## Platform integration

Android uses CameraX, a bundled MediaPipe model and a sequential worker targeting
about fifteen analysis frames per second, with latest-frame backpressure on slower
devices. MediaPipe handles rotation during preprocessing; an extra rotated bitmap
is made only for an explicit photo. Raw landmarks, hand count, top-two classifier
scores, epoch timestamps and monotonic sequences pass through Kotlin → Rust → Tauri. Native fist and Stop controls remain
independent of JavaScript polling. Images are saved only for explicit photo actions.
Model provenance and license are in the native assets/GESTURE-MODEL.md file.

Windows uses a separate getUserMedia camera and MediaPipe WASM worker. The pinned
npm runtime and verified model are copied locally by predev/prebuild; no CDN is
needed. Decoded video frames drive capture at up to fifteen inferences per second;
only one transferable bitmap is in flight, and slower inference lowers the rate
without accumulating work. Analysis images are bounded to 640 pixels on their
longest edge. A stalled feed stops the camera after ten seconds. Inference uses a monotonic
clock; transported timestamps use epoch milliseconds. Camera permission and
save/download behavior depend on WebView2 and Windows privacy settings.
Model provenance and license are in public/gesture-assets/GESTURE-MODEL.md.

Android-to-PC gesture commands require the Windows dev implementation from this
change. They use signed pairing, the existing live-view/biometric control lease,
an allowlist and correlated acknowledgements. Old companions time out visibly.
The gesture camera cannot grant computer-control access.

Both model hosts look for up to two hands so multiple-hand input can be rejected.
Current hosts require one complete, sufficiently large hand, a finite confidence
score and at least a 12-point lead over the runner-up. Holds require at least three
observations and continuous captured evidence. Brief uncertain frames of up to
180 ms pause rather than contribute to the hold; capture gaps over 350 ms require a new neutral release.
Frames older than 600 ms and duplicate capture timestamps cannot accumulate holds.

A hold emits once until the hand leaves view for the release interval. Low
confidence while a hand is still visible cannot rearm a command. Every poll ticks
the engine even without new frames, so tracking loss releases push-to-talk and
cursor state. Practice suppresses all gesture/manual actions and pointer events,
retains fist-stop, cancels owned speech capture, and requires neutral when toggled.
Pause blocks hand actions while preserving touch actions. Explicit touch commands
use the same host adapters and approvals, even with the camera off. Changing
activities resets evidence synchronously without restarting the camera.
Active polling targets a 67 ms period including bridge time, with one serialized
request loop. Start and Stop request an immediate refresh. New sessions accept
restarted frame counters. Host identity changes and text edits do not discard holds.
Reading and
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
timeouts and webcam cleanup. Recognition regressions additionally cover sparse and
duplicate captures, confidence flicker, real release between different poses,
multiple/cropped hands, invalid and ambiguous scores, stronger fist-stop evidence,
custom-template collisions and practice isolation. UI/navigation tests cover the
dedicated Settings page/search, illustrated activity cards, target-specific guided
practice and re-testing, inline mapping/search and resume, camera-off touch
controls, pending/failed/confirmed results, reader editing, photo prerequisites,
startup cancellation and minimized Pause/Stop. Android pure Kotlin policy tests pass; new classifier options were
compiled against the pinned MediaPipe AARs. These checks do not compile the full
Android service or APK. Windows backend tests cover action allowlists, control
leases, replay, timers and speech interruption.

The updated Windows worker/model loads with the two-hand/top-two-score options
and processes a blank frame in headless Chromium. UI browser checks cover phone
and desktop widths, target completion, practice isolation, touch while paused,
activity changes, inline mapping and text editors that stay open while typing. This checks the actual bundled WASM path and UI, not camera permission
or hand accuracy. Full native packaging and real-camera acceptance remain pending.

The Windows browser regression starts the bundled worker/model with a synthetic
camera, checks sustained frame delivery, then stops, restarts and verifies resource
cleanup. From the Windows repository root, run
`node scripts/check-gesture-webcam.mjs` with Node 22+ and Chromium installed (set
`CHROMIUM_PATH` if necessary). This checks the actual WASM and browser capture path;
it does not establish physical camera permission or hand accuracy.

Physical acceptance remains: both hands and varied lighting; permission denial and
revocation; camera occupied; rapid start/stop; minimize/lock/recents; fist during
calibration/photos; notification Stop; expiry; real TV/media/slides; default mic
state in the selected meeting app; photo saving; touch/voice fallback; thermal and
battery cost; and Android 16 KB page-size devices.


## Daily activity workspace (2026-11-04)

- **Control** keeps reading/step navigation beside the content. Pause leaves the
  camera on while buttons remain usable; Stop releases the camera. Fist still
  stops the camera during pause or practice.
- **Bookmarks (n)** is beside the page counter. A saved place can be named and
  restored after reload; opening it focuses the restored page. Bookmarks belong
  to the exact pasted document and do not duplicate the document text.
- **Steps timers** show their original step, deadline/countdown and completion
  independently of navigation and speech feedback. The primary start control
  prevents duplicate starts; **Start another timer** is explicit. Windows uses
  the existing persisted reminder scheduler, exact timer IDs and reconciled
  snapshots. Finished timers also appear in Chat.
- Android hands timers to the system Clock. The workspace shows an estimate and
  **Manage in Clock**; it does not claim that a particular system timer stopped.
- Key-free exploration is an explicit local choice that survives reload. It
  does not supply credentials or grant permissions. AI and unavailable speech
  or device services continue to report their actual availability.

The usability changes have browser/unit validation. New native UI/device
acceptance is still needed; previous recognition/device evidence remains valid
for the engine it exercised. See [implementation and validation](USABILITY-IMPLEMENTATION.md).
