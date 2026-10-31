import { Group } from "./Sheet";
import GesturePanel from "../gestures/GesturePanel";
import { listRoutines } from "../brain/schedule/routines";
export default function GestureControls({ controls }) {
  if (!controls) return null;
  return <Group>
    <GesturePanel controls={controls} routines={listRoutines()} />
    <p className="sp-desc">Android needs camera and display-over-other-apps permissions.
      The floating preview and notification both have a Stop button. Camera snapshots use
      the analysis frame resolution. Open the PC live view and arm control before using PC actions.</p>
  </Group>;
}
