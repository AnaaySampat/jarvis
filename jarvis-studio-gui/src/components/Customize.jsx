// Customize.jsx — edit the home screen, as on the desktop (its components/Customize.jsx):
// its look (a theme preset, then colours, font, cards, centrepiece, gauges, corners,
// glow, background) and its layout (density, which cards show, and in what order).
// Sends partial screen-config patches; brain/mobile/screenConfig.ts checks and stores
// them, so JARVIS (the customize_screen tool) and the user edit the same state.
// The desktop drags cards between two columns; the phone has one, moved with arrows.

import { useState, useRef } from "react";
import Sheet from "./Sheet";
import Icon from "./Icon";
import { Switch, ConfirmButton, AddField } from "./controls";
import { IS_MOBILE } from "../hooks/useAssistant";
import { DEFAULT_LOOK, moveInColumn, THEMES } from "../brain/mobile/screenConfig";

const SWATCHES = [
  "cyan",
  "blue",
  "amber",
  "gold",
  "red",
  "green",
  "purple",
  "magenta",
  "pink",
  "orange",
  "white",
];

// The built-in presets (screenConfig.SCREEN_PRESETS): they keep your colours.
const BUILT_IN = [
  {
    id: "modern",
    label: "Modern",
    look: { font: "clean", corners: 14, glow: 40, cards: "clean", core: "orb", gauges: "bars" },
  },
  {
    id: "ironman",
    label: "Iron Man",
    look: { font: "hud", corners: 3, glow: 100, cards: "hud", core: "reactor", gauges: "rings" },
  },
];
const LOOK_KEYS = [
  "accent",
  "accent2",
  "background",
  "image",
  "font",
  "corners",
  "glow",
  "cards",
  "core",
  "gauges",
];

const CHOICES = [
  {
    key: "font",
    label: "Font",
    options: [
      ["clean", "Clean"],
      ["hud", "HUD"],
    ],
  },
  {
    key: "cards",
    label: "Cards",
    options: [
      ["clean", "Clean"],
      ["hud", "HUD"],
    ],
  },
  {
    key: "core",
    label: "Centrepiece",
    options: [
      ["orb", "Orb"],
      ["reactor", "Arc reactor"],
    ],
  },
  {
    key: "gauges",
    label: "Gauges",
    options: [
      ["bars", "Bars"],
      ["rings", "Rings"],
    ],
  },
];
const BACKGROUNDS = [
  { id: "grid", label: "Grid" },
  { id: "solid", label: "Glow" },
  { id: "aurora", label: "Aurora" },
  { id: "minimal", label: "Minimal" },
];
const DENSITIES = [
  ["normal", "Comfortable"],
  ["compact", "Compact"],
];
const PANEL_LABELS = IS_MOBILE
  ? {
      system: "Device",
      power: "Battery",
      agenda: "Agenda",
      weather: "Weather",
      network: "Network",
      terminal: "Action log",
    }
  : {
      system: "System",
      power: "Power",
      agenda: "Agenda",
      weather: "Weather",
      network: "Network",
      terminal: "Command log",
    };

function Seg({ label, value, options, onPick }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map(([id, text]) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          className={`seg-btn${value === id ? " is-on" : ""}`}
          onClick={() => onPick(id)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/* Sliders and colour pickers fire on every move: show the value at once and store
   it at most every 120 ms (the stored config can hold a background picture, too big
   to rewrite on every pixel of a drag). */
function useLivePatch(screen, onPatch) {
  const [draft, setDraft] = useState({});
  const pending = useRef(null);
  const set = (patch) => {
    setDraft((d) => ({ ...d, ...patch }));
    if (pending.current) {
      Object.assign(pending.current, patch);
      return;
    }
    pending.current = { ...patch };
    setTimeout(() => {
      const p = pending.current;
      pending.current = null;
      onPatch(p); // stored synchronously, so `screen` now has it
      setDraft({});
    }, 120);
  };
  return [{ ...DEFAULT_LOOK, ...(screen || {}), ...draft }, set];
}

/* A picture for the background, shrunk to a ≤1280px JPEG so it fits the phone's
   storage cap (screenConfig.ts). */
async function shrinkImage(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.82);
}

// ponytail: the desktop also saves a theme to a file to share; an Android WebView has
// no download path here, so the phone imports theme files but doesn't write them.
function saveThemeFile(preset) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify({ jarvis_theme: 1, ...preset }, null, 2)], {
      type: "application/json",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `${preset.name.replace(/[^\w -]+/g, "").trim() || "theme"}.jarvis-theme.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Customize({ screen, onClose, onPatch }) {
  const [s, live] = useLivePatch(screen, onPatch);
  const [error, setError] = useState("");
  const picture = useRef(null);
  const themeFile = useRef(null);
  const panels = s.panels || {};
  const accent = (s.accent || "#00e5ff").toLowerCase();
  const background = s.background || "grid";
  const saved = s.presets || [];
  const column = [
    ...(s.order?.left ?? ["system", "power", "agenda"]),
    ...(s.order?.right ?? ["weather", "network", "terminal"]),
  ];
  const isOn = (look) =>
    Object.keys(look).every((k) => k === "name" || k === "rgb" || s[k] === look[k]);

  const choosePicture = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      onPatch({ background: "image", image: await shrinkImage(file) });
      setError("");
    } catch {
      setError("That picture couldn't be opened — try a JPEG or PNG.");
    }
  };
  const importTheme = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const t = JSON.parse(await file.text());
      if (!t || typeof t !== "object" || !LOOK_KEYS.some((k) => k in t))
        throw new Error("not a theme");
      onPatch({
        import_preset: { ...t, name: t.name || file.name.replace(/(\.jarvis-theme)?\.json$/i, "") },
      });
      setError("");
    } catch {
      setError("That file isn't a JARVIS theme.");
    }
  };

  return (
    <Sheet
      open
      title="Customize"
      onClose={onClose}
      className="sp--cz"
      footer={
        <div className="cz-foot">
          <ConfirmButton
            confirmLabel="Reset everything?"
            onConfirm={() => onPatch({ reset: true })}
            title="Back to the default look and layout (your saved themes stay)"
          >
            Reset to defaults
          </ConfirmButton>
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Done
          </button>
        </div>
      }
    >
      <div className="cz-body">
        <p className="cz-note cz-lede">
          Changes apply live. You can also just tell JARVIS — “make the screen amber”, or “switch to
          Iron Man mode”.
        </p>

        <section className="cz-sec">
          <h3>Theme</h3>
          <p className="cz-note">
            Start from one, change anything below, then save it as your own.
          </p>
          <div className="cz-presets">
            {BUILT_IN.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`cz-preset${isOn(p.look) ? " is-on" : ""}`}
                onClick={() => onPatch({ style: p.id })}
              >
                {p.label}
              </button>
            ))}
            {saved.map((p) => (
              <span key={p.name} className={`cz-preset cz-preset--mine${isOn(p) ? " is-on" : ""}`}>
                <button
                  type="button"
                  className="cz-preset-name"
                  onClick={() => onPatch({ preset: p.name })}
                  style={{ "--sw": p.accent }}
                >
                  {p.name}
                </button>
                {!IS_MOBILE && (
                  <button
                    type="button"
                    className="cz-preset-act"
                    onClick={() => saveThemeFile(p)}
                    aria-label={`Save ${p.name} to a file`}
                  >
                    <Icon name="download" size={13} />
                  </button>
                )}
                <ConfirmButton
                  className="cz-preset-act"
                  confirmLabel="Delete?"
                  title={`Delete ${p.name}`}
                  onConfirm={() => onPatch({ delete_preset: p.name })}
                >
                  <Icon name="trash" size={13} />
                </ConfirmButton>
              </span>
            ))}
          </div>
          <div className="cz-preset-bar">
            <AddField
              placeholder="Name this look to save it"
              button="Save"
              mono={false}
              label="Theme name"
              onAdd={(name) => onPatch({ save_preset: name })}
            />
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => themeFile.current?.click()}
            >
              <Icon name="upload" size={14} />
              Import…
            </button>
            <input
              ref={themeFile}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={importTheme}
            />
          </div>
          {error && (
            <div className="cz-err" role="alert">
              {error}
            </div>
          )}
        </section>

        <section className="cz-sec">
          <h3>Colours</h3>
          <div className="cz-colors">
            <div className="cz-swatches" role="radiogroup" aria-label="Accent colour">
              {SWATCHES.map((name) => {
                const [a, a2] = THEMES[name];
                const on = accent === a;
                return (
                  <button
                    key={name}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={name}
                    className={`cz-swatch ${on ? "cz-swatch--on" : ""}`}
                    style={{ "--sw": a }}
                    onClick={() => onPatch({ accent: a, accent2: a2 })}
                  >
                    {on && <Icon name="check" size={14} strokeWidth={2.4} />}
                  </button>
                );
              })}
            </div>
            <span className="cz-picks">
              <label className="cz-pick">
                <input
                  type="color"
                  value={accent}
                  onChange={(e) => live({ accent: e.target.value })}
                />
                Main
              </label>
              <label className="cz-pick">
                <input
                  type="color"
                  value={(s.accent2 || "#6fe9ff").toLowerCase()}
                  onChange={(e) => live({ accent2: e.target.value })}
                />
                Second
              </label>
            </span>
          </div>
        </section>

        <section className="cz-sec">
          <h3>Look</h3>
          <div className="cz-look">
            {CHOICES.map((c) => (
              <div key={c.key} className="cz-look-row">
                <span className="cz-look-l">{c.label}</span>
                <Seg
                  label={c.label}
                  value={s[c.key]}
                  options={c.options}
                  onPick={(v) => onPatch({ [c.key]: v })}
                />
              </div>
            ))}
            {[
              ["corners", "Corners", 24, "px"],
              ["glow", "Glow", 100, "%"],
            ].map(([k, label, max, unit]) => (
              <label key={k} className="cz-look-row">
                <span className="cz-look-l">{label}</span>
                <input
                  type="range"
                  className="cz-range"
                  min={0}
                  max={max}
                  value={s[k] ?? 0}
                  onChange={(e) => live({ [k]: Number(e.target.value) })}
                />
                <span className="cz-look-v">
                  {s[k] ?? 0}
                  {unit}
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className="cz-sec">
          <h3>Background</h3>
          <div className="cz-bgs" role="radiogroup" aria-label="Background">
            {BACKGROUNDS.map((bg) => (
              <button
                key={bg.id}
                type="button"
                role="radio"
                aria-checked={background === bg.id}
                className={`cz-bg ${background === bg.id ? "is-on" : ""}`}
                onClick={() => onPatch({ background: bg.id })}
              >
                <span className={`cz-bg-prev cz-bg-prev--${bg.id}`} aria-hidden />
                <span className="cz-bg-l">{bg.label}</span>
              </button>
            ))}
            <button
              type="button"
              role="radio"
              aria-checked={background === "image"}
              className={`cz-bg ${background === "image" ? "is-on" : ""}`}
              onClick={() =>
                s.image ? onPatch({ background: "image" }) : picture.current?.click()
              }
            >
              <span
                className="cz-bg-prev cz-bg-prev--image"
                aria-hidden
                style={s.image ? { backgroundImage: `url("${s.image}")` } : undefined}
              >
                {!s.image && <Icon name="image" size={18} />}
              </span>
              <span className="cz-bg-l">Picture</span>
            </button>
          </div>
          {background === "image" && (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => picture.current?.click()}
            >
              <Icon name="image" size={13} />
              Choose another picture…
            </button>
          )}
          <input ref={picture} type="file" accept="image/*" hidden onChange={choosePicture} />
        </section>

        <section className="cz-sec">
          <h3>Density</h3>
          <Seg
            label="Density"
            value={s.density || "normal"}
            onPick={(v) => onPatch({ density: v })}
            options={DENSITIES}
          />
        </section>

        <section className="cz-sec">
          <h3>Cards</h3>
          <p className="cz-note">
            Show or hide each card, and move it up or down.
            {IS_MOBILE ? " The Status and Routines cards always stay at the top." : ""}
          </p>
          <div className="cz-railcol">
            {column.map((key, i) => {
              const visible = panels[key] !== false;
              const name = PANEL_LABELS[key] || key;
              const move = (delta) => onPatch({ order: moveInColumn(s.order, key, delta) });
              return (
                <div key={key} className={`cz-panel-row ${visible ? "" : "is-hidden"}`}>
                  <Switch
                    checked={visible}
                    label={`Show ${name}`}
                    onChange={(on) => onPatch({ panels: { [key]: on } })}
                  />
                  <span className="cz-panel-name">{name}</span>
                  <button
                    type="button"
                    className="cz-move"
                    disabled={i === 0}
                    aria-label={`Move ${name} up`}
                    onClick={() => move(-1)}
                  >
                    <Icon name="chevUp" size={17} />
                  </button>
                  <button
                    type="button"
                    className="cz-move"
                    disabled={i === column.length - 1}
                    aria-label={`Move ${name} down`}
                    onClick={() => move(1)}
                  >
                    <Icon name="chevDown" size={17} />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </Sheet>
  );
}
