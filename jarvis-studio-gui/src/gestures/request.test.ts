import { afterEach, describe, expect, it, vi } from "vitest";
import { GestureRequests } from "./request";
afterEach(() => vi.useRealTimers());
describe("correlated one-shot gesture requests", () => {
  it("resolves only the matching acknowledgement and protects its typed action", async () => {
    const requests = new GestureRequests(),
      send = vi.fn((_data: Record<string, unknown>) => true);
    const pending = requests.request(send, "pc.next", { action: "approve", request_id: "forged" });
    const payload = send.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(payload.action).toBe("pc.next");
    expect(payload.request_id).not.toBe("forged");
    expect(requests.receive({ request_id: "other", ok: true })).toBe(false);
    expect(
      requests.receive({ request_id: payload.request_id, ok: false, summary: "Lease expired" }),
    ).toBe(true);
    expect(await pending).toEqual({ ok: false, summary: "Lease expired" });
    expect(requests.receive({ request_id: payload.request_id, ok: true })).toBe(false);
  });
  it("times out without retrying a media toggle", async () => {
    vi.useFakeTimers();
    const requests = new GestureRequests(),
      send = vi.fn(() => true);
    const result = expect(requests.request(send, "media.toggle")).rejects.toThrow(
      "did not acknowledge",
    );
    await vi.advanceTimersByTimeAsync(10000);
    await result;
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("rejects pending work on disconnect", async () => {
    const requests = new GestureRequests();
    const result = expect(requests.request(() => true, "pc.next")).rejects.toThrow(
      "connection closed",
    );
    requests.close();
    await result;
  });
  it("cleans its timer when the transport throws", async () => {
    vi.useFakeTimers();
    await expect(
      new GestureRequests().request(() => {
        throw new Error("Transport closed");
      }, "pc.next"),
    ).rejects.toThrow("Transport closed");
    expect(vi.getTimerCount()).toBe(0);
  });
});
