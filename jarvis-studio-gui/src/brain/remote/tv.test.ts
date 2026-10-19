import { describe, expect, it, vi } from "vitest";
import {
  findEpisode,
  nativeTvShell,
  OTHER_NETWORK_HINT,
  runTvControl,
  sameTitle,
  shellQuote,
  titleNameIn,
  tvAddresses,
  macFromIpLink,
  normMac,
  parseLink,
  wakeTv,
  type ShellReply,
  type TvEnv,
} from "./tv";
import { TV_ACTIONS } from "../tools/registry";

/** A scripted TV: the first rule whose pattern matches answers the command; an array
 *  answers in turn (its last entry repeats). Every command sent is recorded. */
function fakeTv(rules: Array<[RegExp, string | string[]]>) {
  const sent: string[] = [];
  const turns = new Map<number, number>();
  const shell = async (command: string): Promise<ShellReply> => {
    sent.push(command);
    const i = rules.findIndex(([re]) => re.test(command));
    let output = "";
    if (i >= 0) {
      const answer = rules[i][1];
      if (Array.isArray(answer)) {
        const n = turns.get(i) ?? 0;
        output = answer[Math.min(n, answer.length - 1)];
        turns.set(i, n + 1);
      } else output = answer;
    }
    return { ok: true, output, exitCode: 0, summary: "" };
  };
  return { shell, sent };
}

const env: TvEnv = {
  lookupNetflix: async () => ({ id: "80057281", name: "Stranger Things" }),
  netflixEpisode: async () => ({
    id: "80077368",
    title: "Chapter One: The Vanishing of Will Byers",
  }),
  wait: async () => {},
};
const focus = (pkg: string) => `  mCurrentFocus=Window{6838c77 u0 ${pkg}/${pkg}.MainActivity}`;
const nf = (state: number, position: number) =>
  "    package=com.netflix.ninja\n      active=true\n" +
  `      state=PlaybackState {state=${state}, position=${position}, buffered position=0}`;
const vol = (n: number) => `[v] Connecting to AudioService\n[v] volume is ${n} in range [0..100]`;

describe("runTvControl", () => {
  it("opens an app and confirms it from the focused window", async () => {
    const tv = fakeTv([[/mCurrentFocus/, focus("com.netflix.ninja")]]);
    const r = await runTvControl(tv.shell, "open_app", "Netflix", "", env);
    expect(r).toMatchObject({ ok: true, summary: "Opened Netflix on the TV." });
    expect(tv.sent).toContain(
      "monkey -p com.netflix.ninja -c android.intent.category.LEANBACK_LAUNCHER 1",
    );
  });

  it("does not claim an app opened when something else is in front", async () => {
    const tv = fakeTv([[/mCurrentFocus/, focus("com.google.android.tvlauncher")]]);
    const r = await runTvControl(tv.shell, "open_app", "netflix", "", env);
    expect(r.ok).toBe(false);
    expect(r.summary).toContain("the home screen");
  });

  it("plays a Netflix title with the source=30 link and confirms the position moves", async () => {
    const tv = fakeTv([
      [/^pidof/, "9812"],
      [/media_session/, [nf(2, 1000), nf(1, 0), nf(3, 5000), nf(3, 5000), nf(3, 8000)]],
    ]);
    const r = await runTvControl(tv.shell, "play", "stranger things", "netflix", env);
    expect(r).toMatchObject({ ok: true, summary: "Playing Stranger Things on Netflix." });
    const link = tv.sent.find((c) => c.startsWith("am start"));
    expect(link).toContain("-d 'https://www.netflix.com/title/80057281'");
    expect(link).toContain("-e source 30");
    expect(tv.sent).not.toContain("input keyevent 23");
  });

  it("gets past the cold-start profile screen with one OK, and not on state alone", async () => {
    // Netflix reports state 3 at position 0 behind "Who's watching?" — not playback.
    const tv = fakeTv([
      [/^pidof/, ""],
      [
        /media_session/,
        [nf(3, 0), nf(3, 0), nf(3, 0), nf(3, 0), nf(3, 203014), nf(3, 203014), nf(3, 207108)],
      ],
    ]);
    const r = await runTvControl(tv.shell, "play", "Stranger Things", "netflix", env);
    expect(r.ok).toBe(true);
    expect(tv.sent.filter((c) => c === "input keyevent 23")).toHaveLength(1);
  });

  it("reports honestly when Netflix never starts playing", async () => {
    const tv = fakeTv([
      [/^pidof/, ""],
      [/media_session/, nf(3, 0)],
    ]);
    const r = await runTvControl(tv.shell, "play", "Stranger Things", "netflix", env);
    expect(r.ok).toBe(false);
    expect(r.summary).toContain("couldn't confirm it started playing");
  });

  it("opens a named episode by its own watch link instead of the show page", async () => {
    const tv = fakeTv([
      [/^pidof/, "9812"],
      [/media_session/, [nf(2, 1000), nf(3, 0), nf(3, 4000), nf(3, 4000), nf(3, 7000)]],
    ]);
    const r = await runTvControl(tv.shell, "play", "Stranger Things", "netflix", env, {
      season: 1,
      episode: 1,
    });
    expect(r.ok).toBe(true);
    expect(r.summary).toContain("season 1, episode 1");
    const link = tv.sent.find((c) => c.startsWith("am start"));
    expect(link).toContain("-d 'https://www.netflix.com/watch/80077368'");
    expect(link).toContain("-e source 30");
  });

  it("won't claim a switch when Netflix just carries on playing what it was", async () => {
    const tv = fakeTv([
      [/^pidof/, "9812"],
      [
        /media_session/,
        [nf(3, 100_000), nf(3, 102_500), nf(3, 103_000), nf(3, 103_000), nf(3, 105_500)],
      ],
    ]);
    const r = await runTvControl(tv.shell, "play", "Stranger Things", "netflix", env);
    expect(r.ok).toBe(false);
    expect(r.summary).toContain("couldn't confirm it switched");
  });

  it("passes a failed title lookup straight through without touching the TV", async () => {
    const tv = fakeTv([]);
    const r = await runTvControl(tv.shell, "play", "Nope", "netflix", {
      ...env,
      lookupNetflix: async () => ({ error: "I couldn't find “Nope” on Netflix." }),
    });
    expect(r).toMatchObject({ ok: false, summary: "I couldn't find “Nope” on Netflix." });
    expect(tv.sent).toEqual([]);
  });

  it("pauses with one toggle press, confirmed from the session", async () => {
    // Netflix treats MEDIA_PLAY/MEDIA_PAUSE as a toggle, so pressing by state is the only safe way.
    const tv = fakeTv([
      [/mCurrentFocus/, focus("com.netflix.ninja")],
      [/media_session/, [nf(3, 1000), nf(3, 1000), nf(3, 3500), nf(2, 3600)]],
    ]);
    const r = await runTvControl(tv.shell, "pause", "", "", env);
    expect(r).toMatchObject({ ok: true, summary: "Paused Netflix." });
    expect(tv.sent.filter((c) => c.startsWith("input keyevent"))).toEqual(["input keyevent 85"]);
  });

  it("presses nothing when it's already in the asked-for state", async () => {
    const tv = fakeTv([
      [/mCurrentFocus/, focus("com.netflix.ninja")],
      [/media_session/, nf(2, 500)],
    ]);
    const r = await runTvControl(tv.shell, "pause", "", "", env);
    expect(r).toMatchObject({ ok: true, summary: "Netflix is already paused." });
    expect(tv.sent.some((c) => c.startsWith("input keyevent"))).toBe(false);
  });

  it("sets the volume and verifies it, falling back to volume keys", async () => {
    const direct = fakeTv([[/--get/, [vol(20), vol(30)]]]);
    expect(await runTvControl(direct.shell, "set_volume", "30", "", env)).toMatchObject({
      ok: true,
      summary: "TV volume is 30.",
    });
    const keys = fakeTv([[/--get/, [vol(20), vol(20), vol(23)]]]);
    const r = await runTvControl(keys.shell, "set_volume", "23", "", env);
    expect(r.ok).toBe(true);
    expect(keys.sent).toContain("input keyevent 24 24 24");
  });

  it("reports mute from the TV's own state", async () => {
    const tv = fakeTv([[/dumpsys audio/, ["   Muted: false", "   Muted: true"]]]);
    expect(await runTvControl(tv.shell, "mute", "", "", env)).toMatchObject({
      ok: true,
      summary: "The TV is muted.",
    });
  });

  it("presses remote buttons (reported as sent) and refuses unknown ones", async () => {
    const tv = fakeTv([]);
    const r = await runTvControl(tv.shell, "key", "down 3", "", env);
    expect(r).toMatchObject({ ok: true, summary: "Sent down ×3 to the TV." });
    expect(tv.sent).toContain("input keyevent 20 20 20");
    expect((await runTvControl(tv.shell, "key", "jump", "", env)).ok).toBe(false);
  });

  it("turns an unreachable TV into a clear failure", async () => {
    const shell = async (): Promise<ShellReply> => ({
      ok: false,
      output: "",
      exitCode: -1,
      summary: "I can't reach the TV at 192.168.1.50:5555.",
    });
    expect(await runTvControl(shell, "power_off", "", "", env)).toMatchObject({
      ok: false,
      error: "tv_unreachable",
    });
  });

  it("has a handler for every action the registry advertises", async () => {
    // look and task see the screen: dispatch sends them to remote/tvSight.ts.
    for (const action of TV_ACTIONS.filter((a) => a !== "look" && a !== "task")) {
      const tv = fakeTv([[/mCurrentFocus/, focus("com.netflix.ninja")]]);
      const r = await runTvControl(tv.shell, action, "1", "netflix", env);
      expect(r.summary, action).not.toMatch(/don't know the TV action/);
    }
  });
});

describe("helpers", () => {
  it("finds an episode's id and title in Netflix's page data", () => {
    // The shape of the real page (keys carry escaped quotes), cut down to two seasons.
    const page = String.raw`"Season:{\\"videoId\\":1}":{"__typename":"Season","videoId":1,"numberLabelV2({\\"label\\":\\"LONG\\"})":"Season 1","episodes":{"__typename":"EpisodesConnection","edges":[{"node":{"__ref":"Episode:{\\"videoId\\":11}"}},{"node":{"__ref":"Episode:{\\"videoId\\":12}"}}]}},"Season:{\\"videoId\\":2}":{"__typename":"Season","videoId":2,"numberLabelV2({\\"label\\":\\"LONG\\"})":"Season 2","episodes":{"__typename":"EpisodesConnection","edges":[{"node":{"__ref":"Episode:{\\"videoId\\":21}"}}]}},"Episode:{\\"videoId\\":12}":{"__typename":"Episode","videoId":12,"title":"Chapter Two: The Weirdo on Maple Street","number":2}`;
    expect(findEpisode(page, 1, 2)).toEqual({
      id: "12",
      title: "Chapter Two: The Weirdo on Maple Street",
    });
    expect(findEpisode(page, 2, 1)).toEqual({ id: "21", title: "" });
    expect(findEpisode(page, 2, 2)).toBeNull();
    expect(findEpisode(page, 3, 1)).toBeNull();
  });

  it("reads the Oct 2026 page shape: nested unlabelled seasons, \\x escapes, a recommendations tail", () => {
    const ep = (vid: number, n: number, title: string) =>
      `{"__typename":"EpisodeEdge","node":{"__typename":"Episode","videoId":${vid},"number":${n},"runtimeSec":1,"shortSynopsis":"x","title":"${title}"}}`;
    const season = (eps: string, title: string) =>
      `{"node":{"__typename":"Season","episodes":{"edges":[${eps}]},"title":"${title}"}}`;
    const page =
      String.raw`"__typename":"Show","title":"Stranger\x20Things","videoId":80057281,` +
      `"seasons":{"__typename":"SeasonsConnection","edges":[` +
      season(
        ep(11, 1, "One") + "," + ep(12, 2, String.raw`Two\x21`),
        String.raw`Stranger\x20Things`,
      ) +
      "," +
      season(ep(21, 1, "Uno"), String.raw`Stranger\x20Things\x202`) +
      `]},"more":[` +
      ep(99, 7, "Other show") +
      "]";
    expect(findEpisode(page, 1, 2)).toEqual({ id: "12", title: "Two!" });
    expect(findEpisode(page, 2, 1)).toEqual({ id: "21", title: "Uno" });
    expect(findEpisode(page, 2, 2)).toBeNull();
    expect(findEpisode(page, 3, 1)).toBeNull();
    expect(titleNameIn(page, "80057281")).toBe("Stranger Things");
    expect(titleNameIn("<title>Watch Dark | Netflix Official Site</title>", "1")).toBe("Dark");
    expect(titleNameIn("<title>Netflix</title>", "1")).toBeNull();
  });

  it("single-quotes text for the TV shell", () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });

  it("matches titles loosely but not different shows", () => {
    expect(sameTitle("Stranger Things", "stranger things season 4")).toBe(true);
    expect(sameTitle("Amélie", "amelie")).toBe(true);
    expect(sameTitle("Money Heist", "La Casa de Papel")).toBe(false);
  });
});

describe("nativeTvShell across networks", () => {
  const reply = (ok: boolean, summary = "", output = "") => ({
    ok,
    output,
    exitCode: ok ? 0 : -1,
    summary,
  });
  const UNREACHABLE =
    "I can't reach the TV at 192.168.1.20:5555. Check it's on, on the same Wi-Fi as this phone, with USB debugging on.";

  it("reads every address in a saved host", () => {
    expect(tvAddresses("192.168.1.20, 100.101.1.2:5555; bad!")).toEqual([
      "192.168.1.20",
      "100.101.1.2:5555",
    ]);
  });

  it("falls through to the next address and goes there first after", async () => {
    const tried: string[] = [];
    const shell = nativeTvShell("192.168.1.20, 100.101.1.2", async (address) => {
      tried.push(address);
      return address === "100.101.1.2" ? reply(true, "", "BRAVIA") : reply(false, UNREACHABLE);
    });
    expect((await shell("getprop ro.product.model")).output).toBe("BRAVIA");
    tried.length = 0;
    await shell("echo");
    expect(tried).toEqual(["100.101.1.2"]);
  });

  it("doesn't try another way when the TV refused the phone", async () => {
    const tried: string[] = [];
    const shell = nativeTvShell("192.168.1.20, 100.101.1.2", async (address) => {
      tried.push(address);
      return reply(
        false,
        'The TV didn\'t allow this phone. Accept "Allow USB debugging?" on the TV.',
      );
    });
    const r = await shell("echo");
    expect(tried).toEqual(["192.168.1.20"]);
    expect(r.summary).not.toContain(OTHER_NETWORK_HINT);
  });

  it("says another router's network may be the cause when nothing answers", async () => {
    const r = await nativeTvShell("192.168.1.20", async () => reply(false, UNREACHABLE))("echo");
    expect(r.ok).toBe(false);
    expect(r.summary).toContain("Access Point mode");
  });
});

describe("waking the TV (Wake-on-LAN)", () => {
  const DOWN: ShellReply = {
    ok: false,
    output: "",
    exitCode: -1,
    summary: "I can't reach the TV at 192.168.1.20:5555.",
  };
  const UP: ShellReply = { ok: true, output: "ok", exitCode: 0, summary: "" };

  it("reads the connected interface's MAC, Ethernet first", () => {
    const link = [
      "1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 link/loopback 00:00:00:00:00:00",
      "3: wlan0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 link/ether 11:22:33:44:55:66 brd ff:ff:ff:ff:ff:ff",
      "4: eth0: <NO-CARRIER,BROADCAST,MULTICAST,UP> mtu 1500 link/ether aa:bb:cc:dd:ee:ff brd ff:ff:ff:ff:ff:ff",
    ].join("\n");
    expect(macFromIpLink(link)).toBe("11:22:33:44:55:66"); // eth0 is unplugged
    expect(
      macFromIpLink(link.replace("<NO-CARRIER,BROADCAST,MULTICAST,UP>", "<UP,LOWER_UP>")),
    ).toBe("aa:bb:cc:dd:ee:ff");
    expect(normMac("AA-BB-CC-DD-EE-FF")).toBe("aa:bb:cc:dd:ee:ff");
    expect(normMac("ff:ff:ff:ff:ff:ff")).toBe("");
  });

  it("does nothing to a TV that already answers", async () => {
    const send = vi.fn();
    const r = await wakeTv(
      async () => UP,
      "aa:bb:cc:dd:ee:ff",
      "192.168.1.20",
      send,
      async () => {},
    );
    expect(r).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it("wakes an unreachable TV and waits for ADB to come back", async () => {
    const replies = [DOWN, DOWN, UP];
    let t = 0;
    const send = vi.fn(async () => ({ ok: true, summary: "sent" }));
    const r = await wakeTv(
      async () => replies.shift() ?? UP,
      "aa:bb:cc:dd:ee:ff",
      "192.168.1.20:5555",
      send,
      async (ms) => void (t += ms),
      () => t,
    );
    expect(send).toHaveBeenCalledWith("aa:bb:cc:dd:ee:ff", "192.168.1.20");
    expect(r).toEqual({ ok: true, summary: "Woke the TV over the network." });
  });

  it("says how to fix it when the TV never comes back", async () => {
    let t = 0;
    const r = await wakeTv(
      async () => DOWN,
      "aa:bb:cc:dd:ee:ff",
      "192.168.1.20",
      async () => ({ ok: true, summary: "sent" }),
      async (ms) => void (t += ms),
      () => t,
    );
    expect(r?.ok).toBe(false);
    expect(r?.summary).toContain("Remote start");
  });

  it("a TV that refused the phone isn't 'off': no packet, the command reports it", async () => {
    const send = vi.fn();
    const refused = { ...DOWN, summary: "The TV didn't allow this phone." };
    expect(
      await wakeTv(
        async () => refused,
        "aa:bb:cc:dd:ee:ff",
        "",
        send,
        async () => {},
      ),
    ).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it("power_on wakes first, and learns the MAC the first time the TV answers", async () => {
    const replies: ShellReply[] = [DOWN, UP];
    const commands: string[] = [];
    const address = async (a: string, command: string): Promise<ShellReply> => {
      commands.push(command);
      if (a.startsWith("100.")) return DOWN; // a TV that's off isn't on Tailscale either
      if (command === "echo ok") return replies.shift() ?? UP;
      if (command.startsWith("dumpsys power")) return { ...UP, output: "mWakefulness=Awake" };
      return UP;
    };
    const send = vi.fn(async () => ({ ok: true, summary: "sent" }));
    const shell = nativeTvShell("100.101.1.2, 192.168.1.20", address, {
      mac: "aa:bb:cc:dd:ee:ff",
      send,
      wait: async () => {},
    });
    const r = await runTvControl(shell, "power_on", "", "", env);
    expect(send).toHaveBeenCalledWith("aa:bb:cc:dd:ee:ff", "192.168.1.20"); // not Tailscale
    expect(r).toEqual({ ok: true, summary: "Turned the TV on (woke it over the network)." });

    let learned = "";
    const fresh = nativeTvShell(
      "192.168.1.20",
      async (_a, c) =>
        c === "ip -o link"
          ? { ...UP, output: "3: wlan0: <UP,LOWER_UP> mtu 1500 link/ether 11:22:33:44:55:66 brd" }
          : UP,
      { onMac: (m) => (learned = m) },
    );
    await fresh("getprop ro.product.model");
    expect(learned).toBe("11:22:33:44:55:66");
    expect(fresh.wake).toBeUndefined(); // nothing to wake it with yet
  });
});

describe("send this to the TV (cast)", () => {
  /** A TV whose YouTube session reports `positionMs` (advancing) once it's opened. */
  function youtubeTv(positionMs: number) {
    const sent: string[] = [];
    let reads = 0;
    const shell = async (command: string): Promise<ShellReply> => {
      sent.push(command);
      if (command.includes("mCurrentFocus")) {
        return {
          ok: true,
          output: "mCurrentFocus=Window{1 u0 com.google.android.youtube.tv/x}",
          exitCode: 0,
          summary: "",
        };
      }
      if (command.includes("media_session")) {
        reads++;
        return {
          ok: true,
          output: `package=com.google.android.youtube.tv\n  state=PlaybackState {state=3, position=${positionMs + reads * 2500}, buffered`,
          exitCode: 0,
          summary: "",
        };
      }
      return { ok: true, output: "", exitCode: 0, summary: "" };
    };
    return { shell, sent };
  }

  it("reads YouTube and Netflix links in every shape, even inside a shared message", () => {
    expect(parseLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90")).toEqual({
      service: "youtube",
      id: "dQw4w9WgXcQ",
      t: 90,
    });
    expect(parseLink("Watch this! https://youtu.be/dQw4w9WgXcQ?si=abc&t=1m5s")).toMatchObject({
      id: "dQw4w9WgXcQ",
      t: 65,
    });
    expect(parseLink("youtube.com/shorts/dQw4w9WgXcQ")).toMatchObject({ id: "dQw4w9WgXcQ" });
    expect(parseLink("https://www.netflix.com/in/title/80057281?s=a")).toEqual({
      service: "netflix",
      kind: "title",
      id: "80057281",
    });
    expect(parseLink("netflix.com/watch/80077209")).toMatchObject({
      kind: "watch",
      id: "80077209",
    });
    for (const bad of [
      "",
      "https://example.com",
      "youtube.com/feed",
      "youtube.com/watch?v=short",
    ]) {
      expect(parseLink(bad)).toBeNull();
    }
  });

  it("plays a link at its start time and says so", async () => {
    const { shell, sent } = youtubeTv(754_000);
    const r = await runTvControl(shell, "cast", "https://youtu.be/dQw4w9WgXcQ?t=754", "", env);
    expect(sent[0]).toContain("watch?v=dQw4w9WgXcQ&t=754s");
    expect(r).toMatchObject({ ok: true });
    expect(r.summary).toContain("from 12:34");
  });

  it("says when the TV's YouTube ignored the start time", async () => {
    const { shell } = youtubeTv(0);
    const r = await runTvControl(shell, "cast", "https://youtu.be/dQw4w9WgXcQ?t=754", "", env);
    expect(r.summary).toContain("from the start");
  });

  it("moves YouTube from the phone at the same point, pausing the phone only after", async () => {
    const { shell, sent } = youtubeTv(754_000);
    const order: string[] = [];
    const r = await runTvControl(shell, "cast", "", "", {
      ...env,
      phoneMedia: async () => ({
        ok: true,
        summary: "ok",
        package: "com.google.android.youtube",
        title: "lofi hip hop radio",
        artist: "Lofi Girl",
        playing: true,
        position: 754_400,
      }),
      findYoutube: async (title, channel) => {
        order.push(`find ${title} / ${channel}`);
        return { id: "jfKfPfyJRdk" };
      },
      pausePhone: async () => {
        order.push("pause");
        return true;
      },
    });
    expect(r.ok).toBe(true);
    expect(sent[0]).toContain("watch?v=jfKfPfyJRdk&t=754s");
    expect(order).toEqual(["find lofi hip hop radio / Lofi Girl", "pause"]);
    expect(r.summary).toContain("Paused it on the phone.");
  });

  it("leaves the phone playing when the TV didn't take it, and refuses other apps", async () => {
    const pausePhone = vi.fn(async () => true);
    const media = {
      ok: true,
      summary: "ok",
      title: "Song",
      artist: "x",
      playing: true,
      position: 0,
    };
    const down = async (): Promise<ShellReply> => ({
      ok: false,
      output: "",
      exitCode: -1,
      summary: "I can't reach the TV.",
    });
    const r = await runTvControl(down, "cast", "", "", {
      ...env,
      phoneMedia: async () => ({ ...media, package: "com.google.android.youtube" }),
      findYoutube: async () => ({ id: "jfKfPfyJRdk" }),
      pausePhone,
    });
    expect(r.ok).toBe(false);
    expect(pausePhone).not.toHaveBeenCalled();
    const spotify = await runTvControl(down, "cast", "", "", {
      ...env,
      phoneMedia: async () => ({ ...media, package: "com.spotify.music" }),
      pausePhone,
    });
    expect(spotify).toMatchObject({ ok: false });
    expect(spotify.summary).toContain("only YouTube and Netflix");
    const nothing = await runTvControl(down, "cast", "", "", {
      ...env,
      phoneMedia: async () => ({ ok: false, summary: "Nothing is playing on the phone." }),
    });
    expect(nothing).toEqual({ ok: false, summary: "Nothing is playing on the phone." });
  });
});
