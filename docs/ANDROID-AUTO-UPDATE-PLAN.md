# Android automatic updates — implementation plan

Status: implemented in source for 2.5.6-rc.2, 6 November 2026. Native/plugin and web checks are recorded below; a signed in-place upgrade on a physical device remains a release acceptance requirement.

## Intended experience

JARVIS automatically discovers releases and presents a dedicated update popup with the supplied release highlights. Replace the update message in the orange/yellow warning banner. Keep actual runtime warnings in their existing UI.

Use the current GitHub APK distribution channel. Automatic checks are enabled by default; downloading starts when the user taps **Download update**. Offer **Automatically download on Wi-Fi** as an opt-in setting. Installation is a separate, explicit action through Android's system installer. This design deliberately requests user confirmation, including on devices with APIs that can support unattended self-updates under additional conditions.

The first release containing this updater still needs to be installed through the existing release-page flow. Subsequent releases use the new flow.

## Current code and reuse

- `jarvis-studio-gui/src/brain/platform/update.ts` checks GitHub at most once per day. It returns only a version and release-page URL, supports stable/beta, and currently treats a failed request as checked for the day.
- `jarvis-studio-gui/src/hooks/useBrain.js` sends the result to `pushWarning`, with a **Get it** button opening the browser.
- `jarvis-studio-gui/src/App.jsx` renders that message in `hud-warns`.
- `jarvis-studio-gui/src/components/Settings.jsx` already exposes **Include beta updates**.
- The Kotlin phone plugin already has WorkManager, notification handling and activity callbacks. The app targets SDK 36 and supports API 24+.
- `.github/workflows/release.yml` builds signed arm64 APKs and publishes GitHub releases. It currently generates GitHub release notes, without a structured feature list.
- Gradle takes `versionCode` from generated Tauri properties. The source version is currently a release candidate; the local generated properties inspected are from an older build. Read installed package information at runtime and inspect the actual built APK in CI rather than trusting stale generated files.

## Popup specification

Create `UpdateDialog.jsx` with dedicated styles and a `useAppUpdate` controller. Render the modal at the app root alongside the other dialogs, outside the scaled HUD.

- Centered, rounded dialog; dimmed backdrop; neutral theme-aware surface; cyan/blue accent, download icon and readable headings. No amber warning icon or warning-banner styling. Match Modern and Iron Man modes without turning the release notice into an error.
- Heading **A new JARVIS update is available**.
- Show the release version, current version, download size and beta label when applicable.
- Show **X new features**, calculated from the release's `features` array. Each feature has a short title and optional one-sentence description supplied by the release author. Use singular wording for one feature. For zero features, say **Improvements and fixes**.
- Present fixes separately. Show the first four highlights, with **See all changes** expanding the remaining release content inside the dialog. Render plain text, not arbitrary remote HTML.
- Primary action **Download update** becomes progress with bytes/percentage, then **Install update** when verification succeeds.
- Secondary action **Remind me tomorrow**; lower-emphasis **Skip this version**. Close, Back and Escape also snooze for 24 hours. Settings can reopen a skipped or snoozed release.
- Progress can be dismissed without cancelling the download; offer an explicit cancel action. Errors remain in this dialog with a specific explanation and retry action.
- Use accessible dialog semantics, focus trapping/restoration, screen-reader labels, large touch targets, reduced-motion support, safe-area spacing and a scrollable changelog with reachable actions.

Do not show the dialog over onboarding, a permission/approval dialog, an active voice turn, or an active phone task. Queue it until the app is foregrounded and idle. Never start installation while a task is active; explain that the task must finish first.

## Release metadata and publication

Add a checked-in, author-maintained `docs/releases/<version>.json` containing the release title, feature list and fixes. Keep Markdown notes for the full release page. A build script combines the authored content with verified APK metadata to produce an `android-update.json` release asset.

The manifest contains:

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Supported metadata schema |
| `versionName`, `versionCode`, `channel` | Display version, Android install ordering and stable/beta channel |
| `packageId`, `minSdk`, `publishedAt` | App identity, OS compatibility and release date |
| `title`, `features[]`, `fixes[]` | Explicit release content; stable IDs, titles and optional descriptions |
| `assets[]` | ABI, release asset URL, byte size and SHA-256 for each signed APK |

Do not scrape commit messages to invent user-facing features, and do not hardcode a feature count. Initially publish arm64; the schema supports additional ABIs later. A device without a compatible asset gets an explanation in Settings instead of an unusable download.

Keep GitHub Releases as discovery and hosting; no separate server is needed initially. Stable checks use the latest stable release, beta checks consider stable and prerelease candidates. For each candidate, fetch its manifest asset and validate it against the release and APK. Drafts and releases without a compatible signed APK are not installable candidates. A legacy release without metadata can offer **View release** with no invented highlights or automatic install action.

Set an explicit, monotonically increasing `bundle.android.versionCode` in Tauri configuration. Verify the first value exceeds all previously distributed APK codes. Allocate a new code for each RC, beta and stable build that is published. CI must verify tag/config agreement, manifest schema, package identity, APK version/ABI, signing identity, size and checksum before publishing. Build and validate all assets first, upload to a draft release, then publish the complete release. Preserve existing foundation-promotion gates.

Tauri's default version-code formula uses major, minor and patch, so explicit codes avoid collisions between RC builds with the same base version. See [Tauri Android configuration](https://v2.tauri.app/reference/config/#androidconfig).

## Native updater and shared state

Implement an `AppUpdateManager.kt` plus focused metadata, download and installer helpers in the existing phone plugin. Native code owns the persistent state so foreground checks and background work cannot show duplicate notifications or start duplicate downloads. TypeScript becomes a typed adapter and presentation layer.

Expose commands for status, checking, downloading, cancellation, installation, snoozing, skipping and preferences, plus an update-status event. Register them through the existing Kotlin/Rust command and permission layers. Commands accept a known release identifier, never an arbitrary APK URL or filesystem path.

Persistent state includes channel, last successful check, retry deadline, cached release, snooze/skip version, last notified version, transfer ID, verified file and installer session. Serialize competing checks/downloads and re-read current state on app resume. Ignore stale asynchronous results after channel changes.

States: `idle → checking → available → downloading → verifying → ready → awaiting_permission / awaiting_confirmation → installing`. Record cancellation and recoverable failures separately. Only report success after checking the installed package version or receiving and reconciling the system result.

Checks run on launch/resume when the last successful check is older than six hours. A unique, network-constrained periodic WorkManager task requests checks on approximately the same cadence while the app is closed. Respect HTTP caching, rate-limit headers and exponential backoff; a failed request must not suppress checks for an entire day. **Check now** bypasses the normal interval while still respecting server backoff.

WorkManager execution is inexact and can be delayed by Android's battery/background restrictions. Do not promise immediate push delivery. See [Android periodic work](https://developer.android.com/develop/background-work/background-tasks/persistent/getting-started/define-work).

When a release is found in the foreground, show the queued popup. In the background, post one notification per release on a dedicated **App updates** channel: **JARVIS <version> is available — X new features**. Tapping it opens the same popup, including from a cold start. Reuse the existing notification permission flow; if permission is denied, retain the release and show it on the next app opening. Do not launch a cross-app popup. Android 13+ notifications require permission; see [Android notification permission](https://developer.android.com/develop/ui/compose/notifications/notification-permission).

## Download, verification and installation

Use Android DownloadManager for HTTPS APK transfers to the app-specific external files update directory, with persisted IDs, progress reporting, network retry and explicit cancellation. This avoids buffering APKs in the WebView and supports continuing while the app is backgrounded. Require Wi-Fi for opted-in automatic downloads. Clean up cancelled, stale and superseded files and completed installer sessions; retain a verified current file after installer cancellation so the user can retry without redownloading.

Validate the initial download source against the fixed repository and release assets; permit only required HTTPS GitHub asset redirects. After downloading, verify size, SHA-256, APK package ID, version code, OS/ABI compatibility and signing identity against the installed app. Reject mismatches and downgrades. Android's package installer performs final cryptographic signature enforcement. Do not treat a checksum alone as publisher authentication. Plan explicit signing-key migration separately if key rotation is ever needed.

Add `REQUEST_INSTALL_PACKAGES`. On Android 8+, check `canRequestPackageInstalls()` only when installation is requested. If necessary, explain and open **Allow from this source** for JARVIS, then resume on return. Android 7 uses its older unknown-sources settings path. Denial leaves the app usable and the verified download available.

Stream the verified APK into a PackageInstaller session. Explicitly request user action on API 31+, handle `STATUS_PENDING_USER_ACTION`, and persist installer results. Launch the confirmation only from a resumed foreground activity. If the app backgrounds, use a tap-to-continue notification. Handle cancellation, insufficient storage, incompatible/signature-conflicting packages and system verification failures with distinct messages. Never use the accessibility operator to click installation controls. See [PackageInstaller](https://developer.android.com/reference/android/content/pm/PackageInstaller).

An in-place, correctly signed update is intended to preserve chats, keys, settings, pairings and app permissions. Verify this on-device; do not suggest uninstalling to resolve a signing mismatch. On the first launch after an upgrade, clear the old update notification/state, remove its download and optionally show a dismissible **Updated to <version>** recap. Do not claim the app can always reopen itself automatically after replacement.

## Settings and rollout

Extend the current Updates group with installed version/build, **Check now**, last successful check, available/downloaded update, automatic-check preference, optional Wi-Fi downloads and the existing beta toggle. Opting out of beta does not downgrade an installed beta; wait for a newer eligible stable release.

Implement in this order:

1. Define and validate release metadata and explicit Android build numbers; update the publishing workflow.
2. Build the native metadata/state service and bridge; replace the old warning effect with the popup and Settings integration.
3. Add persistent APK downloads, verification and user-confirmed installation.
4. Add background checks, deduplicated notifications, reminders, optional Wi-Fi downloads and post-update cleanup.
5. Test two signed internal builds, then ship the initial updater through the existing release link. Publish the next internal release with supplied feature notes and exercise the complete flow before wider release.

## Acceptance checks

- Pure/native tests: malformed manifests, stable/beta selection, monotonic codes, unsupported devices, HTTP failures/backoff, duplicate checks, snooze/skip state and recovery after process death.
- UI tests: actual feature count and zero-feature wording, expansion, Back/Escape/focus behavior, busy-task deferral, notification navigation, progress, retry and installer cancellation.
- Security cases: wrong package, altered APK, checksum mismatch, wrong signing certificate, lower version code and disallowed URLs must never reach a successful install.
- Device checks: an actual installed build upgrades to a second APK with the same signing key; data/keys/pairings remain usable. Exercise Android 7 compatibility, Android 8 source permission, Android 13+ notification denial, and the current Android 16 target on available emulators/devices.
- Recovery cases: network loss, app backgrounding, process death, reboot, low storage, revoked install permission, notification denial and a superseded release during download.
- Run the repo's typecheck, lint, TypeScript tests, protocol/release-gate checks, native unit tests and a signed release APK build. Inspect the popup on narrow screens in both themes and with larger text. Record on-device results before calling the install path verified.

Completion means the older updater-enabled build discovers a newer signed release, displays its supplied feature list in the dedicated popup, downloads and verifies the APK, hands off to Android confirmation, and upgrades in place without a browser download or data loss.

## Implementation notes

- Native implementation: `AppUpdates.kt` and `UpdateManifest.kt`; one typed Rust/Kotlin command bridge and an `app-update` change event.
- React implementation: `useAppUpdate`, `UpdateDialog` and `UpdateSettings`. The old `useBrain` warning-banner effect is removed.
- Notification denial retains foreground discovery. Android source permission returns to a verified download with an explicit **Install update** action; the user taps again after changing settings.
- Installation uses PackageInstaller sessions. Completed downloads stay available after cancellation; status reconciles abandoned sessions and installed versions after process restart.
- Release publishing uses authored JSON notes, actual APK inspection, checksums, increasing build codes and a complete draft before publication.
- The optional post-install recap is stored in native status for future presentation; it is not shown as a second popup.
- Physical-device installation, cross-version data retention and notification behavior under OEM background limits still require the signed two-build acceptance run. No production release is published by this source change.

Validation: 762 web tests passed (9 live-provider tests skipped), 170 native tests passed, 10 protocol fixtures, 3 release-gate regressions and 5 release-metadata tests passed. Typecheck, lint, web production build, APK packaging and actual signed-fixture metadata generation passed. See [validation and remaining device acceptance](ANDROID-AUTO-UPDATE-VALIDATION.md).
