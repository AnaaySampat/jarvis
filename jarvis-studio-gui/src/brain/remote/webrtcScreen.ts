/**
 * RemoteScreen — the phone's WebRTC client for LIVE-VIEWING (and driving) the
 * paired PC's screen.
 *
 * The video itself flows over a real WebRTC PeerConnection (DTLS-SRTP encrypted,
 * P2P when the network allows, TURN-relayed otherwise). The SDP offer/answer and
 * ICE candidates are exchanged as `{type,data}` messages over the SAME authenticated
 * RemotePC WebSocket we already use for `pc_task` — so there's no third-party broker
 * and pairing/auth is reused. See `server/webrtc_screen.py` for the desktop peer.
 *
 * We are the OFFERER and request a recv-only video transceiver: the PC answers with
 * its screen track. Direct input (touch→click, keys) does NOT go through here — it's
 * sent as `remote_input` over the same socket, guarded by the PC's arm() consent.
 */

/** How to reach the PC's signalling (a thin bridge over the RemotePC socket). */
export interface ScreenSignaller {
  /** Send `{type,data}` to the PC. Returns false if the socket is down. */
  signal(type: string, data: unknown): boolean;
}

export type ScreenState = "idle" | "connecting" | "streaming" | "failed" | "closed";

export interface RemoteScreenOptions {
  signaller: ScreenSignaller;
  /** ICE servers beyond the default public STUN (add your TURN here for internet). */
  iceServers?: RTCIceServer[];
  /** Target frames/sec + max frame side, passed to the PC capturer. */
  fps?: number;
  maxSide?: number;
  /** The remote screen track arrived → bind it to a <video>. */
  onStream?: (stream: MediaStream) => void;
  onState?: (state: ScreenState) => void;
  /** Human-readable sub-stage during "connecting" — so a slow (but healthy) LAN/ICE
   *  negotiation shows real progress instead of one static "Connecting…" that looks
   *  identical whether it's about to succeed or already stuck. */
  onDetail?: (detail: string) => void;
}

const DEFAULT_ICE: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

/**
 * Map a touch/click point to NORMALIZED 0–1000 over the video CONTENT, accounting
 * for `object-fit: contain` letterboxing (the video is centered, with margins on
 * the axis that doesn't fill the element). Returns null when the point falls in a
 * letterbox margin — i.e. outside the actual picture — so a tap on the black bars
 * isn't sent as a bogus edge click. Pure + unit-tested; the crux of click accuracy.
 */
export function mapPointToScreen(
  rect: { left: number; top: number; width: number; height: number },
  videoW: number,
  videoH: number,
  clientX: number,
  clientY: number,
): { x: number; y: number } | null {
  if (!videoW || !videoH || !rect.width || !rect.height) return null;
  const scale = Math.min(rect.width / videoW, rect.height / videoH);
  const renderedW = videoW * scale;
  const renderedH = videoH * scale;
  const offX = (rect.width - renderedW) / 2;
  const offY = (rect.height - renderedH) / 2;
  const lx = clientX - rect.left - offX;
  const ly = clientY - rect.top - offY;
  if (lx < 0 || ly < 0 || lx > renderedW || ly > renderedH) return null;
  return {
    x: Math.round(Math.max(0, Math.min(1000, (lx / renderedW) * 1000))),
    y: Math.round(Math.max(0, Math.min(1000, (ly / renderedH) * 1000))),
  };
}

/** True when this runtime actually has WebRTC (the WebView does; Node/tests don't). */
export function webrtcAvailable(): boolean {
  return typeof RTCPeerConnection !== "undefined";
}

// How long "connecting" can run before we admit it's taking a while — long enough
// that a normal LAN negotiation (typically well under 1s) never trips it, short
// enough that a genuinely stuck attempt gets a reassuring, actionable message
// instead of an indefinite silent spinner.
const SLOW_CONNECT_HINT_MS = 6_000;

export class RemoteScreen {
  private pc: RTCPeerConnection | null = null;
  private opts: RemoteScreenOptions;
  private _state: ScreenState = "idle";
  private slowTimer: ReturnType<typeof setTimeout> | null = null;
  // The backend mints this session id itself and only reveals it in the
  // `webrtc_answer` payload — every message after that (trickled ICE,
  // stop_screen, and the arm/disarm/remote_input control-lease messages built
  // elsewhere from `sessionId`/`taskId`) must echo it back or the host rejects
  // them as ownerless. Candidates gathered before the answer arrives are
  // buffered and flushed once we learn it, rather than dropped or sent
  // unsigned (both of which the host would reject anyway).
  private _sessionId = "";
  private _taskId = "";
  private _pendingIce: RTCIceCandidateInit[] = [];
  /** Candidates the PC trickled BEFORE its answer finished applying. useBrain routes
   *  webrtc_answer and webrtc_ice with `void onSignal(...)` — no await, no ordering —
   *  so an early candidate hit addIceCandidate while setRemoteDescription was still
   *  pending, threw InvalidStateError, and was swallowed and lost. Hold them here
   *  and flush once the remote description is in. */
  private _earlyRemoteIce: RTCIceCandidateInit[] = [];

  constructor(opts: RemoteScreenOptions) {
    this.opts = opts;
  }

  get state(): ScreenState {
    return this._state;
  }

  /** The backend-issued screen-session id, or "" before the answer arrives. */
  get sessionId(): string {
    return this._sessionId;
  }

  /** The durable task this screen session is bound to, or "" when manual. */
  get taskId(): string {
    return this._taskId;
  }

  private setState(s: ScreenState): void {
    if (s === "streaming" || s === "failed" || s === "closed") this.clearSlowTimer();
    if (this._state === s) return;
    this._state = s;
    try {
      this.opts.onState?.(s);
    } catch {
      /* a UI callback must never break the connection */
    }
  }

  private setDetail(msg: string): void {
    try {
      this.opts.onDetail?.(msg);
    } catch {
      /* a UI callback must never break the connection */
    }
  }

  private clearSlowTimer(): void {
    if (this.slowTimer != null) {
      clearTimeout(this.slowTimer);
      this.slowTimer = null;
    }
  }

  /** Open the peer connection, offer a recv-only video, and signal the PC. */
  async start(): Promise<void> {
    if (!webrtcAvailable()) {
      this.setState("failed");
      throw new Error("This device's WebView has no WebRTC support.");
    }
    await this.close(false); // fresh start; don't tell the PC to stop yet
    this._sessionId = "";
    this._taskId = "";
    this._pendingIce = [];
    this._earlyRemoteIce = [];
    this.setState("connecting");
    this.setDetail("Asking your PC for its screen…");
    this.clearSlowTimer();
    this.slowTimer = setTimeout(() => {
      this.setDetail(
        "Still working on it — this can take longer on a slow or crowded Wi-Fi. " +
          "If it doesn't connect soon, check the PC is on and the same network.",
      );
    }, SLOW_CONNECT_HINT_MS);

    const pc = new RTCPeerConnection({
      iceServers: [...DEFAULT_ICE, ...(this.opts.iceServers ?? [])],
    });
    this.pc = pc;

    pc.addTransceiver("video", { direction: "recvonly" });

    pc.ontrack = (ev) => {
      const stream = ev.streams[0] ?? new MediaStream([ev.track]);
      this.setState("streaming");
      try {
        this.opts.onStream?.(stream);
      } catch {
        /* ignore UI errors */
      }
    };

    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return;
      const cand = ev.candidate.toJSON();
      // The host doesn't reveal screen_session_id until its webrtc_answer, but
      // ICE gathering can start (and candidates fire) before that answer
      // arrives. Buffer until we know it rather than sending an ownerless
      // message the host would just reject.
      if (!this._sessionId) {
        this._pendingIce.push(cand);
        return;
      }
      this.opts.signaller.signal("webrtc_ice", {
        candidate: cand,
        screen_session_id: this._sessionId,
        ...(this._taskId ? { task_id: this._taskId } : {}),
      });
    };

    pc.oniceconnectionstatechange = () => {
      const st = pc.iceConnectionState;
      if (st === "checking") this.setDetail("Found your PC — finding the fastest path to it…");
      else if (st === "connected" || st === "completed") {
        this.setDetail("Connected — waiting for the first frame…");
      }
    };

    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === "failed" || st === "closed" || st === "disconnected") {
        // Don't clobber a good "streaming" on a transient "disconnected"; only fail hard.
        if (st === "failed") this.setState("failed");
      }
    };

    const offer = await pc.createOffer({ offerToReceiveVideo: true });
    await pc.setLocalDescription(offer);

    this.setDetail("Sending the request to your PC…");
    const ok = this.opts.signaller.signal("webrtc_offer", {
      offer: { sdp: pc.localDescription?.sdp, type: pc.localDescription?.type },
      ice_servers: this.opts.iceServers ?? [],
      fps: this.opts.fps ?? 12,
      max_side: this.opts.maxSide ?? 1600,
    });
    if (!ok) {
      this.setState("failed");
      throw new Error("Couldn't reach the PC to start the stream — is it paired and online?");
    }
  }

  /** Route an inbound signalling event (from the RemotePC onEvent stream) here. */
  async onSignal(event: string, data: unknown): Promise<void> {
    if (!this.pc) return;
    if (event === "webrtc_answer") {
      const d = data as {
        sdp?: string;
        type?: string;
        screen_session_id?: string;
        session_id?: string;
        task_id?: string;
      };
      if (d?.sdp && d?.type) {
        this._sessionId = String(d.screen_session_id || d.session_id || "");
        this._taskId = String(d.task_id || "");
        this.setDetail("Your PC answered — setting up the video…");
        await this.pc.setRemoteDescription(
          new RTCSessionDescription({ sdp: d.sdp, type: d.type as RTCSdpType }),
        );
        // Drain anything that arrived while the answer was still being applied.
        if (this._earlyRemoteIce.length) {
          const early = this._earlyRemoteIce;
          this._earlyRemoteIce = [];
          for (const cand of early) {
            try {
              await this.pc.addIceCandidate(cand);
            } catch {
              /* a stray candidate must not tear the session down */
            }
          }
        }
        if (this._sessionId && this._pendingIce.length) {
          const buffered = this._pendingIce;
          this._pendingIce = [];
          for (const candidate of buffered) {
            this.opts.signaller.signal("webrtc_ice", {
              candidate,
              screen_session_id: this._sessionId,
              ...(this._taskId ? { task_id: this._taskId } : {}),
            });
          }
        }
      }
    } else if (event === "webrtc_ice") {
      const cand = (data as { candidate?: RTCIceCandidateInit })?.candidate;
      if (cand) {
        // Queue instead of dropping when the answer hasn't landed yet.
        if (!this.pc.remoteDescription) {
          this._earlyRemoteIce.push(cand);
          return;
        }
        try {
          await this.pc.addIceCandidate(cand);
        } catch {
          /* a stray candidate must not tear the session down */
        }
      }
    }
  }

  /** Stop streaming. `tellPc` sends `stop_screen` so the PC frees its capturer. */
  async close(tellPc = true): Promise<void> {
    const pc = this.pc;
    this.pc = null;
    if (pc) {
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;
      try {
        pc.close();
      } catch {
        /* ignore */
      }
    }
    if (tellPc) {
      try {
        this.opts.signaller.signal("stop_screen", {
          ...(this._sessionId ? { screen_session_id: this._sessionId } : {}),
          ...(this._taskId ? { task_id: this._taskId } : {}),
        });
      } catch {
        /* ignore */
      }
    }
    this._sessionId = "";
    this._taskId = "";
    this._pendingIce = [];
    this._earlyRemoteIce = [];
    this.setState("closed");
  }
}
