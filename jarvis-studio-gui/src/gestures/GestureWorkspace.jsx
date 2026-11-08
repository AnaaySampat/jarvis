import { useEffect, useRef } from "react";
import GesturePanel from "./GesturePanel";
import GestureSessionOverlay from "./GestureSessionOverlay";
import { useAndroidBack } from "../hooks/useAndroidBack";
import { Icon } from "./GestureIcon";
import "./gestures.css";

export default function GestureWorkspace({
  controls,
  open = false,
  onClose,
  onOpen,
  routines = [],
}) {
  const dialog = useRef(null);
  useAndroidBack(open, onClose);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    dialog.current?.querySelector("button")?.focus();
    const key = (event) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        event.stopPropagation();
        onClose?.();
      }
      if (event.key !== "Tab") return;
      const focusable = [
        ...(dialog.current?.querySelectorAll(
          "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea, summary, [tabindex='0']",
        ) || []),
      ].filter((node) => node.getClientRects().length);
      const first = focusable[0],
        last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    const node = dialog.current;
    node?.addEventListener("keydown", key);
    return () => {
      node?.removeEventListener("keydown", key);
      previous?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return <GestureSessionOverlay controls={controls} onOpen={onOpen} />;
  const active = controls.status.running || controls.status.starting;
  return (
    <>
      {controls.cursor &&
        active &&
        controls.config.mode === "hud" &&
        !controls.practice &&
        !controls.paused && (
          <div
            aria-hidden="true"
            className={`gesture-cursor${controls.cursor.down ? " is-down" : ""}`}
            style={{ left: controls.cursor.x, top: controls.cursor.y }}
          />
        )}
      <div className="hands-free-scrim" />
      <section
        ref={dialog}
        className="hands-free hands-free-console"
        role="dialog"
        aria-modal="true"
        aria-label="Activities"
      >
        <header className="activity-bar hands-free-header">
          <div className="hands-free-title">
            <span className="hands-free-kicker">
              J.A.R.V.I.S. <span>/ GESTURE INTERFACE</span>
            </span>
            <h2>Hands-free</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close activities">
            <Icon name="close" size={20} />
          </button>
        </header>
        <div className="hands-free-body">
          <GesturePanel controls={controls} routines={routines} workspace />
        </div>
      </section>
    </>
  );
}
