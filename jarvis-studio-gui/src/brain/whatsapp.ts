/**
 * WhatsApp on the phone (WhatsAppInbox.kt, useBrain): what to do with one command a
 * listed contact sent. Kept pure so the rules are tested apart from the hook.
 */

export type WhatsAppMode = "off" | "pc_off" | "always";

/** How old a command may be and still run: older ones arrived while JARVIS was asleep. */
export const WA_STALE_MS = 15 * 60_000;

export const WA_ASLEEP_REPLY =
  "That came in while JARVIS was asleep on the phone, so I didn't run it. Send it again if you still want it.";

/**
 * "leave": the PC answers it (mode "pc_off" while the link to the PC is up);
 * "stale": too old to run now, say so; "run": answer it here.
 */
export function whatsappDecision(
  mode: WhatsAppMode,
  pcState: string,
  sentAt: number,
  now: number,
): "leave" | "stale" | "run" {
  if (mode === "pc_off" && pcState === "online") return "leave";
  if (now - sentAt > WA_STALE_MS) return "stale";
  return "run";
}
