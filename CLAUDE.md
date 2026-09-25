# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository.

## What this is

`aura-android` is the Android port of JARVIS (a voice assistant with app/PC control). It
is a **separate fork** of the Windows desktop app (`aura`, the sibling folder) — same
Tauri 2 + React shell, but the Python backend brain is **reimplemented in TypeScript and
runs inside the app** (no on-device Python). `reference/python-backend-spec/` (local-only,
gitignored, like `graphify-out/`) is a read-only copy of the original Python backend kept
only as a porting blueprint — never edit or import it.

## Read these before assuming anything

- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — how the four layers fit together and
  the rules that keep them from multiplying. The section numbers below refer to it.
- **[docs/STATUS.md](docs/STATUS.md)** — what is live-verified vs merely built vs open.
  **Check it before calling a feature unfinished or untested** — a lot of what looks
  half-done has been confirmed on a real device.
- **[docs/SECURITY.md](docs/SECURITY.md)** — the white-hat audit. Read its *Current
  status* section first; the findings below it are a 2026-07 snapshot and several are
  closed.
- `docs/archive/` is history. Not maintained, and it loses to the two docs above.

## Commands

All commands run from `jarvis-studio-gui/`:

```
npm run dev              # Vite dev server (browser preview, no native plugins)
npm run typecheck        # tsc --noEmit
npm run lint             # eslint .
npm run format           # prettier --write .
npm test                 # vitest run (all *.test.ts)
npx vitest run path/to/file.test.ts   # single test file
npm run build            # vite build (web bundle only)
```

Device build + install (`ANDROID_HOME`/`NDK_HOME` must already be set):

```
npx tauri android build --debug --apk --target aarch64     # real device
npx tauri android build --debug --apk --target x86_64      # emulator
adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
adb shell am start -n com.jarvis.app/.MainActivity
```

**`tauri android dev` hangs after building — do not use it.** Use `tauri android build`
(it exits cleanly), then `adb install` + `adb shell am start` manually.

**Don't `adb shell am force-stop com.jarvis.app`** — Android then *disables* JARVIS's
accessibility service and every phone task fails until the user re-enables it. Restart
with `adb install -r` or `am start` instead.

The emulator has no real mic and its software-GPU SystemUI ANRs under load (not an app
bug) — it's boot/UI-only. Audio, wake word, accessibility control and remote-PC pairing
all require a real device.

## The rules that actually matter

These are the ones that get broken by well-meaning changes. Details in ARCHITECTURE.md.

1. **One dispatch chokepoint.** `tools/registry.ts` advertises; `tools/dispatch.ts`
   executes. Native function calls and text `[ACTION]` tags both lower to one action-spec
   and hit one dispatcher. **Never add a second execution path.** (§3)

2. **One native bridge.** Kotlin `PhonePlugin.kt` → Rust `#[command]` → `invoke(
   "plugin:phone|<name>")` in `platform/index.ts`. New capability = a new command here,
   not a new path. Keep the three name spellings in sync (snake_case JS/Rust, camelCase
   Kotlin, plus `build.rs` `COMMANDS` and `mobile.rs`'s `run_mobile_plugin` strings). (§5)

3. **Never claim a tool succeeded unless its actual return value says so.** Carried over
   from the Python brain; enforced throughout dispatch, the operator loop and remote task
   resolution. This is the app's core trustworthiness property, not a nicety.

4. **Don't use the Tauri event/Channel bridge for native→JS signals.** It silently drops
   callbacks during WebView startup reloads on this device (confirmed live). Poll a
   monotonic `seq` counter over `invoke()` instead — that's what wake word
   (`poll_wake_word`, 140 ms) and the STOP overlay (`poll_stop_overlay`, 250 ms) do. (§5)

5. **Desktop-only Rust goes behind `#[cfg(desktop)]`**, not a runtime `IS_MOBILE` check.
   `src-tauri/src/lib.rs` gates the tray, global hotkey and Python sidecar this way. The
   React side *does* use runtime `IS_MOBILE` branches, since one component tree renders on
   both platforms. (§8)

6. **Don't move the wake-word listener into a React effect.** It's a module-level
   singleton (`syncWakeWord()`, keyed by a config-hash signature) on purpose — StrictMode's
   mount→unmount→remount was killing the engine mid-boot. (§8)

7. **`quota.ts` currently LEADS the desktop's `llm/quota.py`.** They're meant to mirror
   each other, but the per-minute vs per-day bench windows (2026-09-23) and the capped
   transient ladder (20s → 2m → 10m, 2026-09-25) exist only on the phone so far. Port them
   before assuming the two behave the same. (§2)

8. **"Memory" is ambiguous here — check which store.** Keyword recall
   (`memory/store.ts`), semantic/embedding recall (`memory/vectorStore.ts`), and verified
   procedural workflows (`memory/proceduralLearning.ts`) are three separate systems. (§7)

9. **Don't reintroduce a native STT/TTS plugin.** Speech deliberately uses the WebView
   (`platform/webspeech.ts`, `platform/stt.ts`). The native `speak`/`stop_speaking` commands
   are a different thing — the phone talking *as* a remote-controlled device. (§5)

10. **Tests are colocated** — `foo.test.ts` next to `foo.ts`, not in a `tests/` tree.

11. **The phone operator loop is native — keep it there.** `OperatorCore.kt` runs the
    loop; JS only starts it (`operator_start`) and polls it (`operator_status`). A hidden
    WebView is paused ~60s after JARVIS leaves the foreground (measured on-device), and a
    phone task is backgrounded by definition. Nothing mid-task may wait on the WebView. (§4)

12. **After modifying code, run `graphify update .`** to keep `graphify-out/` current
    (AST-only, no API cost). For codebase questions, `graphify query "<question>"` first.

13. **The search-grounded model estimate runs ONLY from the Re-rank button**
    (`modelRanker.estimateUnknown`). It spends the Gemini quota chat and phone tasks
    share; running it on launch was a deliberate removal (2026-09-25) — don't re-add it.
    Pooled providers stay out of the ranked ladder (tail fallbacks only). (§2)

14. **`src-tauri/gen/android` is committed.** It carries `allowBackup="false"`, the
    release cleartext rule (allowed, for `ws://` pairing over Tailscale) and signing. `tauri android init` overwrites it — diff
    before committing. Keep `npm run lint` at 0 problems; a new `eslint-disable` needs a
    reason next to it. (§9)

## Keeping the docs true

When a change makes one of the docs wrong, fix the doc in the same pass:

- New subsystem, new bridge command, or a changed rule → `docs/ARCHITECTURE.md`
- A feature verified on a device, or a new known gap → `docs/STATUS.md`
- A security finding closed or introduced → `docs/SECURITY.md` *Current status*
- Anything a newcomer needs in the first five minutes → `README.md`
