import { Group } from "./Sheet";

export default function GestureControls({ controls }) {
  if (!controls) return null;
  const { status, busy, message, start, stop, supported } = controls;
  const active = status.running || status.starting;
  return (
    <Group title="Hand gestures · Preview">
      <div className="sp-field">
        <div className="sp-desc">
          Start a five-minute front-camera session. Hold a gesture briefly, then lower your hand
          before repeating it. Keep JARVIS open for voice controls.
        </div>
        <ul className="sp-desc">
          <li>Open palm: stop speaking.</li>
          <li>Peace sign: start listening when JARVIS is ready.</li>
          <li>Thumbs up: detection feedback only.</li>
          <li>Closed fist: stop the camera.</li>
        </ul>
        <p className="sp-desc">
          Recognition stays on your phone; no images are saved or uploaded. Voice input uses your
          existing speech service. Gestures never approve actions.
        </p>
        <div className="sp-row">
          <span className={status.running ? "sp-lamp sp-lamp--on" : "sp-lamp"}>
            {status.running ? "Camera on" : status.starting ? "Starting..." : "Camera off"}
          </span>
          <button
            type="button"
            className="sp-btn"
            disabled={busy || !supported}
            onClick={active ? stop : start}
          >
            {busy ? "Please wait..." : active ? "Stop camera" : "Start camera"}
          </button>
        </div>
        <p className="sp-desc" role="status">
          {supported ? message || status.summary : "Available in the Android app."}
        </p>
        <div className="sp-desc">
          Needs camera and display-over-apps permissions. The floating preview and notification both
          have Stop controls. Locking the screen or closing JARVIS ends the session.
        </div>
      </div>
    </Group>
  );
}
