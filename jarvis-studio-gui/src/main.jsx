import React from "react";
import ReactDOM from "react-dom/client";

// Bundled HUD fonts (offline, served from 'self' so they satisfy the app CSP).
// Orbitron = display (--disp), Share Tech Mono = mono (--mono), Inter = body (--body).
import "@fontsource/orbitron/400.css";
import "@fontsource/orbitron/500.css";
import "@fontsource/orbitron/600.css";
import "@fontsource/orbitron/700.css";
import "@fontsource/orbitron/800.css";
import "@fontsource/orbitron/900.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/share-tech-mono/400.css";

import App from "./App";
import Overlay from "./Overlay";
import BrowserPanel from "./components/BrowserPanel";
import ControlOverlay from "./components/ControlOverlay";
import ErrorBoundary from "./components/ErrorBoundary";
import { isMobileViewport } from "./utils/isMobileViewport";
import "./index.css";

// Both windows load the same page. Detect which one we are by reading the
// Tauri-injected window label. Falls back to "main" in browser dev mode.
// In a plain browser you can force the floating overlay with ?overlay (handy for
// previewing/iterating on the pod without the Tauri runtime).
const params = new URLSearchParams(window.location.search);
const forceOverlay = params.has("overlay");
const forceBrowserPanel = params.has("browser-panel");
const forceControlOverlay = params.has("control-overlay");

// ANDROID FORK: a phone has ONE screen. The desktop-only pill / browser-panel /
// control-overlay windows don't exist on mobile, but Tauri-mobile's single WebView
// can report one of their labels (not "main"), which would route us to the wrong
// component. So on a touch / narrow viewport we always render the main HUD.
const windowLabel = isMobileViewport()
  ? "main"
  : forceControlOverlay
    ? "control-overlay"
    : forceBrowserPanel
      ? "browser-panel"
      : forceOverlay
        ? "overlay"
        : (window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label ?? "main");

const root =
  windowLabel === "overlay" ? (
    <Overlay />
  ) : windowLabel === "browser-panel" ? (
    <BrowserPanel />
  ) : windowLabel === "control-overlay" ? (
    <ControlOverlay />
  ) : (
    <App />
  );

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>{root}</ErrorBoundary>
  </React.StrictMode>,
);
