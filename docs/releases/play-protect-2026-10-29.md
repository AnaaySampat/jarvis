# JARVIS Play Protect review packet — 2026-10-29

The reported device is a **Vivo T3x 5G**. The reported warning is **“App blocked
to protect your device”**. The reporter's Android/Funtouch OS version, country,
download source, and exact APK hash on the reporting device are not yet recorded.
The user supplied the reason text on 2026-10-29:

> This app can request access to sensitive data. It can increase the risk of
> identity theft or financial fraud.

This matches Google's documented sensitive-permission internet-install block.
The user has not specified whether this observation was a new post-appeal test
or the original complaint; it does not establish an appeal decision.

## Submission status

On **2026-10-29**, the developer confirmed completing the submission using the
correct APK hash. The [APK's VirusTotal report](https://www.virustotal.com/gui/file/48ad34e6f004caca3031eded9c777c1d5ec91903147b3020c1e960d9927f9223)
was inspected in the browser and shows **0/55 detections**, filename
**`JARVIS-v2.5.0-arm64.apk`**, and displayed size **32.68 MB** (34.27 decimal MB
locally). Its hash matches the packaged APK. At inspection the report displayed
its last analysis as **“2 days ago”**; a new analysis was not requested.

The correct hash used for the submission is user-confirmed; the private Google
appeal itself has not been inspected. No Google review decision or successful
Vivo installation has been reported. VirusTotal's result is not Play Protect
approval or proof that all security risks are absent.

The [earlier supplied report](https://www.virustotal.com/gui/file/d0a5da89dd23000c4b27e8e610a4d0ab0164e48fa96e103c4c75f816717e561b)
covered `JARVIS-v2.5.0-arm64.apk.sha256`, a 91-byte checksum text file, and showed
0/61 detections. It is retained here as submission history, not as the app scan.

## What this build changes

This is a verified, full-featured **2.5.0 arm64 release build**, not a Play Protect
approval. No application permissions or features were removed. The existing
package name and signing identity are preserved for update compatibility with
the previously built APK. There is no code change intended to make Google's
classification disappear.

The current-source build succeeded. Gradle reused the unchanged APK; its embedded
application library matches the newly compiled library byte for byte. Rebuilding
has not produced a different binary or changed its Play Protect classification.

Google documents this warning for internet-downloaded applications that declare
Accessibility or notification-listener access in affected markets. JARVIS
declares both, which is a likely explanation for the report; it has not been
confirmed on the reporter's phone. Declaring the services can trigger the
protection even before a user enables them. Signing, minifying, or rebuilding
does not establish approval.

Sources:

- [Google's warning-specific developer guidance](https://developers.google.com/android/play-protect/warning-dev-guidance)
- [Google's app-verification guidance](https://support.google.com/googleplay/android-developer/answer/2992033?hl=en)
- [Play Protect appeal form](https://support.google.com/googleplay/android-developer/contact/protectappeals)

## Release files and identity

The distributable is `dist/android/JARVIS-v2.5.0-arm64.apk` in the repository root.
Its adjacent `.sha256` file records the **APK file hash**, and
`release-verification.json` records the package, version, certificate, and local
verification results. The APK hash and signing-certificate hash are different
values: the appeal form asks for the APK hash.

**APK file SHA-256 (the appeal form value):**

```text
48ad34e6f004caca3031eded9c777c1d5ec91903147b3020c1e960d9927f9223
```

The previous local release is signed with `CN=Android Debug, O=Android, C=US`.
The build deliberately retains that key instead of silently replacing it.
Certificate SHA-256:

```text
99b9ab96b6577a01567aade7e08525cb1f2e888c822672c76ecfb85d09631370
```

A release build type and a production signing certificate are separate things.
This is an optimized, non-debuggable release APK carrying the existing
development certificate, not a newly provisioned production identity. It is
intended for the existing sideload distribution. Moving to a dedicated production
key needs a separate signing/update migration plan; do not discard or replace
the existing key or tell existing users to uninstall and lose their data.

## Local verification

- APK size: **34,269,137 bytes** (34.27 MB).
- Package: `com.jarvis.app`; version `2.5.0`; version code `2005000`.
- Android minimum API 24; target API 36; native ABI `arm64-v8a` only.
- APK v2 signature verified; certificate matches the previous local release.
- Non-debuggable release; APK ZIP alignment passed with the 16 KiB page option.
  This alignment check does not establish that every dependency supports a
  device with 16 KiB memory pages.
- Embedded application-library SHA-256 matches the newly compiled Rust output.
- Accessibility and notification-listener services are present. `READ_SMS` and
  `RECEIVE_SMS` are absent.
- Typecheck and lint passed. **522 tests passed; 9 skipped.**
- No Vivo installation or Play Protect acceptance test was performed.
- The correct APK's VirusTotal report was verified at **0/55 detections**.
  Google appeal submission with that hash is user-confirmed; its decision is
  not yet verified. This task has not published a release.

## Steps for the developer

1. Ask the reporter for the entire warning (a screenshot is useful), their
   Android/Funtouch OS version, country, the original download URL, and the APK
   they downloaded or its SHA-256. Confirm the dialog is from Google Play Protect.
2. Review the actual permission uses and data disclosures below alongside
   [the current security notes](../SECURITY.md). This packet is not a compliance
   certification or a complete security audit.
3. Google's appeal form currently asks for the SHA-256 of the APK uploaded to
   **VirusTotal**. Upload the exact APK intended for review using the developer's
   account, then confirm VirusTotal's hash matches the local `.sha256` file.
   Treat the uploaded binary as shared with a third-party scanning service.
   This step is now complete: the correct APK's report was inspected and its
   hash matches this packet. The earlier `.apk.sha256` report was for text only.
4. Open the [appeal form](https://support.google.com/googleplay/android-developer/contact/protectappeals).
   Enter the developer's email/name, package **`com.jarvis.app`**, and the **APK
   SHA-256**. Adapt the draft below to the specific APK and verified report.
   Do not claim Google approval, disability-assistance status, or a confirmed
   false positive that has not been established.
5. After Google reviews the classification, have the reporter download the
   exact reviewed APK through the original distribution route and test it with
   Play Protect enabled. Record the APK hash and result. A local signature check,
   ADB install, or emulator launch cannot establish that this installation block
   has been resolved. Google controls the review outcome and timing.

## Permission and data-use explanation

| Capability | Actual purpose and limits |
|---|---|
| Accessibility service | Reads the screen and performs taps, typing, scrolling, and gestures for user-requested phone tasks. The user enables it in Android Settings. The native operator has task risk checks and Pause/Stop controls; known limits remain documented in `docs/SECURITY.md`. The service is not declared `isAccessibilityTool=true`. |
| Notification listener | Supports notification reads and replies, explicitly enabled WhatsApp commands from listed contacts, and cancellation of a single identified Clock timer through its own action. Enabled separately in Android Settings. Plain local notification reads return verification-code-redacted text directly; filtered or compound requests can use a model. |
| Microphone and microphone foreground service | Push-to-talk, voice input, and optional background wake-word listening, with a foreground notification when active. Speech transcription uses the configured cloud provider; wake verification can send a short recording around the wake phrase. |
| Camera | User-initiated QR scanning for PC pairing. |
| Contacts, SMS, calls | Contact resolution and requested messaging/calling. Sending and calling use confirmation in the dispatcher. These are not `READ_SMS` or `RECEIVE_SMS` permissions. |
| Calendar, alarms, notifications, boot | User-requested agenda, reminders, and routines. |
| Overlay and device settings | Visible cross-app Stop controls and requested brightness, rotation, or Do Not Disturb changes. |

Screen content, screenshots, conversation context, and requested notification
content can reach the user's configured AI providers as required by a task.
Optional paired-PC and WhatsApp features have their own data paths and controls.
Provider keys are encrypted with Android Keystore. Explain these data uses
accurately in user-facing disclosures; do not describe the assistant as entirely
offline or claim that no personal data leaves the device.

## Draft for “Additional information to support your appeal”

> Please review the Play Protect classification of JARVIS for Android,
> package com.jarvis.app. A user with a Vivo T3x 5G reports the warning
> “App blocked to protect your device” when installing our distributed APK.
> The APK SHA-256 supplied in this form identifies the exact binary uploaded
> to VirusTotal. The device's OS version, country, and full warning text should
> be included here once confirmed.
>
> JARVIS is a user-operated AI assistant. It declares an Accessibility service
> to read screens and carry out requested phone tasks, and a notification
> listener for notification reads/replies, optional WhatsApp commands, and
> identified Clock-timer cancellation. Users enable each access separately in
> Android Settings. The Accessibility service does not declare itself a
> disability-assistance tool. Phone tasks include risk checks and user-visible
> Pause/Stop controls; this is not a claim that every action has a separate
> confirmation or that all security risks have been eliminated.
>
> Tasks may send relevant screen content, screenshots, or notification content
> to the user's selected AI providers. Voice transcription also uses a
> configured provider. Our security documentation describes the controls and
> remaining limits: https://github.com/AnaaySampat/jarvis/blob/main/docs/SECURITY.md
>
> Please assess this specific APK and its declared capabilities. We are
> requesting review of the reported classification, not advice on a future
> implementation. [Replace this sentence with the confirmed download URL and
> any available reproduction evidence before submission.]

Do not submit the bracketed placeholder. Check that the public documentation URL
is accessible and matches the reviewed binary before referencing it.
