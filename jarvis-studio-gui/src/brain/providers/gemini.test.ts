import { describe, it, expect } from "vitest";
import { buildRequest } from "./gemini";
import type { ChatMessage } from "../types";

describe("gemini buildRequest — multi-tool-call turns", () => {
  it("merges consecutive tool-result messages into ONE turn with matching functionResponse parts", () => {
    // Reproduces the live Vertex 400 ("number of function response parts is
    // equal to the number of function call parts of the function call turn")
    // seen when a single model turn makes more than one tool call — e.g. "what
    // day is it and what's the weather" calling get_time + get_weather.
    const messages: ChatMessage[] = [
      { role: "user", content: "What day is it and what's the weather?" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "a", name: "get_time", args: {} },
          { id: "b", name: "get_weather", args: {} },
        ],
      },
      { role: "tool", toolCallId: "a", toolName: "get_time", content: '{"ok":true}' },
      { role: "tool", toolCallId: "b", toolName: "get_weather", content: '{"ok":true}' },
    ];

    const req = buildRequest(messages, []);
    const modelTurn = req.contents.find(
      (c) => c.role === "model" && c.parts.some((p: any) => p.functionCall),
    );
    const toolTurns = req.contents.filter(
      (c) => c.role === "user" && c.parts.some((p: any) => p.functionResponse),
    );

    expect(modelTurn?.parts).toHaveLength(2);
    // The critical assertion: exactly ONE user turn carries BOTH function
    // responses, not two separate turns with one apiece.
    expect(toolTurns).toHaveLength(1);
    expect(toolTurns[0].parts).toHaveLength(2);
  });

  it("keeps a single tool call's response as its own one-part turn", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "What time is it?" },
      { role: "assistant", content: "", toolCalls: [{ id: "a", name: "get_time", args: {} }] },
      { role: "tool", toolCallId: "a", toolName: "get_time", content: '{"ok":true}' },
    ];
    const req = buildRequest(messages, []);
    const toolTurns = req.contents.filter(
      (c) => c.role === "user" && c.parts.some((p: any) => p.functionResponse),
    );
    expect(toolTurns).toHaveLength(1);
    expect(toolTurns[0].parts).toHaveLength(1);
  });

  it("does not merge tool results across separate rounds (a plain user message in between)", () => {
    const messages: ChatMessage[] = [
      { role: "assistant", content: "", toolCalls: [{ id: "a", name: "get_time", args: {} }] },
      { role: "tool", toolCallId: "a", toolName: "get_time", content: '{"ok":true}' },
      { role: "user", content: "and the weather?" },
      { role: "assistant", content: "", toolCalls: [{ id: "b", name: "get_weather", args: {} }] },
      { role: "tool", toolCallId: "b", toolName: "get_weather", content: '{"ok":true}' },
    ];
    const req = buildRequest(messages, []);
    const toolTurns = req.contents.filter(
      (c) => c.role === "user" && c.parts.some((p: any) => p.functionResponse),
    );
    expect(toolTurns).toHaveLength(2);
    expect(toolTurns[0].parts).toHaveLength(1);
    expect(toolTurns[1].parts).toHaveLength(1);
  });
});
