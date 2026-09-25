> **ARCHIVED — historical record, not maintained.**
> Written during the June–July 2026 build-out. Much of it is now out of date.
> For the current system see [../ARCHITECTURE.md](../ARCHITECTURE.md) and
> [../STATUS.md](../STATUS.md); those win wherever this file disagrees.

---

# JARVIS for Android (`.apk`) — Plan & Execution Brief

> Status: **planning** (approved direction). Nothing built yet. The Windows desktop
> product is shipping; this is the roadmap to a standalone Android app.

## Decisions locked
- **Standalone on-device assistant** (a real native app; no PC required), sellable.
- Four powers: **(1)** voice chat + answers, **(2)** control apps **on the phone**,
  **(3)** optionally remote-control the PC, **(4)** a mobile HUD.
- **Brain language: TypeScript** (recommended) — reimplement the orchestration in the
  app; Chaquopy-embedded Python is the fallback if rewriting proves too costly.

---

## Context — why this is a port, not a recompile

JARVIS today is a **Windows desktop** app: Tauri 2 (Rust) + React HUD ↔ a
PyInstaller-frozen Python backend over `localhost:8765`, whose headline powers are
**PC computer-control** (UIAutomation/pyautogui) and **browser autopilot**
(Playwright/Chromium). On a phone those don't exist, and the local ML stack can't run.

Grounded in the code:
- **8 backend modules are hard-Windows** (`actions/computer.py`, `actions/browser.py`,
  `actions/app_launcher.py`, `actions/skills.py`, `autopilot.py` + spec/reqs):
  `ctypes`/`win32`/`uiautomation`/`pyautogui`/`pygetwindow`/`pycaw`.
- The **local ML stack** (`faster-whisper`/`ctranslate2`, `openwakeword`/`pyaudio`,
  Piper) is heavy native and won't run on Android — replace with Android-native speech.
- **8 frontend files assume the multi-window desktop model** (`Overlay.jsx` pill,
  `ControlOverlay.jsx`, `BrowserPanel.jsx`, tray, global-shortcut) — a phone is one Activity.
- **No Android scaffolding exists** (`src-tauri/gen/` has only desktop/windows schemas).

**The good news / reuse:** the assistant *brain* (LLM routing, memory, tools, the
agentic observe→act loop) and the React HUD are largely portable, and **PC
computer-control maps almost 1:1 to Android's AccessibilityService** — its
`AccessibilityNodeInfo` tree is the mobile analog of the UIAutomation tree, and the
`click_xy` coordinate-tap already built for Swing apps is exactly what mobile needs.

---

## Recommended architecture

Tauri 2 (Android target) reusing the React HUD in the system WebView, with native
Android plugins (Kotlin ↔ JS) for everything the browser can't do. No Python on device.

```
┌─────────────────────────────────────────────────────────────┐
│  Tauri 2 Android app (one Activity)                          │
│                                                             │
│  React HUD (REUSED, reflowed to one screen)  ──┐            │
│                                                ▼            │
│  Assistant "brain" in TypeScript  ── LLM (Groq/Gemini HTTP, │
│   (agentic loop, tools, memory)      BYO-key), web/weather/  │
│                     │                places/news (HTTP)      │
│                     ▼ (Tauri plugin bridges)                 │
│  ┌──────────────┬───────────────┬──────────────┬─────────┐  │
│  │ STT          │ TTS           │ AppControl   │ WakeWord│  │
│  │ Android      │ Android       │ Accessibility│ Porcupine│ │
│  │ SpeechRecog. │ TextToSpeech  │ Service (KT) │ (opt.)  │  │
│  └──────────────┴───────────────┴──────────────┴─────────┘  │
│                     │                                       │
│   Remote-PC power ──┴── wss:// to the EXISTING desktop      │
│                         backend (protocol reused as-is)     │
└─────────────────────────────────────────────────────────────┘
```

### The #1 decision: where the "brain" lives
The Python backend's brain (provider routing, the agentic loop, memory, playbooks, the
tool registry) is large. Two ways to get it on-device:

- **(Recommended) Rewrite the orchestration in TypeScript**, inside the Tauri app. The
  LLM providers and info-tools are all HTTP, so they port cleanly; memory → local
  SQLite/files; platform tools call native plugins. One language, no Python-on-Android
  fragility, smallest APK, most maintainable/sellable. Cost: the brain is reimplemented
  (phased — MVP loop first, tools added incrementally). The Python modules become the
  **reference spec**.
- **(Alternative) Embed slim Python via Chaquopy** (pure-Python only: `llm/`,
  `memory_store`, `playbooks`, tool dispatch; httpx works on Android). Maximizes reuse
  but couples a Gradle/Chaquopy runtime to the Tauri-Android build (unproven, larger
  APK, harder to debug). Use only if the TS rewrite is judged too costly.

---

## Feature port map

| Desktop feature | Android approach | Reuse / reference |
|---|---|---|
| Wake word (`openwakeword`+pyaudio) | **Push-to-talk (MVP)**; Porcupine Android SDK later | drop pyaudio; new plugin |
| STT (`faster-whisper`) | **Android `SpeechRecognizer`** (free, on-device) | new Kotlin plugin; cloud STT optional |
| TTS (Piper/edge/SAPI) | **Android `TextToSpeech`** | new Kotlin plugin |
| LLM (Groq/Gemini/Vertex) | **Reused HTTP**, ported to TS | `llm/groq_bridge.py`, gemini bridge, `model_discovery.py` |
| Memory / conversations / playbooks | **Local SQLite/files** | `memory_store.py`, `playbooks.py` |
| Info tools (web/weather/places/news) | **Reused HTTP**, ported to TS | `web_answer`, `places`, `weather`, `news` |
| Tool registry / dispatch | TS registry mirroring the Python one | `llm/live_tools.py`, `actions/__init__.py` |
| **PC computer-control** | **Android AccessibilityService** (tap/type/scroll/read-tree); the agentic loop ported | `autopilot.py` loop+prompts; `computer.py` (UIA→AccessibilityNodeInfo); **`click_xy`** → coordinate-tap |
| Screenshots (mss) | **Android MediaProjection** (vision-first operator) | vision-first design in `autopilot.py` |
| App launcher (registry/Start menu) | **Android intents / PackageManager** | `app_launcher.py` |
| Browser autopilot (Playwright) | **In-app `WebView`** automation, or defer | lower priority on phone |
| **Remote-control the PC** | Phone `wss://` to the **unchanged desktop backend**; issues `computer_task`/browser tasks run on the PC | **WS protocol + `server/websocket_server.py` reused verbatim**; pairing = PC IP+token or a tunnel |
| HUD (4 Tauri windows) | **Single-screen React HUD**, reflowed; pill → optional Android overlay (`SYSTEM_ALERT_WINDOW`) | reuse `hud/`, components; drop `*Window.js`, tray, global-shortcut |
| BYO-key onboarding | **Reused** (keys in app secure storage) | `Onboarding.jsx`, `app_secrets` model |

---

## Execution detail

### 0. Toolchain — current status & exact gaps
Already present: **JDK 17**, **Android Studio + SDK** (`%LOCALAPPDATA%\Android\Sdk`),
`adb`, platforms 34/35/36, **Rust 1.95**, **Tauri CLI 2.10.1** (has the `android` cmd).
Missing, in order:
1. **NDK + CMake** — *mandatory* (Tauri compiles the Rust core to Android `.so`s).
   Easiest: Android Studio ▸ SDK Manager ▸ SDK Tools ▸ **NDK (Side by side)** + **CMake**.
   (`cmdline-tools`/`sdkmanager` also not installed, so the pure-CLI route needs that first.)
2. **`ANDROID_HOME` / `NDK_HOME`** env vars → the SDK path + chosen NDK.
3. **Rust targets**: `rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android`.
4. Then `tauri android init` is unblocked.

### 1. Phase 0 mechanics (scaffold)
- `tauri android init` generates `src-tauri/gen/android/` (a Gradle project); it doesn't
  touch the desktop build.
- **The 4-window config is already mobile-safe:** `main.jsx` routes by Tauri window label,
  and on Android only the `main` window exists → it always renders `<App/>`. The
  pill/browser-panel/control-overlay windows never instantiate, and their sync helpers
  already no-op when `getByLabel` returns null. Nothing breaks; the multi-window code goes dormant.
- **`lib.rs` needs `#[cfg(desktop)]` guards** around the tray-icon, the `global-shortcut`
  plugin, and `spawn_backend` (the Python sidecar) so the mobile build skips them. This is
  the main Rust edit for Phase 0.

### 2. Frontend reflow
Smaller than feared — only `App.jsx` renders on mobile. Work: reflow its layout to one
portrait screen (the `hud/` gauges/panels stack/scroll instead of a 1100×720 grid), make
`ViewportScale` mobile-aware, enlarge touch targets, no-op the multi-window sync calls.
Keep `Onboarding`, `Settings`, chat, `useWebSocket` as-is.

### 3. The brain port (TS) — biggest work item
Approx sizes (lines) to scope it — the *portable logic* is far less than 1:1 (much of
`main.py`/`groq_bridge.py` is Windows glue + WS plumbing + prompt text). Realistic TS port
≈ **4–6k lines of meaningful logic**, phaseable.

| Python | LOC | TS port |
|---|---|---|
| `main.py` | 2642 | extract the observe→act/route loop; drop WS-server + Windows glue |
| `llm/groq_bridge.py` | 2315 | LLM client; keep system prompts / `ACTION_CATALOG` text |
| `actions/__init__.py` | 903 | tool dispatch (~half portable, ~half → native plugins) |
| `autopilot.py` | 1621 | the on-phone-control operator (Phase 2) |
| `llm/gemini_bridge.py` | 469 | LLM client — ports cleanly |
| `llm/live_tools.py` | 465 | tool schema registry — ports directly |
| `places/weather/news` | ~524 | HTTP tools — port directly |
| `memory_store`/`playbooks` | 476 | logic ports; storage → Tauri fs/sql plugin |

**Tool triage** (from `live_tools.py`'s registry):
- *Port as-is (HTTP/logic):* weather, web_search, find_places, get_directions, news,
  set_reminder, manage_routine, manage_playbook, remember/forget_fact, set_my_location,
  make_qr_code, generate_image, clear_conversation.
- *Map to Android APIs:* take_screenshot→MediaProjection, open/close_application→intents,
  open_website→intent/WebView, set_volume/system_control→AudioManager, record→MediaRecorder,
  read_clipboard→ClipboardManager, read_file/list_directory→SAF, open_saved_file→intent.
- *New on-phone tools (Phase 2):* tap / type / scroll / read_screen (AccessibilityService).

### 4. Native plugins (Tauri 2 Android, Kotlin ↔ JS)
One small plugin per capability, each exposing commands to JS + a manifest/permission entry:
- **stt** — `SpeechRecognizer` → `RECORD_AUDIO`.
- **tts** — `TextToSpeech`.
- **appcontrol** — an **AccessibilityService** → `BIND_ACCESSIBILITY_SERVICE` (the headline; §5).
- **screen** — MediaProjection capture → vision operator.
- **wakeword** (Phase 4) — Porcupine + a `FOREGROUND_SERVICE`.
- **overlay** (Phase 4) — `SYSTEM_ALERT_WINDOW` for the pill.

### 5. On-phone control = the UIAutomation analog
The cleanest reuse: Android's `AccessibilityNodeInfo` tree ≈ the UIA tree in `computer.py`.
The `autopilot.py` observe→act loop (cycle/loop guards, redo-guard, the operator prompt,
vision-first) ports almost intact; only the *executors* change — `click_ui`→tap-by-node,
**`click_xy`→tap-by-coordinate (already coordinate-normalised, drops straight in)**,
`type_text`→AccessibilityService input, screenshots→MediaProjection. The hard part is
permissions/policy, not the logic.

### 6. Remote-PC (Phase 3) — pure reuse
The phone opens a second `wss://` to the **unchanged desktop backend** and speaks the
existing protocol verbatim (handlers: `text_input`, `run_action`, `permission_response`, …;
events: `status`, `action`, `agent_task/step/shot`, `control_state`, …). New code: a pairing
screen (PC IP + WS token, or a tunnel).

### 7. Distribution & signing
Release **keystore** (`keytool`) → `tauri android build` → APK (sideload) or AAB (Play).
**AccessibilityService is a Play-Store policy flashpoint** — likely steers toward
**sideloaded APK** (which also fits the "sell the installer" model). BYO-key onboarding is unchanged.

---

## Phased roadmap

- **Phase 0 — Scaffold & boot the HUD on Android.** Install NDK/CMake; set env + Rust
  targets; `tauri android init`; `#[cfg]`-guard tray/global-shortcut/spawn_backend; reflow
  the HUD to one screen. **Exit:** HUD renders/runs on an emulator/device as a debug APK.
- **Phase 1 — Core voice assistant (the MVP).** STT/TTS Kotlin plugins + push-to-talk; TS
  brain (BYO-key → LLM → spoken reply); local memory + history; port the HTTP info-tools.
  **Exit:** "talk to JARVIS" works fully on-device, no PC.
- **Phase 2 — Control apps ON the phone (headline).** AccessibilityService plugin
  (`read_tree`/`tap`/`type`/`scroll`); MediaProjection screenshots; port the `autopilot.py`
  loop to drive it. **Exit:** "open WhatsApp and message X" runs on the phone.
- **Phase 3 — Remote-control the PC.** Pairing UI; second `wss://` to the desktop backend;
  issue PC tasks with the existing protocol. **Exit:** from the phone, drive the desktop JARVIS.
- **Phase 4 — Polish & ship.** Porcupine wake word + foreground service; overlay pill;
  HUD polish; icon/splash; signing; release channel.

## De-risking spikes (do these FIRST, before committing to phases)
1. **Tauri-mobile hello-world** — scaffold + run the current HUD on an emulator (proves
   toolchain + WebView + the cfg-guards).
2. **One native plugin end-to-end** — TTS (smallest) to prove the Kotlin↔JS bridge pattern.
3. **AccessibilityService spike** — read another app's node tree + one tap (proves the
   headline is feasible *before* porting the autopilot).

If all three land, the rest is mostly volume work. If the AccessibilityService or
Tauri-plugin spike fights back, that's the signal to consider a native-Kotlin-shell fallback.

## Key risks & open decisions
- **Brain strategy** (TS rewrite vs Chaquopy) — the biggest fork; recommend TS. Decide first.
- **Tauri 2 mobile maturity** — plugin authoring + the Android build chain are rougher than
  desktop; budget setup time. (Fallback: native Kotlin app + WebView HUD.)
- **AccessibilityService + Play policy** — may force sideloaded APK distribution; decide early.
- **Background mic / wake word** — battery + background-execution limits; MVP is push-to-talk.
- **Permissions** the app requests: `RECORD_AUDIO`, `BIND_ACCESSIBILITY_SERVICE`,
  `SYSTEM_ALERT_WINDOW`, `FOREGROUND_SERVICE`, `INTERNET` — each needs an in-app rationale.
- **Effort** is multi-month; **Phase 1 is the first shippable unit.**

## Prerequisites (environment)
Android Studio, Android SDK + platform-tools, NDK, JDK 17, a device/emulator, and a release
keystore. Tauri mobile: `cargo install tauri-cli` (v2, already present), `tauri android init`,
then `tauri android dev` (emulator) / `tauri android build` (APK/AAB).

## Verification (per phase, on emulator + a real device)
- **P0:** `tauri android dev` launches; HUD renders; no desktop-only crashes.
- **P1:** push-to-talk → on-device STT → LLM reply spoken via TTS; memory persists; one
  info-tool returns; airplane-mode → graceful errors.
- **P2:** enable the AccessibilityService; a scripted "open `<app>` and tap `<X>`" completes;
  screenshot reaches the vision operator; `click_xy` taps land.
- **P3:** pair to the desktop backend; a `computer_task` from the phone runs on the PC.
- **P4:** signed release APK installs on a clean device; wake word triggers; overlay shows;
  permission prompts read correctly.

## Reuse summary
- **Reused (code or spec):** React HUD + CSS; the WS protocol & message shapes (verbatim for
  remote-PC, as the brain's internal API otherwise); the `autopilot.py` observe→act loop +
  operator prompts + `click_xy`; LLM provider logic, tool definitions, memory model; BYO-key onboarding.
- **Net-new (Android):** Kotlin plugins (STT/TTS/AccessibilityService/MediaProjection/
  wake-word/overlay); the TS brain; single-screen HUD reflow; Android build/signing/manifest.
- **Dropped on mobile:** Whisper/openWakeWord/Piper/pyaudio, Playwright/Chromium, all Win32
  automation, the 4-window model, tray, global-shortcut.
