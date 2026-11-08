import { useCallback, useEffect, useRef, useState } from "react";
import { addPluginListener } from "@tauri-apps/api/core";
import { appUpdate, shouldOfferUpdate } from "../brain/platform/appUpdate";

export function useAppUpdate({ enabled, blocked, channel }) {
  const [state, setState] = useState({});
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(null);
  const [visible, setVisible] = useState(() => document.visibilityState !== "hidden");
  const mounted = useRef(false);
  const refreshing = useRef(false);
  const request = useCallback(async (action = "status", options = {}) => {
    try {
      const result = await appUpdate(action, options);
      if (mounted.current) { setState(result); if (result.openRequested) setOpened(true); }
      return result;
    } catch (error) {
      if (mounted.current) setState((previous) => ({ ...previous, error: String(error?.message || error) }));
      return null;
    }
  }, []);
  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try { return await request(); }
    finally { refreshing.current = false; }
  }, [request]);
  useEffect(() => {
    if (!enabled) return;
    mounted.current = true;
    let disposed = false;
    let listener;
    const visibility = () => {
      const showing = document.visibilityState !== "hidden";
      setVisible(showing);
      void request("foreground", { visible: showing });
      if (showing) { void refresh(); void request("check"); }
    };
    document.addEventListener("visibilitychange", visibility);
    void request("foreground", { visible: document.visibilityState !== "hidden" });
    void request("preferences", { channel }).then(() => { if (!disposed) void request("check"); });
    void refresh();
    void addPluginListener("phone", "app-update", () => void refresh())
      .then((value) => { if (disposed) void value.unregister(); else listener = value; }).catch(() => {});
    const poll = setInterval(() => { if (document.visibilityState !== "hidden") void refresh(); }, 3000);
    return () => { disposed = true; mounted.current = false; clearInterval(poll); document.removeEventListener("visibilitychange", visibility); void listener?.unregister(); };
  }, [enabled, channel, request, refresh]);
  const act = useCallback(async (action, options = {}) => {
    setBusy(true);
    try { return await request(action, { releaseId: state.release?.id, ...options }); }
    finally { if (mounted.current) setBusy(false); }
  }, [request, state.release?.id]);
  const close = useCallback(() => { setDismissed(state.release?.id || "check"); setOpened(false); void act("snooze"); }, [act, state.release?.id]);
  const open = useCallback(() => { setDismissed(null); setOpened(true); void act("open"); }, [act]);
  const check = useCallback(async () => {
    setDismissed(null); setOpened(true); setBusy(true);
    try { await request("open"); await request("check", { force: true }); }
    finally { if (mounted.current) setBusy(false); }
  }, [request]);
  const skip = useCallback(() => { setDismissed(state.release?.id); setOpened(false); void act("skip"); }, [act, state.release?.id]);
  const show = enabled && visible && !blocked && (opened || (dismissed !== state.release?.id && shouldOfferUpdate(state, blocked, visible)));
  return { state, busy, show, act, close, open, check, skip };
}
