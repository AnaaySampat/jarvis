import { describe, expect, it, vi } from "vitest";
import { androidGestureHost } from "./androidHost";
import { defaults, type Action } from "./engine";

vi.mock("../brain/platform", () => ({ androidPlatform: {} }));
vi.mock("../brain/platform/webspeech", () => ({ webSpeechTTS: {} }));
vi.mock("../brain/schedule/routines", () => ({ listRoutines: vi.fn(), routineTurn: vi.fn() }));

describe("phone gesture actions", () => {
  it.each<[Action, string, number]>([
    ["phone.flashlightOn", "flashlight_on", 1],
    ["phone.flashlightOff", "flashlight_off", 0],
    ["phone.bright", "brightness", 80],
    ["phone.dim", "brightness", 30],
    ["phone.autoBrightness", "brightness", -1],
    ["media.up", "volume_up", 1],
    ["media.down", "volume_down", 1],
  ])(
    "dispatches %s through the existing phone action path",
    async (action, nativeAction, value) => {
      const result = { ok: true, summary: "Confirmed by Android." };
      const runAction = vi.fn(async () => result);
      const host = androidGestureHost({
        listen: vi.fn(),
        pttStart: vi.fn(),
        finishListen: vi.fn(),
        cancelListen: vi.fn(),
        stopSpeech: vi.fn(),
        runAction,
        pcAction: vi.fn(),
        sendMessage: vi.fn(),
        isReady: () => true,
        order: {},
        sendScreen: vi.fn(),
      });
      expect(await host.perform(action, defaults(), { photo: vi.fn() })).toBe(result);
      expect(runAction).toHaveBeenCalledExactlyOnceWith({
        type: "device",
        do: nativeAction,
        value,
      });
    },
  );

  it("preserves a native permission or camera error instead of reporting success", async () => {
    const result = {
      ok: false,
      summary: "The camera is in use, so I can't switch the flashlight on.",
    };
    const host = androidGestureHost({
      listen: vi.fn(),
      pttStart: vi.fn(),
      finishListen: vi.fn(),
      cancelListen: vi.fn(),
      stopSpeech: vi.fn(),
      runAction: vi.fn(async () => result),
      pcAction: vi.fn(),
      sendMessage: vi.fn(),
      isReady: () => true,
      order: {},
      sendScreen: vi.fn(),
    });
    expect(await host.perform("phone.flashlightOn", defaults(), { photo: vi.fn() })).toBe(result);
  });
});
