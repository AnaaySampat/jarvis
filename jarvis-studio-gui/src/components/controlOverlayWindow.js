// Show / hide / position the control-overlay Tauri window FROM the main window
// when desktop computer control is active.
//
// A `visible:false` window cannot reliably show ITSELF (its hidden webview's
// effects may not run), so — exactly like the browser companion panel — the
// always-running main window drives it. ControlOverlay.jsx still self-manages its
// SIZE for minimize/expand once it's visible; this just makes it appear.

const W = 580,
  H = 132;

export async function syncControlOverlay(active) {
  try {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const { LogicalSize, LogicalPosition } = await import("@tauri-apps/api/window");
    const win = await WebviewWindow.getByLabel("control-overlay");
    if (!win) {
      console.warn(
        "[ControlOverlay] window 'control-overlay' not found — a full " +
          "`tauri dev` restart is needed to create it (HMR won't).",
      );
      return;
    }
    if (!active) {
      await win.hide();
      return;
    }
    // Exclude this always-on-top bar from screen capture (config sets it too; we
    // re-assert on show). WDA_EXCLUDEFROMCAPTURE keeps it visible to the user but
    // INVISIBLE to JARVIS's own vision screenshots — otherwise the overlay paints
    // over the very app the operator is trying to read (it was occluding BlueJ's
    // "Create New Class" dialog, so the operator couldn't see the field/buttons).
    try {
      await win.setContentProtected(true);
    } catch {
      /* older webview: config still applies */
    }
    const left = window.screen.availLeft || 0;
    const top = window.screen.availTop || 0;
    const screenW = window.screen.availWidth || window.screen.width;
    const x = Math.round(left + (screenW - W) / 2); // top-center
    await win.setSize(new LogicalSize(W, H));
    await win.setPosition(new LogicalPosition(x, top + 12));
    await win.setAlwaysOnTop(true);
    await win.show();
  } catch (err) {
    console.warn("[ControlOverlay] syncControlOverlay failed:", err);
  }
}
