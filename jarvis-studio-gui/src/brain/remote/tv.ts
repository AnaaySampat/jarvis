/**
 * The user's Android TV, driven over network ADB: the TV's own "USB debugging" on the
 * home Wi-Fi, with the phone as the ADB client (PhonePlugin.tvShell → TvAdb.kt), so
 * nothing is installed on the TV.
 *
 * Every action reads the TV's state back before claiming it worked: the focused window
 * for app launches, AudioService for volume/mute, PowerManager for power, and the app's
 * media session for playback. A remote-button press has no readback and is reported as
 * sent, never as done. What was measured on the user's Sony KD-55X8500D (Android TV 8)
 * is in docs/STATUS.md "TV control"; the traps are repeated below where they bite.
 */

import { invoke } from "@tauri-apps/api/core";
import type { ToolResult } from "../types";
import { inTauri, resilientFetch } from "../tools/httpClient";
import { webSearch, type HttpToolCtx } from "../tools/http";

export interface ShellReply {
  /** The command ran on the TV (says nothing about whether it did what was meant). */
  ok: boolean;
  output: string;
  exitCode: number;
  /** Why the TV couldn't be reached, when !ok. */
  summary: string;
}
export type TvShell = ((command: string) => Promise<ShellReply>) & {
  /** Set once the TV's MAC is known: switch it on when it's fully off (wakeTv). */
  wake?: () => Promise<ToolResult | null>;
  /** A screenshot of the TV (TvAdb.capture), for look / task (remote/tvSight.ts). */
  capture?: () => Promise<TvCapture>;
};

/** A TV screenshot: `image` base64 JPEG; `blocked` = nothing capturable or all black (a
 *  copy-protected layer); `sig` a 64×36 grey signature (base64); `blank` one flat colour. */
export interface TvCapture {
  ok: boolean;
  image: string;
  blocked: boolean;
  blank: boolean;
  sig: string;
  summary: string;
}

/** Sends a Wake-on-LAN packet (platform wolSend → WakeOnLan.kt). */
export type WolSend = (mac: string, near: string) => Promise<ToolResult>;

/** What Android's media sessions say is playing on the phone (DirectActions.mediaNow). */
export interface PhoneMedia {
  ok: boolean;
  summary: string;
  package?: string;
  title?: string;
  artist?: string;
  playing?: boolean;
  /** Milliseconds into it, now. */
  position?: number;
}

export interface TvEnv {
  /** What's playing on the phone, for "send this to the TV" (cast with no link). */
  phoneMedia?(): Promise<PhoneMedia>;
  /** Pause the phone's player; true only when Android reports it paused. */
  pausePhone?(): Promise<boolean>;
  /** A YouTube video's title + channel → its id, checked against YouTube's own name. */
  findYoutube?(title: string, channel: string): Promise<{ id: string } | { error: string }>;
  /** A show/film name → its Netflix title id, plus Netflix's own name for it. */
  lookupNetflix(title: string): Promise<{ id: string; name: string } | { error: string }>;
  /** A show's season/episode → that episode's own Netflix id and title. */
  netflixEpisode(
    showId: string,
    season: number,
    episode: number,
  ): Promise<{ id: string; title: string } | { error: string }>;
  wait(ms: number): Promise<void>;
}

/** Which episode "play" should start; empty = resume wherever the profile left off. */
export interface EpisodePick {
  season?: number;
  episode?: number;
}

// Longer than TvAdb's 30s socket timeout: the first connection waits on the user
// accepting "Allow USB debugging?" on the TV.
const SHELL_TIMEOUT_MS = 45_000;

async function invokeTvCapture(host: string): Promise<TvCapture> {
  const fail = (summary: string): TvCapture => ({
    ok: false,
    image: "",
    blocked: false,
    blank: false,
    sig: "",
    summary,
  });
  if (!inTauri()) return fail("Seeing the TV only works on the phone.");
  try {
    const r = await Promise.race([
      invoke<Partial<TvCapture>>("plugin:phone|tv_capture", { host }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("The TV didn't respond.")), SHELL_TIMEOUT_MS),
      ),
    ]);
    return {
      ok: Boolean(r?.ok),
      image: String(r?.image ?? ""),
      blocked: Boolean(r?.blocked),
      blank: Boolean(r?.blank),
      sig: String(r?.sig ?? ""),
      summary: String(r?.summary ?? ""),
    };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

/** One shell call to one address: the native bridge (`plugin:phone|tv_shell`). */
export type AddressShell = (address: string, command: string) => Promise<ShellReply>;

async function invokeTvShell(host: string, command: string): Promise<ShellReply> {
  if (!inTauri()) {
    return {
      ok: false,
      output: "",
      exitCode: -1,
      summary: "TV control only works on the phone.",
    };
  }
  try {
    const r = await Promise.race([
      invoke<Partial<ShellReply>>("plugin:phone|tv_shell", { host, command }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("The TV didn't respond.")), SHELL_TIMEOUT_MS),
      ),
    ]);
    return {
      ok: Boolean(r?.ok),
      output: String(r?.output ?? ""),
      exitCode: Number(r?.exitCode ?? -1),
      summary: String(r?.summary ?? ""),
    };
  } catch (err) {
    return {
      ok: false,
      output: "",
      exitCode: -1,
      summary: err instanceof Error ? err.message : String(err),
    };
  }
}

/** The TV's addresses in a saved host ("192.168.1.20, 100.101.1.2"), in order. */
export function tvAddresses(host: string): string[] {
  const out: string[] = [];
  for (const part of (host ?? "").split(/[,;\s]+/)) {
    if (/^[A-Za-z0-9.-]{1,253}(:\d{1,5})?$/.test(part) && !out.includes(part)) out.push(part);
  }
  return out;
}

/** A failure that means "not reachable this way" (another address might work), as
 *  TvAdb.describe and the timeout above word it. */
function unreachable(summary: string): boolean {
  return /can't reach the TV|didn't answer in time|didn't respond/.test(summary);
}

/** Said when no address got through: a second router in router mode gives its Wi-Fi
 *  its own network, and the phone can't open a connection into it from the other one. */
export const OTHER_NETWORK_HINT =
  " If your home has two routers, the phone and the TV may be on different networks: " +
  "set the second router to Access Point mode, or install Tailscale on the TV and add " +
  "its 100.x address after a comma under Remote PC & TV.";

export interface TvWakeOpts {
  /** The TV's MAC, for waking it from off; "" / absent until known. */
  mac?: string;
  /** Called with the TV's MAC, read over ADB the first time the TV answers while
   *  `mac` isn't known yet — the caller saves it for next time. */
  onMac?: (mac: string) => void;
  send?: WolSend;
  wait?: (ms: number) => Promise<void>;
  /** The TV answered on a home-network (private) address: the phone is home. */
  onLan?: () => void;
}

/**
 * The TV's shell. `host` may list several addresses for the same TV — its address on
 * the home Wi-Fi, and its Tailscale address for when the phone is on another router's
 * network. Each is tried in turn when the last couldn't be reached; the one that
 * answered goes first next time, so a network change costs one connect timeout, once.
 */
export function nativeTvShell(
  host: string,
  shell: AddressShell = invokeTvShell,
  opts: TvWakeOpts = {},
  capture: (address: string) => Promise<TvCapture> = invokeTvCapture,
): TvShell {
  const addresses = tvAddresses(host);
  let preferred = 0;
  const run: TvShell = async (command) => {
    if (!addresses.length) {
      return { ok: false, output: "", exitCode: -1, summary: "That isn't a valid TV address." };
    }
    const order = [preferred, ...addresses.keys()].filter((i, n, a) => a.indexOf(i) === n);
    let last: ShellReply | null = null;
    for (const i of order) {
      const r = await shell(addresses[i]!, command);
      if (r.ok) {
        preferred = i;
        if (PRIVATE_V4.test(addresses[i]!)) opts.onLan?.();
        return r;
      }
      last = r;
      // Reached but refused (or failed): another path to the same TV won't change that.
      if (!unreachable(r.summary)) return r;
    }
    return { ...last!, summary: last!.summary + OTHER_NETWORK_HINT };
  };
  let askedMac = false;
  const out: TvShell = async (command) => {
    const r = await run(command);
    if (r.ok && !opts.mac && opts.onMac && !askedMac) {
      askedMac = true;
      const link = await run("ip -o link");
      const mac = link.ok ? macFromIpLink(link.output) : "";
      if (mac) opts.onMac(mac);
    }
    return r;
  };
  // Screenshots go to the address that answered last, then the others, like commands.
  out.capture = async () => {
    const order = [preferred, ...addresses.keys()].filter((i, n, a) => a.indexOf(i) === n);
    let last: TvCapture | null = null;
    for (const i of order) {
      const c = await capture(addresses[i]!);
      if (c.ok) {
        preferred = i;
        return c;
      }
      last = c;
      if (!unreachable(c.summary)) return c;
    }
    return (
      last ?? {
        ok: false,
        image: "",
        blocked: false,
        blank: false,
        sig: "",
        summary: "That isn't a valid TV address.",
      }
    );
  };
  const { mac, send } = opts;
  if (mac && send) {
    // The TV's home-network address (not its Tailscale one) gives the subnet broadcast.
    const near = addresses.find((a) => PRIVATE_V4.test(a)) ?? "";
    out.wake = () => wakeTv(run, mac, near, send, opts.wait ?? sleep);
  }
  return out;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const PRIVATE_V4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

/** "AA-BB-CC-DD-EE-FF" / "aabbccddeeff" → "aa:bb:cc:dd:ee:ff"; "" if it isn't one. */
export function normMac(raw: unknown): string {
  const hex = String(raw ?? "")
    .trim()
    .toLowerCase();
  const m =
    /^([0-9a-f]{2})[:-]?([0-9a-f]{2})[:-]?([0-9a-f]{2})[:-]?([0-9a-f]{2})[:-]?([0-9a-f]{2})[:-]?([0-9a-f]{2})$/.exec(
      hex,
    );
  const mac = m ? m.slice(1).join(":") : "";
  return mac === "00:00:00:00:00:00" || mac === "ff:ff:ff:ff:ff:ff" ? "" : mac;
}

/** The MAC of the TV's connected interface, from its `ip -o link`: Ethernet if it's
 *  plugged in, else Wi-Fi. "" if none is up. */
export function macFromIpLink(text: string): string {
  const up = new Map<string, string>();
  for (const line of (text ?? "").split("\n")) {
    const m = /^\d+:\s*([\w.@-]+):\s*<([^>]*)>.*?link\/ether\s+([0-9a-f:]{17})/.exec(line.trim());
    if (!m) continue;
    const flags = m[2]!.split(",");
    const mac = normMac(m[3]);
    if (flags.includes("UP") && flags.includes("LOWER_UP") && mac)
      up.set(m[1]!.split("@")[0]!, mac);
  }
  for (const prefix of ["eth", "wlan"]) {
    for (const [name, mac] of up) if (name.startsWith(prefix)) return mac;
  }
  return up.values().next().value ?? "";
}

const WAKE_WAIT_MS = 30_000;

/**
 * If the TV can't be reached at all (fully off, or deep standby with its network
 * down), send its MAC a Wake-on-LAN packet and wait for ADB to answer again. Null:
 * it answered (or failed some other way, which the command itself will report) —
 * carry on as usual. Mirrors the desktop's actions/tv.py `wake`.
 */
export async function wakeTv(
  shell: TvShell,
  mac: string,
  near: string,
  send: WolSend,
  wait: (ms: number) => Promise<void>,
  now: () => number = Date.now,
): Promise<ToolResult | null> {
  const probe = await shell("echo ok");
  if (probe.ok || !unreachable(probe.summary)) return null;
  const sent = await send(mac, near.split(":")[0] ?? "");
  if (!sent.ok)
    return { ok: false, summary: sent.summary || "The wake-up packet couldn't be sent." };
  const deadline = now() + WAKE_WAIT_MS;
  while (now() < deadline) {
    await wait(2000);
    if ((await shell("echo ok")).ok) return { ok: true, summary: "Woke the TV over the network." };
  }
  return {
    ok: false,
    error: "tv_unreachable",
    // Both causes, not just "off": on 2026-10-20 the TV was on (the phone could reach it)
    // while the PC couldn't for minutes at a time, and Remote start was already on.
    summary:
      "I couldn't reach the TV, so I sent it a wake-up packet, but it still didn't answer " +
      "within 30 seconds. If it's off, Settings → Network → Remote start on the TV (it may " +
      "be called 'Turn on with Wi-Fi/LAN') lets me wake it; if it's on, the phone can't " +
      "reach it over the Wi-Fi right now.",
  };
}

export function tvEnv(
  ctx: HttpToolCtx,
  phone: Pick<TvEnv, "phoneMedia" | "pausePhone"> = {},
): TvEnv {
  return {
    ...phone,
    findYoutube: (title, channel) => findYoutubeVideo(title, channel, ctx),
    lookupNetflix: (title) => lookupNetflixTitle(title, ctx),
    netflixEpisode,
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

// ── "Send this to the TV": links, and what's playing on the phone ────────────

export type MediaLink =
  | { service: "youtube"; id: string; t: number }
  | { service: "netflix"; kind: "watch" | "title"; id: string };

/** "90", "90s", "1m30s", "1h2m3s" → seconds (YouTube's t= / start=). */
function linkSeconds(raw: string): number {
  const t = (raw ?? "").trim().toLowerCase();
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
  if (!m || !(m[1] || m[2] || m[3])) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/** A YouTube or Netflix link → which video/title, or null. Mirrors the desktop's
 *  actions/now_playing.py parse_link; takes links without https:// too. */
export function parseLink(raw: string): MediaLink | null {
  const text = (raw ?? "").trim();
  // A share often wraps the link in words ("Watch this! https://youtu.be/…").
  const found =
    /(?:https?:\/\/)?(?:[a-z0-9-]+\.)*(?:youtube\.com|youtu\.be|netflix\.com)\/\S*/i.exec(text);
  if (!found) return null;
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(found[0]) ? found[0] : `https://${found[0]}`);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const parts = u.pathname.split("/").filter(Boolean);
  if (["youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"].includes(host)) {
    let id = "";
    if (host === "youtu.be") id = parts[0] ?? "";
    else if (parts[0] === "watch") id = u.searchParams.get("v") ?? "";
    else if (["shorts", "live", "embed"].includes(parts[0] ?? "")) id = parts[1] ?? "";
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
    return {
      service: "youtube",
      id,
      t: linkSeconds(u.searchParams.get("t") ?? u.searchParams.get("start") ?? ""),
    };
  }
  if (host === "netflix.com") {
    const at =
      parts[0] === "watch" || parts[0] === "title"
        ? 0
        : parts[1] === "watch" || parts[1] === "title"
          ? 1
          : -1;
    if (at >= 0 && /^\d+$/.test(parts[at + 1] ?? "")) {
      return { service: "netflix", kind: parts[at] as "watch" | "title", id: parts[at + 1]! };
    }
    const jbv = u.searchParams.get("jbv") ?? "";
    if (/^\d+$/.test(jbv)) return { service: "netflix", kind: "title", id: jbv };
  }
  return null;
}

const PHONE_YOUTUBE = [
  "com.google.android.youtube",
  "com.google.android.apps.youtube.music",
  "app.revanced.android.youtube",
];
const PHONE_NETFLIX = "com.netflix.mediaclient";

function clock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/**
 * "Send this to the TV": a YouTube/Netflix link in `target`, else whatever is playing
 * on the phone. YouTube carries on at the same point and is paused on the phone only
 * once the TV plays it; Netflix is paused first, so the TV resumes where it stopped.
 */
async function castToTv(tv: Tv, target: string, env: TvEnv): Promise<ToolResult> {
  if (target.trim()) {
    const link = parseLink(target);
    if (!link)
      return { ok: false, summary: "That isn't a YouTube or Netflix link I can play on the TV." };
    return tv.cast(link, link.service === "youtube" ? link.t : 0);
  }
  if (!env.phoneMedia) return { ok: false, summary: "I can't see what's playing on this phone." };
  const now = await env.phoneMedia();
  if (!now.ok) return { ok: false, summary: now.summary || "Nothing is playing on the phone." };
  const title = (now.title ?? "").trim();
  const pkg = now.package ?? "";
  const pause = async (r: ToolResult, before = false): Promise<ToolResult> => {
    const paused = env.pausePhone ? await env.pausePhone() : false;
    if (before) return r;
    return {
      ...r,
      summary:
        r.summary + (paused ? " Paused it on the phone." : " (I couldn't pause it on the phone.)"),
    };
  };
  if (PHONE_YOUTUBE.includes(pkg)) {
    if (!title || !env.findYoutube)
      return { ok: false, summary: "I can't tell which YouTube video is playing." };
    const found = await env.findYoutube(title, now.artist ?? "");
    if ("error" in found) return { ok: false, summary: found.error };
    const r = await tv.cast(
      { service: "youtube", id: found.id, t: 0 },
      Math.floor((now.position ?? 0) / 1000),
      title,
    );
    return r.ok ? pause(r) : r;
  }
  if (pkg === PHONE_NETFLIX) {
    const show = title
      ? await env.lookupNetflix(title)
      : { error: "I can't tell what's playing on Netflix." };
    if ("error" in show) return { ok: false, summary: show.error };
    const paused = env.pausePhone ? await env.pausePhone() : false;
    if (paused) await env.wait(3000); // let Netflix save where it is
    const r = await tv.cast({ service: "netflix", kind: "title", id: show.id }, 0, show.name);
    return paused
      ? {
          ...r,
          summary: r.summary + (r.ok ? " Paused it on the phone." : " (It's paused on the phone.)"),
        }
      : r;
  }
  return {
    ok: false,
    summary: `“${title || "That"}” is playing in ${pkg || "an app"}; only YouTube and Netflix can be sent to the TV.`,
  };
}

/** A YouTube video id for a title + channel: web search for its link, then YouTube's
 *  own oEmbed name for that id has to match the title (the Netflix lookup's rule). */
export async function findYoutubeVideo(
  title: string,
  channel: string,
  ctx: HttpToolCtx,
): Promise<{ id: string } | { error: string }> {
  const t = title.trim();
  const r = await webSearch(
    `YouTube video "${t}"${channel ? ` by ${channel}` : ""}: reply with its https://www.youtube.com/watch?v= link.`,
    ctx,
  );
  if (!r.ok) return { error: `I couldn't look up “${t}” on YouTube: ${r.summary}` };
  const ids = [
    ...r.summary.matchAll(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/g),
  ].map((m) => m[1]!);
  for (const id of [...new Set(ids)].slice(0, 3)) {
    try {
      const res = await resilientFetch(
        `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`,
        {},
        15_000,
      );
      const o = res.ok ? ((await res.json()) as { title?: string }) : null;
      if (o?.title && sameTitle(o.title, t)) return { id };
    } catch {
      /* try the next one */
    }
  }
  return { error: `I couldn't find which YouTube video “${t}” is.` };
}

const NETFLIX = "com.netflix.ninja";
const YOUTUBE = "com.google.android.youtube.tv";

/** Spoken app name (lower-case, letters and digits only) → package. Anything else is
 *  matched against the TV's installed package names. */
const APPS: Record<string, string> = {
  netflix: NETFLIX,
  youtube: YOUTUBE,
  primevideo: "com.amazon.amazonvideo.livingroom",
  amazonprime: "com.amazon.amazonvideo.livingroom",
  amazonprimevideo: "com.amazon.amazonvideo.livingroom",
  prime: "com.amazon.amazonvideo.livingroom",
  hotstar: "in.startv.hotstar",
  jiohotstar: "in.startv.hotstar",
  disneyhotstar: "in.startv.hotstar",
  sonyliv: "com.sonyliv",
  spotify: "com.spotify.tv.android",
  playstore: "com.android.vending",
  googleplay: "com.android.vending",
  settings: "com.android.tv.settings",
};
const APP_NAMES: Record<string, string> = {
  [NETFLIX]: "Netflix",
  [YOUTUBE]: "YouTube",
  "com.amazon.amazonvideo.livingroom": "Prime Video",
  "in.startv.hotstar": "Hotstar",
  "com.sonyliv": "SonyLIV",
  "com.spotify.tv.android": "Spotify",
  "com.android.vending": "the Play Store",
  "com.android.tv.settings": "Settings",
  "com.google.android.tvlauncher": "the home screen",
  "com.google.android.leanbacklauncher": "the home screen",
};

/** Remote buttons → Android keycodes. */
const KEYS: Record<string, number> = {
  up: 19,
  down: 20,
  left: 21,
  right: 22,
  ok: 23,
  select: 23,
  enter: 23,
  back: 4,
  home: 3,
  play_pause: 85,
  play: 126,
  pause: 127,
  stop: 86,
  next: 87,
  previous: 88,
  fast_forward: 90,
  rewind: 89,
  channel_up: 166,
  channel_down: 167,
  input: 178,
  settings: 176,
  captions: 175,
};
const KEY_SLEEP = 223;
const KEY_WAKEUP = 224;
const KEY_MUTE = 164;

const PACKAGE = /^[A-Za-z0-9_.]+$/;
const alnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** POSIX single-quoting: the only safe way to put any text into a TV shell command. */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export async function runTvControl(
  shell: TvShell,
  action: string,
  target: string,
  app: string,
  env: TvEnv,
  pick: EpisodePick = {},
): Promise<ToolResult> {
  const tv = new Tv(shell, env.wait);
  // A TV that's fully off can't be reached at all: wake it first (when its MAC is known).
  let woke: ToolResult | null = null;
  if (shell.wake && ["power_on", "play", "open_app", "cast"].includes(action)) {
    woke = await shell.wake();
    if (woke && !woke.ok) return woke;
  }
  try {
    switch (action) {
      case "open_app":
        return await tv.openApp(target);
      case "play":
        if (!target.trim()) return await tv.playback("play");
        return alnum(app) === "youtube"
          ? await tv.youtubePlay(target)
          : await tv.netflixPlay(target, env, pick);
      case "pause":
      case "resume":
        return await tv.playback(action === "pause" ? "pause" : "play");
      case "volume_up":
      case "volume_down":
        return await tv.volumeStep(action === "volume_up" ? 1 : -1, parseInt(target, 10) || 5);
      case "set_volume":
        return await tv.setVolume(parseInt(target, 10));
      case "mute":
        return await tv.toggleMute();
      case "cast":
        return await castToTv(tv, target, env);
      case "power_on": {
        const r = await tv.power(true);
        return r.ok && woke
          ? { ok: true, summary: "Turned the TV on (woke it over the network)." }
          : r;
      }
      case "power_off":
        return await tv.power(false);
      case "key":
        return await tv.key(target);
      case "status":
        return await tv.status();
      default:
        return { ok: false, summary: `I don't know the TV action '${action}'.` };
    }
  } catch (err) {
    if (err instanceof TvUnreachable)
      return { ok: false, summary: err.message, error: "tv_unreachable" };
    throw err;
  }
}

export class TvUnreachable extends Error {}

/** What the user would call the app with this package ("Netflix", "the home screen"). */
export function appLabel(pkg: string): string {
  return APP_NAMES[pkg] ?? pkg;
}

interface Session {
  state: number;
  position: number;
  /** When the app last reported its state (the TV's uptime, ms). */
  updated: number;
}

export class Tv {
  constructor(
    private readonly shell: TvShell,
    private readonly wait: (ms: number) => Promise<void>,
  ) {}

  private async sh(command: string): Promise<string> {
    const r = await this.shell(command);
    if (!r.ok) throw new TvUnreachable(r.summary || "I couldn't reach the TV.");
    return r.output;
  }

  private async keyevent(...codes: number[]): Promise<void> {
    await this.sh(`input keyevent ${codes.join(" ")}`);
  }

  /** The package in front, or "" when the focused window isn't an app's (e.g. an overlay). */
  async focusedPackage(): Promise<string> {
    const out = await this.sh("dumpsys window | grep mCurrentFocus");
    return /mCurrentFocus=Window\{\S+ \S+ ([A-Za-z0-9_.]+)\//.exec(out)?.[1] ?? "";
  }

  private async waitForFocus(pkg: string, tries = 10): Promise<boolean> {
    for (let i = 0; i < tries; i++) {
      if ((await this.focusedPackage()) === pkg) return true;
      await this.wait(1000);
    }
    return false;
  }

  async resolveApp(name: string): Promise<string | null> {
    const key = alnum(name);
    if (!key) return null;
    if (APPS[key]) return APPS[key];
    const out = await this.sh("pm list packages");
    const matches = out
      .split("\n")
      .map((l) => l.replace(/^package:/, "").trim())
      .filter((p) => PACKAGE.test(p) && alnum(p).includes(key))
      .sort((a, b) => a.length - b.length);
    return matches[0] ?? null;
  }

  async openApp(name: string): Promise<ToolResult> {
    const pkg = await this.resolveApp(name);
    if (!pkg) return { ok: false, summary: `There's no app called “${name}” on the TV.` };
    const on = await this.screenOn();
    if (on && !on.ok) return on;
    const label = APP_NAMES[pkg] ?? name.trim();
    // TV apps register under LEANBACK_LAUNCHER; a phone-style app only under LAUNCHER.
    let out = await this.sh(`monkey -p ${pkg} -c android.intent.category.LEANBACK_LAUNCHER 1`);
    if (/No activities found/i.test(out)) {
      out = await this.sh(`monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`);
      if (/No activities found/i.test(out)) {
        return { ok: false, summary: `${label} is installed on the TV but can't be opened.` };
      }
    }
    if (await this.waitForFocus(pkg)) return { ok: true, summary: `Opened ${label} on the TV.` };
    const now = await this.focusedPackage();
    return {
      ok: false,
      summary: `I asked the TV to open ${label}, but it's showing ${APP_NAMES[now] ?? (now || "something else")} instead.`,
    };
  }

  /** Every media session's state, by package. */
  async sessions(): Promise<Map<string, Session>> {
    const out = await this.sh("dumpsys media_session");
    const map = new Map<string, Session>();
    let pkg = "";
    for (const line of out.split("\n")) {
      const p = /^\s*package=([A-Za-z0-9_.]+)/.exec(line);
      if (p) pkg = p[1];
      const s = /state=PlaybackState \{state=(-?\d+), position=(-?\d+)/.exec(line);
      const u = /updated=(-?\d+)/.exec(line);
      if (s && pkg && !map.has(pkg))
        map.set(pkg, { state: Number(s[1]), position: Number(s[2]), updated: Number(u?.[1] ?? 0) });
    }
    return map;
  }

  /**
   * Playing = state 3 AND the position moving between two reads. State alone lies:
   * Netflix reports state 3 at position 0 while its "Who's watching?" screen is up.
   * YouTube's TV app reports its position only when its state changes (2026-10-20:
   * 902099 for 95 s while playing), so for it state 3 in both reads is enough — but
   * after a new link only once it has reported since (`since`, its session before the
   * link): the last video's leftover state 3 isn't the new one playing.
   */
  private async playingNow(
    pkg: string,
    since?: Session,
  ): Promise<{ playing: boolean; before?: Session; after?: Session }> {
    const before = (await this.sessions()).get(pkg);
    if (!before || before.state !== 3) return { playing: false, before };
    await this.wait(2500);
    const after = (await this.sessions()).get(pkg);
    const reported = !!after && pkg === YOUTUBE && after.updated !== since?.updated;
    const moved = !!after && (after.position > before.position + 500 || reported);
    return { playing: Boolean(after && after.state === 3 && moved), before, after };
  }

  /**
   * Pause/resume by the app's reported state, not by key name: Netflix on the user's
   * TV treats MEDIA_PLAY and MEDIA_PAUSE as the same toggle (pause twice = pause, then
   * play), so a blind "pause" to something already paused starts it. Only when the
   * state is known to differ does the toggle get pressed.
   */
  async playback(what: "play" | "pause"): Promise<ToolResult> {
    const pkg = await this.focusedPackage();
    const label = APP_NAMES[pkg] ?? "the TV app";
    const want = what === "pause" ? "paused" : "playing";
    const isWanted = async () => {
      const now = await this.playingNow(pkg);
      return what === "play" ? now.playing : !now.playing && now.before !== undefined;
    };
    if (!(await this.sessions()).has(pkg)) {
      await this.keyevent(what === "pause" ? KEYS.pause : KEYS.play);
      return {
        ok: true,
        summary: `Sent ${what} to the TV (${label} doesn't report whether it's playing).`,
      };
    }
    if (await isWanted()) return { ok: true, summary: `${label} is already ${want}.` };
    await this.keyevent(KEYS.play_pause);
    await this.wait(1000);
    return (await isWanted())
      ? { ok: true, summary: what === "pause" ? `Paused ${label}.` : `${label} is playing.` }
      : { ok: false, summary: `I pressed ${what}, but ${label} isn't ${want}.` };
  }

  /**
   * "Play <title>" on Netflix. Netflix ignores its own title links unless the intent
   * carries the extra `source=30`; with it the link opens the title and Netflix
   * autoplays it. On a cold start Netflix shows "Who's watching?" first and keeps the
   * link across it, so one OK press on the highlighted (last-used) profile continues.
   */
  async netflixPlay(title: string, env: TvEnv, pick: EpisodePick = {}): Promise<ToolResult> {
    const show = await env.lookupNetflix(title);
    if ("error" in show) return { ok: false, summary: show.error };
    // A named episode opens its own watch link; otherwise the show's page, where Netflix
    // resumes wherever the profile left off (what its own Play button does).
    let path = `title/${show.id}`;
    const found = { name: show.name };
    if (pick.season || pick.episode) {
      const season = pick.season || 1;
      const episode = pick.episode || 1;
      const ep = await env.netflixEpisode(show.id, season, episode);
      if ("error" in ep) return { ok: false, summary: ep.error };
      path = `watch/${ep.id}`;
      found.name = `${show.name} season ${season}, episode ${episode}${ep.title ? ` (“${ep.title}”)` : ""}`;
    }
    return this.netflixOpen(path, found.name);
  }

  /** Open a Netflix `title/<id>` or `watch/<id>` link and confirm it plays. */
  async netflixOpen(path: string, name: string): Promise<ToolResult> {
    const found = { name };
    const on = await this.screenOn();
    if (on && !on.ok) return on;
    const cold = !(await this.sh(`pidof ${NETFLIX}`)).trim();
    const before = cold ? undefined : await this.playingNow(NETFLIX);
    const sentAt = Date.now();
    await this.sh(
      `am start -a android.intent.action.VIEW -d ${shellQuote(`https://www.netflix.com/${path}`)} ` +
        `-f 0x30000000 -e source 30 -n ${NETFLIX}/.MainActivity`,
    );
    let pressedOk = false;
    let sawStop = false;
    for (let elapsed = 0; elapsed < 45_000; elapsed += 2500) {
      await this.wait(2500);
      const s = (await this.sessions()).get(NETFLIX);
      if (!s || s.state !== 3) {
        sawStop = true;
        continue;
      }
      // ponytail: the profile gate is recognised by its signature (state 3 stuck at
      // position 0) and only after a cold start; one OK picks the last-used profile.
      if (cold && !pressedOk && s.position === 0 && elapsed >= 7_500) {
        await this.keyevent(KEYS.ok);
        pressedOk = true;
        continue;
      }
      if (s.position <= 0) continue;
      const now = await this.playingNow(NETFLIX);
      if (!now.playing || !now.after) continue;
      // Netflix was already playing: only a stop or a jump in position shows the link
      // replaced what was on. The same show at the same spot can't be told apart.
      const wasOn = before?.playing && before.after;
      const expected = wasOn ? before.after!.position + (Date.now() - sentAt) : 0;
      if (wasOn && !sawStop && Math.abs(now.after.position - expected) < 15_000) {
        return {
          ok: false,
          summary: `Netflix is playing, but I couldn't confirm it switched to ${found.name}.`,
        };
      }
      return { ok: true, summary: `Playing ${found.name} on Netflix.` };
    }
    return {
      ok: false,
      summary:
        `I opened ${found.name} on Netflix, but I couldn't confirm it started playing — ` +
        "it may be waiting on the TV screen.",
    };
  }

  /** A parsed link on the TV. YouTube starts at `startS` (checked against the position
   *  the TV reports); Netflix resumes wherever the profile left off. */
  async cast(link: MediaLink, startS = 0, name = ""): Promise<ToolResult> {
    const label = name ? `“${name}”` : "it";
    if (link.service === "netflix") {
      if (!/^\d+$/.test(link.id)) return { ok: false, summary: "That isn't a Netflix title." };
      return this.netflixOpen(`${link.kind}/${link.id}`, name ? label : "the title");
    }
    if (!/^[A-Za-z0-9_-]{11}$/.test(link.id))
      return { ok: false, summary: "That isn't a YouTube video." };
    const start = Math.max(Math.floor(startS || 0), 0);
    const url = `https://www.youtube.com/watch?v=${link.id}${start >= 5 ? `&t=${start}s` : ""}`;
    const on = await this.screenOn();
    if (on && !on.ok) return on;
    let gate = await this.youtubeGate(!!on);
    const prior = (await this.sessions()).get(YOUTUBE);
    const linkCmd = `am start -a android.intent.action.VIEW -d ${shellQuote(url)} ${YOUTUBE}`;
    await this.sh(linkCmd);
    if (!(await this.waitForFocus(YOUTUBE))) {
      return { ok: false, summary: "I asked the TV to open YouTube, but it didn't come up." };
    }
    for (let i = 0; i < 8; i++) {
      await this.wait(2000);
      const now = await this.playingNow(YOUTUBE, prior);
      if (!now.playing) {
        if (gate && i === 2) {
          // Still nothing: past "Who's watching?", then the link again.
          gate = false;
          await this.keyevent(KEYS.ok);
          await this.wait(4000);
          await this.sh(linkCmd);
        }
        continue;
      }
      // Not "from the start": a TV already playing this video just carries on where it
      // was (seen 2026-10-20).
      if (start >= 5 && now.after && now.after.position < (start - 10) * 1000) {
        return {
          ok: true,
          summary: `Playing ${label} on YouTube on the TV, but not from ${clock(start)}: it didn't take the start time.`,
        };
      }
      return {
        ok: true,
        summary: `Playing ${label} on YouTube on the TV${start >= 5 ? ` from ${clock(start)}` : ""}.`,
      };
    }
    return {
      ok: false,
      summary: `I opened ${label} in YouTube on the TV, but couldn't confirm it started playing.`,
    };
  }

  /** YouTube's own search link (verified on the TV), then OK on the top result. */
  async youtubePlay(query: string): Promise<ToolResult> {
    const q = query.trim().slice(0, 200);
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
    const on = await this.screenOn();
    if (on && !on.ok) return on;
    let gate = await this.youtubeGate(!!on);
    const prior = (await this.sessions()).get(YOUTUBE);
    const searchCmd = `am start -a android.intent.action.VIEW -d ${shellQuote(url)} ${YOUTUBE}`;
    await this.sh(searchCmd);
    if (!(await this.waitForFocus(YOUTUBE))) {
      return { ok: false, summary: "I asked the TV to open YouTube, but it didn't come up." };
    }
    await this.wait(5000); // results render before OK means "the top result"
    await this.keyevent(KEYS.ok);
    for (let i = 0; i < 6; i++) {
      await this.wait(2000);
      if ((await this.playingNow(YOUTUBE, prior)).playing) {
        return { ok: true, summary: `Playing the top YouTube result for “${q}” on the TV.` };
      }
      if (gate && i === 1) {
        // That OK picked the account on "Who's watching?": search again.
        gate = false;
        await this.sh(searchCmd);
        await this.wait(5000);
        await this.keyevent(KEYS.ok);
      }
    }
    return {
      ok: false,
      summary: `I opened YouTube's results for “${q}” on the TV, but couldn't confirm a video started.`,
    };
  }

  private async volume(): Promise<{ level: number; max: number } | null> {
    const m = /volume is (\d+) in range \[(\d+)\.\.(\d+)\]/.exec(
      await this.sh("media volume --stream 3 --get"),
    );
    return m ? { level: Number(m[1]), max: Number(m[3]) } : null;
  }

  async setVolume(level: number): Promise<ToolResult> {
    const cur = await this.volume();
    if (!cur) return { ok: false, summary: "The TV didn't report its volume." };
    if (!Number.isFinite(level)) return { ok: false, summary: "What volume should the TV be at?" };
    const want = Math.max(0, Math.min(cur.max, Math.round(level)));
    await this.sh(`media volume --stream 3 --set ${want}`);
    let now = await this.volume();
    if (now && now.level !== want) {
      // Fall back to the remote's own volume keys for the difference.
      const diff = want - now.level;
      const presses = Math.min(Math.abs(diff), 50);
      await this.keyevent(...Array<number>(presses).fill(diff > 0 ? 24 : 25));
      now = await this.volume();
    }
    return now?.level === want
      ? { ok: true, summary: `TV volume is ${want}.` }
      : {
          ok: false,
          summary: `I tried to set the TV volume to ${want}, but it reports ${now?.level ?? "no level"}.`,
        };
  }

  async volumeStep(direction: 1 | -1, step: number): Promise<ToolResult> {
    const cur = await this.volume();
    if (!cur) return { ok: false, summary: "The TV didn't report its volume." };
    return this.setVolume(cur.level + direction * Math.abs(step));
  }

  private async muted(): Promise<boolean | null> {
    const out = await this.sh("dumpsys audio | grep -A1 -- '- STREAM_MUSIC:'");
    const m = /Muted:\s*(true|false)/.exec(out);
    return m ? m[1] === "true" : null;
  }

  async toggleMute(): Promise<ToolResult> {
    const before = await this.muted();
    await this.keyevent(KEY_MUTE);
    await this.wait(800);
    const after = await this.muted();
    if (after === null)
      return { ok: true, summary: "Sent mute to the TV (it doesn't report whether it's muted)." };
    if (after === before)
      return {
        ok: false,
        summary: `I sent mute, but the TV is still ${after ? "muted" : "unmuted"}.`,
      };
    return { ok: true, summary: after ? "The TV is muted." : "The TV is unmuted." };
  }

  async wakefulness(): Promise<string> {
    return (
      /mWakefulness=(\w+)/.exec(await this.sh("dumpsys power | grep mWakefulness="))?.[1] ?? ""
    );
  }

  async power(on: boolean): Promise<ToolResult> {
    const want = on ? "Awake" : "Asleep";
    if ((await this.wakefulness()) === want)
      return { ok: true, summary: `The TV is already ${on ? "on" : "off"}.` };
    await this.keyevent(on ? KEY_WAKEUP : KEY_SLEEP);
    for (let i = 0; i < 6; i++) {
      await this.wait(1000);
      const w = await this.wakefulness();
      if (w === want || (!on && w === "Dozing"))
        return { ok: true, summary: `Turned the TV ${on ? "on" : "off"}.` };
    }
    return {
      ok: false,
      summary: `I sent the TV the ${on ? "wake" : "sleep"} key, but it didn't change.`,
    };
  }

  /**
   * Before starting anything. A TV in standby with its network up answers ADB but shows
   * nothing, so an app opened there plays to a dark screen (2026-10-20: with Remote
   * start on, this TV never goes further than that). Unknown → carry on. Returns what
   * it did (null: nothing needed).
   */
  async screenOn(): Promise<ToolResult | null> {
    if (!["Asleep", "Dozing"].includes(await this.wakefulness())) return null;
    return this.power(true);
  }

  /**
   * Whether YouTube will likely ask "Who's watching?" first: it does after the TV wakes
   * and on a cold start, and swallows the link (2026-10-20). ADB can't see it
   * (uiautomator finds nothing in YouTube's TV app), so cast/youtubePlay press OK once
   * if nothing starts — the highlighted, last-used account (the user's choice, like
   * Netflix's profile gate) — and send the link again.
   */
  private async youtubeGate(woke: boolean): Promise<boolean> {
    return woke || !(await this.sh(`pidof ${YOUTUBE}`)).trim();
  }

  async key(spec: string): Promise<ToolResult> {
    const words = spec.toLowerCase().match(/[a-z]+|\d+/g) ?? [];
    const count = Math.min(Math.max(Number(words.find((w) => /^\d+$/.test(w)) ?? 1), 1), 20);
    const name = words
      .filter(
        (w) => !/^\d+$/.test(w) && w !== "times" && w !== "x" && w !== "button" && w !== "key",
      )
      .join("_");
    const code = KEYS[name];
    if (code === undefined)
      return { ok: false, summary: `The TV remote has no “${spec}” button I can press.` };
    await this.keyevent(...Array<number>(count).fill(code));
    return {
      ok: true,
      summary: `Sent ${name.replace(/_/g, " ")}${count > 1 ? ` ×${count}` : ""} to the TV.`,
    };
  }

  /** Raw keycodes, in order (the TV-by-sight operator's moves; nothing is verified). */
  async pressCodes(codes: number[]): Promise<void> {
    if (codes.length) await this.keyevent(...codes);
  }

  /** Type into the focused text field. `input text` takes %s for a space and only what
   *  the TV's virtual keyboard map has (no emoji or non-Latin). */
  async typeText(text: string): Promise<ToolResult> {
    const t = text.replace(/\s+/g, " ").trim().slice(0, 120);
    if (!t) return { ok: false, summary: "There was nothing to type." };
    const out = await this.sh(`input text ${shellQuote(t.replace(/ /g, "%s"))}`);
    return /Exception|Error/.test(out)
      ? { ok: false, summary: `The TV couldn't type “${t}”.` }
      : { ok: true, summary: `Typed “${t}” on the TV.` };
  }

  async status(): Promise<ToolResult> {
    const w = await this.wakefulness();
    if (w !== "Awake") return { ok: true, summary: "The TV is off (in standby)." };
    const pkg = await this.focusedPackage();
    const vol = await this.volume();
    return {
      ok: true,
      summary: `The TV is on, showing ${APP_NAMES[pkg] ?? (pkg || "an unknown screen")}${vol ? `, volume ${vol.level}` : ""}.`,
    };
  }
}

// ── Netflix title lookup ──────────────────────────────────────────────────────

/**
 * Web search finds the id; Netflix's own public title page then confirms which show it
 * is, so a misremembered or invented id can't play the wrong thing under the right name.
 */
export async function lookupNetflixTitle(
  title: string,
  ctx: HttpToolCtx,
): Promise<{ id: string; name: string } | { error: string }> {
  const t = title.trim();
  if (!t) return { error: "Which show or film should I put on?" };
  const r = await webSearch(
    `What is the Netflix title ID of "${t}"? Reply with its https://www.netflix.com/title/<number> URL.`,
    ctx,
  );
  if (!r.ok) return { error: `I couldn't look up “${t}” on Netflix: ${r.summary}` };
  const ids = [
    ...r.summary.matchAll(/netflix\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?title\/(\d{5,10})/gi),
  ].map((m) => m[1]);
  const bare = /\b(\d{8})\b/.exec(r.summary)?.[1];
  if (bare) ids.push(bare);
  let other = "";
  for (const id of [...new Set(ids)].slice(0, 3)) {
    const name = await netflixTitleName(id);
    if (name && sameTitle(name, t)) return { id, name };
    if (name) other = name;
  }
  return {
    error: other
      ? `I couldn't find “${t}” on Netflix — the closest title I found was “${other}”.`
      : `I couldn't find “${t}” on Netflix.`,
  };
}

/** A JSON string literal's body: no unescaped quote. */
const JS_STR = String.raw`"((?:[^"\\]|\\.)*)"`;

/** The page's data is a JS literal: \x20-style escapes, then \" and friends. */
function jsUnescape(s: string): string {
  return s
    .replace(/\\x([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\(.)/g, "$1");
}

/** Netflix's name for a title, from its public page (~1 MB, read whole: see titleNameIn). */
export async function netflixTitleName(id: string): Promise<string | null> {
  try {
    const res = await resilientFetch(`https://www.netflix.com/title/${id}`, {}, 20_000);
    return res.ok ? titleNameIn(await res.text(), id) : null;
  } catch {
    return null;
  }
}

/**
 * Measured 2026-10-11 (from the PC, same native HTTP client kind as the phone's): <title>
 * is just "Netflix" and the name sits in the embedded data near the END of the page,
 * as "__typename":"Show"/"Movie","title":…,"videoId":<id>. The Sept 2026 shape —
 * "Watch X | Netflix" in <title> — is kept as the fallback.
 */
export function titleNameIn(html: string, id: string): string | null {
  const m = new RegExp(
    String.raw`"__typename":"(?:Show|Movie)","title":${JS_STR},"videoId":${id}\b`,
  ).exec(html);
  if (m) return jsUnescape(m[1]).trim() || null;
  const raw = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? "";
  const name = raw
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/^Watch\s+/i, "")
    .replace(/\s*\|\s*Netflix.*$/i, "")
    .trim();
  return name && name.toLowerCase() !== "netflix" ? name : null;
}

/** A show's season/episode → the episode's Netflix id, from the show's public page. */
export async function netflixEpisode(
  showId: string,
  season: number,
  episode: number,
): Promise<{ id: string; title: string } | { error: string }> {
  try {
    const res = await resilientFetch(`https://www.netflix.com/title/${showId}`, {}, 20_000);
    if (!res.ok) return { error: "I couldn't load that show's episode list from Netflix." };
    return (
      findEpisode(await res.text(), season, episode) ?? {
        error: `Netflix doesn't list a season ${season}, episode ${episode} for that show.`,
      }
    );
  } catch {
    return { error: "I couldn't reach Netflix for that show's episode list." };
  }
}

/**
 * Page shape measured 2026-10-11: "__typename":"SeasonsConnection" → each
 * {"node":{"__typename":"Season","episodes":{…[{"node":{"__typename":"Episode",
 * "videoId":N,"number":1,…,"title":…}}…]}}} in page order, with no season number label.
 * A recommendations tail follows the last season, so a list ends where `number` breaks
 * the 1, 2, 3… run.
 */
function findEpisodeNested(
  html: string,
  season: number,
  episode: number,
): { id: string; title: string } | null {
  const start = html.indexOf('"__typename":"SeasonsConnection"');
  if (start < 0) return null;
  const parts = html.slice(start).split('"__typename":"Season","episodes"').slice(1);
  const part = parts[season - 1];
  if (season < 1 || !part) return null;
  let expected = 1;
  for (const m of part.matchAll(/"__typename":"Episode","videoId":(\d+),"number":(\d+)/g)) {
    if (Number(m[2]) !== expected) break;
    if (expected === episode) {
      const end = m.index! + m[0].length;
      const t = new RegExp(`"title":${JS_STR}`).exec(part.slice(end, end + 6000));
      return { id: m[1], title: t ? jsUnescape(t[1]) : "" };
    }
    expected++;
  }
  return null;
}

/** The current page shape first (findEpisodeNested); then the Sept 2026 one, where each
 *  Season is labelled "Season N" and lists its episodes' ids in order. */
export function findEpisode(
  html: string,
  season: number,
  episode: number,
): { id: string; title: string } | null {
  const nested = findEpisodeNested(html, season, episode);
  if (nested) return nested;
  const seasons = [
    ...html.matchAll(/"__typename":"Season","videoId":\d+([\s\S]*?)"edges":\[([^\]]*)\]/g),
  ].map((m) => ({
    label: Number(/"Season (\d+)"/.exec(m[1])?.[1] ?? NaN),
    episodes: [...m[2].matchAll(/Episode:\{\\*"videoId\\*":(\d+)\}/g)].map((e) => e[1]),
  }));
  // Shows labelled "Part"/"Volume" instead of "Season" fall back to page order.
  const s =
    seasons.find((x) => x.label === season) ??
    (seasons.some((x) => x.label) ? undefined : seasons[season - 1]);
  const id = s?.episodes[episode - 1];
  if (!id) return null;
  const title = new RegExp(
    `"__typename":"Episode","videoId":${id},"title":"((?:[^"\\\\]|\\\\.)*)"`,
  ).exec(html)?.[1];
  return { id, title: (title ?? "").replace(/\\(.)/g, "$1") };
}

/** Loose title match: one contains the other once case, accents and punctuation go. */
export function sameTitle(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const x = norm(a);
  const y = norm(b);
  return Boolean(x && y) && (x.includes(y) || y.includes(x));
}
