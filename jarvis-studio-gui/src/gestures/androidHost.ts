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
  availability?: Record<
    string,
    { ready?: boolean; detail: string; setup?: () => unknown; setupLabel?: string }
  >;
}
export function androidGestureHost(options: HostOptions) {
  return {
    ...options,
    platform: "android",
    async startTimer({ seconds, label, token }: { seconds: number; label: string; token: string }) {
      const result = await androidPlatform.clock.setTimer(seconds, label);
      return {
        ...result,
        external: true,
        ...(result.ok
          ? {
              timers: [
                {
                  id: token,
                  deadline: Date.now() + seconds * 1000,
                  seconds,
                  label,
                  state: "running",
                  external: true,
                },
              ],
            }
          : {}),
      };
    },
    manageTimers: () => androidPlatform.clock.showTimers(),
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
      const device: Record<string, [string, number]> = {
        "media.toggle": ["media_play_pause", 1],
        "media.next": ["media_next", 1],
        "media.previous": ["media_previous", 1],
        "media.up": ["volume_up", 1],
        "media.down": ["volume_down", 1],
        "media.mute": ["mute_toggle", 1],
        "mic.mute": ["microphone_mute", 1],
        "mic.unmute": ["microphone_unmute", 1],
        "phone.flashlightOn": ["flashlight_on", 1],
        "phone.flashlightOff": ["flashlight_off", 0],
        "phone.bright": ["brightness", 80],
        "phone.dim": ["brightness", 30],
        "phone.autoBrightness": ["brightness", -1],
      };
      if (device[action])
        return options.runAction({
          type: "device",
          do: device[action][0],
          value: device[action][1],
        });
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
