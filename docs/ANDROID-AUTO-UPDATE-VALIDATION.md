# Android updater validation — 6 November 2026

Source version: **2.5.6-rc.2**, Android build **2005007**, package **com.jarvis.app**.

## Passed

- TypeScript typecheck and ESLint.
- Full Vitest suite: **762 passed, 9 live-provider tests skipped**.
- Updater component/controller cases include authored feature counts, expanding changes, fix-only releases, task deferral, snoozing during a pending native write, manual checks and download/install controls.
- Native release unit tests: **170 passed, zero failures**. Update policy cases reject altered checksums, incorrect sizes, signing-key mismatches, wrong packages, downgrades, version mismatches, unsupported OS versions and disallowed release URLs.
- Shared protocol: **10 golden fixtures passed**.
- Existing release gate regressions: **3 passed**.
- New release metadata/build-order/signing-anchor tests: **5 passed**.
- Web production build and complete arm64 Android release APK build.
- APK inspection confirmed package ID, version, build number, `REQUEST_INSTALL_PACKAGES`, the internal update activity and both update receivers.
- Actual metadata generation verified a temporary APK signed with the standard local Android debug key. The tool inspected its package/version/ABI, verified its APK signature and generated the real checksum, size and three authored features. The QA APK and metadata were deleted. This does not establish compatibility with the production signing key.

## Release acceptance still required

The release candidate was built with `JARVIS_UNSIGNED_RELEASE=1`, then signed with the existing local Android key after its public certificate was checked against the published app. The certificate matches `99b9ab96b6577a01567aade7e08525cb1f2e888c822672c76ecfb85d09631370`. The final APK passes v2/v3 signature verification, is non-debuggable and has Android backups disabled.

Signed artifact: `JARVIS-v2.5.6-rc.2-arm64.apk` at the repository root, 52,553,648 bytes (50.1 MiB), build 2005007. SHA-256: `32d9b4b38ff095a1ff7f95190ced717a666138e67a5cc2e314062d3d2929d8f5`. Update metadata and `SHA256SUMS.txt` are in `jarvis-studio-gui/src-tauri/gen/android/app/build/outputs/apk/universal/release/`.

Run a signed two-build upgrade on a physical device to verify source-permission settings, notification taps, OEM background restrictions, installer cancellation, process/reboot recovery and retention of chats, credentials, settings and pairings. Include Android 7/8 compatibility and notification denial on Android 13+ using available devices/emulators.

The browser preview could not connect to the local preview server, so visual inspection at narrow widths, large text and both app themes remains part of device acceptance. Component tests validate content and controls but do not replace layout inspection.

No release was published, no APK was installed on the user's phone, and the foundation-promotion gate remains unchanged.

## Reproduce

From `jarvis-studio-gui`:

```powershell
npm run typecheck
npm run lint
npm test
npm run test:contracts
npm run test:release-gate
node --test ../scripts/build-android-update.test.mjs
npx tauri android build --apk --target aarch64
```

Set `JAVA_HOME`, `ANDROID_HOME` and `NDK_HOME` for the installed toolchain. For an unsigned local release candidate, set `JARVIS_UNSIGNED_RELEASE=1`; production CI requires the existing signing key.

From `jarvis-studio-gui/src-tauri/gen/android`:

```powershell
./gradlew.bat :tauri-plugin-phone:testReleaseUnitTest --console=plain
```

From the repository root, after signing the final APK:

```powershell
node scripts/build-android-update.mjs <signed-apk-path> android-update.json
```

The publish workflow additionally verifies that the signing certificate matches a previously published APK and checks historical Android build codes before uploading the APK and manifest to a draft release and publishing all assets together.
