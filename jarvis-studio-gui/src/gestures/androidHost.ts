import { androidPlatform } from "../brain/platform";
import { webSpeechTTS } from "../brain/platform/webspeech";
import { listRoutines, routineTurn } from "../brain/schedule/routines";
import type { ActionSpec, ToolResult } from "../brain/types";
import { reorderCards, type Action, type GestureConfig } from "./engine";
interface HostOptions {
  listen: () => unknown;
  pttStart: () => unknown;
  finishListen: () => unknown;
  cancelListen: () => unknown;
  stopSpeech: () => unknown;
  runAction: (spec: ActionSpec) => Promise<ToolResult | undefined>;
  pcAction: (action: string) => Promise<{ ok: boolean; summary: string }>;
  sendMessage: (text: string, display?: string) => Promise<unknown>;
  isReady: () => boolean;
  order: Record<string, string[]>;
  sendScreen: (patch: unknown) => unknown;
}
export function androidGestureHost(options: HostOptions) {
  return {
    ...options,
    async speak(text: string) {
      await webSpeechTTS.speak(text);
      return { ok: true, summary: "Read aloud." };
    },
    reorder(from: string, to: string) {
      const order = reorderCards(options.order, from, to);
      if (order !== options.order) options.sendScreen({ order });
    },
    async perform(
      action: Action,
      cfg: GestureConfig,
      camera: { photo: () => Promise<ToolResult> },
    ) {
      const device: Record<string, string> = {
        "media.toggle": "media_play_pause",
        "media.next": "media_next",
        "media.previous": "media_previous",
        "media.up": "volume_up",
        "media.down": "volume_down",
        "media.mute": "mute_toggle",
        "mic.mute": "microphone_mute",
        "mic.unmute": "microphone_unmute",
      };
      if (device[action])
        return options.runAction({ type: "device", do: device[action], value: 1 });
      if (action.startsWith("pc.")) return options.pcAction(action);
      const tv: Record<string, [string, string]> = {
        "tv.toggle": ["key", "play_pause"],
        "tv.next": ["key", "next"],
        "tv.previous": ["key", "previous"],
        "tv.up": ["volume_up", "5"],
        "tv.down": ["volume_down", "5"],
        "tv.mute": ["mute", ""],
      };
      if (tv[action])
        return options.runAction({ type: "tv_control", do: tv[action][0], target: tv[action][1] });
      if (action === "timer.start")
        return androidPlatform.clock.setTimer(cfg.timerSeconds, "Gesture timer");
      if (action === "photo.capture") return camera.photo();
      if (action === "routine.run") {
        if (!options.isReady())
          return { ok: false, summary: "Wait for JARVIS to finish before launching a routine." };
        const routine = listRoutines().find((r) => r.name === cfg.routineName);
        if (!routine)
          return { ok: false, summary: "Choose an existing saved routine in gesture settings." };
        await options.sendMessage(routineTurn(routine), "Run " + routine.name);
        return {
          ok: true,
          summary: "Routine turn finished; see the conversation for its action results.",
        };
      }
      return { ok: false, summary: "This action is not available in this gesture mode." };
    },
  };
}
