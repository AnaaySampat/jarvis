# Status

Latest follow-up: **2026-10-24 evening**, installed and live-tested on SM-E156B;
see [TV, model alerts and notification results](TV-TESTING-2026-10-24.md).
Plain notification reads now use the native reader directly. The previously failing
chat request displayed the full sample notification in **174 ms**, with zero model
calls. Recurring model-switch popups are removed: an actual TV visual task triggered
two diagnostic fallback notices and zero popups. TV status, volume/mute, YouTube search,
URL/timestamp playback, controls, Home/look, visual search, standby/wake and Netflix
named episode/controls passed. Netflix season-ID resolution and foreground playback
proof were fixed. Positive phone-current-video handoff remains untested because the
phone has no supported video-player app installed. TV restored to Home, volume 59,
unmuted; phone volume and spoken replies restored. **522 TypeScript tests passed /
9 skipped**, typecheck, lint and web/native APK build passed; earlier **148 native
tests passed**, with no further native changes in this follow-up.

Latest fixes: **2026-10-24**, built and installed in place on SM-E156B; see
[fixes and validation](FIXES-2026-10-24.md). The reproduced STOP, reviewer JSON,
Research/Files result handling, content, hardware identity, calendar, timer, Spotify
fallback and remote lease/video/Back regressions have source fixes. Final checks:
**516 TypeScript tests passed / 9 skipped**, **148 native tests passed**, typecheck,
lint and web/native APK build passed. Weather now returns its actual tool answer in
about one second with zero model calls and no observed log-to-chat gap. Second-model
completion review is retained only for complex objectives or multiple executed tools;
native verification and approvals are unchanged. Live places lookup still fails
because all tested public mirrors time out. TV testing was deferred while someone
was watching, then completed in the evening follow-up above; fresh PC control needs
human biometrics.
The detailed report separates live passes from automated-only checks.

Historical regression session: **2026-10-23**, on the USB-connected SM-E156B and paired PC:
[full results and remaining coverage](TESTING-2026-10-23.md). Current-source debug APK
has reproduced regressions: STOP remains latched across later chat, completion review
rejects successful tools/Research/Files answers, Content generation hits a false action
claim, phone-model verification accepts the editable device name, places lookup fails,
remote control countdown resets to zero, remote video drops, running timer dismissal
reports success without stopping it, and calendar fallback claims an unsaved draft was
saved. Spotify direct-query playback also failed (play/pause controls passed). These
new observations qualify older green rows below. Voice (including background wake),
the authorized WhatsApp send, timed routine tap/run, text files, agenda/reminder/alarm
creation and many device controls passed. Fresh tests: **495 passed / 9 skipped**;
144 native tests in valid cached Gradle results; typecheck, lint and web/native build
passed. Baseline release checks are separated from the rebuilt current source in the
report. No production-code fixes made in this session.

Previous review: **2026-10-20** (the rest of `docs/TESTING-2026-10-19.md` with the user: home arrival,
send-to-TV, TV by sight, Wake-on-LAN; results in each feature's row). Before that **2026-10-19** (the 2026-10-19 features against the SM-E156B, the PC and
the TV; results are in each feature's row). Before that
**2026-10-18** (home screen pass, below). Before that **2026-09-27** (wake-word check + fallback-model pass, live-verified on the
SM-E156B; 2026-09-26: verifier + unfamiliar-task pass, live-verified against ground truth).

This is the honest state of the app. It separates three different things, because
conflating them is how you end up debugging something that was never tested:

| Mark | Means |
|---|---|
| ✅ **Live** | Run on a real phone and confirmed working end to end |
| 🟡 **Built** | In source, typecheck/lint/tests green, but no recorded on-device test |
| ⬜ **Open** | Not done |

Repo checks as of 2026-09-27: `npm test` **298 passed / 32 files**, JVM plugin tests 104
passed, `npm run typecheck` clean, `npm run build` clean, and **`npm run lint` clean — 0
problems** (was 59 errors / 26 warnings). Two suppressions remain, each with its reason in
place: App.jsx's `uiCommand` effect (an event delivered as state by two transports) and
useBrain's model-discovery effect (the rule can't see the setState is after an `await`).
A debug APK and a release APK both exist in
`src-tauri/gen/android/app/build/outputs/apk/universal/`.

> **The debug APK was last rebuilt and installed on the real phone (Galaxy M15) on
> 2026-09-25.** What that run confirmed is in *The 2026-09-25 rate-limit regression fix*
> below. The release APK (2026-07-26) still predates all of this.

---

## Core app

| | Feature | Notes |
|---|---|---|
| 🟡 | The desktop's look and menus (2026-10-22) — the home screen is the Windows app's (header with its quick controls, greeting clock, the orb or the Iron Man reactor, status, last reply, ask box, starters, its cards), with Chat / Memory / Skills / Capabilities in a bottom bar around the mic. Customize has the desktop's Theme (Modern, Iron Man, saved themes, import), colours, Look (font, cards, centrepiece, gauges, corners, glow), backgrounds incl. a picture, density and cards (`screenConfig.ts` validates every value, as `clean_look` does; `set_style` by voice). Also new: the command palette (header search), Settings grouped and searchable like the desktop with an Interface page, search in Capabilities / Memory / Recent chats, copy on replies, and the desktop's neutral menu colours | Browser preview only (375×812 and 390×844, plus 1280×800): both looks, every menu, Customize presets saved and applied, palette search → run. Not run on a phone; theme files import but aren't saved to a file there (no download path in the WebView) |
| ✅ | Boots on a real device (arm64) | Also on the laptop emulator (`scripts/emulator.ps1`, host GPU, 2026-10-17): boot screen and onboarding render, no SystemUI ANR. Voice, app control and pairing there are untested |
| 🟡 | First-run setup redesign (2026-10-17) — two steps (free keys or Google Cloud, then the keys); each key is checked live against its provider as it is pasted (Working / Not accepted / Couldn't check) and a refused key blocks Start; "Get a free key" opens the provider's console in the phone's browser; the service-account JSON can be picked as a file | Laptop emulator (`jarvis_test`, API 36.1, 2026-10-17): Android back on step 2 returns to step 1 and stays in the app; Choose file opens the system picker (`GET_CONTENT */*`) and the picked JSON lands in the field and gets checked (a fake key read "Not accepted"); Get a free key sent a VIEW intent for `https://console.groq.com/keys`, which opened in Chrome as its own app. Browser preview: fake keys came back "Not accepted" from the real Groq and Gemini endpoints; the working, offline and two-key states with a stubbed `fetch`; finishing lands on the HUD. Real phone (SM-E156B, 2026-10-17, from a side-by-side debug copy `com.jarvis.app.setuptest` so the installed app's keys stayed untouched): step 1 and step 2 render dark with a readable status bar. The key check, links, back and Choose file weren't reached: Family Link's daily screen-time limit closed the copy (a parental limit, not an app bug), and blocked it again on 2026-10-18; only the installed JARVIS has unlimited time there. Not yet: those four on a phone, and finishing setup with real keys |
| 🟡 | Several keys in one field no longer break voice or model discovery (2026-10-17) | Speech-to-text and the model listing put the whole multi-line field into one auth header, so pasting a second Groq key (as the setup hint invites) failed every transcription. Both now use the first key. Unit-tested (`stt.test.ts`, `models.test.ts`). On the phone 2026-10-17 with one Groq and one Gemini key (so the multi-key path itself isn't hit there): "Hey Jarvis, what is twelve times twelve?" → Groq Whisper → "144", and Settings ▸ Models lists Gemini, Groq, OpenRouter and NVIDIA models. Several keys in one field: unit-tested only |
| ✅ | Dark launch and a readable status bar (2026-10-17) — the Android 12+ splash, the window and the WebView start on the app's `#04070d` instead of white, and status-bar icons are always light (the default followed the *system* theme, so a phone in light mode drew dark icons on the dark UI) | Laptop emulator in light mode: splash, loading frame and setup all dark, clock readable. The WebView colour goes in `tauri.android.conf.json`, which replaces the whole `windows` array on Android. Real phone (SM-E156B, Android 16, system light mode, 2026-10-17): a cold start after `adb install -r` is solid `#04070d` from the first frame to the HUD, and the status-bar icons are light on the HUD and in chat (on 2.2.1 the clock was dark on the dark HUD) |
| ✅ | Phone STOP pill sits above the mic (2026-10-17) | It used to cover the last buttons of the top icon bar, which also had a second stop button while speaking (now desktop only). Real phone 2026-10-17: the pill reads "Speaking · STOP" above the mic, the top bar is clear, and tapping STOP cut the speech in ~0.6 s (`stopSpeaking`, no player left running). It covered the CONVERSATION button there: the pill used the sticky dock's own `bottom: 104px`. **Fixed 2026-10-17, browser preview only (411×891, the phone's CSS size):** while the pill is up, `hud-mobile.css` lifts the dock to 150px. Measured: CONVERSATION 676–733, pill 753–787, mic 801–869. Also fixed: after launch, recovered PC tasks held it on "PC task active" (and the cross-app STOP overlay up) while the PC backend was down. It cleared only when a new task pushed them past the activity cap. `ACTIVE_TASK_STATES` no longer includes "recovering" (unit test in `taskCenter.test.ts`). Both fixes on the phone 2026-10-18 (4cdb429): with 5 PC cursors still saved and the PC backend down, launch shows no pill, and the overlay STOP appears only for the spoken greeting. While speaking, the dock sits at 165px (150 + 15 safe area): CONVERSATION 602–659, pill 678–713, mic 727–795 (CSS px). The lifted dock does cover the lower half of the clock while JARVIS talks |
| ✅ | Chat through the in-app TypeScript brain | No Python process on the phone |
| 🟡 | Smaller tool palette per turn (2026-10-19) — a turn advertises the core tools (the one-step phone actions, `phone_task`, `pc_task`, `tv_control`, web search, weather, timers…), plus any tool group its words or the last two turns point at (files, places, media, planner, hud, system); `load_tools` adds a group mid-turn, and a round spent only on it doesn't count against the 3-round cap. ~16k characters of schemas per call became ~10k on a plain turn. Same design as the desktop's `live_tools.py` groups | Unit-tested (`registry.test.ts`, `loop.test.ts`); not yet run on a phone. Watch for a turn where the model answers "I can't" instead of calling `load_tools` |
| ✅ | Fallback-model guards, round 2 (2026-09-27) — the "answered about the phone without looking" recheck now fires on "what model is my phone", "my battery", "Android version" (it needed the literal "on my phone"); today's date is in the system prompt (a fallback model took its training cutoff for "now") | When Gemini's quota is spent the chat runs on Groq's qwen3.8-27b. Live 2026-09-27 with the chat on the fallback: "what model is my phone?" → qwen called `phone_task` → "Samsung Galaxy F15 5G (SM-E156B)" (matches `getprop`, 21.7 s); "how many days until New Year's Day?" → "96" (right). A weaker model is still weaker: these close the failure paths seen, not the gap |
| ✅ | HTTP tools — weather, news, web search, places, directions | Ported as-is from the Python backend |
| ✅ | Web search grounds only on Gemini 2.5 Flash / Flash-Lite, across every Gemini key (2026-09-27) | Search used to ground with the selected Gemini model — a 3.x one by default — and 3.x grounding is "Not available" on the free tier, so every search failed for a free key with Gemini selected. Live 2026-09-27 with the chat on the Groq fallback (Gemini chat routes benched): "which team won the most recent Formula 1 Grand Prix" → qwen called `web_search` → yesterday's Azerbaijan GP, Baku, Russell/Mercedes (a Saturday race, past any model's cutoff). The Gemini-selected config the bug hit is unit-tested only (this phone's Auto config already grounded on 2.5) |
| 🟡 | Tavily web-search backup (2026-10-11) — used only when Gemini grounding can't answer | Unit-tested only (`tools/http.test.ts`); no device run, needs an APK rebuild (new Keystore name `tavilyKey`, new HTTP scope) |
| ✅ | Reminders, alarms, timers, schedule | Set in the phone's own Clock app through the public `AlarmClock` intents (`clock_action`), so they show there and survive a reboot; agenda items mirror into the calendar. Timed routines are the one in-app alarm (next row) |
| 🟡 | Routines (2026-09-30) — `manage_routine` add/run/list/remove; one store for voice macros ("run my bedtime routine") and timed briefings ("every morning at 8") | Unit-tested only (`schedule/routines.test.ts`), never run on a device. A run is an ordinary brain turn, so each step goes through dispatch. **Timed routines while JARVIS is closed (2026-10-18, live on SM-E156B):** every save hands the timed routines to `RoutineAlarms.kt` (`schedule_routines`), which keeps one exact `AlarmManager` alarm for the earliest and at the time posts "Time for <name>". Tapping it opens JARVIS and the routine runs through the same tick as before (`poll_routine_tap` → `tappedRoutine` → `routineTurn`); an untapped one never counts as run, and one more than 2 h late (phone off) is dropped. Re-armed on boot. The add reply only promises the notification when the native reply says notifications are on (and says "may hold it a few minutes" when the alarm isn't exact). Live run: launch synced the user's "7:21 PM time check" to an exact alarm (`exactAllowReason=policy_permission`, i.e. `USE_EXACT_ALARM`); a test routine added by chat for 13:48 with JARVIS on the home screen posted "Time for test time check" at 13:48:00.02, rolled to the next day with `lastRun` still empty and the WebView untouched; tapping it at 13:48:49 opened JARVIS, the turn ran once ("The current time is 1:48 PM (1:48:55 PM)"), `lastRun` and the native list updated, the notification cleared, and removing the routine from the card re-armed only the user's 19:21 alarm. Samsung groups it with the wake-word notification, so the first tap only expands the group. The model's add reply paraphrased away the "I'll post a notification" sentence. Same day, the rest: **cold-start tap** — first try failed: with JARVIS killed (`run-as … kill -9`, never force-stop) the tap revived the old activity record and the intent arrived via `onNewIntent` before Tauri had registered the plugin, so `seq` stayed 0 and only the 2 h catch-up happened to run it. Fixed by taking the tap in `MainActivity`; retest at 14:05 with the process dead: `seq` 1, ran once ("2:05:51 PM"), notification cleared. **Reboot** — a test routine for 14:08, phone rebooted at 14:07 and unlocked 14:09:32: the boot receiver announced the missed routine at 14:09:40, rolled it to the next day and re-armed the exact alarm for the user's 19:21; tapping it then took the other cold path (`onCreate`, new activity) and recorded `seq` 1 and ran once — the turn itself said "You're offline" because Wi-Fi hadn't reconnected after the reboot (the user reconnected it by hand); it still counts as today's run, like any failed run. **Time zone change** — `RoutineAlarmReceiver` now also takes `TIMEZONE_CHANGED` and re-works every routine's next time in the new zone. Live 14:15–14:17: the user switched the phone to Africa/Luanda and the 19:21 alarm moved to 19:21 WAT (stored instant +4.5 h, exact); switching back to Asia/Kolkata returned it to 19:21 IST. While JARVIS is open, timed routines still fire from the WebView tick, or when opened within 2 h after the due time. **Routines card (2026-10-18):** under Status on the home screen, every saved routine with when it runs ("Every day at 19:21", "When you ask", "· ran today"), a Run button that sends the routine's turn the way a timed one does, tap for the steps and a two-tap Remove. Real phone: the user's three routines listed with their schedules, and the steps view opened and closed; Run and Remove were exercised only in the browser preview (Run on the phone would really turn on Do Not Disturb). Memory ▸ Playbooks no longer calls itself "routines". **Add / Edit on the card (2026-10-18):** an inline form — name, steps, optional time, days as Every day / Weekdays / Weekends / Custom (day chips) — saved through `saveRoutine` (routines.ts: refuses a name another routine already has, keeps an edited routine's place and today's run, drops the old name only once the new one is valid); a refusal shows addRoutine's own words in the form. Real phone (SM-E156B, main ebf8ea5, 2026-10-18 ~14:30): Add opened the form with the name field focused and the keyboard up (the WebView resized, every field reachable), an untimed "test routine" was added, Edit opened it prefilled, renaming it to "test check" kept its place and dropped the old name, and the two-tap Remove deleted it; the user's 19:21 exact alarm stayed armed through all of it (`dumpsys alarm`). Before that, checked in the browser preview at 411×891 (add, duplicate-name refusal, custom days, edit prefill, rename in place, empty state), not on the phone. 2026-10-17: two starter routines ("movie night", "bedtime" — TV + PC + phone Do Not Disturb, each step only if that device is set up) are seeded once, and saved routine names go into the system prompt so saying the name alone runs it. Live on SM-E156B 2026-10-17: the upgrade seeded both starters next to an existing timed routine; "what routines do I have?" listed all three; "movie night" on its own ran it, reported the TV (offline) and PC (backend not running) as unreachable rather than done, and really turned Do Not Disturb on (`zen_mode` 0→1, via the operator: Quick Settings, then Settings search). "bedtime" has still never run on a device |
| ✅ | Providers: Vertex AI (Service Account JSON), Gemini, Groq | Provider **and** model selectable in Settings |
| 🟡 | Auto mode + the route ladder (`routes.ts`/`quota.ts`) | Unit-tested; the escalating bench ladder hasn't been watched through a real multi-day quota exhaustion |
| ✅ | Smart routing — benchmark-ranked ladder, Settings ▸ Routing, Re-rank, per-key Remove (2026-09-24, ported from desktop) | Live 2026-09-25: chat turns and phone tasks routed by it, zero 429s (after the fixes below). The grounded estimate of unknown models runs only from Re-rank and has never *succeeded* on the phone (Gemini 429 both times it ran) — likely cause found 2026-09-27: it grounded on 3.6/3.5-flash, where the free tier has no search grounding; now on the 2.5 pair, not yet re-run. Settings list checked on-screen 2026-09-25 |
| 🟡 | Provider + model choice (2026-09-25) — provider list is Auto + providers you have keys for; model list is what those keys reach, grouped by provider; Auto on a provider = best model from that provider, Auto/Auto = full smart routing | Unit-tested (routes/resolveConfig); pickers checked on the Galaxy M15 (Auto, Gemini, Groq, OpenRouter, NVIDIA NIM listed, no Vertex). A chat turn under a provider-scoped Auto not yet watched live |
| ✅ | HUD menus rebuilt on the Settings design (2026-09-25) — Conversation, Capabilities (tap an example → chat box), Device (live Wi-Fi/battery readouts, app control), Skills (QR and clipboard results shown in place), Terminal ▸ Clear | Live on the Galaxy M15: all four sheets render opaque with live readouts, Android back closes a sheet and stays in the app, QR shows in place, Clear arms then disarms after 3s (confirm not pressed). Fixes the see-through Skills/Capabilities panels seen on the Galaxy M15 and the QR result that was dropped on the phone |
| ✅ | Settings redesign (2026-09-25) — drill-down index with a live readout per section (phone), nav column + page (≥760px), switches, pinned Save with an unsaved-changes note | Checked on the Galaxy M15 2026-09-25: index readouts show real state, and Routing lists 31 ranked models (so the Smart-routing list above is now checked on-screen too). Android back steps page → index → closes Settings, then leaves the app as before (live-verified after the fix) |
| 🟡 | Home screen pass (2026-10-18) — **Status panel** under the clock: Voice (wake word on/off), App control (accessibility service, re-read each time JARVIS returns to the front), Model, PC link, TV; a row that's off reads amber and tapping it goes to where it's fixed (Settings ▸ Voice / Models, Android's Accessibility screen, Remote PC & TV). **Top bar**: status word ("Standby", "Listening"…) on the left, five labelled-for-screen-readers icons on the right (mute, tasks, remote, customize, settings); the duplicate conversation-log button and the conversation-mode toggle left it (the toggle is now in the chat header). **Dock**: one row of five tabs (was three rows, ~200px); Chat shows a dot for a reply that arrived while it was closed instead of a message count stuck at "1" from the greeting. **Chat**: a mic in the composer when the box is empty (the HUD's mic is hidden under the sheet), starter prompts until you've said something (the greeting hid them). **Agenda**: add/edit in an inline form with a time picker instead of two `window.prompt` dialogs; edit/remove buttons visible on touch (they were hover-only). The core and boot screen say JARVIS, not the theme name "REACTOR CORE"; the idle hint says "tap the mic" when the wake word is off. Tasks, Remote PC and Customize now close on Android back/Escape (back used to leave the app); Task Center copy is plain ("Checking the result…", not "invalidating actuator lease…") | Browser preview at 411×891: every item above, including add + edit on the agenda, a starter filling the box, the Voice row opening Settings ▸ Voice, and wake word off → "STANDBY — tap the mic" / "Mic button only". Desktop layout unchanged. **Real phone (SM-E156B, debug build over 2.2.1, 2026-10-18 ~01:20):** Status read Voice "Wake word on", App control "On" (from the live accessibility service), Model "Auto · 32 models", PC "Connecting…" (PC off), TV "BRAVIA 4K 2015", header READY; the Voice row opened Settings ▸ Voice and back twice returned home; chat shows the composer mic and the header toggle; Android back closed Chat and Tasks and stayed in JARVIS. Found on the phone and fixed before this was written: the restored conversation lit the unread dot on launch, "auto" was shown lowercase, and a switched-off PC counted as "1 TO CHECK". Not yet on the phone: agenda add/edit (it would write to the real agenda), the unread dot after a spoken turn, App control "Off" |
| 🟡 | Cards and sheets pass (2026-10-18, same day) — below Status the phone panels are cards: sentence-case title with a live summary that shows when folded ("40%, charging", "29° · Mumbai", "74 GB free"), label → value rows, a thin bar where a proportion means something. **Device**: memory and storage (CPU dropped: `/proc/stat` is closed to apps since Android 8). **Battery** (was Power, and battery was drawn three times): one big %, charging state and time, and the real temperature (the old "TEMP" gauge showed battery °C as a percentage). **Weather**: line icons instead of emoji, night icons after 19:00. **Network**: says "estimated" for the WebView's speed and latency guesses and drops the always-0 upload box and the sparkline of an estimate. Agenda and the action log in the same type. **Sheets**: Customize, Remote PC & TV (and its PIN step) and Tasks moved to the Sheet design Settings uses; Memory got the same header, a segmented section control and rows in a well, and lost the tick timeline on the phone. Sentence-case approval and clarify dialogs. **Bugs fixed on the way:** Customize's move/reset buttons did nothing on the phone (the phone store only merges; `move`/`reset` were stored as dead keys) — it now sends explicit orders and Reset clears the layout; the voice tool's `move_panel` up/down threw (`order["up"]`), now reorders (`screenConfig.test.ts`); a voice "reset my home screen" left the old look until relaunch; Android back left the app from Memory | Browser preview at 411×891: each card with data and with none, Customize move across the rail boundary / hide / reset (stored layout checked), Remote PC & TV unpaired, Tasks empty, Memory with a fact. **Real phone (SM-E156B, 2026-10-18 ~09:15):** Device "39 of 105 GB", Battery "85%, Charging, 41 °C" with a green bar, Weather with line icons and "Now", Network "Wi-Fi / 10+ Mbps", Action log "80 actions" folded; Remote PC & TV showed the paired PC (100.102.97.45, "Connecting…" with the PC off, screen row disabled) and the BRAVIA at 192.168.0.194; Tasks, Customize (the saved Aurora background) and Memory (two stored facts) all render as sheets, and Android back closed each and stayed in JARVIS. Found on the phone and fixed: an IPv6 public IP drew over its label; the top bar's old right-edge fade let cards show through it, and content scrolled visibly under the status bar (its padding used the bottom inset) — it now reaches under the status bar and is near-opaque. Not run on the phone: Customize move/reset (would change the saved layout), Unpair/Forget (would drop the real pairing) |
| 🟡 | Four phone rough edges (2026-10-18, same day) — **Routine runs** read "Run bedtime" in the chat; the model still gets the full turn. The user turn carries an optional `display` (`ChatMessage.display`, saved with the turn), so a relaunch, a saved chat's title and its preview show it too. Card Run and the timed tick both pass it; voice runs keep the user's own words. **Tasks**: a verified phone task says "Verified against the screen" with the receipt hash folded under Details (it was a raw 64-hex line); a PC task's evidence keeps its "Verification evidence" label. **Wind** is km/h unless the locale's region drives in mph (US, GB, a few others; `windUnit` in `wmoCodes.ts`, `wmoCodes.test.ts`), on the Weather card and the spoken weather. The phone is `en-IN`, so km/h. **Agenda**: the empty card is one left-aligned row on the phone, not a centred poster (299 → 217px at 411×891) | Browser preview at 411×891: card Run on a "bedtime" routine showed "Run bedtime" (fake key, so the reply was an error); a saved routine turn reloaded as "Run bedtime" and archived as a saved chat titled "Run bedtime" (`index.test.ts` checks the model still gets the full turn); a succeeded phone task built through `reduceNativeStatus` showed the plain line, and Details opened to the full receipt; the Weather card said "1 mph" under the browser's en-US, and the same fetch under en-IN gave "2 km/h"; the empty Agenda card. **Real phone (SM-E156B, main ebf8ea5, 2026-10-18 ~14:30):** a card Run showed "Run test check" in the chat (older turns above it still show the long instruction) and the reply came back as text ("2:32 PM"), with the Chat dot lit while the chat was closed; each recovered task read "Verified against the screen" and Details opened to the receipt; Weather said "9 km/h"; the empty Agenda card was one compact row. Found on the phone: the big Weather icon comes from the first hourly code, so it showed rain beside "Overcast" (the current condition). Fixed: `fetchPanelWeather` returns the current condition's own glyph and the card uses current data for "now" (big icon, and the strip's first column's icon and temperature); `ambient.test.ts`. Browser preview against live Mumbai weather: "Overcast" with a cloud, "Now" 33° matching; not yet on the phone |
| ✅ | Photos in chat + Markdown tables (2026-10-19) — the chat's paperclip now shows on the phone: pick a photo, it is shrunk to a ≤1536 px JPEG and sent with the message (default question "What's in this photo?"); only Gemini/Vertex routes get a turn with a photo (the OpenAI-compatible client sends text only), and with no Google key the turn says so instead of answering unseen. The photo is not saved with the turn (`[photo attached]` is), so a follow-up works from the reply. GitHub pipe tables in replies render as tables and are spoken row by row | Unit-tested (`formatting.test.ts`, `ask.test.ts`); chat bubble, photo thumbnail and tables checked in the browser preview at phone width. **Live on the SM-E156B the same evening (user-run):** a photo picked through the paperclip was answered, and a table reply rendered as a grid. HEIC photos are refused with a message (the WebView can't decode them) |
| ✅ | "When I get home" routines (2026-10-19): a routine can run on arriving home — the phone recognises its home Wi-Fi (gateway + subnet, learned when the TV or PC answers there) and posts the routine's tap-to-run notification, at most once a day | Unit-tested (`routines.test.ts`, `ArrivalWatcherTest.kt`, desktop `test_memory_sync.py` for the synced shape); `ArrivalWatcherTest` also passes inside the Android Gradle build (2026-10-19). **On the SM-E156B 2026-10-19:** no home learned yet (`jarvis_arrival.xml` held only `routines`): the TV had moved to 192.168.1.11, so the phone hadn't reached it on a home address since the update, and the PC only answers over Tailscale. Found and fixed: re-pairing the TV under Remote PC & TV didn't count as "answered at home" (`pairTV` built its shell without `onLan`); `nativeTvShell`'s `onLan` now has a test. **Then a real bug:** with Tailscale up (which PC pairing uses) marking home answered "The phone isn't on Wi-Fi" — `currentWifi` read `activeNetwork`, which for the app is the VPN, so home could never be learned and the 15-minute sampler would always record "away". It now picks the non-VPN Wi-Fi network; on the device, with Tailscale connected, marking gave "This Wi-Fi is home." (`192.168.1.1|192.168.1.0/24`). A "When I get home" routine made in the form ("home test": tell me the weather) is registered: `jarvis_arrival.xml` now lists `homes`, `routines` and `last`. Blip and arrival tests (Wi-Fi off/on), the closed-app callback and Doze timing are still unknown **Live 2026-10-20, SM-E156B (Wi-Fi switched with `cmd wifi`):** blip (off 15 s) → no notification ✅. Arrival → nothing: Android's PendingIntent network callback is one-shot — it fires once (at once, for the home Wi-Fi it was registered on) and the system releases it ~5 s later (`dumpsys connectivity`: REGISTER 11:22:41.865, RELEASE 11:22:46.915), so nothing was listening when the phone came home. Fixed: the 15-minute sampler arms the callback again whenever it finds the phone away, and counts home-after-away as an arrival itself when the callback was spent on another Wi-Fi (`ArrivalWatcher.sighting`, `ArrivalWatcherTest`). After the fix: Wi-Fi off 12:00:30, sampler armed it 12:03:38 (REGISTER, not released), Wi-Fi on 12:03:50 → "You're home: home test" 12:03:55 ✅; tapping it ran the routine once (weather) ✅; a second arrival the same day posted the notification again (13:03:47) but a replayed tap ran nothing ✅ (that notification does nothing when tapped — a small gap). Also found: the main checkout's APK had been built with the worktree's plugin (shared CARGO_TARGET_DIR: tauri-plugin-phone's build-script output kept the worktree's android path) — deleting that unit's fingerprint fixed it. Still unknown: the callback with JARVIS swiped away, and Doze timing (the phone was on USB power) |
| 🟡 | Nightly memory digest (2026-10-19): after 03:00, the user's own new messages → up to five new facts (toggle in Memory ▸ Facts); the PC also writes a dated journal note | Unit-tested (`memory/digest.test.ts`, desktop `test_memory_digest.py`) with a fake model. **First real run, SM-E156B 2026-10-19** (opened after 03:00; the toggle is in Memory ▸ About you): it read one message, "Put Korakendra live on the TV On YouTube", and saved "My live stream is called Korakendra and I want to put it on TV through YouTube.", which is a guess, not something the user said. Reproduced from the PC with the same prompt on gemini-2.5-flash-lite: 6 bad facts in 8 runs. One line added to both prompts (a command says nothing lasting about the user; never add whose or why): 0 in 8. Not yet tested: an overnight run, and switching it off **2026-10-20 (opened 10:48):** it read the evening's messages and brought back "My favourite colour is teal." — the fact forgotten in the sync test the night before (the forget left a tombstone, then the digest re-learned it from "remember that my favourite colour is teal" and the sync carried it back to the PC). The digest never looked at what had been forgotten. Fixed in both apps: the forgotten facts go in the prompt ("never add them back") and a fact whose key matches a remembered or forgotten one, "My X" = "The user's X", is dropped (`digest.test.ts`, desktop `test_memory_digest.py`, both fail without it). On the real cheap-tier model the old prompt brought them back 8 runs in 8, the new one 0 in 8, still keeping the new fact. Not yet: an overnight run, switching it off |
| ✅ | One memory with the PC (2026-10-19): facts and routines merge over the paired link, newest wins, deletions travel as tombstones; a timed routine fires only on the device it came from | Unit-tested both sides (`memory/sync.test.ts`, desktop `test_memory_sync.py`). **Live 2026-10-19, SM-E156B ↔ PC over Tailscale:** on connecting, both fact lists merged. "Remember that my favourite colour is teal" on the phone reached the PC's `facts.json` within 6 s; forgetting it on the PC removed it from the phone within 30 s (tombstone in `sync_tombstones.json`), and it was still gone on both 15 minutes later. A routine made on the phone for 22:01 showed on the PC as "Every day at 22:01 (on your phone)"; the phone posted its notification at 22:01 and the PC did not run it. Removing that routine on the phone reached the PC in 5 s. Unedited starter routines aren't sent, by design |
| 🟡 | Memory view — dock ▸ MEMORY / "open memory" (2026-09-24, ported from desktop) | Browser-preview-verified at phone width: remember, exact forget, timeline, saved chats. Installed on the device but not yet opened there |
| 🟡 | Calendar read/write, clock intents | Newer native commands, no recorded live test |

## Voice

| | Feature | Notes |
|---|---|---|
| ✅ | Push-to-talk mic (`MediaRecorder` → Groq Whisper) | Verified on a real device only; the emulator's `-Mic` (laptop mic passthrough) is untested. Since 2026-09-22 it falls back to Vertex Chirp when Groq fails, instead of failing the turn outright |
| ✅ | Spoken replies (`window.speechSynthesis`) | Plus real TTS-completion tracking, so "stop" lands correctly |
| ✅ | "Hey Jarvis" wake word, on-device (openWakeWord ONNX) | Works end to end. Root cause of the long-running failure was React StrictMode remounting the listener — hence the module-level singleton, don't refactor it back into an effect |
| ✅ | Wake word as a foreground service | Keeps listening with the app backgrounded |
| ✅ | Wake check (2026-09-27): a command counts only if Whisper hears "Hey Jarvis" in the audio that fired the wake | Why: 2026-09-26 the wake word typed a nearby conversation into JARVIS ("You know how it got one task down from 42 seconds to 8 seconds?" — the user was describing JARVIS to someone). Scores can't separate the two: logged genuine wakes on this phone scored 0.37–0.99, so raising the 0.35 threshold would have missed about 40% of them. **Live 2026-09-27, SM-E156B, the laptop's two TTS voices at the phone:** final build 16/16 genuine wakes confirmed (seven fired early at 0.38–0.47) and every command answered; the model fired on 7 lines *about* Jarvis ("Jarvis is the name of the assistant…", "Say hey to Jarvis for me", "Hey, did Jarvis finish the task?") and all 7 were ignored — each would have been a command before. The first build wrongly rejected 6 of 14 real wakes (the clip ended at the first frame over the threshold, mid-"Jarvis"; Whisper heard "Kay Jarvis", "A. Jarvis", "Age or Miss") and let one through unchecked (a later poll overtook the one carrying the audio); fixed with 0.4 s of audio past the detection, the name as Whisper's hint, "Kay"/"A." accepted as "Hey", and one poll in flight. Deliberate: a bare "Jarvis, …" is ignored. When the phone is offline the check can't run and lets wakes through (seen live during a Wi-Fi drop). Not yet: the user's own voice |
| ✅ | One-breath wake commands (2026-10-11): the command is recorded natively from the wake engine's own mic stream and sent with the wake as one clip, transcribed once — no mic handoff, so "Hey Jarvis, open X" keeps "open" | **Live 2026-10-11, SM-E156B, laptop TTS:** "Hey Jarvis, what is five plus five" in one breath → "what is 5 plus 5?" (was "That's five."), ×3; "…what is seven times six" → "what is 7 times 6?"; wake, pause, "what is ten minus three" → "What is 10 minus 3?"; captures end ~1 s after speech (2.6–2.9 s total). 2 of 4 lines *about* Jarvis fired the model; both ignored. A silent wake ends at 4 s without calling Whisper — unless the room itself is talking, then Whisper hears no "Hey Jarvis" and nothing happens. Tuned live: the raw MIC has no AGC (room ~0.020, command 0.040–0.060), so loud = 2× the room level and speech = runs of ≥2 loud chunks; the room level is the 30th-percentile chunk of the 4 s before the wake, held for the command (a tracked floor stuck at the near-silent chunks after the mic opened, and every capture ran 10 s — fixed and re-run: "what is the capital of Japan?" ended 2.4 s after the wake). The user confirmed it with their own voice the same day |
| ✅ | Update notice (2026-10-11): on launch, at most once a day, JARVIS asks GitHub for the latest release and shows "JARVIS x.y.z is available — Get it" when it's newer than the installed APK | Live 2026-10-11 on a build labelled 2.0.0: the banner read "JARVIS 2.1.0 is available. Get it", and Get it sent a VIEW intent for the github.com release page (this phone's Chrome Beta is paused, so Android showed "App isn't available" — the phone's setting). Notify-only |
| ✅ | Wake command capture ends on silence (energy VAD, ~0.9s) instead of a fixed 6s; Groq STT on full `whisper-large-v3` + prompt, temp 0 (2026-09-25) | Live 2026-09-27: every wake command in the wake-check runs ended on silence and transcribed word for word ("What is the capital of Japan?", "What is 10 minus 3?"). Known gap, confirmed live the same day ("Hey Jarvis, what is five plus five?" in one breath arrived as "That's five."): the mic handoff (engine stop → 250ms → `getUserMedia`) still drops the first ~0.5–1s after the beep, so "Hey Jarvis open X" in one breath loses the command's start. Real fix is capturing the command natively; the openWakeWord lib's `AudioRecorder` is private, so that means owning the mic loop — which the wake check (above) now does, so this is unblocked. 2026-10-11: a wake followed by no speech (VAD heard nothing) is no longer sent to Whisper — unit-tested only |
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
| ✅ | Verifier + unfamiliar-task pass (2026-09-26 evening) | **Baseline on never-tuned tasks** (v0.1.2 release build, ground truth from `settings`/`getprop`/`wm`/`ip`): Do not disturb ✅ (the checker rightly rejected two premature `done`s — a dialog was still open), IP address ✅, timer 1:30 not started ✅; **security patch level ❌** (refused: the goal said "security", so every tap was R3), **auto-rotate ❌ ×2** (scrolled Display settings up and down until the cycle guard stopped it and never searched — Samsung has no auto-rotate entry in Settings at all), Eye comfort shield ❌ (the chat model never called `phone_task`). **What changed** (ARCHITECTURE §4): the checker judges system-recorded evidence — `changes_made` (every switch/radio/tile/tab the task flipped, diffed from the screen before and after each action, even on screens since left) and `claim_evidence` (where each number and name in the answer was seen) — answers with per-requirement `checks` (a "pass" listing an unmet check is refused), takes one screenshot second look before rejecting after a flip, treats "in Settings" as a route, fails "couldn't find it" unless asked whether it exists, and writes the summary the user hears; an explicit `fail` gets the rescue check. For unfamiliar tasks: each step says what it changed (`→ …`), progress means *new information* (5 stale moves → nudge + replan, 9 → stop), scroll hint → search, one redirect of a scroll cycle, `quick_settings` (panel closed at task end), `stateDescription`, lookups may pass through sensitive areas (SECURITY.md), and a low-risk stale retry is bound to the control, not the screen generation. Chat side: the prompt routes phone-state questions to `phone_task`, and a reply about the phone that called no tool gets one recheck round. **After, live on SM-E156B vs ground truth (debug builds):** auto-rotate ✅ **11.3 s** (was ❌; `accelerometer_rotation`=1), security patch ✅ ("5 July 2026"; was ❌), Eye comfort ✅ 13.9 s; **held-out, never tried before:** Bluetooth on/off ✅ 17.6 s / 13.5 s, Power saving on/off ✅ 29 s / 26.7 s (via the quick panel), device name ✅ ("Anaay's S27 Ultra", after the chat fix), DND off ✅ 22.6 s, auto-rotate off ✅ 25 s, Eye comfort off ✅ 16.7 s, screen resolution — this phone has no such setting: 171.6 s ending in a "not found" counted as success → **86.6 s honest failure** (the checker twice rejected Game Booster's "Screenshot resolution" as the answer). **Regression** on tuned tasks that reached the operator: stop+reset ✅ (46.9 s — a live stopwatch made every "Stop" tap stale; the control-bound retry fixes that), screen timeout 2 min ✅ 32.4 s / 10 min ✅ 22.7 s (`screen_off_timeout` checked). **Found and fixed on the way:** the checker read Samsung's ON rotation tile ("Auto rotate, Set to portrait") as locked and demanded the Settings route, and the operator undid its correct toggle; the quick panel was left over JARVIS; the status-bar clock read as "new"; chained `done`s said "already on" for switches just turned on; re-typing one search counted as progress. **Chat-layer failures seen (not the operator):** with Gemini's daily quota spent the chat fell back to Groq qwen, which answered "Android 14" (16), "Home_WiFi_5G" (the real network had another name) and an invented uptime without looking, once hit "Groq 400", and read "turn on dark mode" as JARVIS's own HUD theme — the recheck guard targets the first three. Later that night a real request ("read my Chrome screen … search up what time it is") ended in the generic "couldn't fully finish it" and test turns in "I hit an error: Groq 400": the chat now answers from its tool results when it runs out of rounds, and moves to the next model after a 400. **Final smoke on the release build (22:55–23:00), each checked against the phone:** stopwatch start ✅ 10.2 s, stop + reset ✅ **6.9 s with one model call** (46.9 s before the control-bound retry), Android version + model ✅ ("16, Galaxy F15 5G"), uptime ✅ (96:23:34 = `uptime` 4 days 24 min), Wi-Fi ✅ ("Airtel_Sampat") — every phone question went to the operator. JVM tests 85 → 102, TS 280 → 285 |
| ✅ | Swiping JARVIS out of Recents no longer crashes the app (2026-09-25) | Root cause of the accessibility service switching itself off: activity destroyed → tao `std::process::exit` → onnxruntime's C++ static destructors ran under the wake-word threads → SIGABRT/SIGSEGV → `am_crash: Native crash` → Android disabled JARVIS's accessibility service ~1s later (logcat 19:51:02–04). Fix: `_exit(0)` on `RunEvent::Exit` on mobile (`lib.rs`). Reproduced with `am stack remove` before the fix (native crash), clean `am_proc_died` with no crash after, wake-word service restarted by itself |
| ✅ | Cross-app STOP overlay | Works even without the a11y service, via a `TYPE_APPLICATION_OVERLAY` fallback |
| — | Replay cache for known goals | **Removed** with the native move (2026-09-23). It had never promoted a workflow on-device, so there was nothing to port |
| ✅ | Photo/video capture proved by the media store (2026-10-19) | Live the same day, "click a photo": the viewfinder looked the same after every shutter tap, the checker rejected each one, and two tasks took 8 photos before reporting failure. `MediaSaves` now counts new MediaStore photo/video rows (no storage permission), the step line says "→ a new photo/video was saved" and the checker gets `photos_videos_saved_during_task`. JVM-tested. On the SM-E156B (debug build, Android 16, no storage permission held) a file pushed into Pictures by another process was seen at once (`media store: first new item seen this run`). **Live the same evening, "click a photo":** Camera opened without a model call, ONE `tap[12] "Take picture"`, `→ media store: 1 new item(s) saved`, checker PASS — `ok=true` in 11s |
| 🟡 | No reworded re-run of a phone task that acted and failed (2026-10-19) | Same logcat (17:06): the first task ended `ok=false error=incomplete` after 4 shutter taps, and 6 s later the chat model started a second `phone_task` with a reworded goal, which took 4 more. `runTurn`'s repeat guard only caught an identical call. Now the native result carries `acted` (any `isActuation` step in the feed; `operator_lost` counts as acted) and `runTurn` refuses any further `phone_task` that turn, telling the model to report what was done and ask the user to check first. A task that failed before acting (e.g. `open_app` failed) can still be retried; the user can always ask again next turn. Unit-tested (`loop.test.ts`); **not yet on a device** (needs a new APK for the `acted` field). Not covered: a one-step action (`send_message` → `unverified`) followed by a `phone_task` |
| ✅ | Planner / executor / verifier roles | Live 2026-09-23: plan, steps, and an independent PASS with a durable receipt. JVM-tested in `OperatorCoreTest.kt` |
| 🟡 | Native task journal (Room) + autonomy supervisor service | Task identity, checkpoints, cancellation and crash recovery moved to Kotlin. Instrumented tests exist (`AutonomyTaskDaoTest`, `AutonomyTaskMigrationTest`); a reboot/process-death recovery run on a real phone is not recorded |
| ✅ | Tasks sheet after a relaunch (2026-10-18): recovered phone tasks show their real goal, STOP ALL only for a running task, no `claim:` bullets | On the SM-E156B (d09c4eb), read over CDP: 24 phone cards all titled "Recovered phone task", each verified one with a `claim:pending-verification` bullet, and 5 PC shells stuck on "recovering…" at the bottom (the PC was off). Those shells kept STOP ALL up: the sheet had its own active-state list, which still counted "recovering". The Tasks icon itself was not lit. Causes: `task_status` didn't return the goal, and Room keeps the last checkpoint receipt (`claim:pending-verification`) after success. Fixed: `task_status` returns `goal`, the reducer prefers it over the placeholder, `claim:` receipts are no longer steps, and the sheet and App use `ACTIVE_TASK_STATES` / `TERMINAL_TASK_STATES` from `taskCenter.js`. Unit test in `taskCenter.test.ts`; the phone's 24 real `task_status` replies, run through the new reducer, gave 0 claim lines and nothing active. **On the phone (SM-E156B, 2026-10-18 ~09:45, main + the fix below):** cards read "Turn off Do Not Disturb", "Turn on Do Not Disturb", "Open Spotify and skip to the next song.", no STOP ALL, no `claim:` lines. The first build from main (0623faa) still showed "Recovered phone task": Kotlin sent `goal`, but `TaskStatusResponse` in `models.rs` had no such field and serde dropped it on the way to JS (ARCHITECTURE §5). Adding the field fixed it |

## One-step phone actions (2026-10-18)

Things Gemini does in one call that used to go through the operator (ARCHITECTURE §3).
All built and unit-tested (vitest: the `comm` approval flow, the `device_control` ↔
Kotlin branch guard, the full-key guard, code redaction; JVM: `DirectMatchTest`). Debug
APK installed over 2.3.0 on the SM-E156B 2026-10-18 (same debug signing key, data kept).
The user granted DND access, Modify system settings, notification access and Contacts
during the run. Family Link pauses most other apps on this phone after its daily limit
(Maps, Google/Samsung Messages were paused; WhatsApp, Spotify and the dialer weren't).

| | Feature | Notes |
|---|---|---|
| ✅ | Flashlight and volume steps, by chat | Live 2026-10-18 on SM-E156B. "turn on the flashlight" → `deviceAction` → camera service logged "Torch for camera id 0 turned on for client PID <JARVIS>" (JARVIS's own process, not SystemUI's tile); "turn off" 10 s from send to torch off, nearly all model latency (the native call is ~100–250 ms over CDP). "increase the volume": music stream on the Bluetooth output 1 → 2. The first try answered "OK." with no tool call (the chat history held the old build's two false "I've increased the volume"); fixed by counting a bare acknowledgement as a completion claim in `loop.ts`, after which the same request ran `deviceAction` |
| ✅ | Brightness, auto-rotate, DND on, the grant screens | Live 2026-10-18 (direct native calls over CDP, ground truth from `settings`): brightness 30% → `screen_brightness` 76 and manual mode; auto-rotate on/off → `accelerometer_rotation` 1/0; restored to auto-brightness. Without their grants, DND and brightness opened Settings' *Do Not Disturb access* / *Modify system settings* screens and said "grant, then ask again". DND on reported on, with access granted |
| 🟡 | DND off, ringer | **Android 15+ limit, confirmed live:** with targetSdk 36, `setInterruptionFilter` toggles an app-owned rule "Do Not Disturb (JARVIS)" (`dumpsys notification`: `implicit_com.jarvis.app`). Off ends only that rule, never a DND the user or a schedule turned on (the user's own DND stayed on). Off now says so (`dnd_not_ours`) and points the model at `phone_task`, which turned DND off via Quick Settings in September. Ringer changes while DND is on are refused by Android (SecurityException) and reported, never claimed |
| 🟡 | Media keys, `play_media` | **Spotify ignores `MEDIA_PLAY_FROM_SEARCH`** (opened, stayed paused) and didn't start from its session's `playFromSearch` either; next-track on its idle session did nothing. Each was reported as failed, never claimed. Found on the way: `isMusicActive` blipped true while Spotify stayed idle, so with a visible session only the player's own PLAYING counts now, and play/pause/skip go through the session's controls. Spotify by voice still works through `phone_task` (live since September). Media keys with something already playing: not yet run |
| ✅ | `navigate_to` | Live 2026-10-18 22:01, with Maps unpaused: "navigate to RFL Academy, Juhu." → `deviceAction` 22:01:01.65 → `google.navigation:` intent 01.72 → Maps in front 02.26. Earlier, with Family Link pausing Maps, the first build said "Started navigation" while Android showed "App isn't available"; every app-targeted action now checks `isPackageSuspended` first. **Found live:** the first phrasing, "can you set a route to …", got "Got it — routing you to …" with no tool call. The claim guard now covers routing/navigating and any reply that opens with an acknowledgement and asks no question |
| ✅ | WhatsApp message by contact name, user-approved | Live 2026-10-18: "send a message to papa on WhatsApp …" → Contacts permission asked on first use → lookup → approval dialog → sent. The user confirmed it arrived. Second message: link opened 21:30:12.2, Papa's chat 14.3, JARVIS back in front 15.5 (≈3 s from approval). Found: the model first asked "I'll send it now" in chat before calling the tool (double confirmation); the tool descriptions now tell it to call straight away |
| ✅ | WhatsApp voice call by contact name | Live 2026-10-18: "call papa on WhatsApp" → approval → JARVIS opened the chat, pressed **Voice call**, `VoipActivityV2` at 21:42:28.9, and the audio log shows `MODE_IN_COMMUNICATION` from 21:42:28.697 to 35.856 (the user hung up). WhatsApp's Contacts call rows (what assistants use) gave "Permission Denial" for JARVIS, so it uses the chat's call button. Only a change into call mode counts, because JARVIS's own mic sets the same mode. Retest on the final build, first try: chat 21:47:09.8 → call mode 21:47:11.664 → `VoipActivityV2` 12.2 → "Calling Papa on WhatsApp." Video call: built, not run |
| 🟡 | SMS, phone calls | Not testable here: no SIM in this phone. `SEND_SMS` carries `RESTRICTION_INSTALLER_EXEMPT` on this adb install, so it's grantable; a browser-sideloaded install may need "Allow restricted settings". Google and Samsung Messages are paused by Family Link, so the no-permission fallback would refuse as `app_suspended` |
| ✅ | `read_notifications` | Live 2026-10-18 with notification access granted: real shade (only ongoing items) → "no notifications" (correct, ongoing ones are skipped); with two adb-posted test notifications → JARVIS listed both, and the OTP one came out as "A login OTP" with no digits. Found: a repeat "can you check my notifications?" got "none" from history with no tool call; `PHONE_REF_RE` now covers notifications/messages so the recheck fires |
| ✅ | Reply through a notification (no UI) | Live 2026-10-18 21:57: with a WhatsApp notification from Papa showing, "reply back to it with a hi" → lookup 21:57:13.6 (route: notification) → approval → send 21:57:16.5. No screen changed at all (no WhatsApp activity resumed; JARVIS stayed in front), WhatsApp cleared its notifications (the acknowledgement JARVIS waits for), and the user confirmed "Hi" arrived. **Found earlier the same evening:** "reply to papa's notification …" got "I've sent the reply" with no tool call and nothing sent; the claim guard didn't know messaging verbs. `ACTIONY_RE` and `COMPLETION_CLAIM_RE` now include send/reply/call/… |
| 🟡 | Fixed: clock `show_alarms`/`show_timers`/`dismiss_timer` and calendar `remove`/`show`/`request_permission` left out required keys, so Tauri should have rejected them ("missing required key") | Every call now sends its full key set; `platform/index.test.ts` parses `commands.rs` and fails on any missing key (a mutation check reverting `showAlarms` failed it). Settings' calendar-permission toggle went through this path |

## Remote PC

| | Feature | Notes |
|---|---|---|
| ✅ | QR-only pairing to the Windows backend | Manual host/token entry is gone entirely |
| ✅ | Cross-network first, silent LAN upgrade | Confirmed 2026-07-11 on both same-Wi-Fi and cellular/Tailscale |
| ✅ | Forwarding whole tasks to the desktop autopilot | With approve/deny and clarify prompts on the phone 2026-10-19: "Open Notepad on my PC" stopped at the phone's fingerprint prompt (nobody there), and the reply said the *PC* wanted a fingerprint — a model's paraphrase of "I need your fingerprint to run that on your PC". The cancelled-fingerprint result now says where the prompt was and that nothing was sent. |
| ✅ | Live PC screen over WebRTC + touch input | Signaling rides the existing WebSocket; video is a real `RTCPeerConnection` |
| 🟡 | Requests from the paired PC (2026-10-21): "set an alarm on my phone" said at the PC, or sent to the PC on WhatsApp — also from another number allowed there (WhatsApp → PC → phone). The PC sends a host-signed `phone.command` over the existing link; `brain.askFromPc` runs it as a turn limited to `FROM_PC_TOOLS` (alarms, timers, reminders, clock, device switches, volume, media, time, weather, agenda); the turn loop refuses any other call before dispatch; the answer goes back as `phone.result` with `ok` from the tool results. Shown in chat as "💻 From your PC: …", not spoken. Settings ▸ PC & WhatsApp turns it off | Unit-tested both sides (`index.test.ts`, `loop.test.ts`, `registry.test.ts`; desktop `test_phone_link.py`). Not run between the real devices. JARVIS has to be open or recently used: a paused WebView doesn't answer, and the PC says so after 45 s |
| 🟡 | WhatsApp on the phone (2026-10-21): messages starting with "Jarvis" from contacts listed in Settings ▸ PC & WhatsApp (by saved name or number; never groups) are read off WhatsApp's notifications (`WhatsAppInbox.kt`, polled by `poll_whatsapp`) and answered through the notification's reply button (`whatsapp_reply`), as a turn limited to `FROM_WHATSAPP_TOOLS` (the PC's list plus web search, news, places, directions). "When my PC is offline" leaves them to the PC's channel while the link is up. While JARVIS is paused in the background, a "tap to run" notification stands in | `WhatsAppInboxTest.kt` (JVM) and `whatsapp.test.ts`; the new Kotlin compiled against Android 14's framework classes with androidx stubbed, and the plugin crate type-checks for aarch64-linux-android — **not built into an APK, never run on a device.** Known limit: WhatsApp never notifies the owner about their own messages, so "Message yourself" can't reach JARVIS here (a second number for JARVIS, e.g. WhatsApp Business on the phone, can). To check on a device: notification titles for saved vs unsaved senders, `MessagingStyle` person/user for WhatsApp's own replies (decides what counts as the user's message), and the reply landing in the right chat |
| 🟡 | Device-key auth (Keystore EC identity, pinned host, expiring single-use pairing challenge) | Replaces the bearer token completely. In source and unit-tested; no recorded live re-pair on a device since the change 2026-10-19: the paired SM-E156B authenticated by its device key after Tailscale came up and again after a desktop restart (`[Auth] 100.84.88.121 authenticated as phone-…` on the PC). |
| 🟡 | Task protocol v2 (stable ids, idempotency, event-cursor resubscribe) | Same — built and tested, not live-confirmed |
| 🟡 | "Turn on my PC" (`wake_pc`, 2026-10-19): Wake-on-LAN to the adapters the PC lists in its signed `auth.ready`, done only once the link is back | Unit-tested (`pc.test.ts`, fake sockets and clock; `WakeOnLanTest.kt` for the packet, also green in the Android Gradle build 2026-10-19). 2026-10-19: the first connection after the update stored the PC's adapters (`jarvis.android.pcwake.v1` = its Wi-Fi MAC and 192.168.1.4). Not yet run against a sleeping PC: needs Wake on LAN in its BIOS and network adapter, and the phone on the PC's own network **2026-10-20, SM-E156B → this laptop asleep (Modern Standby, Wi-Fi only, Intel AX201):** two tries (13:53, 13:56) sent the packet and answered `ok:false` — "I sent the PC a wake-up packet, but it didn't connect within 60 seconds… Wake-on-LAN has to be on in the PC's BIOS and in its network adapter…" — no false claim. The laptop can't be woken this way: Windows doesn't offer its Wi-Fi adapter as a wake device (`powercfg /devicequery wake_programmable` lists only the Thunderbolt controllers), so Device Manager shows no Power Management tab, though the driver has Wake on Magic Packet enabled. The reply's Device Manager advice doesn't fit such a PC (gap: the PC could say in `auth.ready` whether an adapter can wake it). A PC that can be woken: still untested |
| 🟡 | Link resilience (2026-10-05): signed `link.ping` every 20s → phone drops a half-open link after 50s silence; instant redial on app resume / network-type change; live view auto-restarts after a reconnect; drag moves coalesced (one signed move in flight) | Desktop half live-verified with a fake-phone probe over Tailscale (ping verifies, screen 14.5 fps @1280×720, same-phone screen takeover, busy-reject delivered, finished-task result replays on reconnect, resubmit replays). Phone half unit-tested only — no device 2026-10-19: with the PC's CPU pegged, the phone dropped the link at 50 s of silence and redialled; for the next 16 minutes its Tailscale dials got no answer (nothing reached the PC) while every LAN dial was refused by the Tailscale-only gate (1008, 48 times), then it reconnected by itself. A pc_task in that window would have failed; the cause was the network, not the redial logic. |
| 🟡 | Agent row (2026-10-21, `brain/agents.ts`): the chat header's robot button turns agent mode on; a sideways row picks Auto, Phone, Research, Files, Scheduler, Content — plus Desktop and Browser on the PC while one is paired. Typed or spoken requests go to the picked agent ("@files …" or "tell the research agent to …" from anywhere). Phone agents are turns with their tool groups loaded and a brief; Desktop, Browser and (with a PC) Research are a `pc_task` through dispatch — fingerprint first — with the PC running Research in a headless browser. Not saved: a restart is Auto | `agents.test.ts`, `index.test.ts`; typecheck/lint/`npm test` green. In the 2.4.0-based release APK installed on the SM-E156B 2026-10-21: the row shows and agent mode switches on and off. Agent turns weren't run on the phone |
| 🟡 | Agents talking in the chat, and research without a PC (2026-10-22, 2.5.0). Every `pc_task` puts a card in the chat: the phone asking the PC's Desktop / Browser / Research agent (or handing a picked one the request) and, for a question mid-turn, the answer it brings back with its findings — the PC now sends those (`terminalResult` keeps `findings`). With no PC paired, the Research agent reads its sources itself: `read_webpage` (group `web`) fetches a public page through the HTTP plugin and keeps its text — no headless Chrome exists on Android, and pages that only render with JavaScript come back empty; this phone's own network is never fetched | `dispatch.test.ts` (both card kinds), `http.test.ts` (text extraction, private hosts refused); the extractor was run on four real pages (Wikipedia, GSMArena, The Verge, BBC) with clean text; the chat card was rendered in the browser preview (375×812). Not run on a phone |

One environment gotcha that will waste an afternoon if you forget it: **Windows Firewall
blocks inbound 8765 on the Tailscale adapter** unless the rule is scoped for it. `start.py`
in the desktop repo auto-fixes this (`_ensure_tailscale_firewall`, scoped to
`100.64.0.0/10`). Backend changes need a desktop app restart to take effect.

## TV control

The phone drives the TV over network ADB (no JARVIS install on the TV) — `tv_control` tool,
`remote/tv.ts` → `tv_shell` → `TvAdb.kt`; see ARCHITECTURE §6a.

| | Feature | Notes |
|---|---|---|
| ✅ | Phone ↔ TV link (dadb on the phone, on-TV "Allow USB debugging?" for the phone's key) | Live 2026-09-30 on SM-E156B → KD-55X8500D: "Connected to BRAVIA_4K_2015" first try |
| ✅ | By voice: open YouTube, set volume, play Stranger Things on Netflix, pause, resume | Live 2026-09-30. Volume 20 confirmed in the TV's own audio-HAL log. Netflix: web search → id 80057281 → Netflix's page confirmed the name → it played. **Netflix resumed Season 5 on the user's own profile** (expected S1E1 in progress) — unexplained; the TV exposes no episode info. Pause/resume needed two fixes, below |
| ✅ | Fix: Netflix treats MEDIA_PLAY and MEDIA_PAUSE as one toggle | Pause twice = pause then play (measured). `playback()` now reads the session first and presses PLAY_PAUSE only when the state must change. Live-verified after |
| ✅ | Fix: "Resume" answered "Resumed — back to *Arcane*" with **no tool call** | The model made it up (wrong show too); `claimedWithoutActing` knew neither "resume" nor "resumed". Media verbs added to both lists, and the TV prompt says follow-ups are TV commands. Live-verified after |
| 🟡 | "Play X season N episode M" | `/watch/<episode id>` from the episode list in Netflix's public page (`findEpisode`, checked against the real page for S1–S5). The watch link itself is not yet confirmed on the TV |
| – | YouTube "play" = search link + OK on the top result; power and mute from the phone | Unverified from the phone (power was verified from the PC) |
| 🟡 | Several addresses for one TV (2026-10-19) — the address field takes a comma list, e.g. its home IP and its Tailscale IP; each is tried when the last couldn't be reached and the one that answered goes first next time. When nothing answers, the reply names the likely cause: two routers at home, the second in router mode, so its Wi-Fi is a different network the phone can't open connections into | Unit-tested (`tv.test.ts`, a fake shell); not yet run on the phone or with Tailscale on the TV. 2026-10-19: the TV had moved from 192.168.0.194 to 192.168.1.11 (same Wi-Fi as the phone and PC now), and both apps still held the old address. The PC's reply named the two-router cause, which was wrong this time: the TV's address had simply changed. Nothing rediscovers a TV whose IP changed; re-pairing under Remote PC & TV fixed it **Bug found the same night:** on the phone none of this could work. dadb 2.0.0 throws its own `AdbConnectException("Failed to connect to …")` around the socket error, `TvAdb.describe` judged the wrapper, and the reply became "The TV connection failed: Failed to connect to …" (seen in the action log for both addresses), which `tv.ts`'s `unreachable()` doesn't match: no second address tried, no two-router hint. `describe` now reads the cause chain (`TvAdbTest.kt`, fails without the fix). On the SM-E156B after the fix, "is the TV on?" with the TV off returned "I can't reach the TV at 192.168.1.11:5555 … If your home has two routers …": the hint is only added once `unreachable()` matches, the same test that gates Wake-on-LAN |
| ✅ | Replay tests (2026-10-19): live-observed model replies in `brain/replay/fixtures.json`, played through the real turn loop by `replay.test.ts`; `npm run test:live` asks a real model the same | The first run found a real bug — a model naming the TV app in `app` instead of `target` opened nothing (the desktop already handled it); fixed in `registry.ts`. The live mode has not been run against a real key yet |
| 🟡 | TV by sight (2026-10-19): `look` ("what's on my TV?") and `task` (a multi-step job done by looking after each remote press), ported from the desktop | Unit-tested (`tvSight.test.ts`, `TvFrameTest.kt`; the latter green in the Android Gradle build 2026-10-19) with a fake TV and model. 2026-10-19, asked "what's on my TV right now?" with the TV unreachable: the fallback model (Groq qwen3.8-27b) answered "there's nothing playing on the TV" without calling any tool (no `tv_shell`/`tv_capture` in the native log). A TV question answered with no tool call now gets the same one silent recheck as a phone question (`answeredTvWithoutLooking`, `loop.ts`), and the turn is a replay fixture. A look/task by sight not run on the phone yet; the capture path (`screencap -p` over dadb `exec:`) is the one verified from the PC on 2026-10-11, never from the phone **Live 2026-10-20, SM-E156B:** with Netflix playing, "what's on my TV?" → `tvShell`, `tvCapture`, `tvShell`, "The TV is showing Netflix, which blocks screenshots" (no guess). With YouTube playing: a correct description of the picture, the first capture from the phone (dadb `exec:`). "On YouTube, search for lofi and play the second result": 8 look-and-act rounds, ended playing a lofi video ("Mind Relax Lofi Mashup…"); that it was the second result wasn't checked. STOP mid-task (after 3 captures): no more steps, the tool returned "Stopped." 7 s later, but the model then answered "I wasn't able to complete that task on your TV. Would you like me to try again…?" — `runTurn` now ends a turn on a STOP result's own words (`loop.test.ts`, fails without it) |
| 🟡 | "Send this to the TV" (`cast`, 2026-10-19): what's playing on the phone (YouTube at the same point, Netflix resumed by the profile), a YouTube/Netflix link, or Share → JARVIS from the YouTube or Netflix app | Unit-tested (`tv.test.ts`, fake TV and phone media). Not run on a device: needs notification access; whether the TV's YouTube app honours `&t=` is unknown (the reply says when it didn't); the share target and `media_now` have only been compiled **Live 2026-10-20:** no YouTube app on the phone (Family Link), so `media_now` is still untested. Share → JARVIS (fired with `am start -a SEND`): plain text → "Shared with JARVIS: only a YouTube or Netflix link can be played on the TV." ✅; `youtu.be/…?t=120` → the TV played it at 2:00 (`position=120393`), but the reply said it "didn't take the start time": YouTube's TV app reports its position only when its state changes (902099 for 95 s while playing), so the old moving-position check could never confirm it, and the first fix counted the previous video's leftover session. Now a YouTube session counts only once it has reported since the link (`updated=`), both apps, tests fail without it. In guest mode the TV's YouTube ignored `&t=` (started at 0:02 for 44:39) and said so; signed in it took `&t=600s`. Cold start shows YouTube's "Who's watching?" picker, which swallows the link (reply: couldn't confirm it started — honest; Netflix's gate has an auto-OK, YouTube's doesn't) **Later the same day:** with the TV in standby (its normal "off": Remote start keeps ADB up), a shared link opened YouTube on a dark screen and the model then pressed OK itself, saying it "should start the video" (the user saw the TV still off). Neither app switched a reachable-but-asleep TV on before `play`/`open_app`/`cast`, only an unreachable one (Wake-on-LAN). Now `screenOn()` wakes it first (both apps; tests fail without it). Live after the fix: the TV woke, but YouTube showed its "Who's watching?" picker, which swallowed the link (`uiautomator` sees nothing in YouTube's TV app, so the picker can't be detected over ADB) — the reply was honest ("couldn't confirm it started playing"). Open: what to do at that picker **Picker, the user's choice (2026-10-20): pick the highlighted account**, as Netflix's gate does. Since it can't be seen, `cast`/`youtubePlay` treat a just-woken TV or a cold YouTube as likely gated: if nothing started after a few seconds, one OK (the highlighted, last-used account) and the link (or search) again (`tv.test.ts`, desktop `test_now_playing.py`, fail without it). **Live 14:34–14:39:** TV put to standby, `youtu.be/…?t=120` shared from the phone → the TV woke and played it from 2:00 (`position=121805`), "Playing it on YouTube on the TV from 2:00." (~90 s end to end; the user saw it play); from the PC, TV in standby, "play lofi on the TV" → woke, "Playing the top YouTube result for “lofi” on the TV." (29 s), TV playing "lofi hip hop radio" |
| 🟡 | Switching the TV on from off (Wake-on-LAN, 2026-10-19): the TV's MAC is learned over ADB the first time it answers; `power_on` / `play` / `open_app` on an unreachable TV send it a magic packet and carry on once ADB answers | Unit-tested (`tv.test.ts`, `WakeOnLanTest.kt`, green in the Android Gradle build 2026-10-19). **MAC learned on the phone 2026-10-19:** re-pairing the TV stored `a8:6b:ad:14:ff:2d`, the TV's wlan0 (it is on Wi-Fi, not Ethernet, so waking it depends on the TV's Wi-Fi Remote start). Not yet run from deep standby: needs Settings → Network → Remote start on and the TV off ~15 minutes Until the `TvAdb.describe` fix the same night, a switched-off TV never got the packet from the phone: `wakeTv` only sends when the probe reads as unreachable, and dadb's wrapper text didn't (see the several-addresses row) **2026-10-20:** with Remote start on, this TV never went fully off: switched off 12:50, at 13:05 it still answered ping and ADB, so "turn on the TV" took the ADB power path — from the PC ("Turned the TV on.", 6 s) and from the phone ("Turned the TV on.", `mWakefulness=Awake`). A magic packet in that state does nothing (Android is still running): the phone's `wol_send`, the PC's `wol.send` and a unicast packet each left the sender ("Sent a wake-up packet to a8:6b:ad:14:ff:2d") and the TV stayed Asleep. Waking from a TV that's really unreachable is still untested; it may take hours in standby, or never happen with Remote start on. The failed-wake reply no longer tells the user to turn on Remote start as if it must be off (the PC lost the TV three times while it was on): it names both causes |
| ✅ | Fix: Netflix changed its public title page (seen 2026-10-11) | `<title>` is now just "Netflix" and seasons are nested and unlabelled, so the name check and `findEpisode` found nothing. `titleNameIn` / `findEpisodeNested` read the new shape (old one kept as fallback); checked live against netflix.com (Stranger Things S1E1/S5E8, Dark S3E8, Red Notice). Not yet run on the phone |

Spike run 2026-09-30 from the PC's `adb` against the user's **Sony KD-55X8500D, Android TV
8.0** (`BRAVIA_4K_2015` platform), USB debugging on, TV at a LAN IP on the same Wi-Fi.

| | Check | Result |
|---|---|---|
| ✅ | `adb connect <tv>:5555` | Works after the one-time on-TV RSA prompt. **Phone must be on the TV's Wi-Fi** — a PC on a different subnet timed out |
| ✅ | Launch an app (`monkey -p <pkg> -c …LEANBACK_LAUNCHER 1`) + readback | `dumpsys window` `mCurrentFocus` names the app — honest proof. Netflix, YouTube, Prime, Hotstar all launched |
| ✅ | Volume keys + readback | `media volume --stream 3 --get` → exact level (90→91→90) |
| ✅ | Power | `KEYCODE_SLEEP` / `KEYCODE_WAKEUP`, `dumpsys power` `mWakefulness` reads Asleep/Awake; ADB survived a short standby (hours-long standby untested) |
| ✅ | YouTube search link (`VIEW https://www.youtube.com/results?search_query=…`) | User saw the results; no programmatic readback (YouTube's UI is opaque) |
| ✅ | **Screenshots** (re-tested 2026-10-11; the 2026-09-30 "black on every screen, even the launcher" did not reproduce) | `screencap -p` gives a real 1920×1080 image of the launcher and Settings. It returns **nothing** (exit 0, empty output; logcat `SurfaceFlinger: FB is protected: PERMISSION_DENIED`) while any secure surface is on screen — and Netflix marks **both** its video and its own UI surface secure (`flags=0x80`), so nothing inside Netflix can be captured, menus included. That is DRM working as designed; don't work around it. `screenrecord --output-format=frames --size 960x540 --time-limit 3 -` also works (one frame in ~1.5 s, nothing written on the TV): each frame is a 20-byte header (u32 LE: length-after-this-field, width, height, bytes per row, format 3 = RGB888) then top-down RGB rows. It renders secure layers black instead of refusing the whole frame (not yet seen on a screen that mixes the two) |
| 🟡 | UI tree (`uiautomator dump`) | Readable: launcher, Google TV search results, Hotstar. **Opaque (one empty frame): Netflix, YouTube, Prime** |
| ✅ | **Netflix title links** | Need the extra `-e source 30` — without it Netflix ignores the link (warm) or drops it at the profile gate (cold). Working form: `am start -a android.intent.action.VIEW -d 'https://www.netflix.com/title/<id>' -f 0x30000000 -e source 30 -n com.netflix.ninja/.MainActivity`. Warm: opens the title and autoplays. Cold: "Who's watching?" first; one `KEYCODE_DPAD_CENTER` picks the highlighted (last-used) profile and the link *continues* to the title and plays. Netflix 8.3.11 also declares `/watch*`, `/browse`, `/deeplink*` and `nflx://www.netflix.com/…` (untested) |
| ✅ | Netflix playback readback | `dumpsys media_session` for `com.netflix.ninja`: real playback = `state=3` **with `position` advancing**; paused = `state=2`, position frozen. Also `dumpsys audio` shows its AudioTrack `started`/`paused`. **Trap:** at the profile gate it reports `state=3, position=0` (not advancing) — never treat state alone as proof. No title metadata (`metadata:size=0`) |
| ✅ | Pause / play keys in Netflix | `KEYCODE_MEDIA_PAUSE` / `KEYCODE_MEDIA_PLAY` — verified by the readback above |
| ℹ️ | "Activity not started, its current task has been brought to the front" | Printed by `am start` on Android 8 even when the intent *was* delivered to the running activity via `onNewIntent` — not a failure signal |
| 🟡 | Google TV search (`GLOBAL_SEARCH --es query …`) | Opens a readable results page (show card + YouTube clips); not needed now that Netflix links work |
| – | `input text` | Not tested |

## Security

See [SECURITY.md](SECURITY.md) for the full findings and current fix status. Summary:
the Critical and High findings from the 2026-07-17 audit have since been addressed —
including the two that were deferred at the time (secrets → Android Keystore, and the
bearer token → device-key identity). The remaining items are Medium/Low design choices.

## Packaging

| | Item | Notes |
|---|---|---|
| ✅ | Debug + release APK build | `tauri android build [--debug] --apk --target aarch64`. Both built 2026-09-25; the release APK (33 MB vs 346 MB debug, debug-key signed, not debuggable) installed over the debug app on the SM-E156B, booted clean, wake word listening, accessibility service kept. **2.3.0 release (2026-10-18, 33.8 MB, debug-key signed):** installed over the debug build with keys, routines and the accessibility service kept; the 19:21 routine alarm was re-armed; the home screen, Status panel, Routines card and the fixed Weather card rendered; a chat turn answered ("144"); a phone task ran through the native operator and was verified ("Android 16", matches `getprop`). **Trap:** the first build crashed on launch with `NoSuchMethodError: MainActivity.getPluginManager()` — it was built in a git worktree, which lacked the generated, gitignored `app/proguard-tauri.pro` (Tauri's keep rule for that JNI-only method), so R8 stripped it. Debug builds don't shrink, so they never show this. Build releases where `proguard-tauri.pro` exists, or copy it in |
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
  that notice had been dead whenever the preferred route was benched. **Update
  2026-10-24:** the user requested these recurring notices be removed; fallback now
  stays in diagnostic logs, verified under two actual fallback events.
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

0. **Before publishing:** choose a LICENSE, enable GitHub's private vulnerability
   reporting (README points to it), then publish the single-commit snapshot.
0a. **Finish the smart-routing check on the device.** Phone-side Gemini Omni is marked
   non-chat and chat turns are live-verified (2026-09-25); still to do: add the same
   `^gemini-omni` row to the desktop's `llm/model_catalog.py`, open Settings ▸
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
   recheck round target the first three (on the final build all three kinds of question went
   to the operator and came back right); watch whether that holds on the weakest routes. The
   operator itself was right whenever it was reached. 2026-09-27: the recheck now also fires
   without the words "on my phone", and the prompt carries today's date (both live-verified
   with the chat on the fallback).
0e. **Phones without a setting.** This M15 has no screen-resolution setting and no Settings
   entry for auto-rotate. The operator now fails honestly (86.6 s) instead of looping, but
   the right end is faster: a lookup that the app's search and the obvious section both
   miss could stop after the first pass.
0f. **The wake check with the user's own voice** (2026-09-27: live with laptop TTS only —
   16/16 genuine, 7/7 conversation lines about Jarvis ignored). Watch logcat `JarvisWW`
   scores and `[wake]` lines over a day of real use. The command is now captured natively
   (2026-10-11) — re-run "Hey Jarvis, what is five plus five?" in one breath (live
   2026-09-27 it arrived as "That's five.").
0g. **Run a Re-rank on the phone** with a free Gemini key: the grounded estimate now uses
   the 2.5 pair and has never succeeded before (web search itself is live-verified).
1b. **Re-test the rest of the 2026-09-22 fixes on a device.** Still unexercised: the remote
   STOP button, a long spoken reply, and adding then deleting a calendar-mirrored agenda
   item.
1. **A live device pass over the auth + autonomy rework.** Re-pair with a PC from scratch
   on the new device-key path, run a phone task through the Room journal, then force-kill
   the app mid-task and confirm it comes back *suspended* rather than repeating the last
   action. This is the biggest untested surface in the app.
2. **Wake-word soak test.** Long session, real voice, app backgrounded.
3. **A real release keystore**, then a signed APK installed on a clean phone with the
   permissions checked one by one.
4. **Icons and splash.**
5. **A config relaunch killed the app — fixed on the emulator, not yet on a phone.** Tao
   ends the process when `MainActivity` is destroyed, so every config change missing from
   `configChanges` relaunched the activity and killed JARVIS ("exited cleanly (0)" right
   after `wm_on_destroy_called`). Reproduced 2026-10-17 on the emulator with JARVIS open:
   a font-style overlay (`cmd overlay enable com.android.theme.font.notoserifsource`,
   config `0x80000000` = assets paths — the same thing that hit the first boot) and a font
   size change (`settings put system font_scale 1.15`, `0x40000000`). In the background
   nothing happens until JARVIS is reopened, then the process dies and cold-starts. On a
   phone the same overlay change comes from switching font style, theme colours or
   navigation mode. Fix: the manifest now lists every flag, including `assetsPaths` (public
   since compileSdk 36). The same build survived all of these, foreground and background,
   with one pid and the HUD still drawn; a swipe out of Recents still exits cleanly (0),
   though the wake word wasn't running there, so that run couldn't hit the onnxruntime
   abort. A WebView update is a different case: the system SIGKILLs every app using
   WebView (`stop com.google.android.webview due to installPackageLI`), and the app can't
   prevent that. Still to do: change the font size once on the phone with JARVIS open.
6. **A message typed while JARVIS was still busy was lost — fixed, verified on the phone.**
   `sendMessage` returns early on `busyRef` (which stays set through the spoken reply), but
   the chat input cleared anyway: its `busy` flag missed "speaking" and Enter ignored it
   (2026-10-17, typed while the reply to a routine was still being spoken). Now speaking
   counts as busy, so Stop replaces Send and Enter leaves the text in the box. Browser
   preview: text typed mid-speech stayed, and Enter sent it once JARVIS was idle. Phone
   2026-10-18 (4cdb429): Enter during the spoken "56" reply kept "and what is nine times
   nine?" in the box with Stop showing and no new turn; Enter after it went idle sent it
   ("81").

---

## Where the history went

The original planning document and the phase-by-phase build log live in
[archive/](archive/) — `ANDROID_PLAN.md` (the June 2026 engineering plan) and
`NEXT-STEPS.md` (the Phase 0–4 log). They are kept for context and are **not** maintained;
where they disagree with this file or [ARCHITECTURE.md](ARCHITECTURE.md), those two win.
