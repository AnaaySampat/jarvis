// StateMessage — the one "nothing here yet" / "this broke" indicator.
//
// It already existed to stop scattered placeholders reading as ad-hoc one-offs, but
// four panels never adopted it and kept their own (sch-empty, term-dim, dirlist-empty,
// chatov-hist-empty) — so an empty schedule, an empty terminal and an empty task list
// each looked like a different app. They all route through here now.
//
// An empty state earns its space by saying what goes there and how it gets there, so
// `title` carries the state and the children carry the "do this next".
import Icon from "./Icon";

export default function StateMessage({ variant = "empty", icon, title, children }) {
  const name = icon ?? (variant === "error" ? "alert" : "info");
  return (
    <div className={`state-msg state-msg--${variant}`}>
      <span className="state-msg-ico">
        <Icon name={name} size={16} />
      </span>
      <span className="state-msg-text">
        {title && <span className="state-msg-title">{title}</span>}
        {children}
      </span>
    </div>
  );
}
