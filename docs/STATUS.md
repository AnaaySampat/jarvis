# Status

Last reviewed: **2026-09-26** (verifier + unfamiliar-task pass, live-verified against ground
truth; before that, 2026-09-25: routing regression fixed and live-verified; Gemma reasoning
hidden; voice capture ends on silence; release APK verified on a phone; published).

This is the honest state of the app. It separates three different things, because
conflating them is how you end up debugging something that was never tested:

| Mark | Means |
|---|---|
| ✅ **Live** | Run on a real phone and confirmed working end to end |
| 🟡 **Built** | In source, typecheck/lint/tests green, but no recorded on-device test |
| ⬜ **Open** | Not done |

Repo checks as of 2026-09-26: `npm test` **282 passed / 32 files** (also run by CI on
every push), JVM plugin tests 102 passed, `npm run typecheck` clean, `npm run build` clean, and **`npm run lint` clean — 0
problems** (was 59 errors / 26 warnings). Two suppressions remain, each with its reason in
place: App.jsx's `uiCommand` effect (an event delivered as state by two transports) and
useBrain's model-discovery effect (the rule can't see the setState is after an `await`).
> **Both APKs were rebuilt on 2026-09-25 and installed on the real phone (Galaxy M15,
> Android 16).** The debug run is in *The 2026-09-25 rate-limit regression fix* below; the
> release APK (33 MB, not debuggable, debug-key signed) booted clean with the wake word
> listening. Voice and a phone task have not yet been run on the release build.

---

## Core app

| | Feature | Notes |
|---|---|---|
| ✅ | Boots on a real device (arm64) | Emulator is boot-only — no real mic, SystemUI freezes under load |
| ✅ | Chat through the in-app TypeScript brain | No Python process on the phone |
| ✅ | HTTP tools — weather, news, web search, places, directions | Ported as-is from the Python backend |
| ✅ | Reminders, alarms, timers, schedule | Native `AlarmManager` + a `BroadcastReceiver` |
| ✅ | Providers: Vertex AI (Service Account JSON), Gemini, Groq | Provider **and** model selectable in Settings |
| 🟡 | Auto mode + the route ladder (`routes.ts`/`quota.ts`) | Unit-tested; the escalating bench ladder hasn't been watched through a real multi-day quota exhaustion |
| ✅ | Smart routing — benchmark-ranked ladder, Settings ▸ Routing, Re-rank, per-key Remove (2026-09-24, ported from desktop) | Live 2026-09-25: chat turns and phone tasks routed by it, zero 429s (after the fixes below). The grounded estimate of unknown models runs only from Re-rank and has never *succeeded* on the phone (Gemini 429 both times it ran). Settings list checked on-screen 2026-09-25 |
| 🟡 | Provider + model choice (2026-09-25) — provider list is Auto + providers you have keys for; model list is what those keys reach, grouped by provider; Auto on a provider = best model from that provider, Auto/Auto = full smart routing | Unit-tested (routes/resolveConfig); pickers checked on the Galaxy M15 (Auto, Gemini, Groq, OpenRouter, NVIDIA NIM listed, no Vertex). A chat turn under a provider-scoped Auto not yet watched live |
| ✅ | HUD menus rebuilt on the Settings design (2026-09-25) — Conversation, Capabilities (tap an example → chat box), Device (live Wi-Fi/battery readouts, app control), Skills (QR and clipboard results shown in place), Terminal ▸ Clear | Live on the Galaxy M15: all four sheets render opaque with live readouts, Android back closes a sheet and stays in the app, QR shows in place, Clear arms then disarms after 3s (confirm not pressed). Fixes the see-through Skills/Capabilities panels seen on the Galaxy M15 and the QR result that was dropped on the phone |
| ✅ | Settings redesign (2026-09-25) — drill-down index with a live readout per section (phone), nav column + page (≥760px), switches, pinned Save with an unsaved-changes note | Checked on the Galaxy M15 2026-09-25: index readouts show real state, and Routing lists 31 ranked models (so the Smart-routing list above is now checked on-screen too). Android back steps page → index → closes Settings, then leaves the app as before (live-verified after the fix) |
| 🟡 | Memory view — dock ▸ MEMORY / "open memory" (2026-09-24, ported from desktop) | Browser-preview-verified at phone width: remember, exact forget, timeline, saved chats. Installed on the device but not yet opened there |
| 🟡 | Calendar read/write, clock intents | Newer native commands, no recorded live test |

## Voice

| | Feature | Notes |
|---|---|---|
| ✅ | Push-to-talk mic (`MediaRecorder` → Groq Whisper) | Needs a real device; the emulator has no mic. Since 2026-09-22 it falls back to Vertex Chirp when Groq fails, instead of failing the turn outright |
| ✅ | Spoken replies (`window.speechSynthesis`) | Plus real TTS-completion tracking, so "stop" lands correctly |
| ✅ | "Hey Jarvis" wake word, on-device (openWakeWord ONNX) | Works end to end. Root cause of the long-running failure was React StrictMode remounting the listener — hence the module-level singleton, don't refactor it back into an effect |
| ✅ | Wake word as a foreground service | Keeps listening with the app backgrounded |
| 🟡 | Wake command capture ends on silence (energy VAD, ~0.9s) instead of a fixed 6s; Groq STT on full `whisper-large-v3` + prompt, temp 0 (2026-09-25) | Unit-tested only, not yet on device. Known gap: the mic handoff (engine stop → 250ms → `getUserMedia`) still drops the first ~0.5–1s after the beep, so "Hey Jarvis open X" in one breath loses the command's start. Real fix is capturing the command natively; the openWakeWord lib's `AudioRecorder` is private, so that means owning the mic loop |
| 🟡 | Gemma 4 thought parts filtered out of replies (JS + native operator), thinking forced to `minimal` (2026-09-25) | Gemma 4 ignores `includeThoughts:false`; its reasoning was being shown as the answer. Not yet on device |
| ⬜ | Heavy-use wake-word soak test | Needs the user's own voice over a long session; never done |

## Phone control (the on-phone operator)

> **2026-09-23: the operator loop moved to Kotlin** (`OperatorCore.kt` / `NativeOperator.kt`,
> branch `native-operator`) because a hidden WebView is paused ~60s after JARVIS leaves the
> foreground — see "The 2026-09-23 native operator" below for what is and isn't proven.

| | Feature | Notes |
|---|---|---|
| ✅ | AccessibilityService drives other apps | observe → one command → execute → repeat — now native |
| ✅ | Native operator, end to end | 2026-09-23, SM-E156B: "find the Android version, then count the alarms" → verified success in 54s ("Android 16, 4 alarms, all off"), with a route failover and a stale-observation retry along the way |
| ✅ | A task that outlives the ~60s WebView freeze | 2026-09-23 15:35–15:38: a 3m22s two-app task finished verified while the WebView's JS was frozen for 119s (heartbeat gap 15:37:15→15:39:14); native steps kept landing throughout |
| ✅ | `open_app` by label/package | Was silently broken until the manifest `<queries>` block was added |
| ✅ | Spotify search + play by voice (2026-09-25, SM-E156B, release build) | 19:29–19:30: "open Spotify and play Back in Black by AC/DC" opened Spotify, reached the real search box, typed the query and started the song (the demo GIF). The log shows the search box was reached with an element tap (`tap[7]`) after the screenshot-on-sparse-screen change, and `set_text` then succeeded. **Not claimed:** that `tap_point` was used — it never fired in this run. Known gap: after playback started the operator kept tapping play/pause and ended "nothing is changing" (`incomplete`) instead of recognising success |
| 🟡 | `tap_point`: tap a spot from the screenshot when an app hides its UI from accessibility (2026-09-25) | Spotify's Search page exposes only its four bottom tabs, which explains the two earlier failures (tapping the "Search" tab label, typing into tab labels). Screenshot now sent whenever < 10 labelled elements; `tap_point` in thousandths of the screenshot, allowed without approval only in low-risk tasks (SECURITY.md). JVM-tested; **not yet exercised live** |
| 🟡 | Typing into search boxes whose placeholder is a separate node (2026-09-25) | `fieldFor()` redirects typing aimed at a label to the editable field enclosing it; a node counts as editable if it accepts `ACTION_SET_TEXT`. JVM-tested. (It did not cause the Spotify failures — see `tap_point` — and whether it fired in the successful run isn't logged) |
| ✅ | Autopilot pass (2026-09-25 evening): coordinate taps, done-check, speed | `tap_xy`/`drag` run under `tap_point`'s low-risk rule instead of ending the task; `enter` (IME Search/Go); `look`; plan folded into the first command; `open_app` waits for the first screen. Done-check: fresh observation + screenshot + noted facts, tolerant verdict parsing, unfinished-sounding `done` sent back to work, second rejection ends `unverified`, a checker look before every give-up, and **audio ground truth** (`AudioManager.isMusicActive`) for playback goals. A tap on a never-quiet screen reports ok instead of `quiescence_timeout`. **Live on SM-E156B, release build:** stopwatch start verified in 21s (the live-screen tap reported ok, no re-tap); stopwatch reset verified via `tap_point` (Clock hides its buttons — first live `tap_point`); Settings search verified after the checker correctly rejected a false done (operator had ended in Calendar's settings); Spotify "play Back in Black" verified and confirmed PLAYING in `media_session`. **Bugs the live runs found and fixed:** (1) the operator clicked JARVIS's own floating STOP — listed as a node, and visible in screenshots — and cancelled itself; own windows are now left out of the snapshot, blacked out of screenshots, and coordinate gestures on the overlay are refused. (2) `tap_xy` fed thousandths from a screenshot hit Settings' Samsung-account card and opened its sign-in; pixel commands are now refused on any step that carries a screenshot, and sign-in/log-in are R3 words. (3) the checker passed a Spotify task off a *paused* mini-player's song title; playback goals are now rejected when nothing is playing. 63 JVM tests |
| 🟡 | Speed pass (2026-09-25 night) | Mechanics, measured on the M15: JARVIS's own screen read 0.9–3s → ~30ms; the goal's app opened with no model call; `open_app` 3.5–5.3s → 1.4–2.0s (its foreground poll walked the whole tree every 150ms; label scan ~3s ×2 now cached); final check without a screenshot on rich lists; chained `done`/Enter; `set_text` on a Search button; hedged slow calls. Task wall times (release build, free Gemini ladder under frequent 429/503): stopwatch start 24.6s → 17.3s / 21.3s; stop+reset 43s → 25.7s; Settings search 82s → 40.6s (and 17.4s with the page left open); Spotify 66s → 66s (44s of model calls in a 429/503 cascade; verified PLAYING). One stopwatch run failed honestly (`unverified`) after the model toggled Samsung Clock's unlabelled buttons — which led to showing a button's child label on it and naming tapped labels in the step log. Found and fixed live: chaining a tap across a state change. The last two changes (chained-Enter fallback for id-less fields, softer audio wording) are JVM-tested only — the run ended when JARVIS was force-stopped from App info, which disables accessibility |
| ✅ | Night pass (2026-09-26): benchmark + variety suite, quality fixes | Benchmark (verified, M15 release/debug builds, free Gemini ladder): stopwatch start 24.6s → **10.8s**; stop+reset 43s → **21.3s / 7.9s**; Settings search 82s → **14.4s**; Spotify play 66s → **37.3s** (confirmed PLAYING). Variety suite, all verified against ground truth: Android version + model ("16, Galaxy F15 5G"), storage (54 GB/128 GB), battery (100%), screen timeout (10 min), Wi-Fi name, ringtone ("Galaxy Bells", matches `settings`), font size, app count, dark mode on/off/on/off (checked `ui_night_mode` each time), world clock cities, Play Store search (4.5–12.5s, nothing installed), Chrome web lookup ("8,848.86 m", 10–24s), Chrome URL navigation. Fixed from what the runs showed: an operator that switched the theme on a "search for dark mode" goal (do-exactly-the-goal rule + the checker fails unrequested changes); checker false negatives/positives (bare radio labels now read from siblings; outcome not route; multi-part answers must give every part); Samsung search results and floating bars mislabelled (hierarchy-based row labels); deep-page resumes (fresh launches); keyboard keys in the element list; four kinds of malformed model replies; two-stage search openers; hedge winners promoted; slow chat routes demoted and hedged in `ask.ts`. Deliberately not re-tested tonight: anything audible (timers, alarms, music) — a test timer rang at 01:12 and was dismissed **Late-night regression (03:14–03:52), after more fixes:** Settings toggles and lookups all verified against the phone (dark mode on/off, screen timeout 2 min ↔ 10 min with `screen_off_timeout` checked, Android version + model, Wi-Fi name); Clock stopwatch stop+reset 10.6s, start 6.8s (one model call), resume 6.2s; world clock 8.7s; Play Store 16.2s; Chrome Everest lookup 20–24s and wikipedia.org 14–27s. Further fixes: bare RadioButtons were missing from snapshots (now `flagIncludeNotImportantViews` + checkable nodes kept, with `clearCache()` per snapshot against stale text), a list container borrowed "15 seconds" and read as the checked option, "resume the stopwatch" was treated as audio playback, the duplicate-message guard blocked retyping a search query, and "Chrome" didn't match this phone's "Chrome Beta". One lap-then-stop run looped on Lap until the cycle guard stopped it (model variance; the retry succeeded). |
| ✅ | Verifier + unfamiliar-task pass (2026-09-26 evening) | **Baseline on never-tuned tasks** (release build 6ba6047, ground truth from `settings`/`getprop`/`wm`/`ip`): Do not disturb ✅ (the checker rightly rejected two premature `done`s — a dialog was still open), IP address ✅, timer 1:30 not started ✅; **security patch level ❌** (refused: the goal said "security", so every tap was R3), **auto-rotate ❌ ×2** (scrolled Display settings up and down until the cycle guard stopped it and never searched — Samsung has no auto-rotate entry in Settings at all), Eye comfort shield ❌ (the chat model never called `phone_task`). **What changed** (ARCHITECTURE §4): the checker judges system-recorded evidence — `changes_made` (every switch/radio/tile/tab the task flipped, diffed from the screen before and after each action, even on screens since left) and `claim_evidence` (where each number and name in the answer was seen) — answers with per-requirement `checks` (a "pass" listing an unmet check is refused), takes one screenshot second look before rejecting after a flip, treats "in Settings" as a route, fails "couldn't find it" unless asked whether it exists, and writes the summary the user hears; an explicit `fail` gets the rescue check. For unfamiliar tasks: each step says what it changed (`→ …`), progress means *new information* (5 stale moves → nudge + replan, 9 → stop), scroll hint → search, one redirect of a scroll cycle, `quick_settings` (panel closed at task end), `stateDescription`, lookups may pass through sensitive areas (SECURITY.md), and a low-risk stale retry is bound to the control, not the screen generation. Chat side: the prompt routes phone-state questions to `phone_task`, and a reply about the phone that called no tool gets one recheck round. **After, live on SM-E156B vs ground truth (debug builds):** auto-rotate ✅ **11.3 s** (was ❌; `accelerometer_rotation`=1), security patch ✅ ("5 July 2026"; was ❌), Eye comfort ✅ 13.9 s; **held-out, never tried before:** Bluetooth on/off ✅ 17.6 s / 13.5 s, Power saving on/off ✅ 29 s / 26.7 s (via the quick panel), device name ✅ ("Anaay's S27 Ultra", after the chat fix), DND off ✅ 22.6 s, auto-rotate off ✅ 25 s, Eye comfort off ✅ 16.7 s, screen resolution — this phone has no such setting: 171.6 s ending in a "not found" counted as success → **86.6 s honest failure** (the checker twice rejected Game Booster's "Screenshot resolution" as the answer). **Regression** on tuned tasks that reached the operator: stop+reset ✅ (46.9 s — a live stopwatch made every "Stop" tap stale; the control-bound retry fixes that), screen timeout 2 min ✅ 32.4 s / 10 min ✅ 22.7 s (`screen_off_timeout` checked). **Found and fixed on the way:** the checker read Samsung's ON rotation tile ("Auto rotate, Set to portrait") as locked and demanded the Settings route, and the operator undid its correct toggle; the quick panel was left over JARVIS; the status-bar clock read as "new"; chained `done`s said "already on" for switches just turned on; re-typing one search counted as progress. **Chat-layer failures seen (not the operator):** with Gemini's daily quota spent the chat fell back to Groq qwen, which answered "Android 14" (16), "Home_WiFi_5G" (Sampat_TPLink 2.4) and an invented uptime without looking, once hit "Groq 400", and read "turn on dark mode" as JARVIS's own HUD theme — the recheck guard targets the first three. JVM tests 85 → 102, TS 280 → 282 |
| ✅ | Swiping JARVIS out of Recents no longer crashes the app (2026-09-25) | Root cause of the accessibility service switching itself off: activity destroyed → tao `std::process::exit` → onnxruntime's C++ static destructors ran under the wake-word threads → SIGABRT/SIGSEGV → `am_crash: Native crash` → Android disabled JARVIS's accessibility service ~1s later (logcat 19:51:02–04). Fix: `_exit(0)` on `RunEvent::Exit` on mobile (`lib.rs`). Reproduced with `am stack remove` before the fix (native crash), clean `am_proc_died` with no crash after, wake-word service restarted by itself |
| ✅ | Cross-app STOP overlay | Works even without the a11y service, via a `TYPE_APPLICATION_OVERLAY` fallback |
| — | Replay cache for known goals | **Removed** with the native move (2026-09-23). It had never promoted a workflow on-device, so there was nothing to port |
| ✅ | Planner / executor / verifier roles | Live 2026-09-23: plan, steps, and an independent PASS with a durable receipt. JVM-tested in `OperatorCoreTest.kt` |
| 🟡 | Native task journal (Room) + autonomy supervisor service | Task identity, checkpoints, cancellation and crash recovery moved to Kotlin. Instrumented tests exist (`AutonomyTaskDaoTest`, `AutonomyTaskMigrationTest`); a reboot/process-death recovery run on a real phone is not recorded |

## Remote PC

| | Feature | Notes |
|---|---|---|
| ✅ | QR-only pairing to the Windows backend | Manual host/token entry is gone entirely |
| ✅ | Cross-network first, silent LAN upgrade | Confirmed 2026-07-11 on both same-Wi-Fi and cellular/Tailscale |
| ✅ | Forwarding whole tasks to the desktop autopilot | With approve/deny and clarify prompts on the phone |
| ✅ | Live PC screen over WebRTC + touch input | Signaling rides the existing WebSocket; video is a real `RTCPeerConnection` |
| 🟡 | Device-key auth (Keystore EC identity, pinned host, expiring single-use pairing challenge) | Replaces the bearer token completely. In source and unit-tested; no recorded live re-pair on a device since the change |
| 🟡 | Task protocol v2 (stable ids, idempotency, event-cursor resubscribe) | Same — built and tested, not live-confirmed |

One environment gotcha that will waste an afternoon if you forget it: **Windows Firewall
blocks inbound 8765 on the Tailscale adapter** unless the rule is scoped for it. `start.py`
in the desktop repo auto-fixes this (`_ensure_tailscale_firewall`, scoped to
`100.64.0.0/10`). Backend changes need a desktop app restart to take effect.

## Security

See [SECURITY.md](SECURITY.md) for the full findings and current fix status. Summary:
the Critical and High findings from the 2026-07-17 audit have since been addressed —
including the two that were deferred at the time (secrets → Android Keystore, and the
bearer token → device-key identity). The remaining items are Medium/Low design choices.

## Packaging

| | Item | Notes |
|---|---|---|
| ✅ | Debug + release APK build | `tauri android build [--debug] --apk --target aarch64`. Both built 2026-09-25; the release APK (33 MB vs 346 MB debug, debug-key signed, not debuggable) installed over the debug app on the SM-E156B, booted clean, wake word listening, accessibility service kept |
| 🟡 | Release signing | `gen/android/keystore.properties` is wired up; without it the release APK falls back to the debug key |
| ⬜ | A production keystore and a genuinely signed, distributable build | Needed before this goes to anyone else |
| 🟡 | App icon: the HUD's Iron Man helmet in a cyan ring, as an Android adaptive icon (2026-09-25; sources in `src-tauri/icon-src/`, regenerate with `npx tauri icon src-tauri/icon-src/icon.json`) | Built into both APKs; not yet seen on the home screen. Splash screen is still the default |

---

## The 2026-09-22 correctness pass

A full read-through of the codebase (not just a diff) found 27 confirmed correctness
bugs, all fixed in one pass. Typecheck, build and 298 tests are green. Some of it has
since been confirmed on a device (see the section after this one); most has not. The ones
that changed user-visible behaviour:

**Features that never worked at all**

- `customize_screen` — advertised action names had zero overlap with the implemented ones,
  so every HUD-customisation request failed. Also added the four advertised actions
  (`show_all`, `hide_all`, `toggle_panel`, `reset`) that had no branch behind them.
- Explicit Groq mode ignored your chosen model — an operator-precedence slip meant
  `GROQ_DEFAULT` was returned in *every* case.
- Semantic memory was read every turn but never written, costing an embedding round-trip
  per turn against a permanently empty store.
- Icon-only controls (Send buttons, back arrows, overflow menus) were all rendered to the
  operator model as `(no text)` — it couldn't tell them apart and tapped by guess.
- A Gemini-only user could not finish first-run setup; a Vertex-only user's mic never
  started (stale `useCallback` closure).
- `play_pause`/`next`/`previous` opened the Android Settings app and reported success.

**Hangs, loops and false confirmations**

- A gesture whose Android callback never fired hung `phone_task` forever, unrecoverable
  even with STOP. Now guarded in both Kotlin and `phoneInvoke` (see ARCHITECTURE §5).
- A PC connection rejected after opening reconnected every ~3s forever without backing
  off, because the backoff counter reset pre-auth.
- The remote STOP button said "hard stop sent" off an optimistic return value while the
  task kept running on the PC.
- An ICE candidate arriving before the WebRTC answer applied was silently dropped,
  stranding the live view on "Connecting…".
- A second task's approval challenge invalidated the dialog you were looking at for the
  first one.

**Data correctness**

- Agenda times were sorted and compared as raw strings, so a 9am item sorted below every
  afternoon entry and showed as the current activity all day.
- Agenda entries were keyed by weekday name only and never retired — everything silently
  recurred weekly, forever.
- Calendar mirroring dropped the `eventId`, so deleting an agenda item orphaned the real
  calendar event permanently.
- `removePlaybook` deleted *every* name containing the query while reporting the singular
  "Forgot the playbook", destroying unrecoverable verified receipts.
- A Vertex credential swap kept serving the old project's token for up to 55 minutes,
  producing a 403 that benched the only Vertex route for a day.
- Long spoken replies dropped the "speaking" state ~70s early (a 30s cap on a timer that
  was meant to be a backstop), so anything gated on it misfired.

### The on-device session, same evening

The debug APK was rebuilt and installed on the real device (SM-E156B, Android 16) and
driven by hand. What that established:

**Confirmed working on-device**

- The app boots clean, no crashes, wake word scoring, all polling bridges alive.
- **The silent-fallback fix works.** The "Switched to …" banner appeared on a real turn —
  that notice had been dead whenever the preferred route was benched.
- **The dead Gemini ids are fixed.** `gemini-2.0-flash` → 404 became `gemini-3.6-flash` →
  answering; zero 404s afterwards. A later 503 ("high demand") benched for **2 minutes**
  instead of the old **24 hours**, i.e. correctly classified as transient.
- `open_app` launches WhatsApp by explicit component; no Android app-chooser involved.

**Two NEW bugs the session exposed** — neither existed in the review, both are open:

| | Finding |
|---|---|
| 🟡 | **The 30s HTTP timeout is too short for an operator step.** *Fixed in source 2026-09-23 (operator calls now get `timeoutMs: 90_000`, chat keeps 30s); not yet device-verified.* `resilientFetch`'s default aborted a model call after 31s (`"Request canceled"`), which benched the route. An operator step uploads a screenshot to Gemini, so it is far slower than a chat turn. Every step is at risk of timing out and burning a route. |
| ⬜ | **The operator stalls ~60s after JARVIS is backgrounded.** *Cause confirmed 2026-09-23 — see below.* Timeline: `taskBegin` 22:30:16 → `observe` → model call aborted at 31s → WhatsApp opened 22:30:56 → `observe` → **last JS→native call 22:31:56, then nothing**. Zero `tap`/`set_text` ever issued. Process still alive (pid 1356); an 8s sample later showed 0 plugin calls; Samsung's Freecess explicitly *skipped* freezing it at 22:31:03. |

**Narrowed 2026-09-23 (code reading, no device):** it is almost certainly *not* the
operator awaiting one stuck promise. For the whole task the cross-app STOP overlay polls
`poll_stop_overlay` every 250ms (and the wake word polls every 140ms), neither gated on
visibility — so "0 plugin calls in 8s" means **every** JS timer in the WebView had
stopped, not just the operator. Also ruled out: wry never calls `WebView.onPause()` /
`pauseTimers()`, and WebView's default renderer priority is already IMPORTANT regardless
of visibility, so `setRendererPriorityPolicy` is not the lever.

**CONFIRMED on-device 2026-09-23 (SM-E156B):** the hidden WebView's task queue is
paused ~60s after JARVIS leaves the foreground. Measured with a 1s `setInterval` over
CDP: ticks ran normally until t≈63s after backgrounding, then **zero** until JARVIS was
foregrounded at t≈154s. A `plugin:phone|observe` invoke issued while frozen resolved only
at the moment of foregrounding (101s). Meanwhile the process sat at `FGS`, `isFrozen=false`
— the OS did not freeze it, and `Runtime.evaluate` still ran — so it is Chromium pausing
the hidden page's scheduler, not Android, and not a hung promise. **Any phone task that
runs longer than ~60s after its first app switch will stall.** A same-day WhatsApp send
finished in 44s and so escaped it.

Fix options, undecided: move the operator loop native (robust, large); keep the WebView
"visible" to Chromium during a task (e.g. re-dispatch `onWindowVisibilityChanged(VISIBLE)`
to the WebView from `MainActivity.onStop` while a task runs — small, untested); or a PiP
window (small, but can cover tap targets).

**Previously open:** *what* stops it. Chromium throttling a
hidden WebView is the leading hypothesis and the 60-second gap fits, but the confirming
test (foreground the app and see whether polling resumes) was not run. Do that first — it
separates "WebView suspended" from "operator awaiting a promise that never settles", and
those need completely different fixes.

This matters more than it looks: a phone task is backgrounded *by definition*, so if this
is what it appears to be, **no multi-step phone task can currently finish**, and the ✅
rows under "Phone control" describe foreground behaviour only.

### Known gaps this pass deliberately left

- **Media transport control is still unimplemented.** `play_pause`/`next`/`previous` now
  fail honestly and are no longer advertised. The real fix is
  `AudioManager.dispatchMediaKeyEvent` behind a new native command.
- **Relative volume is still a Settings screen.** `set_volume` only takes an absolute
  0–100 level and nothing reads the current level back, so "louder" opens the sound panel.
  Upgrade path is `AudioManager.adjustStreamVolume`.
- **Agenda rows written before this pass have no date stamp** and will still recur weekly
  until touched. New rows retire correctly.

### The 2026-09-23 native operator

The ~60s stall was confirmed on-device as Chromium pausing the hidden WebView (see above),
so the whole loop was ported to Kotlin: `OperatorCore.kt` (Android-free, 28 JVM tests)
and `NativeOperator.kt` (accessibility adapter, HTTP route ladder, Room journal, a
start/status registry). JS starts a task (`operator_start`) and polls it
(`operator_status`); nothing native waits on the WebView. Found and fixed during the
device runs:

- **`scroll` lied.** It picked the largest scrollable, and on Samsung Settings that's a
  full-screen `coordinator` that accepts `ACTION_SCROLL` and moves nothing — "ok" every
  time, until the cycle guard stopped the task. Scroll now only reports ok if the screen
  changed, falling through to the next scrollable, then a swipe, then an honest failure.
- **`stale_observation` churn, confirmed.** A live page moved the native generation during
  every ~700ms model call — three rejected taps in a row. The loop now re-observes once
  and retries only if the same control (selector) is still there at the same risk.
- **The planner once took ~85s** on an overloaded Gemini route. It now has a 20s,
  single-shot ceiling; a step keeps 90s.
- `open_app` now waits (≤4s) for the app to actually reach the foreground — on 09-23 the
  old loop opened WhatsApp twice because it observed the launcher.
- A done that ran out of quota *after* acting now says what it last did, so the user
  checks rather than resends (the 09-23 WhatsApp message *was* sent, yet reported as a
  plain rate-limit failure).

Known gaps: the result notification needs `POST_NOTIFICATIONS` — it was declared but
never requested at runtime, so Android 13+ dropped every notify() silently; requested at
plugin load since 2026-09-23 (evening), grant not yet confirmed; mid-task approval and "ask the user" are gone — R3 steps and un-consented
R2 steps suspend honestly instead; the HUD no longer gets per-step screenshots for local
tasks.

### The 2026-09-23 rate-limit fix

Phone tasks kept dying on "I've used up the free quota" with just one free Gemini key and
one free Groq key. The cause wasn't too little quota. **Per-minute limits were treated as
daily ones**: every quota 429 went onto the 2m → 10m → 1h → day ladder, so a Groq
tokens-per-minute 429 that resets in ~8s benched the route for minutes, repeat hits
escalated it toward a day, and one burst of operator steps benched every route in ~20s.

- `errorClass.limitWindow()` reads the window from the 429 body (Groq "per minute (TPM)" /
  "per day", Gemini `quotaId` …PerMinute…/…PerDay…); `retryAfterMsFrom` also reads
  "Please try again in 6.3s". A **minute** window benches for exactly the provider's wait
  (2–65s) and never climbs the ladder; **day** keeps the ladder. 503/timeout: 90s → 20s.
- Chat (`chatOverLadder`) waits once, ≤15s, when every route is only briefly out.
- Native operator (`RoutePacer.kt`): reads Groq's `x-ratelimit-remaining/reset-tokens`
  on every response, skips a route that can't fit the next step, and **waits** (≤65s,
  STOP-aware, shown as "(rate limited — waiting Ns …)") instead of failing over into more
  429s.
- Chat sends the last 12 turns instead of 40.
- Optional pooled free providers: OpenRouter, NVIDIA NIM, Mistral (Settings ▸ API keys ▸ Extra
  free providers). Fallbacks only; models discovered live (`providers/catalog.ts`).

**Live-verified 2026-09-23 15:35–15:38:** the two-app task ran for 3m22s with 7 paced
waits (6–43s), **zero 429s, zero benched routes**, and finished verified.
Also found in that run and fixed: the operator tapped JARVIS's own HUD (and hit its own STOP)
when a task started with JARVIS on screen; its own package is now refused as a target
(live-confirmed in the evening run below).

### The 2026-09-23 evening device run (Gemini + Groq + OpenRouter + NVIDIA keys)

Four runs of "open Settings, find storage used, then count the Clock alarms". Run 4
**finished verified** in 2m32s ("55.2 GB used of 128 GB; 5 alarms, none enabled") on
Groq + OpenRouter, with Gemini out for the day. Found and fixed along the way:

- **Wake-word native crash → every phone task dead.** `WakeWordEngine.release()` (library)
  cancels its inference job without waiting, then closes the ONNX sessions; an in-flight
  `OrtSession.run` hit the destroyed session and SIGABRT'd the process (15:59:52). Android
  then listed the accessibility service under *Crashed services* and never rebound it, so
  every task failed preflight while the Settings switch still showed on. `WakeWordManager`
  now owns the engine's scope and releases only after `cancelAndJoin()`. A reinstall
  rebinds a crashed service; otherwise the user must toggle it off and on — the failure
  message now says exactly that instead of "turn it on".
- **Cycle guard stopped real scrolling.** Its "4th identical move" rule counted
  `scroll:down`, so both Settings tasks died on their 4th genuine scroll. Scrolls are
  exempt (a scroll that doesn't move the screen already fails honestly). JVM-tested.
- **An empty 200 was treated as an answer.** OpenRouter returns upstream failures as
  HTTP 200 with an in-body `error` ("Upstream error from Nvidia: Service temporarily
  overloaded"); Groq `gpt-oss-120b` also returned empty content once. Each burned a step
  as an "unclear reply" and one task gave up with four routes untried. Both the native
  ladder and `OpenAICompatProvider.chat` now treat it as a retryable 502.
- **Observability.** logcat now names the route that answered every call, the route list
  at task start, unclear replies (with the text) and waits.

What the pooled providers did on this key set: OpenRouter `nemotron-3-super:free`
works between frequent "overloaded" errors; `gemma-4-31b:free` 429'd upstream every time;
**both NVIDIA picks 404 "Function not found for account"** — the NVIDIA key currently adds
no working route. Gemini free tier learned `rpd=20` for both 3.6-flash and 3.5-flash.

Follow-ups from this run, fixed the same evening:

- ✅ **Two copies of the app were running.** The "dual-WebView quirk" was
  `tauri.conf.json`'s four *desktop* windows (`main`, `overlay`, `browser-panel`,
  `control-overlay`) — Tauri built WebViews for them on Android too, and a hidden 0×0
  one ran a whole second brain (its own pollers, wake-word loop, `phone:*` access) and
  swallowed invoke responses: `[TAURI] Couldn't find callback id` ~20×/2.5s from boot.
  `tauri.android.conf.json` now declares `main` only. Live: one page, **zero** warnings.
- 🟡 **Chat claimed an action it never took.** Groq `gpt-oss-120b` answered a phone
  request with "I've opened the Accessibility settings…" and no tool call — a copy of an
  earlier (true) turn in its history. `loop.ts` now ports the Python brain's
  `_claimed_done_without_acting`: an action-shaped request + no tool run + a
  completion-claim reply gets one silent recheck, and the claim is never spoken.
  Unit-tested; the live failure hasn't been reproduced since.
- ✅ **The spoken result waited for the user to come back.** The summary is produced by
  the paused WebView (it arrived 0.5s after foregrounding, never before). The native
  operator now brings JARVIS to the front when a task ends — unless it succeeded and the
  model set `phone_task`'s new `stay_in_app` (media, an open chat), or the user pressed
  STOP. Live: "find the Android version" finished verified at 17:05:33.738, JARVIS was
  foreground 85ms later and spoke "Android version 16" ~3.7s after. The `stay_in_app`
  branch has not been exercised live.
- ✅ **NVIDIA picks that 404 for the account.** The catalog keeps up to 8 ranked
  candidates per provider and routes through the best two not marked dead; a pooled
  route's 404 (chat or native) marks its model dead for 7 days. Live (Groq/OpenRouter
  benched by hand to force NVIDIA): four listed models 404'd and were rotated out one
  after another. NVIDIA's `/v1/models` doesn't reflect what a key can call: of the three
  models the user's NVIDIA page offered, `llama-3.3-70b-instruct` and
  `qwen2.5-coder-32b` answered **410 "reached its end of life"** (which also exposed that
  410 wasn't retryable — the raw "NVIDIA NIM 410" ended the turn; now treated like 404
  in both ladders), and listed `openai/gpt-oss-20b` timed out at 30s every time. The one
  that answered, `nemotron-3-nano-omni-30b-a3b-reasoning`, is filtered out by name, so
  it's seeded first (it 503s "worker limit 16/16" when NVIDIA's free pool is full).
  Also fixed: the catalog refresh ran before the Keystore keys loaded and wiped every
  pooled provider's candidates on each launch.

**Device gotcha:** `adb shell am force-stop com.jarvis.app` makes Android *disable*
JARVIS's accessibility service (it drops out of `enabled_accessibility_services`). Use
`am start` / reinstall to restart the app, or re-enable the service afterwards.

### The 2026-09-24 smart-routing + Memory port

Ported from the desktop app (`7a2d296` there, `fb11882` here); design in
[ARCHITECTURE.md](ARCHITECTURE.md) §2 *Smart routing* and §7. Verified: typecheck, 259
tests, build, and a browser preview at 375px (remember a fact, two-tap exact forget, the
timeline, saved chats; the ranking list, Re-rank, per-key Remove). Then the arm64 debug
APK was built and installed with `adb install -r` on the Galaxy M15 (keys kept):

- **Boots clean** — no crash or JS error in logcat after launch.
- **Ranking runs on-device** — after the Keystore keys loaded, discovery fed the ranker
  and it went straight to estimating the one model the benchmark table doesn't cover:
  `[ranker] estimating 1 model(s): gemini-omni-1.1-flash`.
- **The estimate failed** — `gemini-3.6-flash` and `gemini-3.5-flash` both answered
  **HTTP 429** (the Gemini key's quota), so the model keeps a guessed score; the app
  retries after 6 h or on Re-rank. This is the designed fallback, but it means the
  grounded-estimate path has still never *succeeded* on the phone.

Known gap from this run: **Gemini Omni is ranked as a chat model.** The desktop's LLM
estimate marked it non-chat, so it drops out there; here, with the estimate failing, it
sits at the bottom of the everyday (mid) tier and would be tried before any flagship or
fast model if every other mid model failed. The fix is one `KNOWN` row
(`^gemini-omni` → -1, non-chat), made in `modelCatalog.ts` **and** the desktop's
`llm/model_catalog.py` together. `"omni"` can't go in `NON_CHAT` — it would also drop
NVIDIA's `nemotron-3-nano-omni`, the one NVIDIA model known to answer.

### The 2026-09-25 rate-limit regression fix (branch `audit/prepublish`)

After the smart-routing port no phone task finished. Measured on the device, not guessed:

- **Gemini 3.6/3.5-flash were marked "no tools" forever.** `rejectsTools` fired on any
  400 that mentioned tools (e.g. a conversation-shape 400), so every action turn skipped
  the two models that do tools best. Now it needs "not supported/enabled" wording; the
  ranking store moved to `jarvis.ranking.v2` to drop the bad marks.
- **Pooled free providers led the ladder.** Ranked by score, OpenRouter `:free` models
  sat above Groq, and their shared pool 429s "upstream" constantly: a chat turn walked
  4 failing routes (~35s) before answering. Pooled providers are fallbacks again (tail
  only), and "rate-limited upstream" benches like a per-minute limit (TS and Kotlin).
- **Every operator task died on its first request.** The native operator sent
  `thinkingBudget: 0` to Gemini 3.x, which answers 400 (measured: 3.5-flash-lite 400,
  3.1-flash-lite 200, 2.5 takes only the budget). 3.x now gets `thinkingLevel:
  "minimal"`, 2.5 keeps the budget; the same fix in `providers/gemini.ts`. A 400 now
  skips that route for the task instead of ending it (native bodies are model-specific).
- Gemini Omni is marked non-chat in `modelCatalog.ts` (the desktop's `model_catalog.py`
  still needs the same row).

**Live-verified 2026-09-25 (SM-E156B):** "find the Android version" finished verified in
33s and "count the Clock alarms" in 24s, zero 429s, zero benched routes, JARVIS back in
front speaking the answer both times.

Follow-up the same day: the search-grounded model estimate no longer runs at launch (only
from Re-rank; 0 `[ranker]` calls at startup, confirmed); a route that keeps timing out now
climbs 20s → 2m → 10m (capped, reset by any success) instead of costing every turn its full
timeout; models scoring below 3 (e.g. `groq/allam-2-7b`, which sat in the operator's
ladder) are never routed to. Live: "earliest alarm" finished verified in 12s, and a chat
turn answered on its first route.

## Open items worth doing next

0. **Try the 2026-09-25 voice and Gemma changes by voice on the phone:** that commands end
   ~1s after you stop talking, how often Whisper gets them right now, and that a Gemma
   reply no longer includes its reasoning. Then decide on native command capture (the
   wake-word handoff still clips the start of a command — see *Voice*).
0a. **Finish the smart-routing check on the device.** Phone-side Gemini Omni is marked
   non-chat and chat turns are live-verified (2026-09-25); still to do: add the same
   `^gemini-omni` row to the desktop app's model catalog, open Settings ▸
   Routing on the phone (list populated, no Omni), and open MEMORY there (add + forget a
   fact).
0b. **Watch one long phone task after the 09-25 routing fixes** — the verified runs were
   12–33s. A multi-minute task would exercise the transient ladder and the native 400
   failover, neither of which fired live yet.
0c. **The model is now the bottleneck.** Mechanics are 1–3s a task; the rest is model calls
   (gemma-4-26b ~2s text / 4–8s with a screenshot; flash-lite routes often 503/slow at night;
   gemma-4-31b 16–27s on chat turns — now demoted and hedged). Re-test the audible paths
   (Spotify play/pause, a timer) in the daytime.
0d. **The chat's fallback model invents phone facts.** When Gemini's daily chat quota is
   spent the chat runs on Groq's qwen, which on 2026-09-26 answered "Android 14", a made-up
   Wi-Fi name and a made-up uptime without calling `phone_task`, and once read "turn on dark
   mode" as JARVIS's own HUD theme. The system prompt and the `answeredPhoneWithoutLooking`
   recheck round target the first three; watch whether they hold on that model, and consider
   keeping phone questions off the weakest chat routes. The operator itself was right
   whenever it was reached.
0e. **Phones without a setting.** This M15 has no screen-resolution setting and no Settings
   entry for auto-rotate. The operator now fails honestly (86.6 s) instead of looping, but
   the right end is faster: a lookup that the app's search and the obvious section both
   miss could stop after the first pass.
1b. **Re-test the rest of the 2026-09-22 fixes on a device.** Still unexercised: the remote
   STOP button, a long spoken reply, and adding then deleting a calendar-mirrored agenda
   item.
1. **A live device pass over the auth + autonomy rework.** Re-pair with a PC from scratch
   on the new device-key path, run a phone task through the Room journal, then force-kill
   the app mid-task and confirm it comes back *suspended* rather than repeating the last
   action. This is the biggest untested surface in the app.
2. **Wake-word soak test.** Long session, real voice, app backgrounded.
3. **A real release keystore**, then a signed APK installed on a clean phone with the
   permissions checked one by one, and attached to a GitHub Release.
4. **Icons and splash.**

---

## Where the history went

The original planning document and the phase-by-phase build log live in
[archive/](archive/) — `ANDROID_PLAN.md` (the June 2026 engineering plan) and
`NEXT-STEPS.md` (the Phase 0–4 log). They are kept for context and are **not** maintained;
where they disagree with this file or [ARCHITECTURE.md](ARCHITECTURE.md), those two win.
