# Customer review improvements — 5 November 2026

Implemented against the current Android checkout at `C:\aura-android`, which matches
the review's production UI. The older workspace copies were not changed.

| Review observation | Result |
| --- | --- |
| 1. Local starting point | Local activities remain reachable through Skills and the Activities shortcut. The home-screen local-features banner was removed in the 6 November follow-up below. Returning from Learn does not reopen practice instead of reading. |
| 2. Duplicate gesture interfaces | Activities, Settings, Voice, Skills, the command palette and the floating session all lead to one workspace, using the same activity names. Guide, safe practice, remapping and custom calibration remain available. Text, bookmarks and applied preferences save automatically. |
| 3. Narrow navigation | The Android header is editable. Its default is assistant status with Sound and Settings; selected controls, order and labels are saved per device. Search was removed at the user’s request. The bottom destination is labeled Capabilities. |
| 4. Heavy activity chrome | Existing Read and Steps content opens in a focused view. Show activity setup restores the picker and Control/Guide/Learn/Tune tabs. Camera setup is collapsed when off. Editing remains open while typing until Done editing. Live camera sessions retain Stop. |
| 5. Weather recovery | The instruction now says Settings → Location and includes Set location. The command palette lists Files and Location separately. |
| 6. No-key conversation recovery | A pending conversation offers Set up an AI provider, opens API Keys visibly, and returns to the same messages and unsent draft when Settings closes. |
| 7. Stale feedback | Failed timer messages stay in Steps, can be dismissed and clear on activity change. Real timer cards remain available across local activities. Practice/pause instructions reflect whether the camera is running. |

## Initial review verification

- Full automated suite: 741 passed, 9 skipped (live-provider tests).
- TypeScript check: passed.
- ESLint: passed with no warnings.
- Vite production build: passed; existing large-chunk and mixed-import notices remain.
- Git whitespace check: passed.
- Browser checks at 390 × 844 and 320 × 740: Explore entry points, focused reading,
  page navigation, named-bookmark return, retained reading on reopen, final-step
  boundary, native-only timer feedback and clearing, Guide/practice, visible Search,
  More controls, and provider setup with conversation/draft return.
- Weather's missing-location recovery and paused-camera retention are also covered
  by automated component/hook regressions.

Native Android camera recognition, permissions, audio, real timers, PC/TV execution
and physical-device performance were not validated. No APK was built or installed.
No provider credentials or external accounts were configured.

## Editable Android top bar — 6 November 2026

The default bar shows assistant status on the left, Sound and Settings on the
right, and Stop while working or speaking. Search and decorative branding are
absent. **Settings → Interface → Edit top bar** opens the live editor at the start
of Appearance. If Menu is selected, it also has an Edit top bar entry.

People can select any number of the available buttons, reorder them, hide status and show short
button labels. Choices include Sound, Settings, Menu, Activities, Tasks, PC & TV,
Appearance and Phone controls. The editor previews changes, preserves Settings
or Menu as a recovery route, and offers Reset top bar. Stop remains available
regardless of the status setting. Preferences are validated and saved with the
existing on-device Appearance configuration; changing a theme leaves them intact.

The home-screen local-features/AI-key banner and its duplicate activity strip are
removed. Activities remain in Skills and the optional Activities shortcut. First
launch now explains Talk, Chat, Memory, Skills, Capabilities and the shortcut bar,
then opens a shortcut picker with descriptions, ordering and a preview. The tour
can be skipped, is remembered on this device, and can be replayed from Appearance.
Long shortcut bars scroll horizontally with 44-pixel touch targets.

Earlier validation, before the introduction follow-up: 34 focused component and persistence regressions passed, as did
TypeScript, ESLint and the production UI build. Browser checks at 390 × 844 and
320 × 740 covered selecting/reordering buttons, labels, hiding status, reload
persistence, returning to the editor through Menu and resetting to defaults.
The full suite passed with 746 tests passed and 9 live-provider tests skipped.
No APK or physical-device validation was performed.

Follow-up validation: 39 focused component and persistence tests passed, along
with TypeScript, ESLint and the web build. Browser checks covered the automatic
introduction, selecting all eight shortcuts, 320-pixel overflow containment,
opening the last shortcut, saving across reload, replaying the introduction and
the full Capabilities label. This follow-up has not been installed on Android.
