import { describe, expect, it } from "vitest";
import type { KV } from "../brain/memory/store";
import { loadPcConfigFromStore, sanitizePcConfig } from "./useBrain";

const PC_KEY = "jarvis.android.pc.v1";

function memoryKv(value?: unknown): KV & { data: Map<string, string> } {
  const data = new Map<string, string>();
  if (value !== undefined) data.set(PC_KEY, JSON.stringify(value));
  return {
    data,
    get: (key) => data.get(key) ?? null,
    set: (key, next) => void data.set(key, next),
    remove: (key) => void data.delete(key),
  };
}

const pinned = {
  host: "100.100.10.20",
  altHost: "192.168.1.20",
  port: 8765,
  secure: true,
  hostId: "host-01",
  hostFingerprint: "sha256:host-pin",
  hostPublicKey: "host-public-key",
  pairingChallengeId: "pair-once-01",
  deviceName: "My Aura phone",
};

describe("paired PC public-only persistence", () => {
  it("rewrites a pinned legacy record to the exact public allowlist", () => {
    const store = memoryKv({
      ...pinned,
      token: "legacy-bearer-must-be-erased",
      turnUrl: "turn:relay.example",
      turnUser: "relay-user",
      turnCred: "relay-password-must-be-erased",
      unknown: "not-allowed",
    });

    expect(loadPcConfigFromStore(store)).toEqual(pinned);
    expect(JSON.parse(store.get(PC_KEY)!)).toEqual(pinned);
    expect(store.get(PC_KEY)).not.toContain("legacy-bearer");
    expect(store.get(PC_KEY)).not.toContain("relay-password");
    expect(store.get(PC_KEY)).not.toContain("turnUrl");
    expect(store.get(PC_KEY)).not.toContain("unknown");
  });

  it("removes bearer-only and unpinned legacy records", () => {
    const store = memoryKv({ host: "192.168.1.20", token: "old-token" });

    expect(loadPcConfigFromStore(store)).toBeNull();
    expect(store.get(PC_KEY)).toBeNull();
  });

  it.each(["host", "hostId", "hostFingerprint", "hostPublicKey", "pairingChallengeId", "deviceName"])(
    "rejects and removes a record missing %s",
    (field) => {
      const value = { ...pinned } as Record<string, unknown>;
      delete value[field];
      const store = memoryKv(value);

      expect(loadPcConfigFromStore(store)).toBeNull();
      expect(store.get(PC_KEY)).toBeNull();
    },
  );

  it.each([0, -1, 65536, 1.5, "not-a-port"])("rejects invalid port %s", (port) => {
    expect(sanitizePcConfig({ ...pinned, port })).toBeNull();
  });

  it("drops duplicate or malformed alternate routes without weakening the pins", () => {
    const { altHost: _ignored, ...primary } = pinned;

    expect(sanitizePcConfig({ ...primary, altHost: primary.host })).toEqual(primary);
    expect(sanitizePcConfig({ ...primary, altHost: "https://attacker.invalid/path" })).toEqual(
      primary,
    );
  });
});
