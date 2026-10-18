// ModalPanel.jsx — the scrim + panel + header shell shared by AgentActivity (Tasks),
// the desktop's Customize, and the QR scanner's loading state. On the phone it is a
// Sheet, so Tasks reads like Settings and the dock's menus instead of a floating box.
import { useEffect } from "react";
import Icon from "./Icon";
import Sheet from "./Sheet";
import { IS_MOBILE } from "../hooks/useAssistant";
import { useAndroidBack } from "../hooks/useAndroidBack";

export default function ModalPanel(props) {
  if (IS_MOBILE) {
    // className sizes the floating box (e.g. .activity-panel's fixed width), so it
    // stays off the full-screen sheet.
    const { title, onClose, actions, children } = props;
    return (
      <Sheet open title={title} onClose={onClose ?? (() => {})} actions={actions}>
        <div className="sp-sheet">{children}</div>
      </Sheet>
    );
  }
  return <FloatingPanel {...props} />;
}

function FloatingPanel({ title, onClose, className = "", actions, children }) {
  // Back and Escape close it, as they do every Sheet.
  useAndroidBack(Boolean(onClose), () => onClose?.());
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div
        className={className ? `settings-panel ${className}` : "settings-panel"}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-hdr">
          <h2>{title}</h2>
          <div className="settings-hdr-ctrls">
            {actions}
            <button className="settings-x" onClick={onClose} aria-label="Close">
              <Icon name="close" size={18} />
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
