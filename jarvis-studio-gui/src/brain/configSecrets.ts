import type { KV } from "./memory/store";

export const CONFIG_SECRET_FIELDS = [
  "geminiKey",
  "groqKey",
  "vertexSaJson",
  "openrouterKey",
  "mistralKey",
  "nvidiaKey",
] as const;
export type ConfigSecretName = (typeof CONFIG_SECRET_FIELDS)[number];
export type ConfigSecrets = Partial<Record<ConfigSecretName, string>>;

export interface ConfigSecretReadResult {
  ok: boolean;
  present?: boolean;
  value?: string;
  summary?: string;
}

export interface ConfigSecretWriteResult {
  ok: boolean;
  summary?: string;
}

export interface ConfigSecretBridge {
  get(name: ConfigSecretName): Promise<ConfigSecretReadResult>;
  set(name: ConfigSecretName, value: string): Promise<ConfigSecretWriteResult>;
  delete(name: ConfigSecretName): Promise<ConfigSecretWriteResult>;
}

export interface LoadedConfig {
  /** Public configuration plus an ephemeral copy of any legacy secrets. */
  config: Record<string, unknown>;
  /** Legacy plaintext removed from storage during this read. */
  legacySecrets: ConfigSecrets;
}

export interface HydratedSecrets {
  secrets: ConfigSecrets;
  migrated: ConfigSecretName[];
  failures: Array<{ name: ConfigSecretName; reason: string }>;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Return only data that is safe to persist in WebView storage. */
export function sanitizePublicConfig(value: unknown): Record<string, unknown> {
  const source = record(value);
  const clean: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(source)) {
    if (
      !(CONFIG_SECRET_FIELDS as readonly string[]).includes(key) &&
      !["__proto__", "prototype", "constructor"].includes(key)
    ) {
      clean[key] = item;
    }
  }
  return clean;
}

export function pickConfigSecrets(value: unknown): ConfigSecrets {
  const source = record(value);
  const secrets: ConfigSecrets = {};
  for (const name of CONFIG_SECRET_FIELDS) {
    const candidate = source[name];
    if (typeof candidate === "string" && candidate.trim()) secrets[name] = candidate.trim();
  }
  return secrets;
}

/**
 * Read the old config once and immediately rewrite it without credentials. The
 * returned legacy values exist only in JS memory long enough to migrate them to
 * Android Keystore-backed storage.
 */
export function loadAndPurgeLegacyConfig(
  kv: KV,
  key: string,
  fallback: Record<string, unknown> = {},
): LoadedConfig {
  let parsed: unknown = {};
  try {
    const raw = kv.get(key);
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    parsed = {};
  }

  const publicConfig = sanitizePublicConfig(parsed);
  const legacySecrets = pickConfigSecrets(parsed);
  // Always rewrite, including malformed input: no credential-shaped fields are
  // allowed to remain in the WebView persistence boundary.
  try {
    kv.set(key, JSON.stringify(publicConfig));
  } catch (error) {
    // If a quota/backend failure prevents the sanitized rewrite, remove the old
    // record rather than leave credential plaintext at rest.
    try {
      kv.remove(key);
    } catch {
      /* the caller will fail closed below */
    }
    throw new Error("Could not purge credentials from WebView storage.", { cause: error });
  }
  return {
    config: { ...fallback, ...publicConfig, ...legacySecrets },
    legacySecrets,
  };
}

/**
 * StrictMode-safe initializer: a throwaway React mount may purge persistence
 * before the committed mount initializes. Keep the ephemeral migration payload
 * in a module-owned object until native hydration confirms each field is safe.
 */
export function loadAndAccumulateLegacyConfig(
  kv: KV,
  key: string,
  pending: ConfigSecrets,
  fallback: Record<string, unknown> = {},
): Record<string, unknown> {
  const loaded = loadAndPurgeLegacyConfig(kv, key, fallback);
  Object.assign(pending, loaded.legacySecrets);
  return { ...loaded.config, ...pending };
}

export function savePublicConfig(kv: KV, key: string, value: unknown): void {
  const encoded = JSON.stringify(sanitizePublicConfig(value));
  try {
    kv.set(key, encoded);
  } catch (error) {
    try {
      kv.remove(key);
    } catch {
      /* preserve the original persistence error */
    }
    throw new Error("Could not persist public configuration safely.", { cause: error });
  }
}

/**
 * Load Keystore-backed values and migrate only when the native store confirms a
 * field is absent. Read failures are fail-closed: legacy memory is retained for
 * this process, but Aura will not overwrite an unreadable native credential.
 */
export async function hydrateConfigSecrets(
  bridge: ConfigSecretBridge,
  legacySecrets: ConfigSecrets = {},
): Promise<HydratedSecrets> {
  const secrets: ConfigSecrets = {};
  const migrated: ConfigSecretName[] = [];
  const failures: Array<{ name: ConfigSecretName; reason: string }> = [];

  for (const name of CONFIG_SECRET_FIELDS) {
    let read: ConfigSecretReadResult;
    try {
      read = await bridge.get(name);
    } catch {
      read = { ok: false, summary: "Native secure storage is unavailable." };
    }

    if (!read.ok) {
      if (legacySecrets[name]) secrets[name] = legacySecrets[name];
      failures.push({ name, reason: read.summary || "Secure credential read failed." });
      continue;
    }

    if (read.present) {
      if (typeof read.value === "string" && read.value.length > 0) {
        secrets[name] = read.value;
      } else {
        failures.push({ name, reason: "Secure storage returned an invalid credential." });
      }
      continue;
    }

    const legacy = legacySecrets[name];
    if (!legacy) continue;
    let written: ConfigSecretWriteResult;
    try {
      written = await bridge.set(name, legacy);
    } catch {
      written = { ok: false, summary: "Native secure storage is unavailable." };
    }
    secrets[name] = legacy;
    if (written.ok) migrated.push(name);
    else failures.push({ name, reason: written.summary || "Secure credential migration failed." });
  }

  return { secrets, migrated, failures };
}
