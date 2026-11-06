import { useEffect, useRef, useState } from "react";
import { readerPages } from "./engine";
import { documentId } from "./storage";
import { timeLeft, timerLabel } from "./timers";
import { QuickControls } from "./GestureSessionViews";

export function TimerCards({ timers, showFeedback = true }) {
  const [notice, setNotice] = useState("");
  if (!timers) return null;
  return (
    <section className="activity-timers" aria-label="Activity timers">
      {timers.timers.map((timer) => {
        const elapsed = timer.deadline <= timers.now;
        const finished = timer.state === "finished" || (timer.state === "running" && elapsed);
        const running = timer.state === "running" && !elapsed;
        return (
          <div key={timer.id} className={`activity-timer${finished ? " is-finished" : ""}`}>
            <b>{timerLabel(timer.seconds)} timer</b>
            <span>{timer.label}</span>
            <strong>
              {running
                ? `${timer.external ? "Estimated " : ""}${timeLeft(timer.deadline, timers.now)}`
                : timer.state === "cancelled"
                  ? "Cancelled"
                  : timer.external
                    ? "Expected duration elapsed — check Clock"
                    : "Timer finished"}
            </strong>
            {running && !timer.external && (
              <button
                type="button"
                disabled={timers.busy}
                onClick={() => void timers.cancel(timer.id)}
              >
                Cancel timer for {timer.label}
              </button>
            )}
            {timer.external && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    const r = await timers.manage();
                    setNotice(r?.summary || "Could not open Clock.");
                  } catch (e) {
                    setNotice(e.message || String(e));
                  }
                }}
              >
                Manage in Clock
              </button>
            )}
            {!running && (
              <button type="button" onClick={() => timers.dismiss(timer.id)}>
                {timer.external ? "Hide timer estimate" : "Dismiss timer"}
              </button>
            )}
            {timer.external && (
              <small>
                Managed by your system Clock. This display cannot confirm its current state.
              </small>
            )}
          </div>
        );
      })}
      <p className="activity-announcement" role="status">
        {timers.timers
          .filter((t) => !t.external && t.state !== "cancelled" && t.deadline <= timers.now)
          .map((t) => `${timerLabel(t.seconds)} timer finished for ${t.label}.`)
          .join(" ")}
      </p>
      {showFeedback && timers.error && (
        <div role="alert">
          <p>{timers.error}</p>
          <button type="button" onClick={timers.clearError}>
            Dismiss timer message
          </button>
        </div>
      )}
      {showFeedback && notice && <p role="status">{notice}</p>}
    </section>
  );
}

function SourceEditor({ empty, title, children }) {
  const [open, setOpen] = useState(empty);
  return (
    <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{title}</summary>
      {children}
      <button type="button" onClick={() => setOpen(false)}>
        Done editing
      </button>
    </details>
  );
}

export default function ActivityView({ controls, compact = false }) {
  const { config, page, step } = controls;
  const pages = readerPages(config.reader);
  const steps = config.steps
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const [restore, setRestore] = useState(0);
  const text = useRef(null);
  const bookmarks = controls.bookmarks.filter((b) => b.documentId === documentId(config.reader));
  useEffect(() => {
    if (text.current) text.current.scrollTop = 0;
  }, [page, config.reader, restore]);
  useEffect(() => {
    if (restore) text.current?.focus();
  }, [restore]);
  const activeTimer = controls.timers?.timers.some(
    (t) => t.state === "running" && t.deadline > controls.timers.now,
  );
  const activeTimerLabel = controls.timers?.timers.some(
    (timer) => timer.external && timer.state === "running" && timer.deadline > controls.timers.now,
  )
    ? "Timer in Clock"
    : "Timer running";
  const startTimer = () => {
    const label = steps.length ? `Step ${step + 1}: ${steps[step].slice(0, 120)}` : "Activity";
    void controls.timers.start(config.timerSeconds, label, true);
  };
  return (
    <>
      {config.mode === "reading" && (
        <section aria-label="Read" className="activity-content">
          {!compact && (
            <SourceEditor empty={!config.reader} title={config.reader ? "Edit text" : "Paste text"}>
              <button
                type="button"
                disabled={!controls.latestReply}
                onClick={() => controls.changeConfig({ reader: controls.latestReply })}
              >
                Use latest JARVIS reply
              </button>
              <label>
                Reading text
                <textarea
                  rows={5}
                  maxLength={30000}
                  value={config.reader}
                  onChange={(e) => controls.changeConfig({ reader: e.target.value })}
                />
              </label>
            </SourceEditor>
          )}
          <div className="activity-meta">
            <span>
              Page {pages.length ? page + 1 : 0} of {pages.length}
            </span>
            <button
              type="button"
              aria-expanded={bookmarksOpen}
              onClick={() => setBookmarksOpen(!bookmarksOpen)}
            >
              Bookmarks ({bookmarks.length})
            </button>
          </div>
          {bookmarksOpen && (
            <div className="activity-bookmarks" aria-label="Bookmarks">
              {!bookmarks.length && <p>No bookmarks for this text yet.</p>}
              {bookmarks.map((bookmark) => (
                <div key={bookmark.at} className="activity-bookmark">
                  <button
                    type="button"
                    onClick={() => {
                      controls.selectPage(bookmark.page);
                      setBookmarksOpen(false);
                      setRestore((n) => n + 1);
                    }}
                  >
                    {bookmark.name || `Page ${bookmark.page + 1}: ${bookmark.excerpt}`}
                  </button>
                  <label>
                    Name for page {bookmark.page + 1}
                    <input
                      maxLength={80}
                      value={bookmark.name || ""}
                      onChange={(e) => controls.renameBookmark(bookmark.at, e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    aria-label={`Remove bookmark for page ${bookmark.page + 1}`}
                    onClick={() => controls.removeBookmark(bookmark.at)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
          <div
            ref={text}
            className="gesture-workspace__text activity-page"
            data-gesture-reader="panel"
            tabIndex={0}
            aria-label={`Reading page ${pages.length ? page + 1 : 0}`}
          >
            {pages[page] || "No text yet"}
          </div>
          <QuickControls controls={controls} />
        </section>
      )}
      {config.mode === "cooking" && (
        <section className="activity-content" aria-label="Steps">
          {!compact && (
            <SourceEditor empty={!config.steps} title={config.steps ? "Edit steps" : "Add steps"}>
              <label>
                Steps
                <textarea
                  rows={5}
                  maxLength={15000}
                  value={config.steps}
                  onChange={(e) => controls.changeConfig({ steps: e.target.value })}
                />
              </label>
            </SourceEditor>
          )}
          <p>
            Step {steps.length ? step + 1 : 0} of {steps.length}
          </p>
          <div className="gesture-workspace__text activity-page" tabIndex={0}>
            {steps[step] || "No steps yet"}
          </div>
          <QuickControls controls={controls} />
          <div className="task-timer">
            <label>
              Timer (minutes)
              <input
                type="number"
                min={0.1}
                max={1440}
                step={0.5}
                aria-label="Timer minutes"
                value={config.timerSeconds / 60}
                onChange={(e) =>
                  controls.changeConfig({
                    timerSeconds: Number(e.target.value) * 60,
                  })
                }
              />
            </label>
            <button
              type="button"
              disabled={
                activeTimer || controls.timers?.busy || controls.blocked || controls.practice
              }
              onClick={() => controls.act("timer.start")}
            >
              {controls.timers?.busy
                ? "Updating timer…"
                : activeTimer
                  ? activeTimerLabel
                  : `Start ${config.timerSeconds % 60 === 0 ? `${config.timerSeconds / 60} min` : `${config.timerSeconds} sec`} timer`}
            </button>
            {activeTimer && (
              <button type="button" disabled={controls.timers?.busy} onClick={startTimer}>
                Start another timer
              </button>
            )}
          </div>
        </section>
      )}
      {config.mode === "media" && (
        <section className="activity-bar" aria-label="Music controls">
          {[
            ["media.previous", "Previous track"],
            ["media.toggle", "Play / pause"],
            ["media.next", "Next track"],
            ["media.down", "Volume down"],
            ["media.up", "Volume up"],
          ].map(([action, label]) => (
            <button type="button" key={action} onClick={() => controls.act(action)}>
              {label}
            </button>
          ))}
        </section>
      )}
      {config.mode === "phone" && (
        <section className="activity-content" aria-label="Phone controls">
          <p>Control sound, flashlight and brightness. Keep JARVIS visible for hand gestures.</p>
          <QuickControls controls={controls} />
        </section>
      )}
      <TimerCards timers={controls.timers} showFeedback={config.mode === "cooking"} />
    </>
  );
}
