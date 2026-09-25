/**
 * Platform bridge — native Android capabilities via tauri-plugin-phone.
 *
 * STT uses WebView mic + Groq Whisper; TTS uses webspeech.ts → phone plugin speak.
 * App control, volume, clipboard, and URLs go through the same phone plugin.
 */

import { invoke } from "@tauri-apps/api/core";
import type { ToolResult } from "../types";
import type {
  OperatorStartResult,
  OperatorStatus,
  PhoneController,
} from "../operator/controller";
import { inTauri } from "../tools/httpClient";
import { makeKV, readJson, writeJson } from "../memory/store";

export interface TextToSpeech {
  speak(text: string): Promise<void>;
  stop(): Promise<void>;
}

export interface AppControl {
  open(name: string): Promise<ToolResult>;
  close(name: string): Promise<ToolResult>;
  openUrl(url: string): Promise<ToolResult>;
  openSavedFile(name: string): Promise<ToolResult>;
}

export interface SystemControl {
  setVolume(level: number): Promise<ToolResult>;
  control(command: string): Promise<ToolResult>;
  readClipboard(): Promise<ToolResult>;
  record(media: string, action: string): Promise<ToolResult>;
}

export interface FileAccess {
  read(path: string): Promise<ToolResult>;
  list(path: string): Promise<ToolResult>;
}

export interface ScreenCapture {
  screenshot(): Promise<ToolResult>;
}

/**
 * The phone's real Clock app, driven by the public `android.provider.AlarmClock`
 * intents. Every time-based thing JARVIS sets lands HERE — visible in the Clock,
 * editable by hand, and surviving a reboot — rather than in a private in-app
 * alarm the user can neither see nor trust. It is also not the accessibility
 * operator: these are documented intents, so there is no screen-driving to
 * misfire.
 */
export interface ClockControl {
  /** A one-off or repeating alarm at a wall-clock time. `days` may be "daily",
   *  "weekdays", "weekends", or "mon,wed,fri" — empty means a one-off. */
  setAlarm(hour: number, minute: number, label?: string, days?: string): Promise<ToolResult>;
  /** A countdown timer of `seconds`. */
  setTimer(seconds: number, label?: string): Promise<ToolResult>;
  showAlarms(): Promise<ToolResult>;
  showTimers(): Promise<ToolResult>;
  dismissTimer(): Promise<ToolResult>;
}

/**
 * The phone's real calendar. Agenda items are mirrored here so they appear in
 * Google Calendar (and on the user's other devices) rather than only inside
 * JARVIS — same reasoning as ClockControl.
 */
export interface CalendarControl {
  /** Insert an event. Resolves with `eventId` when it was written directly; the
   *  permission-less fallback opens the calendar's own new-event screen instead,
   *  in which case there is no id to return. */
  add(
    title: string,
    startMillis: number,
    endMillis?: number,
    notes?: string,
  ): Promise<ToolResult & { eventId?: number }>;
  remove(eventId: number): Promise<ToolResult>;
  show(atMillis?: number): Promise<ToolResult>;
  /** Ask for calendar access. Called when the user turns sync on, so the system
   *  dialog isn't racing an activity JARVIS is launching at the same moment. */
  requestPermission(): Promise<ToolResult>;
}

export interface Platform {
  apps: AppControl;
  system: SystemControl;
  files: FileAccess;
  screen: ScreenCapture;
  phone: PhoneController;
  clock: ClockControl;
  calendar: CalendarControl;
  openAccessibilitySettings(): Promise<ToolResult>;
}

/** Commands that legitimately block on the USER (a system folder picker, a
 *  permission screen), so they must not be bounded by the watchdog below. */
const UNBOUNDED_COMMANDS = new Set([
  "pick_folder",
  "request_overlay_permission",
  "open_accessibility_settings",
]);

/** Ceiling for one native command. Several @Commands resolve their Invoke from an
 *  Android callback (gesture results, most of all) and Android does not guarantee
 *  those callbacks fire — an unresolved Invoke used to hang the awaiting JS forever,
 *  wedging the whole phone_task loop until the app was restarted. Generous enough
 *  that a slow-but-real action still completes. */
const PHONE_INVOKE_TIMEOUT_MS = 15_000;

async function phoneInvoke(
  cmd: string,
  args: Record<string, unknown> = {},
): Promise<ToolResult & { eventId?: number }> {
  if (!inTauri()) {
    return { ok: false, summary: "This only works on the device.", error: "not_on_device" };
  }
  try {
    const call = invoke(`plugin:phone|${cmd}`, args);
    const res = (await (UNBOUNDED_COMMANDS.has(cmd)
      ? call
      : Promise.race([
          call,
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error(`native '${cmd}' did not respond`)),
              PHONE_INVOKE_TIMEOUT_MS,
            ),
          ),
        ]))) as {
      ok?: boolean;
      summary?: string;
      code?: string;
      generation?: number;
      eventId?: number;
    };
    return {
      ok: Boolean(res?.ok),
      summary: String(res?.summary ?? ""),
      error: res?.ok ? undefined : String(res?.code || "native_action_failed"),
      data: res?.generation === undefined ? undefined : { generation: res.generation },
      // Kotlin returns this for calendar adds and Rust's CalendarResponse carries it,
      // but rebuilding the result object here used to drop it — so the stored
      // calendarEventId was always undefined and a mirrored event could never be
      // deleted. The `as Promise<... & {eventId?: number}>` cast at the calendar.add
      // call site was asserting something that was never true.
      ...(typeof res?.eventId === "number" ? { eventId: res.eventId } : {}),
    };
  } catch (err) {
    return { ok: false, summary: `Failed: ${String(err)}`, error: "plugin_error" };
  }
}

/** A native command whose reply is passed through as-is (not flattened into a
 *  ToolResult), with the same ceiling as phoneInvoke. Null on any failure. */
async function phoneJson<T>(cmd: string, args: Record<string, unknown>): Promise<T | null> {
  if (!inTauri()) return null;
  try {
    return (await Promise.race([
      invoke<T>(`plugin:phone|${cmd}`, args),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`native '${cmd}' did not respond`)), PHONE_INVOKE_TIMEOUT_MS),
      ),
    ])) as T;
  } catch {
    return null;
  }
}

/** Raw base64 PNG, or null on any failure — the one native screenshot call both the
 *  operator's vision path (needs just the bytes) and the `screen` tool (needs a
 *  ToolResult) build on. */
async function captureScreenshotBase64(): Promise<string | null> {
  if (!inTauri()) return null;
  try {
    const res = await invoke<{ ok: boolean; base64?: string }>("plugin:phone|capture_screenshot");
    return res?.ok && res.base64 ? res.base64 : null;
  } catch {
    return null;
  }
}

// ── Read-only file access (Storage Access Framework) ──
// Scoped to ONE user-granted folder tree at a time. The tree URI is persisted here
// (not natively) so Settings can show/change it and every read_file/list_directory
// call can pass it back to the plugin without re-prompting the user.
const FOLDER_KEY = "jarvis.android.grantedFolder.v1";
const folderKv = makeKV();

export interface GrantedFolder {
  uri: string;
  name: string;
}

export function getGrantedFolder(): GrantedFolder | null {
  return readJson<GrantedFolder | null>(folderKv, FOLDER_KEY, null);
}

function setGrantedFolder(folder: GrantedFolder): void {
  writeJson(folderKv, FOLDER_KEY, folder);
}

/** Open Android's folder picker and persist the granted tree for later reads. */
export async function pickGrantedFolder(): Promise<ToolResult & { folder?: GrantedFolder }> {
  if (!inTauri()) {
    return { ok: false, summary: "This only works on the device.", error: "not_on_device" };
  }
  try {
    const res = await invoke<{ ok: boolean; summary: string; uri?: string; name?: string }>(
      "plugin:phone|pick_folder",
    );
    if (!res.ok || !res.uri) return { ok: false, summary: res.summary };
    const folder: GrantedFolder = { uri: res.uri, name: res.name ?? res.uri };
    setGrantedFolder(folder);
    return { ok: true, summary: res.summary, folder };
  } catch (err) {
    return { ok: false, summary: `Failed: ${String(err)}`, error: "plugin_error" };
  }
}

const tauriPhone: PhoneController = {
  async isEnabled() {
    if (!inTauri()) return false;
    try {
      const res = (await invoke("plugin:phone|is_enabled")) as { enabled?: boolean };
      return Boolean(res?.enabled);
    } catch {
      return false;
    }
  },
  // The operator loop runs natively; see operator/controller.ts for why.
  async operatorStart(spec) {
    const res = await phoneJson<OperatorStartResult>("operator_start", { ...spec });
    return res ?? { ok: false, summary: "The phone plugin did not respond.", error: "plugin_error" };
  },
  async operatorStatus(taskId, since) {
    const res = await phoneJson<OperatorStatus>("operator_status", { taskId, since });
    return res ?? { ok: false, summary: "The phone plugin did not respond." };
  },
  async beginTask(spec) {
    if (!inTauri()) {
      return { ok: false, summary: "This only works on the device.", error: "not_on_device" };
    }
    try {
      const res = await invoke<{
        ok?: boolean;
        summary?: string;
        taskId?: string;
        state?: string;
        eventSeq?: number;
        created?: boolean;
        idempotent?: boolean;
        result?: string;
        cancelRequested?: boolean;
        verified?: boolean;
        verificationReceipt?: string;
        verificationDigest?: string;
        verifiedAtMs?: number;
      }>("plugin:phone|task_begin", { ...spec });
      return {
        ok: Boolean(res?.ok),
        summary: String(res?.summary || ""),
        error: res?.ok ? undefined : "native_action_failed",
        data: {
          taskId: String(res?.taskId || spec.taskId),
          state: String(res?.state || "planning"),
          eventSeq: Number(res?.eventSeq || 0),
          created: Boolean(res?.created),
          idempotent: Boolean(res?.idempotent),
          result: String(res?.result || ""),
          cancelRequested: Boolean(res?.cancelRequested),
          verified: Boolean(res?.verified),
          verificationReceipt: String(res?.verificationReceipt || ""),
          verificationDigest: String(res?.verificationDigest || ""),
          verifiedAtMs: Number(res?.verifiedAtMs || 0),
        },
      };
    } catch (err) {
      return { ok: false, summary: `Failed: ${String(err)}`, error: "plugin_error" };
    }
  },
  checkpointTask: (checkpoint) => phoneInvoke("task_checkpoint", { ...checkpoint }),
  finishTask: (taskId, state, result, verificationReceipt = "") =>
    phoneInvoke("task_finish", { taskId, state, result, verificationReceipt }),
  cancelTask: (taskId) => phoneInvoke("task_cancel", { taskId }),
  async isTaskCancelled(taskId) {
    if (!inTauri()) return false;
    try {
      const status = await invoke<{ ok?: boolean; cancelRequested?: boolean; state?: string }>(
        "plugin:phone|task_status",
        { taskId },
      );
      return Boolean(status?.cancelRequested || status?.state === "cancelled");
    } catch {
      // A broken cancellation poll must not authorize any action; the action itself
      // remains generation-bound and the native STOP invalidates its lease.
      return true;
    }
  },
};

/** Real on-device platform — phone plugin + honest off-device fallbacks. */
/** Settings' calendar toggle asks for access through here — see CalendarControl. */
export function requestCalendarPermission(): Promise<ToolResult> {
  return androidPlatform.calendar.requestPermission();
}

export const androidPlatform: Platform = {
  apps: {
    open: (name) => phoneInvoke("open_app", { name }),
    close: (name) => phoneInvoke("close_app", { name }),
    openUrl: (url) => phoneInvoke("open_url", { url }),
    openSavedFile: (name) =>
      phoneInvoke("open_url", {
        url: name.startsWith("http") ? name : `file://${name}`,
      }),
  },
  system: {
    setVolume: (level) => phoneInvoke("set_volume", { level: Math.round(level) }),
    control: (command) => {
      const c = command.toLowerCase();
      if (c.includes("mute")) {
        return phoneInvoke("set_volume", { level: 0 });
      }
      // volume_down used to match nothing and fall through to the generic Settings
      // screen; both relative steps get the same honest treatment, since the native
      // set_volume command only takes an absolute 0-100 level and there is no way
      // to read the current one back.
      // ponytail: opens the sound panel instead of stepping the volume. Upgrade path
      // is AudioManager.adjustStreamVolume behind the existing set_volume command.
      if (
        c.includes("volume_up") ||
        c.includes("volume_down") ||
        c.includes("louder") ||
        c.includes("quieter")
      ) {
        return phoneInvoke("open_system_settings", { target: "sound" }).then((r) =>
          r.ok ? { ok: true, summary: "Opened sound settings — use the volume keys." } : r,
        );
      }
      // play_pause / next / previous have NO implementation anywhere (no Kotlin
      // dispatchMediaKeyEvent, no media-session plumbing). They used to fall through
      // to opening the Settings app and report ok:true, so JARVIS claimed it had
      // paused music it never touched.
      // ponytail: AudioManager.dispatchMediaKeyEvent is the fix; needs a new native
      // command, so it is a deliberate honest failure until then.
      if (c.includes("play") || c.includes("pause") || c === "next" || c === "previous") {
        return Promise.resolve({
          ok: false,
          summary: "I can't control media playback on Android yet, sir.",
          error: "not_implemented",
        });
      }
      if (
        c.includes("wifi") ||
        c.includes("bluetooth") ||
        c.includes("battery") ||
        c.includes("location") ||
        c.includes("settings")
      ) {
        return phoneInvoke("open_system_settings", { target: c });
      }
      return phoneInvoke("open_system_settings", { target: "settings" });
    },
    readClipboard: () => phoneInvoke("read_clipboard"),
    record: (_media, _action) => {
      // "stop" used to return ok:true with a summary that says the feature does not
      // exist — a contradiction, and the brain took the ok:true as "done". There is
      // nothing to stop because there is nothing to start; both directions fail.
      return Promise.resolve({
        ok: false,
        summary: "Screen/audio recording isn't available on the phone yet.",
        error: "not_implemented",
      });
    },
  },
  files: {
    read: async (path) => {
      const folder = getGrantedFolder();
      if (!folder) {
        return {
          ok: false,
          summary: "No folder has been granted yet — choose one in Settings ▸ Storage & Privacy.",
          error: "not_implemented",
        };
      }
      if (!inTauri()) return { ok: false, summary: "This only works on the device." };
      try {
        const res = await invoke<{ ok: boolean; summary: string; content?: string }>(
          "plugin:phone|read_file",
          { uri: folder.uri, path },
        );
        return res.ok
          ? { ok: true, summary: res.content ?? res.summary }
          : { ok: false, summary: res.summary };
      } catch (err) {
        return { ok: false, summary: `Failed: ${String(err)}`, error: "plugin_error" };
      }
    },
    list: async (path) => {
      const folder = getGrantedFolder();
      if (!folder) {
        return {
          ok: false,
          summary: "No folder has been granted yet — choose one in Settings ▸ Storage & Privacy.",
          error: "not_implemented",
        };
      }
      if (!inTauri()) return { ok: false, summary: "This only works on the device." };
      try {
        const res = await invoke<{
          ok: boolean;
          summary: string;
          entries?: Array<{ name: string; isDir: boolean }>;
        }>("plugin:phone|list_directory", { uri: folder.uri, path });
        if (!res.ok) return { ok: false, summary: res.summary };
        const listing = (res.entries ?? [])
          .map((e) => `${e.isDir ? "📁" : "📄"} ${e.name}`)
          .join("\n");
        return { ok: true, summary: listing || res.summary };
      } catch (err) {
        return { ok: false, summary: `Failed: ${String(err)}`, error: "plugin_error" };
      }
    },
  },
  screen: {
    screenshot: async () => {
      const base64 = await captureScreenshotBase64();
      return base64
        ? { ok: true, summary: "Captured screenshot.", images: [base64] }
        : { ok: false, summary: "Screenshot failed (null)." };
    },
  },
  phone: tauriPhone,
  clock: {
    setAlarm: (hour, minute, label = "", days = "") =>
      phoneInvoke("clock_action", { action: "alarm", hour, minute, label, days, seconds: 0 }),
    setTimer: (seconds, label = "") =>
      phoneInvoke("clock_action", { action: "timer", seconds, label, hour: -1, minute: 0, days: "" }),
    showAlarms: () => phoneInvoke("clock_action", { action: "show_alarms" }),
    showTimers: () => phoneInvoke("clock_action", { action: "show_timers" }),
    dismissTimer: () => phoneInvoke("clock_action", { action: "dismiss_timer" }),
  },
  calendar: {
    add: (title, startMillis, endMillis = 0, notes = "") =>
      phoneInvoke("calendar_action", {
        action: "add",
        title,
        startMillis,
        endMillis,
        notes,
        eventId: 0,
      }),
    remove: (eventId) =>
      phoneInvoke("calendar_action", { action: "remove", eventId, startMillis: 0, endMillis: 0 }),
    show: (atMillis = 0) =>
      phoneInvoke("calendar_action", { action: "show", startMillis: atMillis, endMillis: 0 }),
    requestPermission: () =>
      phoneInvoke("calendar_action", { action: "request_permission", startMillis: 0, endMillis: 0 }),
  },
  openAccessibilitySettings: () => phoneInvoke("open_accessibility_settings"),
};
