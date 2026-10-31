import { invoke } from "@tauri-apps/api/core";

export type Gesture = "OPEN_PALM" | "PEACE" | "THUMBS_UP" | "FIST" | "UNKNOWN";
export interface GestureState {
  foreground: boolean;
  running: boolean;
  starting: boolean;
  seq: number;
  gesture: Gesture;
  detectedAt: number;
  summary: string;
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
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Camera did not respond. Try again.")), 4000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export const startGestureCamera = () =>
  bounded(invoke<{ ok: boolean; summary: string }>("plugin:phone|start_gesture_recognition"));
export const stopGestureCamera = () =>
  bounded(invoke<{ ok: boolean; summary: string }>("plugin:phone|stop_gesture_recognition"));
export const pollGestureCamera = () =>
  bounded(invoke<GestureState>("plugin:phone|poll_gesture_recognition"));

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
