/**
 * Replay tests: recorded (or live-observed) model replies, played back through the
 * REAL turn loop, palette, tool lowering and guards — only the model and the dispatcher
 * are scripted. A change that would have mishandled what a model actually said fails
 * here. Each fixture (fixtures.json) is one turn: the user's words, the model's replies
 * in order, what each dispatched action returns, and what must happen. A fixture whose
 * model calls a tool the palette no longer has fails too: the model would be calling
 * something that's gone. `npm run test:live` (replay.live.test.ts) asks a real model
 * the same questions instead.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LLMReply } from "../providers";
import type { ToolDeclaration, ToolResult } from "../types";
import fixtures from "./fixtures.json";

const replies: LLMReply[] = [];
const palettes: string[][] = [];
vi.mock("../ask", () => ({
  chatOverLadder: async (_convo: unknown, tools?: ToolDeclaration[]) => {
    palettes.push((tools ?? []).map((t) => t.name));
    return replies.shift() ?? { text: "(the fixture ran out of model replies)", toolCalls: [] };
  },
}));
const specs: Array<Record<string, unknown>> = [];
const results: ToolResult[] = [];
vi.mock("../tools/dispatch", () => ({
  dispatch: async (spec: Record<string, unknown>) => {
    specs.push(spec);
    return results.shift() ?? { ok: true, summary: "Done." };
  },
}));

import { runTurn } from "../loop";
import type { DispatchDeps } from "../tools/dispatch";
import { groupsFor, LOAD_TOOLS, toolPalette, turnPalette } from "../tools/registry";

export interface Fixture {
  name: string;
  source: string;
  context: { pcPaired?: boolean; tvPaired?: boolean };
  /** Earlier turns of the conversation, when the request leans on them ("resume"). */
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  user: string;
  model: Array<{
    text?: string;
    toolCalls?: Array<{ name: string; args?: Record<string, unknown> }>;
  }>;
  results?: ToolResult[];
  expect: {
    specs: Array<Record<string, unknown>>;
    reply?: string;
    offered?: string[];
    dispatched?: number;
  };
  live?: { firstTool: string; firstArgs?: Record<string, unknown> };
}

const cfg = { tier: "groq" as const, model: "x", keys: {}, pinnedLocation: "" };

beforeEach(() => {
  replies.length = 0;
  palettes.length = 0;
  specs.length = 0;
  results.length = 0;
});

describe("replayed model turns", () => {
  for (const f of fixtures as Fixture[]) {
    it(f.name, async () => {
      const full = toolPalette(cfg, f.context);
      const names = new Set([...full.map((t) => t.name), LOAD_TOOLS]);
      for (const step of f.model) {
        for (const c of step.toolCalls ?? [])
          expect(names, `${c.name} no longer exists`).toContain(c.name);
      }
      replies.push(
        ...f.model.map((step, i) => ({
          text: step.text ?? "",
          toolCalls: (step.toolCalls ?? []).map((c, j) => ({
            id: `c${i}_${j}`,
            name: c.name,
            args: c.args ?? {},
          })),
        })),
      );
      results.push(...(f.results ?? []));
      const out = await runTurn(
        [...(f.history ?? []), { role: "user", content: f.user }],
        turnPalette(full, groupsFor(f.user)),
        { config: cfg } as unknown as DispatchDeps,
        undefined,
        full,
      );
      expect(replies, "every scripted model reply was asked for").toHaveLength(0);
      expect(specs.length, "actions dispatched").toBe(f.expect.dispatched ?? f.expect.specs.length);
      f.expect.specs.forEach((want, i) => expect(specs[i]).toMatchObject(want));
      if (f.expect.reply) expect(out.reply).toMatch(new RegExp(f.expect.reply, "i"));
      if (f.expect.offered) expect(palettes[0]).toEqual(expect.arrayContaining(f.expect.offered));
    });
  }
});
