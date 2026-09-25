# The JARVIS brain (TypeScript) — Android edition

This directory is the **on-device assistant brain**. On Windows the brain is a Python
program (`jarvis-studio-backend/`) that the app talks to over a local WebSocket. On
Android there is no Python process — the brain runs **inside the app, in TypeScript**, and
the React HUD calls it directly through `hooks/useBrain.js`.

**This is live code, not a scaffold.** For how it fits the rest of the app see
[docs/ARCHITECTURE.md](../../../docs/ARCHITECTURE.md); for what's verified on a device see
[docs/STATUS.md](../../../docs/STATUS.md).

## Port map — TypeScript file ↔ Python original

The Python originals live in the desktop app's `jarvis-studio-backend/` (a separate
project, not in this repository). They're what you diff against when a behaviour differs between the phone and the
PC. Maintainers keep a read-only local copy at `reference/python-backend-spec/`; it is
gitignored and not part of this repository.

| This file / dir | Ports from (`jarvis-studio-backend/`) |
| --- | --- |
| `index.ts`, `ask.ts` | `main.py` (the route / observe→act orchestration) |
| `loop.ts` | `main.py` route loop + `autopilot.py` agent loop |
| `config.ts`, `resolveConfig.ts` | `app_secrets.py`, Settings/Onboarding key handling |
| `types.ts` | the shared message / tool / action-spec shapes |
| `providers/gemini.ts` | `llm/gemini_bridge.py` |
| `providers/openaiCompat.ts` | `llm/groq_bridge.py` (Groq), plus the OpenRouter / NVIDIA / Mistral presets |
| `providers/index.ts`, `providers/models.ts` | provider routing in `main.py` + `model_discovery.py` |
| `routes.ts` | `llm/groq_bridge.py`'s `_model_ladder` |
| `modelCatalog.ts`, `modelRanker.ts` | `llm/model_catalog.py`, `llm/model_ranker.py` — keep the `KNOWN` tables identical |
| `quota.ts`, `errorClass.ts` | `llm/quota.py` — same ladder and header parsing; the phone currently leads (per-minute windows, the transient ladder) |
| `tools/registry.ts` | `llm/live_tools.py` (`function_declarations`, `to_spec`) |
| `tools/dispatch.ts` | `actions/__init__.py` (`run_action` dispatch) |
| `tools/http.ts` | `weather.py`, `places.py`/`places_google.py`, `news.py`, web search |
| `memory/store.ts` | `memory_store.py`, conversation history |
| *(Kotlin)* `OperatorCore.kt` | `autopilot.py` — the UIAutomation loop, retargeted at AccessibilityService. Native, not TS: a hidden WebView is paused ~60s after JARVIS leaves the foreground (see docs/ARCHITECTURE.md §4) |
| `remote/pc.ts` | the desktop HUD's WebSocket client, aimed at the unchanged backend |

**Net-new on Android** (no Python counterpart — don't go looking for one):
`configSecrets.ts` (Keystore-backed credentials), `modelPolicy.ts` (Auto-mode model
classing), `modelRemap.ts` (follows Google's model retirements), `providers/catalog.ts`
(pooled-provider model discovery), `memory/vectorStore.ts` (embedding recall),
`memory/proceduralLearning.ts` (verified workflows), `platform/*` (the JS side of the
Kotlin plugin), `mobile/screenConfig.ts`, `schedule/*`.

## Tool dispositions on Android

- **Ported as-is (pure HTTP/logic):** `get_weather`, `web_search`, `find_places`,
  `get_directions`, `get_news`, `set_reminder`, `manage_routine`, `manage_playbook`,
  `remember_fact`, `forget_fact`, `set_my_location`, `make_qr_code`, `generate_image`,
  `clear_conversation`, `get_time`, `get_day`, `manage_schedule`, `manage_clock`.
- **Mapped to an Android API (native plugin):** `take_screenshot`,
  `open_application`/`close_application` (Intents/PackageManager), `open_website`,
  `set_volume`/`system_control` (AudioManager), `record` (MediaRecorder),
  `read_clipboard`, `read_file`/`list_directory` (Storage Access Framework),
  `open_saved_file`, `customize_screen`.
- **New on phone:** `phone_task` — the AccessibilityService operator (native Kotlin;
  `tools/dispatch.ts` starts it and relays progress), the mobile analog of the desktop
  `computer_*` tools.
- **Dropped on phone:** `browser_task`, `browser_control`, `computer_task`,
  `computer_control`. They come back only through `pc_task` (`remote/pc.ts`), which
  forwards the whole goal to the unchanged Windows backend.

## Design rules carried over from the Python brain

1. **One execution path.** Native function calls and text `[ACTION]` tags both lower to
   one action-spec, then one dispatcher — exactly like `live_tools.to_spec` feeding
   `actions.run_action`. Keep that single chokepoint.
2. **Never claim success you didn't get.** The spoken confirmation is built from the
   tool's real return value (mirrors the Python "says-it-did-but-didn't" guards).
3. **Tier-aware tool palette.** The advertised tools depend on the active provider —
   `tools/registry.ts` `capabilitiesFor()`.
4. **A spent route is remembered.** `quota.ts` persists its benches; keep it in sync with
   the desktop's `llm/quota.py` when either changes.
5. **Only evidence turns a model off.** A model is marked tool-less only when a provider
   says tool calling is *not supported*; a route is benched by what its error actually
   says (per-minute, per-day, transient, gone). Guessing either way has cost a day of
   broken tasks more than once — see docs/STATUS.md, 2026-09-25.

## Testing

Tests are colocated (`foo.test.ts` next to `foo.ts`, vitest). The operator loop is
Kotlin and tested on the JVM (`OperatorCoreTest.kt`, run with
`./gradlew :tauri-plugin-phone:testDebugUnitTest` from `src-tauri/gen/android`).
