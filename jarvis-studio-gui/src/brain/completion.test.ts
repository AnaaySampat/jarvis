import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./ask", () => ({ chatOverLadder: vi.fn() }));
import { chatOverLadder } from "./ask";
import { reviewCompletion } from "./completion";
import { agentResult } from "./results";
import type { BrainConfig } from "./config";
const model = vi.mocked(chatOverLadder);
beforeEach(() => model.mockReset());

describe("completion evaluations", () => {
  const opened = () =>
    agentResult({ ok: true, summary: "Opened Notepad" }, "Open Notepad", "open_application");
  it("keeps a missing save separate from a successful open", async () => {
    model.mockResolvedValue({
      text: JSON.stringify({
        status: "partial",
        completed: ["Opened Notepad"],
        remaining: ["Save comparison"],
      }),
      toolCalls: [],
    });
    expect(
      await reviewCompletion("Open and save comparison", [opened()], {} as BrainConfig),
    ).toMatchObject({ status: "partial", remaining: ["Save comparison"] });
  });
  it("a checker outage or unrecognized verdict never means success", async () => {
    model.mockRejectedValueOnce(new Error("offline"));
    expect((await reviewCompletion("Save", [opened()], {} as BrainConfig)).status).toBe(
      "unverified",
    );
    model.mockResolvedValue({ text: "probably done", toolCalls: [] });
    expect((await reviewCompletion("Save", [opened()], {} as BrainConfig)).status).toBe(
      "unverified",
    );
  });

  it("accepts the live fenced successful Files verdict and supplies the final answer", async () => {
    model.mockResolvedValue({
      text: '```json\n{"status":"succeeded","completed":["Explained and cited both pages"],"remaining":[]}\n```',
      toolCalls: [],
    });
    const answer = "The token is orchid-7429; expected count 3.";
    const result = await reviewCompletion("Read token", [opened()], {} as BrainConfig, answer);
    expect(result.status).toBe("succeeded");
    expect(JSON.parse(model.mock.calls[0]![0][1]!.content).answer).toBe(answer);
  });

  it("retries a malformed live reviewer response once, without executing any tool", async () => {
    model.mockResolvedValueOnce({
      text: "<tool_call>\n<tool_call>\nnull\n<tool_call>",
      toolCalls: [],
    });
    model.mockResolvedValueOnce({
      text: '{"status":"succeeded","completed":["Weather answered"],"remaining":[]}',
      toolCalls: [],
    });
    expect((await reviewCompletion("Weather", [opened()], {} as BrainConfig)).status).toBe(
      "succeeded",
    );
    expect(model).toHaveBeenCalledTimes(2);
    expect(model.mock.calls.every((c) => c[1].length === 0)).toBe(true);
  });

  it("never promotes blocked effects or an inconsistent success verdict", async () => {
    const blocked = agentResult(
      { ok: false, error: "approval_denied", summary: "Denied" },
      "Send",
      "send_message",
    );
    expect((await reviewCompletion("Send", [blocked], {} as BrainConfig, "Sent")).status).toBe(
      "unverified",
    );
    expect(model).not.toHaveBeenCalled();
    model.mockResolvedValue({
      text: '{"status":"succeeded","completed":["Opened"],"remaining":["Save"]}',
      toolCalls: [],
    });
    expect((await reviewCompletion("Open and save", [opened()], {} as BrainConfig)).status).toBe(
      "unverified",
    );
  });
});
