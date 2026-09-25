# tauri-plugin-phone — plugin reference

The native half of the Android app: a Kotlin ↔ Rust ↔ JS bridge with its own Cargo crate
and Gradle module, auto-wired into the Android build. Everything the app can do *to the
phone* goes through here.

This is working, shipped code. For where it sits in the system see
[docs/ARCHITECTURE.md](../../../docs/ARCHITECTURE.md) §5; for what's device-verified see
[docs/STATUS.md](../../../docs/STATUS.md).

## The one rule: four spellings stay in sync

```
JS   invoke("plugin:phone|set_text")            ← snake_case
Rust commands.rs / mobile.rs run_mobile_plugin  ← snake_case cmd, camelCase target
Rust build.rs COMMANDS[]                        ← snake_case (drives permission autogen)
Kotlin @Command fun setText()                   ← camelCase
```

Miss one and the command fails at runtime, not at build time. Adding a capability means
touching all four — and nothing else. **Don't build a second path.**

## What's in it

**Kotlin** (`android/src/main/java/`):

| File | Role |
|---|---|
| `PhonePlugin.kt` | The `@TauriPlugin` command surface — every entry point |
| `OperatorCore.kt` | The phone-task loop (observe → one JSON command → act → repeat) and its R0–R3 risk policy. Pure Kotlin, JVM-tested |
| `NativeOperator.kt` | Android glue for that loop: the accessibility device, the HTTP model ladder, the Room journal, and the start/status registry the WebView polls |
| `RoutePacer.kt` | Per-route pacing for the operator's model ladder (per-minute limits, backoff) |
| `JarvisAccessibilityService.kt` | Node-tree dump; tap/type/scroll/gesture/back/home; screenshot fallback; the STOP overlay |
| `WakeWordManager.kt`, `WakeWordService.kt` | On-device "Hey Jarvis" (openWakeWord ONNX) as a foreground service |
| `SecureSecretStore.kt` | Provider credentials under a non-exportable Keystore key (AES-GCM); SharedPreferences holds ciphertext + IV only |
| `DeviceIdentityManager.kt` | The phone's non-exportable EC identity key, used to authenticate to the paired PC |
| `AutonomyTaskStore.kt` | Room database — the task journal (goals, receipts, results stay native, never in WebView storage) |
| `AutonomySupervisorService.kt` | Foreground service owning task lifecycle: start / cancel / suspend / complete |
| `AutonomyBootReceiver.kt`, `AutonomyRecoveryWorker.kt` | Reconcile task state after reboot or app upgrade |
| `ActiveTaskRegistry.kt`, `NavigationWaitGate.kt` | Who may act now; and a pure gate so an *accepted* navigation is never mistaken for a *verified* transition (STOP wins ties) |

**Rust** (`src/`): `commands.rs`, `mobile.rs`, `desktop.rs` (stubs), `models.rs`,
`error.rs`, `lib.rs`.

**Commands** — the authoritative list is `build.rs`'s `COMMANDS` array. Grouped:

- Native operator loop: `operator_start`, `operator_status`
- Single actions: `observe`, `tap`, `tap_xy`, `double_tap`, `long_press`, `swipe`, `set_text`,
  `type_text`, `scroll`, `back`, `home`, `is_enabled`
- Apps & system: `open_app`, `close_app`, `open_url`, `set_volume`, `read_clipboard`,
  `open_system_settings`, `open_accessibility_settings`
- Speech: `speak`, `stop_speaking`, `poll_speaking`
- Wake word: `start_wake_word`, `stop_wake_word`, `poll_wake_word`
- STOP overlay: `show_stop_overlay`, `hide_stop_overlay`, `poll_stop_overlay`,
  `request_overlay_permission`
- Secrets: `config_secret_set`, `config_secret_get`, `config_secret_delete`
- Device identity: `identity_info`, `identity_sign_auth`, `identity_sign_envelope`,
  `identity_sign_pairing`, `identity_verify_host_challenge`, `identity_verify_host_envelope`
- Task journal: `task_begin`, `task_checkpoint`, `task_status`, `task_finish`, `task_cancel`
- Device & files: `get_device_stats`, `capture_screenshot`, `pick_folder`,
  `list_directory`, `read_file`
- Calendar & clock: `calendar_action`, `clock_action`

`observe` returns `{ app, nodes[], ready }` matching the TS `Observation`; action commands
return `{ ok, summary }`.

## Gotchas that are still live

- **Don't run `npx tauri android init`.** It regenerates `gen/android` and drops the hand
  edits there. That folder is tracked in git (including
  `gen/android/app/src/main/AndroidManifest.xml`) precisely so they survive: the app-level
  permissions (`RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, `CAMERA`, `SYSTEM_ALERT_WINDOW`,
  `INTERNET`), `allowBackup="false"`, and the `<queries>` block. The `<queries>` block is
  what makes `open_app` able to see other apps at all — without it, app launching silently
  fails. If you ever do run init, diff against git and restore them.
  The accessibility `<service>`, the wake-word and autonomy services, and their permissions
  come from **this plugin's** manifest via the merger, so those survive an init.
- **The event/Channel bridge silently drops callbacks** during WebView startup reloads on
  this device. Native→JS async signals poll a monotonic `seq` over `invoke()` instead —
  `poll_wake_word` and `poll_stop_overlay` are the two existing examples. Follow that
  pattern; don't add a listener.
- **Permission autogen:** the plugin build generates `permissions/autogenerated/…` from
  `build.rs`'s `COMMANDS`, and `permissions/default.toml` references `allow-<command>`. If
  the app capability fails to resolve `phone:default`, check those got generated.
- **Package identifier:** the Kotlin package is `com.jarvis.phone` while the app is
  `com.jarvis.app`. They coexist fine, but
  `register_android_plugin("com.jarvis.phone", "PhonePlugin")` in `mobile.rs` must match
  the Kotlin package exactly.
- **minSdk 24** is required (`dispatchGesture`). Both the plugin and the app are at 24.

## Enabling it on a device

Settings ▸ Accessibility ▸ JARVIS ▸ On — or ask JARVIS "enable phone control" and it
deep-links there. Gestures are far less flaky on a real phone than on the emulator.

Smoke test: *"open WhatsApp and message Mom 'on my way'."* The operator caps itself on
steps and wall-clock and reports honest failure if it can't finish — it will not fabricate
a success.

## Deliberately out of scope

**MediaProjection screen capture.** The operator drives off the accessibility node tree;
Android 11+ AccessibilityService screenshots are wired as a vision fallback. Full
MediaProjection streaming would only buy canvas/game UIs the a11y tree can't see, and
hasn't been worth the permission cost yet.
