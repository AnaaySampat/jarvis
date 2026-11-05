import Icon from "./Icon";

/** Direct access on phones: every action stays in the same scrollable row. */
export default function MobileQuickControls({
  muted,
  onMute,
  onSettings,
  onGestures,
  onDevices,
  onTasks,
  onCustomize,
  onPhone,
  onSearch,
  taskActive,
  cameraActive,
}) {
  const actions = [
    { label: "Settings", icon: "settings", run: onSettings },
    { label: "Gestures", icon: "hand", run: onGestures, active: cameraActive },
    { label: "Devices", icon: "monitor", run: onDevices },
    { label: "Tasks", icon: "activity", run: onTasks, active: taskActive },
    {
      label: muted ? "Unmute" : "Sound",
      name: muted ? "Unmute JARVIS" : "Mute JARVIS (text only)",
      icon: muted ? "mute" : "volume",
      run: onMute,
      pressed: muted,
    },
    { label: "Look", name: "Customize the home screen", icon: "palette", run: onCustomize },
    { label: "Phone", name: "Device controls", icon: "power", run: onPhone },
    { label: "Search", name: "Command palette", icon: "search", run: onSearch },
  ];
  return (
    <nav className="mobile-quick-controls" aria-label="Quick controls">
      {actions.map(({ label, name, icon, run, active, pressed }) => (
        <button
          key={name || label}
          type="button"
          className={active ? "is-active" : undefined}
          aria-label={name || label}
          aria-pressed={pressed}
          data-gesture-safe="true"
          onClick={run}
        >
          <Icon name={icon} size={19} />
          <span>{label}</span>
          {active && <i aria-hidden="true" />}
        </button>
      ))}
    </nav>
  );
}
