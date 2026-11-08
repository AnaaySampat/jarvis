/* Cross-app floating STOP button — ANDROID FORK.
 *
 * The in-app HUD banner (App.jsx's `phone-control-banner`) only exists while the
 * JARVIS WebView itself is the foreground app. A phone_task's whole point is to
 * drive some OTHER app, so exactly when a runaway/undesired action most needs an
 * escape hatch, the in-app banner isn't on screen to provide it. This shows a
 * small always-on-top native overlay instead (TYPE_ACCESSIBILITY_OVERLAY, via the
 * accessibility service already required for phone control — no extra "draw over
 * other apps" permission prompt needed), and polls for a tap the same reliable way
 * wake-word detections are polled: the Tauri event/Channel bridge drops callbacks
 * on this device, so a native click can't just call back into a JS listener.
 */

import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "../tools/httpClient";

const POLL_MS = 250;

let visible = false;
let pollTimer: ReturnType<typeof setInterval> | undefined;
let lastSeq = -1;
let generation = 0;
let stopHandler: () => void = () => {};
// The cross-app STOP shows for free through the accessibility overlay when that
// service is on (phone-control users). Voice-only users never enable it, so the
// overlay falls back to a TYPE_APPLICATION_OVERLAY that needs the "draw over other
// apps" grant. We ask for that grant at most once per app run, and only when the
// caller opts in (see SyncOpts.promptPermission) — never silently on the launch
// greeting.
let permissionPrompted = false;

export interface SyncOpts {
  /** Ask for the overlay permission if it's missing and the overlay couldn't show. */
  promptPermission?: boolean;
  /** Called (once) when the permission is missing — surface a hint to the user. */
  onNeedsPermission?: () => void;
}

async function poll(expectedGeneration: number): Promise<void> {
  let st: { seq?: number; visible?: boolean } | null = null;
  try {
    st = await invoke("plugin:phone|poll_stop_overlay");
  } catch {
    return; // transient bridge hiccup — just try again next tick
  }
  if (!visible || expectedGeneration !== generation) return;
  const seq = typeof st?.seq === "number" ? st.seq : 0;
  if (lastSeq < 0) {
    lastSeq = seq; // first poll: baseline, don't react to a stale prior tap
  } else if (seq > lastSeq) {
    lastSeq = seq;
    stopHandler();
    return;
  }
  // Native task completion can hide the view without a JS visibility edge.
  // Reconcile actual native state, including after a task-to-speech handoff.
  if (st?.visible === false) {
    void invoke("plugin:phone|show_stop_overlay").catch(() => {});
  }
}

/**
 * Idempotent — safe to call on every render with the desired visibility. Only
 * starts/stops its poll when desired visibility changes. Polling also restores
 * an overlay removed by native completion while the JS owner remains active.
 */
export function syncStopOverlay(active: boolean, onStop: () => void, opts: SyncOpts = {}): void {
  if (!inTauri()) return;
  stopHandler = onStop;
  if (active === visible) return;
  visible = active;
  const currentGeneration = ++generation;
  if (active) {
    lastSeq = -1;
    void (async () => {
      let res: { ok?: boolean } | null = null;
      try {
        res = (await invoke("plugin:phone|show_stop_overlay")) as { ok?: boolean };
      } catch {
        return;
      }
      // ok === false means NEITHER the accessibility overlay nor an app overlay could
      // show — the "draw over other apps" permission is missing. Ask for it once, and
      // only when the caller opted in (so the launch greeting never yanks the user
      // into system settings).
      if (res?.ok === false && opts.promptPermission && !permissionPrompted) {
        permissionPrompted = true;
        try {
          opts.onNeedsPermission?.();
        } catch {
          /* ignore */
        }
        void invoke("plugin:phone|request_overlay_permission").catch(() => {});
      }
    })();
    pollTimer = setInterval(() => void poll(currentGeneration), POLL_MS);
  } else {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
    void invoke("plugin:phone|hide_stop_overlay").catch(() => {});
  }
}
