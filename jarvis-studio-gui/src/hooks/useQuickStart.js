import { useState } from "react";

const KEY = "jarvis.quick-start.v1";

/** The introduction is shown once per installation and can be replayed from Appearance. */
export function useQuickStart() {
  const [complete, setComplete] = useState(() => {
    try {
      return localStorage.getItem(KEY) === "done";
    } catch {
      return false;
    }
  });
  const [replaying, setReplaying] = useState(false);
  return {
    open: !complete || replaying,
    replay: () => setReplaying(true),
    finish: () => {
      try {
        localStorage.setItem(KEY, "done");
      } catch {
        // Still dismiss for this session when storage is unavailable.
      }
      setComplete(true);
      setReplaying(false);
    },
  };
}
