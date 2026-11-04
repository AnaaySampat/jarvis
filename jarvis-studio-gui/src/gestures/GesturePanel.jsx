import { useEffect, useRef, useState } from "react";
import { Icon } from "./GestureIcon";
import { ConfirmButton } from "../components/controls";
import { ACTIONS, POSES, defaults } from "./engine";
import { documentId } from "./storage";
import {
  ACTIVITIES,
  MAIN_ACTIVITIES,
  POSE_HELP,
  RESPONSE_PRESETS,
  actionLabel,
  poseLabel,
  relevantActions,
} from "./presentation";
import GestureGlyph from "./GestureGlyph";
import { ActivityContent, CameraView, SessionFeedback } from "./GestureSessionViews";
import "./gestures.css";

function ActionEditor({ pose, controls, onClose, resume }) {
  const cfg = controls.config;
  const [draft, setDraft] = useState(cfg.bindings[cfg.mode][pose] || "none");
  const [more, setMore] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef(null);
  useEffect(() => {
    root.current?.focus();
  }, []);
  const actions = [...new Set([cfg.bindings[cfg.mode][pose], ...relevantActions(cfg.mode)])].filter(
    Boolean,
  );
  const close = () => {
    onClose();
    if (resume) controls.setPaused(false);
  };
  const save = () => {
    controls.changeConfig((current) => ({
      bindings: {
        ...current.bindings,
        [current.mode]: { ...current.bindings[current.mode], [pose]: draft },
      },
    }));
    close();
  };
  return (
    <section
      className="gesture-editor"
      aria-label={`Change action for ${poseLabel(pose, cfg)}`}
      tabIndex={-1}
      ref={root}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
      }}
    >
      <div className="gesture-section-title">
        <div>
          <span className="gesture-kicker">MAKE IT YOURS</span>
          <h4>What should {poseLabel(pose, cfg).toLowerCase()} do?</h4>
        </div>
        <button type="button" aria-label="Cancel editing" onClick={close}>
          <Icon name="close" />
        </button>
      </div>
      <p className="gesture-muted">
        {resume
          ? "Gestures are paused while you edit. Saving will resume them."
          : "This changes only your current activity."}
      </p>
      <div className="gesture-action-options" role="group" aria-label="Suggested actions">
        {actions.map((action) => (
          <button
            type="button"
            key={action}
            aria-pressed={draft === action}
            onClick={() => setDraft(action)}
          >
            {actionLabel(action)}
            {draft === action && <Icon name="check" size={15} />}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="gesture-link"
        aria-expanded={more}
        onClick={() => setMore(!more)}
      >
        More actions
        <Icon name={more ? "chevUp" : "chevDown"} size={14} />
      </button>
      {more && (
        <div className="gesture-other-actions">
          <input
            autoFocus
            type="search"
            aria-label="Search actions"
            placeholder="Find an action…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="gesture-action-options">
            {Object.keys(ACTIONS)
              .filter(
                (action) =>
                  !actions.includes(action) &&
                  ACTIONS[action].toLowerCase().includes(query.toLowerCase()),
              )
              .map((action) => (
                <button
                  key={action}
                  type="button"
                  aria-pressed={draft === action}
                  onClick={() => setDraft(action)}
                >
                  {ACTIONS[action]}
                </button>
              ))}
          </div>
        </div>
      )}
      <div className="gesture-editor__footer">
        <button type="button" onClick={close}>
          Cancel
        </button>
        <button type="button" className="gesture-primary" onClick={save}>
          Save action
          <Icon name="check" size={16} />
        </button>
      </div>
    </section>
  );
}

export default function GesturePanel({ controls, routines = [] }) {
  const cfg = controls.config;
  const active = controls.status.running || controls.status.starting;
  const [tab, setTab] = useState(controls.practice ? "learn" : "control");
  const [moreActivities, setMoreActivities] = useState(!MAIN_ACTIVITIES.includes(cfg.mode));
  const [moreGestures, setMoreGestures] = useState(false);
  const [focusActivities, setFocusActivities] = useState(false);
  const [editing, setEditing] = useState(null);
  const [poseName, setPoseName] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const tuneResume = useRef(false);
  const names = [...POSES, ...cfg.customPoses.map((p) => p.id)];
  const assigned = names.filter(
    (p) => cfg.bindings[cfg.mode][p] && !["none", "feedback"].includes(cfg.bindings[cfg.mode][p]),
  );
  const practiceChoices = [
    ...new Set([
      ...assigned,
      ...(controls.practiceTarget && names.includes(controls.practiceTarget)
        ? [controls.practiceTarget]
        : []),
      ...(cfg.mode === "custom" ? cfg.customPoses.map((pose) => pose.id) : []),
    ]),
  ];
  const learnable = practiceChoices.length ? practiceChoices : ["OPEN_PALM", "PEACE"];
  const target = learnable.includes(controls.practiceTarget)
    ? controls.practiceTarget
    : learnable[0];
  const passed = controls.practicePassed || [];
  const success = passed.includes(target);
  const activity = ACTIVITIES[cfg.mode];
  const readiness = controls.availability?.[cfg.mode];
  const dismissEditor = () => {
    if (editing?.resume) controls.setPaused(false);
    setEditing(null);
  };
  const changeTab = (next) => {
    if (next === "tune" && tab !== "tune")
      tuneResume.current = Boolean(active && (!controls.paused || editing?.resume));
    dismissEditor();
    setTab(next);
    if (next === "learn") {
      if (!controls.practice) controls.setPractice(true);
      if (!controls.practiceTarget) controls.setPracticeTarget(target);
    } else if (next === "control") {
      if (controls.practice) controls.setPractice(false);
      else if (tab === "tune" && tuneResume.current) controls.setPaused(false);
    } else if (active) controls.setPaused(true);
  };
  const learn = (pose) => {
    setTab("learn");
    setEditing(null);
    controls.setPractice(true);
    controls.setPracticeTarget(pose);
  };
  const edit = (pose) => {
    const resume = Boolean(active && !controls.paused && !controls.practice);
    if (resume) controls.setPaused(true);
    setEditing({ pose, resume, mode: cfg.mode });
  };
  const chooseActivity = (mode) => {
    if (mode === cfg.mode) return;
    dismissEditor();
    setMoreGestures(false);
    controls.switchMode(mode);
    setFocusActivities(false);
    if (tab === "learn") {
      const target = names.find(
        (pose) =>
          cfg.bindings[mode][pose] && !["none", "feedback"].includes(cfg.bindings[mode][pose]),
      );
      controls.setPracticeTarget(
        target || (mode === "custom" ? cfg.customPoses[0]?.id : null) || "OPEN_PALM",
      );
    }
  };
  const nextTarget = () => {
    const next =
      learnable.find((p) => !passed.includes(p)) ||
      learnable[(learnable.indexOf(target) + 1) % learnable.length];
    controls.setPracticeTarget(next);
  };
  const cardPoses = moreGestures
    ? names
    : cfg.mode === "custom"
      ? [...new Set([...assigned, ...cfg.customPoses.map((p) => p.id)])]
      : assigned.slice(0, 3);
  return (
    <section
      className={`gesture-settings ${tab !== "control" ? "is-focused" : ""}`}
      aria-label="Gesture controls"
    >
      <header className="gesture-header">
        <div>
          <span className="gesture-kicker">HAND GESTURES</span>
          <h3>
            {tab === "learn"
              ? "Learn a gesture."
              : tab === "tune"
                ? "Make it comfortable."
                : "Hands-free controls."}
          </h3>
          {tab === "control" && (
            <p>Choose an activity and start. Learn any gesture safely before using it.</p>
          )}
        </div>
        <span className={`gesture-status-dot ${active ? "is-on" : ""}`}>
          {controls.status.starting ? "Starting" : active ? "Camera on" : "Camera off"}
        </span>
      </header>

      {(tab === "control" || focusActivities) && (
        <div className="gesture-activities" role="group" aria-label="Choose activity">
          {(moreActivities || tab !== "control" ? Object.keys(ACTIVITIES) : MAIN_ACTIVITIES).map(
            (mode) => (
              <button
                type="button"
                key={mode}
                aria-label={`Choose ${ACTIVITIES[mode].name}`}
                aria-pressed={cfg.mode === mode}
                disabled={controls.busy || controls.calibrating}
                onClick={() => chooseActivity(mode)}
              >
                <Icon name={ACTIVITIES[mode].icon} size={20} />
                <span>{ACTIVITIES[mode].name}</span>
                {cfg.mode === mode && <i aria-hidden="true" />}
              </button>
            ),
          )}
        </div>
      )}
      <div className="gesture-activity-caption">
        <span>
          {tab === "control" || focusActivities
            ? activity.description
            : `${activity.name} · ${tab === "learn" ? "Practice without commands" : "Recognition preferences"}`}
        </span>
        <button
          type="button"
          className="gesture-link"
          onClick={() => {
            if (tab !== "control") setFocusActivities(!focusActivities);
            else setMoreActivities(!moreActivities);
          }}
          aria-expanded={tab !== "control" ? focusActivities : moreActivities}
        >
          {tab !== "control"
            ? focusActivities
              ? "Keep this activity"
              : "Change activity"
            : moreActivities
              ? "Show less"
              : "More activities"}
          <Icon
            name={(tab !== "control" ? focusActivities : moreActivities) ? "chevUp" : "chevDown"}
            size={14}
          />
        </button>
      </div>

      <div className="gesture-toolbar">
        <div
          className="gesture-tabs"
          role="tablist"
          aria-label="Gesture views"
          onKeyDown={(e) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key) || controls.calibrating)
              return;
            e.preventDefault();
            const tabs = ["control", "learn", "tune"];
            const next =
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? 2
                  : (tabs.indexOf(tab) + (e.key === "ArrowRight" ? 1 : 2)) % 3;
            changeTab(tabs[next]);
            e.currentTarget.querySelectorAll("[role='tab']")[next]?.focus();
          }}
        >
          {["control", "learn", "tune"].map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              tabIndex={tab === name ? 0 : -1}
              id={`gesture-tab-${name}`}
              aria-controls={`gesture-view-${name}`}
              aria-selected={tab === name}
              disabled={controls.calibrating}
              onClick={() => changeTab(name)}
            >
              <Icon
                name={name === "control" ? "play" : name === "learn" ? "skills" : "settings"}
                size={15}
              />
              {name[0].toUpperCase() + name.slice(1)}
            </button>
          ))}
        </div>
        <div className="gesture-session-buttons">
          {active ? (
            <>
              {tab !== "learn" && (
                <button
                  type="button"
                  className="gesture-pause"
                  disabled={controls.busy}
                  onClick={() => controls.setPaused(!controls.paused)}
                >
                  <Icon name={controls.paused ? "play" : "eyeOff"} size={15} />
                  {controls.paused ? "Resume gestures" : "Pause gestures"}
                </button>
              )}
              <button type="button" className="gesture-stop" onClick={controls.stop}>
                <Icon name="stop" size={15} />
                Stop camera
              </button>
            </>
          ) : (
            <button
              type="button"
              className="gesture-primary"
              disabled={controls.busy || !controls.supported}
              onClick={() => {
                if (tab === "learn") {
                  controls.setPractice(true);
                  controls.setPracticeTarget(target);
                } else {
                  controls.setPaused(false);
                  if (controls.practice) controls.setPractice(false);
                }
                void controls.start();
              }}
            >
              <Icon name="camera" size={17} />
              {controls.busy ? "Opening…" : tab === "learn" ? "Start practice" : "Start gestures"}
            </button>
          )}
        </div>
      </div>
      {!controls.supported && (
        <p className="gesture-notice" role="status">
          Open this in the supported JARVIS app to use its camera.
        </p>
      )}
      {controls.blocked && (
        <p className="gesture-notice" role="status">
          Gestures are waiting while you answer JARVIS’s current question or approval.
        </p>
      )}
      {active && controls.paused && tab !== "learn" && (
        <p className="gesture-notice">
          Gestures paused. The camera stays on so you can get comfortable. Touch controls still
          work.
        </p>
      )}

      <div role="tabpanel" id={`gesture-view-${tab}`} aria-labelledby={`gesture-tab-${tab}`}>
        {tab === "control" && (
          <>
            <div className="gesture-control-layout">
              <div className="gesture-control-camera">
                <CameraView controls={controls} />
                <SessionFeedback controls={controls} />
              </div>
              <div className="gesture-control-content">
                <div className="gesture-section-title">
                  <div>
                    <span className="gesture-kicker">TAP OR USE A GESTURE</span>
                    <h4>
                      {cfg.mode === "pc" ? "Presentation controls" : `${activity.name} controls`}
                    </h4>
                  </div>
                  <Icon name={activity.icon} size={23} />
                </div>
                <ActivityContent
                  controls={controls}
                  editable
                  routines={routines}
                  location="panel"
                />
              </div>
            </div>
            {cfg.mode === "custom" && (
              <section className="gesture-teach">
                <div>
                  <h4>Make a gesture that feels natural</h4>
                  <p>Name it, show it to the camera, then choose its action.</p>
                </div>
                <label>
                  Pose name
                  <input
                    aria-label="Pose name"
                    value={poseName}
                    maxLength={40}
                    placeholder="e.g. My comfortable pose"
                    onChange={(e) => setPoseName(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  disabled={
                    !controls.status.running ||
                    controls.calibrating ||
                    !poseName.trim() ||
                    cfg.customPoses.length >= 12
                  }
                  onClick={() => {
                    controls.setPractice(true);
                    controls.calibrate(poseName);
                  }}
                >
                  {controls.calibrating ? "Hold your pose…" : "Capture my pose"}
                  <Icon name="camera" size={16} />
                </button>
                <small>
                  Three seconds to get ready. Keep your hand still until capture finishes.
                </small>
                {controls.practice && (
                  <button type="button" onClick={() => controls.setPractice(false)}>
                    Finish teaching & enable actions
                  </button>
                )}
              </section>
            )}

            <section className="gesture-cards-section" aria-label="Gestures for this mode">
              <div className="gesture-section-title">
                <div>
                  <h4>Your gestures</h4>
                </div>
                <span className="gesture-muted">
                  Hold {(cfg.holdMs / 1000).toFixed(1)}s · lower hand to repeat
                </span>
              </div>
              {cfg.mode === "hud" && (
                <p className="gesture-notice">
                  Point your index finger to move the cursor. Touch your thumb to it, then separate
                  them to select a safe button. Hold the pinch to drag a card.
                </p>
              )}
              <div className="gesture-cards">
                {cardPoses.map((pose) => {
                  const action = cfg.bindings[cfg.mode][pose] || "none";
                  const detected =
                    controls.recognition?.pose === pose &&
                    controls.status.running &&
                    !controls.paused;
                  return (
                    <article
                      className={`gesture-card ${detected ? "is-detected" : ""} ${action === "none" ? "is-unassigned" : ""}`}
                      key={pose}
                    >
                      <div className="gesture-card__image">
                        <GestureGlyph pose={pose} size={70} />
                        {passed.includes(pose) && (
                          <span className="gesture-card__learned" title="Practiced">
                            <Icon name="check" size={13} />
                          </span>
                        )}
                      </div>
                      <h5>{poseLabel(pose, cfg)}</h5>
                      <strong className="gesture-card__action">{actionLabel(action)}</strong>
                      <p>{POSE_HELP[pose] || "Use the hand shape you saved for this gesture."}</p>
                      <div className="gesture-card__buttons">
                        <button
                          type="button"
                          aria-label={`Learn ${poseLabel(pose, cfg)}`}
                          onClick={() => learn(pose)}
                        >
                          Learn
                          <Icon name="arrowRight" size={13} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Change ${poseLabel(pose, cfg)}`}
                          onClick={() => edit(pose)}
                        >
                          <Icon name="edit" size={13} />
                          Change
                        </button>
                      </div>
                      {pose.startsWith("custom_") && (
                        <ConfirmButton
                          title={`Delete ${poseLabel(pose, cfg)}`}
                          confirmLabel="Delete this pose?"
                          onConfirm={() => controls.removePose(pose)}
                        >
                          Delete pose
                        </ConfirmButton>
                      )}
                    </article>
                  );
                })}
                {!moreGestures && cfg.mode !== "custom" && cardPoses.length < 3 && (
                  <button
                    className="gesture-add-card"
                    type="button"
                    onClick={() => setMoreGestures(true)}
                  >
                    <Icon name="plus" size={24} />
                    <strong>
                      {assigned.length > 3
                        ? `${assigned.length - 3} more gestures`
                        : "Add a gesture"}
                    </strong>
                    <span>
                      {assigned.length > 3
                        ? "See the rest of your controls"
                        : "Choose a pose and its action"}
                    </span>
                  </button>
                )}
              </div>
              {!moreGestures && cardPoses.length >= 3 && (
                <button
                  type="button"
                  className="gesture-link gesture-view-more"
                  onClick={() => setMoreGestures(true)}
                >
                  See all gesture options
                  <Icon name="arrowRight" size={14} />
                </button>
              )}
              {moreGestures && (
                <>
                  <button
                    type="button"
                    className="gesture-link"
                    onClick={() => setMoreGestures(false)}
                  >
                    Show fewer gestures
                    <Icon name="chevUp" size={14} />
                  </button>
                  {cfg.mode !== "custom" && (
                    <button
                      type="button"
                      className="gesture-link"
                      onClick={() => chooseActivity("custom")}
                    >
                      Teach my own pose
                      <Icon name="arrowRight" size={14} />
                    </button>
                  )}
                </>
              )}
            </section>
            {editing && editing.mode === cfg.mode && (
              <ActionEditor
                key={`${editing.mode}:${editing.pose}`}
                pose={editing.pose}
                controls={controls}
                resume={editing.resume}
                onClose={() => setEditing(null)}
              />
            )}
            {cfg.mode === "reading" && controls.bookmarks?.length > 0 && (
              <details className="gesture-source gesture-bookmarks">
                <summary>Saved places ({controls.bookmarks.length})</summary>
                {controls.bookmarks.map((b) => (
                  <div className="gesture-bookmark" key={b.at}>
                    <button
                      type="button"
                      disabled={b.documentId !== documentId(cfg.reader)}
                      onClick={() => controls.selectPage(b.page)}
                    >
                      Page {b.page + 1} · {b.excerpt}
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove bookmark on page ${b.page + 1}`}
                      onClick={() => controls.removeBookmark(b.at)}
                    >
                      <Icon name="close" size={14} />
                    </button>
                  </div>
                ))}
              </details>
            )}
            {controls.history?.length > 0 && (
              <details className="gesture-history">
                <summary>
                  Recent actions <span>{controls.history.length}</span>
                </summary>
                <ol>
                  {controls.history.map((item) => (
                    <li key={item.id} data-state={item.state}>
                      <Icon
                        name={
                          item.state === "failed"
                            ? "warning"
                            : item.state === "pending"
                              ? "clock"
                              : item.state === "done"
                                ? "check"
                                : "send"
                        }
                        size={16}
                      />
                      <div>
                        <strong>{actionLabel(item.action)}</strong>
                        <p>{item.summary}</p>
                      </div>
                      <small>{item.pose === "manual" ? "Touch" : poseLabel(item.pose, cfg)}</small>
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </>
        )}

        {tab === "learn" && (
          <section className="gesture-learning" aria-label="Guided practice">
            <div className="gesture-section-title">
              <div>
                <span className="gesture-kicker">GET THE FEEL OF IT</span>
                <h4>Try it. Nothing will run.</h4>
              </div>
              <span className="gesture-learn-count">
                {learnable.filter((p) => passed.includes(p)).length} / {learnable.length} learned
              </span>
            </div>
            <div className="gesture-learn-picker" role="group" aria-label="Choose practice gesture">
              {learnable.map((pose) => (
                <button
                  type="button"
                  key={pose}
                  aria-pressed={target === pose}
                  onClick={() => controls.setPracticeTarget(pose)}
                >
                  {passed.includes(pose) && <Icon name="check" size={13} />}
                  {poseLabel(pose, cfg)}
                </button>
              ))}
            </div>
            <div className={`gesture-learn-stage ${success ? "is-success" : ""}`}>
              <div className="gesture-learn-target">
                <span className="gesture-kicker">{success ? "THAT’S IT" : "YOUR TURN"}</span>
                <GestureGlyph pose={target} size={138} />
                <h4>{success ? `${poseLabel(target, cfg)} recognized` : poseLabel(target, cfg)}</h4>
                <p>
                  {success
                    ? "You’ve got this one. Lower your hand, then try the next gesture."
                    : POSE_HELP[target] || "Show the hand shape you saved."}
                </p>
                <span className="gesture-learn-does">
                  In {activity.name}: {actionLabel(cfg.bindings[cfg.mode][target] || "none")}
                </span>
              </div>
              <div className="gesture-learn-camera">
                <CameraView controls={controls} target={target} />
                <SessionFeedback controls={controls} />
              </div>
            </div>
            {controls.status.running &&
              !success &&
              controls.recognition?.pose &&
              ![target, "UNKNOWN", "FIST"].includes(controls.recognition.pose) && (
                <p className="gesture-notice">
                  The camera sees {poseLabel(controls.recognition.pose, cfg).toLowerCase()}. Try{" "}
                  {poseLabel(target, cfg).toLowerCase()} as shown.
                </p>
              )}
            <div className="gesture-learn-footer">
              <span>
                <Icon name="lock" size={15} />
                Practice only. Actions stay off.
              </span>
              <div>
                <button type="button" disabled={!success} onClick={nextTarget}>
                  Next gesture
                  <Icon name="arrowRight" size={15} />
                </button>
                <button
                  type="button"
                  className="gesture-primary"
                  onClick={() => changeTab("control")}
                >
                  Use gestures
                  <Icon name="check" size={15} />
                </button>
              </div>
            </div>
            <details className="gesture-source">
              <summary>Having trouble?</summary>
              <ul>
                <li>Put one whole hand in view, with your palm toward the camera.</li>
                <li>Light your hand from the front. Avoid a bright window behind it.</li>
                <li>
                  Lower your hand between attempts. Keep the pose still while the progress fills.
                </li>
              </ul>
              <button type="button" onClick={() => changeTab("tune")}>
                Adjust response speed
                <Icon name="arrowRight" size={15} />
              </button>
            </details>
          </section>
        )}

        {tab === "tune" && (
          <section className="gesture-tuning" aria-label="Recognition preferences">
            <div className="gesture-section-title">
              <div>
                <span className="gesture-kicker">COMFORT OVER COMPLEXITY</span>
                <h4>How should gestures feel?</h4>
              </div>
            </div>
            <p className="gesture-muted">
              {active
                ? "Stop the camera to change recognition timing. Your other controls are kept."
                : "Start balanced. Choose deliberate if everyday movement triggers actions."}
            </p>
            <div className="gesture-presets">
              {RESPONSE_PRESETS.map((preset) => (
                <button
                  type="button"
                  key={preset.name}
                  aria-label={`Use ${preset.name} response`}
                  aria-pressed={
                    cfg.holdMs === preset.holdMs &&
                    cfg.releaseMs === preset.releaseMs &&
                    Math.abs(cfg.confidence - preset.confidence) < 0.001
                  }
                  disabled={active || controls.busy}
                  onClick={() =>
                    controls.changeConfig({
                      holdMs: preset.holdMs,
                      releaseMs: preset.releaseMs,
                      confidence: preset.confidence,
                    })
                  }
                >
                  <Icon
                    name={
                      preset.name === "Deliberate"
                        ? "lock"
                        : preset.name === "Quick"
                          ? "activity"
                          : "check"
                    }
                    size={21}
                  />
                  <strong>{preset.name}</strong>
                  <span>{preset.detail}</span>
                  <small>{(preset.holdMs / 1000).toFixed(2).replace(/0$/, "")}s hold</small>
                </button>
              ))}
            </div>
            {controls.camera.devices && (
              <div className="gesture-camera-settings">
                <label>
                  Camera
                  <select
                    aria-label="Webcam"
                    value={cfg.cameraId}
                    disabled={active || refreshing}
                    onChange={(e) => controls.changeConfig({ cameraId: e.target.value })}
                  >
                    <option value="">Default camera</option>
                    {controls.camera.devices.map((d, i) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || `Camera ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
                {controls.camera.refreshDevices && (
                  <button
                    type="button"
                    disabled={active || refreshing}
                    onClick={async () => {
                      setRefreshing(true);
                      try {
                        await controls.camera.refreshDevices();
                      } finally {
                        setRefreshing(false);
                      }
                    }}
                  >
                    Refresh cameras
                    <Icon name="restart" size={15} />
                  </button>
                )}
              </div>
            )}
            <label className="gesture-check">
              <input
                type="checkbox"
                checked={cfg.mirror}
                disabled={active}
                onChange={(e) => controls.changeConfig({ mirror: e.target.checked })}
              />
              Mirror camera and hand motion
            </label>
            <details className="gesture-source">
              <summary>Fine-tune recognition</summary>
              <label>
                Hold time · {cfg.holdMs} ms
                <input
                  aria-label="Hold time"
                  type="range"
                  min={200}
                  max={2000}
                  step={50}
                  value={cfg.holdMs}
                  disabled={active}
                  onChange={(e) => controls.changeConfig({ holdMs: Number(e.target.value) })}
                />
              </label>
              <label>
                Time between gestures · {cfg.releaseMs} ms
                <input
                  aria-label="Release time"
                  type="range"
                  min={200}
                  max={1500}
                  step={50}
                  value={cfg.releaseMs}
                  disabled={active}
                  onChange={(e) => controls.changeConfig({ releaseMs: Number(e.target.value) })}
                />
              </label>
              <label>
                Recognition confidence · {Math.round(cfg.confidence * 100)}%
                <input
                  aria-label="Minimum confidence"
                  type="range"
                  min={65}
                  max={98}
                  value={Math.round(cfg.confidence * 100)}
                  disabled={active}
                  onChange={(e) =>
                    controls.changeConfig({ confidence: Number(e.target.value) / 100 })
                  }
                />
              </label>
            </details>
            <div className="gesture-reset">
              <div>
                <strong>Start fresh for {activity.name}</strong>
                <p>
                  Restore just this activity’s gesture actions. Your other activities stay as you
                  set them.
                </p>
              </div>
              <ConfirmButton
                confirmLabel="Restore these actions?"
                onConfirm={() =>
                  controls.changeConfig((current) => ({
                    bindings: {
                      ...current.bindings,
                      [current.mode]: defaults().bindings[current.mode],
                    },
                  }))
                }
              >
                Restore default actions
              </ConfirmButton>
            </div>
            {readiness?.detail && <p className="gesture-notice">{readiness.detail}</p>}
          </section>
        )}
      </div>

      <footer className="gesture-safety">
        <GestureGlyph pose="FIST" size={38} />
        <div>
          <strong>Closed fist always stops the camera</strong>
          <span>
            Hold for {(Math.max(800, cfg.holdMs) / 1000).toFixed(1)}s. There’s always a Stop button
            too.
          </span>
        </div>
        <span className="gesture-local">
          <Icon name="lock" size={13} />
          On-device recognition · 5 min sessions
        </span>
      </footer>
    </section>
  );
}
