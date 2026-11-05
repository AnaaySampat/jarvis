import { Icon } from "./GestureIcon";
import GestureGlyph from "./GestureGlyph";
import { actionLabel, poseLabel } from "./presentation";

export default function GestureGuide({ controls, target, onPractice, onMap, onTeach, onTune }) {
  const cfg = controls.config;
  const phone = controls.platform === "android";
  return (
    <section className="gesture-guide" aria-label="Gesture setup guide">
      <div className="gesture-section-title">
        <div>
          <span className="gesture-kicker">START HERE</span>
          <h4>A pose is the signal. You choose the action.</h4>
        </div>
      </div>
      <p className="gesture-muted">
        Use the built-in hand shapes straight away. Calibration is only needed when you want to
        teach JARVIS a different hand shape.
      </p>
      <ol className="gesture-guide-steps">
        <li>
          <span className="gesture-guide-number">1</span>
          <div>
            <h5>Put {phone ? "your phone" : "the camera"} where it can see you</h5>
            <p>
              {phone
                ? "Rest your phone upright on a stand and face its front camera. "
                : "Face your webcam. "}
              Start about an arm’s length away. Show one whole hand, including your wrist, with
              light falling on your fingers. Keep JARVIS open and the screen unlocked.
            </p>
          </div>
        </li>
        <li>
          <span className="gesture-guide-number">2</span>
          <div>
            <h5>Learn the movement before running anything</h5>
            <p>
              Start practice, lower your hand to get ready, then copy the pictured pose. Hold for
              {(cfg.holdMs / 1000).toFixed(1)} seconds until the progress fills. Lower your hand out
              of view for at least {(cfg.releaseMs / 1000).toFixed(1)} seconds before the next try.
              Practice keeps commands off.
            </p>
            <button type="button" onClick={onPractice}>
              Practice {poseLabel(target, cfg).toLowerCase()} <Icon name="arrowRight" size={15} />
            </button>
          </div>
        </li>
        <li>
          <span className="gesture-guide-number">3</span>
          <div>
            <h5>Choose what the gesture does</h5>
            <p>
              Each activity has its own actions. For example, an open palm can pause music in Music
              and read a page in Read. Use Change on a gesture card, choose an action, and Save
              action. Closed fist is always reserved for stopping the camera.
            </p>
            <div className="gesture-guide-mapping">
              <GestureGlyph pose={target} size={46} />
              <span>{poseLabel(target, cfg)}</span>
              <Icon name="arrowRight" size={16} />
              <strong>{actionLabel(cfg.bindings[cfg.mode][target] || "none")}</strong>
            </div>
            <button type="button" onClick={onMap}>
              Choose this gesture’s action <Icon name="edit" size={15} />
            </button>
          </div>
        </li>
        <li>
          <span className="gesture-guide-number">4</span>
          <div>
            <h5>Try a real control</h5>
            <p>
              Return to Control and use a touch button to check the action first. Then start or
              resume gestures and make the same pose. The result appears under the camera and in
              Recent actions. Hold peace to talk and lower your hand to send when using Voice.
            </p>
            {phone && (
              <p>
                Phone controls sound, flashlight and brightness without a PC. Music controls a
                player you have already started. Keep JARVIS visible; hand commands pause when you
                switch to another app. Brightness may ask for Android’s “Modify system settings”
                permission. Return here after allowing it and try again.
              </p>
            )}
          </div>
        </li>
      </ol>
      <section className="gesture-guide-custom" aria-label="How to calibrate a custom gesture">
        <Icon name="hand" size={23} />
        <div>
          <h5>Want to use your own hand shape?</h5>
          <p>
            Open My gestures, name the pose and choose its action. Start the camera for setup, then
            tap Capture my pose. You have three seconds to get ready. Hold a distinct shape still
            while eight clear frames are collected. Test the saved pose in practice before enabling
            actions. Avoid a closed fist or a shape you have already saved.
          </p>
          <button type="button" onClick={onTeach}>
            Set up my own gesture <Icon name="arrowRight" size={15} />
          </button>
        </div>
      </section>
      <details className="gesture-source">
        <summary>Not recognizing your hand, or triggering too easily?</summary>
        <p className="gesture-muted">
          Move back if fingers are cropped, move closer if your hand looks small, and avoid
          backlighting. Lower your hand completely between commands. Try Balanced response first;
          Deliberate needs a steadier, longer hold. Pointing swipes need your whole hand to move,
          rather than just bending a finger.
        </p>
        <button type="button" onClick={onTune}>
          Adjust response <Icon name="settings" size={15} />
        </button>
      </details>
      <p className="gesture-muted gesture-guide-stop">
        <Icon name="stop" size={16} /> Stop camera is always available. A closed fist held for at
        least 0.8 seconds also stops it. Sessions end after five minutes.
      </p>
    </section>
  );
}
