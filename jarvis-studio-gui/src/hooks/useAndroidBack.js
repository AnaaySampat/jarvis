import { useEffect, useRef } from "react";
import { onBackButtonPress } from "@tauri-apps/api/app";

/**
 * Route the Android back button to `handler` while `active`.
 *
 * Tauri's AppPlugin only diverts back to JS while a listener is registered, so the
 * listener lives exactly as long as the caller is active — with none, back falls
 * through to Android and leaves the app, as it always has.
 * This is the Channel bridge CLAUDE.md rule 4 warns about, but its drops were
 * during WebView startup reloads; panels only open well after that (live-verified
 * 2026-09-25, docs/ARCHITECTURE.md).
 */
export function useAndroidBack(active, handler) {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    if (!active || !("__TAURI_INTERNALS__" in window)) return;
    let listener = null;
    let gone = false;
    onBackButtonPress(() => ref.current())
      .then((l) => (gone ? l.unregister() : (listener = l)))
      .catch(() => {}); // no listener = Android's default back, same as before
    return () => {
      gone = true;
      void listener?.unregister();
    };
  }, [active]);
}
