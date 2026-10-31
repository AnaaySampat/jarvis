# Gesture controls

This branch integrates contributions from PRs #5–#9, retaining their commits in
the merge history. Gesture recognition is an optional Android preview. It does
not start when JARVIS launches and it does not approve consequential actions.

## Using the preview

1. Open Settings → Voice → Hand gestures and tap Start camera.
2. Grant camera permission. If asked, allow display over other apps. Return to
   JARVIS and tap Start camera again. A denied permission never starts a session.
3. Place the phone where its front camera can see your hand. Hold a pose for at
   least 600 ms, then lower your hand before repeating it.
4. Use Stop camera in Settings, the floating preview, or the notification to end
   the session. A closed fist also ends it.

| Pose | Current behavior |
|---|---|
| Open palm | Stop JARVIS's speech while its app is visible |
| Peace / Victory | Start voice input while JARVIS is visible, idle, and has no active task or pending approval |
| Thumbs up | Show detection feedback; never confirm an action |
| Closed fist | Stop the camera natively, even if the WebView is suspended |

The camera stops after five minutes, on screen lock, or when the app is removed
from recents. Sessions never restart after a process death or reboot. Stop
controls work independently of the JavaScript poller. The preview intentionally
stays visible when switching apps, but voice-control gestures only act while
JARVIS itself is visible. Return to JARVIS for those controls.

## How it works

- CameraX uses the front camera and requests 640×480 analysis. Inference is capped
  at eight frames per second with a keep-latest queue.
- Google's bundled MediaPipe Gesture Recognizer model classifies poses. The
  threshold is 0.8, followed by a 600 ms hold and 400 ms release filter. A held
  pose emits once, rather than speaking on every frame.
- Recognition uses a sequential native worker and MediaPipe video mode.
  Frame buffers are closed on every path; model shutdown waits behind inference.
- The preview is a camera foreground service with camera runtime permission,
  the Android 14+ service permission and a declared service type.
- Three commands follow the existing Kotlin → Rust → Tauri permission bridge:
  start_gesture_recognition, stop_gesture_recognition, poll_gesture_recognition.
- The native poll reports whether the Activity has focus, in addition to the
  WebView visibility check. The UI polls monotonic sequences, baselines after reload, rejects detections
  older than 1.5 seconds and consumes ignored detections so they cannot replay.
  Polls and controls have bounded reply waits.
- Frames stay in memory on-device. They are not stored or uploaded. A peace sign
  starts the ordinary voice-input path, whose existing speech provider may
  transcribe audio remotely. Recognition is not identity verification.

The trained model, its provenance and SHA-256 are recorded in
[GESTURE-MODEL.md](../jarvis-studio-gui/src-tauri/tauri-plugin-phone/android/src/main/assets/GESTURE-MODEL.md).
CameraX, lifecycle and MediaPipe dependencies are pinned.

## Is it worth keeping?

Yes, as an opt-in session for a phone on a desk, kitchen stand or bedside dock.
It helps when hands are messy, the room is noisy, or speaking is inconvenient.
It is less useful when holding the phone or when the camera cannot see the hand.
Continuous camera use adds power/thermal cost and competes with other camera
apps. Keep voice, touch and the existing emergency STOP available.

The first release should prioritize stop-speaking and start-listening, followed
by a small set of reversible media controls. Measure false activations, latency,
lighting/handedness performance and session battery use before expanding it.

## Other ways to incorporate gestures

These are design options, not features implemented by this branch.

| Area | Possible interaction | Integration needed |
|---|---|---|
| Conversation | Palm to interrupt a long reply; pointing-up to request attention | Extend the existing voice controls and idle-state gate |
| Music and video | Play/pause, mute, next/previous track | Allowlisted actions through existing media controls; deliberate hold and cooldown |
| TV remote | Phone-on-table gestures to pause playback, mute, or navigate | Use the paired TV bridge; the phone camera must see the hand |
| PC remote | Presentation next/previous, media mute or push-to-talk | Send only selected actions through authenticated PC pairing |
| Cooking/workshop mode | Start a named timer, read the next instruction, repeat the last step | Explicit mode with a small action vocabulary |
| Reading and research | Next/previous page, scroll a result, read aloud, bookmark | Operate the current document/view with visible feedback |
| Routine launcher | Trigger a selected low-risk routine such as a desk scene | User-selected mapping; preserve confirmation for any risky routine step |
| Accessibility | Alternative input for users who find touch or speech difficult | Per-user calibration, remapping, hold durations and usability testing |
| Camera/selfie control | Gesture shutter with a visible countdown | Share camera ownership or stop recognition before opening another camera app |
| Calls and meetings | Mute/unmute or dismiss an incoming call | Existing platform controls, explicit mode and visible state; never auto-answer bystanders |
| HUD interaction | Pinch/select, drag a card, change volume continuously | Track landmarks and motion over time; static pose detection alone is insufficient |
| Custom gestures | User-defined poses or a learned personal vocabulary | New training/calibration and evaluation; this preview uses the canned classifier |
| Desktop webcam | Same controls without pointing the phone at the user | Separate Windows camera/recognition implementation; the Android service cannot read a PC webcam |

Avoid using a thumbs-up as permission to send messages, buy items, delete files
or unlock devices. Gestures can be accidental or performed by someone else.
Confirm consequential requests through the existing approval/biometric flow.

## Validation

Automated tests cover label confidence, hold/release timing, jitter, stale and
duplicate input, reload baselines, hidden-window/approval blocking and a dropped
native reply. Run the normal frontend typecheck, test suite and production build.
The Android plugin's JUnit suite also compiles the native source.

Physical-device acceptance is still required before calling this production
ready: grant/deny/revoke permissions; portrait/landscape; both hands; dark and
bright rooms; rapid Start/Stop and startup failure; screen lock and recents
removal; notification Stop; camera occupied by another app; held poses and
tracking dropouts; WebView reload; pending approval; five-minute expiry; and
16 KB page-size devices. A camera emulator is not a substitute for these checks.
