import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mapPointToScreen, RemoteScreen } from "./webrtcScreen";

describe("screen connection recovery", () => {
  class Peer {
    static instances: Peer[] = [];
    connectionState = "new";
    iceConnectionState = "new";
    localDescription: unknown = null;
    remoteDescription: unknown = null;
    ontrack: ((event: { streams: MediaStream[] }) => void) | null = null;
    onconnectionstatechange: (() => void) | null = null;
    oniceconnectionstatechange: (() => void) | null = null;
    onicecandidate: unknown = null;
    constructor() {
      Peer.instances.push(this);
    }
    addTransceiver() {}
    async createOffer() {
      return { type: "offer", sdp: "offer-sdp" };
    }
    async setLocalDescription(value: unknown) {
      this.localDescription = value;
    }
    async setRemoteDescription(value: unknown) {
      this.remoteDescription = value;
    }
    async addIceCandidate() {}
    close() {
      this.connectionState = "closed";
    }
    state(value: string) {
      this.connectionState = value;
      this.onconnectionstatechange?.();
    }
  }
  beforeEach(() => {
    vi.useFakeTimers();
    Peer.instances = [];
    vi.stubGlobal("RTCPeerConnection", Peer);
    vi.stubGlobal(
      "RTCSessionDescription",
      class {
        constructor(value: object) {
          Object.assign(this, value);
        }
      },
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reconnects a failed peer with a fresh session and stops the old owned screen", async () => {
    const signal = vi.fn(() => true);
    const screen = new RemoteScreen({ signaller: { signal } });
    await screen.start();
    await screen.onSignal("webrtc_answer", {
      type: "answer",
      sdp: "answer-sdp",
      screen_session_id: "old-session",
    });
    const first = Peer.instances[0]!;
    first.ontrack?.({ streams: [{} as MediaStream] });
    first.state("failed");
    expect(screen.state).toBe("failed");
    await vi.advanceTimersByTimeAsync(1000);
    expect(Peer.instances).toHaveLength(2);
    expect(first.connectionState).toBe("closed");
    expect(signal).toHaveBeenCalledWith("stop_screen", { screen_session_id: "old-session" });
    expect(screen.sessionId).toBe("");
    Peer.instances[1]!.ontrack?.({ streams: [{} as MediaStream] });
    expect(screen.state).toBe("streaming");
    await screen.close();
  });

  it("restores the stream after a brief disconnect and cancels pending recovery on close", async () => {
    const onStream = vi.fn();
    const screen = new RemoteScreen({ signaller: { signal: () => true }, onStream });
    await screen.start();
    const peer = Peer.instances[0]!;
    const stream = {} as MediaStream;
    peer.ontrack?.({ streams: [stream] });
    peer.state("disconnected");
    expect(screen.state).toBe("failed");
    peer.state("connected");
    expect(screen.state).toBe("streaming");
    expect(onStream).toHaveBeenLastCalledWith(stream);
    expect(onStream).toHaveBeenCalledTimes(2);
    peer.state("failed");
    await screen.close();
    await vi.advanceTimersByTimeAsync(60000);
    expect(Peer.instances).toHaveLength(1);
    expect(screen.state).toBe("closed");
  });

  it("bounds automatic recovery rather than retrying forever", async () => {
    const screen = new RemoteScreen({ signaller: { signal: () => true } });
    await screen.start();
    for (let i = 0; i < 3; i++) {
      Peer.instances.at(-1)!.state("failed");
      await vi.advanceTimersByTimeAsync(1000);
    }
    await vi.advanceTimersByTimeAsync(60000);
    expect(Peer.instances).toHaveLength(3);
    expect(screen.state).toBe("failed");
    await screen.close();
  });
});

// The element is the phone's video box; the PC screen (videoW×videoH) is drawn
// inside it with object-fit: contain (centered + letterboxed). mapPointToScreen
// must invert that to a 0–1000 point over the ACTUAL picture.
describe("mapPointToScreen", () => {
  it("maps the center of a perfectly-fitting video to (500,500)", () => {
    // 400×300 element, 800×600 screen → same aspect, no letterbox.
    const rect = { left: 0, top: 0, width: 400, height: 300 };
    expect(mapPointToScreen(rect, 800, 600, 200, 150)).toEqual({ x: 500, y: 500 });
  });

  it("maps the top-left corner of the picture to (0,0)", () => {
    const rect = { left: 0, top: 0, width: 400, height: 300 };
    expect(mapPointToScreen(rect, 800, 600, 0, 0)).toEqual({ x: 0, y: 0 });
  });

  it("accounts for the element's page offset", () => {
    const rect = { left: 100, top: 50, width: 400, height: 300 };
    expect(mapPointToScreen(rect, 800, 600, 300, 200)).toEqual({ x: 500, y: 500 });
  });

  it("handles horizontal letterboxing (wide element, 16:9 screen)", () => {
    // Element 400×300 (4:3), screen 1920×1080 (16:9): fits to width 400, rendered
    // height 225, so 37.5px black bars top & bottom. Center of the ELEMENT is still
    // the center of the PICTURE → (500,500).
    const rect = { left: 0, top: 0, width: 400, height: 300 };
    expect(mapPointToScreen(rect, 1920, 1080, 200, 150)).toEqual({ x: 500, y: 500 });
    // The picture spans y ∈ [37.5, 262.5]; its top edge maps to y=0.
    expect(mapPointToScreen(rect, 1920, 1080, 200, 37.5)).toEqual({ x: 500, y: 0 });
  });

  it("returns null for a tap in the letterbox margin (outside the picture)", () => {
    const rect = { left: 0, top: 0, width: 400, height: 300 };
    // y=10 is inside the 37.5px top black bar → not a real screen point.
    expect(mapPointToScreen(rect, 1920, 1080, 200, 10)).toBeNull();
  });

  it("returns null when dimensions are degenerate", () => {
    expect(mapPointToScreen({ left: 0, top: 0, width: 0, height: 0 }, 800, 600, 0, 0)).toBeNull();
    expect(mapPointToScreen({ left: 0, top: 0, width: 400, height: 300 }, 0, 0, 10, 10)).toBeNull();
  });

  it("clamps to the 0–1000 range at the far corner", () => {
    const rect = { left: 0, top: 0, width: 400, height: 300 };
    expect(mapPointToScreen(rect, 800, 600, 400, 300)).toEqual({ x: 1000, y: 1000 });
  });
});
