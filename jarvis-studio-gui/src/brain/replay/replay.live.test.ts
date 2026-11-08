/**
 * The replay fixtures asked of a REAL model: does it pick the tool a correct turn
 * starts with? Measures the prompt + palette against today's models — run it after
 * changing either. Never part of `npm test` (it spends quota and models vary): it runs
 * only when named, `npm run test:live`, with a key in the environment —
 * GEMINI_API_KEY and/or GROQ_API_KEY (JARVIS_LIVE_MODEL pins a model).
 */
import { afterAll, describe, expect, it } from "vitest";
import { chatOverLadder } from "../ask";
import type { BrainConfig } from "../config";
import { buildSystemPrompt } from "../index";
import { groupsFor, toolPalette, turnPalette } from "../tools/registry";
import { scoreSelection, selectionReport, type SelectionScore } from "./evaluation";
import fixtures from "./fixtures.json";
import type { Fixture } from "./replay.test";

// Node's process, without pulling Node's types into the app's build.
const proc = (
  globalThis as unknown as {
    process?: { env: Record<string, string | undefined>; argv: string[] };
  }
).process;
const env = proc?.env ?? {};
const gemini = env.GEMINI_API_KEY ?? "";
const groq = env.GROQ_API_KEY ?? "";
const named = (proc?.argv ?? []).some((a) => a.includes("replay.live"));
const live = named && Boolean(gemini || groq);
const scores: SelectionScore[] = [];
afterAll(() => { if (live) console.info("Live labelled selection evaluation:", selectionReport(scores)); });

const cfg: BrainConfig = {
  tier: gemini ? "gemini" : "groq",
  model: env.JARVIS_LIVE_MODEL || (gemini ? "gemini-2.5-flash" : "llama-3.3-70b-versatile"),
  autoModel: !env.JARVIS_LIVE_MODEL,
  keys: { ...(gemini ? { gemini: [gemini] } : {}), ...(groq ? { groq: [groq] } : {}) },
};

describe.skipIf(!live)("live model behaviour (replay fixtures)", () => {
  for (const f of (fixtures as Fixture[]).filter((x) => x.live)) {
    it(
      f.name,
      async () => {
        const full = toolPalette(cfg, f.context);
        const tools = turnPalette(full, groupsFor(f.user));
        const started = Date.now();
        const reply = await chatOverLadder(
          [
            {
              role: "system",
              content: buildSystemPrompt(cfg, [], !!f.context.pcPaired, !!f.context.tvPaired),
            },
            ...(f.history ?? []),
            { role: "user", content: f.user },
          ],
          tools,
          cfg,
        );
        const score = scoreSelection(reply, f.live!, tools, Date.now() - started);
        scores.push(score);
        expect(score.correct, `replied “${reply.text.slice(0, 120)}”`).toBe(true);
      },
      60_000,
    );
  }
});
