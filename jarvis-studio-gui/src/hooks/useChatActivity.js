import { useCallback, useRef } from "react";
import { ChatActivityStore } from "../brain/chatActivityStore";
import { resultId } from "../brain/results";
import { screenshotArtifacts } from "../brain/remote/pc";
import { finishChatToolReply, updateChatToolActivity } from "./chatToolActivity";
export function publicChatError(error) {
  const message = String(error?.message || "");
  if (message.startsWith("Task state changed"))
    return "Task state changed. Check its outcomes again before continuing.";
  if (message.startsWith("Set up an AI provider"))
    return "Set up an AI provider before continuing.";
  return "The request ended without a confirmed result. Check its saved activity before retrying.";
}

/** Per-request observers own their reply; no ambient "current tool" or result buffer. */
export function useChatActivity(memoryRef, setMessages, pushWarning) {
  const storeRef = useRef(null);
  if (storeRef.current == null) storeRef.current = new ChatActivityStore();
  const warnedRef = useRef(false);
  const warn = useCallback(() => {
    if (!warnedRef.current) {
      warnedRef.current = true;
      pushWarning(
        "Tool activity could not be saved. Current results remain visible; saved chat history may be incomplete.",
      );
    }
  }, [pushWarning]);
  const begin = useCallback(
    async (text, display, photo) => {
      const userId = resultId(),
        replyId = resultId();
      let message = {
        id: replyId,
        role: "jarvis",
        text: "",
        streaming: true,
        finalized: false,
        toolActivity: [],
      };
      let finished = false;
      const cards = [];
      storeRef.current.begin(replyId);
      if (!storeRef.current.save(replyId, [], false)) warn();
      setMessages((prev) => [
        ...prev,
        { role: "user", id: userId, text: display || text, ...(photo ? { image: photo } : {}) },
        message,
      ]);
      try {
        const memory = memoryRef.current;
        const user = {
          role: "user",
          content: photo ? `${text} [photo attached]` : text,
          display,
          uiId: userId,
        };
        const reply = { role: "assistant", content: "", uiId: replyId, uiPending: true };
        if (memory.beginChatTurn) {
          if (!(await memory.beginChatTurn(user, reply))) warn();
        } else {
          await memory.appendTurn(user);
          await memory.appendTurn(reply);
        }
      } catch {
        warn();
      }
      const request = {
        userId,
        replyId,
        onToolActivity: (event) => {
          message = updateChatToolActivity([message], replyId, event)[0];
          if (!storeRef.current.save(replyId, message.toolActivity || [], finished)) warn();
          setMessages((prev) => updateChatToolActivity(prev, replyId, event));
        },
        onDispatched: (spec, result) => {
          const image = result?.data?.imageUrl;
          if (image && ["generate_image", "qr_code"].includes(spec.type))
            cards.push({
              type: spec.type === "qr_code" ? "qr" : "generate_image",
              message: result.summary || "",
              ok: result.ok !== false,
              image,
            });
          if (
            ["pc_task", "pc_screenshot"].includes(spec.type) &&
            result?.ok &&
            result.data?.proof?.passed === true
          ) {
            const ids = result.data.proof.evidence_ids;
            if (Array.isArray(ids))
              for (const image of screenshotArtifacts(result.data.artifacts)) {
                if (ids.includes(image.id))
                  cards.push({
                    type: "screenshot",
                    message: "Screenshot from your PC.",
                    ok: true,
                    image: image.image,
                  });
              }
          }
        },
      };
      const finish = async (text) => {
        finished = true;
        const reply = { id: replyId, role: "jarvis", text, actions: cards, finalized: true };
        message = finishChatToolReply([message], reply)[0];
        if (!storeRef.current.save(replyId, message.toolActivity || [], true)) warn();
        setMessages((prev) =>
          prev.some((m) => m.id === replyId) ? finishChatToolReply(prev, reply) : prev,
        );
        try {
          if (storeRef.current.isRemoved(replyId)) return;
          if (
            memoryRef.current.updateChatTurn &&
            !(await memoryRef.current.updateChatTurn({
              role: "assistant",
              content: text,
              uiId: replyId,
            }))
          )
            warn();
        } catch {
          warn();
        }
      };
      return { request, finish };
    },
    [memoryRef, setMessages, warn],
  );
  const restore = useCallback(
    (turns) =>
      turns.map((turn) => {
        const id = turn.uiId || resultId();
        const rows = turn.uiId ? storeRef.current.read(turn.uiId) : undefined;
        return {
          id,
          role: turn.role === "user" ? "user" : "jarvis",
          text: turn.uiPending
            ? "Interrupted task. Review its saved activity before continuing."
            : (turn.display ?? turn.content),
          finalized: true,
          actions: [],
          ...(rows ? { toolActivity: rows } : {}),
          ...(turn.role === "assistant" && turn.uiId && !rows ? { activityUnavailable: true } : {}),
        };
      }),
    [],
  );
  const remove = useCallback(
    async (turns) => {
      const memory = memoryRef.current;
      const current = await (memory.recentChatTurns?.() ?? memory.recentTurns());
      const archives = await memory.listRecents();
      const kept = new Set([...current, ...archives.flatMap((r) => r.turns)].map((t) => t.uiId));
      if (
        !storeRef.current.remove(turns.map((turn) => turn.uiId).filter((id) => id && !kept.has(id)))
      )
        warn();
    },
    [memoryRef, warn],
  );
  return { begin, restore, remove };
}
