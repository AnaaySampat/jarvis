// Sheet.jsx — the shell and building blocks shared by Settings and the HUD's menus
// (Conversation, Capabilities, Device, Skills). Full-screen on a phone, a floating
// panel on a wide screen. Portalled to <body>: the HUD's own overlays lived inside
// the scaled HUD tree, and on the phone their panels came out see-through.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "./Icon";
import { useAndroidBack } from "../hooks/useAndroidBack";

export const WIDE_QUERY = "(min-width: 760px)";

/**
 * @param {{open: boolean, title: string, onClose: () => void, onBack?: () => void,
 *   backLabel?: string, actions?: any, footer?: any, className?: string,
 *   bodyRef?: any, children?: any}} props
 * `onBack` replaces the title with a back button (a sub-view inside the sheet);
 * Android's back button follows it too, then closes the sheet.
 */
export default function Sheet({
  open,
  title,
  onClose,
  onBack,
  backLabel,
  actions,
  footer,
  className = "",
  bodyRef,
  children,
}) {
  // ponytail: read once per mount; resizing across the breakpoint keeps the first layout.
  const [wide] = useState(() => window.matchMedia?.(WIDE_QUERY).matches ?? false);
  useAndroidBack(open, () => (onBack ? onBack() : onClose()));
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && (onBack ? onBack() : onClose());
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onBack, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="settings-overlay" onClick={onClose}>
      <div
        className={`sp ${wide ? "sp--float" : ""} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sp-hdr">
          {onBack ? (
            <button type="button" className="sp-back" onClick={onBack}>
              <Icon name="chevronLeft" size={18} />
              <span>{backLabel || title}</span>
            </button>
          ) : (
            <h2 className="sp-title">{title}</h2>
          )}
          <div className="sp-hdr-actions">
            {actions}
            <button type="button" className="sp-close" onClick={onClose} aria-label="Close">
              <Icon name="close" size={18} />
            </button>
          </div>
        </header>
        <div className="sp-body" ref={bodyRef}>
          {children}
        </div>
        {footer && <footer className="sp-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

/** An icon-only header button. The label is for screen readers and the tooltip. */
export function HeaderButton({ icon, label, onClick, pressed }) {
  return (
    <button
      type="button"
      className={`sp-close ${pressed ? "is-on" : ""}`}
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
    >
      <Icon name={icon} size={18} />
    </button>
  );
}

/** A labelled control. The hint is one plain sentence; longer text goes in <More>. */
export function Field({ label, hint, children }) {
  return (
    <div className="sp-field">
      {label && <div className="sp-label">{label}</div>}
      {children}
      {hint && <div className="sp-desc">{hint}</div>}
    </div>
  );
}

/** A setting that is either on or off — a switch, not a checkbox. */
export function Toggle({ label, hint, checked, onChange }) {
  return (
    <label className="sp-field sp-toggle">
      <span className="sp-toggle-text">
        <span className="sp-label">{label}</span>
        {hint && <span className="sp-desc">{hint}</span>}
      </span>
      <input
        type="checkbox"
        role="switch"
        className="sp-switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

/** One grouped well of fields, separated by hairlines. */
export function Group({ title, children }) {
  return (
    <section className="sp-group">
      {title && <h3 className="sp-group-title">{title}</h3>}
      <div className="sp-well">{children}</div>
    </section>
  );
}

/** The long "why" behind a setting, folded away until asked for. */
export function More({ children, label = "How this works" }) {
  return (
    <details className="sp-more">
      <summary>{label}</summary>
      <div className="sp-desc">{children}</div>
    </details>
  );
}

export function Warn({ children }) {
  return (
    <div className="sp-warn" role="note">
      <Icon name="alert" size={15} />
      <span>{children}</span>
    </div>
  );
}

/**
 * A tappable row inside a Group: icon, title, one-line description, and on the right
 * either a live readout (with a status lamp) or a trailing icon. `leaves` marks a
 * row that opens something outside JARVIS (an Android settings screen).
 */
export function ActionRow({ icon, title, desc, readout, tone, leaves, danger, onClick, disabled }) {
  return (
    <button
      type="button"
      className={`sp-field sp-action ${danger ? "sp-action--danger" : ""}`}
      onClick={onClick}
      disabled={disabled}
    >
      {icon && <Icon name={icon} size={20} className="sp-action-ico" />}
      <span className="sp-action-text">
        <span className="sp-label">{title}</span>
        {desc && <span className="sp-desc">{desc}</span>}
      </span>
      {readout && (
        <span className={`sp-readout ${tone ? `sp-readout--${tone}` : ""}`}>{readout}</span>
      )}
      {leaves && <Icon name="external" size={16} className="sp-action-trail" />}
    </button>
  );
}
