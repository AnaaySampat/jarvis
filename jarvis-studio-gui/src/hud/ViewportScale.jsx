/* ViewportScale.jsx — on desktop, scales the fixed-size HUD stage (1442×902) to
   fit the window while preserving aspect (ported from jarvis-hud/hud-app.js mount).

   ANDROID FORK: on a narrow / touch viewport (a phone) the fixed wide stage would
   shrink to an unreadable strip, so instead we switch to a "mobile" mode — no scale
   transform; the stage flows to full width and the HUD stacks + scrolls vertically.
   The single source of truth for the breakpoint is `isMobileViewport()`; the mobile
   CSS (hud-mobile.css) keys off the `hud-viewport--mobile` class we add. */

import { useState, useEffect } from "react";
import { isMobileViewport } from "../utils/isMobileViewport";

const BASE_W = 1442;
const BASE_H = 902;

export default function ViewportScale({ children }) {
  const [view, setView] = useState({ scale: 1, width: BASE_W, mobile: false });

  useEffect(() => {
    const onResize = () => {
      const vw = window.visualViewport?.width ?? window.innerWidth;
      const vh = window.visualViewport?.height ?? window.innerHeight;
      const mobile = isMobileViewport();
      if (mobile) {
        setView({ scale: 1, width: vw, mobile: true });
        return;
      }
      const baseRatio = BASE_W / BASE_H;
      const viewRatio = vw / vh;
      const scale = viewRatio > baseRatio ? vh / BASE_H : Math.min(vw / BASE_W, vh / BASE_H);
      const width = viewRatio > baseRatio ? Math.max(BASE_W, vw / scale) : BASE_W;
      setView({ scale, width, mobile: false });
    };
    onResize();
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
    };
  }, []);

  if (view.mobile) {
    // No transform: let the stage flow full-width and scroll. hud-mobile.css turns
    // the absolutely-positioned rails/core/dock into a single stacked column.
    return (
      <div className="hud-viewport hud-viewport--mobile">
        <div className="hud-stage">{children}</div>
      </div>
    );
  }

  return (
    <div className="hud-viewport">
      <div className="hud-stage" style={{ width: view.width, transform: `scale(${view.scale})` }}>
        {children}
      </div>
    </div>
  );
}
