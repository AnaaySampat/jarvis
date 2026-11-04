import { useState } from "react";

// An explicit, device-local choice. It does not invent provider credentials or
// change the backend's report of which capabilities are available.
export function useLocalExploration() {
  const [exploring, setExploring] = useState(() => {
    try {
      return localStorage.getItem("jarvis.explore-local.v1") === "true";
    } catch {
      return false;
    }
  });
  return [
    exploring,
    () => {
      setExploring(true);
      try {
        localStorage.setItem("jarvis.explore-local.v1", "true");
      } catch {
        /* Session still works. */
      }
    },
  ];
}
