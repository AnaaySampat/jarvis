/**
 * RemotePC — the phone's WebSocket client for the user's paired Windows PC (Phase 3).
 *
 * Remote tasks use the versioned v2 task protocol.  A task has a stable ID and
 * idempotency key, is explicitly accepted, can be resubscribed with an event
 * cursor after reconnect, and only completes from a correlated terminal task
 * event/status. Ambient chat/telemetry events can never complete or keep a task
 * alive.
 *
 * Authentication is device-key based. No bearer credential is accepted in URLs,
 * WebSocket protocols, storage, or compatibility flags.
 */

import { invoke } from "@tauri-apps/api/core";
import type { ToolResult } from "../types";

/** Live connection state, surfaced to the pairing UI. */
export type RemoteState =
  | "idle" // never configured / not connecting
  | "connecting"
  | "online" // socket open + authorized (we've seen the backend speak)
  | "offline" // closed or failed; auto-reconnecting
  | "unauthorized"; // identity, pin, scope, or origin rejected — won't auto-retry

/** Where to reach the PC. Persisted by the hook in localStorage. */
export interface RemotePCConfig {
  /** IP or hostname of the PC, e.g. "192.168.1.20". */
  host: string;
  /** A second address to try automatically when `host` is unreachable — typically
   *  the PC's Tailscale IP, picked up from the pairing QR when both were on the
   *  same Wi-Fi. Lets the phone reach the PC from a different network with no
   *  manual "which network am I on" step: we just try both and use whichever
   *  answers. */
  altHost?: string;
  /** Backend port. The desktop backend listens on 8765. */
  port?: number;
  /** Use wss:// instead of ws:// (for a TLS-terminated link). */
  secure?: boolean;
  /** Optional test/display hint. Production identity comes from Android Keystore. */
  deviceId?: string;
  /** Host public identity pinned from the expiring pairing QR. */
  hostId?: string;
  hostFingerprint?: string;
  hostPublicKey?: string;
  /** Public, expiring, single-use challenge identifier from the pairing QR. */
  pairingChallengeId?: string;
  /** 6-digit pairing PIN shown on the PC screen (NOT in the QR) and typed in by
   *  the user. Sent once with pairing.claim as the human-present proof; unused
   *  after pairing (reconnects authenticate with a signed auth.response). Never
   *  persisted — held only for the life of this connection. */
  pin?: string;
  deviceName?: string;
}

/** One raw backend event, forwarded to the HUD (step feed, status, warnings…). */
export interface RemoteEvent {
  event: string;
  data: unknown;
  taskId?: string;
  seq?: number;
  version?: number;
}

/** Minimal browser-WebSocket surface we rely on (browser + Node 24 global both fit). */
interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
}
type WebSocketCtor = new (url: string, protocols?: string | string[]) => WebSocketLike;

export interface RemotePCOptions extends RemotePCConfig {
  /** Every backend event, in order — drive the live step feed / status from this. */
  onEvent?: (ev: RemoteEvent) => void;
  /** Connection-state changes, for the pairing UI's status pill. */
  onStateChange?: (state: RemoteState) => void;
  /** Give up on a task after this many ms with NO event from the PC. Default 210s —
   *  MUST exceed the desktop's cold browser-launch budget (browser.py `_LAUNCH_TIMEOUT`
   *  = 150s) plus its first plan/step, or the phone aborts a launch the PC is still
   *  legitimately doing (the "searched but errored just before playing" bug). */
  taskIdleTimeoutMs?: number;
  /** Absolute cap for one task, however lively. Default 15 min. */
  taskMaxMs?: number;
  /** How long to wait for the user to answer a mid-task prompt. Default 5 min. */
  awaitingUserTimeoutMs?: number;
  /** How long to wait for the socket to come online before a task. Default 8s. */
  connectTimeoutMs?: number;
  /** How long to wait for the silent LAN-reachability probe to open before giving
   *  up and staying on the cross-network link. Default 2.5s. */
  lanProbeTimeoutMs?: number;
  /** Base reconnect delay; backs off up to 15s. Default 3s. */
  reconnectMs?: number;
  /** Injected WebSocket constructor (tests / Node). Defaults to the global. */
  WebSocketImpl?: WebSocketCtor;
  /** Native identity bridge injection for deterministic protocol tests. */
  identityBridge?: DeviceIdentityBridge;
}

export interface IdentityInfo {
  ok: boolean;
  deviceId: string;
  publicKey: string;
  fingerprint: string;
  summary?: string;
}

export interface IdentitySigned {
  ok: boolean;
  deviceId: string;
  counter: number;
  signature: string;
  publicKey?: string;
  fingerprint?: string;
  deviceName?: string;
  summary?: string;
}

export interface DeviceIdentityBridge {
  info(): Promise<IdentityInfo>;
  signAuth(input: { hostId: string; nonce: string }): Promise<IdentitySigned>;
  signEnvelope(input: {
    connectionNonce: string;
    messageType: string;
    taskId: string;
    payloadDigest: string;
  }): Promise<IdentitySigned>;
  signPairing(input: {
    hostId: string;
    challengeId: string;
    connectionNonce: string;
    deviceName: string;
  }): Promise<IdentitySigned>;
  verifyHostChallenge(input: {
    publicKey: string;
    expectedFingerprint: string;
    hostId: string;
    nonce: string;
    expiresAt: number;
    connectionId: string;
    signature: string;
  }): Promise<{ ok: boolean; verified: boolean }>;
  verifyHostEnvelope(input: {
    publicKey: string;
    expectedFingerprint: string;
    hostId: string;
    connectionNonce: string;
    counter: number;
    messageType: string;
    taskId: string;
    payloadDigest: string;
    signature: string;
  }): Promise<{ ok: boolean; verified: boolean }>;
}

const nativeIdentityBridge: DeviceIdentityBridge = {
  info: () => invoke<IdentityInfo>("plugin:phone|identity_info"),
  signAuth: (input) => invoke<IdentitySigned>("plugin:phone|identity_sign_auth", input),
  signEnvelope: (input) =>
    invoke<IdentitySigned>("plugin:phone|identity_sign_envelope", input),
  signPairing: (input) =>
    invoke<IdentitySigned>("plugin:phone|identity_sign_pairing", input),
  verifyHostChallenge: (input) =>
    invoke<{ ok: boolean; verified: boolean }>(
      "plugin:phone|identity_verify_host_challenge",
      input,
    ),
  verifyHostEnvelope: (input) =>
    invoke<{ ok: boolean; verified: boolean }>(
      "plugin:phone|identity_verify_host_envelope",
      input,
    ),
};

const OPEN = 1;

interface Pending {
  resolve: (r: ToolResult) => void;
  done: boolean;
  taskId: string;
  idempotencyKey: string;
  goal: string;
  /** Which PC surface runs this task — 'computer' drives native apps/files, 'browser'
   *  the web, 'auto' lets the DESKTOP classify (used by live-view command mode). */
  kind: "browser" | "computer" | "auto";
  accepted: boolean;
  lastSeq: number;
  bufferedEvents: Map<number, string>;
  replayRequested: boolean;
  warnings: string[];
  /** The PC is asking the user something (permission/clarify) → idle watchdog paused. */
  awaitingUser: boolean;
  idleTimer: ReturnType<typeof setTimeout> | null;
  maxTimer: ReturnType<typeof setTimeout> | null;
  awaitingTimer: ReturnType<typeof setTimeout> | null;
}

interface ActiveApprovalChallenge {
  taskId: string;
  approvalId: string;
  stepId: string;
  actionDigest: string;
  expiresAt: number;
  expiresAtMs: number;
}

const PROTOCOL_VERSION = 2;

function newId(prefix: string): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  const random = c?.randomUUID?.();
  if (random) return `${prefix}-${random}`;
  // Tests and older WebViews may not expose randomUUID.  This is correlation,
  // not an authentication secret; entropy from time + Math.random is sufficient.
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite protocol number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  throw new Error("unsupported protocol payload");
}

async function payloadDigest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/** The native identity bridge (Tauri invoke into the Kotlin plugin) occasionally
 * drops a call's callback under load or around a WebView reload — surfaced as
 * "[TAURI] Couldn't find callback id ..." in logcat. Critically, the orphaned
 * call does NOT reject: its promise just never settles, so a plain try/retry
 * never even reaches the catch block and hangs until the HOST's own 20s
 * handshake-reply timeout kills the connection first. Race every attempt
 * against a short local timeout so a hang is treated as a failure and retried,
 * instead of silently consuming the entire host-side window. */
async function withIdentityBridgeRetry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  perAttemptMs = 4_000,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await new Promise<T>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("native identity call timed out")),
          perAttemptMs,
        );
        fn().then(
          (value) => { clearTimeout(timer); resolve(value); },
          (error) => { clearTimeout(timer); reject(error); },
        );
      });
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("native identity call failed");
}

/** A DEFINITIVE identity verdict — a host pin mismatch, a failed signature check,
 * the server explicitly denying us, or pairing demanded with no usable QR
 * challenge. Only these may surface as "Identity rejected" (terminal, no
 * auto-retry). Every other failure — a flaky native bridge call, a transport
 * gate closing the socket before the handshake, malformed traffic — is treated
 * as transient: drop the connection and reconnect (which also cycles to the
 * other known address). */
class IdentityRejected extends Error {}

function envelopeContent(message: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(message).filter(
      ([key]) => !["auth", "type", "event", "task_id"].includes(key),
    ),
  );
}

const ACTION_DIGEST = /^(?:sha256:)?[0-9a-f]{64}$/i;

function approvalChallengeOf(
  value: unknown,
  taskId: string,
): ActiveApprovalChallenge | null {
  const data = objectOf(value);
  if (!data) return null;
  const approvalId =
    typeof data.approval_id === "string"
      ? data.approval_id.trim()
      : typeof data.challenge_id === "string"
        ? data.challenge_id.trim()
        : "";
  const stepId = typeof data.step_id === "string" ? data.step_id.trim() : "";
  const actionDigest =
    typeof data.action_digest === "string" ? data.action_digest.trim().toLowerCase() : "";
  const expiresAt = Number(data.expires_at);
  const expiresAtMs = expiresAt < 1_000_000_000_000 ? expiresAt * 1000 : expiresAt;
  if (
    !taskId ||
    !approvalId ||
    approvalId.length > 256 ||
    !stepId ||
    stepId.length > 256 ||
    !ACTION_DIGEST.test(actionDigest) ||
    !Number.isFinite(expiresAt) ||
    !Number.isFinite(expiresAtMs) ||
    expiresAtMs <= Date.now()
  ) {
    return null;
  }
  return { taskId, approvalId, stepId, actionDigest, expiresAt, expiresAtMs };
}

export class RemotePC {
  private cfg: RemotePCConfig;
  private opts: RemotePCOptions;
  private WS: WebSocketCtor;
  private ws: WebSocketLike | null = null;
  private _state: RemoteState = "idle";
  private pending: Pending | null = null;
  private manualClose = false;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Candidate addresses to dial — the CROSS-network `altHost` (Tailscale) FIRST,
   *  then the direct LAN `host` if distinct. Cross-first because the Tailscale
   *  address reaches the PC from any network, whereas a LAN IP only answers on the
   *  local Wi-Fi (and burns a connect timeout everywhere else). Cycled on every
   *  failed/dropped connection (see scheduleReconnect) so the phone still finds
   *  whichever network actually reaches the PC with no user action. */
  private hosts: string[];
  private hostIdx = 0;
  /** The direct LAN address (`opts.host`), kept explicitly so the silent probe
   *  always knows where to test for same-network reachability regardless of the
   *  cross-first dial order. Empty when the user never had a LAN address. */
  private lanHost: string;
  /** One-shot guard: once we've probed the LAN (success or not), don't probe again
   *  this session. */
  private probedLan = false;
  /** Resolvers waiting for the socket to come online (or fail). */
  private onlineWaiters: Array<(online: boolean) => void> = [];

  private readonly idleMs: number;
  private readonly maxMs: number;
  private readonly awaitingMs: number;
  private readonly connectMs: number;
  private readonly reconnectBase: number;
  private readonly lanProbeMs: number;
  private readonly identity: DeviceIdentityBridge;
  private deviceId = "";
  private authenticated = false;
  private connectionNonce = "";
  private hostId = "";
  private lastHostCounter = 0;
  private pairingAttempted = false;
  /** True once THIS connection received auth.challenge — i.e. the server's
   * identity layer actually engaged. A 1008 close before that is a transport
   * gate (e.g. plaintext LAN refused), not an identity verdict. */
  private sawChallenge = false;
  private authTimer: ReturnType<typeof setTimeout> | null = null;
  private outboundChain: Promise<void> = Promise.resolve();
  private incomingChain: Promise<void> = Promise.resolve();
  /**
   * Outstanding approval challenges, keyed by task id.
   *
   * This was a SINGLE slot, but several tasks can be subscribed at once (Task
   * Center) and each raises its own challenge. Task B's challenge wiped task A's
   * before the authorization check, so answering A's still-visible dialog failed the
   * `id !== challenge.stepId` test, A's approval became unrecoverable, and A sat in
   * awaitingUser until it timed out. A newer challenge still replaces an older one
   * FOR THE SAME TASK, which is the only case where superseding was intended.
   */
  private activeApprovals = new Map<string, ActiveApprovalChallenge>();
  /** Task ids whose subscriptions were explicitly queued on this authenticated
   * connection. This preserves exact approval correlation after WebView restart,
   * when no in-memory runTask Promise exists but Task Center resubscribes. */
  private readonly subscribedTaskIds = new Set<string>();

  constructor(opts: RemotePCOptions) {
    this.opts = opts;
    this.cfg = {
      host: opts.host,
      altHost: opts.altHost,
      port: opts.port,
      secure: opts.secure,
      deviceId: opts.deviceId,
      hostId: opts.hostId,
      hostFingerprint: opts.hostFingerprint,
      hostPublicKey: opts.hostPublicKey,
      pairingChallengeId: opts.pairingChallengeId,
      pin: opts.pin,
      deviceName: opts.deviceName,
    };
    this.lanHost = (opts.host || "").trim();
    this.hosts = [opts.altHost, opts.host]
      .map((h) => (h || "").trim())
      .filter((h, i, arr) => h && arr.indexOf(h) === i);
    const g = (globalThis as { WebSocket?: WebSocketCtor }).WebSocket;
    const impl = opts.WebSocketImpl ?? g;
    if (!impl) throw new Error("No WebSocket implementation available");
    this.WS = impl;
    this.idleMs = opts.taskIdleTimeoutMs ?? 210_000;
    this.maxMs = opts.taskMaxMs ?? 15 * 60_000;
    this.awaitingMs = opts.awaitingUserTimeoutMs ?? 5 * 60_000;
    this.connectMs = opts.connectTimeoutMs ?? 8_000;
    this.reconnectBase = opts.reconnectMs ?? 3_000;
    this.lanProbeMs = opts.lanProbeTimeoutMs ?? 2_500;
    this.identity = opts.identityBridge ?? nativeIdentityBridge;
    this.deviceId = (opts.deviceId || "").trim();
  }

  get state(): RemoteState {
    return this._state;
  }

  /** The ws(s):// URL we dial. Defaults to whichever
   *  candidate address `hostIdx` currently points at (see scheduleReconnect); pass an
   *  explicit host for the LAN probe. */
  url(host: string = this.hosts[this.hostIdx] || this.cfg.host): string {
    const scheme = this.cfg.secure ? "wss" : "ws";
    const port = this.cfg.port ?? 8765;
    return `${scheme}://${host}:${port}/`;
  }

  private authProtocols(): string[] {
    return ["aura-v3"];
  }

  // ── Connection lifecycle ────────────────────────────────────────────────────

  /** Open the socket (idempotent). Auto-reconnects on drop until close() is called. */
  connect(): void {
    this.manualClose = false;
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === OPEN)) return;
    if (!this.hosts.length) {
      this.setState("idle");
      return;
    }
    this.clearReconnect();
    this.setState("connecting");
    let ws: WebSocketLike;
    try {
      ws = new this.WS(this.url(), this.authProtocols());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      // NOTE: the backoff counter is deliberately NOT reset here. A socket that
      // opens and is then rejected (the transport gate closes a plaintext LAN dial
      // with 1008 before any auth.challenge — see the comment further down) used to
      // reset attempt to 0 on every open, so scheduleReconnect always computed
      // reconnectBase * 2^0 ≈ 3s and never climbed to the 15s cap: a permanent
      // reconnect loop, each cycle running a full native-identity handshake. The
      // reset now lives in finishAuthenticated, i.e. only once the PC has actually
      // accepted us.
      // "online" only once the backend actually speaks (auth confirmed). But an open
      // socket past the auth gate is already trusted; mark online on open and let a
      // 1008 close demote us to unauthorized.
      this.authenticated = false;
      this.connectionNonce = "";
      this.hostId = "";
      this.lastHostCounter = 0;
      this.pairingAttempted = false;
      this.sawChallenge = false;
      if (this.authTimer) clearTimeout(this.authTimer);
      // A silent-server guard, NOT an identity verdict. Generous because one
      // handshake can legitimately burn several native-bridge retry windows
      // (up to ~12.6s per call); the server itself allows 3×20s. A local
      // timeout reconnects — it must never claim the identity was rejected.
      this.authTimer = setTimeout(
        () => this.bailTransient(ws, "handshake made no progress"),
        25_000,
      );
      // Recover this device's durable task index even when Android killed the
      // WebView and its in-memory Promise/cursor. The host authorizes by the
      // connection-bound device identity and replies with task.snapshot, then
      // keeps this socket subscribed to future events for those tasks.
      // Resubmit an unacknowledged task with the SAME idempotency key, or resume an
      // accepted task from its last durable event cursor. Both operations are safe
      // to repeat after an uncertain disconnect.
      // Connected over the cross-network (Tailscale) address first — now check, once,
      // whether we're actually on the PC's LAN and can silently upgrade to the direct
      // link (lower latency). Reachability of the LAN IP IS the same-network test.
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      if (typeof ev.data === "string") {
        this.incomingChain = this.incomingChain
          .then(() => this.handleMessage(ev.data as string, ws))
          .catch((error) => {
            const why = error instanceof Error ? error.message : String(error);
            if (error instanceof IdentityRejected) this.rejectAuthentication(ws, why);
            else this.bailTransient(ws, why);
          });
      }
    };
    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.authenticated = false;
      this.connectionNonce = "";
      this.activeApprovals.clear();
      if (this.authTimer) {
        clearTimeout(this.authTimer);
        this.authTimer = null;
      }
      // 1008 is terminal ONLY when this connection's handshake actually engaged
      // (we saw auth.challenge). The server also closes 1008 for transport-level
      // refusals — e.g. dialing its plaintext LAN address, which the Tailscale-only
      // gate rejects before any identity exchange. Treating THAT as "identity
      // rejected" permanently bricked pairing after one bad dial; instead fall
      // through to offline + reconnect, which cycles to the other address.
      const unauthorized = ev?.code === 1008 && this.sawChallenge;
      if (ev?.code === 1008 || ev?.code === 4000) {
        console.error(
          `[RemotePC] closed code=${ev?.code} reason=${ev?.reason || ""} ` +
          `sawChallenge=${this.sawChallenge} → ${unauthorized ? "unauthorized" : "retry"}`,
        );
      }
      if (unauthorized) {
        this.setState("unauthorized");
        this.failPending("Your PC rejected this phone's identity or pairing pins.");
        this.resolveWaiters(false);
        return;
      }
      this.setState("offline");
      // The desktop owns accepted task execution. Pause the *idle* watchdog while
      // offline and keep the absolute deadline running; reconnect will replay only
      // this task's missed events after lastSeq.
      if (this.pending?.idleTimer) {
        clearTimeout(this.pending.idleTimer);
        this.pending.idleTimer = null;
      }
      if (!this.manualClose) this.scheduleReconnect();
    };
  }

  /** Close for good — stop reconnecting and drop any in-flight task. */
  private finishAuthenticated(ws: WebSocketLike): void {
    if (this.ws !== ws || !this.authenticated) return;
    if (this.authTimer) {
      clearTimeout(this.authTimer);
      this.authTimer = null;
    }
    // A connection only "counts" once the PC has accepted us, so this is where the
    // backoff resets (it used to be in onopen, which never let it grow).
    this.attempt = 0;
    this.setState("online");
    this.send({
      v: PROTOCOL_VERSION,
      type: "protocol.hello",
      data: {
        supported_versions: [PROTOCOL_VERSION],
        client: "aura-android",
        device_id: this.deviceId,
      },
    });
    this.send({
      v: PROTOCOL_VERSION,
      type: "task.list",
      data: { source_device: this.deviceId },
    });
    if (this.pending && !this.pending.done) this.resumePending();
    if (this.cfg.secure) this.probeLanAndUpgrade();
  }

  /** Drop a connection over a LOCAL/transient failure (flaky native bridge,
   * malformed traffic, silent server) WITHOUT claiming the identity was
   * rejected. Closing with a private code (4000) lands in onclose's normal
   * offline + auto-reconnect path, which also cycles to the other address. */
  private bailTransient(ws: WebSocketLike, why: string): void {
    if (this.ws !== ws) return;
    console.error(`[RemotePC] transient failure: ${why} — dropping link to retry`);
    if (this.authTimer) {
      clearTimeout(this.authTimer);
      this.authTimer = null;
    }
    try {
      ws.close(4000, "transient failure");
    } catch {
      /* ignore */
    }
  }

  private rejectAuthentication(ws: WebSocketLike, why = "identity verification failed"): void {
    if (this.ws !== ws) return;
    console.error(`[RemotePC] identity rejected: ${why}`);
    this.authenticated = false;
    if (this.authTimer) {
      clearTimeout(this.authTimer);
      this.authTimer = null;
    }
    this.setState("unauthorized");
    this.resolveWaiters(false);
    this.failPending("Your PC identity or phone pairing could not be verified.");
    try {
      ws.close(1008, "identity verification failed");
    } catch {
      /* ignore */
    }
  }

  private sendRaw(payload: unknown, ws: WebSocketLike = this.ws!): boolean {
    if (!ws || ws.readyState !== OPEN || this.ws !== ws) return false;
    try {
      ws.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  private async handleAuthChallenge(data: Record<string, unknown>, ws: WebSocketLike): Promise<void> {
    if (this.ws !== ws) return;
    this.sawChallenge = true;
    const hostId = typeof data.host_id === "string" ? data.host_id : "";
    const fingerprint = typeof data.host_fingerprint === "string" ? data.host_fingerprint : "";
    const publicKey = typeof data.host_public_key === "string" ? data.host_public_key : "";
    const nonce = typeof data.nonce === "string" ? data.nonce : "";
    const connectionId = typeof data.connection_id === "string" ? data.connection_id : "";
    const signature = typeof data.signature === "string" ? data.signature : "";
    const expiresAt = Number(data.expires_at);
    if (
      !hostId || !fingerprint || !publicKey || !nonce || !connectionId || !signature ||
      !Number.isSafeInteger(expiresAt) || expiresAt * 1000 <= Date.now()
    ) throw new Error("invalid host challenge");
    // Trust-on-first-use is forbidden: all three pins come from the expiring QR
    // or an existing pairing, never from this untrusted connection.
    if (
      !this.cfg.hostId || !this.cfg.hostFingerprint || !this.cfg.hostPublicKey ||
      hostId !== this.cfg.hostId ||
      fingerprint !== this.cfg.hostFingerprint ||
      publicKey !== this.cfg.hostPublicKey
    ) throw new IdentityRejected("host pin mismatch — re-scan the pairing QR");
    const verified = await withIdentityBridgeRetry(() => this.identity.verifyHostChallenge({
      publicKey,
      expectedFingerprint: fingerprint,
      hostId,
      nonce,
      expiresAt,
      connectionId,
      signature,
    }));
    // ok:true + verified:false is a DEFINITIVE bad signature (host key mismatch).
    // ok:false means the native layer itself failed — transient, retry the link.
    if (verified.ok && !verified.verified) {
      throw new IdentityRejected("host challenge signature failed");
    }
    if (!verified.ok) throw new Error("host challenge verification unavailable");
    this.hostId = hostId;
    this.connectionNonce = nonce;
    this.lastHostCounter = 0;

    const auth = await withIdentityBridgeRetry(() => this.identity.signAuth({ hostId, nonce }));
    if (!auth.ok || !auth.deviceId || !auth.signature || !Number.isSafeInteger(auth.counter)) {
      throw new Error("phone authentication signature failed");
    }
    this.deviceId = auth.deviceId;
    if (!this.sendRaw({
      type: "auth.response",
      data: {
        host_id: hostId,
        device_id: auth.deviceId,
        nonce,
        counter: auth.counter,
        signature: auth.signature,
      },
    }, ws)) throw new Error("authentication connection closed");
  }

  private async handlePairingRequired(ws: WebSocketLike): Promise<void> {
    const challengeId = (this.cfg.pairingChallengeId || "").trim();
    const pin = (this.cfg.pin || "").trim();
    if (this.ws !== ws) return;
    // The server demands pairing and we have no usable one-shot QR challenge, or no
    // PIN was entered — reconnecting can never fix either. Terminal: the user must
    // re-scan the QR and type the 6-digit PIN shown on the PC.
    if (!challengeId || !pin || !this.hostId || !this.connectionNonce || this.pairingAttempted) {
      throw new IdentityRejected(
        "this PC doesn't know this phone — scan a fresh pairing QR and enter the PIN shown on the PC",
      );
    }
    this.pairingAttempted = true;
    const claim = await withIdentityBridgeRetry(() => this.identity.signPairing({
      hostId: this.hostId,
      challengeId,
      connectionNonce: this.connectionNonce,
      deviceName: this.cfg.deviceName || "Aura phone",
    }));
    if (!claim.ok || !claim.deviceId || !claim.publicKey || !claim.signature) {
      throw new Error("phone pairing signature failed");
    }
    this.deviceId = claim.deviceId;
    // The PIN is a plain field, NOT part of the signed material — the host verifies
    // the signature over pairing_signing_bytes (which excludes the PIN) and checks
    // the PIN separately (constant-time), exactly as device_identity.claim_pairing does.
    if (!this.sendRaw({
      type: "pairing.claim",
      data: {
        challenge_id: challengeId,
        device_id: claim.deviceId,
        public_key: claim.publicKey,
        fingerprint: claim.fingerprint || "",
        device_name: claim.deviceName || this.cfg.deviceName || "Aura phone",
        pin,
        signature: claim.signature,
      },
    }, ws)) throw new Error("pairing connection closed");
  }

  private async verifyHostMessage(msg: Record<string, unknown>): Promise<boolean> {
    const auth = msg.auth;
    if (!auth || typeof auth !== "object") return false;
    const envelope = auth as Record<string, unknown>;
    const counter = Number(envelope.counter);
    const event = typeof msg.event === "string" ? msg.event : "";
    const data = msg.data;
    const nestedTask = data && typeof data === "object"
      ? (data as Record<string, unknown>).task_id
      : "";
    const taskId = typeof msg.task_id === "string"
      ? msg.task_id
      : typeof nestedTask === "string" ? nestedTask : "";
    if (
      !this.connectionNonce || !event || !Number.isSafeInteger(counter) ||
      counter <= this.lastHostCounter || envelope.host_id !== this.hostId ||
      envelope.connection_nonce !== this.connectionNonce ||
      typeof envelope.signature !== "string"
    ) {
      console.error(
        `[RemotePC] host envelope pre-check failed: event=${event} ` +
        `counter=${String(envelope.counter)} last=${this.lastHostCounter} ` +
        `hostIdMatch=${envelope.host_id === this.hostId} ` +
        `nonceMatch=${envelope.connection_nonce === this.connectionNonce} ` +
        `sig=${typeof envelope.signature}`,
      );
      return false;
    }
    const signature = envelope.signature;
    const digest = await payloadDigest(envelopeContent(msg));
    // Bridge failures propagate (→ transient reconnect); only a definitive
    // negative from a WORKING verifier returns false.
    const verified = await withIdentityBridgeRetry(() => this.identity.verifyHostEnvelope({
      publicKey: this.cfg.hostPublicKey || "",
      expectedFingerprint: this.cfg.hostFingerprint || "",
      hostId: this.hostId,
      connectionNonce: this.connectionNonce,
      counter,
      messageType: event,
      taskId,
      payloadDigest: digest,
      signature,
    }));
    if (!verified.ok || !verified.verified) {
      console.error(
        `[RemotePC] host envelope SIGNATURE failed: event=${event} counter=${counter} ` +
        `task=${taskId} digest=${digest} ok=${verified.ok}`,
      );
      return false;
    }
    this.lastHostCounter = counter;
    return true;
  }

  close(): void {
    this.manualClose = true;
    this.clearReconnect();
    this.authenticated = false;
    this.connectionNonce = "";
    this.activeApprovals.clear();
    this.subscribedTaskIds.clear();
    if (this.authTimer) {
      clearTimeout(this.authTimer);
      this.authTimer = null;
    }
    this.failPending("I let go of the PC link, sir.");
    this.resolveWaiters(false);
    const ws = this.ws;
    this.ws = null;
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
    this.setState("idle");
  }

  private scheduleReconnect(): void {
    if (this.manualClose) return;
    this.clearReconnect();
    this.attempt += 1;
    // Autonomous network switching: every failed/dropped attempt tries the OTHER
    // known address next (plain LAN vs. Tailscale) instead of asking the user
    // which network they're on. Whichever one answers just keeps getting used.
    if (this.hosts.length > 1) this.hostIdx = (this.hostIdx + 1) % this.hosts.length;
    const cap = Math.min(this.reconnectBase * 2 ** Math.max(0, this.attempt - 1), 15_000);
    const delay = Math.max(1, Math.round(cap * (0.8 + Math.random() * 0.4)));
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /** Once, after connecting over the cross-network address, silently test whether the
   *  PC's LAN IP answers — if it does, we're on the same Wi-Fi and can upgrade to the
   *  direct link. Opens a throwaway socket to the LAN host (which costs the backend
   *  one extra greeting, immediately closed) and, on success, reconnects the live link
   *  to it. Never disturbs an in-flight task or live screen.
   *  ponytail: one-shot per session — a phone that JOINS the PC's Wi-Fi mid-session
   *  won't re-probe until a reconnect cycle or re-pair. Upgrade: reset probedLan on a
   *  fresh cross-host connect if that proves annoying. */
  private probeLanAndUpgrade(): void {
    if (this.probedLan || this.pending) return;
    if (!this.lanHost) return;
    const lanIdx = this.hosts.indexOf(this.lanHost);
    if (lanIdx < 0 || this.hostIdx === lanIdx) return; // no distinct LAN, or already on it
    this.probedLan = true;

    let probe: WebSocketLike;
    try {
      probe = new this.WS(this.url(this.lanHost), this.authProtocols());
    } catch {
      return;
    }
    const timer = setTimeout(() => {
      try {
        probe.close();
      } catch {
        /* ignore */
      }
    }, this.lanProbeMs);
    const cleanup = () => {
      clearTimeout(timer);
      probe.onopen = probe.onerror = probe.onclose = null;
    };
    probe.onopen = () => {
      cleanup();
      try {
        probe.close();
      } catch {
        /* ignore */
      }
      // Got busy while probing → don't tear down a live task/screen to switch.
      if (this.pending) return;
      this.reconnectTo(lanIdx);
    };
    probe.onerror = () => {
      cleanup();
      try {
        probe.close();
      } catch {
        /* ignore */
      }
    };
    probe.onclose = () => cleanup();
  }

  /** Silently move the live link to another candidate address (the LAN upgrade). Nulls
   *  out `this.ws` FIRST so the old socket's guarded onclose no-ops — no spurious
   *  offline/reconnect flap — then dials the new host. */
  private reconnectTo(idx: number): void {
    this.hostIdx = idx;
    const old = this.ws;
    this.ws = null;
    try {
      old?.close();
    } catch {
      /* ignore */
    }
    this.connect();
  }

  private setState(s: RemoteState): void {
    if (this._state === s) return;
    this._state = s;
    if (s === "online") this.resolveWaiters(true);
    if (s === "unauthorized") this.resolveWaiters(false);
    try {
      this.opts.onStateChange?.(s);
    } catch {
      /* a UI callback must never break the socket */
    }
  }

  private resolveWaiters(online: boolean): void {
    const ws = this.onlineWaiters;
    this.onlineWaiters = [];
    for (const r of ws) r(online);
  }

  /** Resolve once the socket is online, or false on timeout / terminal failure. */
  private waitForOnline(): Promise<boolean> {
    if (this._state === "online" && this.authenticated && this.ws?.readyState === OPEN) return Promise.resolve(true);
    if (this._state === "unauthorized") return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const done = (v: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(v);
      };
      const timer = setTimeout(() => done(false), this.connectMs);
      this.onlineWaiters.push(done);
    });
  }

  private async ensureOnline(): Promise<boolean> {
    if (this._state === "online" && this.authenticated && this.ws?.readyState === OPEN) return true;
    // A prior "unauthorized" sticks until the user re-pairs (which builds a new
    // RemotePC), so don't silently retry a known-bad identity here.
    if (this._state === "unauthorized") return false;
    this.connect();
    return this.waitForOnline();
  }

  // ── Running a task ───────────────────────────────────────────────────────────

  /**
   * Run one whole task on the PC and resolve with its outcome. Never rejects — a
   * failure (unreachable, dropped, timed out) comes back as ok:false so the brain
   * can speak it honestly rather than throwing.
   */
  async runTask(goal: string, kind: "browser" | "computer" | "auto" = "browser"): Promise<ToolResult> {
    const g = (goal || "").trim();
    if (!g) return { ok: false, summary: "What should I do on the PC, sir?" };
    if (this.pending) {
      return { ok: false, summary: "I'm still finishing the last PC task, sir — one moment." };
    }
    const online = await this.ensureOnline();
    if (!online) {
      const why =
        this._state === "unauthorized"
          ? "the phone identity or host pins were rejected — scan a fresh pairing QR."
          : "make sure it's on, on the same network, and the JARVIS desktop app is running.";
      return {
        ok: false,
        summary: `I can't reach your PC, sir — ${why}`,
        error: "unreachable",
      };
    }
    return new Promise<ToolResult>((resolve) => {
      const taskId = newId("task");
      const p: Pending = {
        resolve,
        done: false,
        taskId,
        idempotencyKey: newId("idem"),
        goal: g,
        kind,
        accepted: false,
        lastSeq: 0,
        bufferedEvents: new Map(),
        replayRequested: false,
        warnings: [],
        awaitingUser: false,
        idleTimer: null,
        maxTimer: null,
        awaitingTimer: null,
      };
      this.pending = p;
      p.maxTimer = setTimeout(
        () => {
          this.cancelPending("deadline_exceeded");
          this.settle({
            ok: false,
            summary: "That PC task exceeded its deadline, sir — I asked the PC to cancel it.",
            error: "deadline_exceeded",
          });
        },
        this.maxMs,
      );
      this.bumpIdle();
      const sent = this.submitPending(p);
      if (!sent) {
        this.settle({
          ok: false,
          summary: "I couldn't send that to your PC, sir — the link dropped.",
        });
      }
    });
  }

  /** Send or idempotently re-send a task submission. */
  private submitPending(p: Pending): boolean {
    return this.send({
      v: PROTOCOL_VERSION,
      type: "task.submit",
      request_id: newId("request"),
      data: {
        task_id: p.taskId,
        idempotency_key: p.idempotencyKey,
        source_device: this.deviceId,
        goal: p.goal,
        kind: p.kind,
        capability_profile: "remote_default",
        deadline_ms: this.maxMs,
      },
    });
  }

  /** Restore a pending task after reconnect without relying on global broadcasts. */
  private resumePending(): void {
    const p = this.pending;
    if (!p || p.done) return;
    if (p.accepted) {
      this.send({
        v: PROTOCOL_VERSION,
        type: "task.subscribe",
        data: { task_id: p.taskId, resume_after_seq: p.lastSeq },
      });
      this.send({
        v: PROTOCOL_VERSION,
        type: "task.status",
        data: { task_id: p.taskId },
      });
    } else {
      this.submitPending(p);
    }
    if (!p.awaitingUser) this.bumpIdle();
  }

  /** Request cancellation of the in-flight durable desktop task. */
  cancelTask(reason = "user_cancelled"): boolean {
    const p = this.pending;
    if (!p || p.done) return false;
    const sent = this.cancelPending(reason);
    this.settle({ ok: false, summary: "Stopped the PC task, sir.", error: reason });
    return sent;
  }

  private cancelPending(reason: string): boolean {
    const p = this.pending;
    if (!p || p.done) return false;
    return this.send({
      v: PROTOCOL_VERSION,
      type: "task.cancel",
      data: { task_id: p.taskId, reason },
    });
  }

  /**
   * Fire-and-forget: true here means "accepted for sending", NOT "the PC got it".
   * The signed write happens later on `outboundChain` and can still be dropped.
   * Any path that TELLS THE USER something was sent must use `sendConfirmed`.
   */
  private send(payload: unknown): boolean {
    return this.enqueue(payload) !== null;
  }

  /**
   * Same write, but resolves with whether the signed envelope actually reached the
   * socket. Signing goes through the native identity bridge, which this file
   * documents as prone to dropped callbacks — so a STOP that was merely queued used
   * to be reported to the user as "hard stop sent" while the PC kept running.
   */
  private async sendConfirmed(payload: unknown): Promise<boolean> {
    const queued = this.enqueue(payload);
    if (!queued) return false;
    try {
      return await queued;
    } catch {
      return false;
    }
  }

  /** Queue one signed write. Returns null when the socket can't take it at all,
   *  otherwise a promise resolving true once it was handed to the socket. */
  private enqueue(payload: unknown): Promise<boolean> | null {
    const ws = this.ws;
    if (!ws || ws.readyState !== OPEN || !this.authenticated) return null;
    if (!this.connectionNonce || !this.deviceId) return null;
    const body = payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : null;
    const messageType = typeof body?.type === "string" ? body.type : "";
    const data = body?.data;
    const nestedTask = data && typeof data === "object"
      ? (data as Record<string, unknown>).task_id
      : "";
    const taskId = typeof body?.task_id === "string"
      ? body.task_id
      : typeof nestedTask === "string" ? nestedTask : "";
    if (!messageType) return null;
    const nonce = this.connectionNonce;
    let settle: (delivered: boolean) => void = () => {};
    const delivered = new Promise<boolean>((resolve) => {
      settle = resolve;
    });
    this.outboundChain = this.outboundChain.then(async () => {
      if (this.ws !== ws || !this.authenticated || this.connectionNonce !== nonce) {
        settle(false);
        return;
      }
      const digest = await payloadDigest(envelopeContent(body!));
      const signed = await withIdentityBridgeRetry(() => this.identity.signEnvelope({
        connectionNonce: nonce,
        messageType,
        taskId,
        payloadDigest: digest,
      }));
      if (!signed.ok || signed.deviceId !== this.deviceId || !signed.signature) {
        settle(false);
        throw new Error("native envelope signing failed");
      }
      if (this.ws !== ws || !this.authenticated || this.connectionNonce !== nonce) {
        settle(false);
        return;
      }
      const wrote = this.sendRaw({ ...body, auth: {
        device_id: signed.deviceId,
        connection_nonce: nonce,
        counter: signed.counter,
        signature: signed.signature,
      } }, ws);
      settle(wrote !== false);
    }).catch((error) => {
      settle(false);
      // A local signing failure is NOT an identity verdict — drop and reconnect;
      // if the identity truly changed, the next handshake surfaces the real
      // server-side verdict (pairing_required / auth.denied).
      const why = error instanceof Error ? error.message : String(error);
      this.bailTransient(ws, `outbound envelope signing failed: ${why}`);
    });
    return delivered;
  }

  /** (Re)start the no-events-from-the-PC watchdog for the in-flight task. */
  private bumpIdle(): void {
    const p = this.pending;
    if (!p) return;
    if (p.idleTimer) clearTimeout(p.idleTimer);
    p.idleTimer = setTimeout(
      () => {
        this.cancelPending("client_stalled");
        this.settle({
          ok: false,
          summary: "The PC task stopped making verified progress, sir — I asked it to cancel.",
          error: "client_stalled",
        });
      },
      this.idleMs,
    );
  }

  /** The PC asked the user something: pause the stall watchdog, start a longer one. */
  private enterAwaitingUser(p: Pending): void {
    p.awaitingUser = true;
    if (p.idleTimer) {
      clearTimeout(p.idleTimer);
      p.idleTimer = null;
    }
    if (p.awaitingTimer) clearTimeout(p.awaitingTimer);
    p.awaitingTimer = setTimeout(
      () => {
        this.cancelPending("approval_timeout");
        this.settle({
          ok: false,
          summary: "That PC task needed attention and the approval window expired, sir.",
          error: "approval_timeout",
        });
      },
      this.awaitingMs,
    );
  }

  /** User answered (or the backend dismissed the prompt): back to normal watchdogging. */
  private resumeFromUser(): void {
    const p = this.pending;
    if (!p || p.done || !p.awaitingUser) return;
    p.awaitingUser = false;
    if (p.awaitingTimer) {
      clearTimeout(p.awaitingTimer);
      p.awaitingTimer = null;
    }
    this.bumpIdle();
  }

  /** Answer one exact, host-signed and unexpired approval challenge. */
  respondPermission(id: unknown, approved: boolean): boolean {
    if (typeof id !== "string" || !id) return false;
    // Find the challenge this answer is FOR by its step id, rather than assuming the
    // only outstanding one is the right one.
    const challenge = [...this.activeApprovals.values()].find((c) => c.stepId === id);
    const p = this.pending;
    const authorized =
      Boolean(p && !p.done && p.taskId === challenge?.taskId) ||
      Boolean(challenge && this.subscribedTaskIds.has(challenge.taskId));
    if (!challenge || !authorized || challenge.expiresAtMs <= Date.now()) {
      if (challenge && challenge.expiresAtMs <= Date.now()) {
        this.activeApprovals.delete(challenge.taskId);
      }
      return false;
    }
    const sent = this.send({
      v: PROTOCOL_VERSION,
      type: "approval.response",
      data: {
        task_id: challenge.taskId,
        approval_id: challenge.approvalId,
        step_id: challenge.stepId,
        action_digest: challenge.actionDigest,
        approved: approved === true,
        expires_at: challenge.expiresAt,
      },
    });
    // Once queued for signing the response is one-shot. Do not resume locally:
    // only the host's signed approval.resolved event can release the wait state.
    if (sent) this.activeApprovals.delete(challenge.taskId);
    return sent;
  }

  /** Answer (or skip, with "") a mid-task clarify question from the PC. */
  respondClarify(id: unknown, answer: string): void {
    this.resumeFromUser();
    const taskId = this.pending?.taskId;
    this.send({
      v: PROTOCOL_VERSION,
      type: "task.answer",
      data: { task_id: taskId, prompt_id: id, answer },
    });
  }

  /**
   * Send a raw `{type,data}` control message to the PC — used by the remote-desktop
   * feature for WebRTC signalling (`webrtc_offer`/`webrtc_ice`/`stop_screen`) and
   * direct input (`arm_control`/`disarm_control`/`remote_input`). Returns false if
   * the socket isn't open. Incoming replies (`webrtc_answer`/`webrtc_ice`/
   * `remote_input_ack`) arrive through the normal `onEvent` stream, so the caller
   * routes them to its `RemoteScreen` from there. Kept separate from `runTask` so
   * live-view traffic never touches the task pending-state/watchdogs.
   */
  signal(type: string, data: unknown): boolean {
    const sent = this.send({ type, data });
    const taskId = objectOf(data)?.task_id;
    if (sent && typeof taskId === "string" && taskId) {
      if (type === "task.subscribe") this.subscribedTaskIds.add(taskId);
      if (type === "task.unsubscribe") this.subscribedTaskIds.delete(taskId);
    }
    return sent;
  }

  /** `signal()` that resolves only once the envelope actually reached the socket.
   *  Use this wherever the UI is about to tell the user the PC was told something. */
  async signalConfirmed(type: string, data: unknown): Promise<boolean> {
    const sent = await this.sendConfirmed({ type, data });
    const taskId = objectOf(data)?.task_id;
    if (sent && typeof taskId === "string" && taskId) {
      if (type === "task.subscribe") this.subscribedTaskIds.add(taskId);
      if (type === "task.unsubscribe") this.subscribedTaskIds.delete(taskId);
    }
    return sent;
  }

  /** Cancel the in-flight task, resolving with whether the cancel really went out. */
  async cancelTaskConfirmed(reason = "user_cancelled"): Promise<boolean> {
    const p = this.pending;
    if (!p || p.done) return false;
    const sent = await this.sendConfirmed({
      v: PROTOCOL_VERSION,
      type: "task.cancel",
      data: { task_id: p.taskId, reason },
    });
    this.settle({ ok: false, summary: "Stopped the PC task, sir.", error: reason });
    return sent;
  }

  /** True when the socket is open and authorized — safe to signal/stream. */
  get isOnline(): boolean {
    return this._state === "online" && this.authenticated && this.ws?.readyState === OPEN;
  }

  /** The address we're actually connected through right now (host or the altHost
   *  we cycled to). Lets the screen view pick a bitrate that fits the path — a LAN
   *  IP can carry full quality, a Tailscale/remote hop needs a lighter stream. */
  get activeHost(): string {
    return this.hosts[this.hostIdx] || this.cfg.host || "";
  }

  private settle(result: ToolResult): void {
    const p = this.pending;
    if (!p || p.done) return;
    p.done = true;
    if (p.idleTimer) clearTimeout(p.idleTimer);
    if (p.maxTimer) clearTimeout(p.maxTimer);
    if (p.awaitingTimer) clearTimeout(p.awaitingTimer);
    this.activeApprovals.delete(p.taskId);
    this.pending = null;
    p.resolve(result);
    // Tell the HUD the task is over so any open permission/clarify dialog clears,
    // even when we gave up client-side (no agent_task_end came from the PC).
    try {
      this.opts.onEvent?.({ event: "remote_task_settled", data: result });
    } catch {
      /* a UI callback must never break the socket */
    }
  }

  private failPending(summary: string): void {
    if (this.pending && !this.pending.done) this.settle({ ok: false, summary, error: "link_lost" });
  }

  // ── Incoming backend events ──────────────────────────────────────────────────

  private async handleMessage(
    raw: string,
    ws: WebSocketLike,
    alreadyVerified = false,
  ): Promise<void> {
    let msg: {
      v?: unknown;
      event?: unknown;
      data?: unknown;
      task_id?: unknown;
      seq?: unknown;
      auth?: unknown;
    };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object" || typeof msg.event !== "string") return;
    const event = msg.event;
    const data = msg.data;
    if (event === "auth.challenge") {
      if (!data || typeof data !== "object") throw new Error("invalid auth challenge");
      await this.handleAuthChallenge(data as Record<string, unknown>, ws);
      return;
    }
    if (event === "auth.denied") {
      this.sawChallenge = true;
      throw new IdentityRejected("the PC denied this phone's identity or pairing claim");
    }
    if (event === "auth.pairing_required") {
      // Pairing is initiated only from the already pinned QR challenge. The
      // server asks only after the normal Keystore authentication proved that
      // this public key is not registered yet.
      await this.handlePairingRequired(ws);
      return;
    }
    if (!alreadyVerified) {
      if (!(await this.verifyHostMessage(msg as Record<string, unknown>))) {
        throw new Error("invalid host protocol signature");
      }
    }
    if (event === "auth.ready") {
      const ready = data && typeof data === "object" ? data as Record<string, unknown> : null;
      if (!ready || ready.device_id !== this.deviceId) {
        throw new Error("authenticated device mismatch");
      }
      this.authenticated = true;
      this.finishAuthenticated(ws);
      return;
    }
    if (!this.authenticated) throw new Error("message arrived before authentication");
    const nestedTaskId =
      data && typeof data === "object" ? (data as { task_id?: unknown }).task_id : undefined;
    const taskId =
      typeof msg.task_id === "string"
        ? msg.task_id
        : typeof nestedTaskId === "string"
          ? nestedTaskId
          : undefined;
    const seq =
      typeof msg.seq === "number" && Number.isSafeInteger(msg.seq) && msg.seq >= 0
        ? msg.seq
        : undefined;

    const p = this.pending;
    const correlated = Boolean(p && !p.done && taskId === p.taskId);
    const approvalAuthorized =
      correlated || Boolean(taskId && this.subscribedTaskIds.has(taskId));

    // Apply only a CONTIGUOUS durable sequence. A live event can race replay after
    // reconnect; advancing straight to the highest sequence would permanently
    // discard the missing rows. Buffer gaps and ask the host to replay from the
    // last contiguous cursor. Sequence 0 remains an out-of-band snapshot/ack.
    if (correlated && seq !== undefined && seq > 0) {
      if (seq <= p!.lastSeq) return;
      if (seq > p!.lastSeq + 1) {
        p!.bufferedEvents.set(seq, raw);
        if (!p!.replayRequested) {
          p!.replayRequested = true;
          this.send({
            v: PROTOCOL_VERSION,
            type: "task.subscribe",
            data: { task_id: p!.taskId, resume_after_seq: p!.lastSeq },
          });
        }
        return;
      }
      p!.lastSeq = seq;
      p!.replayRequested = false;
    }

    const nestedKind = event === "task.event" ? kindOf(data) : "";
    const isApprovalChallenge =
      event === "approval.challenge" || nestedKind === "approval.challenge";
    const isApprovalResolved =
      event === "approval.resolved" || nestedKind === "approval.resolved";
    let forward = true;
    if (isApprovalChallenge) {
      // A newer signed challenge replaces the old one even when malformed — but only
      // the one for THIS task, so a second task's challenge can't invalidate a
      // dialog the user is currently looking at for a different task.
      if (taskId) this.activeApprovals.delete(taskId);
      const parsed = approvalAuthorized
        ? approvalChallengeOf(
            event === "task.event" ? eventPayload(data) : data,
            taskId || "",
          )
        : null;
      if (parsed) this.activeApprovals.set(parsed.taskId, parsed);
      else forward = false;
    } else if (isApprovalResolved && correlated) {
      if (taskId) this.activeApprovals.delete(taskId);
    }

    // Forward every non-duplicate message for diagnostics/UI, with correlation
    // metadata kept out of the legacy data payload.
    if (forward) {
      try {
        this.opts.onEvent?.({
          event,
          data,
          taskId,
          seq,
          version: typeof msg.v === "number" ? msg.v : undefined,
        });
      } catch {
        /* a UI callback must never break the socket */
      }
    }

    if (!p || p.done || !correlated) return;
    // Only a correlated task message proves progress. Weather, telemetry, a local
    // HUD conversation, or another phone's task can never extend this watchdog.
    if (!p.awaitingUser) this.bumpIdle();

    switch (event) {
      case "task.accepted": {
        p.accepted = true;
        this.send({
          v: PROTOCOL_VERSION,
          type: "task.subscribe",
          data: { task_id: p.taskId, resume_after_seq: p.lastSeq },
        });
        const acceptedState = stateOf(data);
        if (isTerminalState(acceptedState)) this.settle(terminalResult(data));
        break;
      }
      case "task.status": {
        const state = stateOf(data);
        if (state === "waiting_for_approval" || state === "suspended") {
          this.enterAwaitingUser(p);
        } else if (p.awaitingUser) {
          this.resumeFromUser();
        }
        if (isTerminalState(state)) this.settle(terminalResult(data));
        break;
      }
      case "task.event": {
        const kind = kindOf(data);
        if (
          (kind === "approval.challenge" && this.activeApprovals.has(p.taskId)) ||
          kind === "clarification.challenge" ||
          kind === "waiting_for_approval"
        ) {
          this.enterAwaitingUser(p);
        } else if (kind === "approval.resolved" || kind === "clarification.resolved") {
          this.resumeFromUser();
        }
        if (isTerminalKind(kind)) this.settle(terminalResult(eventPayload(data)));
        break;
      }
      case "approval.challenge": {
        if (this.activeApprovals.has(p.taskId)) this.enterAwaitingUser(p);
        break;
      }
      case "approval.resolved": {
        this.resumeFromUser();
        break;
      }
      case "task.cancelled": {
        this.settle(terminalResult({ ...(objectOf(data) ?? {}), state: "cancelled" }));
        break;
      }
    }

    // A newly applied row may close a buffered gap. Feed consecutive buffered
    // rows back through the same validator, one at a time, preserving UI order.
    const live = this.pending;
    if (live === p && !p.done) {
      const next = p.bufferedEvents.get(p.lastSeq + 1);
      if (next) {
        p.bufferedEvents.delete(p.lastSeq + 1);
        await this.handleMessage(next, ws, true);
      }
    }
  }
}

function objectOf(data: unknown): Record<string, unknown> | null {
  return data && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : null;
}

function stateOf(data: unknown): string {
  const state = objectOf(data)?.state;
  return typeof state === "string" ? state.toLowerCase() : "";
}

function kindOf(data: unknown): string {
  const d = objectOf(data);
  const kind = d?.kind ?? d?.type ?? d?.event;
  return typeof kind === "string" ? kind.toLowerCase() : "";
}

function eventPayload(data: unknown): unknown {
  const d = objectOf(data);
  if (!d) return data;
  if ("data" in d) return d.data;
  if ("payload" in d) return d.payload;
  return data;
}

function isTerminalState(state: string): boolean {
  return ["succeeded", "failed", "cancelled"].includes(state);
}

function isTerminalKind(kind: string): boolean {
  return ["terminal", "succeeded", "failed", "cancelled", "task.terminal"].includes(kind);
}

function verifiedTerminalProof(data: Record<string, unknown>): Record<string, unknown> | null {
  const proof = objectOf(data.proof);
  if (!proof || proof.passed !== true || !Array.isArray(proof.evidence_ids)) return null;
  const evidenceIds = proof.evidence_ids;
  if (
    evidenceIds.length === 0 ||
    evidenceIds.some(
      (id) => typeof id !== "string" || !id.trim() || id.length > 256,
    )
  ) {
    return null;
  }
  return proof;
}

function terminalResult(data: unknown): ToolResult {
  const d = objectOf(data) ?? {};
  const state = typeof d.state === "string" ? d.state.toLowerCase() : "";
  const stopped = state === "cancelled" || Boolean(d.stopped);
  const proof = verifiedTerminalProof(d);
  // A host's boolean claim is not proof. Only the succeeded state plus a passed
  // receipt naming at least one verified evidence record can complete the task.
  const ok = !stopped && state === "succeeded" && proof !== null;
  const claimedSummary = typeof d.summary === "string" ? d.summary.trim() : "";
  const summary =
    ((ok || state === "failed" || stopped) && claimedSummary) ||
    (stopped
      ? "Stopped on the PC, sir."
      : ok
        ? "Done on your PC, sir."
        : "I couldn't verify completion of that PC task, sir.");
  return {
    ok,
    summary,
    data: proof ? { proof } : undefined,
    error: ok ? undefined : state === "succeeded" ? "unverified_success" : state || "unverified_failure",
  };
}
