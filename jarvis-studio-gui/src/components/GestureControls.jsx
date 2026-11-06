import { Group } from "./Sheet";
export default function GestureControls({ controls, onOpen }) {
  if (!controls) return null;
  return <Group>
    <p className="sp-desc">Read text, follow steps, learn gestures and calibrate your own poses in Activities. Activity content and gesture preferences save automatically.</p>
    {onOpen && <button type="button" className="sp-btn" onClick={onOpen}>Open activities</button>}
    <p className="sp-desc">Android needs camera and display-over-other-apps permissions.
      The floating preview and notification both have a Stop button. Camera snapshots use
      the analysis frame resolution. Open the PC live view and arm control before using PC actions.</p>
  </Group>;
}
