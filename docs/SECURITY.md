# Security

JARVIS can listen through your microphone, read what's on your screen, tap and type in
other apps, and send tasks to your PC. That makes it powerful and also a real trust
decision. This page explains how the app is built to limit that, where your data goes,
and what is still open. The second half is the full audit history.

## Reporting a vulnerability

Please **don't open a public issue.** Use GitHub's private reporting instead: the
repository's **Security** tab ▸ **Report a vulnerability**. Include the steps to
reproduce and what an attacker gains. This is a one-person project, so replies may take a
few days.

## Security model

### What leaves the phone, and where it goes

JARVIS has no server of its own. Nothing is sent anywhere unless you add a key for that
service, and then only to that service.

| Data | Sent to | When |
|---|---|---|
| Your messages and chat history | The AI provider you chose (Google Gemini / Vertex AI, Groq, and optionally OpenRouter, NVIDIA, Mistral) | Every chat turn |
| **What's on your screen** (text and, for some steps, a screenshot) | The same AI provider | Only while a phone task you started is running |
| Your voice, after "Hey Jarvis" or the mic button | Groq Whisper, or Google Speech-to-Text if you use Vertex | Each voice command. The wake word itself is detected **on the phone** and no audio leaves it while it only listens |
| Remembered facts | Google Vertex AI embeddings, if you use Vertex | When a fact is saved or looked up |
| Search, weather, news, places queries | The public APIs behind those tools | When you ask for them |
| Rough location | ipwho.is / ipapi.co (from your IP), or your phone's GPS | Weather and "near me" answers |
| Text for a QR code | api.qrserver.com | When you ask for a QR code |
| Tasks and screen-sharing for your PC | Your own PC only, directly or through Tailscale | When you use Remote PC |

Free tiers have their own rules: **Mistral's free tier trains on what you send it**, and
OpenRouter's free models are run by third parties. The app says so next to those keys in
Settings. Read your provider's privacy terms, because a phone task can send them your screen.

### What's stored on the phone

- **API keys and the Vertex service-account JSON** are encrypted with AES-GCM under a
  non-exportable Android Keystore key (`SecureSecretStore.kt`). Only the encrypted form is
  saved. Keys go to their provider in HTTP headers, never in URLs.
- **The PC-pairing identity** is a non-exportable EC key in the Android Keystore
  (`DeviceIdentityManager.kt`). It never leaves the secure hardware; only signatures do.
  There is no password or bearer token to steal.
- **Phone-task records** (goals, steps, results) live in an app-private Room database, not
  in WebView storage.
- **Chats, memory and settings** are in the app's private WebView storage. They are not
  encrypted beyond Android's own app sandbox and device encryption.
- **Backups are off** (`allowBackup="false"`), so `adb backup` and cloud backup can't copy
  any of this. Release builds aren't debuggable, so `run-as` can't read it over USB either.

### What stops it from doing damage

- **Phone tasks run in a native loop with a risk policy.** Every action is classified
  R0–R3 in Kotlin (`OperatorCore.kt`) before it happens. Actions with outside effects
  (send, share, post, call, message) run only if you approved them when the task started.
  Critical ones (pay, buy, bank, passwords, one-time codes, delete, uninstall, permission
  changes) are **never** done automatically: the task stops and hands control back to you.
- **You can stop a task any time**, from the floating STOP button over every app or the
  PAUSE/STOP buttons in the task's notification. A stuck action is cut off by a watchdog
  rather than hanging forever.
- **Tapping by position is limited.** When an app hides a control from accessibility,
  JARVIS may tap a spot it sees in the screenshot, but only in a harmless task, only on
  something it names, and never over a known risky button. Anything that sends, pays or
  deletes still goes through the rules above.
- **Links the AI opens are limited to `http`/`https`.** Deep links like `upi:` or
  `intent:` are refused in native code.
- **Controlling your PC needs your fingerprint** (or screen lock) every time you send it
  a task or take control. A borrowed, unlocked phone can't drive your PC.
- **PC pairing is QR-only.** The QR code expires and works once. Every later message is
  signed by the phone's Keystore key and checked with a counter, so a replayed message is
  refused.
- **Honest results.** The app only reports that an action worked when the action's own
  return value says so. That includes the STOP button, which reports failure if the stop
  didn't actually reach the PC.

### Android permissions

| Permission | Why |
|---|---|
| Accessibility service | Reading the screen and tapping/typing for phone tasks. Off until you turn it on in Settings ▸ Accessibility |
| Microphone (`RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`) | Voice commands and the wake word |
| Foreground service (microphone, special use) | Keep "Hey Jarvis" listening, and keep a phone task running, with a visible notification |
| Display over other apps (`SYSTEM_ALERT_WINDOW`) | The floating STOP button |
| Camera | Scanning the PC-pairing QR code |
| Calendar (read/write) | Calendar questions and adding events |
| Set alarm | Alarms and timers |
| Notifications, vibrate | The listening notification and the wake-word cue |
| Run at startup (`RECEIVE_BOOT_COMPLETED`) | Clean up a phone task that was cut off by a reboot or app update |
| Internet | Talking to the AI providers and tools above |

### Known risks and limits

These are open, documented below in detail, and worth knowing before you install:

- **Prompt injection.** A web page, message or email on screen could contain text that
  tries to steer the AI into doing something you didn't ask for. The risk policy and STOP
  button limit this; they don't eliminate it.
- **Anyone nearby can say "Hey Jarvis".** There is no voice matching. Turn the wake word
  off in Settings if that matters where you are.
- **Some apps hide their buttons from accessibility.** JARVIS can then tap by position
  in harmless tasks, and could mis-tap a control it can't read.
- **Risk detection reads button labels in English.** An icon-only or non-English "Send"
  or "Pay" button can be treated as low-risk.
- **The approval for risky phone actions is shown by the app's UI, not by Android.**
  Your PC is protected by a system fingerprint prompt; risky phone actions are not yet.
- **The device log (logcat) records phone-task steps.** Other apps can't read it, but
  anyone with USB debugging access to your phone can.
- **Remote PC traffic is plain `ws://` inside the Tailscale tunnel.** Tailscale's
  WireGuard encryption and the signed device handshake protect it. On your home Wi-Fi
  without Tailscale, the connection is not encrypted.
- **Release builds you compile yourself are signed with your machine's debug key** unless
  you set up `keystore.properties` (see the README).

### Using it safely

- Install only APKs you built yourself or got from this repository's Releases.
- Don't run phone tasks while banking, payment or password apps are open, and watch
  tasks that send messages or buy things.
- Use Tailscale for Remote PC when you're not on a network you trust.
- Turn off the accessibility service when you don't need phone control.

---

# Audit history

The rest of this page is the record of the audits, kept for transparency. Newest first.
The original 2026-07-17 audit also covered the paired Windows backend, which is a
separate project and not in this repository.

## Pre-publish audit (2026-09-25)

A second pass before open-sourcing: the TypeScript brain and HUD, the Kotlin plugin, Rust,
Tauri config, and a secrets/PII sweep of the tree and full git history. The desktop
backend was out of scope this time.

**Secrets.** No API key, private key or token in the tree or history except one: a live
Spotify access + refresh token in `reference/python-backend-spec/.spotify_cache`, committed
in the first commit — **rotated by the owner on 2026-09-25**, so the leaked copy is dead. The repo is published as a
fresh single-commit snapshot, so history never goes public. `reference/` and
`graphify-out/` (dev-machine absolute paths, ~50 MB) are now untracked and gitignored.

**Fixed in this pass**

| | Finding | Fix |
|---|---|---|
| High | The journal's credential filter (`TaskJournalPayloadPolicy.secretAssignment`, `PhonePlugin.kt`) never matched anything: `\\b` inside a Kotlin raw string is a literal backslash | One backslash per escape |
| High | Security settings existed only in the gitignored `src-tauri/gen/android` (`allowBackup="false"`, release `usesCleartextTraffic=false`, signing). A fresh clone + `tauri android init` would build without them | `gen/android` is now tracked (its own `.gitignore` excludes build output, `tauri.settings.gradle` with local paths, and keystores) |
| Medium | `open_url` (the model's `open_website`) passed any URI scheme to `ACTION_VIEW` — injected web text could fire `upi:`, `intent:` or an app's deep link | Native allow-list: `http`/`https` only |
| Low | Gemini API keys travelled in the URL query (`?key=`), which lands in logs and error strings | `x-goog-api-key` header everywhere (chat, native operator, search, image, model list, ranker) |

**Still open — recorded, not fixed**

- **On-phone R2 consent is a JS-asserted flag.** `operator_start`'s `consent` comes from the
  HUD's approval dialog; native re-derives the risk but trusts the flag. PC control uses an
  OS `BiometricPrompt`; the phone does not. A compromised WebView could skip the prompt —
  but it could also call every other `phone:*` command. Upgrade path: a native
  confirmation (notification action or system dialog) for R2.
- **Risk tiers are English keyword regexes** (`OperatorCore.classifyAction`). An
  icon-only or non-English "Send"/"Pay" control is classified R1. Treating every
  unlabeled tap as R2 would suspend most real tasks, so this needs a better signal
  (resource-id, the planner's own intent), not a blanket rule.
- **logcat carries step text** (plan lines, tapped labels). Other apps can't read logcat
  without `READ_LOGS`; it's visible over adb. Trim to action + risk before a release build.
- `AutonomyBootReceiver` is `exported="true"`; its handler is idempotent. `default.json`'s
  `"*"` window grant has no `platforms` filter (Android declares only `main`, so no effect
  there). M1 (indirect prompt injection) and M2 (open mic) stand as before; `pc_task` has
  no up-front consent gate where `phone_task` does.

---

## Current status (2026-09-22)

The audit's central claim — *"the PC pairing token is the single credential for full
control of the PC"* — **no longer describes the app.** The bearer token is gone.

**Closed since the audit** (verified in source; see the notes in each finding for the
original description of the risk):

- **C2 — token in cleartext everywhere → CLOSED.** Authentication is now device-key
  based. The phone holds a non-exportable EC key in the Android Keystore
  (`DeviceIdentityManager.kt`); the host's public identity is pinned from an expiring,
  single-use pairing QR; only the public key, a fingerprint, a monotonic counter and
  signatures ever cross the Tauri bridge. `remote/pc.ts` accepts **no** bearer credential
  in URLs, WebSocket protocols, storage, or compatibility flags. Pairing is QR-scan only.
- **H2 — secrets in plaintext WebView localStorage → CLOSED.** `SecureSecretStore.kt`
  encrypts provider credentials under a non-exportable Keystore key (AES-GCM);
  SharedPreferences holds only ciphertext plus a random IV. Plaintext exists for the
  lifetime of one explicit bridge call and is never written to WebView storage.
  `configSecrets.ts` migrates and then deletes any legacy plaintext it finds on read.
- **Audit-log exposure (adjacent to H1) → CLOSED.** Task goals, receipts, screenshots and
  results moved out of WebView storage into a Room database (`AutonomyTaskStore.kt`); the
  WebView keeps only opaque task ids, so a WebView backup can't become a second
  unredacted audit log.
- **Replayed / unleased remote input → CLOSED on the client side.** `hooks/controlLease.js`
  is a fail-closed lease + sequence tracker, so the UI cannot emit an unleased or replayed
  input envelope. The host still enforces authorization independently.
- **Task-completion spoofing → CLOSED.** Remote task protocol v2: stable id, idempotency
  key, explicit acceptance, event-cursor resubscribe, and completion **only** from a
  correlated terminal task event. Ambient chat or telemetry events can no longer complete
  a task or keep one alive.

**Changed 2026-09-23 — optional pooled free providers.** `openrouterKey`, `mistralKey` and
`nvidiaKey` join the Keystore-backed secrets (same `SecureSecretStore` allowlist and
posture as the Groq/Gemini keys). Enabling one sends chat — and, when it answers an
operator step, **phone screen contents** — to that provider; OpenRouter's free models are
served by third parties, and Mistral's free tier trains on what it's sent. Settings says so
next to the fields. No key, no data sent.

**Changed 2026-09-23 — the phone operator loop is native** (`OperatorCore.kt`). Two
consequences worth knowing:

- The operator's model calls now come from Kotlin, so for the life of one phone task the
  resolved route list — URLs plus auth headers (`x-goog-api-key` for Gemini since the
  2026-09-25 pass, `Authorization` for Groq/Vertex) — crosses the bridge in `operator_start` and sits in native memory. It
  is never journaled or logged (the bench log carries provider/model/status only). This
  is the same process and the same plaintext-for-one-call posture as `configSecrets`, held
  for minutes instead of one call.
- The R0–R3 action policy and the up-front R2 consent are now enforced natively, outside
  the WebView. The single-action bridge commands (`tap`, `tap_xy`, `set_text`, …) still
  exist and still accept calls from JS, though the brain no longer uses them — removing
  them would take arbitrary on-screen actuation away from a compromised WebView entirely.

**Changed 2026-09-25 — `tap_point`, a coordinate tap without approval (owner's decision).**
Some apps hide parts of their UI from accessibility (Spotify's Search page exposes only
its bottom tabs), so the operator could see the search bar in the screenshot but had no
element to tap, and `tap_xy` needs approval that nobody can give mid-task. `tap_point`
takes a spot from the screenshot (thousandths of its width/height) and runs **without
approval only when** the task's goal is low-risk (R0/R1), the model names the target, the
name passes the same R2/R3 word checks as a tap, and no known R2/R3 element lies under the
point — re-checked on a fresh observation right before the tap. The exact
screen-generation check is replaced by a same-app check for it, because animated pages
would otherwise fail every time. **Residual risk, accepted:** in an app that hides its
controls, a mis-tap during a harmless task could land on a control JARVIS can't read.
(`OperatorCore.kt` `classifyPoint`.)

**Changed 2026-09-25 (later) — `tap_xy` and `drag` follow the same rule (owner's decision).** The
owner asked for reliable coordinate tapping; `tap_xy` (pixels inside an element's bounds —
one key of a keypad drawn as a single view, a spot on a seek bar) and `drag` (a slider)
used to end every task, because they needed approval nobody could give mid-task. They now
go through `classifyPoint` exactly like `tap_point` — label required, low-risk goal only,
every point the gesture touches checked for R2/R3 elements on a fresh observation. In an
R2 goal they remain R2 (allowed only on the up-front consent); in an R3 goal, R3. Same
residual risk as `tap_point`. Also new: `enter` (the keyboard's Enter/Search key) is R2
in any goal that mentions messaging, drafts included, since Enter can send.

**Found live the same evening, fixed:** a `tap_xy` given screenshot thousandths as pixels
landed on Settings' "Sign in to your Galaxy" card and opened Samsung's account sign-in
and the system credential picker (nothing was entered; the task ended honestly). Pixel
commands are now refused on steps that carry a screenshot, and `sign in`/`log in` joined
the R3 words, so a coordinate tap onto a sign-in control, or a sign-in goal, needs a
human. Separately, the operator could see and press JARVIS's own floating STOP; its
windows are now excluded from what the operator sees and can touch.

**Changed 2026-09-26 — the accessibility service reads "not important" views too.**
`flagIncludeNotImportantViews` was added so the operator can see bare checkable controls
(Samsung hides its option-picker RadioButtons that way; without them the completion
checker could not tell which option was selected). It widens what the service reads to
views apps marked unimportant — the same screen, no new permission, still only while a
task runs and still sent only to the configured model provider. The keyboard window and
JARVIS's own windows are excluded from snapshots.

**Mitigation integrity — found and fixed 2026-09-22 (in source, not device-tested):**

A codebase-wide correctness pass found that two controls this document leans on as
mitigations were less reliable than described. Neither is an authorization bypass — both
fail closed — but both weakened the human-in-the-loop story behind M1/M2:

- **The remote STOP button could report success without sending anything.** `pc.ts`
  `send()` returns once a message is *queued* for asynchronous signing, not once it is
  written. The STOP path used that return value to tell the user "hard stop sent to your
  PC, sir — halting any running task and disarming control" while a dropped native
  signing callback meant neither `task.cancel` nor `stop_control` ever left the phone, and
  the PC kept running the task. STOP now uses `sendConfirmed()`, which resolves only once
  the signed envelope reaches the socket, and reports failure honestly.
- **A wedged phone task could not be stopped at all.** A `dispatchGesture` whose Android
  callback never fired left the `Invoke` unresolved forever; `shouldAbort` is polled
  between operator steps, not during an awaited invoke, so the STOP overlay could not
  interrupt it and only an app restart cleared it. Now bounded by a watchdog in
  `JarvisAccessibilityService.kt` and a timeout in `phoneInvoke`.
- **Approval prompts were held in a single slot.** With several tasks subscribed, a second
  task's signed challenge displaced the first before the authorization check, so answering
  the dialog on screen was rejected and that task sat until it timed out. Approvals are now
  keyed by task id. This fails closed — no action was ever approved by the wrong dialog —
  but a consent gate the user cannot successfully answer is not much of a gate.

The lesson worth keeping: a safety control that *reports* success is only as trustworthy
as the value it reports on. See ARCHITECTURE §3's "never claim a tool succeeded" rule.

**Still open, by deliberate choice:**

- **H3** — the desktop backend still binds all interfaces. Binding loopback would break
  the LAN pairing that works today; it needs reworking into an explicit opt-in.
- **M1 / M2** — no confirmation gate on destructive actions reached via prompt injection
  or a voice command from a nearby person. This is a UX decision, not an oversight; the
  fingerprint gate on PC control and the always-available STOP overlay are the partial
  mitigations in place.
- **M3 / L1 / L2** — QR generation still calls a third-party service; the CSP's `ws:`
  breadth is *required* by arbitrary-host pairing; the SAF grant scope is a UX choice.

**Never verified live:** the biometric prompt itself (`requireBiometric()`) has still not
been exercised on a real device with a real finger. See [STATUS.md](STATUS.md).

---

## Fix status (2026-07-17, historical)

Live check (device now authorized): the **installed** app is a *release* build —
`run-as` is refused (`package not debuggable`), so the C-level extraction only applies
to the debug APK if it's ever installed/distributed. But `ALLOW_BACKUP` was live-confirmed
**on**, so `adb backup` extraction was real — now fixed.

**Fixed this session (verified):**
- **C1** — remote clients can no longer approve permission prompts (loopback-only). Backend.
- **C3 (found during reverify)** — C1 only guarded ONE handler (`permission_response`), but
  ~30 other WS handlers were reachable by any remote token-holder, bypassing the permission
  system entirely: `set_config` (rewrite `allowed_dirs` → widen the file sandbox, swap the LLM
  provider, overwrite API keys), `run_action`, conversation wipes, `set_location`, setup
  re-runs. Fixed with a **default-deny allowlist at the WS dispatch point**
  (`websocket_server.py` (desktop backend) +
  `set_remote_allowed` in `main.py` (desktop backend)): a remote client
  may invoke ONLY the 10 message types the phone actually sends (`text_input`,
  `clarify_response`, `permission_response`, the `webrtc_*`/`stop_screen` screen channel, and
  `arm_control`/`disarm_control`/`stop_control`/`remote_input`). Everything else is local-GUI-
  only, and any handler added in future is remote-denied by default. The local GUI is loopback,
  so it's unaffected. Verified: 10 allowed types pass, 20 local-only handlers denied from
  remote, loopback never blocked.
- **arm_control alert** — arming direct mouse/keyboard control is the one remote-reachable path
  that never hits `request_permission`; a remote arm now also fires the notify email (below).
- **C2 (partial)** — token file moved off the OneDrive-synced path, with migration. Backend.
- **M4** — per-IP WS connection rate limit added (loopback exempt). Backend.
- **H1 (partial)** — `allowBackup="false"` in the app manifest; `adb backup` extraction closed.
- **New: fingerprint gate on PC control (Part A)** — the phone now requires the device
  fingerprint before it will *send a task to the PC* or *arm direct control*. This adds the
  missing "something you are" factor: a borrowed/unlocked phone can no longer drive the PC.
  Uses the official `@tauri-apps/plugin-biometric` (Android BiometricPrompt), registered under
  `#[cfg(mobile)]` in [lib.rs](../jarvis-studio-gui/src-tauri/src/lib.rs); the gate lives in
  `requireBiometric()` in [useBrain.js](../jarvis-studio-gui/src/hooks/useBrain.js), funnelling
  both task-forward paths and `armControl` through it. Graceful: if no fingerprint/lock is
  enrolled (or on the web/desktop build) it does NOT lock the user out; falls back to the
  phone PIN/pattern when available; a cancelled prompt denies the action. Everyday actions
  (weather, timers, chat) are untouched. Does NOT authenticate the network link to the PC (the
  PC still only sees the token) — it's a second, local gate. Verified: typecheck/lint clean,
  web build + boot OK. **The fingerprint prompt itself needs an on-device APK build to test.**
- **New: remote-approval email alert** (`notify.py` (desktop backend)) —
  when a *remote-triggered* gated action needs approval, the PC owner gets an out-of-band
  email so a legitimate request doesn't silently time out while they're away from the
  keyboard. **Notification only — it can never approve or gate anything itself**; approval
  still requires C1's on-PC gate. Deliberately not fired for local requests (the on-screen
  dialog already covers those — no email needed for "basic things"). Opt-in and silent unless
  `JARVIS_ALERT_EMAIL_TO` + `JARVIS_SMTP_HOST/USER/PASS` are set; stdlib `smtplib`, no new
  dependency. 30s global cooldown so a held token can't inbox-bomb the owner by firing gated
  requests back-to-back on one connection (M4's rate limit only throttles new connections).
  Considered and rejected: using email/a click-through link *as* the approval mechanism —
  that reopens exactly what C1 closed (remote approval), just gated by inbox security instead
  of the WS token, and adds another credential (SMTP creds) to protect.

**Deliberately deferred — need a dedicated live re-test or a bigger change (don't blind-ship):**
- **C2 (transport)** — token→header + `wss://`. Touches the fragile LAN/Tailscale/reconnect/
  LAN-upgrade flow you've hand-verified over many sessions; must be re-tested end-to-end on a
  real device, not changed blind.
- **H2** — secrets → Android Keystore. Bigger change (native command + migration + live test);
  interim risk is much lower now (release build resists `run-as`, backup is off).
- **H3** — default-bind localhost. Would break the working LAN pairing unless reworked into an
  explicit opt-in.
- **M1 / M2** — confirmation gates for injected/voice-triggered destructive actions. Design
  decision that changes the operator/voice UX you rely on.
- **M3 / L1 / L2** — local QR needs a new dep; CSP `ws:` breadth is *required* by arbitrary-host
  pairing (can't tighten without breaking it); SAF grant-scope is a UX choice.

Backend changes require restarting the desktop app to take effect; the manifest change takes
effect on the next Android build.

---

## Original audit (2026-07-17)

Scope: the phone app and Tauri plugin, **and** the paired Windows backend (the phone
forwards whole tasks to it, so its trust boundary was part of the phone's attack
surface). Method: source review of the auth/crypto/IPC paths, the native command surface,
the WebSocket pairing protocol, and credentials at rest.

At the time, the PC pairing token was the single credential for full control of the PC,
so almost every Critical/High finding was either "the token is easier to obtain than it
should be" or "having the token gives more than it should." That token has since been
replaced by Keystore device keys; see **Current status** above for which findings still
stand. The findings below are preserved as written. Severity = impact × ease.

## CRITICAL

### C1 — A remote client can approve its own "dangerous action" prompts
**Where:** `main.py:228` (desktop backend) `handle_permission_response`,
`main.py:207` (desktop backend) `request_permission`,
`websocket_server.py:160` (desktop backend) `emit`.

The one human-in-the-loop gate for destructive autopilot actions is `request_permission()`,
which `emit()`s a `permission_request` and waits for a `permission_response`. But:
- `emit()` **broadcasts to every connected client** (`_clients`), including the paired
  phone / any token-holding remote client — so the attacker *receives* the prompt.
- `handle_permission_response()` resolves the future from **any** client's message. It never
  checks `is_current_sender_remote()`. The `remote` flag is captured
  (`main.py:1096` (desktop backend)) and used **only as a UI label**
  (`main.py:1110` (desktop backend)), never to require that approval come
  from the local GUI.

**Exploit:** With the token, connect over the WS, send `{"type":"text_input","data":"<any
destructive goal>"}`. When the backend asks for permission, reply
`{"type":"permission_response","data":{"id":<id from the broadcast>,"approved":true}}`. Same
for `clarify_response`. You've now cleared the only gate that was supposed to need a human at
the keyboard. The PC can be fully unattended.

**Fix:** In `handle_permission_response`/`handle_clarify_response`, reject the response unless
it came from a **loopback** connection (reuse `_is_loopback`, threaded through like
`is_current_sender_remote`). Dangerous actions must be approved *on the PC*, never by the
requester. Also send permission prompts with `send_to(local_client, …)` instead of
broadcasting, so a remote client never sees the id.

### C2 — Token travels/rests in cleartext across every pairing path
**Where:** token in the WS URL query over `ws://` — [pc.ts:188](../jarvis-studio-gui/src/brain/remote/pc.ts),
`websocket_server.py:143` (desktop backend);
token file `start.py:135` (desktop backend) `_TOKEN_FILE = ROOT/.jarvis_ws_token`;
token printed + QR'd `start.py:382` (desktop backend), `start.py:295` (desktop backend).

The token is a strong 256-bit secret (`secrets.token_urlsafe(32)` — good), but it is exposed
in cleartext through multiple channels, any one of which hands an attacker full PC control:

1. **On the wire (LAN):** default transport is `ws://…:8765/?token=…`. The token is in the
   URL query, unencrypted. Anyone who can sniff the LAN (open/rogue Wi-Fi, ARP spoof) or sits
   on-path captures it. Query strings also land in proxy/access logs.
2. **In the cloud:** `.jarvis_ws_token` is written to the repo root — which is inside
   `C:\Users\...\OneDrive\...` on this machine. **The PC-control token is being synced to
   OneDrive** (and any device signed into that account). Same risk for any backup/sync of the
   folder.
3. **On screen / in terminal:** printed as `Pairing code: <token>` and rendered as an on-screen
   QR containing `{host,port,token}`. A shoulder-surf, a screenshot, a screen-share, or a photo
   of the QR is the token.
4. **On the phone:** stored plaintext in `localStorage` (`jarvis.android.pc.v1`) — see H1/H2.
5. **Never rotates:** `.jarvis_ws_token` is deliberately stable across launches, so a token
   leaked once stays valid forever until the user manually deletes the file.

**Fix (in priority order):**
- Move the token out of the URL query into the `Authorization`/`Sec-WebSocket-Protocol` header
  (not logged, not in referrers), and require **`wss://`** for any non-loopback client
  (self-signed cert pinned during pairing is fine on a LAN).
- Store `.jarvis_ws_token` outside any synced folder (e.g. `%LOCALAPPDATA%`, which OneDrive
  doesn't sync) and `chmod`/ACL it to the user.
- Make the QR/token **short-lived** (a pairing handshake that exchanges the long-lived secret
  out of band, or a 60-second rotating pairing code). At minimum add a "rotate token" button.

---

## HIGH

### H1 — Shipped APK is debuggable + cleartext; all secrets extractable over USB
**Where:** debug manifest
the merged debug manifest (build output, `…/merged_manifests/universalDebug/…/AndroidManifest.xml:92`)
— `android:debuggable="true"`, `android:usesCleartextTraffic="true"`. The repo ships
`JARVIS-arm64-debug.apk` (root) — a debug build. `allowBackup` is not set anywhere → defaults
to **true**.

**Exploit:** On a debuggable build, `adb shell run-as com.jarvis.app` gives full read of the
app-private data dir — including the WebView's `localStorage` LevelDB. That yields **every
secret at once** (see H2). `allowBackup=true` allows `adb backup` extraction on a non-rooted
device. This is live-relevant: the user's phone is on USB with debugging enabled right now
(only blocked today because the device is still `unauthorized` — one tap from working).

**Fix:** Distribute a **release** build only (`debuggable` absent, `usesCleartextTraffic=false`
— the release manifest already does this). Set `android:allowBackup="false"` and
`android:fullBackupContent`/`dataExtractionRules` to exclude app data. Never hand users a
`-debug.apk`; delete `JARVIS-arm64-debug.apk` from the repo.

### H2 — All credentials stored in plaintext WebView localStorage (no Keystore)
**Where:** [useBrain.js:32-59](../jarvis-studio-gui/src/hooks/useBrain.js) (`CONFIG_KEY`,
`PC_KEY`), backed by `makeKV()` → `localStorage`
([store.ts:52-67](../jarvis-studio-gui/src/brain/memory/store.ts)). Fields:
[resolveConfig.ts:23-29](../jarvis-studio-gui/src/brain/resolveConfig.ts) / config.ts.

`jarvis.android.config.v1` holds `groqKey`, `geminiKey`, and **`vertexSaJson` — a full GCP
service-account private key**. `jarvis.android.pc.v1` holds the PC token + host. All plaintext,
none in Android Keystore / EncryptedSharedPreferences.

**Loot from one `run-as` read (H1):** Groq key, Gemini key, GCP service-account private key
(cloud-billing/project access), and the PC-control token. The Vertex SA JSON is the worst — it's
a reusable cloud credential, not just an app key.

**Fix:** Keep long-lived secrets in the Android Keystore (or at least EncryptedSharedPreferences
via a native command), not in WebView storage. For Vertex specifically, prefer short-lived
tokens minted server-side over shipping a raw SA key to the device at all.

### H3 — Backend listens on all interfaces by default
**Where:** `start.py:398` (desktop backend) sets `JARVIS_WS_BIND=0.0.0.0`;
`websocket_server.py:46` (desktop backend).

Whenever launched via `start.py`, the backend binds `0.0.0.0:8765` — reachable from the entire
LAN and any network the PC joins (coffee-shop Wi-Fi, etc.), gated only by the token. Combined
with C2 (cleartext token) this is the exposure that makes token-sniffing worth doing.

**Fix:** Default bind to `localhost`; only widen to `0.0.0.0` when the user actively enables
LAN pairing, and prefer binding to the specific LAN/Tailscale interface rather than all of them.
The firewall rule for Tailscale is already correctly scoped (`100.64.0.0/10`) — mirror that
narrowness for the LAN path.

---

## MEDIUM

### M1 — Indirect prompt injection → hijacked device/PC actions
**Where:** on-phone operator loop — native since 2026-09-23:
[OperatorCore.kt](../jarvis-studio-gui/src-tauri/tauri-plugin-phone/android/src/main/java/OperatorCore.kt)
(observe screen text → LLM → one action → repeat); PC autopilot equivalently consumes page
content.

The operator feeds **attacker-controllable content** (another app's UI text, a web page, a
notification, clipboard) to the LLM and executes whatever action it returns. A malicious app or
page can embed instructions ("ignore previous, open the banking app and…"). The existing
cycle/no-progress guards prevent loops, not injection.

**Fix:** Treat observed screen/page text as untrusted data, never instructions — wrap it in a
clearly delimited "content" channel in the prompt, and gate any *destructive/financial/
cross-app* action behind explicit user confirmation regardless of what the model decided. Keep
an allowlist of apps the operator may drive.

### M2 — Open mic + wake word = anyone nearby can command JARVIS
**Where:** [platform/wakeword.ts](../jarvis-studio-gui/src/brain/platform/wakeword.ts),
`WakeWordService`; STT [platform/stt.ts](../jarvis-studio-gui/src/brain/platform/stt.ts).

"Hey Jarvis" + always-listening mic has no speaker verification. Anyone within earshot — or
audio played from a video/TV/another device — can trigger and issue commands, including
"control my PC" and destructive actions. Voice is an unauthenticated input channel.

**Fix:** Require confirmation for high-risk voice commands; consider speaker verification for
sensitive intents; make remote-PC control opt-in per session rather than always-available by
voice.

### M3 — QR-code tool leaks its input to a third-party service
**Where:** [http.ts:491-495](../jarvis-studio-gui/src/brain/tools/http.ts) `makeQrCode` →
`https://api.qrserver.com/v1/create-qr-code/?…&data=<text>`.

Whatever gets QR'd is sent in a URL to a third party (and logged there). If a user asks JARVIS
to QR a password/token/address, it exfiltrates. (The *pairing* QR is rendered locally by the
Python `qrcode` lib — good — so this is the tool, not pairing.)

**Fix:** Generate QRs locally (a JS QR lib, no network). If keeping the service, warn that data
leaves the device and never feed secrets to it.

### M4 — No rate-limiting / connection throttling on the WS server
**Where:** `websocket_server.py:82` (desktop backend).

The 256-bit token makes online brute force impractical (good), so this is **DoS**, not
auth-bypass: an attacker who can reach `:8765` (H3) can flood connections/handshakes. `max_queue`
and `max_size` bound per-connection abuse but not connection count.

**Fix:** Per-IP connection/attempt rate limit; drop repeated 1008-rejected peers with backoff.

---

## LOW / HARDENING

### L1 — CSP is broad on the exfil axis
**Where:** [tauri.conf.json:69](../jarvis-studio-gui/src-tauri/tauri.conf.json).
`connect-src` allows `ws:` / `wss:` / `stun:` / `turn:` to **any host**, and `script-src` has
`'unsafe-eval'`. No `dangerouslySetInnerHTML`/`innerHTML` was found (React auto-escapes), so
there's no live XSS chain today — but if any script-exec foothold ever lands (a bad dependency,
`unsafe-eval` abuse), localStorage secrets can be shipped anywhere over an open WS. **Defense in
depth:** pin `connect-src` to the specific hosts actually used and drop `'unsafe-eval'` if the
bundler allows.

### L2 — Over-broad SAF grant amplifies M1
**Where:** [PhonePlugin.kt `resolveDoc`/`readFile`/`listDirectory`](../jarvis-studio-gui/src-tauri/tauri-plugin-phone/android/src/main/java/PhonePlugin.kt:941).
File access is correctly **scoped to the user-granted tree** (SAF, `takePersistableUriPermission`);
`resolveDoc` walks children by name so `..` can't escape — **no path traversal** (good). But if a
user grants the storage *root*, the (injectable, M1) brain can read everything under it. Prefer
narrow folder grants and surface which folder is shared.

---

## What's already done right (don't regress these)
- Token is 256-bit (`secrets.token_urlsafe(32)`); comparison is constant-time
  (`hmac.compare_digest`) — `websocket_server.py:144` (desktop backend).
- a11y service, `ReminderReceiver`, `WakeWordService` are all `exported="false"` with
  `BIND_ACCESSIBILITY_SERVICE` — other apps can't bind/trigger them
  ([plugin AndroidManifest.xml](../jarvis-studio-gui/src-tauri/tauri-plugin-phone/android/src/main/AndroidManifest.xml)).
- Origin allowlist blocks browser-based cross-site WS hijack and DNS-rebinding
  (`websocket_server.py:127` (desktop backend)).
- SAF-scoped file access, no traversal (L2).
- Device requires per-host RSA authorization before adb works → blocks drive-by "juice-jacking".
- Release build is not debuggable. It does allow cleartext (`usesCleartextTraffic=true`),
  deliberately: PC pairing is `ws://` inside the Tailscale WireGuard tunnel with a device-key
  handshake, and Chromium blocks that `ws://` otherwise. Every built-in model/API endpoint is HTTPS.
- Tailscale firewall rule is tightly scoped to the CGNAT range, not a blanket open.

---

## Fix order (biggest risk-reduction first)
1. **C1** — require *local* approval for permission/clarify responses. (Small diff, closes the
   worst escalation.)
2. **H1 + H2** — ship release-only, `allowBackup=false`, move secrets to Keystore; delete the
   debug APK from the repo.
3. **C2** — token off the URL/query → header, `wss://`, out of the OneDrive-synced path, add
   rotation.
4. **H3** — default-bind localhost; widen only on explicit opt-in.
5. **M1/M2** — confirmation gate for destructive operator/voice actions.
6. **M3/M4/L1/L2** — local QR, rate-limit, tighten CSP, narrow SAF grants.
