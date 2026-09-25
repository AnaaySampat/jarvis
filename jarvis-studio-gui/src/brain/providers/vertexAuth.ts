/**
 * Vertex AI Service Account authentication.
 * Parses a Google Cloud Service Account JSON and produces short-lived OAuth2
 * access tokens via a locally signed JWT.
 */

import { platformFetch, withRetry } from "../tools/httpClient";
import { bytesToBase64, base64ToBytes } from "../tools/base64";

interface ServiceAccount {
  type: string;
  project_id: string;
  private_key: string;
  client_email: string;
}

let cachedToken: string | null = null;
let tokenExpiry = 0; // Epoch ms
/** Which service account the cached token belongs to.
 *
 *  The cache used to be keyed on nothing at all, so pasting a NEW service-account
 *  JSON kept handing out the OLD project's bearer token for up to 55 minutes while
 *  chatVertex built its URL from the new project_id — a guaranteed 403, which
 *  isFatalForRoute then benched the only Vertex route for a full day. Saving keys
 *  calls quota.clear(), which just re-benched on the next turn because the stale
 *  token was still cached. */
let cachedTokenKey = "";

/** Cheap stable identity for a service account — client_email + the key id, never
 *  the private key itself. */
function credentialKey(jsonStr: string): string {
  try {
    const sa = JSON.parse(jsonStr) as { client_email?: string; private_key_id?: string };
    return `${sa.client_email ?? ""}:${sa.private_key_id ?? ""}`;
  } catch {
    return jsonStr.length ? `len:${jsonStr.length}` : "";
  }
}

/** Parse the SA JSON and extract key fields. */
export function parseServiceAccountJson(jsonStr: string): ServiceAccount {
  const sa = JSON.parse(jsonStr);
  if (sa.type !== "service_account" || !sa.project_id || !sa.private_key || !sa.client_email) {
    throw new Error("Invalid Service Account JSON. Missing required fields.");
  }
  return sa;
}

/** Extract just the project_id from the JSON. */
export function extractProjectId(jsonStr: string): string {
  try {
    return parseServiceAccountJson(jsonStr).project_id;
  } catch {
    return "";
  }
}

/** Helper to convert base64url to Uint8Array */
function b64ToUint8Array(b64: string): Uint8Array {
  return base64ToBytes(b64.replace(/-/g, "+").replace(/_/g, "/"));
}

/** Helper to convert Uint8Array to base64url */
function uint8ArrayToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Sign data with Web Crypto API */
async function signJwt(privateKeyPem: string, payload: Record<string, unknown>): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" };
  const headerB64 = uint8ArrayToBase64Url(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = uint8ArrayToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const dataToSign = `${headerB64}.${payloadB64}`;

  // Clean the PEM to get the base64 DER
  const pemHeader = "-----BEGIN PRIVATE KEY-----";
  const pemFooter = "-----END PRIVATE KEY-----";
  const rsaHeader = "-----BEGIN RSA PRIVATE KEY-----";
  const rsaFooter = "-----END RSA PRIVATE KEY-----";

  let b64Key = privateKeyPem;
  if (b64Key.includes(rsaHeader)) {
    b64Key = b64Key.replace(rsaHeader, "").replace(rsaFooter, "").replace(/\s/g, "");
  } else {
    b64Key = b64Key.replace(pemHeader, "").replace(pemFooter, "").replace(/\s/g, "");
  }

  const derKey = b64ToUint8Array(b64Key);
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    derKey as BufferSource,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signatureBytes = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(dataToSign),
  );

  const signatureB64 = uint8ArrayToBase64Url(new Uint8Array(signatureBytes));
  return `${dataToSign}.${signatureB64}`;
}

/** Get a valid OAuth2 access token, fetching a new one if needed. */
export async function getAccessToken(jsonStr: string): Promise<string> {
  const now = Date.now();
  const key = credentialKey(jsonStr);
  // Refresh if less than 5 minutes remain, OR if these are different credentials
  // from the ones the cached token was minted for.
  if (cachedToken && cachedTokenKey === key && now < tokenExpiry - 5 * 60 * 1000) {
    return cachedToken;
  }

  const sa = parseServiceAccountJson(jsonStr);
  const iat = Math.floor(now / 1000);
  const exp = iat + 3600; // 1 hour

  const payload = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    exp,
    iat,
  };

  const jwt = await signJwt(sa.private_key, payload);

  const res = await withRetry(() =>
    platformFetch()("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
    }),
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to exchange JWT for access token: ${res.status} ${err}`);
  }

  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  // Never cache (and send "Bearer undefined" for an hour) a reply without a token.
  if (!data.access_token) throw new Error("Google's token endpoint returned no access_token.");
  cachedToken = data.access_token;
  cachedTokenKey = key;
  tokenExpiry = now + (data.expires_in ?? 3600) * 1000;
  return cachedToken;
}
