import { beforeEach, describe, expect, it, vi } from "vitest";

const getJson = vi.fn();
vi.mock("../tools/httpClient", () => ({ getJson: (...a: unknown[]) => getJson(...a) }));

import { checkForUpdate, isNewer } from "./update";

const T0 = 1_760_000_000_000; // a real epoch ms, so "a day since 0" has passed
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
});

beforeEach(() => {
  store.clear();
  getJson.mockReset();
});

describe("isNewer", () => {
  it("compares x.y.z numerically, not as text", () => {
    expect(isNewer("v2.1.0", "2.0.0")).toBe(true);
    expect(isNewer("v2.10.0", "2.9.0")).toBe(true);
    expect(isNewer("v2.1.0", "2.1.0")).toBe(false);
    expect(isNewer("v2.0.9", "2.1.0")).toBe(false);
    expect(isNewer("v3", "2.9.9")).toBe(true);
    expect(isNewer("2.5.0-beta.10", "2.5.0-beta.2")).toBe(true);
    expect(isNewer("2.5.0", "2.5.0-beta.2")).toBe(true);
    expect(isNewer("2.5.0-beta.2", "2.5.0")).toBe(false);
  });
});

describe("checkForUpdate", () => {
  it("keeps beta opt-in, with a separate check window and correct prerelease ordering", async () => {
    getJson.mockResolvedValue({ tag_name: "v2.5.0-beta.1", prerelease: true });
    expect(await checkForUpdate("2.4.0", T0)).toBeNull();
    getJson.mockResolvedValue([
      { tag_name: "v2.5.0-beta.2", prerelease: true },
      { tag_name: "v2.5.0-beta.10", prerelease: true },
      { tag_name: "v9.0.0", draft: true },
    ]);
    expect(await checkForUpdate("2.4.0", T0, "beta")).toMatchObject({ version: "2.5.0-beta.10" });
    expect(getJson).toHaveBeenCalledTimes(2);
    expect(await checkForUpdate("2.4.0", T0 + 1000, "beta")).toBeNull();
  });
  it("reports a newer release with its page", async () => {
    getJson.mockResolvedValue({
      tag_name: "v2.2.0",
      html_url: "https://github.com/x/releases/tag/v2.2.0",
    });
    expect(await checkForUpdate("2.1.0")).toEqual({
      version: "2.2.0",
      url: "https://github.com/x/releases/tag/v2.2.0",
    });
  });

  it("stays quiet when up to date, and asks GitHub at most once a day", async () => {
    getJson.mockResolvedValue({ tag_name: "v2.1.0" });
    expect(await checkForUpdate("2.1.0", T0)).toBeNull();
    expect(await checkForUpdate("2.1.0", T0 + 60_000)).toBeNull();
    expect(getJson).toHaveBeenCalledTimes(1);
    await checkForUpdate("2.1.0", T0 + 25 * 60 * 60 * 1000);
    expect(getJson).toHaveBeenCalledTimes(2);
  });

  it("never surfaces a failed check", async () => {
    getJson.mockRejectedValue(new Error("HTTP 403"));
    expect(await checkForUpdate("2.1.0")).toBeNull();
  });
});
