import { useEffect, useRef, useState } from "react";
import { ACTIONS } from "./engine";
import { Icon } from "./GestureIcon";
import { actionLabel, poseLabel, relevantActions } from "./presentation";

export default function GestureActionEditor({ pose, controls, onClose, resume }) {
  const cfg = controls.config;
  const [draft, setDraft] = useState(cfg.bindings[cfg.mode][pose] || "none");
  const [more, setMore] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef(null);
  useEffect(() => {
    root.current?.focus();
  }, []);
  const actions = [...new Set([cfg.bindings[cfg.mode][pose], ...relevantActions(cfg.mode)])].filter(
    Boolean,
  );
  const close = () => {
    onClose();
    if (resume) controls.setPaused(false);
  };
  const save = () => {
    controls.changeConfig((current) => ({
      bindings: {
        ...current.bindings,
        [current.mode]: { ...current.bindings[current.mode], [pose]: draft },
      },
    }));
    close();
  };
  return (
    <section
      className="gesture-editor"
      aria-label={`Change action for ${poseLabel(pose, cfg)}`}
      tabIndex={-1}
      ref={root}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
      }}
    >
      <div className="gesture-section-title">
        <div>
          <h4>{poseLabel(pose, cfg)}</h4>
        </div>
        <button type="button" aria-label="Cancel editing" onClick={close}>
          <Icon name="close" />
        </button>
      </div>
      <div className="gesture-action-options" role="group" aria-label="Suggested actions">
        {actions.map((action) => (
          <button
            type="button"
            key={action}
            aria-pressed={draft === action}
            onClick={() => setDraft(action)}
          >
            {actionLabel(action)}
            {draft === action && <Icon name="check" size={15} />}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="gesture-link"
        aria-expanded={more}
        onClick={() => setMore(!more)}
      >
        More actions
        <Icon name={more ? "chevUp" : "chevDown"} size={14} />
      </button>
      {more && (
        <div className="gesture-other-actions">
          <input
            autoFocus
            type="search"
            aria-label="Search actions"
            placeholder="Find an action…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="gesture-action-options">
            {Object.keys(ACTIONS)
              .filter(
                (action) =>
                  !actions.includes(action) &&
                  ACTIONS[action].toLowerCase().includes(query.toLowerCase()),
              )
              .map((action) => (
                <button
                  key={action}
                  type="button"
                  aria-pressed={draft === action}
                  onClick={() => setDraft(action)}
                >
                  {ACTIONS[action]}
                </button>
              ))}
          </div>
        </div>
      )}
      <div className="gesture-editor__footer">
        <button type="button" onClick={close}>
          Cancel
        </button>
        <button type="button" className="gesture-primary" onClick={save}>
          Save action
          <Icon name="check" size={16} />
        </button>
      </div>
    </section>
  );
}
