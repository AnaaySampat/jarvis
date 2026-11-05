import { useEffect, useRef, useState } from "react";

export default function HeaderTools({ children, direct = false }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const trigger = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (event) => {
      if (!root.current?.contains(event.target)) setOpen(false);
    };
    const key = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", close);
    root.current?.addEventListener("keydown", key);
    const node = root.current;
    return () => {
      document.removeEventListener("pointerdown", close);
      node?.removeEventListener("keydown", key);
    };
  }, [open]);
  if (direct) return <div className="home-tools">{children}</div>;
  return (
    <div className="home-tools" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="home-tools-toggle"
        aria-expanded={open}
        aria-controls="header-actions"
        onClick={() => setOpen(!open)}
      >
        Menu
      </button>
      <div
        id="header-actions"
        className={`home-tools-content${open ? " is-open" : ""}`}
        onClick={(event) => {
          if (event.target.closest("button")) {
            setOpen(false);
            trigger.current?.focus();
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
