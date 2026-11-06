import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import Sheet from "./Sheet";
import { cleanTopBar, TOP_BAR_ACTIONS } from "../brain/mobile/topBarConfig";
import "./mobile-app-bar.css";

/** Quiet at rest; current work stays one tap away. */
export default function MobileQuickControls({
  muted,
  status = "idle",
  preferences,
  onStop,
  onMute,
  onSettings,
  onGestures,
  onDevices,
  onTasks,
  onCustomize,
  onPhone,
  taskActive,
  cameraActive,
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef(null);
  const menuBody = useRef(null);
  const closeMenu = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const panel = menuBody.current?.closest("[role='dialog']");
    if (!panel) return;
    menuBody.current.querySelector("button")?.focus();
    const trapFocus = (event) => {
      if (event.key !== "Tab") return;
      const buttons = [...panel.querySelectorAll("button:not(:disabled)")];
      const first = buttons[0],
        last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    panel.addEventListener("keydown", trapFocus);
    return () => panel.removeEventListener("keydown", trapFocus);
  }, [open]);

  const items = [
    {
      label: "Activities",
      detail: "Read, steps & gestures",
      icon: "hand",
      run: onGestures,
      state: cameraActive ? "Camera on" : undefined,
    },
    { label: "Tasks", icon: "activity", run: onTasks, state: taskActive ? "Running" : undefined },
    { label: "PC & TV", icon: "monitor", run: onDevices },
    { label: "Phone controls", icon: "power", run: onPhone },
    { label: "Appearance", icon: "palette", run: onCustomize },
    { label: "Settings", icon: "settings", run: onSettings },
  ];
  const config = cleanTopBar(preferences);
  const shownStatus = status === "idle" && taskActive ? "working" : status;
  const statusLabel =
    {
      idle: "Ready",
      listening: "Listening",
      thinking: "Thinking",
      working: "Working",
      speaking: "Speaking",
    }[shownStatus] || "Ready";
  const canStop = taskActive || ["working", "speaking"].includes(status);
  const handlers = {
    sound: onMute,
    settings: onSettings,
    activities: onGestures,
    tasks: onTasks,
    devices: onDevices,
    appearance: onCustomize,
    phone: onPhone,
  };
  const shortLabels = { devices: "Devices", appearance: "Look", phone: "Phone" };
  return (
    <>
      <div className="mobile-app-bar">
        <div className="mobile-app-bar__status-group">
          {config.showStatus && (
            <span className="mobile-app-bar__status" role="status" aria-live="polite">
              {statusLabel}
            </span>
          )}
          {canStop && (
            <button
              type="button"
              className="mobile-app-bar__stop"
              onClick={onStop}
              aria-label="Stop JARVIS"
            >
              <Icon name="stop" size={13} />
              <span>Stop</span>
            </button>
          )}
        </div>
        <div
          className={`mobile-app-bar__actions${config.showLabels ? " has-labels" : ""}`}
          role="group"
          aria-label="Quick controls"
        >
          {config.buttons.map((id) => (
            <button
              key={id}
              type="button"
              className={`mobile-app-bar__button mobile-app-bar__${id}`}
              ref={id === "menu" ? trigger : undefined}
              aria-label={
                id === "sound"
                  ? muted
                    ? "Unmute JARVIS"
                    : "Mute JARVIS"
                  : id === "menu"
                    ? "Open menu"
                    : TOP_BAR_ACTIONS[id].label
              }
              title={
                id === "sound"
                  ? muted
                    ? "Unmute JARVIS"
                    : "Mute JARVIS"
                  : TOP_BAR_ACTIONS[id].label
              }
              aria-pressed={id === "sound" ? Boolean(muted) : undefined}
              aria-haspopup={id === "menu" ? "dialog" : undefined}
              aria-expanded={id === "menu" ? open : undefined}
              onClick={id === "menu" ? () => setOpen(true) : handlers[id]}
            >
              <Icon
                name={id === "sound" && muted ? "mute" : TOP_BAR_ACTIONS[id].icon}
                size={20}
                strokeWidth={id === "menu" ? 2.6 : 1.5}
              />
              {config.showLabels && (
                <span>
                  {id === "sound" && muted ? "Muted" : shortLabels[id] || TOP_BAR_ACTIONS[id].label}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
      <Sheet
        open={open}
        title="Menu"
        onClose={closeMenu}
        className="mobile-tools-sheet"
        bodyRef={menuBody}
      >
        <button
          type="button"
          className="mobile-tools-item"
          onClick={() => {
            setOpen(false);
            onCustomize?.();
          }}
        >
          <Icon name="edit" size={20} />
          <span className="mobile-tools-item__text">Edit top bar</span>
          <Icon name="chevronRight" size={15} />
        </button>
        <nav className="mobile-tools-list" aria-label="Tools and preferences">
          {items.map(({ label, detail, icon, run, state }) => (
            <button
              type="button"
              key={label}
              className="mobile-tools-item"
              aria-label={label}
              data-gesture-safe="true"
              onClick={() => {
                setOpen(false);
                run?.();
              }}
            >
              <Icon name={icon} size={20} />
              <span className="mobile-tools-item__text">
                <span>{label}</span>
                {detail && <small>{detail}</small>}
              </span>
              {state && <span className="mobile-tools-item__state">{state}</span>}
              <Icon name="chevronRight" size={15} />
            </button>
          ))}
        </nav>
        <button
          type="button"
          className="mobile-tools-item mobile-tools-sound"
          role="switch"
          aria-label="Spoken replies"
          aria-checked={!muted}
          onClick={onMute}
        >
          <Icon name={muted ? "mute" : "volume"} size={20} />
          <span className="mobile-tools-item__text">
            <span>Spoken replies</span>
            <small>{muted ? "Text only" : "Replies play aloud"}</small>
          </span>
          <span className="mobile-tools-switch" aria-hidden="true" />
        </button>
      </Sheet>
    </>
  );
}
