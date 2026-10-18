import { afterEach, describe, expect, it, vi } from "vitest";
import { checkKey, discoverModels } from "./models";

/** Answers every request with `status`, recording the auth header it was sent. */
function stubFetch(status: number, body: unknown = { data: [], models: [] }) {
  const auth: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const h = (init?.headers ?? {}) as Record<string, string>;
      auth.push(h.Authorization ?? h["x-goog-api-key"] ?? "");
      return new Response(JSON.stringify(body), { status });
    }),
  );
  return auth;
}

afterEach(() => vi.unstubAllGlobals());

describe("checkKey", () => {
  it("only calls a key rejected when the provider refused it", async () => {
    for (const [status, verdict] of [
      [200, "ok"],
      [429, "ok"], // recognised, just rate-limited
      [401, "rejected"],
      [400, "rejected"], // Gemini's API_KEY_INVALID
      [503, "unverified"],
    ] as const) {
      stubFetch(status);
      expect(await checkKey("groq", "gsk_x")).toBe(verdict);
    }
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    expect(await checkKey("gemini", "AIza_x")).toBe("unverified");
  });

  it("rejects a Vertex paste that isn't a service-account file, without a network call", async () => {
    const auth = stubFetch(200);
    expect(await checkKey("vertex", "not json")).toBe("rejected");
    expect(await checkKey("vertex", '{"type":"authorized_user"}')).toBe("rejected");
    expect(auth).toEqual([]);
  });
});

it("lists models with the first of several pasted keys, not the multi-line string", async () => {
  const auth = stubFetch(200, { data: [{ id: "openai/gpt-oss-20b" }] });
  await discoverModels({ groq: "gsk_first\ngsk_second" });
  expect(auth).toEqual(["Bearer gsk_first"]);
});
