import { describe, expect, it, vi } from "vitest";
import { changed, keyNames, lookAtTv, parseCommand, runTvTask, type Sight } from "./tvSight";
import type { ShellReply, TvCapture, TvShell } from "./tv";

/** A TV that's awake, in `app`, whose screenshots come from `shots` in turn. */
function fakeTv(shots: Partial<TvCapture>[], app = "com.google.android.youtube.tv") {
  const sent: string[] = [];
  const shell = (async (command: string): Promise<ShellReply> => {
    sent.push(command);
    if (command.includes("mWakefulness")) return reply("mWakefulness=Awake");
    if (command.includes("mCurrentFocus")) return reply(`mCurrentFocus=Window{1 u0 ${app}/x}`);
    return reply("");
  }) as TvShell;
  let n = 0;
  shell.capture = async () => ({
    ok: true,
    image: "IMG",
    blocked: false,
    blank: false,
    sig: sig(0),
    summary: "",
    ...shots[Math.min(n++, shots.length - 1)],
  });
  return { shell, sent };
}
const reply = (output: string): ShellReply => ({ ok: true, output, exitCode: 0, summary: "" });
const sig = (level: number) => btoa(String.fromCharCode(...new Array(2304).fill(level)));

function sight(replies: string[]): Sight & { prompts: string[]; images: string[] } {
  const prompts: string[] = [];
  const images: string[] = [];
  return {
    prompts,
    images,
    see: async (_s, p, img) => {
      prompts.push(p);
      images.push(img);
      return replies.shift() ?? "";
    },
    wait: async () => {},
  };
}

describe("TV by sight — look", () => {
  it("answers from the screenshot", async () => {
    const tv = fakeTv([{}]);
    const s = sight(["A YouTube search for lofi."]);
    const r = await lookAtTv(tv.shell, "what's on?", s);
    expect(r).toEqual({ ok: true, summary: "A YouTube search for lofi." });
    expect(s.prompts[0]).toContain("YouTube");
    expect(s.images[0]).toBe("IMG");
  });

  it("says Netflix can't be seen instead of guessing, and needs a vision model", async () => {
    const r = await lookAtTv(fakeTv([{ blocked: true }], "com.netflix.ninja").shell, "", sight([]));
    expect(r.summary).toContain("Netflix, which blocks screenshots");
    const none = await lookAtTv(fakeTv([{}]).shell, "", sight([]));
    expect(none).toMatchObject({ ok: false, error: "no_vision" });
  });
});

describe("TV by sight — task", () => {
  it("presses what the model sees fit and succeeds only on its done", async () => {
    const tv = fakeTv([{ sig: sig(0) }, { sig: sig(200) }]);
    const s = sight([
      '{"do":"keys","keys":["down","down","ok"]}',
      '{"do":"done","summary":"Playing the second result."}',
    ]);
    const r = await runTvTask(tv.shell, "play the second lofi result", s);
    expect(r).toEqual({ ok: true, summary: "Playing the second result." });
    expect(tv.sent).toContain("input keyevent 20 20 23");
  });

  it("stops when presses change nothing, and when the screen stays hidden", async () => {
    const same = fakeTv([{ sig: sig(0) }]);
    const keys = '{"do":"keys","keys":["right"]}';
    const r = await runTvTask(same.shell, "go right", sight([keys, keys, keys, keys, keys]));
    expect(r.summary).toContain("isn't responding");
    const hidden = fakeTv([{ blocked: true }], "com.netflix.ninja");
    const h = await runTvTask(
      hidden.shell,
      "pick episode 3",
      sight(['{"do":"wait"}', '{"do":"wait"}', '{"do":"wait"}']),
    );
    expect(h.summary).toContain("Netflix blocks screenshots");
  });

  it("honours STOP and an unanswered vision call", async () => {
    const stop = sight(['{"do":"wait"}']);
    stop.shouldStop = vi.fn(() => true);
    expect((await runTvTask(fakeTv([{}]).shell, "x", stop)).error).toBe("cancelled");
    const blind = await runTvTask(fakeTv([{}]).shell, "x", sight([]));
    expect(blind.summary).toContain("no vision model answered");
  });
});

describe("helpers", () => {
  it("reads the model's command and buttons, and tells a changed screen", () => {
    expect(parseCommand('Sure: {"do":"wait","seconds":2}')).toEqual({ do: "wait", seconds: 2 });
    expect(parseCommand("no json")).toBeNull();
    expect(keyNames("Down, down, OK, volume_up")).toEqual({
      known: ["down", "down", "ok"],
      ignored: ["volume_up"],
    });
    expect(changed(sig(0), sig(0))).toBe(false);
    expect(changed(sig(0), sig(100))).toBe(true);
  });
});
