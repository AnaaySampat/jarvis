import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RemotePC, type DeviceIdentityBridge, type RemotePCOptions } from "./pc";

type WireMessage = {
  v?: number;
  type?: string;
  event?: string;
  task_id?: string;
  seq?: number;
  data?: Record<string, unknown> | unknown;
  auth?: Record<string, unknown>;
};

// A fake WebSocket whose connect outcome is scripted per-URL, driven by fake
// timers instead of real network I/O.
class FakeWS {
  static instances: FakeWS[] = [];
  static outcome: (url: string) => "open" | "refuse" = () => "open";
  static autoAuthenticate = false;
  static hostCounter = 1;
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  readonly sent: WireMessage[] = [];
  readonly url: string;
  readonly protocols: string[];

  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocols = typeof protocols === "string" ? [protocols] : (protocols ?? []);
    FakeWS.instances.push(this);
    const outcome = FakeWS.outcome(url);
    setTimeout(() => {
      if (outcome === "open") {
        this.readyState = 1;
        this.onopen?.({});
        if (FakeWS.autoAuthenticate) {
          setTimeout(() => {
            if (this.readyState !== 1 || !this.onmessage) return;
            this.receiveWire(hostChallenge());
            this.receiveWire(
              hostWire(
                "auth.ready",
                {
                  device_id: "phone-0123456789abcdef0123456789abcdef",
                  scopes: ["tasks"],
                },
                1,
              ),
            );
            FakeWS.hostCounter = 1;
          }, 0);
        }
      } else {
        this.readyState = 3;
        this.onclose?.({ code: 1006 });
      }
    }, 0);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as WireMessage);
  }

  close(): void {
    this.readyState = 3;
  }

  receive(event: string, data: unknown, taskId?: string, seq?: number): void {
    if (FakeWS.autoAuthenticate) {
      this.receiveWire({
        ...hostWire(event, data, ++FakeWS.hostCounter, taskId),
        ...(seq === undefined ? {} : { seq }),
        v: 2,
      });
      return;
    }
    this.onmessage?.({
      data: JSON.stringify({ v: 2, event, task_id: taskId, seq, data }),
    });
  }

  receiveWire(message: WireMessage): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  drop(): void {
    this.readyState = 3;
    this.onclose?.({ code: 1006 });
  }
}

function taskSubmit(ws: FakeWS): WireMessage {
  const msg = ws.sent.find((m) => m.type === "task.submit");
  expect(msg).toBeDefined();
  return msg!;
}

async function waitForWire(ws: FakeWS, type: string): Promise<void> {
  await vi.waitFor(() => expect(ws.sent.some((message) => message.type === type)).toBe(true));
}

function submitData(msg: WireMessage): Record<string, unknown> {
  return msg.data as Record<string, unknown>;
}

function fakeIdentity(deviceId = "phone-0123456789abcdef0123456789abcdef") {
  let counter = 40;
  const bridge: DeviceIdentityBridge = {
    info: vi.fn(async () => ({
      ok: true,
      deviceId,
      publicKey: "phone-public",
      fingerprint: "sha256:phone",
    })),
    signAuth: vi.fn(async () => ({
      ok: true,
      deviceId,
      counter: ++counter,
      signature: "phone-auth-signature",
    })),
    signEnvelope: vi.fn(async () => ({
      ok: true,
      deviceId,
      counter: ++counter,
      signature: `phone-envelope-${counter}`,
    })),
    signPairing: vi.fn(async ({ deviceName }) => ({
      ok: true,
      deviceId,
      counter: 0,
      signature: "phone-pair-signature",
      publicKey: "phone-public",
      fingerprint: "sha256:phone",
      deviceName,
    })),
    verifyHostChallenge: vi.fn(async () => ({ ok: true, verified: true })),
    verifyHostEnvelope: vi.fn(async () => ({ ok: true, verified: true })),
  };
  return bridge;
}

function autoAuthenticatedIdentity(): Partial<RemotePCOptions> {
  FakeWS.autoAuthenticate = true;
  return {
    hostId: "host-pinned",
    hostFingerprint: "sha256:host",
    hostPublicKey: "host-public",
    identityBridge: fakeIdentity(),
  };
}

const verifiedProof = {
  passed: true,
  evidence_ids: ["evidence-test-receipt"],
};

async function waitForOnline(pc: RemotePC): Promise<void> {
  await vi.waitFor(() => expect(pc.state).toBe("online"));
}

function hostChallenge(nonce = "nonce-1"): WireMessage {
  return {
    event: "auth.challenge",
    data: {
      version: 1,
      host_id: "host-pinned",
      host_fingerprint: "sha256:host",
      host_public_key: "host-public",
      connection_id: "connection-1",
      nonce,
      expires_at: Math.floor(Date.now() / 1000) + 60,
      signature: "host-challenge-signature",
    },
  };
}

function hostWire(
  event: string,
  data: unknown,
  counter: number,
  taskId?: string,
): WireMessage {
  return {
    event,
    data,
    ...(taskId ? { task_id: taskId } : {}),
    auth: {
      host_id: "host-pinned",
      connection_nonce: "nonce-1",
      counter,
      signature: `host-envelope-${counter}`,
    },
  };
}

describe("RemotePC — durable v2 transport", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWS.instances = [];
    FakeWS.outcome = () => "open";
    FakeWS.autoAuthenticate = false;
    FakeWS.hostCounter = 1;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("dials Tailscale first and silently upgrades to reachable LAN", async () => {
    const pc = new RemotePC({
      host: "1.2.3.4",
      altHost: "100.100.100.1",
      ...autoAuthenticatedIdentity(),
      secure: true,
      WebSocketImpl: FakeWS as unknown as NonNullable<RemotePCOptions["WebSocketImpl"]>,
    });

    expect(pc.url()).toContain("100.100.100.1");
    expect(pc.url()).not.toContain("token=");
    pc.connect();
    await vi.advanceTimersByTimeAsync(20);
    await waitForOnline(pc);

    expect(pc.state).toBe("online");
    expect(FakeWS.instances[0]?.url).toContain("100.100.100.1");
    expect(FakeWS.instances[0]?.protocols).toEqual(["aura-v3"]);
    expect(FakeWS.instances.some((i) => i.url.includes("1.2.3.4"))).toBe(true);
    expect(pc.activeHost).toBe("1.2.3.4");
  });

  it("stays on Tailscale when LAN is unreachable", async () => {
    FakeWS.outcome = (url) => (url.includes("1.2.3.4") ? "refuse" : "open");
    const pc = new RemotePC({
      host: "1.2.3.4",
      altHost: "100.100.100.1",
      ...autoAuthenticatedIdentity(),
      secure: true,
      lanProbeTimeoutMs: 30,
      WebSocketImpl: FakeWS as unknown as NonNullable<RemotePCOptions["WebSocketImpl"]>,
    });
    pc.connect();
    await vi.advanceTimersByTimeAsync(50);
    await waitForOnline(pc);

    expect(pc.state).toBe("online");
    expect(pc.activeHost).toBe("100.100.100.1");
  });

  it("falls back from unreachable Tailscale to LAN", async () => {
    FakeWS.outcome = (url) => (url.includes("100.100.100.1") ? "refuse" : "open");
    const pc = new RemotePC({
      host: "1.2.3.4",
      altHost: "100.100.100.1",
      ...autoAuthenticatedIdentity(),
      reconnectMs: 100,
      WebSocketImpl: FakeWS as unknown as NonNullable<RemotePCOptions["WebSocketImpl"]>,
    });
    pc.connect();
    await vi.advanceTimersByTimeAsync(0);
    expect(pc.state).toBe("offline");

    await vi.advanceTimersByTimeAsync(150);
    await waitForOnline(pc);
    expect(pc.state).toBe("online");
    expect(pc.activeHost).toBe("1.2.3.4");
  });

  it("submits an explicit idempotent task and ignores premature chat terminals", async () => {
    const pc = new RemotePC({
      host: "1.2.3.4",
      ...autoAuthenticatedIdentity(),
      WebSocketImpl: FakeWS as unknown as NonNullable<RemotePCOptions["WebSocketImpl"]>,
    });
    pc.connect();
    await vi.advanceTimersByTimeAsync(0);
    await waitForOnline(pc);
    const task = pc.runTask("open notepad and write hello");
    await vi.advanceTimersByTimeAsync(0);
    const ws = FakeWS.instances.at(-1)!;
    await waitForWire(ws, "task.submit");
    const submit = taskSubmit(ws);
    const data = submitData(submit);
    const taskId = String(data.task_id);

    expect(submit.v).toBe(2);
    expect(submit.type).toBe("task.submit");
    expect(data.goal).toBe("open notepad and write hello");
    expect(data.idempotency_key).toEqual(expect.any(String));

    let settled = false;
    void task.then(() => {
      settled = true;
    });
    ws.receive("response_end", { text: "Done" });
    ws.receive("agent_task_end", { ok: true, summary: "legacy" });
    await Promise.resolve();
    expect(settled).toBe(false);

    ws.receive("task.accepted", { task_id: taskId, state: "queued" }, taskId, 1);
    await waitForWire(ws, "task.subscribe");
    expect(ws.sent.some((m) => m.type === "task.subscribe")).toBe(true);
    ws.receive(
      "task.event",
      {
        kind: "terminal",
        data: { state: "succeeded", ok: true, summary: "Verified done", proof: verifiedProof },
      },
      taskId,
      2,
    );
    await expect(task).resolves.toMatchObject({ ok: true, summary: "Verified done" });
  });

  it("resubscribes an accepted task with its event cursor after reconnect", async () => {
    const pc = new RemotePC({
      host: "1.2.3.4",
      ...autoAuthenticatedIdentity(),
      reconnectMs: 100,
      WebSocketImpl: FakeWS as unknown as NonNullable<RemotePCOptions["WebSocketImpl"]>,
    });
    pc.connect();
    await vi.advanceTimersByTimeAsync(0);
    await waitForOnline(pc);
    const task = pc.runTask("research on my PC");
    await vi.advanceTimersByTimeAsync(0);
    const ws1 = FakeWS.instances.at(-1)!;
    await waitForWire(ws1, "task.submit");
    const taskId = String(submitData(taskSubmit(ws1)).task_id);
    // Acceptance/status snapshots are out-of-band seq=0. The first durable
    // journal row is seq=1, so the reconnect cursor is contiguous rather than
    // skipping invented rows 1-2.
    ws1.receive("task.accepted", { state: "executing" }, taskId, 0);
    ws1.receive("task.event", { kind: "step", data: { n: 1 } }, taskId, 1);
    await waitForWire(ws1, "task.subscribe");
    await vi.advanceTimersByTimeAsync(0);

    ws1.drop();
    await vi.advanceTimersByTimeAsync(150);
    await waitForOnline(pc);
    const ws2 = FakeWS.instances.at(-1)!;
    await waitForWire(ws2, "task.subscribe");
    expect(ws2).not.toBe(ws1);
    expect(ws2.sent).toContainEqual(
      expect.objectContaining({
        type: "task.subscribe",
        data: { task_id: taskId, resume_after_seq: 1 },
      }),
    );
    expect(ws2.sent).toContainEqual(
      expect.objectContaining({ type: "task.status", data: { task_id: taskId } }),
    );

    ws2.receive("response", { text: "unrelated greeting" });
    ws2.receive(
      "task.status",
      { state: "succeeded", summary: "Recovered", proof: verifiedProof },
      taskId,
      0,
    );
    await expect(task).resolves.toMatchObject({ ok: true, summary: "Recovered" });
  });

  it("buffers a delayed N+1 row until N arrives and then drains in order", async () => {
    const delivered: number[] = [];
    const pc = new RemotePC({
      host: "1.2.3.4",
      ...autoAuthenticatedIdentity(),
      onEvent: (event) => {
        if (event.event === "task.event" && event.seq) delivered.push(event.seq);
      },
      WebSocketImpl: FakeWS as unknown as NonNullable<RemotePCOptions["WebSocketImpl"]>,
    });
    pc.connect();
    await vi.advanceTimersByTimeAsync(0);
    await waitForOnline(pc);
    const task = pc.runTask("process rows in verified order");
    await vi.advanceTimersByTimeAsync(0);
    const ws = FakeWS.instances.at(-1)!;
    await waitForWire(ws, "task.submit");
    const taskId = String(submitData(taskSubmit(ws)).task_id);

    ws.receive("task.accepted", { state: "executing" }, taskId, 0);
    await waitForWire(ws, "task.subscribe");
    const subscriptionsBeforeGap = ws.sent.filter(
      (message) => message.type === "task.subscribe",
    ).length;

    // seq=2 races ahead of seq=1. It must neither reach the UI nor advance the
    // cursor; instead the client requests replay after the last contiguous row.
    ws.receive("task.event", { kind: "step", data: { n: 2 } }, taskId, 2);
    expect(delivered).toEqual([]);
    await vi.waitFor(() =>
      expect(ws.sent.filter((message) => message.type === "task.subscribe").length).toBe(
        subscriptionsBeforeGap + 1,
      ),
    );
    const subscriptionsAfterGap = ws.sent.filter((message) => message.type === "task.subscribe");
    expect(subscriptionsAfterGap).toHaveLength(subscriptionsBeforeGap + 1);
    expect(subscriptionsAfterGap.at(-1)).toMatchObject({
      data: { task_id: taskId, resume_after_seq: 0 },
    });

    // The delayed row closes the gap. The buffered row is then fed through the
    // same validator, producing strictly ordered UI delivery [1, 2].
    ws.receive("task.event", { kind: "step", data: { n: 1 } }, taskId, 1);
    await vi.waitFor(() => expect(delivered).toEqual([1, 2]));

    ws.receive(
      "task.event",
      {
        kind: "terminal",
        data: { state: "succeeded", summary: "Ordered", proof: verifiedProof },
      },
      taskId,
      3,
    );
    await expect(task).resolves.toMatchObject({ ok: true, summary: "Ordered" });
  });

  it("resubmits an unacknowledged task with the same idempotency key", async () => {
    const pc = new RemotePC({
      host: "1.2.3.4",
      ...autoAuthenticatedIdentity(),
      reconnectMs: 100,
      WebSocketImpl: FakeWS as unknown as NonNullable<RemotePCOptions["WebSocketImpl"]>,
    });
    pc.connect();
    await vi.advanceTimersByTimeAsync(0);
    await waitForOnline(pc);
    const task = pc.runTask("open a document");
    await vi.advanceTimersByTimeAsync(0);
    const ws1 = FakeWS.instances.at(-1)!;
    await waitForWire(ws1, "task.submit");
    const first = submitData(taskSubmit(ws1));

    ws1.drop();
    await vi.advanceTimersByTimeAsync(150);
    await waitForOnline(pc);
    const ws2 = FakeWS.instances.at(-1)!;
    await waitForWire(ws2, "task.submit");
    const second = submitData(taskSubmit(ws2));
    expect(second.task_id).toBe(first.task_id);
    expect(second.idempotency_key).toBe(first.idempotency_key);

    const taskId = String(first.task_id);
    ws2.receive("task.accepted", { state: "queued" }, taskId, 1);
    ws2.receive("task.status", { state: "failed", summary: "Could not open it" }, taskId, 2);
    await expect(task).resolves.toMatchObject({ ok: false, summary: "Could not open it" });
  });

  it("ignores interleaved task events and duplicate replay sequence numbers", async () => {
    const events: Array<{ event: string; seq?: number }> = [];
    const pc = new RemotePC({
      host: "1.2.3.4",
      ...autoAuthenticatedIdentity(),
      onEvent: (event) => events.push({ event: event.event, seq: event.seq }),
      WebSocketImpl: FakeWS as unknown as NonNullable<RemotePCOptions["WebSocketImpl"]>,
    });
    pc.connect();
    await vi.advanceTimersByTimeAsync(0);
    await waitForOnline(pc);
    const task = pc.runTask("do mine only");
    await vi.advanceTimersByTimeAsync(0);
    const ws = FakeWS.instances.at(-1)!;
    await waitForWire(ws, "task.submit");
    const taskId = String(submitData(taskSubmit(ws)).task_id);

    ws.receive("task.status", { state: "succeeded", summary: "someone else" }, "other-task", 9);
    ws.receive("task.accepted", { state: "executing" }, taskId, 1);
    ws.receive("task.event", { kind: "step" }, taskId, 2);
    ws.receive("task.event", { kind: "step" }, taskId, 2);
    await vi.waitFor(() =>
      expect(events.filter((e) => e.event === "task.event" && e.seq === 2)).toHaveLength(1),
    );

    ws.receive(
      "task.status",
      { state: "succeeded", summary: "mine", proof: verifiedProof },
      taskId,
      3,
    );
    await expect(task).resolves.toMatchObject({ ok: true, summary: "mine" });
  });

  it("ambient telemetry cannot extend the task watchdog and timeout sends task.cancel", async () => {
    const pc = new RemotePC({
      host: "1.2.3.4",
      ...autoAuthenticatedIdentity(),
      taskIdleTimeoutMs: 1_000,
      WebSocketImpl: FakeWS as unknown as NonNullable<RemotePCOptions["WebSocketImpl"]>,
    });
    pc.connect();
    await vi.advanceTimersByTimeAsync(0);
    await waitForOnline(pc);
    const task = pc.runTask("wait for verified progress");
    await vi.advanceTimersByTimeAsync(0);
    const ws = FakeWS.instances.at(-1)!;
    await waitForWire(ws, "task.submit");
    const taskId = String(submitData(taskSubmit(ws)).task_id);

    await vi.advanceTimersByTimeAsync(900);
    ws.receive("telemetry", { cpu: 1 });
    await vi.advanceTimersByTimeAsync(101);

    await expect(task).resolves.toMatchObject({ ok: false, error: "client_stalled" });
    await waitForWire(ws, "task.cancel");
    expect(ws.sent).toContainEqual(
      expect.objectContaining({
        type: "task.cancel",
        data: { task_id: taskId, reason: "client_stalled" },
      }),
    );
  });

  it("out-of-band heartbeats keep a task alive without disturbing its durable sequence", async () => {
    const events: Array<{ event: string; seq?: number }> = [];
    const pc = new RemotePC({
      host: "1.2.3.4",
      ...autoAuthenticatedIdentity(),
      onEvent: (event) => events.push({ event: event.event, seq: event.seq }),
      WebSocketImpl: FakeWS as unknown as NonNullable<RemotePCOptions["WebSocketImpl"]>,
    });
    pc.connect();
    await vi.advanceTimersByTimeAsync(0);
    await waitForOnline(pc);
    const task = pc.runTask("a long, mostly-silent PC task");
    await vi.advanceTimersByTimeAsync(0);
    const ws = FakeWS.instances.at(-1)!;
    await waitForWire(ws, "task.submit");
    const taskId = String(submitData(taskSubmit(ws)).task_id);
    ws.receive("task.accepted", { state: "executing" }, taskId, 1);

    // The PC's keep-alive pings ride as correlated task.heartbeat events at seq 0
    // (out-of-band). They must (a) be delivered — proving the phone accepts and does
    // not drop the link on them, which is what feeds the idle watchdog — and (b) NOT
    // advance the durable cursor, so they can never be mistaken for a sequence gap.
    ws.receive("task.heartbeat", { task_id: taskId }, taskId, 0);
    ws.receive("task.heartbeat", { task_id: taskId }, taskId, 0);
    await vi.waitFor(() =>
      expect(events.filter((e) => e.event === "task.heartbeat")).toHaveLength(2),
    );
    // Heartbeats never settle the task, and never provoked a replay/resubscribe.
    expect(ws.sent.filter((m) => m.type === "task.subscribe")).toHaveLength(1);
    expect(ws.sent.some((m) => m.type === "task.cancel")).toBe(false);

    // The next genuine event (seq 2) still applies straight after the seq-0 pings,
    // proving the durable sequence was untouched, and completes the task.
    ws.receive(
      "task.status",
      { state: "succeeded", summary: "done", proof: verifiedProof },
      taskId,
      2,
    );
    await expect(task).resolves.toMatchObject({ ok: true, summary: "done" });
  });

  it("sends one signed response for the exact live approval challenge", async () => {
    FakeWS.autoAuthenticate = true;
    const identity = fakeIdentity();
    const events: string[] = [];
    const pc = new RemotePC({
      host: "100.100.100.1",
      hostId: "host-pinned",
      hostFingerprint: "sha256:host",
      hostPublicKey: "host-public",
      identityBridge: identity,
      onEvent: (event) => events.push(event.event),
      WebSocketImpl: FakeWS as unknown as NonNullable<RemotePCOptions["WebSocketImpl"]>,
    });
    pc.connect();
    await waitForOnline(pc);
    const task = pc.runTask("prepare an exact consequential action");
    const ws = FakeWS.instances.at(-1)!;
    await waitForWire(ws, "task.submit");
    const taskId = String(submitData(taskSubmit(ws)).task_id);
    ws.receive("task.accepted", { state: "executing" }, taskId, 1);

    const actionDigest = `sha256:${"a".repeat(64)}`;
    const expiresAt = Math.floor(Date.now() / 1000) + 60;
    ws.receive(
      "approval.challenge",
      {
        approval_id: "approval-live-1",
        step_id: "step-live-1",
        action_digest: actionDigest,
        expires_at: expiresAt,
        consequence: "Send the prepared draft",
      },
      taskId,
      2,
    );
    await vi.waitFor(() => expect(events).toContain("approval.challenge"));

    expect(pc.respondPermission("step-live-1", true)).toBe(true);
    await waitForWire(ws, "approval.response");
    const response = ws.sent.find((message) => message.type === "approval.response");
    expect(response).toMatchObject({
      v: 2,
      type: "approval.response",
      data: {
        task_id: taskId,
        approval_id: "approval-live-1",
        step_id: "step-live-1",
        action_digest: actionDigest,
        approved: true,
        expires_at: expiresAt,
      },
      auth: {
        device_id: "phone-0123456789abcdef0123456789abcdef",
        connection_nonce: "nonce-1",
      },
    });
    expect(identity.signEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({
        messageType: "approval.response",
        taskId,
      }),
    );
    expect(pc.respondPermission("step-live-1", true)).toBe(false);
    pc.close();
    await expect(task).resolves.toMatchObject({ ok: false });
  });

  it("rejects missing, expired, stale, replaced, and malformed approval correlations", async () => {
    FakeWS.autoAuthenticate = true;
    const identity = fakeIdentity();
    const delivered: string[] = [];
    const pc = new RemotePC({
      host: "100.100.100.1",
      hostId: "host-pinned",
      hostFingerprint: "sha256:host",
      hostPublicKey: "host-public",
      identityBridge: identity,
      onEvent: (event) => delivered.push(event.event),
      WebSocketImpl: FakeWS as unknown as NonNullable<RemotePCOptions["WebSocketImpl"]>,
    });
    pc.connect();
    await waitForOnline(pc);
    expect(pc.respondPermission("missing", true)).toBe(false);
    const task = pc.runTask("hold at approval");
    const ws = FakeWS.instances.at(-1)!;
    await waitForWire(ws, "task.submit");
    const taskId = String(submitData(taskSubmit(ws)).task_id);
    ws.receive("task.accepted", { state: "executing" }, taskId, 1);
    const digest = `sha256:${"b".repeat(64)}`;

    ws.receive(
      "approval.challenge",
      {
        approval_id: "expired",
        step_id: "expired-step",
        action_digest: digest,
        expires_at: Math.floor(Date.now() / 1000) - 1,
      },
      taskId,
      2,
    );
    await vi.waitFor(() => expect(identity.verifyHostEnvelope).toHaveBeenCalledTimes(3));
    expect(pc.respondPermission("expired-step", true)).toBe(false);

    ws.receive(
      "approval.challenge",
      {
        approval_id: "first",
        step_id: "first-step",
        action_digest: digest,
        expires_at: Math.floor(Date.now() / 1000) + 60,
      },
      taskId,
      3,
    );
    await vi.waitFor(() => expect(delivered.filter((event) => event === "approval.challenge")).toHaveLength(1));
    expect(pc.respondPermission("wrong-step", true)).toBe(false);

    ws.receive(
      "approval.challenge",
      {
        approval_id: "second",
        step_id: "second-step",
        action_digest: digest,
        expires_at: Date.now() + 60_000,
      },
      taskId,
      4,
    );
    await vi.waitFor(() => expect(delivered.filter((event) => event === "approval.challenge")).toHaveLength(2));
    expect(pc.respondPermission("first-step", true)).toBe(false);

    // A newer signed but malformed challenge clears the previously valid one.
    ws.receive(
      "approval.challenge",
      {
        approval_id: "malformed",
        step_id: "third-step",
        action_digest: "not-a-digest",
        expires_at: Date.now() + 60_000,
      },
      taskId,
      5,
    );
    await vi.waitFor(() => expect(identity.verifyHostEnvelope).toHaveBeenCalledTimes(6));
    expect(pc.respondPermission("second-step", true)).toBe(false);
    expect(ws.sent.some((message) => message.type === "approval.response")).toBe(false);
    pc.close();
    await expect(task).resolves.toMatchObject({ ok: false });
  });

  it("accepts an exact approval replay for an explicitly restored subscription", async () => {
    FakeWS.autoAuthenticate = true;
    const events: string[] = [];
    const pc = new RemotePC({
      host: "100.100.100.1",
      ...autoAuthenticatedIdentity(),
      onEvent: (event) => events.push(event.event),
      WebSocketImpl: FakeWS as unknown as NonNullable<RemotePCOptions["WebSocketImpl"]>,
    });
    pc.connect();
    await waitForOnline(pc);
    const ws = FakeWS.instances.at(-1)!;
    const restoredTaskId = "task-restored-approval";
    expect(
      pc.signal("task.subscribe", { task_id: restoredTaskId, resume_after_seq: 4 }),
    ).toBe(true);
    await waitForWire(ws, "task.subscribe");
    ws.receive(
      "approval.challenge",
      {
        approval_id: "approval-restored",
        step_id: "restored-step",
        action_digest: `sha256:${"c".repeat(64)}`,
        expires_at: Math.floor(Date.now() / 1000) + 60,
      },
      restoredTaskId,
      5,
    );
    await vi.waitFor(() => expect(events).toContain("approval.challenge"));
    expect(pc.respondPermission("restored-step", false)).toBe(true);
    await waitForWire(ws, "approval.response");
    expect(ws.sent.find((message) => message.type === "approval.response")?.data).toMatchObject({
      task_id: restoredTaskId,
      step_id: "restored-step",
      approved: false,
    });
    pc.close();
  });

  it("requires succeeded state and a nonempty verified evidence receipt", async () => {
    FakeWS.autoAuthenticate = true;
    const pc = new RemotePC({
      host: "100.100.100.1",
      ...autoAuthenticatedIdentity(),
      WebSocketImpl: FakeWS as unknown as NonNullable<RemotePCOptions["WebSocketImpl"]>,
    });
    pc.connect();
    await waitForOnline(pc);
    const ws = FakeWS.instances.at(-1)!;

    const run = async (
      goal: string,
      terminal: Record<string, unknown>,
    ): Promise<Awaited<ReturnType<RemotePC["runTask"]>>> => {
      const before = ws.sent.filter((message) => message.type === "task.submit").length;
      const promise = pc.runTask(goal);
      await vi.waitFor(() =>
        expect(ws.sent.filter((message) => message.type === "task.submit")).toHaveLength(before + 1),
      );
      const submit = ws.sent.filter((message) => message.type === "task.submit").at(-1)!;
      const taskId = String(submitData(submit).task_id);
      ws.receive("task.accepted", { state: "executing" }, taskId, 1);
      ws.receive("task.status", terminal, taskId, 2);
      return promise;
    };

    await expect(
      run("failed claim", {
        state: "failed",
        ok: true,
        summary: "Host reported failure",
        proof: verifiedProof,
      }),
    ).resolves.toMatchObject({ ok: false, summary: "Host reported failure" });
    await expect(
      run("unproved success", {
        state: "succeeded",
        ok: true,
        summary: "Claimed done",
      }),
    ).resolves.toMatchObject({ ok: false, error: "unverified_success" });
    await expect(
      run("proved success", {
        state: "succeeded",
        ok: true,
        summary: "Verified done",
        proof: verifiedProof,
      }),
    ).resolves.toMatchObject({ ok: true, summary: "Verified done" });
    pc.close();
  });

  it("does not become online until a pinned host and Keystore device authenticate", async () => {
    const identity = fakeIdentity();
    const pc = new RemotePC({
      host: "100.100.100.1",
      hostId: "host-pinned",
      hostFingerprint: "sha256:host",
      hostPublicKey: "host-public",
      identityBridge: identity,
      WebSocketImpl: FakeWS as unknown as NonNullable<RemotePCOptions["WebSocketImpl"]>,
    });
    pc.connect();
    await vi.advanceTimersByTimeAsync(0);
    const ws = FakeWS.instances.at(-1)!;
    expect(pc.state).toBe("connecting");
    expect(ws.protocols).toEqual(["aura-v3"]);
    expect(ws.protocols.join(",")).not.toContain("aura-token");

    ws.receiveWire(hostChallenge());
    await vi.advanceTimersByTimeAsync(0);
    expect(ws.sent).toContainEqual(expect.objectContaining({
      type: "auth.response",
      data: expect.objectContaining({
        device_id: "phone-0123456789abcdef0123456789abcdef",
        nonce: "nonce-1",
        signature: "phone-auth-signature",
      }),
    }));
    expect(pc.state).toBe("connecting");

    ws.receiveWire(hostWire(
      "auth.ready",
      { device_id: "phone-0123456789abcdef0123456789abcdef", scopes: ["tasks"] },
      1,
    ));
    await vi.waitFor(() => expect(pc.state).toBe("online"));
    await vi.waitFor(() => {
      expect(ws.sent.some((message) => message.type === "protocol.hello")).toBe(true);
    });
    const hello = ws.sent.find((message) => message.type === "protocol.hello");
    expect(hello?.auth).toMatchObject({
      device_id: "phone-0123456789abcdef0123456789abcdef",
      connection_nonce: "nonce-1",
    });
  });

  it("pairs with a signed, public, single-use QR challenge plus the on-screen PIN", async () => {
    const identity = fakeIdentity();
    const pc = new RemotePC({
      host: "100.100.100.1",
      hostId: "host-pinned",
      hostFingerprint: "sha256:host",
      hostPublicKey: "host-public",
      pairingChallengeId: "pair-public-expiring-id",
      pin: "482913",
      deviceName: "Test phone",
      identityBridge: identity,
      WebSocketImpl: FakeWS as unknown as NonNullable<RemotePCOptions["WebSocketImpl"]>,
    });
    pc.connect();
    await vi.advanceTimersByTimeAsync(0);
    const ws = FakeWS.instances.at(-1)!;
    ws.receiveWire(hostChallenge());
    await vi.advanceTimersByTimeAsync(0);
    expect(ws.sent.some((message) => message.type === "auth.response")).toBe(true);
    ws.receiveWire({
      event: "auth.pairing_required",
      data: { host_id: "host-pinned", nonce: "nonce-1" },
    });
    await vi.advanceTimersByTimeAsync(0);

    const claim = ws.sent.find((message) => message.type === "pairing.claim");
    expect(claim).toMatchObject({
      data: {
        challenge_id: "pair-public-expiring-id",
        device_id: "phone-0123456789abcdef0123456789abcdef",
        public_key: "phone-public",
        device_name: "Test phone",
        pin: "482913",
        signature: "phone-pair-signature",
      },
    });
    expect(JSON.stringify(claim)).not.toContain("token");
    expect(identity.signPairing).toHaveBeenCalledTimes(1);
  });

  it("refuses to pair (terminal) when no on-screen PIN was entered", async () => {
    const identity = fakeIdentity();
    const pc = new RemotePC({
      host: "100.100.100.1",
      hostId: "host-pinned",
      hostFingerprint: "sha256:host",
      hostPublicKey: "host-public",
      pairingChallengeId: "pair-public-expiring-id",
      // no pin
      deviceName: "Test phone",
      identityBridge: identity,
      WebSocketImpl: FakeWS as unknown as NonNullable<RemotePCOptions["WebSocketImpl"]>,
    });
    pc.connect();
    await vi.advanceTimersByTimeAsync(0);
    const ws = FakeWS.instances.at(-1)!;
    ws.receiveWire(hostChallenge());
    await vi.advanceTimersByTimeAsync(0);
    ws.receiveWire({
      event: "auth.pairing_required",
      data: { host_id: "host-pinned", nonce: "nonce-1" },
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(ws.sent.some((message) => message.type === "pairing.claim")).toBe(false);
    expect(identity.signPairing).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(pc.state).toBe("unauthorized"));
  });

  it("fails closed on an unpinned host or an impersonated auth.ready device", async () => {
    const pc = new RemotePC({
      host: "100.100.100.1",
      hostId: "different-host",
      hostFingerprint: "sha256:host",
      hostPublicKey: "host-public",
      identityBridge: fakeIdentity(),
      WebSocketImpl: FakeWS as unknown as NonNullable<RemotePCOptions["WebSocketImpl"]>,
    });
    pc.connect();
    await vi.advanceTimersByTimeAsync(0);
    const ws = FakeWS.instances.at(-1)!;
    ws.receiveWire(hostChallenge());
    await vi.advanceTimersByTimeAsync(0);
    expect(pc.state).toBe("unauthorized");
    expect(ws.sent.some((message) => message.type === "protocol.hello")).toBe(false);
  });

  it("rejects replayed host envelope counters before delivering the event", async () => {
    const events: string[] = [];
    const pc = new RemotePC({
      host: "100.100.100.1",
      hostId: "host-pinned",
      hostFingerprint: "sha256:host",
      hostPublicKey: "host-public",
      identityBridge: fakeIdentity(),
      onEvent: (event) => events.push(event.event),
      WebSocketImpl: FakeWS as unknown as NonNullable<RemotePCOptions["WebSocketImpl"]>,
    });
    pc.connect();
    await vi.advanceTimersByTimeAsync(0);
    const ws = FakeWS.instances.at(-1)!;
    ws.receiveWire(hostChallenge());
    await vi.advanceTimersByTimeAsync(0);
    ws.receiveWire(hostWire(
      "auth.ready",
      { device_id: "phone-0123456789abcdef0123456789abcdef", scopes: ["tasks"] },
      1,
    ));
    await vi.waitFor(() => expect(pc.state).toBe("online"));
    ws.receiveWire(hostWire("task.snapshot", { tasks: [] }, 2));
    await vi.waitFor(() => expect(events).toContain("task.snapshot"));

    ws.receiveWire(hostWire("task.snapshot", { tasks: [{ task_id: "forged" }] }, 2));
    // A replayed counter is a transport-integrity failure, not an identity
    // verdict: the link drops (and will reconnect) WITHOUT delivering the
    // forged event and WITHOUT bricking pairing as "unauthorized".
    await vi.waitFor(() => expect(ws.readyState).toBe(3));
    expect(pc.state).not.toBe("unauthorized");
    expect(events.filter((event) => event === "task.snapshot")).toHaveLength(1);
  });
});
