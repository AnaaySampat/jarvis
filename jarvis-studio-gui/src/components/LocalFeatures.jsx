import "./local-features.css";

export default function LocalFeatures({ onConnect, connected }) {
  return (
    <div className="local-features" role="status">
      <span>
        {connected
          ? "Local features are available. AI features need a provider key."
          : "Backend disconnected. Reading, steps and local camera practice are available."}
      </span>
      <button type="button" onClick={onConnect}>
        Open Settings
      </button>
    </div>
  );
}
