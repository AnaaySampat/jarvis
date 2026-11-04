import { Group } from "./Sheet";
export default function GestureControls({ controls, onOpen }) {
  if (!controls) return null;
  return <Group><button type="button" className="sp-btn" onClick={onOpen}>Open Hands-free activities and gesture setup</button>
    <p className="sp-desc">Read text and follow steps with the camera off. Learn poses safely, or tune recognition in Hands-free.</p></Group>;
}
