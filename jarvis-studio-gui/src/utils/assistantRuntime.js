/** Runtime identity must not change with window size or touch hardware.
 * Browser previews of the Android fork use the in-app brain at every width.
 * Native desktop builds continue to use their Python sidecar.
 */
export function usesLocalAssistant(
  native = Boolean(globalThis.window?.__TAURI_INTERNALS__),
  userAgent = globalThis.navigator?.userAgent || "",
) {
  return !native || /android/i.test(userAgent);
}
