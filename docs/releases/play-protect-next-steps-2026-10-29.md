# Next steps for the full-featured Android release

## Current decision

Keep the submitted 2.5.0 APK unchanged while its Play Protect appeal is under
review. The developer chose to retain all features. The current APK's VirusTotal
report matches its hash and showed 0/55 detections when inspected; that result
does not establish Play Protect acceptance. The reported warning matches
Google's sensitive-permission internet-install protection.

There is no verified signing or packaging change that removes this restriction
while retaining the sensitive services. Google must assess the app's
classification. A future compliance improvement is not a guaranteed exemption
from the install-time permission rule.

## Concrete source findings

This was a focused source inspection, not a full policy or security audit.

- The App control entry in `jarvis-studio-gui/src/hud/HudPanels.jsx` dispatches
  `open_a11y_settings`. The dispatcher calls `openAccessibilitySettings`, and
  `PhonePlugin.kt` opens Android's Accessibility settings directly. The inspected
  path has no separate in-app affirmative consent explaining screen access,
  automation, or AI-provider data sharing.
- When phone control finds the service disabled, `runPhone` in
  `src/brain/tools/dispatch.ts` also opens Accessibility settings directly.
- The notification-access button in `src/components/Settings.jsx` directly calls
  `requestNotificationAccess`. Its nearby text mentions WhatsApp access, but the
  inspected grant path does not provide a separate notice covering the full
  notification-listener data use and cloud processing.
- The `Privacy` component in `src/components/MobileOnboarding.jsx` describes
  provider-key encryption. That statement does not disclose the separate screen
  and notification data flows.

## Recommended next implementation

Prepare these improvements as a new candidate release; preserve the existing
submitted binary and its hash.

1. Add separate, plainly worded Accessibility and notification disclosures
   immediately before their grant flows. Explain the data accessed, purposes,
   background behavior where applicable, and sharing with configured AI
   providers. Provide affirmative consent and a decline option.
2. Apply the consent decision to the actual data-access and automation paths,
   including upgrades where Android access was already granted. Declining must
   leave unrelated assistant features usable. Recheck access after revocation.
3. Provide accessible privacy documentation that matches actual provider,
   paired-PC, WhatsApp, voice, screen, and notification data flows. Verify the
   disclosures against native and JavaScript behavior rather than relying only
   on permission names.
4. Test acceptance, refusal, revocation, existing grants, and upgrades. Build
   and verify a new version only after the behavior is ready. A new binary has
   a new APK hash and needs its own scan and accurate review evidence.

These changes improve transparency and consent. They do not remove the declared
services from the APK and cannot by themselves establish Play Protect approval.

## Distribution decision that needs separate review

Google Play's current Accessibility policy prohibits use that enables an app to
autonomously initiate, plan, and execute actions or decisions, except qualifying
verified disability-assistance tools. It distinguishes this from deterministic,
human-defined automation and says a general voice assistant is not automatically
an accessibility tool.

JARVIS's native AI phone operator warrants a focused review against that rule
before pursuing Play Store distribution. This is a potential distribution
constraint, not a finding that Google applied that rule to the current Play
Protect appeal. Adding disclosure alone does not resolve a prohibited use case.

Sources checked on 2026-10-29:

- [Play Protect warning guidance](https://developers.google.com/android/play-protect/warning-dev-guidance)
- [Mobile Unwanted Software: transparency and user consent](https://developers.google.com/android/play-protect/mobile-unwanted-software)
- [Google Play AccessibilityService policy](https://support.google.com/googleplay/android-developer/answer/10964491?hl=en)
- [Current release and submission record](play-protect-2026-10-29.md)
