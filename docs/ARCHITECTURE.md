# Architecture

How the Android app is put together, and the rules that keep it from turning into a mess.
For *what works right now* see [STATUS.md](STATUS.md); for the threat model see
[SECURITY.md](SECURITY.md).

---

## The 30-second version

```
  React HUD (src/)                        ← what you see
        │  useAssistant → useBrain
  TypeScript brain (src/brain/)           ← the thinking: routing, tools, memory, operator
        │  invoke("plugin:phone|…")
  Rust shell (src-tauri/)                 ← the app process, desktop bits compiled out
        │  run_mobile_plugin("…")
  Kotlin plugin (tauri-plugin-phone/)     ← the phone: accessibility, wake word, Keystore,
                                             task journal, TTS, calendar, files
```

Four layers, one path between each. Every rule below exists because adding a *second*
path is the thing that breaks this app.

---

## 1. The brain lives in TypeScript, not Python

On Windows the brain is a Python process the app talks to over a WebSocket. On Android
that whole brain is ported to `jarvis-studio-gui/src/brain/` and called **directly from
React**.

The seam is `src/hooks/useAssistant.js`: it picks `useBrain` (in-app brain) on a phone or
`useWebSocket` (Python backend) on desktop, **once at module load**, and returns one
stable hook. `useBrain.js` deliberately mirrors `useWebSocket`'s shape, so `App.jsx` and
the HUD never learn which transport is behind them.

The desktop app is a separate project, not in this repository. Python file names below
(`main.py`, `llm/*_bridge.py`, `autopilot.py`, …) name what each part was ported from.
Maintainers may keep a gitignored `reference/python-backend-spec/` copy of it as a
blueprint; it is never edited, imported or shipped.

### What's in the brain

| Area | Files | Notes |
|---|---|---|
| Turn loop | `index.ts`, `loop.ts`, `ask.ts` | The observe→act orchestration ported from `main.py` |
| Config | `config.ts`, `resolveConfig.ts`, `configSecrets.ts` | What provider/model we'd *like* to use; secrets live in the Keystore (see §5) |
| Route ladder | `routes.ts`, `quota.ts`, `modelPolicy.ts`, `modelCatalog.ts`, `modelRanker.ts` | What we actually try, in what order (see §2) |
| Providers | `providers/{gemini,openaiCompat,catalog,vertexAuth,models}.ts` | Gemini/Vertex in `gemini.ts`; Groq, OpenRouter, NVIDIA and Mistral share `openaiCompat.ts`. Ported from `llm/*_bridge.py` |
| Tools | `tools/registry.ts`, `tools/dispatch.ts`, `tools/http.ts` | One advertisement point, one execution point (see §3) |
| Phone operator | `operator/controller.ts` → **Kotlin** `OperatorCore.kt` / `NativeOperator.kt` | Drives other apps — the loop is native (see §4) |
| Memory | `memory/store.ts`, `memory/vectorStore.ts`, `memory/proceduralLearning.ts` (+ `playbooks.ts`) | Three separate stores — check which one a feature reads (see §7) |
| Remote PC | `remote/pc.ts`, `remote/webrtcScreen.ts` | Pair to the Windows app (see §6) |
| Native bridge | `platform/*.ts` | The JS side of the Kotlin plugin (see §5) |
| Scheduling | `schedule/{store,reminderTime}.ts` | Reminders, alarms, timers |

---

## 2. One answer can take several routes

`resolveConfig.ts` decides the *preferred* provider and model. `routes.ts` decides what
to try when that isn't available, and `quota.ts` remembers across turns which routes are
already spent.

Why it exists: free tiers run out. The old shape was one provider plus a single fallback,
so a Groq 429 had exactly one place to go and then told the user to come back later. A
user with two Groq keys and a Gemini key now has six routes.

`quota.ts` reads Groq's `x-ratelimit-*` headers to know a route is spent *before* wasting
a call on it, benches failed routes on an escalating ladder (2m → 10m → 1h → a day), and
persists that state — a 24-hour bench the app forgets on relaunch is not a bench. A
failure with no quota signal (timeout, 5xx) never touches that ladder: it gets its own
short one, 20s → 2m → 10m for repeats within 30 minutes, reset by any success, so a slow
route can't be quarantined for a day but also can't cost every turn its full timeout. It
mirrors the desktop's `llm/quota.py`; keep the two in sync when either changes (the
transient ladder, like the per-minute windows, exists only on the phone so far).

`modelPolicy.ts` classifies a *request* as dumb / smart / very-smart (and a model id as
image or not), which is what Auto mode uses to send greetings to a cheap model and real
work to a good one.

### Smart routing — `modelCatalog.ts` + `modelRanker.ts`

Ported from the desktop (`llm/model_catalog.py`, `llm/model_ranker.py`, 2026-09-24);
**keep the `KNOWN` tables identical**. Every model discovery (`providers/models.ts` for
Vertex/Gemini/Groq, `providers/catalog.ts` for the pooled providers) feeds
`recordDiscovered()`, which ranks every reachable (provider, model) by its Artificial
Analysis Intelligence Index from the catalog table. Only models the table doesn't know
are sent to a Google-Search-grounded Gemini call (`estimateUnknown()`) — **only when the
user presses Re-rank**, never automatically, because it spends the Gemini quota chat and
phone tasks share. Results are cached by normalized name; there is **no ungrounded fallback** (the desktop measured it producing
garbage) — without a Gemini key an unknown model just gets a low guessed score. Tiers
(fast / mid / flagship) come from rules, never the LLM.

`routesFor()` maps the request class to a tier (dumb→fast, smart→mid, very-smart→flagship)
and puts the ranked ladder first: that tier best-first, then stronger tiers, then weaker.
Two filters apply: pooled free providers (OpenRouter/NVIDIA/Mistral) never enter the
ranked part — they stay tail fallbacks — and nothing scoring below 3 is routed to.
Under Auto the head is the first ranked model with an un-benched route. The old hardcoded
Gemini/Groq picks stay as the tail, so nothing regresses before the first ranking or when
a provider's listing never came back. A provider with no key is filtered out at routing
time; removing a key re-runs discovery, which clears its models (`[]`), while a failed
listing keeps them (`null`).

**The user's provider + model choice scopes the ladder** (`BrainConfig.providerScope`,
set in Settings ▸ Models; 2026-09-25). `providerScope` is `"auto"` or one keyed
provider (pooled ones included — picking one is the user's call, and Settings warns).
It is separate from `tier`, which stays the Google endpoint `GeminiProvider` talks to
and the client for calls the ladder doesn't pick. Three cases:
Auto/Auto → the whole ranking, and the fallback switch has nothing to pin;
provider X + Auto → the best of X's ranked models for the turn, then (fallback on) the rest;
a specific model → that model, then X's others, then the rest. With fallback off the
ladder never leaves the chosen model / provider (keys still rotate). The Settings picker
lists exactly `sysInfo.reachable_models` — the ranking's per-provider discovered models
minus pooled ones that 404'd — grouped by provider; the old dumb/smart/very-smart
grouping of the picker is gone (the *request* classifier above still drives tiers).

**Tool support is only ever turned off by evidence:** a 400 during a tool turn that says
tool/function calling is *not supported / not enabled* (`ask.ts` `rejectsTools`) calls
`markNoTools()`, which survives re-ranking; tool turns then route past that model. The
wording check matters: until 2026-09-25 any 400 that merely mentioned tools (a bad
schema, a conversation-shape error) qualified, and it permanently benched Gemini
3.6/3.5-flash — the two best tool models — from every action turn. The ranking store
moved to `jarvis.ranking.v2` to drop those marks. The native operator sends no tools, so
it asks `usableRoutes(cfg, "dumb", false)`.

### Every pinned model id is a time bomb — `modelRemap.ts`

Google retires Gemini ids on a schedule. This has now taken the app down **three** times:
a dead Vertex default in 2026-07, then on **2026-09-22** both `gemini-2.0-flash` and
`gemini-2.0-flash-lite` started returning 404 *"no longer available"*. The failure is
nasty because it does not look like itself:

```
both Gemini ids 404  →  isFatalForRoute benches them for a DAY
                     →  100% of traffic lands on Groq
                     →  Groq blows its tokens-per-minute ceiling in ~60s
                     →  the user sees "rate limits ran out" on a phone task
```

Three layers from the cause. Re-pinning a fresh constant only resets the timer, so:

- **`errorClass.retiredModelReplacement()`** reads the replacement out of Google's own
  404 (*"Please update your code to use models/gemini-3.6-flash"*).
- **`ask.benchRoute()`** records it via **`modelRemap.recordRemap()`**.
- **`routes.ts`'s `push()`** substitutes it — one chokepoint, so the constants, the
  user's configured model and the Auto picks are all covered, and ids that now resolve
  to the same live model collapse into one route.

A future retirement therefore costs **one failed request, once**, instead of a day.
This does not excuse stale constants — the remap only engages *after* a request has
already failed — so when you notice an id has moved on, update it.

### Per-minute limits are paced, not benched

Free tiers bind on **per-minute** ceilings (Groq tokens-per-minute; Gemini requests-per-
minute) that reset in seconds. `errorClass.limitWindow()` reads which window a 429 names;
`quota.bench({window})` benches a minute-window 429 for exactly the provider's wait
(2–65s) without touching the escalating ladder, which is kept for **day** windows. When
every route is only briefly out, chat waits once (≤15s) and the native operator waits
(≤65s, STOP-aware) — see `RoutePacer.kt`, which also skips a Groq route whose
`x-ratelimit-remaining-tokens` can't fit the next step. Before 2026-09-23 a TPM 429 went
on the day ladder and one burst of operator steps benched every route. OpenRouter's
"temporarily rate-limited upstream" (its shared `:free` pool, not the user's quota) is
treated as a minute window too, in both `errorClass.ts` and `RoutePacer.kt`.

### Gemini request details that cost a day each

- **Turning thinking off is generation-specific** (measured on the device, 2026-09-25):
  2.5 takes `thinkingBudget: 0` and 400s on `thinkingLevel`; 3.x 400s on budget 0 and
  takes `thinkingLevel: "minimal"`. `providers/gemini.ts` `genConfig` and
  `NativeOperator.kt` `thinkingOff` must agree. Getting it wrong killed every phone task
  on its first request once the ranking put `gemini-3.5-flash-lite` first.
- **A native 400 skips that route for the task** instead of ending it: native bodies are
  built per model, so one model rejecting one says nothing about the next. (Chat still
  treats a 400 as the caller's problem — it sends the same body to every route.)
- **Keys go in the `x-goog-api-key` header**, never `?key=` — URLs end up in logs and
  error strings. `ya29.` OAuth tokens still use `Authorization: Bearer`.

### Pooled free providers

OpenRouter, NVIDIA NIM and Mistral are OpenAI-compatible presets of one provider class
(`providers/openaiCompat.ts`, which also hosts Groq). They only add **fallback** routes
after Gemini/Groq, and only for models discovered from their live `/models` listings
(`providers/catalog.ts`: OpenRouter `:free` + tool-capable, sized 20–150B) — never
pinned ids, because OpenRouter's free catalog turns over within weeks. A listing is not
a promise the key can call a model — both NVIDIA picks once 404'd "Function not found
for account" — so the catalog keeps up to 8 ranked candidates and routes through the
best two; a pooled route's 404 (`ask.benchRoute`, chat and native alike) marks that
model dead for 7 days and the next candidate takes its place. Groq limits are
per *organization*, so more Groq keys from one account add nothing; more Gemini keys
only help from different Cloud projects.

**An empty 200 is a failure, not an answer.** OpenRouter reports upstream failures as
HTTP 200 with an in-body `error` and no content. Both ladders (`OpenAICompatProvider.chat`
and the native `HttpLadderModel`) turn a reply with no text and no tool calls into a
retryable 502, so the route is benched briefly and the next one is tried.

> Keeping them current is easy: `providers/models.ts` `discoverModels()` already asks
> each provider what the user's key can actually serve, and Settings shows that list.

---

## 3. Tools: one advertisement point, one execution point

- `tools/registry.ts` decides **which tools the model is told about**. It is
  *tier-aware* — `capabilitiesFor()` returns a different palette per active provider, so
  a weak key doesn't get offered tools it can't drive.
- `tools/dispatch.ts` is **the only place a tool actually runs**. A tool call lowers to
  one action-spec and then hits this one dispatcher.

**Never add a second execution path.** This mirrors `live_tools.to_spec` feeding
`actions.run_action` in the Python brain, and it's the reason a tool's behaviour is the
same however the model asked for it.

> Note: the Python brain also accepted text `[ACTION]` tags as a second entry point.
> **This fork has no `[ACTION]` parser** — native function calling is the only path in.
> Some comments still mention it; they are stale, not a description of live code.

### The advertised palette and the implementation must agree

`registry.ts` advertises an `enum` of argument values; the code behind the tool branches
on its own names. Nothing checks that those two lists overlap, and when they drift the
tool doesn't error — it silently answers "I didn't understand that" to every call, or
does something unrelated. Two real cases, both found only by reading:

- `customize_screen` advertised ten actions (`set_theme`, `show_panel`, …) while
  `applyScreenAction` branched on seven different names (`accent`, `show`, …). **Zero**
  overlap: the whole HUD-customisation tool was dead.
- `system_control` advertised `play_pause`/`next`/`previous` with no media-key handling
  anywhere in Kotlin or Rust, so those calls fell through to opening the Settings app and
  reported success.

So: **when you add a value to an advertised enum, add the branch that handles it in the
same change, and don't advertise a capability the device doesn't have.** A colocated test
that walks the palette and asserts every advertised action is accepted is the cheap guard
— `brain/mobile/screenConfig.test.ts` does exactly that.

Roughly what's dispatched today: `weather`, `news`, `search_web`, `places`, `directions`,
`set_location`, `reminder`, `schedule`, `agenda`, `clock`, `time`, `day`, `remember`,
`forget`, `playbook`, `routine`, `qr_code`, `generate_image`, `record`, `clipboard`,
`read_file`, `list_dir`, `open_file`, `open_url`, `open_app`, `close_app`, `set_volume`,
`system`, `power`, `screen`, `ui`, `screenshot`, `open_a11y_settings`, plus the two big
ones: `phone_task` (§4) and `pc_task` (§6).

> **The rule carried over from the Python brain: never claim a tool succeeded unless its
> actual return value says so.** This shows up throughout dispatch, the operator loop and
> remote task resolution, and it is not optional politeness — it's why the assistant is
> trustworthy.

---

## 4. The on-phone operator

The "do a whole task in an app" loop, ported from the desktop's `autopilot.py`:

```
observe the screen's node tree → ask a model for ONE JSON command →
execute it through the AccessibilityService → repeat
  … until {"do":"done"} / {"do":"fail"} / the step-or-time budget runs out
```

### It runs in Kotlin, not the WebView — and must stay there

A phone task drives *another* app, so JARVIS is backgrounded for the whole task. Measured
on-device 2026-09-23 over CDP: **~60 s after JARVIS leaves the foreground, Chromium pauses
the hidden WebView's entire task queue** — a 1 s `setInterval` ticked 0 times for 90 s and
a pending `invoke` resolved only when JARVIS came back — while the process sat at
foreground-service priority, *not* OS-frozen. Every WebView-hosted task longer than that
stalled. So the loop moved native:

| Piece | Where | What |
|---|---|---|
| The loop, every guard, policy, prompts, verification | `OperatorCore.kt` | **Android-free** — device, model and journal are interfaces, so it's unit-tested on the JVM (`OperatorCoreTest.kt`) |
| Device / model / journal / run registry | `NativeOperator.kt` | AccessibilityService adapter, an HTTP route ladder, the Room journal, start/status |
| Start + relay | `tools/dispatch.ts` `runPhone()` | Preflight, up-front consent, `operator_start`, then polls `operator_status` |

The brain still owns **what** to call: `runPhone()` resolves the route ladder
(`routes.ts`/`quota.ts`) to concrete URLs + auth through each provider's `wire()` and
hands them over; native only shapes the request body (Gemini `generateContent` or OpenAI
chat), so endpoint and credential knowledge stays single-sourced. Routes the native ladder
benches mid-task come back in the status and are fed to `quota` via `ask.benchFromNative`.
Keys live in native memory for the task only — never journaled.

The brain only **starts** a task and **reads** its progress. If the WebView is paused
mid-task, the task still finishes; the journal, a result notification and the next
`operator_status` poll all carry the outcome. **Do not move any part of the decision loop
back into JS**, and don't add a mid-task step that needs the WebView awake.

### What the loop enforces

- **Roles.** An executor step per command (90 s ceiling; one carried a screenshot past
  31 s) and an independent completion checker. The plan (2–5 checkable steps) rides on
  the **first** command's `"plan"` field — it used to be its own model call before the
  first step.
- **Vision.** A screenshot goes with a step only when it earns its latency: the first look
  at each app (never at JARVIS itself), after a failed action, when stuck, after a
  coordinate tap, on a sparse element list (< 10 labelled — the app is hiding its UI), or
  when the model asks with `{"do":"look"}`. The prompt says whether one is attached; when
  the ladder falls through to an OpenAI-format route (no image in that body), native
  appends a note saying it wasn't sent.
- **Guards.** Adaptive step and wall-clock budget (only a *progressing* task earns more),
  cycle detector, no-progress detector, duplicate-message guard, and a STOP check before
  every action (the journal's cancel flag + the overlay's STOP counter).
- **Policy (R0–R3).** Consent for an external side effect (R2: send, share, post, call) is
  taken **up front** — `operator_start` answers `needsConsent` and the brain asks while
  JARVIS is still on screen. Mid-task approval is impossible (JARVIS's UI is behind the
  driven app), so any R3 step, and any R2 step without that consent, suspends the task
  honestly. There is no mid-task "ask the user" either.
- **Coordinates.** `tap_point` (thousandths of the screenshot), `tap_xy` and `drag` (pixels,
  as element bounds are printed) share one policy, `classifyPoint`: R1 only in a low-risk
  goal, with a label that passes the R2/R3 word checks and no risky element under any
  point touched — re-checked on a fresh observation right before acting, against the app
  rather than the exact generation (animated pages would fail every time). Unlabelled, or
  in an R2 goal, it's R2. **One coordinate system per step:** on a step that carries a
  screenshot, pixel commands (`tap_xy`, `drag`) are refused — models give thousandths of
  the image even to a pixel command (live: `tap_xy (500,940)` meant the Search bar and hit
  Samsung's sign-in card). **JARVIS's own STOP overlay is invisible to the operator:** its
  windows are dropped from the snapshot, blacked out of screenshots, and a coordinate
  gesture on it is refused — the operator had pressed it and cancelled itself. `enter` (the keyboard's Enter/Search key, `ACTION_IME_ENTER`) is
  R2 in any goal that mentions messaging, since Enter can send.
- **Truthful completion.** A `done` is only reported after the checker PASSes it, with a
  receipt the journal's compare-and-set accepts. The checker judges a **fresh** observation
  (plus a screenshot when it takes images, plus the facts noted during the task), and
  ordinary UI state counts as evidence (a Pause control = playing). For a playback goal
  the phone's own audio state (`AudioManager.isMusicActive`) is ground truth: nothing
  playing rejects without a model call, and both executor and checker see it — the checker
  once passed a paused Spotify mini-player off the song's title. A `done` whose summary
  narrates non-completion is sent back to work, not ended. A second rejection with nothing
  done in between ends the task as `unverified` ("I think X, but couldn't confirm it")
  instead of burning steps re-claiming. Before any give-up (cycle, no progress, step or
  time budget) the checker looks once: a goal already met on screen succeeds — the
  2026-09-25 Spotify run had the song playing while the operator toggled play/pause into
  "nothing is changing". Running out of quota *after acting* says what was last done, so
  the user checks instead of resending.
- **Settling.** A tap whose screen never goes quiet (a running timer, a progress bar) is
  reported done with a note, not as failed — the failure made the operator tap again,
  which on a toggle undoes it. `open_app` waits for the new app's first screen to settle
  (≤ 2.5 s) so the first look isn't a splash screen.
- **Stale observations.** Every action is bound to the observation's generation, and a
  live screen moves it on during a model call. On `stale_observation` the loop re-observes
  **once** and retries only if the same control (its native selector) is still there at
  the same risk — no extra model call.
- **Coming back to report.** The spoken summary is produced by the WebView, which is
  paused by the time a task ends, so native brings JARVIS to the front when a task
  finishes (a bound AccessibilityService exempts the app from background-launch limits).
  Not after STOP, and not after a success the model flagged `stay_in_app` (media playing,
  a chat left open) — there the result notification is the signal.

The TS replay cache (`operator/cache.ts`) was dropped with the move: it had never
successfully promoted a workflow (see STATUS.md), so there was nothing to port.

### The per-step prompt IS the token budget

One task step = one model call, and the whole screen node-tree goes in every one, which is
why **the operator, not chat, is what exhausts the route ladder**. Anything added to a
node's rendered line (`renderObs` in `OperatorCore.kt`) is paid ~80 times per step, every
step: no `selector` (the model targets by index), and toggle state only on nodes that are
actually checkable. A test caps a full 80-node screen's size.

---

## 5. Everything native goes through one bridge

```
Kotlin method on PhonePlugin.kt
  → Rust #[command] in tauri-plugin-phone/src/{commands,mobile}.rs
    → invoke("plugin:phone|<name>") in src/brain/platform/index.ts
```

Typed request in, typed response out. **Don't build a second path for a new capability —
add a command here.** The name must stay in sync across **four** places: snake_case in JS
and Rust, camelCase in the Kotlin `@Command`, the `build.rs` `COMMANDS` list, and the
`run_mobile_plugin("…")` strings in `mobile.rs`. Miss one and the call fails at runtime
with nothing at compile time — `QrScanner.jsx` spent months invoking
`request_camera_permission`, a command that existed in none of the four.

### Every native call needs a timeout on the JS side

Several `@Command`s resolve their `Invoke` from an **Android callback** rather than
returning directly — gesture results most of all. Android does not guarantee those
callbacks fire: if the AccessibilityService loses window focus or a system dialog steals
input, neither `onCompleted` nor `onCancelled` arrives, the `Invoke` is never resolved,
and the awaiting JS promise hangs **forever**. That wedges the whole `phone_task` loop,
and `shouldAbort` is polled *between* steps rather than during an awaited invoke, so even
the STOP button can't recover it — only an app restart.

Two guards, both required:

1. Kotlin posts a watchdog alongside `dispatchGesture` so a missing callback still
   produces a receipt (`GESTURE_CALLBACK_TIMEOUT_MS` in `JarvisAccessibilityService.kt`).
2. `phoneInvoke` in `platform/index.ts` races every call against
   `PHONE_INVOKE_TIMEOUT_MS`. Commands that legitimately block on the *user* — a folder
   picker, a permission screen — are listed in `UNBOUNDED_COMMANDS` and exempted.

Adding a command that waits on the user? Put it in that set. Adding one that resolves
from a callback? The timeout already covers you.

### The event bridge is broken on this device — poll a counter instead

Tauri's JS *event*/Channel bridge (`addPluginListener` + native `trigger(...)`) drops
callbacks during WebView startup reloads (`[TAURI] Couldn't find callback id …`), so a
fired native event silently never arrives. Confirmed live. The plain request/response
`invoke()` path does not have this problem.

Two features already work around it the same way — **poll a monotonic sequence counter**:

- Wake word: `platform/wakeword.ts` polls `poll_wake_word` every 140 ms for a rising `seq`.
- Cross-app STOP: `platform/stopOverlay.ts` polls `poll_stop_overlay` every 250 ms.

If you add a new native→JS async signal, use this same pattern. Don't reach for the event
bridge; it will silently no-op on-device.

One deliberate exception: the Android back button (`onBackButtonPress` from
`@tauri-apps/api/app`, wrapped in `hooks/useAndroidBack.js`). Tauri's own `AppPlugin`
only diverts back to JS while a listener is registered, and there's no invoke-based
alternative. Settings and every `components/Sheet.jsx` panel (Conversation,
Capabilities, Device, Skills) register it only while open, long after startup, and
unregister on close so back falls through to Android again. Live-verified for
Settings 2026-09-25.

### The Kotlin side

| File | What it is |
|---|---|
| `OperatorCore.kt` / `NativeOperator.kt` | The on-phone operator loop (§4) and its Android glue |
| `JarvisAccessibilityService.kt` | Reads the screen's node tree; taps, types, scrolls (a scroll only reports ok if the screen actually moved), gestures, back/home; screenshot; the STOP overlay |
| `WakeWordManager.kt` / `WakeWordService.kt` | On-device "Hey Jarvis" (openWakeWord ONNX) as a foreground service |
| `SecureSecretStore.kt` | Provider credentials encrypted by a **non-exportable Android Keystore key**. SharedPreferences holds only ciphertext + IV; plaintext crosses the bridge for the life of one call and is never written to WebView storage |
| `DeviceIdentityManager.kt` | The phone's EC identity key (Keystore, non-exportable). Only the public key, fingerprint, a monotonic counter and signatures cross the bridge — this is what authenticates the phone to the PC |
| `AutonomyTaskStore.kt` | A **Room** database: the task journal. Goals, receipts, screenshots and results stay here, not in WebView storage, so a WebView backup can't become a second unredacted audit log |
| `AutonomySupervisorService.kt` | Foreground service owning task lifecycle — start, cancel, suspend, complete. If the WebView dies, recovery marks the task *suspended*; it never blindly repeats the last action |
| `AutonomyBootReceiver.kt` / `AutonomyRecoveryWorker.kt` | Reconcile task state after a reboot or an app upgrade |
| `ActiveTaskRegistry.kt` / `NavigationWaitGate.kt` | Which task may act right now; and a pure decision gate so an *accepted* navigation action is never mistaken for a *verified* UI transition (STOP always wins a concurrent completion) |
| `PhonePlugin.kt` / `ReminderReceiver.kt` | The `@TauriPlugin` command surface; the receiver for scheduled reminders |

The current command surface, grouped: the native operator (`operator_start`,
`operator_status`), single operator actions (`observe`, `tap`, `tap_xy`, `double_tap`,
`long_press`, `swipe`, `set_text`, `type_text`, `scroll`, `back`, `home` — no longer used
by the brain now the loop is native; candidates for removal),
app/system control (`open_app`, `close_app`, `open_url` — `http`/`https` only, since the
URL is model-authored and injected page text can steer it — `set_volume`, `read_clipboard`,
`open_system_settings`, `open_accessibility_settings`), TTS (`speak`, `stop_speaking`,
`poll_speaking`), wake word (`start_wake_word`, `stop_wake_word`, `poll_wake_word`),
STOP overlay (`show_stop_overlay`, `hide_stop_overlay`, `poll_stop_overlay`,
`request_overlay_permission`), secrets (`config_secret_get/set/delete`), device identity
(`identity_info`, `identity_sign_auth/envelope/pairing`,
`identity_verify_host_challenge/envelope`), the task journal (`task_begin`,
`task_checkpoint`, `task_status`, `task_finish`, `task_cancel`), calendar/clock
(`calendar_action`, `clock_action`), and device/file access (`get_device_stats`,
`capture_screenshot`, `pick_folder`, `list_directory`, `read_file`).

The operator loop is tested without a device on the JVM: `OperatorCoreTest.kt` drives
`OperatorLoop` with a fake device, a scripted model and a fake journal
(`./gradlew :tauri-plugin-phone:testDebugUnitTest` from `src-tauri/gen/android`).

### Speech: input in the WebView, output through native TTS

**Listening** stays in the WebView on purpose. `platform/stt.ts` records with
`MediaRecorder` (Wry's WebView grants `getUserMedia` once `RECORD_AUDIO` is in the
manifest) and transcribes with Groq Whisper (`whisper-large-v3`, temperature 0, a short
vocabulary prompt), falling back to Vertex Chirp when Groq fails so one provider outage
doesn't take voice input down. After "Hey Jarvis", `MicRecorder.untilSilence()` ends the
recording ~0.9 s after you stop talking (an energy VAD on the same stream, 10 s ceiling)
instead of a fixed window. Don't add a native speech-recognition plugin.

**Speaking** goes through native Android TextToSpeech: Android System WebView does not
implement `window.speechSynthesis`, so `platform/webspeech.ts` calls
`plugin:phone|speak` and polls `poll_speaking` for real completion (the event bridge is
unreliable, §5). `speechSynthesis` is only the browser-preview fallback. The same native
commands also let the phone talk when the PC drives it remotely.

Known gap: the wake-word engine and `MediaRecorder` can't share the mic, so the handoff
after the wake cue drops roughly the first half-second of a command (STATUS.md).

---

## 6. Remote-controlling the PC

`remote/pc.ts` is a WebSocket client that pairs to the **unchanged desktop backend** and
forwards whole tasks to it.

- **Auth is device-key based.** The phone signs with its Keystore EC key; the host's
  public identity is pinned from an expiring, single-use pairing QR. No bearer token is
  accepted in URLs, WebSocket protocols, storage, or compatibility flags. Pairing is
  QR-scan only.
- **Network.** `pc.ts` tries the cross-network address (typically Tailscale) first, then
  silently upgrades to LAN via a reachability probe, so switching Wi-Fi needs no user
  action. `altHost` comes from the pairing QR.
- **Task protocol v2.** A task has a stable id and idempotency key, is explicitly
  accepted, can be resubscribed with an event cursor after a reconnect, and completes
  **only** from a correlated terminal task event. Ambient chat or telemetry events can
  never complete a task or keep one alive.
- **Screen sharing.** `remote/webrtcScreen.ts` does *not* open its own signaling channel —
  SDP/ICE rides over the same `pc.ts` WebSocket as `{type, data}` messages, then a real
  `RTCPeerConnection` carries the video (DTLS-SRTP, P2P or TURN-relayed). Touch input goes
  back over the WebSocket as `remote_input`, not through WebRTC.
- **Lease-gated input.** `hooks/controlLease.js` is a fail-closed lease/sequence tracker
  so the UI can't emit an unleased or replayed input envelope. The host enforces auth
  independently; this stops the bug before it leaves the phone.
- **`send()` is fire-and-forget; `sendConfirmed()` is not.** Every outbound message is
  queued on `outboundChain` and signed asynchronously through the native identity bridge
  — which this file documents as prone to dropped callbacks. `send()` returns as soon as
  the message is *accepted for sending*, so a `true` from it does **not** mean the PC
  received anything. Anything that then tells the user the PC was told something must use
  `sendConfirmed()` / `signalConfirmed()` / `cancelTaskConfirmed()`, which resolve only
  once the signed envelope actually reached the socket. The STOP button reported "hard
  stop sent" off an optimistic `true` while the task kept running on the PC.
- **Approvals are keyed by task, not a single slot.** Several tasks can be subscribed at
  once and each raises its own signed challenge, so `activeApprovals` is a
  `Map<taskId, …>`. A newer challenge supersedes an older one only *for the same task*.

> There was once a second phone↔PC channel (`platform/remoteLink.ts`, PeerJS-mediated). It
> never got past a stub and has been deleted along with the dependency. The live path is
> `remote/pc.ts` + `remote/webrtcScreen.ts`, and nothing else.

---

## 7. Three memory systems, not one

Check which one a feature reads before assuming "memory" means what you think:

1. **`memory/store.ts`** — facts + conversation turns in `localStorage`, plain keyword
   recall (`keywordRank()`). The port of the desktop's file-based `memory_store.py`.
2. **`memory/vectorStore.ts`** — semantic recall via Vertex AI `text-embedding-004`
   embeddings and cosine similarity, also `localStorage`-backed. Net-new, not part of the
   Python port map. Note the write is gated on a `saJson` argument: `remember(text,
   saJson)` only embeds when the caller passes the service-account JSON, and `facts(query,
   saJson)` only searches when it gets one. **Pass it on both sides or neither** — for a
   long time `dispatch.ts` passed it only on the read, so every turn paid an embedding
   round-trip to search a store nothing had ever written to.
3. **`memory/proceduralLearning.ts`** (fronted by `memory/playbooks.ts`) — durable
   *verified* procedural learning. Prose a user types in chat is reference-only and never
   executable; a workflow only becomes executable after entering through the typed
   candidate API and collecting **three independent deterministic success receipts**.
   Deliberately not exposed as model tools.

The **Memory view** (dock → MEMORY, or voice `control_interface open_memory`; port of the
desktop's `MemoryOverlay`) shows stores 1 and 3 plus saved chats, with a creation
timeline. Its Forget is exact — `store.deleteFact(text)`, a playbook by its unique name, a
chat by id — unlike the voice `forget`, which substring-matches. Fact timestamps live in a
separate `jarvis.android.facts.at.v1` map so the fact list keeps its plain `string[]`
shape; facts saved before it existed are undated and just don't appear on the timeline.

---

## 8. Desktop vs mobile splits

**Rust: compile-time.** `src-tauri/src/lib.rs` gates every desktop-only feature (system
tray, global hotkey, spawning the Python sidecar) behind `#[cfg(desktop)]`. Mobile builds
compile those blocks out entirely. Add desktop-only capabilities the same way — not with
a runtime `IS_MOBILE` branch.

**The one mobile-only Rust block: exit.** When the activity is destroyed (swiped out of
Recents), tao exits the process. A normal `exit()` runs C++ static destructors, and
onnxruntime's tore down under the live wake-word threads — a native crash, which made
Android switch JARVIS's accessibility service off. `RunEvent::Exit` therefore ends a
mobile process with `_exit(0)`. Don't swap it for `prevent_exit()`: tao starts a fresh
app instance on every activity `onCreate`, so a process that outlives its activity would
run two Tauri apps.

**Config: per platform.** `tauri.conf.json` declares four desktop windows (`main`,
`overlay`, `browser-panel`, `control-overlay`); on Android Tauri built WebViews for them
too, and a hidden 0×0 one ran a second copy of the whole app — its own brain, pollers and
wake-word loop — and swallowed invoke responses (`[TAURI] Couldn't find callback id`).
`tauri.android.conf.json` (JSON-merge-patched over the base config, so its `windows`
array replaces the base one) keeps `main` only. A new desktop window belongs in the base
file; don't add one to the Android file.

**React: runtime.** One shared component tree renders on both platforms, so things like
desktop-only window-focus effects are guarded by `IS_MOBILE` from `useAssistant.js`.

**A React caveat that cost real debugging time:** the wake-word listener is a module-level
singleton (`syncWakeWord()`, keyed by a config-hash signature) deliberately *not* tied to
a React effect's mount/unmount. StrictMode's mount→unmount→remount was killing the engine
mid-boot. Don't "tidy" it back into an effect.

---

## 9. Conventions

- **Tests are colocated** — `foo.test.ts` sits next to `foo.ts` (vitest), not in a
  separate `tests/` tree. Follow that for new modules.
- **`ok: true` means it happened.** A `ToolResult` whose summary explains why something
  *couldn't* be done must be `ok: false`, however polite the wording. Real offenders that
  got through review: `record(media, "stop")` returning `ok: true` with "Recording isn't
  supported on Android yet", `forget()` returning `ok: true` for "Nothing matched.", and
  `remember()` returning `ok: true` after a `localStorage` write that threw. The model is
  told tool results are the source of truth, so each of these made it report work it had
  not done. `writeJson()` returns a boolean for exactly this reason — check it when you
  are about to claim a save succeeded.
- **A test that uses the tool's own internal names proves nothing.** `dispatch.test.ts`
  called `customize_screen` with `"accent"` — an internal name the model can never emit —
  and passed for months while every real call failed. Drive tests from the advertised
  surface.
- **Lint is clean — keep it that way.** `npm run lint` reports 0 problems (2026-09-25;
  it was 85). The two `eslint-disable`s left each carry their reason. React component
  files export only components (Fast Refresh); shared HUD values live in
  `src/hud/hudConstants.js`. Tests may use `any` to build deliberately bad input.
- **`src-tauri/gen/android` is tracked, not generated-and-ignored.** It holds hand edits
  that matter: `allowBackup="false"`, the release build's cleartext rule (allowed only because PC pairing is
  `ws://` inside the Tailscale tunnel — see `app/build.gradle.kts`), and the
  signing config. Re-running `tauri android init` overwrites them — diff before you
  commit. `tauri.settings.gradle` (absolute local paths) and keystores stay ignored.
- **Check before you assume a feature is missing.** [STATUS.md](STATUS.md) records what's
  been verified on a real device; a lot of what looks unfinished has been tested live.
- **If you use graphify**, run `graphify update .` after changing code to keep the
  gitignored `graphify-out/` graph current. Nothing in the build depends on it.
