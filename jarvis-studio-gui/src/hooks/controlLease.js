/** Small fail-closed lease/sequence tracker for remote PC input. Authentication is
 * enforced by the host; this prevents the UI from emitting an unleased or replayed
 * input envelope in the first place. */
export function createControlLeaseTracker() {
  let leaseId = "";
  let sequence = 0;
  return {
    get leaseId() {
      return leaseId;
    },
    acquire(value) {
      const next = String(value || "").trim();
      if (!next) {
        leaseId = "";
        sequence = 0;
        return false;
      }
      if (next === leaseId) return true;
      leaseId = next;
      sequence = 0;
      return true;
    },
    clear() {
      leaseId = "";
      sequence = 0;
    },
    nextEnvelope() {
      if (!leaseId) return null;
      sequence += 1;
      return { lease_id: leaseId, seq: sequence };
    },
  };
}
