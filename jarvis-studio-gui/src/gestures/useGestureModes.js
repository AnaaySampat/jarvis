import { useActivityTimers } from "./timers";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ACTIONS,
  GestureEngine,
  loadConfig,
  saveConfig,
  sanitizeConfig,
  calibratePose,
  readerPages,
  hasOwn,
  validLandmarks,
  idleRecognition,
  featureDistance,
  MODES,
} from "./engine";
import { clampIndex, documentId, loadBookmarks, poseId, safeStorage } from "./storage";

const policyKey = (config) =>
  JSON.stringify([
    config.mode,
    config.holdMs,
    config.releaseMs,
    config.confidence,
    config.bindings,
    config.customPoses,
    config.mirror,
  ]);

export function useGestureModes({
  camera,
  enabled,
  host,
  blocked,
  canListen,
  listening = false,
  latestReply = "",
}) {
  const [config, setConfigState] = useState(() => loadConfig(safeStorage()));
  const configRef = useRef(config);
  const [status, setStatus] = useState({
    running: false,
    starting: false,
    summary: "Camera is off.",
  });
  const [busy, setBusy] = useState(false);
  const controlBusy = useRef(false);
  const controlToken = useRef(0);
  const [message, setMessage] = useState("");
  const [stepIndex, setStep] = useState(0);
  const [pageIndex, setPage] = useState(0);
  const [bookmarks, setBookmarks] = useState(() => loadBookmarks(safeStorage()));
  const bookmarksRef = useRef(bookmarks);
  const [calibrating, setCalibrating] = useState(false);
  const [calibrationProgress, setCalibrationProgress] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [recognition, setRecognition] = useState(idleRecognition);
  const [practice, setPracticeState] = useState(false);
  const practiceRef = useRef(false);
  const [paused, setPausedState] = useState(false);
  const pausedRef = useRef(false);
  const [practiceTarget, setPracticeTargetState] = useState(null);
  const targetRef = useRef(null);
  const [practicePassed, setPracticePassed] = useState([]);
  const passedRef = useRef([]);
  const [history, setHistory] = useState([]);
  const historySeq = useRef(0);
  const timers = useActivityTimers(host);
  const timersRef = useRef(timers);
  useEffect(() => {
    timersRef.current = timers;
  }, [timers]);
  const navigationRevision = useRef(0);
  const pages = useMemo(() => readerPages(config.reader), [config.reader]);
  const steps = useMemo(
    () =>
      config.steps
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    [config.steps],
  );
  const page = clampIndex(pageIndex, pages.length),
    step = clampIndex(stepIndex, steps.length);
  const context = useRef({ host, blocked, canListen, listening, step, page });
  const engine = useRef(null);
  if (engine.current === null) engine.current = new GestureEngine(config);
  const calibration = useRef(null);
  const actionBusy = useRef(false);
  const currentAction = useRef("");
  const queuedNavigation = useRef(null);
  const drag = useRef(null);
  const latestFrame = useRef(-1);
  const session = useRef(0);
  const running = useRef(false);
  const pttOwned = useRef(false);
  const pttAttempt = useRef(0);
  const alive = useRef(true);
  const cameraRef = useRef(camera);
  const refresh = useRef(() => {});

  useEffect(() => {
    context.current = { host, blocked, canListen, listening, step, page };
    cameraRef.current = camera;
  }, [host, blocked, canListen, listening, step, page, camera]);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        saveConfig(configRef.current, localStorage);
      } catch {
        setMessage("Could not save gesture settings: device storage is full or unavailable.");
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [config]);
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem("jarvis.gesture.bookmarks.v2", JSON.stringify(bookmarksRef.current));
      } catch {
        setMessage("Could not save bookmarks: device storage is full or unavailable.");
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [bookmarks]);

  const resetInteraction = useCallback((next = configRef.current) => {
    pttAttempt.current++;
    if (pttOwned.current) context.current.host.cancelListen?.();
    pttOwned.current = false;
    session.current++;
    engine.current = new GestureEngine(next);
    queuedNavigation.current = null;
    drag.current = null;
    setCursor(null);
    setRecognition(engine.current.recognition);
  }, []);
  const changeConfig = useCallback(
    (patch) => {
      const current = configRef.current;
      const next = sanitizeConfig({
        ...current,
        ...(typeof patch === "function" ? patch(current) : patch),
      });
      if (next.reader !== current.reader) {
        setPage(0);
        context.current.page = 0;
        navigationRevision.current++;
      }
      if (next.steps !== current.steps) {
        setStep(0);
        context.current.step = 0;
        navigationRevision.current++;
      }
      configRef.current = next;
      if (policyKey(current) !== policyKey(next)) resetInteraction(next);
      if (current.mode !== next.mode) {
        targetRef.current = null;
        setPracticeTargetState(null);
        passedRef.current = [];
        setPracticePassed([]);
        timersRef.current.clearError?.();
        setMessage(running.current ? "Lower your hand, then use your new controls." : "");
      }
      setConfigState(next);
    },
    [resetInteraction],
  );
  // A direct Read/Steps entry opens controls, even if Learn was left open.
  // Keep an explicitly paused camera paused and require a fresh hand release.
  const openActivity = useCallback(
    (mode) => {
      if (!hasOwn(MODES, mode)) return;
      changeConfig({ mode });
      practiceRef.current = false;
      setPracticeState(false);
      resetInteraction();
      setMessage(
        !running.current
          ? "Camera is off. You can use the buttons."
          : pausedRef.current
            ? "Gestures paused. You can still use the buttons."
            : "Lower your hand, then use your new controls.",
      );
    },
    [changeConfig, resetInteraction],
  );
  const setPractice = (value) => {
    practiceRef.current = Boolean(value);
    setPracticeState(Boolean(value));
    pausedRef.current = false;
    setPausedState(false);
    resetInteraction();
    setMessage(
      running.current
        ? value
          ? "Practice only. No commands will run."
          : "Lower your hand to start using gestures."
        : value
          ? "Camera is off. Start practice when you are ready."
          : "Camera is off. You can use the buttons.",
    );
  };
  const changeBookmarks = (update) => {
    const next = update(bookmarksRef.current);
    bookmarksRef.current = next;
    setBookmarks(next);
  };
  const cancelPendingControl = useCallback(() => {
    controlToken.current++;
    controlBusy.current = false;
  }, []);

  useEffect(() => {
    alive.current = true;
    let disposed = false,
      timer;
    let polling = false,
      refreshPending = false;
    const cancelPtt = () => {
      pttAttempt.current++;
      if (pttOwned.current) context.current.host.cancelListen?.();
      pttOwned.current = false;
    };
    const pointer = (event) => {
      if (event.x < 0) {
        drag.current = null;
        setCursor(null);
        return;
      }
      const x = event.x * window.innerWidth,
        y = event.y * window.innerHeight;
      const target = document.elementFromPoint(x, y);
      const card = target?.closest("[data-gesture-card]");
      if (event.phase === "down")
        drag.current = {
          card: card?.dataset.gestureCard,
          button: target?.closest("[data-gesture-safe]"),
          x,
          y,
        };
      if (event.phase === "up") {
        const start = drag.current;
        drag.current = null;
        if (start?.card && card?.dataset.gestureCard && start.card !== card.dataset.gestureCard) {
          context.current.host.reorder?.(start.card, card.dataset.gestureCard);
        } else if (
          start?.button &&
          start.button === target?.closest("[data-gesture-safe]") &&
          Math.hypot(x - start.x, y - start.y) < 40 &&
          !start.button.disabled
        ) {
          start.button.click();
        } else if (card) {
          document
            .querySelectorAll(".gesture-selected")
            .forEach((el) => el.classList.remove("gesture-selected"));
          card.classList.add("gesture-selected");
        }
      }
      const down = Boolean(drag.current);
      setCursor((old) =>
        old?.x === x && old?.y === y && old?.down === down ? old : { x, y, down },
      );
    };
    const navigation = (action) =>
      action.startsWith("steps.") ||
      ["reader.next", "reader.previous", "reader.speak"].includes(action);
    const execute = async (event) => {
      const h = context.current.host,
        cfg = configRef.current;
      if (event.kind === "stop") {
        running.current = false;
        session.current++;
        queuedNavigation.current = null;
        cancelPtt();
        await cameraRef.current.stop();
        return;
      }
      if (event.kind === "action" && event.action === "voice.cancel") {
        const interrupted = pttOwned.current;
        cancelPtt();
        if (interrupted && running.current && !context.current.blocked && !document.hidden)
          setMessage("Recording cancelled: tracking lost.");
        return;
      }
      if (practiceRef.current || (pausedRef.current && event.pose !== "manual")) return;
      if (event.kind === "pointer") {
        pointer(event);
        return;
      }
      if (event.action === "voice.cancel") {
        cancelPtt();
        return;
      }
      if (event.action === "voice.finish") {
        if (pttOwned.current) {
          pttOwned.current = false;
          h.finishListen?.();
        }
        return;
      }
      if (context.current.blocked || calibration.current || document.hidden) return;
      const action = event.action;
      if (action === "voice.ptt") {
        if (!context.current.canListen || pttOwned.current) return;
        const token = ++pttAttempt.current,
          epoch = session.current;
        try {
          const accepted = await h.pttStart?.();
          if (accepted === false) return;
          if (
            token !== pttAttempt.current ||
            epoch !== session.current ||
            !running.current ||
            context.current.blocked ||
            practiceRef.current ||
            pausedRef.current ||
            document.hidden ||
            !engine.current.confirmPttStart()
          ) {
            h.cancelListen?.();
            return;
          }
          pttOwned.current = true;
        } catch (error) {
          setMessage(String(error?.message || error));
        }
        return;
      }
      if (action === "voice.listen") {
        if (context.current.listening) {
          pttOwned.current = false;
          pttAttempt.current++;
          engine.current.reset();
          h.finishListen?.();
          setMessage("Finish listening requested.");
        } else if (context.current.canListen) {
          h.listen?.();
          setMessage("Listening requested.");
        } else setMessage("Wait for JARVIS to finish, then try listening again.");
        return;
      }
      if (action === "voice.stop") {
        h.stopSpeech?.();
        setMessage("Stop speaking requested.");
        return;
      }
      if (action === "feedback") {
        setMessage("Gesture detected.");
        return;
      }
      if (!hasOwn(ACTIONS, action)) return;
      if (actionBusy.current) {
        if (navigation(action)) {
          queuedNavigation.current = { event, epoch: session.current, mode: cfg.mode };
          if (navigation(currentAction.current)) h.stopSpeech?.();
          setMessage("Switching to your latest reading or instruction command...");
        } else
          setMessage("An action is still finishing. Lower your hand and retry when it completes.");
        return;
      }
      actionBusy.current = true;
      currentAction.current = action;
      if (navigation(action)) navigationRevision.current++;
      const selectionRevision = navigationRevision.current;
      const commandId = ++historySeq.current;
      const epoch = session.current;
      setHistory((items) =>
        [
          {
            id: commandId,
            action,
            pose: event.pose,
            at: Date.now(),
            state: "pending",
            summary: "Waiting for the result…",
          },
          ...items,
        ].slice(0, 6),
      );
      setMessage("");
      try {
        let result;
        const instructionList = cfg.steps
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
        const readingPages = readerPages(cfg.reader);
        const pageAt = clampIndex(context.current.page, readingPages.length);
        if (action.startsWith("steps.")) {
          if (!instructionList.length)
            throw new Error("Add instructions in gesture settings first.");
          const at = clampIndex(context.current.step, instructionList.length);
          const next = clampIndex(
            at + (action === "steps.next" ? 1 : action === "steps.previous" ? -1 : 0),
            instructionList.length,
          );
          setStep(next);
          context.current.step = next;
          const spoken = await h.speak(instructionList[next]);
          result = spoken?.ok
            ? {
                ok: true,
                summary: `Finished reading step ${next + 1} of ${instructionList.length}.`,
              }
            : spoken;
        } else if (action === "reader.next" || action === "reader.previous") {
          if (!readingPages.length) throw new Error("Add reading text first.");
          const next = clampIndex(
            pageAt + (action === "reader.next" ? 1 : -1),
            readingPages.length,
          );
          setPage(next);
          context.current.page = next;
          result = { ok: true, summary: "Page " + (next + 1) + " of " + readingPages.length + "." };
        } else if (action === "reader.speak") {
          if (!readingPages.length) throw new Error("Add reading text first.");
          result = await h.speak(readingPages[pageAt]);
        } else if (action === "reader.bookmark") {
          if (!readingPages.length) throw new Error("Add reading text first.");
          const id = documentId(cfg.reader);
          const bookmark = {
            documentId: id,
            page: pageAt,
            excerpt: readingPages[pageAt].slice(0, 120),
            at: Date.now(),
            name:
              bookmarksRef.current.find((b) => b.documentId === id && b.page === pageAt)?.name ||
              "",
          };
          const next = [
            bookmark,
            ...bookmarksRef.current.filter((b) => b.documentId !== id || b.page !== pageAt),
          ].slice(0, 50);
          bookmarksRef.current = next;
          setBookmarks(next);
          result = { ok: true, summary: "Bookmarked page " + (pageAt + 1) + "." };
        } else if (action === "reader.scrollDown" || action === "reader.scrollUp") {
          const area =
            document.querySelector("[data-gesture-reader='panel']") ||
            document.querySelector(".gesture-workspace__text") ||
            document.querySelector(".home-main");
          if (!area) throw new Error("No reading area is open.");
          area.scrollBy({
            top:
              (action === "reader.scrollDown" ? 1 : -1) * Math.max(150, area.clientHeight * 0.65),
            behavior: "smooth",
          });
          result = { ok: true, summary: "Scrolled the reading area." };
        } else if (action === "timer.start") {
          const at = clampIndex(context.current.step, instructionList.length);
          const label =
            cfg.mode === "cooking" && instructionList.length
              ? `Step ${at + 1}: ${instructionList[at].slice(0, 120)}`
              : MODES[cfg.mode];
          result = await timersRef.current.start(cfg.timerSeconds, label);
        } else result = await h.perform(action, cfg, cameraRef.current);
        if (alive.current) {
          const summary = result?.summary || "Command sent; no result was provided.";
          setHistory((items) =>
            items.map((item) =>
              item.id === commandId
                ? {
                    ...item,
                    state:
                      result?.ok === false ? "failed" : result?.ok === true ? "done" : "requested",
                    summary,
                  }
                : item,
            ),
          );
          if (
            epoch === session.current &&
            (!navigation(action) || selectionRevision === navigationRevision.current)
          )
            setMessage(
              action === "timer.start" && cfg.mode === "cooking" && result?.ok === false
                ? ""
                : summary,
            );
        }
      } catch (error) {
        if (alive.current) {
          const summary = String(error?.message || error);
          setHistory((items) =>
            items.map((item) =>
              item.id === commandId ? { ...item, state: "failed", summary } : item,
            ),
          );
          if (
            epoch === session.current &&
            (!navigation(action) || selectionRevision === navigationRevision.current)
          )
            setMessage(summary);
        }
      } finally {
        actionBusy.current = false;
        currentAction.current = "";
        const queued = queuedNavigation.current;
        queuedNavigation.current = null;
        if (
          queued &&
          !disposed &&
          (running.current || queued.event.pose === "manual") &&
          queued.epoch === session.current &&
          queued.mode === configRef.current.mode &&
          !context.current.blocked &&
          !document.hidden
        ) {
          void execute(queued.event).catch((error) => setMessage(String(error?.message || error)));
        }
      }
    };
    const consume = (events, onlyStop = false) => {
      for (const event of events)
        if (
          !onlyStop ||
          event.kind === "stop" ||
          (event.kind === "action" && event.action === "voice.cancel")
        ) {
          void execute(event).catch((error) => {
            if (!disposed) setMessage(String(error?.message || error));
          });
        }
    };
    const poll = async () => {
      if (polling) {
        refreshPending = true;
        return;
      }
      clearTimeout(timer);
      polling = true;
      const startedAt = performance.now();
      const operation = controlToken.current;
      let delay = 1000;
      try {
        const snapshot = await cameraRef.current.poll();
        if (disposed) return;
        if (operation !== controlToken.current) {
          refreshPending = true;
          return;
        }
        if (snapshot.running && !running.current) {
          cancelPtt();
          session.current++;
          latestFrame.current = -1;
          engine.current = new GestureEngine(configRef.current);
        }
        running.current = Boolean(snapshot.running);
        setStatus((old) =>
          (controlBusy.current && old.starting && !snapshot.running && !snapshot.starting) ||
          (old.running === snapshot.running &&
            old.starting === snapshot.starting &&
            old.summary === snapshot.summary)
            ? old
            : snapshot,
        );
        delay = snapshot.running || snapshot.starting ? 67 : 1000;
        const visible = snapshot.foreground !== false && !document.hidden;
        if (!snapshot.running) {
          consume(engine.current.reset());
          if (calibration.current) {
            calibration.current = null;
            setCalibrating(false);
            setMessage("Camera stopped during calibration.");
            setCalibrationProgress({
              phase: "error",
              message: "Camera stopped. No pose was saved. Start it and try again.",
            });
          }
          drag.current = null;
          setCursor((old) => (old === null ? old : null));
          queuedNavigation.current = null;
        } else {
          // This runs on every poll, including when the host has no new frame.
          consume(
            engine.current.tick(Date.now(), visible, context.current.blocked),
            Boolean(calibration.current),
          );
          const c = calibration.current;
          if (c && Date.now() > c.until)
            throw new Error("Calibration timed out. Keep one well-lit hand still and try again.");
          if (c) {
            if (!visible || context.current.blocked)
              throw new Error("Keep JARVIS visible and dismiss approvals before calibration.");
            const remaining = Math.max(0, Math.ceil((c.startAt - Date.now()) / 1000));
            const phase = remaining ? "prepare" : "capture";
            setCalibrationProgress((old) =>
              old?.phase === phase &&
              old.remaining === remaining &&
              old.samples === c.samples.length
                ? old
                : {
                    phase,
                    remaining,
                    samples: c.samples.length,
                    hint: "Keep one whole hand still until the bar fills.",
                  },
            );
            if (remaining) setMessage("Form your pose: capturing in " + remaining + "...");
          }
          if (snapshot.frame && snapshot.frame.seq !== latestFrame.current) {
            latestFrame.current = snapshot.frame.seq;
            consume(
              engine.current.feed(snapshot.frame, {
                visible,
                blocked: context.current.blocked,
                now: Date.now(),
              }),
              Boolean(c),
            );
            const feedback = engine.current.recognition;
            if (
              practiceRef.current &&
              !pausedRef.current &&
              feedback.phase === "recognized" &&
              feedback.pose === targetRef.current &&
              !passedRef.current.includes(feedback.pose)
            ) {
              passedRef.current = [...passedRef.current, feedback.pose];
              setPracticePassed(passedRef.current);
            }
            if (c) {
              if (
                Date.now() >= c.startAt &&
                snapshot.frame.pose !== "FIST" &&
                (snapshot.frame.handCount === undefined || snapshot.frame.handCount === 1) &&
                Date.now() - snapshot.frame.observedAt >= 0 &&
                Date.now() - snapshot.frame.observedAt <= 600 &&
                validLandmarks(snapshot.frame.landmarks)
              ) {
                c.samples.push(snapshot.frame.landmarks);
                setCalibrationProgress({ phase: "capture", samples: c.samples.length });
                setMessage("Hold still: " + c.samples.length + " / 8 frames.");
                if (c.samples.length >= 8) {
                  const template = calibratePose(c.name, c.samples, poseId());
                  const similar = configRef.current.customPoses.find(
                    (pose) => featureDistance(pose.features, template.features) < 0.16,
                  );
                  if (similar)
                    throw new Error(
                      `This pose is too similar to ${similar.name}. Choose a more distinct hand shape.`,
                    );
                  const next = sanitizeConfig({
                    ...configRef.current,
                    customPoses: [...configRef.current.customPoses, template],
                    bindings: {
                      ...configRef.current.bindings,
                      custom: { ...configRef.current.bindings.custom, [template.id]: c.action },
                    },
                  });
                  changeConfig(next);
                  calibration.current = null;
                  setCalibrating(false);
                  setCalibrationProgress({
                    phase: "saved",
                    poseId: template.id,
                    name: template.name,
                    action: c.action,
                  });
                  setMessage(
                    "Saved pose " +
                      template.name +
                      (c.action === "none"
                        ? ". Choose its action on the gesture card."
                        : ". Test it in practice before enabling actions."),
                  );
                }
              }
            }
          }
        }
      } catch (error) {
        if (!disposed) {
          setMessage(String(error?.message || error));
          if (calibration.current) {
            calibration.current = null;
            setCalibrating(false);
            setCalibrationProgress({ phase: "error", message: String(error?.message || error) });
          }
          consume(engine.current.reset());
          queuedNavigation.current = null;
        }
      } finally {
        polling = false;
        if (!disposed) {
          setRecognition(engine.current.recognition);
          const wait = refreshPending ? 0 : Math.max(0, delay - (performance.now() - startedAt));
          refreshPending = false;
          timer = setTimeout(poll, wait);
        }
      }
    };
    refresh.current = () => {
      void poll();
    };
    const flush = () => {
      try {
        saveConfig(configRef.current, localStorage);
        localStorage.setItem("jarvis.gesture.bookmarks.v2", JSON.stringify(bookmarksRef.current));
      } catch {
        /* The debounced save reports failures while the app is visible. */
      }
    };
    const hidden = () => {
      if (document.hidden) {
        consume(engine.current.reset());
        drag.current = null;
        setCursor(null);
        queuedNavigation.current = null;
        flush();
      }
    };
    const manual = (event) => {
      if (hasOwn(ACTIONS, event.detail?.action) && !context.current.blocked && !document.hidden) {
        void execute({ kind: "action", action: event.detail.action, pose: "manual" }).catch(
          (error) => {
            if (!disposed) setMessage(String(error?.message || error));
          },
        );
      }
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("beforeunload", flush);
    window.addEventListener("jarvis:gesture-manual", manual);
    if (enabled) void poll();
    return () => {
      disposed = true;
      alive.current = false;
      cancelPendingControl();
      clearTimeout(timer);
      refresh.current = () => {};
      cancelPtt();
      queuedNavigation.current = null;
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("jarvis:gesture-manual", manual);
    };
  }, [enabled, changeConfig, cancelPendingControl]);

  const control = async (start) => {
    if (start && !enabled) {
      setMessage("Camera gestures require the native Android app or Windows webcam preview.");
      return;
    }
    if (start && controlBusy.current) return;
    const token = ++controlToken.current;
    controlBusy.current = true;
    setBusy(true);
    setMessage("");
    try {
      if (!start) {
        running.current = false;
        session.current++;
        pttAttempt.current++;
        if (pttOwned.current) host.cancelListen?.();
        pttOwned.current = false;
        engine.current.reset();
        drag.current = null;
        setCursor(null);
        queuedNavigation.current = null;
      }
      if (start) {
        running.current = false;
        latestFrame.current = -1;
        engine.current = new GestureEngine(configRef.current);
        setStatus({ running: false, starting: true, summary: "Opening the gesture camera…" });
      }
      setRecognition(engine.current.recognition);
      const response = await (start
        ? cameraRef.current.start(configRef.current)
        : cameraRef.current.stop());
      if (token !== controlToken.current) return;
      setMessage(response.ok ? "" : response.summary || "");
      // One serialized polling loop owns snapshots; control calls only request a
      // refresh so Start/Stop cannot overlap a native bridge request.
      refresh.current();
    } catch (error) {
      if (token === controlToken.current) {
        setMessage(String(error?.message || error));
        if (start)
          setStatus({ running: false, starting: false, summary: "Camera could not start." });
        else
          setStatus((old) => ({
            ...old,
            summary: "Could not confirm the camera stopped. Try Stop again.",
          }));
      }
    } finally {
      if (token === controlToken.current) {
        controlBusy.current = false;
        setBusy(false);
      }
    }
  };
  return {
    config,
    openActivity,
    status,
    busy,
    timers,
    message,
    step,
    page,
    bookmarks,
    calibrating,
    calibration: calibrationProgress,
    cursor,
    recognition,
    practice,
    paused,
    listening,
    setPaused: (value) => {
      pausedRef.current = Boolean(value);
      setPausedState(Boolean(value));
      resetInteraction();
      setMessage(
        value
          ? "Gestures paused. You can still use the buttons."
          : running.current
            ? "Lower your hand, then resume gestures."
            : "Camera is off. You can use the buttons.",
      );
    },
    practiceTarget,
    practicePassed,
    setPractice,
    setPracticeTarget: (pose) => {
      targetRef.current = pose;
      setPracticeTargetState(pose);
      // Re-testing a pose requires fresh evidence too.
      passedRef.current = passedRef.current.filter((p) => p !== pose);
      setPracticePassed(passedRef.current);
      resetInteraction();
    },
    switchMode: (mode) => {
      if (hasOwn(MODES, mode)) changeConfig({ mode });
    },
    history,
    blocked: Boolean(blocked),
    availability: host.availability || {},
    supported: enabled,
    platform: host.platform,
    camera,
    latestReply,
    changeConfig,
    start: () => control(true),
    stop: () => control(false),
    armControl: host.armControl,
    act: (action) =>
      window.dispatchEvent(new CustomEvent("jarvis:gesture-manual", { detail: { action } })),
    selectPage: (n) => {
      navigationRevision.current++;
      queuedNavigation.current = null;
      if (actionBusy.current && currentAction.current.startsWith("reader.")) host.stopSpeech?.();
      const value = clampIndex(n, readerPages(configRef.current.reader).length);
      context.current.page = value;
      setPage(value);
      setMessage(`Page ${value + 1}.`);
    },
    selectStep: (n) => {
      navigationRevision.current++;
      queuedNavigation.current = null;
      if (actionBusy.current && currentAction.current.startsWith("steps.")) host.stopSpeech?.();
      const value = clampIndex(
        n,
        configRef.current.steps.split("\n").filter((s) => s.trim()).length,
      );
      context.current.step = value;
      setStep(value);
      setMessage(`Step ${value + 1}.`);
    },
    cancelCalibration: () => {
      calibration.current = null;
      setCalibrating(false);
      setCalibrationProgress(null);
      resetInteraction();
      setMessage("Capture cancelled. No pose was saved.");
    },
    calibrate: (name, action = "none") => {
      const clean = String(name || "")
        .trim()
        .slice(0, 40);
      if (!clean) {
        setMessage("Give the pose a name.");
        return;
      }
      if (configRef.current.customPoses.some((p) => p.name.toLowerCase() === clean.toLowerCase())) {
        setMessage("A pose with that name already exists.");
        return;
      }
      if (!status.running || configRef.current.customPoses.length >= 12) {
        setMessage("Start the camera first. At most 12 poses can be saved.");
        return;
      }
      if (pttOwned.current) host.cancelListen?.();
      pttOwned.current = false;
      pttAttempt.current++;
      engine.current.reset();
      calibration.current = {
        name: clean,
        action: typeof action === "string" && hasOwn(ACTIONS, action) ? action : "none",
        samples: [],
        startAt: Date.now() + 3000,
        until: Date.now() + 18000,
      };
      setCalibrating(true);
      setCalibrationProgress({ phase: "prepare", remaining: 3, samples: 0 });
      setMessage("Form your pose: capturing in 3 seconds...");
    },
    removePose: (id) => {
      if (calibrationProgress?.poseId === id) setCalibrationProgress(null);
      changeConfig((current) => ({ customPoses: current.customPoses.filter((p) => p.id !== id) }));
    },
    renameBookmark: (at, name) =>
      changeBookmarks((previous) =>
        previous.map((b) => (b.at === at ? { ...b, name: name.slice(0, 80) } : b)),
      ),
    removeBookmark: (at) => changeBookmarks((previous) => previous.filter((b) => b.at !== at)),
  };
}
