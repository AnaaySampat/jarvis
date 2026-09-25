/**
 * Tool registry — the palette advertised to the model, and the lowering of a tool
 * call to one internal ActionSpec.
 *
 * Direct port of `reference/python-backend-spec/llm/live_tools.py`:
 *   - `toolPalette()`      ← `function_declarations()`
 *   - `toSpec()`           ← `to_spec()` / `_SPEC`
 *   - `capabilitiesFor()`  ← `_capabilities()`
 *   - `toGeminiTools()`    ← the native Gemini `functionDeclarations` shape
 *   - `toOpenAITools()`    ← `openai_tools()` (lower-cased JSON-Schema types)
 *
 * Android changes vs desktop (see ../README.md "Tool dispositions"):
 *   - desktop automation tools (browser and computer control) are dropped on-device;
 *     they return only via the Phase-3 remote-PC path.
 *   - on-phone control (tap/type/scroll/read_screen) is added in Phase 2.
 */

import type { ActionSpec, Capabilities, ToolDeclaration, ToolParam } from "../types";
import type { BrainConfig as Cfg } from "../config";

const fn = (
  name: string,
  description: string,
  properties?: Record<string, ToolParam>,
  required?: string[],
): ToolDeclaration => {
  const decl: ToolDeclaration = { name, description };
  if (properties) {
    // Assigning to the typed property contextually types `type: "object"` to the
    // literal, so strict mode doesn't widen it to `string`.
    decl.parameters = { type: "object", properties, required: required ?? [] };
  }
  return decl;
};

const str = (description: string, en?: string[]) => ({
  type: "string" as const,
  description,
  ...(en ? { enum: en } : {}),
});
const int = (description: string) => ({ type: "integer" as const, description });

/**
 * What this install can actually DO — derived from the credentials present, not
 * from whichever tier happens to be generating text.
 *
 * This was keyed on `tier` alone, which was the "JARVIS can't web search" bug.
 * `webSearch()` in tools/http.ts grounds through `config.keys.gemini[0]` and works
 * regardless of which model is answering — but resolveBrainConfig() returns tier
 * "groq" whenever a Groq key exists (including when BOTH keys are set), and
 * capabilitiesFor("groq") reported webOk:false. So a user with a Gemini key sitting
 * right there was never offered `web_search` at all: the tool wasn't in the palette,
 * so the model couldn't call it and just answered from memory instead.
 *
 * Capability = "is the credential this tool needs present", which is a different
 * question from "who is generating the tokens".
 */
export function capabilitiesFor(cfg: Pick<Cfg, "tier" | "keys">): Capabilities {
  // Grounded search needs a Gemini Developer API key specifically. Vertex callers
  // carry one implicitly via the service account, so the tier still counts there.
  const webOk = Boolean(cfg.keys?.gemini?.length) || cfg.tier === "vertex";
  // Places is Vertex/ADC-only for now; everything else falls back to OpenStreetMap.
  const placesOk = cfg.tier === "vertex";
  return { placesOk, webOk };
}

/** Place/brand lookup tools, tier-tailored — port of `_location_lookup_tools`. */
function locationTools(cap: Capabilities): ToolDeclaration[] {
  const tools: ToolDeclaration[] = [];
  if (cap.webOk) {
    tools.push(
      fn(
        "web_search",
        "Look something up on the web and ANSWER it directly from live search " +
          "results — no browser opens. Use for current facts (news, prices, " +
          "scores, 'latest'/'today') and brand info." +
          (cap.placesOk
            ? " To find the NEAREST branch of a brand, use find_places."
            : " Also use it to find WHICH branch of a named brand is nearest."),
        { query: str("What to look up.") },
        ["query"],
      ),
    );
  }
  tools.push(
    fn(
      "find_places",
      cap.placesOk
        ? "Find places near the user (categories AND brands) and return the " +
            "nearest with exact distances."
        : "Find places near the user by CATEGORY (restaurants, cafés, ATMs…). " +
            (cap.webOk ? "For a named brand use web_search." : ""),
      { query: str("A category or place/brand name.") },
      ["query"],
    ),
  );
  tools.push(
    fn(
      "get_directions",
      "Precise driving distance + time from the user to a SPECIFIC place.",
      { destination: str("The specific place to measure to.") },
      ["destination"],
    ),
  );
  return tools;
}

/** Extra runtime facts the palette depends on but the config can't carry. */
export interface PaletteOpts {
  /** A Windows PC is paired → advertise `pc_task` (Phase 3). */
  pcPaired?: boolean;
}

/**
 * The full tool palette for the active config. A fresh array each call (callers
 * must not mutate a shared object) — mirrors `function_declarations()`.
 */
export function toolPalette(cfg: Cfg, opts: PaletteOpts = {}): ToolDeclaration[] {
  const cap = capabilitiesFor(cfg);
  return [
    // ── Native-API tools (Kotlin plugins, see platform/) ──
    fn(
      "take_screenshot",
      "Capture a screenshot and look at it (useful to see what is on the screen right now).",
    ),
    fn(
      "open_application",
      "Open / launch an app by name.",
      { name: str("App to open, e.g. 'whatsapp', 'maps'.") },
      ["name"],
    ),
    fn("close_application", "Close a running app by name.", { name: str("App to close.") }, [
      "name",
    ]),
    fn("open_website", "Open a URL.", { url: str("The full URL or domain.") }, ["url"]),
    fn("set_volume", "Set the media volume (0–100).", { level: int("Volume from 0 to 100.") }, [
      "level",
    ]),
    fn(
      "system_control",
      "Mute, or open the volume controls. To set a specific level use set_volume. " +
        "Media playback (play/pause/skip) is NOT available on Android.",
      {
        // play_pause/next/previous were advertised here with no implementation behind
        // them anywhere in Kotlin or Rust — the model called them and the action
        // silently opened the Settings app. Don't offer what the device can't do.
        command: str("The control.", ["mute", "volume_up", "volume_down"]),
      },
      ["command"],
    ),
    fn(
      "open_saved_file",
      "Open a file JARVIS saved (recording, screenshot, QR…).",
      { name: str("Which saved file.") },
      ["name"],
    ),
    fn(
      "record",
      "Start/stop recording audio, video, or the screen.",
      {
        media: str("What to record.", ["audio", "video", "screen"]),
        action: str("Start or stop.", ["start", "stop"]),
      },
      ["media", "action"],
    ),
    fn("read_clipboard", "Read what the user has copied."),
    fn(
      "read_file",
      "Read a text file the user grants access to.",
      { path: str("Path or name of the file.") },
      ["path"],
    ),
    fn(
      "list_directory",
      "List a directory the user grants access to.",
      { path: str("Path of the directory.") },
      ["path"],
    ),

    // ── Pure HTTP / logic tools (port straight from Python) ──
    fn(
      "make_qr_code",
      "Generate a QR code image for a URL or text.",
      { text: str("The exact url or text to encode.") },
      ["text"],
    ),
    fn(
      "generate_image",
      "Draw/create an image from a text description — you CAN do this, it returns a " +
        "real picture the user sees. Use for any 'draw', 'make a picture/logo/" +
        "wallpaper', or 'show me what X looks like' request.",
      { prompt: str("Description of the image.") },
      ["prompt"],
    ),
    fn("get_weather", "Current weather + a few days' forecast for the user."),
    fn("get_news", "Latest news headlines, optionally on a topic.", {
      topic: str("Optional topic or keyword."),
    }),
    fn(
      "set_my_location",
      "Pin or clear the user's location.",
      {
        action: str("'set' or 'clear'.", ["set", "clear"]),
        place: str("The place to pin (for 'set')."),
      },
      ["action"],
    ),
    ...locationTools(cap),

    // ── Brain-local tools (memory, schedule, time, chat) ──
    fn(
      "remember_fact",
      "Remember a durable fact about the user (third person).",
      { text: str("The fact to remember.") },
      ["text"],
    ),
    fn(
      "forget_fact",
      "Forget facts matching text, or 'everything'.",
      { text: str("Text to match, or 'everything'.") },
      ["text"],
    ),
    fn("clear_conversation", "Clear the chat log and start fresh."),
    fn("get_time", "Tell the user the current time."),
    fn("get_day", "Tell the user today's date / day of week."),
    fn(
      "set_reminder",
      "Remind the user of something at a wall-clock time. Adds it to the agenda AND " +
        "sets a matching alarm in the phone's Clock app. For a plain countdown " +
        "('5 minute timer') use set_timer instead.",
      {
        when: str("When to fire, e.g. 'in 10 minutes', 'at 3pm'."),
        text: str("What to remind about (optional)."),
      },
      ["when"],
    ),
    fn(
      "set_timer",
      "Start a countdown timer in the phone's Clock app.",
      {
        seconds: int("Length of the timer in seconds."),
        label: str("What the timer is for (optional)."),
      },
      ["seconds"],
    ),
    fn(
      "set_alarm",
      "Set an alarm in the phone's Clock app at a time of day.",
      {
        hour: int("Hour of day, 0-23."),
        minute: int("Minute, 0-59."),
        label: str("What the alarm is for (optional)."),
        days: str("Repeat: 'daily', 'weekdays', 'weekends', or 'mon,wed,fri'. Omit for one-off."),
      },
      ["hour", "minute"],
    ),
    fn(
      "manage_clock",
      "Open the Clock app's alarm or timer list, or stop a running timer.",
      { action: str("What to do.", ["show_alarms", "show_timers", "dismiss_timer"]) },
      ["action"],
    ),
    fn(
      "manage_routine",
      "Add/list/remove a recurring routine.",
      {
        action: str("What to do.", ["add", "list", "remove"]),
        time: str("Time of day for 'add'."),
        days: str("'daily', 'weekdays', 'weekends', or 'mon,wed,fri'."),
        prompt: str("What to do when it fires (add) or text to match (remove)."),
      },
      ["action"],
    ),
    fn(
      "manage_playbook",
      "Save a named prose reference draft, or list/remove playbooks. Prose drafts are disabled and never executable.",
      {
        action: str("What to do.", ["add", "list", "remove"]),
        name: str("The playbook's name."),
        steps: str("Reference notes in plain English (for 'add'); never replayed as actions."),
        triggers: str("Comma-separated trigger phrases (optional)."),
      },
      ["action"],
    ),
    fn(
      "manage_schedule",
      "Get/add/edit/remove items in the user's daily agenda.",
      {
        action: str("What to do.", ["get", "add", "edit", "remove", "clear"]),
        day: str("Which day (defaults to today)."),
        time: str("Time of the item (for add/edit)."),
        task: str("The task text (add; or match for edit/remove)."),
        new_time: str("New time when editing."),
        new_task: str("New task text when editing."),
      },
      ["action"],
    ),
    fn(
      "customize_screen",
      "Restyle/rearrange the HUD on request.",
      {
        action: str("What to change.", [
          "set_theme",
          "set_background",
          "set_density",
          "show_panel",
          "hide_panel",
          "show_all",
          "hide_all",
          "toggle_panel",
          "move_panel",
          "reset",
        ]),
        value: str("New value (colour / background / density)."),
        panel: str("Panel name for show/hide/toggle/move."),
        direction: str("up/down/left/right for move_panel."),
      },
      ["action"],
    ),
    fn(
      "control_interface",
      "Operate JARVIS's OWN app screen — open/close its panels and toggle its " +
        "controls. Use THIS (not phone_task) for anything inside the JARVIS app.",
      {
        action: str("What to do in the JARVIS interface.", [
          "open_chat",
          "close_chat",
          "open_settings",
          "close_settings",
          "open_memory",
          "close_memory",
          "open_activity",
          "close_activity",
          "open_customize",
          "close_customize",
          "open_remote",
          "close_remote",
          "listen",
          "stop_speaking",
          "mute",
          "unmute",
          "conversation_mode_on",
          "conversation_mode_off",
          "new_conversation",
          "clear_chat",
          "expand_all",
          "collapse_all",
        ]),
      },
      ["action"],
    ),

    // ── On-phone app control (Phase 2 — AccessibilityService) ──
    fn(
      "phone_task",
      "Do a WHOLE task in a phone app via the silent on-phone operator (it can " +
        "open apps, read the screen, tap, type, scroll). Give the complete goal.",
      {
        goal: str("The whole task, e.g. 'open WhatsApp and message X'."),
        stay_in_app: {
          type: "boolean" as const,
          description:
            "true when the user wants to END UP in that app — media playing, a chat or " +
            "page left open to look at. Omit or false when they want something found, " +
            "checked or done and reported back: JARVIS then returns to the front and " +
            "tells them the result.",
        },
      },
      ["goal"],
    ),
    fn(
      "enable_phone_control",
      "Open Android's Accessibility settings so the user can switch JARVIS on for " +
        "on-phone app control. Use when phone control is off or the user asks to enable it.",
    ),

    // ── Remote-control the PC (Phase 3 — forwarded to the Windows backend) ──
    // Only offered when a PC is actually paired, so the model never reaches for a
    // tool that can only answer "no PC is paired yet".
    ...(opts.pcPaired
      ? [
          fn(
            "pc_task",
            "Run a WHOLE task on the user's paired Windows PC (desktop apps or the " +
              "web) via the remote JARVIS. Use for anything that belongs on the " +
              "computer rather than the phone. Give the complete task.",
            {
              goal: str("The whole task to run on the PC."),
              kind: str(
                "Where it runs: 'browser' for anything inside a web browser " +
                  "(YouTube, Gmail, a website); 'computer' for native desktop apps, " +
                  "files, or Windows itself (Notepad, File Explorer, settings). " +
                  "Default 'browser'.",
                ["browser", "computer"],
              ),
            },
            ["goal"],
          ),
        ]
      : []),
  ];
}

// function name → ActionSpec builder. Port of `live_tools.py:_SPEC`.
const SPEC: Record<string, (a: Record<string, unknown>) => ActionSpec> = {
  take_screenshot: () => ({ type: "screenshot" }),
  open_application: (a) => ({ type: "open_app", target: a.name ?? "" }),
  close_application: (a) => ({ type: "close_app", target: a.name ?? "" }),
  open_website: (a) => ({ type: "open_url", url: a.url ?? "" }),
  web_search: (a) => ({ type: "search_web", query: a.query ?? "" }),
  set_volume: (a) => ({ type: "set_volume", level: a.level }),
  system_control: (a) => ({ type: "system", target: a.command ?? "" }),
  open_saved_file: (a) => ({ type: "open_file", target: a.name ?? "" }),
  make_qr_code: (a) => ({ type: "qr_code", text: a.text ?? "" }),
  generate_image: (a) => ({ type: "generate_image", prompt: a.prompt ?? "" }),
  record: (a) => ({ type: "record", media: a.media ?? "screen", do: a.action ?? "start" }),
  control_interface: (a) => ({ type: "ui", do: a.action ?? "" }),
  clear_conversation: () => ({ type: "ui", do: "clear_chat" }),
  read_file: (a) => ({ type: "read_file", path: a.path ?? "" }),
  list_directory: (a) => ({ type: "list_dir", path: a.path ?? "" }),
  remember_fact: (a) => ({ type: "remember", text: a.text ?? "" }),
  forget_fact: (a) => ({ type: "forget", text: a.text ?? "" }),
  read_clipboard: () => ({ type: "clipboard" }),
  manage_routine: (a) => ({
    type: "routine",
    do: a.action ?? "list",
    time: a.time ?? "",
    days: a.days ?? "daily",
    prompt: a.prompt ?? "",
    match: a.prompt ?? "",
  }),
  get_weather: () => ({ type: "weather" }),
  find_places: (a) => ({ type: "places", query: a.query ?? "" }),
  get_directions: (a) => ({ type: "directions", destination: a.destination ?? "" }),
  set_my_location: (a) => ({ type: "set_location", do: a.action ?? "set", place: a.place ?? "" }),
  get_news: (a) => ({ type: "news", topic: a.topic ?? "" }),
  set_reminder: (a) => ({ type: "reminder", when: a.when ?? "", text: a.text ?? "" }),
  set_timer: (a) => ({
    type: "clock",
    do: "timer",
    seconds: Number(a.seconds ?? 0),
    label: a.label ?? "",
  }),
  set_alarm: (a) => ({
    type: "clock",
    do: "alarm",
    hour: Number(a.hour ?? -1),
    minute: Number(a.minute ?? 0),
    label: a.label ?? "",
    days: a.days ?? "",
  }),
  manage_clock: (a) => ({ type: "clock", do: a.action ?? "show_alarms" }),
  manage_playbook: (a) => ({
    type: "playbook",
    do: a.action ?? "list",
    name: a.name ?? "",
    steps: a.steps ?? "",
    triggers: a.triggers ?? "",
    query: a.name ?? "",
  }),
  customize_screen: (a) => ({
    type: "screen",
    do: a.action ?? "",
    value: a.value ?? "",
    panel: a.panel ?? "",
    direction: a.direction ?? "",
  }),
  manage_schedule: (a) => ({
    type: "schedule",
    do: a.action ?? "get",
    day: a.day ?? "",
    time: a.time ?? "",
    task: a.task ?? "",
    match: a.task ?? "",
    new_time: a.new_time ?? "",
    new_task: a.new_task ?? "",
  }),
  get_time: () => ({ type: "time" }),
  get_day: () => ({ type: "day" }),
  // Android-specific
  phone_task: (a) => ({
    type: "phone_task",
    goal: a.goal ?? "",
    stayInApp: a.stay_in_app === true,
  }),
  enable_phone_control: () => ({ type: "open_a11y_settings" }),
  pc_task: (a) => ({
    type: "pc_task",
    goal: a.goal ?? "",
    kind: a.kind === "computer" ? "computer" : "browser",
  }),
};

/** Lower a tool call to one internal ActionSpec. Port of `to_spec()`. */
export function toSpec(name: string, args?: Record<string, unknown>): ActionSpec {
  const a = args ?? {};
  const builder = SPEC[name];
  return builder ? builder(a) : { type: name, ...a };
}

// ── Wire-shape converters (single source of truth = `toolPalette`) ──

/** Gemini `functionDeclarations` shape (UPPER-CASE type enum). */
export function toGeminiTools(tools: ToolDeclaration[]): Record<string, unknown>[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    ...(t.parameters ? { parameters: upperTypes(t.parameters) } : {}),
  }));
}

/** OpenAI/Groq `tools` shape (lower-case JSON-Schema type). Port of `openai_tools()`. */
export function toOpenAITools(tools: ToolDeclaration[]): Record<string, unknown>[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters ?? { type: "object", properties: {} },
    },
  }));
}

function upperTypes(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(upperTypes);
  if (schema && typeof schema === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema)) {
      if (k === "type" && typeof v === "string") out[k] = v.toUpperCase();
      else if (k === "properties" && v && typeof v === "object") {
        out[k] = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, upperTypes(pv)]));
      } else out[k] = upperTypes(v);
    }
    return out;
  }
  return schema;
}
