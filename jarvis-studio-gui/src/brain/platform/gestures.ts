import { invoke } from "@tauri-apps/api/core";
import type { Frame } from "../../gestures/engine";

export type Gesture = "OPEN_PALM" | "PEACE" | "THUMBS_UP" | "FIST" | "UNKNOWN";
export interface GestureState {
  foreground: boolean;
  running: boolean;
  starting: boolean;
  seq: number;
  gesture: Gesture;
  detectedAt: number;
  summary: string;
  frame?: Frame | null;
}

export const CAMERA_OFF: GestureState = {
  foreground: false,
  running: false,
  starting: false,
  seq: 0,
  gesture: "UNKNOWN",
  detectedAt: 0,
  summary: "Camera is off.",
};

// A dropped bridge reply must not leave the controls or polling stuck forever.
async function bounded<T>(promise: Promise<T>, timeout=4000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Camera did not respond. Try again.")), timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export const startGestureCamera = (options={holdMs:600,releaseMs:400,confidence:0.8}) =>
  bounded(invoke<{ ok: boolean; summary: string }>("plugin:phone|start_gesture_recognition",
    {holdMs:options.holdMs,releaseMs:options.releaseMs,confidence:options.confidence}));
export const stopGestureCamera = () =>
  bounded(invoke<{ ok: boolean; summary: string }>("plugin:phone|stop_gesture_recognition"));
export const pollGestureCamera = () =>
  bounded(invoke<GestureState>("plugin:phone|poll_gesture_recognition"));
export const nativeGestureCamera = {
  start:startGestureCamera,stop:stopGestureCamera,poll:pollGestureCamera,
  photo:()=>bounded(invoke<{ok:boolean;summary:string}>("plugin:phone|take_gesture_photo"),10000),
};

/** Consume every sequence, including ignored detections. Returning to the app,
 * dismissing approval, or remounting the UI must never replay an old gesture. */
export class GestureEventGate {
  private seq: number | undefined;

  accept(
    state: GestureState,
    context: { visible: boolean; blocked: boolean; now: number },
  ): "listen" | "stopSpeech" | "feedback" | null {
    const previous = this.seq;
    this.seq = state.seq;
    if (previous === undefined || state.seq <= previous) return null;
    const age = context.now - state.detectedAt;
    if (
      !state.running ||
      !state.foreground ||
      !context.visible ||
      context.blocked ||
      age < 0 ||
      age > 1500
    ) {
      return null;
    }
    if (state.gesture === "OPEN_PALM") return "stopSpeech";
    if (state.gesture === "PEACE") return "listen";
    if (state.gesture === "THUMBS_UP") return "feedback";
    return null; // fist closes the camera natively; no gesture can approve anything
  }
}
