/**
 * The replay fixtures asked of a REAL model: does it pick the tool a correct turn
 * starts with? Measures the prompt + palette against today's models — run it after
 * changing either. Never part of `npm test` (it spends quota and models vary): it runs
 * only when named, `npm run test:live`, with a key in the environment —
 * GEMINI_API_KEY and/or GROQ_API_KEY (JARVIS_LIVE_MODEL pins a model).
 */
import { describe, expect, it } from "vitest";
import { chatOverLadder } from "../ask";
import type { BrainConfig } from "../config";
import { buildSystemPrompt } from "../index";
import { groupsFor, LOAD_TOOLS, toolPalette, turnPalette } from "../tools/registry";
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
        const first = reply.toolCalls[0];
        // Asking for a group first is a correct start when the tool wasn't offered.
        if (first?.name === LOAD_TOOLS && !tools.some((t) => t.name === f.live!.firstTool)) return;
        expect(first?.name, `replied “${reply.text.slice(0, 120)}”`).toBe(f.live!.firstTool);
        if (f.live!.firstArgs) expect(first!.args).toMatchObject(f.live!.firstArgs);
      },
      60_000,
    );
  }
});
