/** Small fail-closed lease/sequence tracker for remote PC input. Authentication is
 * enforced by the host; this prevents the UI from emitting an unleased or replayed
 * input envelope in the first place. */
export function createControlLeaseTracker(now = () => Date.now()) {
  let leaseId = "";
  let sequence = 0;
  let expiresAt = null;
  return {
    get leaseId() {
      return leaseId;
    },
    get remainingSeconds() {
      return expiresAt == null ? null : Math.max(0, Math.ceil((expiresAt - now()) / 1000));
    },
    acquire(value, secondsLeft) {
      const next = String(value || "").trim();
      if (!next) {
        leaseId = "";
        sequence = 0;
        expiresAt = null;
        return false;
      }
      const duration = secondsLeft == null ? NaN : Number(secondsLeft);
      if (next === leaseId) {
        if (Number.isFinite(duration)) expiresAt = now() + Math.max(0, duration) * 1000;
        return true;
      }
      leaseId = next;
      sequence = 0;
      expiresAt = Number.isFinite(duration) ? now() + Math.max(0, duration) * 1000 : null;
      return true;
    },
    clear() {
      leaseId = "";
      sequence = 0;
      expiresAt = null;
    },
    nextEnvelope() {
      if (!leaseId || (expiresAt != null && now() >= expiresAt)) return null;
      sequence += 1;
      return { lease_id: leaseId, seq: sequence };
    },
  };
}
