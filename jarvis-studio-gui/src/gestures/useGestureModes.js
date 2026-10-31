import { useEffect, useRef, useState } from "react";
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
} from "./engine";
import { clampIndex, documentId, loadBookmarks, poseId, safeStorage } from "./storage";

export function useGestureModes({ camera, enabled, host, blocked, canListen, latestReply = "" }) {
  const [config, setConfigState] = useState(() => loadConfig(safeStorage()));
  const configRef = useRef(config);
  const [status, setStatus] = useState({
    running: false,
    starting: false,
    summary: "Camera is off.",
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [stepIndex, setStep] = useState(0);
  const [pageIndex, setPage] = useState(0);
  const [bookmarks, setBookmarks] = useState(() => loadBookmarks(safeStorage()));
  const bookmarksRef = useRef(bookmarks);
  const [calibrating, setCalibrating] = useState(false);
  const [cursor, setCursor] = useState(null);
  const pages = readerPages(config.reader);
  const steps = config.steps
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const page = clampIndex(pageIndex, pages.length),
    step = clampIndex(stepIndex, steps.length);
  const context = useRef({ host, blocked, canListen, step, page });
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
  const policy = JSON.stringify([
    config.mode,
    config.holdMs,
    config.releaseMs,
    config.confidence,
    config.bindings,
    config.customPoses,
    config.mirror,
  ]);

  useEffect(() => {
    context.current = { host, blocked, canListen, step, page };
    cameraRef.current = camera;
  }, [host, blocked, canListen, step, page, camera]);

  // Only policy changes reset holds; host/camera object identity never does.
  useEffect(() => {
    if (pttOwned.current) context.current.host.cancelListen?.();
    pttOwned.current = false;
    pttAttempt.current++;
    engine.current = new GestureEngine(configRef.current);
    drag.current = null;
  }, [policy]);

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

  const changeConfig = (patch) => {
    const current = configRef.current;
    const next = sanitizeConfig({
      ...current,
      ...(typeof patch === "function" ? patch(current) : patch),
    });
    configRef.current = next;
    setConfigState(next);
  };
  const changeBookmarks = (update) => {
    const next = update(bookmarksRef.current);
    bookmarksRef.current = next;
    setBookmarks(next);
  };

  useEffect(() => {
    if (!enabled) return;
    alive.current = true;
    let disposed = false,
      timer;
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
      setCursor({ x, y, down: Boolean(drag.current) });
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
        if (context.current.canListen) h.listen?.();
        return;
      }
      if (action === "voice.stop") {
        h.stopSpeech?.();
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
          result = await h.speak(instructionList[next]);
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
            document.querySelector(".gesture-workspace__text") ||
            document.querySelector(".home-main");
          if (!area) throw new Error("No reading area is open.");
          area.scrollBy({
            top:
              (action === "reader.scrollDown" ? 1 : -1) * Math.max(150, area.clientHeight * 0.65),
            behavior: "smooth",
          });
          result = { ok: true, summary: "Scrolled the reading area." };
        } else result = await h.perform(action, cfg, cameraRef.current);
        if (alive.current) setMessage(result?.summary || "Command sent.");
      } catch (error) {
        if (alive.current) setMessage(String(error?.message || error));
      } finally {
        actionBusy.current = false;
        currentAction.current = "";
        const queued = queuedNavigation.current;
        queuedNavigation.current = null;
        if (
          queued &&
          !disposed &&
          running.current &&
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
      let delay = 1000;
      try {
        const snapshot = await cameraRef.current.poll();
        if (disposed) return;
        if (snapshot.running && !running.current) {
          cancelPtt();
          session.current++;
          latestFrame.current = -1;
          engine.current = new GestureEngine(configRef.current);
        }
        running.current = Boolean(snapshot.running);
        setStatus((old) =>
          old.running === snapshot.running &&
          old.starting === snapshot.starting &&
          old.summary === snapshot.summary
            ? old
            : snapshot,
        );
        delay = snapshot.running || snapshot.starting ? 100 : 1000;
        const visible = snapshot.foreground !== false && !document.hidden;
        if (!snapshot.running) {
          consume(engine.current.reset());
          if (calibration.current) {
            calibration.current = null;
            setCalibrating(false);
            setMessage("Camera stopped during calibration.");
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
            if (c) {
              if (!visible || context.current.blocked)
                throw new Error("Keep JARVIS visible and dismiss approvals before calibration.");
              if (Date.now() < c.startAt)
                setMessage(
                  "Form your pose: capturing in " +
                    Math.ceil((c.startAt - Date.now()) / 1000) +
                    "...",
                );
              else if (
                snapshot.frame.pose !== "FIST" &&
                snapshot.frame.score >= configRef.current.confidence &&
                validLandmarks(snapshot.frame.landmarks)
              ) {
                c.samples.push(snapshot.frame.landmarks);
                setMessage("Hold still: " + c.samples.length + " / 8 frames.");
                if (c.samples.length >= 8) {
                  const template = calibratePose(c.name, c.samples, poseId());
                  const next = sanitizeConfig({
                    ...configRef.current,
                    customPoses: [...configRef.current.customPoses, template],
                  });
                  configRef.current = next;
                  setConfigState(next);
                  calibration.current = null;
                  setCalibrating(false);
                  setMessage(
                    "Saved pose " +
                      template.name +
                      ". Lower your hand, stop the camera and choose its action.",
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
          }
          consume(engine.current.reset());
          queuedNavigation.current = null;
        }
      } finally {
        if (!disposed) timer = setTimeout(poll, delay);
      }
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
      if (
        hasOwn(ACTIONS, event.detail?.action) &&
        running.current &&
        !context.current.blocked &&
        !document.hidden
      ) {
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
    void poll();
    return () => {
      disposed = true;
      alive.current = false;
      clearTimeout(timer);
      cancelPtt();
      queuedNavigation.current = null;
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("jarvis:gesture-manual", manual);
    };
  }, [enabled]);

  const control = async (start) => {
    if (busy) return;
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
      }
      const response = await (start
        ? cameraRef.current.start(configRef.current)
        : cameraRef.current.stop());
      setMessage(response.ok ? "" : response.summary || "");
      const snapshot = await cameraRef.current.poll();
      setStatus(snapshot);
      // Leave running.current to poll: it must observe the false -> true edge.
    } catch (error) {
      setMessage(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };
  return {
    config,
    status,
    busy,
    message,
    step,
    page,
    bookmarks,
    calibrating,
    cursor,
    supported: enabled,
    camera,
    latestReply,
    changeConfig,
    start: () => control(true),
    stop: () => control(false),
    armControl: host.armControl,
    act: (action) =>
      window.dispatchEvent(new CustomEvent("jarvis:gesture-manual", { detail: { action } })),
    selectPage: (n) => {
      const value = clampIndex(n, readerPages(configRef.current.reader).length);
      context.current.page = value;
      setPage(value);
    },
    selectStep: (n) => {
      const value = clampIndex(
        n,
        configRef.current.steps.split("\n").filter((s) => s.trim()).length,
      );
      context.current.step = value;
      setStep(value);
    },
    calibrate: (name) => {
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
        samples: [],
        startAt: Date.now() + 3000,
        until: Date.now() + 18000,
      };
      setCalibrating(true);
      setMessage("Form your pose: capturing in 3 seconds...");
    },
    removePose: (id) =>
      changeConfig((current) => ({ customPoses: current.customPoses.filter((p) => p.id !== id) })),
    removeBookmark: (at) => changeBookmarks((previous) => previous.filter((b) => b.at !== at)),
  };
}
