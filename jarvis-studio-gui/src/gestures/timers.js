import { useEffect, useRef, useState } from "react";
import { safeStorage } from "./storage";

const KEY = "jarvis.activity.timers.v1";
function readSaved(key, fallback) {
  try {
    return JSON.parse(safeStorage()?.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}
export function validTimers(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (t) =>
        t &&
        typeof t.id === "string" &&
        t.id.length < 150 &&
        Number.isFinite(t.deadline) &&
        Number.isInteger(t.seconds) &&
        t.seconds >= 5 &&
        t.seconds <= 86400 &&
        typeof t.label === "string" &&
        ["running", "finished", "cancelled"].includes(t.state),
    )
    .slice(-50)
    .map((t) => ({
      id: t.id,
      deadline: t.deadline,
      seconds: t.seconds,
      label: t.label.slice(0, 160),
      state: t.state,
      external: t.external === true,
      ...(typeof t.token === "string" ? { token: t.token.slice(0, 100) } : {}),
    }));
}
export function timerLabel(seconds) {
  if (seconds % 60 === 0) return `${seconds / 60}-minute`;
  return `${seconds}-second`;
}
export function timeLeft(deadline, now) {
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function useActivityTimers(host) {
  const [timers, setTimers] = useState(() => {
    try {
      return validTimers(JSON.parse(safeStorage()?.getItem(KEY) || "[]"));
    } catch {
      return [];
    }
  });
  const [now, setNow] = useState(Date.now);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const dismissed = useRef(readSaved(KEY + ".dismissed", []));
  const uncertain = useRef(readSaved(KEY + ".pending", null));
  const hostRef = useRef(host),
    current = useRef(timers),
    pending = useRef(false),
    revision = useRef(0);
  useEffect(() => {
    hostRef.current = host;
  }, [host]);
  const update = (value) => {
    const next = value.filter(
      (t) =>
        !Array.isArray(dismissed.current) || !dismissed.current.includes(t.id),
    );
    if (JSON.stringify(current.current) === JSON.stringify(next)) return;
    current.current = next;
    setNow(Date.now());
    setTimers(next);
    try {
      safeStorage()?.setItem(KEY, JSON.stringify(next));
    } catch {
      setError("Could not save timer state on this device.");
    }
  };
  useEffect(() => {
    let disposed = false,
      polling = false,
      lastPoll = -Infinity;
    const refresh = async () => {
      if (
        polling ||
        pending.current ||
        !hostRef.current.listTimers ||
        Date.now() - lastPoll < 5000
      )
        return;
      const version = revision.current;
      lastPoll = Date.now();
      polling = true;
      try {
        const response = await hostRef.current.listTimers();
        if (disposed || pending.current || version !== revision.current) return;
        if (response.ok && Array.isArray(response.timers)) {
          const remote = validTimers(response.timers);
          if (
            uncertain.current &&
            (remote.some((t) => t.token === uncertain.current.token) ||
              Date.now() - uncertain.current.at > 15000)
          ) {
            uncertain.current = null;
            try {
              safeStorage()?.removeItem(KEY + ".pending");
            } catch {
              /* Reconcile again on reload. */
            }
          }
          // A successful snapshot is authoritative for Windows-owned timers.
          const history = current.current.filter(
            (t) =>
              t.external ||
              (!remote.some((r) => r.id === t.id) &&
                (t.state !== "running" || t.deadline <= Date.now())),
          );
          update([...history, ...remote].slice(-50));
        }
      } catch {
        // Keep the acknowledged deadline while disconnected. A user operation
        // reports its own error; periodic refresh must not flood announcements.
      } finally {
        polling = false;
      }
    };
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 5000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, []);

  const ticking = timers.some((t) => t.state === "running" && t.deadline > now);
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);

  const start = async (seconds, label, additional = false) => {
    if (pending.current)
      return { ok: false, summary: "A timer request is already in progress." };
    if (
      !additional &&
      current.current.some(
        (t) => t.state === "running" && t.deadline > Date.now(),
      )
    )
      return {
        ok: false,
        summary:
          "A timer is already running. Use Start another timer to add one.",
      };
    revision.current++;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      if (!hostRef.current.startTimer)
        throw new Error("Timers are unavailable on this device.");
      if (
        uncertain.current &&
        (uncertain.current.seconds !== seconds ||
          uncertain.current.label !== label ||
          !hostRef.current.listTimers)
      )
        throw new Error(
          "A previous timer request could not be confirmed. Check your timers before starting another.",
        );
      const token =
        uncertain.current?.token ||
        "timer_" +
          Date.now().toString(36) +
          "_" +
          Math.random().toString(36).slice(2);
      uncertain.current = { token, seconds, label, at: Date.now() };
      try {
        safeStorage()?.setItem(
          KEY + ".pending",
          JSON.stringify(uncertain.current),
        );
      } catch {
        /* Current session retains token. */
      }
      const result = await hostRef.current.startTimer({
        seconds,
        label,
        token,
      });
      if (!result.ok) {
        uncertain.current = null;
        try {
          safeStorage()?.removeItem(KEY + ".pending");
        } catch {
          /* Reconcile on reload. */
        }
        throw new Error(result.summary);
      }
      if (!Array.isArray(result.timers))
        throw new Error(
          "The timer was requested, but its state could not be confirmed. Check your timers before starting another.",
        );
      const received = validTimers(result.timers);
      if (!received.length)
        throw new Error(
          "The timer state was not confirmed. Check your timers before starting another.",
        );
      uncertain.current = null;
      try {
        safeStorage()?.removeItem(KEY + ".pending");
      } catch {
        /* Current session is confirmed. */
      }
      update(
        result.external
          ? [...current.current, ...received].slice(-50)
          : received,
      );
      return result;
    } catch (e) {
      const summary = e.message || String(e);
      setError(summary);
      return { ok: false, summary };
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const cancel = async (id) => {
    if (pending.current) return;
    revision.current++;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await hostRef.current.cancelTimer(id);
      if (!result.ok) throw new Error(result.summary);
      update(
        current.current.map((t) =>
          t.id === id ? { ...t, state: "cancelled" } : t,
        ),
      );
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return {
    timers,
    now,
    error,
    busy,
    start,
    cancel,
    manage: () => hostRef.current.manageTimers?.(),
    dismiss: (id) => {
      dismissed.current = [
        ...(Array.isArray(dismissed.current) ? dismissed.current : []),
        id,
      ].slice(-100);
      try {
        safeStorage()?.setItem(
          KEY + ".dismissed",
          JSON.stringify(dismissed.current),
        );
      } catch {
        /* Hide for this session. */
      }
      update(current.current.filter((t) => t.id !== id));
    },
  };
}
