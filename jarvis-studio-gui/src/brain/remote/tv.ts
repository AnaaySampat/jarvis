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
export type TvShell = (command: string) => Promise<ShellReply>;

export interface TvEnv {
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

export function nativeTvShell(host: string): TvShell {
  return async (command) => {
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
  };
}

export function tvEnv(ctx: HttpToolCtx): TvEnv {
  return {
    lookupNetflix: (title) => lookupNetflixTitle(title, ctx),
    netflixEpisode,
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
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
      case "power_on":
      case "power_off":
        return await tv.power(action === "power_on");
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

class TvUnreachable extends Error {}

interface Session {
  state: number;
  position: number;
}

class Tv {
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
      if (s && pkg && !map.has(pkg)) map.set(pkg, { state: Number(s[1]), position: Number(s[2]) });
    }
    return map;
  }

  /**
   * Playing = state 3 AND the position moving between two reads. State alone lies:
   * Netflix reports state 3 at position 0 while its "Who's watching?" screen is up.
   */
  private async playingNow(
    pkg: string,
  ): Promise<{ playing: boolean; before?: Session; after?: Session }> {
    const before = (await this.sessions()).get(pkg);
    if (!before || before.state !== 3) return { playing: false, before };
    await this.wait(2500);
    const after = (await this.sessions()).get(pkg);
    return {
      playing: Boolean(after && after.state === 3 && after.position > before.position + 500),
      before,
      after,
    };
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

  /** YouTube's own search link (verified on the TV), then OK on the top result. */
  async youtubePlay(query: string): Promise<ToolResult> {
    const q = query.trim().slice(0, 200);
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
    await this.sh(`am start -a android.intent.action.VIEW -d ${shellQuote(url)} ${YOUTUBE}`);
    if (!(await this.waitForFocus(YOUTUBE))) {
      return { ok: false, summary: "I asked the TV to open YouTube, but it didn't come up." };
    }
    await this.wait(5000); // results render before OK means "the top result"
    await this.keyevent(KEYS.ok);
    for (let i = 0; i < 6; i++) {
      await this.wait(2000);
      if ((await this.playingNow(YOUTUBE)).playing) {
        return { ok: true, summary: `Playing the top YouTube result for “${q}” on the TV.` };
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

  private async wakefulness(): Promise<string> {
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

/** Netflix's name for a title, from its public page's <title> ("Watch X | Netflix…"),
 *  which sits in the first few hundred bytes of a ~3.5 MB page — so stop reading there. */
export async function netflixTitleName(id: string): Promise<string | null> {
  try {
    const res = await resilientFetch(`https://www.netflix.com/title/${id}`, {}, 12_000);
    if (!res.ok || !res.body) return null;
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let html = "";
    while (html.length < 65_536 && !html.includes("</title>")) {
      const { done, value } = await reader.read();
      if (done) break;
      html += dec.decode(value, { stream: true });
    }
    void reader.cancel().catch(() => undefined);
    const raw = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? "";
    const name = raw
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;|&#39;/g, "'")
      .replace(/^Watch\s+/i, "")
      .replace(/\s*\|\s*Netflix.*$/i, "")
      .trim();
    return name && name.toLowerCase() !== "netflix" ? name : null;
  } catch {
    return null;
  }
}

/** A show's season/episode → the episode's Netflix id, from the show's public page. Unlike
 *  the name check above this needs the whole ~3.5 MB page: the episode list sits near its end. */
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

/** The page's embedded data lists each Season (labelled "Season N"), in order, with its
 *  episodes' ids in order; each Episode object carries its title. */
export function findEpisode(
  html: string,
  season: number,
  episode: number,
): { id: string; title: string } | null {
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
