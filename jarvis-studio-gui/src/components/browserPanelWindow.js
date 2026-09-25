// Position/show the browser-panel Tauri window beside JARVIS's Chromium browser.
// Called from the main HUD when browser_state.open changes (belt-and-suspenders:
// the panel window also watches the same state on its own websocket).

export const PANEL_W = 400;

export async function syncBrowserPanel(open, wsSend) {
  try {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const { LogicalSize, LogicalPosition } = await import("@tauri-apps/api/window");
    const panel = await WebviewWindow.getByLabel("browser-panel");
    if (!panel) {
      console.warn("[BrowserPanel] window label browser-panel not found");
      return;
    }
    if (!open) {
      await panel.hide();
      return;
    }
    const left = window.screen.availLeft || 0;
    const top = window.screen.availTop || 0;
    const w = PANEL_W;
    const h = window.screen.availHeight || window.screen.height;
    const x = Math.round(left + (window.screen.availWidth || window.screen.width) - w);
    await panel.setSize(new LogicalSize(w, h));
    await panel.setPosition(new LogicalPosition(x, top));
    await panel.setAlwaysOnTop(true);
    await panel.show();
    if (wsSend) {
      wsSend({ type: "browser_panel", data: { open: true, width: PANEL_W } });
    }
  } catch (err) {
    console.warn("[BrowserPanel] sync failed:", err);
  }
}
