import "./local-features.css";

export default function LocalFeatures({ onConnect, connected, onOpenActivity }) {
  return (
    <div className="local-features" role="status">
      <span>
        {connected
          ? "Local features are available. AI features need a provider key."
          : "Backend disconnected. Reading, steps and local camera practice are available."}
      </span>
      <div className="local-feature-actions">
        <button type="button" onClick={() => onOpenActivity("reading")}>Read text</button>
        <button type="button" onClick={() => onOpenActivity("cooking")}>Follow steps</button>
        <button type="button" onClick={onConnect}>Set up AI</button>
      </div>
    </div>
  );
}
