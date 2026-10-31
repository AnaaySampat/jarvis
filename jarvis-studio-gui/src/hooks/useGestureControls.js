import { useEffect, useRef, useState } from "react";
import {
  CAMERA_OFF,
  GestureEventGate,
  pollGestureCamera,
  startGestureCamera,
  stopGestureCamera,
} from "../brain/platform/gestures";

export function useGestureControls({ enabled, onListen, onStopSpeech, canListen, blocked }) {
  const [status, setStatus] = useState(CAMERA_OFF);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const handlers = useRef({ onListen, onStopSpeech, canListen, blocked });
  useEffect(() => {
    handlers.current = { onListen, onStopSpeech, canListen, blocked };
  }, [onListen, onStopSpeech, canListen, blocked]);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let timer;
    const gate = new GestureEventGate();
    const poll = async () => {
      let delay = 1000;
      try {
        const snapshot = await pollGestureCamera();
        if (disposed) return;
        setStatus((current) =>
          Object.keys(snapshot).every((key) => current[key] === snapshot[key]) ? current : snapshot,
        );
        setMessage((current) => (current?.summary === snapshot.summary ? current : null));
        delay = snapshot.running || snapshot.starting ? 250 : 1000;
        const h = handlers.current;
        const action = gate.accept(snapshot, {
          visible: !document.hidden,
          blocked: h.blocked,
          now: Date.now(),
        });
        if (action === "stopSpeech") h.onStopSpeech();
        if (action === "listen" && h.canListen) h.onListen();
        if (action === "feedback")
          setMessage({ text: "Thumbs up detected.", summary: snapshot.summary });
      } catch (error) {
        if (!disposed) setMessage({ text: String(error?.message || error), summary: null });
      } finally {
        if (!disposed) timer = setTimeout(poll, delay);
      }
    };
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [enabled]);

  const control = async (start) => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await (start ? startGestureCamera() : stopGestureCamera());
      const snapshot = await pollGestureCamera();
      setStatus(snapshot);
      if (!response.ok) setMessage({ text: response.summary, summary: snapshot.summary });
    } catch (error) {
      setMessage({ text: String(error?.message || error), summary: null });
    } finally {
      setBusy(false);
    }
  };
  return {
    supported: enabled,
    status,
    busy,
    message: message?.text || "",
    start: () => control(true),
    stop: () => control(false),
  };
}
