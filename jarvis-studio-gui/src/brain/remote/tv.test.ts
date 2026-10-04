import { describe, expect, it } from "vitest";
import {
  findEpisode,
  runTvControl,
  sameTitle,
  shellQuote,
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
    for (const action of TV_ACTIONS) {
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

  it("single-quotes text for the TV shell", () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });

  it("matches titles loosely but not different shows", () => {
    expect(sameTitle("Stranger Things", "stranger things season 4")).toBe(true);
    expect(sameTitle("Amélie", "amelie")).toBe(true);
    expect(sameTitle("Money Heist", "La Casa de Papel")).toBe(false);
  });
});
