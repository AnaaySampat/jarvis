import Icon from "./Icon";
import { Switch } from "./controls";
import { cleanTopBar, TOP_BAR_ACTIONS } from "../brain/mobile/topBarConfig";
import "./mobile-app-bar.css";

export default function TopBarEditor({ value, onChange, onReplayIntro, showHeading = true }) {
  const config = cleanTopBar(value);
  const { buttons } = config;
  const patch = (update) => onChange({ ...config, ...update });
  const protectedButton = (id) =>
    ["settings", "menu"].includes(id) &&
    buttons.filter((item) => ["settings", "menu"].includes(item)).length === 1;
  const move = (index, delta) => {
    const next = [...buttons];
    const destination = index + delta;
    if (destination < 0 || destination >= next.length) return;
    [next[index], next[destination]] = [next[destination], next[index]];
    patch({ buttons: next });
  };
  return (
    <section className="cz-sec top-bar-editor" aria-label="Edit top bar">
      {showHeading && <h3>Shortcut bar</h3>}
      <p className="cz-note">
        Add as many shortcuts as you like, in any order. Swipe the bar when they don&apos;t all fit.
      </p>
      <div className="top-bar-preview" role="img" aria-label="Top bar preview">
        <span>{config.showStatus ? "Ready" : ""}</span>
        <div>
          {buttons.map((id) => (
            <span key={id} className="top-bar-preview__button">
              <Icon name={TOP_BAR_ACTIONS[id].icon} size={19} />
              {config.showLabels && <small>{TOP_BAR_ACTIONS[id].label}</small>}
            </span>
          ))}
        </div>
      </div>
      <label className="top-bar-editor__option">
        <span>Show assistant status</span>
        <Switch
          label="Show assistant status"
          checked={config.showStatus}
          onChange={(showStatus) => patch({ showStatus })}
        />
      </label>
      <label className="top-bar-editor__option">
        <span>Show button labels</span>
        <Switch
          label="Show button labels"
          checked={config.showLabels}
          onChange={(showLabels) => patch({ showLabels })}
        />
      </label>
      <ol className="top-bar-editor__selected" aria-label="Top bar button order">
        {buttons.map((id, index) => (
          <li key={id}>
            <Icon name={TOP_BAR_ACTIONS[id].icon} size={18} />
            <span>
              {TOP_BAR_ACTIONS[id].label}
              <small>{TOP_BAR_ACTIONS[id].description}</small>
            </span>
            <button
              type="button"
              className="cz-move"
              disabled={index === 0}
              aria-label={`Move ${TOP_BAR_ACTIONS[id].label} left`}
              onClick={() => move(index, -1)}
            >
              <Icon name="chevronLeft" size={17} />
            </button>
            <button
              type="button"
              className="cz-move"
              disabled={index === buttons.length - 1}
              aria-label={`Move ${TOP_BAR_ACTIONS[id].label} right`}
              onClick={() => move(index, 1)}
            >
              <Icon name="chevronRight" size={17} />
            </button>
            <button
              type="button"
              className="cz-move"
              disabled={protectedButton(id)}
              aria-label={`Remove ${TOP_BAR_ACTIONS[id].label}`}
              onClick={() => patch({ buttons: buttons.filter((item) => item !== id) })}
            >
              <Icon name="close" size={17} />
            </button>
          </li>
        ))}
      </ol>
      <div className="top-bar-editor__available" role="group" aria-label="Add top bar button">
        {Object.entries(TOP_BAR_ACTIONS)
          .filter(([id]) => !buttons.includes(id))
          .map(([id, item]) => (
            <button
              type="button"
              key={id}
              className="btn btn--ghost btn--sm"
              onClick={() => patch({ buttons: [...buttons, id] })}
              title={item.description}
              aria-label={item.label}
            >
              <Icon name="plus" size={14} />
              <span>{item.label}<small>{item.description}</small></span>
            </button>
          ))}
      </div>
      <p className="cz-note">
        Keep Settings or Menu so you can edit the bar later. Stop stays available while JARVIS is
        working or speaking.
      </p>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={() => onChange(cleanTopBar(undefined))}
      >
        Reset top bar
      </button>
      {onReplayIntro && (
        <button type="button" className="btn btn--ghost btn--sm" onClick={onReplayIntro}>
          Replay introduction
        </button>
      )}
    </section>
  );
}
