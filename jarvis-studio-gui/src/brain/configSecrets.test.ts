import { describe, expect, it, vi } from "vitest";
import type { KV } from "./memory/store";
import {
  hydrateConfigSecrets,
  loadAndAccumulateLegacyConfig,
  loadAndPurgeLegacyConfig,
  sanitizePublicConfig,
  savePublicConfig,
  type ConfigSecretBridge,
  type ConfigSecretName,
  type ConfigSecrets,
} from "./configSecrets";

function memoryKv(initial: Record<string, string> = {}): KV & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get: (key) => data.get(key) ?? null,
    set: (key, value) => void data.set(key, value),
    remove: (key) => void data.delete(key),
  };
}

function bridgeWith(initial: Partial<Record<ConfigSecretName, string>> = {}) {
  const secure = new Map<ConfigSecretName, string>(Object.entries(initial) as Array<[
    ConfigSecretName,
    string,
  ]>);
  const bridge: ConfigSecretBridge = {
    get: vi.fn(async (name) => ({
      ok: true,
      present: secure.has(name),
      ...(secure.has(name) ? { value: secure.get(name) } : {}),
    })),
    set: vi.fn(async (name, value) => {
      secure.set(name, value);
      return { ok: true };
    }),
    delete: vi.fn(async (name) => {
      secure.delete(name);
      return { ok: true };
    }),
  };
  return { bridge, secure };
}

describe("WebView configuration credential boundary", () => {
  it("purges all legacy credential fields immediately while retaining them only in memory", () => {
    const key = "config";
    const kv = memoryKv({
      [key]: JSON.stringify({
        model: "gemini-2.5-flash",
        geminiKey: "AIza_plaintext",
        groqKey: "gsk_plaintext",
        vertexSaJson: '{"private_key":"plaintext"}',
      }),
    });

    const loaded = loadAndPurgeLegacyConfig(kv, key);

    expect(loaded.legacySecrets).toEqual({
      geminiKey: "AIza_plaintext",
      groqKey: "gsk_plaintext",
      vertexSaJson: '{"private_key":"plaintext"}',
    });
    expect(loaded.config.geminiKey).toBe("AIza_plaintext");
    expect(JSON.parse(kv.get(key)!)).toEqual({ model: "gemini-2.5-flash" });
    expect(kv.get(key)).not.toContain("AIza_plaintext");
    expect(kv.get(key)).not.toContain("gsk_plaintext");
    expect(kv.get(key)).not.toContain("private_key");
  });

  it("never writes credentials through the generic config save path", () => {
    const key = "config";
    const kv = memoryKv();

    savePublicConfig(kv, key, {
      providerMode: "groq",
      groqKey: "must-not-persist",
      geminiKey: "must-not-persist-either",
      vertexSaJson: "must-not-persist-json",
    });

    expect(JSON.parse(kv.get(key)!)).toEqual({ providerMode: "groq" });
  });

  it("survives React StrictMode's throwaway and committed initializers", () => {
    const key = "config";
    const kv = memoryKv({
      [key]: JSON.stringify({ theme: "dark", groqKey: "legacy-once" }),
    });
    const pending: ConfigSecrets = {};

    const throwaway = loadAndAccumulateLegacyConfig(kv, key, pending);
    const committed = loadAndAccumulateLegacyConfig(kv, key, pending);

    expect(throwaway).toEqual({ theme: "dark", groqKey: "legacy-once" });
    expect(committed).toEqual({ theme: "dark", groqKey: "legacy-once" });
    expect(kv.get(key)).toBe(JSON.stringify({ theme: "dark" }));
    // Only a confirmed native hydration/migration is allowed to clear this
    // module-owned handoff. Simulate that confirmation, then prove it is gone.
    delete pending.groqKey;
    expect(loadAndAccumulateLegacyConfig(kv, key, pending)).toEqual({ theme: "dark" });
  });

  it("migrates an absent legacy value but never overwrites an existing secure value", async () => {
    const { bridge, secure } = bridgeWith({ geminiKey: "native-wins" });

    const result = await hydrateConfigSecrets(bridge, {
      geminiKey: "stale-legacy",
      groqKey: "legacy-to-migrate",
    });

    expect(result.secrets).toEqual({
      geminiKey: "native-wins",
      groqKey: "legacy-to-migrate",
    });
    expect(result.migrated).toEqual(["groqKey"]);
    expect(secure.get("geminiKey")).toBe("native-wins");
    expect(secure.get("groqKey")).toBe("legacy-to-migrate");
    expect(bridge.set).not.toHaveBeenCalledWith("geminiKey", expect.anything());
  });

  it("fails closed on secure-store read failure and does not overwrite it", async () => {
    const { bridge } = bridgeWith();
    vi.mocked(bridge.get).mockImplementation(async (name) =>
      name === "vertexSaJson"
        ? { ok: false, summary: "ciphertext authentication failed" }
        : { ok: true, present: false },
    );

    const result = await hydrateConfigSecrets(bridge, {
      vertexSaJson: "legacy-held-in-memory",
    });

    expect(result.secrets.vertexSaJson).toBe("legacy-held-in-memory");
    expect(result.failures).toEqual([
      { name: "vertexSaJson", reason: "ciphertext authentication failed" },
    ]);
    expect(bridge.set).not.toHaveBeenCalledWith("vertexSaJson", expect.anything());
  });

  it("sanitizes malformed and non-object input without retaining secret fields", () => {
    expect(sanitizePublicConfig(null)).toEqual({});
    expect(sanitizePublicConfig(["geminiKey", "secret"])).toEqual({});
    expect(sanitizePublicConfig({ geminiKey: "x", theme: "dark" })).toEqual({ theme: "dark" });
  });
});
