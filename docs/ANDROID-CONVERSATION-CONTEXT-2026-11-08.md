# Android conversation context investigation

Inspected the visible JARVIS conversation on the connected phone on 2026-11-08,
using a read-only Android UI hierarchy dump. The original investigation used
`2.5.6-rc.3`; subsequent user-authorized testing installed a local APK update with
the same package/version/signing identity and preserved the application data.

## Confirmed chat example

The visible conversation contained this sequence:

1. User: “Tell me my phone's imei number”.
2. JARVIS said Accessibility was enabled in Settings, but the service was stopped,
   and asked the user to turn JARVIS off and on again in Accessibility.
3. User: “Done”.
4. JARVIS: “I'm ready when you are, sir. What can I do for you?”
5. User: “The accessibility is done”.
6. JARVIS performed the IMEI lookup and returned the values (omitted here).

The “Done” response failed to connect to the pending prerequisite. The later,
more explicit response did connect to the original request. This demonstrates
inconsistent contextual interpretation rather than proving that all history was
missing. The original agent selection and provider request body for the “Done”
turn are not available, so its precise model input cannot be reconstructed.

## Confirmed code defect

`createBrain.turn()` used the presence of any `TurnScope` to discard conversation
history. User-picked Phone, Files, Research, Scheduler, and Content agents all
use a scope, so every follow-up through these agents received only its current
message and task package. Earlier chat messages were saved and visible in the
UI but absent from the model request. Recent tool groups were also discarded.

Auto already included the latest 12 stored messages. This chat contained eight
visible messages, so the history limit does not explain the observed exchange.
Internal consultations and incoming requests deliberately use isolated scopes;
that isolation must be retained.

## Changes

- Explicitly mark user-picked local agent requests as part of the visible
  conversation. Include the same bounded history and recent tool groups used by
  Auto, while keeping each agent's existing tool limits.
- Keep incoming PC/WhatsApp requests, internal consultations, and checked saved
  workflow continuations isolated from unrelated local chat history.
- Explain in the conversational system context that short acknowledgments after
  a requested setup step refer to the pending request. Require checking the
  prerequisite and passing the full resolved goal to the ordinary tool loop.
  Completed or uncertain actions must not be replayed merely because the user
  says “Done”. Ambiguous references call for a short clarification.
- Preserve the user's exact visible message, UI ID filtering, pending-reply
  filtering, existing authorization, and native verification. There is no new
  automatic action dispatcher or unconditional retry path.
- Resolve a short setup acknowledgment to the original unstarted objective for
  tool selection, workflow journaling, unsupported-claim checks and completion
  review. This resolver requires a setup-related no-execution response and excludes
  completed or uncertain effects. The original user message remains unchanged.
- Wait for saved-chat hydration before adding the launch greeting, so an early
  greeting cannot suppress restoration of the saved visible transcript.

Regression tests cover all five local agents, agent changes and brain recreation,
the Auto Accessibility acknowledgment example, UI placeholder exclusion, and
continued isolation for external requests and internal helpers. These tests check
the model inputs and execution boundaries; they do not guarantee a particular
live provider's wording.

The raw UI snapshot is retained only under ignored `.test-tmp/`. The temporary
copy on the phone was removed after inspection. No IMEI values are included here.

## Device testing

The first local test APK was installed at 14:09 IST after its certificate was
checked against the pulled original APK. The original APK is retained locally
for rollback. Accessibility stayed connected after the in-place update.

Passed: an Auto message established the temporary reference word `CobaltMeadow`;
an `@phone` follow-up correctly recalled it from the preceding chat.

The exact prerequisite test found another defect: after Accessibility was
temporarily disabled, JARVIS correctly refused the IMEI task and opened the
settings page. After restoration, “Done” received an answer claiming a live read,
but there was no new phone tool activity or native operator task. This first test
was a failure, not a confirmed live lookup. It motivated the original-objective
guard above. The temporary Accessibility change was restored immediately.

After those changes, all **957 frontend tests passed** (9 existing live-provider
skips), including a regression that rejects the exact unsupported live-read claim,
and TypeScript checking passed. A revised APK and repeat device checks are pending.
