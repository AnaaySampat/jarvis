// controls.jsx — the desktop's small menu building blocks (its components/controls.jsx,
// styles in ui.css) that the ported menus use: a Switch, a two-tap ConfirmButton for
// anything destructive, and a text field with an action button.

import { useState } from "react";

export function Switch({ checked, onChange, label, disabled }) {
  return (
    <input
      type="checkbox"
      role="switch"
      className="sw"
      checked={!!checked}
      disabled={disabled}
      aria-label={label}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

/** The first tap arms, the second acts; moving focus away disarms. */
export function ConfirmButton({
  children,
  confirmLabel = "Confirm",
  onConfirm,
  title,
  className = "btn btn--danger btn--sm",
}) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      type="button"
      className={`${className}${armed ? " is-armed" : ""}`}
      title={title}
      aria-label={typeof children === "string" ? undefined : title}
      onClick={(e) => {
        e.preventDefault(); // inside a <label>/<summary>: don't toggle it
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
      onBlur={() => setArmed(false)}
    >
      {armed ? confirmLabel : children}
    </button>
  );
}

/** A text field with an action button; Enter submits. Clears itself after onAdd. */
export function AddField({ placeholder, button = "Add", onAdd, mono = true, label }) {
  const [text, setText] = useState("");
  const submit = (e) => {
    e.preventDefault();
    const v = text.trim();
    if (!v) return;
    onAdd(v);
    setText("");
  };
  return (
    <form className="field-row" onSubmit={submit}>
      <input
        type="text"
        className={`field${mono ? " field--mono" : ""}`}
        value={text}
        placeholder={placeholder}
        aria-label={label || placeholder}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
      />
      <button type="submit" className="btn" disabled={!text.trim()}>
        {button}
      </button>
    </form>
  );
}
