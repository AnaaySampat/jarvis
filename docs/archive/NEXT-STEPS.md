> **ARCHIVED — historical record, not maintained.**
> Written during the June–July 2026 build-out. Much of it is now out of date.
> For the current system see [../ARCHITECTURE.md](../ARCHITECTURE.md) and
> [../STATUS.md](../STATUS.md); those win wherever this file disagrees.

---

# Next steps — turning this scaffold into a running Android app

This is the actionable checklist. The deep reasoning behind each item lives in
[ANDROID_PLAN.md](ANDROID_PLAN.md); this file is the "what to do next" view.

Legend: `[x]` done in the scaffold pass · `[ ]` not started · ⚠ needs you / a download.

---

## ✅ Done in this scaffold pass (no build tools required)

- [x] Created `aura-android` as a separate, source-only fork (Windows untouched).
- [x] Removed Windows-only bundled assets (frozen backend, Chromium/Whisper/Piper,
      NSIS installer art) — irrelevant on a phone.
- [x] Phone-proofed the Rust core (`src-tauri/src/lib.rs`): the system tray, the
      global hotkey, and the Python-backend launcher are now `#[cfg(desktop)]`-only,
      so a mobile build skips them. Desktop behaviour is unchanged.
- [x] Scaffolded the TypeScript brain under `jarvis-studio-gui/src/brain/` (types,
      providers, tool registry, memory, native-bridge interfaces, the agent loop),
      mirroring the Python backend as stubs with `TODO(phase-N)` markers.
- [x] Added `tsconfig.json` + TypeScript dev-deps so the brain compiles via Vite.

> Update (2026-06-24): these were verified in Phase 0 — the mobile build now
> compiles and runs on the emulator (the Rust `#[cfg(desktop)]` guards work; the
> TS brain type-checks). See the Phase 0 section below.

---

## ✅ Phase 0 — Toolchain + first boot on the emulator — **DONE (2026-06-24)**

The HUD builds, installs, and renders on the Android emulator. Exit test passed.

1. [x] **NDK + CMake installed** via `sdkmanager` — **NDK `27.2.12479018` (r27c LTS)**
       + **CMake `3.22.1`**. (Had to install `cmdline-tools` first; Android Studio's
       SDK was present but lacked the CLI tools.)
2. [x] **Env vars set** (persisted with `setx` + per-session): `ANDROID_HOME` /
       `ANDROID_SDK_ROOT` = `%LOCALAPPDATA%\Android\Sdk`, `NDK_HOME` /
       `ANDROID_NDK_HOME` = `…\Sdk\ndk\27.2.12479018`.
3. [x] **Android Rust targets added** (all 4).
4. [x] **`npm install`** + **`npx tauri android init`** → `src-tauri/gen/android/`
       generated. (Use `npx tauri …`, not `npm run tauri …`.)
5. [x] **HUD reflowed to portrait** — `ViewportScale.jsx` is mobile-aware (stack +
       scroll instead of shrink-to-fit) and `hud/hud-mobile.css` restacks the rails/
       core/dock. Plus a **routing fix** in `main.jsx`: Tauri-mobile's single WebView
       reports a non-`main` window label, so we now force the main HUD on a touch/
       narrow viewport (before the fix it wrongly rendered `ControlOverlay`).
6. [x] **Built + ran on the emulator.** First boot confirmed: the main JARVIS HUD
       renders in portrait (see `emulator-shot.png`).

**How to build/run it again** (env vars persist; emulator AVD `Medium_Phone_API_36.1`):
```
# start the emulator (headless is fine):
%LOCALAPPDATA%\Android\Sdk\emulator\emulator.exe -avd Medium_Phone_API_36.1 -no-window
# then, from jarvis-studio-gui/, build a self-contained debug APK + install it:
npx tauri android build --debug --apk --target x86_64
adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
adb shell am start -n com.jarvis.app/.MainActivity
```

### ⚠ Gotchas learned (read before Phase 1)
- **`tauri android dev` HANGS after building** (it builds the APK then stalls at the
  install/launch + file-watch step). Workaround: use `tauri android build` (it exits
  cleanly) then `adb install` + `adb shell am start` yourself. A self-contained
  `build` APK also needs no running dev server.
- **The app sits on the "BOOTING J.A.R.V.I.S" screen** because `BootOverlay` waits
  for the Python backend's WebSocket (`ws://…:8765`), which doesn't exist on Android.
  This is the **Phase-0→Phase-1 boundary**: wiring the TS brain (so the HUD needs no
  WS) — or making the boot overlay not block on Android — is the first Phase-1 task.
- **The headless `swiftshader` emulator ANRs its SystemUI under load** ("System UI
  isn't responding"). It's an emulator-perf artifact (software GPU), not our app;
  it clears once build CPU frees up. A real device / hardware-accelerated AVD is fine.
- Screenshot binary-safely with `adb shell screencap -p /sdcard/s.png && adb pull …`
  (PowerShell `>` corrupts the PNG into UTF-16).

---

## Phase 1 — The voice MVP (first sellable unit)  — *in progress*

**Milestone 1A — on-device brain wired (DONE 2026-06-24, verified on emulator).**
The app no longer hangs on boot; it boots → key-entry → the full reflowed HUD.
- [x] `useBrain.js` — in-app brain hook mirroring `useWebSocket`'s shape;
      `isConnected:true` clears the boot overlay. `useAssistant.js` selects brain on
      mobile / WebSocket on desktop (module-level, rules-of-hooks safe). `App.jsx`
      swapped to `useAssistant`.
- [x] `MobileOnboarding.jsx` — slim phone key-entry (no Windows storage path); keys
      kept in `localStorage`. Brain gained a `"groq"` primary tier.
- [x] WebView **CSP** now allows the LLM endpoints (`generativelanguage.googleapis.com`,
      `api.groq.com`); manifest already has `INTERNET`.
- [x] Verified: boot → onboarding → **full HUD renders in portrait** (emulator
      screenshots `phase1-*.png`; layout iterated fast in the browser preview at
      412px). Type-check + build clean.
- [x] Reflow polish: fixed the reactor over-spilling its ring dial onto the clock
      (size the reactor via its `size` prop on mobile, not CSS) and silenced the
      desktop-window sync console errors (`syncBrowserPanel`/`syncControlOverlay`
      now skip on mobile).
- [ ] **Live LLM round-trip with a REAL key** — the chat path is wired + CSP/network
      configured, but a real reply needs a valid Groq/Gemini key (enter it in the
      app's onboarding on a device, or via Settings). Dummy key only proves plumbing.

**Milestone 1B — native voice (DONE 2026-06-24, code + statically verified).**
Chose WebView-native speech over custom Kotlin plugins (less risk, same result):
- [x] **TTS** — `src/brain/platform/webspeech.ts` uses `window.speechSynthesis`
      (backed by Android's TextToSpeech). `useBrain.sendMessage` speaks each reply;
      `stopSpeech`/mute cancel it; status drives the HUD waveform.
- [x] **STT** — `src/brain/platform/stt.ts`: `MediaRecorder` mic capture →
      **Groq Whisper** (`whisper-large-v3-turbo`) transcription → fed to the brain.
      No Kotlin needed: the Wry `RustWebChromeClient.onPermissionRequest` already
      grants `getUserMedia` once `RECORD_AUDIO` is declared (added to the manifest;
      confirmed present in the installed app). Needs a **Groq key** (Whisper).
- [x] **Push-to-talk mic button** (`.mobile-mic` FAB) wired to
      `triggerListen`/`finishListen`/`pttStart`. Type-check + build clean.
- [ ] **Real-device confirmation of audio in/out** — the headless software-GPU
      emulator ANRs on the animated HUD and can't do interactive voice testing, and
      it has no real mic. Speaking to JARVIS + hearing the reply must be verified on
      a physical device (also needs a real Groq key for STT, and any key for the LLM).

**Milestone 1C — depth (DONE 2026-06-24, code + live-preview verified):**
- [x] **Local memory + history persisted** — `memory/store.ts` is now a
      `PersistentStore` backed by `localStorage` (facts + conversation turns, capped
      ~40 + clipped ~2800 chars, with an archived "Recents" list), graceful in-memory
      fallback. `createBrain` defaults to it. *Verified live:* facts/turns survive a
      fresh store instance; forget + archive→Recents work.
- [x] **HTTP info-tools ported** into `tools/http.ts`: `get_weather` (Open-Meteo),
      `get_news` (Google News RSS), `web_search` (Gemini Google-Search grounding),
      `find_places` + `get_directions` (Overpass / Nominatim / OSRM), `make_qr_code`.
      New `tools/location.ts` resolves coords (pinned → device GPS → HTTPS IP geo) and
      `set_my_location` pins/clears it. *Verified live in the preview against the real
      network:* weather (3-day forecast), nearest cafés (Overpass, sorted+deduped),
      driving directions (OSRM) — all returned real Mumbai data; web-search-without-a-
      key and news both degrade gracefully (no fabricated success).
- [x] **Transport: Tauri HTTP plugin** (`tools/httpClient.ts`) — routes through the
      Rust core on-device (no CORS, sends the User-Agent Nominatim/Overpass require),
      falls back to global `fetch` in the browser preview. Added `tauri-plugin-http`
      (Cargo + `lib.rs` init + scoped `http:default` capability) and the JS package;
      extended the CSP `connect-src` with every endpoint.
- [ ] ⚠ **On-device build + test still pending** (same caveat as every prior
      milestone): the Rust HTTP-plugin changes are typecheck/vite-verified but NOT yet
      compiled for Android — needs `tauri android build`. **News is device-only**
      (Google News RSS sends no CORS header, so it only works through the plugin, not
      the preview's global fetch). Real-device audio + a live LLM/Whisper round-trip
      with real keys also remain (carried from 1A/1B).
- **Exit test:** "talk to JARVIS" works fully on the phone, no PC involved.

## Phase 2 — Control apps ON the phone (the headline feature) — *native build DONE; functional test pending*

**The operator + bridge are built + live-verified, AND the native a11y plugin now
compiles + is packaged + recognized by Android (2026-06-25). Remaining: drive a real
app on a real device.**
- [x] **Observe→act operator** (`src/brain/operator/phone.ts`) — ports autopilot.py's
      contract to the AccessibilityService: observe the node tree → ask the model for
      ONE JSON command → execute → repeat, with a step+time budget, cycle + no-progress
      guards, and TRUTHFUL completion (no fabricated success). The model is injected as
      an `OperatorModel`, so the loop is testable with no device.
- [x] **PhoneController** (`operator/controller.ts`) — the surface the operator drives,
      with a `MockController` for testing. `platform/index.ts` implements it over the
      native plugin via Tauri `invoke` (graceful off-device).
- [x] **`phone_task` wired** in `tools/dispatch.ts` (builds an OperatorModel from the
      provider + the provider→Groq failover); plus `enable_phone_control` →
      `openAccessibilitySettings` deep-link.
- [x] **Live-verified in the preview** (mock controller + scripted model): the
      "message Mom on WhatsApp" happy path (open→tap→type→send→done) AND every guard —
      accessibility-disabled, done-without-acting, cycle/no-progress, unparseable
      replies. Typecheck + build clean; the real dispatcher routes correctly.
- [x] **Native AccessibilityService plugin authored** —
      `src-tauri/tauri-plugin-phone/` (Rust crate + Kotlin `JarvisAccessibilityService`
      [node-tree dump, tap/set-text/type/scroll/gesture/back/home] + `PhonePlugin`
      `@TauriPlugin` bridge + manifest service decl + accessibility config). Wired into
      the app (Cargo path dep + `lib.rs` init + `phone:default` capability).
- [x] ✅ **Native Android build DONE (2026-06-25)** — `tauri android init` then
      `tauri android build --debug --apk --target x86_64` compiled the plugin's Rust
      crate for android, auto-wired `:tauri-plugin-phone` into the Gradle project, and
      packaged the Kotlin `JarvisAccessibilityService` into the APK. The app installs +
      boots on the emulator with NO crash, and `dumpsys package` lists
      `com.jarvis.phone.JarvisAccessibilityService` as a `BIND_ACCESSIBILITY_SERVICE`
      component (→ it appears under Settings ▸ Accessibility ▸ JARVIS). No first-build
      tweaks were needed. (One unrelated fix: `@tauri-apps/api` had drifted to 2.11.1 vs
      the 2.10 Rust crate/CLI → pinned to 2.10.1.)
- [ ] ⚠ **On-device FUNCTIONAL test pending (needs a real device)** — enable JARVIS in
      Settings ▸ Accessibility and drive a real app. The headless swiftshader emulator
      ANRs the animated HUD (its SystemUI, not our app — JARVIS stays alive), so it's
      boot-only; real gestures need a real device.
- [x] **Accessibility screenshot fallback wired (2026-06-27)** — `capture_screenshot`
      is registered through Tauri/Rust/Kotlin, the a11y service declares screenshot
      capability, screenshots are downscaled natively for transport, and phone-control vision shots
      now appear in Agent Activity. **MediaProjection** remains NOT needed for the v1
      node-tree operator; full pixel streaming is still a later canvas/game fallback.
- **Exit test:** "open WhatsApp and message X" runs on the phone.

## ✅ Real-device build milestone — **DONE (2026-06-25)**

The first true Android build with the native plugins compiled. This is the gate that
was blocking on-device verification of P1B/P2/P3 at once.

- [x] `tauri android init` (re-ran to pick up the phone plugin; mic perms survived).
- [x] **Both never-before-compiled Rust plugins built for `x86_64-linux-android`:**
      `tauri-plugin-http` (1C info-tools transport) AND `tauri-plugin-phone` (P2 a11y).
- [x] APK produced (`app-universal-debug.apk`, ~266 MB debug); installed on the emulator.
- [x] **Boots clean:** native lib loads, Tauri plugins init (incl. the phone plugin's
      `register_android_plugin` — no class-not-found crash), WebView renders the React
      onboarding in portrait. Proof: `emulator-phase3-boot2.png` + logcat.
- [ ] **What still needs a REAL device + real keys** (the emulator can't): 1B audio
      in/out, a live LLM/Whisper round-trip, P2 native a11y app control (enable + drive),
      and P3's real desktop round-trip. Build an arm64 APK for a physical phone
      (`--target aarch64` or drop `--target` for universal) and sideload.

## Phase 3 — Remote-control the Windows PC — **CLIENT DONE, verified (2026-06-25)**

The phone can now pair to the user's PC and forward whole tasks to its **unchanged**
Python backend over a WebSocket, reusing the exact desktop HUD contract. Built +
verified (typecheck · vite build · a deterministic Node integration test against a
hand-rolled mock backend · a live browser-preview UI test). NOT yet run on a real
device or against a real desktop backend.

- [x] **`RemotePC` WS client** — `jarvis-studio-gui/src/brain/remote/pc.ts`. Keeps a
      live connection (auto-reconnect w/ backoff); `runTask(goal)` sends
      `{"type":"text_input","data":goal}` and resolves a `ToolResult` from the
      backend's terminal event. Mirrors `useWebSocket`'s event handling:
      - desktop/autopilot task → resolves from **`agent_task_end`** `{ok,summary,stopped}`;
      - chat reply → resolves from **`response_end`**/`response` `{text}`;
      - **correlation guard:** only attributes a result once `status:thinking|working`
        is seen since sending, so the connect-time `_do_greeting()` `response` (and
        proactive alerts) can't be mistaken for the task's result;
      - idle watchdog (no events → fail), absolute cap, and a `1008` close → an
        `unauthorized` state (bad token, no reconnect spam). Never throws — failures
        come back as `ok:false` so the brain speaks them honestly.
- [x] **Pairing screen** — `src/components/MobileRemotePC.jsx` (reuses `settings-*`
      styles). Host/IP · port (8765) · token · wss toggle; live status pill; unpair.
      Opened from a mobile-only **🖥** HUD button (lit when online).
- [x] **Plumbed through the brain** — `useBrain.js` persists the pairing in
      `localStorage` (`jarvis.android.pc.v1`), owns the `RemotePC` lifecycle, folds
      its `agent_*` events into the shared **Agent Activity** feed (live PC-task
      steps + screenshots), and passes a `remote` handle into `createBrain`. The
      `pc_task` tool is advertised **only when a PC is paired** (`toolPalette` gate),
      and the system prompt nudges desktop-shaped requests to it.
- [x] **CSP** — `tauri.conf.json` `connect-src` now allows `ws:`/`wss:` (any LAN IP).
- **Exit test (device, pending):** from a real phone, pair to the PC and run e.g.
      "open Excel and make a budget on my PC" → the desktop autopilot runs it and the
      phone speaks the outcome + shows live steps.

> ~~⚠ Reachability gotcha: the desktop backend binds `localhost` only…~~ **Fixed
> 2026-07-03:** the desktop now binds `0.0.0.0` (via `JARVIS_WS_BIND`, set by
> start.py), with the pairing token REQUIRED for any non-loopback client — so a LAN
> phone connects directly to the printed Wi-Fi IP; no netsh portproxy needed. Windows
> Firewall may still prompt once to allow Python on port 8765. Auth: the WebView's
> `tauri.localhost` origin alone is no longer enough from the LAN (forgeable);
> we always send `?token=`, which is what the backend checks.

### Phase 3.1 — interactive approve/deny + clarify over the link — **DONE (2026-06-25)**

A gated desktop action (or a mid-task clarify question) now surfaces on the phone and
the answer rides back over the WS, instead of the task stalling until the idle watchdog
kills it.

- [x] **`RemotePC.respondPermission(id, approved)` / `respondClarify(id, answer)`** send
      `permission_response` / `clarify_response` back to the PC.
- [x] **Idle watchdog pauses while a prompt is up** — on a non-null `permission_request`/
      `clarify_request` the stall watchdog is suspended and a longer *awaiting-user*
      timeout (5 min) takes over, so the PC waiting on the human doesn't look like a
      stall. Answering (or a backend dismiss → null payload) resumes normal watchdogging.
      An abandoned prompt fails gracefully after the awaiting-user timeout.
- [x] **`useBrain` wiring** — folds `permission_request`/`clarify_request` into
      `permissionRequest`/`clarifyRequest` state + `respondPermission`/`respondClarify`;
      the shared `App.jsx` already renders both dialogs (the "AUTHORISATION REQUIRED"
      approve/deny card + `ClarifyPrompt`) unconditionally, so they Just Work on mobile.
      A synthetic `remote_task_settled` event (emitted by `RemotePC` on any task end,
      incl. client-side timeouts) clears a stale dialog the PC never got to dismiss. The
      desktop window-focus effect is now `IS_MOBILE`-guarded (one Activity on a phone).
- **Verified:** typecheck + build clean; the Node WS-mock integration test grew to cover
      approve→completes (proving the watchdog pause: idle 300ms but approved at 600ms →
      still ok), deny→honest ok:false, clarify round-trip, and the awaiting-user timeout —
      9/9. **Live preview:** a pushed `permission_request` rendered the dialog on the phone;
      tapping Approve dismissed it and sent `permission_response{approved:true}` to the mock.

> **Still open (later):** mapping the remote `status` onto the phone HUD beyond the
> activity feed. Battery: the client holds the socket open while paired — fine for v1;
> consider connect-on-demand later.

## ✅ Bug-fix pass — wake word wired, Vertex unblocked, operator + pairing fixes (2026-07-03)

Five user-reported issues root-caused and fixed in source (needs a fresh
`tauri android build` to land on the device):

- [x] **Wake word actually starts now.** The whole native stack (WakeWordManager.kt
      + openWakeWord ONNX + `start_wake_word` command) existed but NOTHING in JS ever
      instantiated `WakeWordListener` — it was dead code. `useBrain.js` now starts it
      whenever a Groq key or Vertex SA JSON exists (default ON; toggle in Settings).
      Also fixed WakeWordManager.kt: a flow-level `catch` COMPLETED the detections
      flow on the first mic hiccup, silently ending detection — it now re-collects.
- [x] **Vertex AI was unreachable on mobile — fixed.** Two bugs: `useBrain.sysInfo`
      never reported `provider_mode:"vertex"`, and Settings coerced `vertex→gemini`
      on open — so saving Settings ALWAYS kicked the phone off the Vertex tier (and
      the SA-JSON box became unreachable). Both fixed; the phone now genuinely runs
      on the GCP $300 credits like the desktop → the free-tier rate limits go away.
- [x] **Model picks were silently discarded** — `resolveConfig.ts` forced ANY chosen
      Gemini model back to `gemini-2.0-flash` on the gemini/vertex tiers. Picking
      e.g. Gemini 2.5 Pro on Vertex now actually takes effect (this alone explains
      most "the operator is dumb / goes in circles" reports).
- [x] **Operator loop fixes** (`operator/phone.ts`): screenshots now sent only on
      step 1 / after a failure / when the screen stops changing (was: EVERY step —
      token + rate-limit burn); a failed action forces a re-observe (the model was
      reasoning over a stale tree); `isActuation` never matched `tap[3] — ok` labels
      so successful tap-only tasks were reported as "didn't do anything" — fixed;
      budgets raised (12→20 steps, 90s→180s).
- [x] **Remote-PC pairing over plain Wi-Fi now works.** The desktop backend bound
      `localhost` only, so a LAN phone could NEVER connect without netsh/ngrok.
      Desktop changes (aura): `websocket_server.py` binds `JARVIS_WS_BIND`
      (start.py sets `0.0.0.0`), non-loopback clients ALWAYS need the token (origin
      trust is now loopback-only), the pairing token persists across restarts in
      `.jarvis_ws_token`, start.py prints the Wi-Fi pairing IP, and an ngrok failure
      no longer crashes startup. Phone pairing screen hints updated to match.

## ✅ Self-app-control + Vertex credential path (2026-07-03, follow-up)

- [x] **JARVIS drives its OWN app.** `control_interface` was advertised to the model
      but `dispatch`'s `ui` case returned "not available", and `useBrain` returned
      `uiCommand:null` — even though App.jsx already had a full `uiCommand` effect.
      Wired the missing bridge: `DispatchDeps.onUiCommand` → `useBrain.emitUiCommand`
      → `uiCommand` state → the existing App.jsx effect. Expanded the tool's action
      enum (open/close Settings · conversation log · Agent Activity · customiser ·
      Remote PC; mute/unmute; conversation mode on/off; listen; stop; new/clear chat;
      expand/collapse all panels), added the missing App.jsx switch cases, and a
      system-prompt line steering "JARVIS's own screens → control_interface, OTHER
      apps → phone_task". This is the correct self-drive path — direct React calls,
      not the a11y operator (which can't see the canvas HUD's few nodes).
- [x] **Vertex $300 credit works on the phone WITHOUT the Google account signed in.**
      Documented that the phone uses a **service-account JSON** (Vertex AI User role),
      not a Gemini API key (which bills a card). The app already accepts the SA JSON
      in onboarding/Settings; the earlier provider-mode bug fix made it actually stick.

## Phase 4 — Polish & ship

- [x] **Reactor animation throttle (2026-06-25)** — `HudCore.jsx` `ReactorRings` caps each
      canvas to ~30fps on mobile (the continuous rAF loop otherwise pegs the main thread —
      the emulator's SystemUI ANRs — and drains battery). Preview-measured: raw rAF 60/s →
      reactor draws ~22/s per canvas (~63% less canvas work), no visual change. Desktop
      uncapped. (In source for the next device build; the existing x86_64 APK predates it.)
- [x] Wake word (openWakeWord, on-device) — wired 2026-07-03; · [ ] foreground
      service so it keeps listening with the screen off · [ ] overlay pill · [ ] icons/splash.
- [ ] Release **keystore** (`keytool`) → `npm run tauri android build` → signed APK.
- **Exit test:** signed APK installs on a clean phone; permissions read correctly.

---

## De-risking spikes (smart to try before committing to a whole phase)

1. [ ] **Hello-world boot** — get this exact HUD running on an emulator (proves the
       toolchain + the Rust phone-guards).
2. [ ] **One native plugin end-to-end** — TTS is smallest; proves the Kotlin↔JS bridge.
3. [ ] **Accessibility spike** — read another app's screen tree + one tap (proves the
       headline feature is feasible before porting the whole autopilot).

If all three work, the rest is mostly volume. If the Tauri-Android plugin chain or
the AccessibilityService fights back, that's the signal to consider a native-Kotlin
shell instead (with the same React HUD in a WebView).
