// ModalPanel.jsx — the scrim + panel + header shell shared by Settings, Customize,
// MobileRemotePC, and AgentActivity (identical DOM/class structure, only the
// title/content — and optionally an extra header action — differ).
export default function ModalPanel({ title, onClose, className = "", actions, children }) {
  return (
    <div className="settings-overlay" onClick={onClose}>
      <div
        className={className ? `settings-panel ${className}` : "settings-panel"}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-hdr">
          <h2>{title}</h2>
          <div className="settings-hdr-ctrls">
            {actions}
            <button className="settings-x" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
