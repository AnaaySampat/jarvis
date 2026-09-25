import { describe, expect, it } from "vitest";
import { createControlLeaseTracker } from "./controlLease.js";

describe("remote input lease tracker", () => {
  it("fails closed until the host issues a lease", () => {
    const tracker = createControlLeaseTracker();
    expect(tracker.nextEnvelope()).toBeNull();
    expect(tracker.acquire("")).toBe(false);
    expect(tracker.nextEnvelope()).toBeNull();
  });

  it("binds every command to the lease with a strictly increasing sequence", () => {
    const tracker = createControlLeaseTracker();
    expect(tracker.acquire("host-lease-a")).toBe(true);
    expect(tracker.nextEnvelope()).toEqual({ lease_id: "host-lease-a", seq: 1 });
    expect(tracker.nextEnvelope()).toEqual({ lease_id: "host-lease-a", seq: 2 });
    tracker.acquire("host-lease-a"); // duplicate arm/control-state replay must not rewind
    expect(tracker.nextEnvelope()).toEqual({ lease_id: "host-lease-a", seq: 3 });
  });

  it("invalidates old input after clear and restarts sequencing for a new lease", () => {
    const tracker = createControlLeaseTracker();
    tracker.acquire("old");
    tracker.nextEnvelope();
    tracker.clear();
    expect(tracker.nextEnvelope()).toBeNull();
    tracker.acquire("new");
    expect(tracker.nextEnvelope()).toEqual({ lease_id: "new", seq: 1 });
  });
});
