// CommandPalette.jsx — the desktop's Ctrl+K box (the header's search button on a
// phone): one field that reaches every menu, setting page and quick action, and
// otherwise sends what you typed to JARVIS as a message. App builds the commands
// (it owns the state they change).

import { useState, useEffect, useRef, useMemo } from "react";
import Icon from "./Icon";
import { rankCommands } from "../utils/commandSearch";
import { useAndroidBack } from "../hooks/useAndroidBack";
import { IS_MOBILE } from "../hooks/useAssistant";

export default function CommandPalette({ commands, onClose, onAsk }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef(null);
  const q = query.trim();
  useAndroidBack(true, onClose);

  const results = useMemo(() => {
    const ranked = rankCommands(commands, q);
    return q
      ? [...ranked, { id: "__ask", label: `Ask JARVIS: “${q}”`, group: "Chat", icon: "send" }]
      : ranked;
  }, [commands, q]);

  // Keep the highlighted row on screen while arrowing through a long list.
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const run = (c) => {
    if (!c) return;
    onClose();
    if (c.id === "__ask") onAsk(q);
    else c.run();
  };

  const onKey = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(results[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <div className="cmdk-overlay" onMouseDown={onClose}>
      <div
        className="cmdk"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="cmdk-input">
          <Icon name="search" size={17} />
          <input
            autoFocus={!IS_MOBILE}
            value={query}
            placeholder={
              IS_MOBILE
                ? "Search menus and actions, or ask…"
                : "Search menus, settings and actions — or ask JARVIS…"
            }
            aria-label="Command"
            aria-controls="cmdk-list"
            spellCheck={false}
            enterKeyHint="go"
            aria-activedescendant={results[active] ? `cmdk-${results[active].id}` : undefined}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKey}
          />
          {IS_MOBILE ? (
            <button type="button" className="cmdk-x" onClick={onClose} aria-label="Close">
              <Icon name="close" size={17} />
            </button>
          ) : (
            <kbd>Esc</kbd>
          )}
        </div>
        <div className="cmdk-list" id="cmdk-list" role="listbox" ref={listRef}>
          {results.length === 0 && (
            <div className="cmdk-empty">Type to search, or to ask JARVIS anything.</div>
          )}
          {results.map((c, i) => {
            // Group headers only for the unfiltered list; a search is one ranked list.
            const header = !q && c.group !== results[i - 1]?.group ? c.group : null;
            return (
              <div key={c.id}>
                {header && <div className="cmdk-group">{header}</div>}
                <div
                  id={`cmdk-${c.id}`}
                  data-i={i}
                  role="option"
                  aria-selected={i === active}
                  className={`cmdk-item${i === active ? " is-on" : ""}${c.id === "__ask" ? " cmdk-item--ask" : ""}`}
                  onMouseMove={() => i !== active && setActive(i)}
                  onClick={() => run(c)}
                >
                  <span className="cmdk-ico">
                    <Icon name={c.icon || "chevRight"} size={16} />
                  </span>
                  <span className="cmdk-label">{c.label}</span>
                  {c.state && <span className="cmdk-state">{c.state}</span>}
                  {q && c.id !== "__ask" && <span className="cmdk-meta">{c.group}</span>}
                </div>
              </div>
            );
          })}
        </div>
        {!IS_MOBILE && (
          <div className="cmdk-foot">
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd> move
            </span>
            <span>
              <kbd>Enter</kbd> run
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
