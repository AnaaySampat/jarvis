// Customize.jsx — edit the home-screen HUD (accent, background, density, which
// panels show, and their order). Sends partial screen-config patches; the backend
// persists them and broadcasts the full new config back, so JARVIS and the user
// edit the same live state. Mirrors the named themes in actions/__init__.py.

import ModalPanel from "./ModalPanel";

const THEMES = {
  cyan: ["#00e5ff", "#6fe9ff", [0, 229, 255]],
  blue: ["#3b82f6", "#93c5fd", [59, 130, 246]],
  amber: ["#ffb648", "#ffd591", [255, 182, 72]],
  gold: ["#ffd24a", "#ffe89a", [255, 210, 74]],
  red: ["#ff4d57", "#ff9197", [255, 77, 87]],
  green: ["#22e39a", "#8bf0cb", [34, 227, 154]],
  purple: ["#a872ff", "#cdaaff", [168, 114, 255]],
  magenta: ["#ff5cf0", "#ffa9f6", [255, 92, 240]],
  pink: ["#ff77c8", "#ffb3e0", [255, 119, 200]],
  orange: ["#ff8a3d", "#ffbb85", [255, 138, 61]],
  white: ["#e8f4ff", "#ffffff", [232, 244, 255]],
};

const BACKGROUNDS = ["grid", "solid", "aurora", "minimal"];
const PANEL_LABELS = {
  system: "System",
  power: "Power",
  agenda: "Agenda",
  weather: "Weather",
  network: "Network",
  terminal: "Terminal",
};

export default function Customize({ screen, onClose, onPatch }) {
  const s = screen || {};
  const panels = s.panels || {};
  const order = s.order || {
    left: ["system", "power", "agenda"],
    right: ["weather", "network", "terminal"],
  };
  const accent = (s.accent || "#00e5ff").toLowerCase();
  const background = s.background || "grid";
  const density = s.density || "normal";

  return (
    <ModalPanel title="Customize Display" onClose={onClose}>
      {/* Accent colour */}
      <div className="settings-sec">
        <label>Accent colour</label>
        <div className="cz-swatches">
          {Object.entries(THEMES).map(([name, [a, a2, rgb]]) => (
            <button
              key={name}
              className={`cz-swatch ${accent === a.toLowerCase() ? "cz-swatch--on" : ""}`}
              style={{ background: a }}
              title={name}
              onClick={() => onPatch({ accent: a, accent2: a2, rgb })}
            />
          ))}
        </div>
      </div>

      {/* Background */}
      <div className="settings-sec">
        <label>Background</label>
        <div className="cz-row">
          {BACKGROUNDS.map((bg) => (
            <button
              key={bg}
              className={`cz-chip ${background === bg ? "cz-chip--on" : ""}`}
              onClick={() => onPatch({ background: bg })}
            >
              {bg}
            </button>
          ))}
        </div>
      </div>

      {/* Density */}
      <div className="settings-sec">
        <label>Density</label>
        <div className="cz-row">
          {["normal", "compact"].map((d) => (
            <button
              key={d}
              className={`cz-chip ${density === d ? "cz-chip--on" : ""}`}
              onClick={() => onPatch({ density: d })}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      {/* Panels: show/hide + reorder within each rail, move across rails */}
      <div className="settings-sec">
        <label>Panels & layout</label>
        {["left", "right"].map((rail) => (
          <div key={rail} className="cz-rail">
            <div className="cz-rail-hd">{rail === "left" ? "Left rail" : "Right rail"}</div>
            {(order[rail] || []).map((key, i) => {
              const visible = panels[key] !== false;
              const arr = order[rail] || [];
              return (
                <div key={key} className="cz-panel-row">
                  <button
                    className={`cz-eye ${visible ? "cz-eye--on" : ""}`}
                    title={visible ? "Hide" : "Show"}
                    onClick={() => onPatch({ panels: { [key]: !visible } })}
                  >
                    {visible ? "👁" : "🚫"}
                  </button>
                  <span className="cz-panel-name">{PANEL_LABELS[key] || key}</span>
                  <span className="cz-panel-ctrls">
                    <button
                      disabled={i === 0}
                      onClick={() => onPatch({ move: { panel: key, direction: "up" } })}
                    >
                      ▲
                    </button>
                    <button
                      disabled={i === arr.length - 1}
                      onClick={() => onPatch({ move: { panel: key, direction: "down" } })}
                    >
                      ▼
                    </button>
                    <button
                      title="Move to other rail"
                      onClick={() =>
                        onPatch({
                          move: { panel: key, direction: rail === "left" ? "right" : "left" },
                        })
                      }
                    >
                      {rail === "left" ? "→" : "←"}
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="settings-sec cz-actions">
        <button className="cz-reset" onClick={() => onPatch({ reset: true })}>
          Reset to defaults
        </button>
        <span className="cz-hint">
          Tip: you can also just tell JARVIS — “make the screen amber”, “hide the weather panel”.
        </span>
      </div>
    </ModalPanel>
  );
}
