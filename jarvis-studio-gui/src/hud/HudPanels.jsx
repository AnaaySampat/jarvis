/* HudPanels.jsx — the menus that open over the home screen: Skills, Capabilities,
   Device (the desktop's Power), Memory and the chat, plus the agent row. The home
   screen's own cards are widgets.jsx. Each menu is a Sheet: full screen on a phone. */

import { useState, useEffect, useRef, useCallback, memo } from "react";
import { IS_MOBILE } from "../hooks/useAssistant";
import ResponseRenderer from "../components/ResponseRenderer";
import Icon from "../components/Icon";
import StateMessage from "../components/StateMessage";
import Sheet, { ActionRow, Field, Group, HeaderButton, Toggle } from "../components/Sheet";
import { useAndroidBack } from "../hooks/useAndroidBack";
import { digestEnabled, setDigestEnabled } from "../brain/memory/digest";
import { agentById, agentsFor } from "../brain/agents";

/* ───────── Skills — quick tools, with their results shown in place ───────── */
export function SkillsOverlay({
  open,
  onClose,
  recordings = {},
  runAction,
  allowedDirs = [],
  onSaveDirs,
}) {
  const [qrText, setQrText] = useState("");
  const [qr, setQr] = useState(null); // {imageUrl, text}
  const [clip, setClip] = useState(null); // ToolResult
  const [dirPath, setDirPath] = useState("");
  const [newDir, setNewDir] = useState("");

  // The phone's runAction resolves to the tool's result; the desktop's is
  // fire-and-forget (the backend shows the outcome itself), so close there.
  const run = async (spec) => {
    const r = await runAction(spec);
    if (r === undefined) onClose();
    return r;
  };
  const makeQr = async () => {
    const t = qrText.trim();
    if (!t) return;
    const r = await run({ type: "qr_code", text: t });
    if (r?.ok && r.data?.imageUrl) setQr({ imageUrl: r.data.imageUrl, text: t });
  };
  const listDir = () => dirPath.trim() && run({ type: "list_dir", path: dirPath.trim() });
  const addDir = () => {
    const d = newDir.trim().replace(/^["']|["']$/g, "");
    if (d && !allowedDirs.includes(d)) onSaveDirs([...allowedDirs, d]);
    setNewDir("");
  };

  return (
    <Sheet
      open={open}
      title="Skills"
      sub="Quick tools JARVIS can run for you right now"
      onClose={onClose}
    >
      <div className="sp-sheet">
        <Group title="QR code">
          <Field hint="Anyone who scans it gets this link or text.">
            <div className="sp-inline">
              <input
                className="sp-input"
                value={qrText}
                placeholder="Link or text"
                onChange={(e) => setQrText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && makeQr()}
                aria-label="QR code contents"
              />
              <button type="button" className="sp-btn" onClick={makeQr} disabled={!qrText.trim()}>
                Make
              </button>
            </div>
          </Field>
          {qr && (
            <div className="sp-field skill-qr">
              <img src={qr.imageUrl} alt={`QR code for ${qr.text}`} width="200" height="200" />
              <span className="sp-desc">{qr.text}</span>
            </div>
          )}
        </Group>

        {IS_MOBILE && (
          <Group title="Clipboard">
            <ActionRow
              icon="clipboard"
              title="Read clipboard"
              desc="Shows the last thing you copied."
              onClick={async () => setClip(await run({ type: "clipboard" }))}
            />
            {clip && (
              <div className="sp-field">
                <span className={`sp-desc ${clip.ok === false ? "skill-err" : "skill-out"}`}>
                  {clip.summary}
                </span>
              </div>
            )}
          </Group>
        )}

        {!IS_MOBILE && (
          <>
            <Group title="Recording">
              {[
                ["audio", "Microphone"],
                ["video", "Webcam"],
                ["screen", "Screen"],
              ].map(([media, label]) => (
                <Toggle
                  key={media}
                  label={label}
                  checked={Boolean(recordings[media])}
                  onChange={(on) => runAction({ type: "record", media, do: on ? "start" : "stop" })}
                />
              ))}
              <div className="sp-field">
                <span className="sp-desc">
                  Runs until you switch it off. Saved to your Jarvis storage folder.
                </span>
              </div>
            </Group>
            <Group title="Quick tools">
              <ActionRow
                icon="camera"
                title="Take a screenshot"
                onClick={() => run({ type: "screenshot" })}
              />
              <Field label="List an approved folder">
                <div className="sp-inline">
                  <input
                    className="sp-input sp-mono"
                    value={dirPath}
                    placeholder="C:\Users\you\Documents"
                    onChange={(e) => setDirPath(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && listDir()}
                  />
                  <button
                    type="button"
                    className="sp-btn"
                    disabled={!dirPath.trim()}
                    onClick={listDir}
                  >
                    List
                  </button>
                </div>
              </Field>
            </Group>
            <Group title="Folders JARVIS can read">
              <Field hint="It can list these and read files inside, asking you each time. It can never run, write, move or delete anything.">
                <div className="dirlist">
                  {allowedDirs.length === 0 && (
                    <StateMessage variant="empty" icon="folder" title="No folders yet">
                      Add one to let JARVIS read files from it.
                    </StateMessage>
                  )}
                  {allowedDirs.map((d) => (
                    <div key={d} className="dirlist-row">
                      <span className="dirlist-path" title={d}>
                        {d}
                      </span>
                      <button
                        className="dirlist-rm"
                        aria-label={`Remove ${d}`}
                        onClick={() => onSaveDirs(allowedDirs.filter((x) => x !== d))}
                      >
                        <Icon name="close" size={14} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="sp-inline">
                  <input
                    className="sp-input sp-mono"
                    value={newDir}
                    placeholder="C:\Users\you\Documents"
                    onChange={(e) => setNewDir(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addDir()}
                  />
                  <button type="button" className="sp-btn" onClick={addDir}>
                    Add
                  </button>
                </div>
              </Field>
            </Group>
          </>
        )}
      </div>
    </Sheet>
  );
}

/* ───────── Capabilities — what to ask, with examples that fill the chat box ───────── */
// `say` is an example request. Tapping it puts it in the chat box to edit or send,
// never sends straight away: "Remind me at 6 pm" would really set a reminder.
const MOBILE_CAPABILITIES = [
  {
    group: "Talk and remember",
    items: [
      { t: "Answer questions and explain things", say: "Explain how a heat pump works" },
      { t: "Remember things you tell it", say: "What do you remember about me?" },
      {
        t: "Look at a photo you send",
        note: "Tap the paperclip in the chat. Needs a Gemini or Vertex AI key.",
      },
      {
        t: "Short, chatty replies",
        note: "Turn on conversation mode with the speech-bubble button at the top.",
      },
    ],
  },
  {
    group: "On this phone",
    items: [
      { t: "Open apps and websites", say: "Open YouTube" },
      {
        t: "Do tasks inside other apps",
        say: "Open Spotify and play lofi beats",
        note: "Needs app control, in Device.",
      },
      { t: "Set media volume or mute", say: "Set the volume to 30%" },
      { t: "Read your clipboard", say: "What's on my clipboard?" },
    ],
  },
  {
    group: "Out in the world",
    items: [
      { t: "Weather and forecasts", say: "Will it rain tomorrow?" },
      { t: "News headlines", say: "What's in the tech news today?" },
      { t: "Places nearby and directions", say: "Find a pharmacy near me" },
      { t: "Search the web", say: "Search the web for budget wireless earbuds" },
    ],
  },
  {
    group: "Agenda and alarms",
    items: [
      { t: "Reminders with a real alarm", say: "Remind me at 6 pm to call Mum" },
      { t: "Timers and alarms in your Clock app", say: "Set a timer for 10 minutes" },
      { t: "Today's agenda", say: "What's on my agenda today?" },
    ],
  },
  {
    group: "Your PC",
    items: [
      {
        t: "Run tasks on your paired Windows PC",
        say: "On my PC, open Notepad",
        note: "Pair it with the monitor button at the top.",
      },
    ],
  },
  {
    group: "This screen",
    items: [{ t: "Restyle the home screen", say: "Make the accent colour amber" }],
  },
];

const CAPABILITIES = [
  {
    group: "Conversation",
    items: [
      "Answer questions, explain, advise",
      "Render charts, tables, schedules and flowcharts",
      "Translate text, typed or from the camera",
      "Talk by wake word, Ctrl+Space, always-on listening, native voice, or chat",
      "Conversation mode: short, natural back-and-forth",
      "Speak with a British neural voice (offline Piper, or ElevenLabs)",
      "Attach an image or document in chat and ask about it",
    ],
  },
  {
    group: "Memory",
    items: [
      "Remember durable facts about you across sessions",
      "Recall recent conversation context",
      "Forget facts on request",
    ],
  },
  {
    group: "Your computer",
    items: [
      "Open and close apps and folders",
      "Search the web and open links",
      "Volume up and down, exact volume, mute, media keys",
      "Lock the screen",
      "Read your clipboard on request",
    ],
  },
  {
    group: "Web browser",
    items: [
      "Autopilot: give a whole task, like “play lofi on YouTube”, and it clicks and types until it's done",
      "You hear the outcome, not the steps",
      "Reads and summarises a page",
    ],
  },
  {
    group: "Desktop autopilot",
    items: [
      "Drives desktop apps by their named controls (asks once)",
      "Focuses or launches the right window itself",
      "Kill switch: slam the mouse into the top-left corner, press Stop, or say “disarm”",
    ],
  },
  { group: "Power (asks first)", items: ["Shut down, restart, sleep, hibernate, log off"] },
  {
    group: "Create and capture",
    items: [
      "Screenshots and QR codes",
      "Generate images (needs a Gemini key)",
      "Record audio, webcam or screen until you stop",
      "Make PDFs from text, and open files it created",
    ],
  },
  {
    group: "Read",
    items: [
      "Read and summarise PDFs",
      "List approved folders and read approved text files (asks first)",
      "Look at your screen and answer questions about it",
    ],
  },
  {
    group: "Out in the world",
    items: [
      "Current weather and a multi-day forecast",
      "Nearby places: food, cafés, pharmacies, ATMs, fuel",
      "Directions and travel time",
      "Latest news headlines by topic",
    ],
  },
  {
    group: "Clock, reminders and routines",
    items: [
      "Alarms and timers in your Clock app",
      "One-off reminders (agenda plus a real alarm)",
      "Recurring routines and spoken briefings",
      "Manage your daily agenda",
    ],
  },
  {
    group: "Learns and adapts",
    items: [
      "Playbooks: named multi-step recipes you teach it",
      "Restyle the HUD: colour, background, density",
      "Show, hide or rearrange panels by voice",
    ],
  },
  { group: "Apps", items: ["Spotify: play, pause, next, previous, play a song"] },
];

// Everything an item says, for the search box.
const capText = (it) =>
  (typeof it === "string" ? it : [it.t, it.say, it.note].filter(Boolean).join(" ")).toLowerCase();

export function CapabilitiesOverlay({ open, onClose, onTry }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const all = IS_MOBILE ? MOBILE_CAPABILITIES : CAPABILITIES;
  const caps = q
    ? all
        .map((c) =>
          c.group.toLowerCase().includes(q)
            ? c
            : { ...c, items: c.items.filter((it) => capText(it).includes(q)) },
        )
        .filter((c) => c.items.length)
    : all;
  return (
    <Sheet
      open={open}
      title="Capabilities"
      sub="Just ask in plain language — by voice or in chat"
      onClose={onClose}
    >
      <div className="sp-sheet">
        <label className="sp-search">
          <Icon name="search" size={16} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search what JARVIS can do…"
            aria-label="Search capabilities"
          />
        </label>
        {!q && onTry && IS_MOBILE && (
          <p className="sp-lede">Tap an example to put it in the chat box.</p>
        )}
        {caps.length === 0 && (
          <div className="sp-none">
            <span>Nothing matches “{query}”.</span>
            {onTry && (
              <button type="button" className="btn btn--sm" onClick={() => onTry(query.trim())}>
                <Icon name="send" size={13} />
                Ask JARVIS anyway
              </button>
            )}
          </div>
        )}
        {caps.map((c) => (
          <Group key={c.group} title={c.group}>
            {c.items.map((it) => {
              const item = typeof it === "string" ? { t: it } : it;
              const body = (
                <>
                  <span className="sp-label">{item.t}</span>
                  {item.say && <span className="cap-say">“{item.say}”</span>}
                  {item.note && <span className="sp-desc">{item.note}</span>}
                </>
              );
              return item.say && onTry ? (
                <button
                  type="button"
                  key={item.t}
                  className="sp-field cap-row"
                  onClick={() => onTry(item.say)}
                  aria-label={`${item.t}. Try: ${item.say}`}
                >
                  <span className="cap-text">{body}</span>
                  <Icon name="chat" size={18} className="cap-go" />
                </button>
              ) : (
                <div key={item.t} className="sp-field cap-row">
                  <span className="cap-text">{body}</span>
                </div>
              );
            })}
          </Group>
        ))}
      </div>
    </Sheet>
  );
}

/* ───────── Memory overlay — everything JARVIS has stored, with forget ─────────
   Port of the desktop's MemoryOverlay. The phone has no "learned routines" tab:
   verified workflows live in the Playbooks list with their status. */
const MEM_KINDS = [
  {
    key: "facts",
    kind: "fact",
    label: "About you",
    color: "var(--ac)",
    note: "JARVIS reads these before every reply.",
  },
  {
    key: "playbooks",
    kind: "playbook",
    label: "Playbooks",
    color: "#6ee7a8",
    note: "Step-by-step recipes JARVIS learned for tasks. Not your routines: those are on the home screen. A playbook runs on its own only after three verified successes.",
  },
  {
    key: "conversations",
    kind: "conversation",
    label: "Saved chats",
    color: "#8fa9bd",
    note: "Past conversations. Open one to pick up where you left off.",
  },
];
const PLAYBOOK_STATUS = {
  draft: "Reference",
  candidate: "Learning",
  promoted: "Verified",
  disabled: "Disabled",
};

const memTitle = (key, x) =>
  key === "facts" ? x.text : key === "conversations" ? x.title : x.name;

function memDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

export function MemoryOverlay({
  open,
  onClose,
  memory,
  currentCount = 0,
  onRemember,
  onForget,
  onOpenConversation,
  onOpenChat,
}) {
  const [tab, setTab] = useState("facts");
  const [draft, setDraft] = useState("");
  const [digestOn, setDigestOn] = useState(digestEnabled);
  const [armed, setArmed] = useState(null); // id awaiting its confirming second tap
  const [focus, setFocus] = useState(null); // id picked on the timeline
  const [query, setQuery] = useState("");
  const mainRef = useRef(null);
  const m = memory || {};
  const lists = {
    facts: [...(m.facts || [])].reverse(),
    playbooks: m.playbooks || [],
    conversations: m.conversations || [],
  };

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  // Without this, Android's back button left the app from Memory.
  useAndroidBack(open, onClose);

  // Scroll only the list pane — scrollIntoView would also scroll the HUD's
  // overflow:hidden ancestors and shift the whole stage sideways.
  useEffect(() => {
    const main = mainRef.current;
    const el = focus && main?.querySelector(`[data-mem="${CSS.escape(focus)}"]`);
    if (main && el) {
      main.scrollTo({ top: el.offsetTop - main.clientHeight / 3, behavior: "smooth" });
    }
  }, [focus, tab]);

  // Timeline: every dated memory as a tick between the oldest one and now.
  const now = m.now || 0; // set by listMemory (render must stay pure)
  const dated = MEM_KINDS.flatMap((k) => lists[k.key].filter((x) => x.ts).map((x) => ({ x, k })));
  const t0 = Math.min(now - 86400000, ...dated.map((d) => d.x.ts));
  const at = (ts) => `${((ts - t0) / (now - t0)) * 100}%`;

  const pick = (key) => {
    setTab(key);
    setFocus(null);
    setArmed(null);
    mainRef.current?.scrollTo(0, 0);
  };
  const forgetBtn = (kind, id, label = "Forget") => (
    <button
      type="button"
      className={`memx-forget ${armed === id ? "is-armed" : ""}`}
      onClick={() => {
        if (armed !== id) return setArmed(id);
        setArmed(null);
        onForget(kind, id);
      }}
      onBlur={() => armed === id && setArmed(null)}
    >
      {armed === id ? "Confirm" : label}
    </button>
  );
  const remember = (e) => {
    e.preventDefault();
    if (draft.trim()) {
      onRemember(draft.trim());
      setDraft("");
    }
  };
  const row = (id) => ({ "data-mem": id, className: focus === id ? "is-focus" : "" });
  const cur = MEM_KINDS.find((k) => k.key === tab);
  const q = query.trim().toLowerCase();
  const memText = (key, x) =>
    [memTitle(key, x), x.steps, ...(x.triggers || [])].filter(Boolean).join(" ").toLowerCase();
  const list = q ? lists[tab].filter((x) => memText(tab, x).includes(q)) : lists[tab];
  const hits = q
    ? Object.fromEntries(
        MEM_KINDS.map((k) => [
          k.key,
          lists[k.key].filter((x) => memText(k.key, x).includes(q)).length,
        ]),
      )
    : null;

  return (
    <div className={`memx ${open ? "open" : ""}`} aria-hidden={!open}>
      <div className="memx-scrim" onClick={onClose} />
      <section className="memx-panel" role="dialog" aria-label="Memory">
        <header className="memx-hd">
          <div className="memx-hd-txt">
            <span className="memx-kicker">MEMORY</span>
            <h2 className="memx-title">{IS_MOBILE ? "Memory" : "What JARVIS knows"}</h2>
            <p className="memx-loc">Kept on this phone and your paired PC.</p>
          </div>
          <div className="memx-hd-tools">
            <label className="memx-search">
              <Icon name="search" size={15} />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search memory…"
                aria-label="Search memory"
              />
            </label>
            <button className="memx-close" onClick={onClose} aria-label="Close memory">
              <Icon name="close" size={18} />
            </button>
          </div>
        </header>

        <div className="memx-tl" aria-hidden="true">
          <div className="memx-tl-track">
            {dated.map(({ x, k }) => (
              <button
                key={`${k.key}-${x.id}`}
                tabIndex={-1}
                className="memx-tick"
                style={{ left: at(x.ts), "--kc": k.color }}
                title={`${k.label} · ${memDate(x.ts)} — ${memTitle(k.key, x)}`}
                onClick={() => {
                  setTab(k.key);
                  setFocus(x.id);
                  setArmed(null);
                }}
              />
            ))}
          </div>
          <div className="memx-tl-axis">
            {/* Before the first snapshot `now` is 0 and t0 a day before the epoch,
                which printed "Dec 31, 1969". */}
            <span>{memDate(now && t0)}</span>
            <span>Today</span>
          </div>
        </div>

        <div className="memx-body">
          <nav className="memx-nav" aria-label="Memory sections">
            {MEM_KINDS.map((k) => (
              <button
                key={k.key}
                className={`memx-navbtn ${tab === k.key ? "is-on" : ""}`}
                aria-current={tab === k.key}
                onClick={() => pick(k.key)}
                style={{ "--kc": k.color }}
              >
                <span className="memx-sw" />
                <span className="memx-navl">{k.label}</span>
                <span className="memx-count">
                  {!memory
                    ? "–"
                    : hits
                      ? `${hits[k.key]}/${lists[k.key].length}`
                      : lists[k.key].length}
                </span>
              </button>
            ))}
            <p className="memx-navnote">
              Forgetting is permanent. You can also say “forget that…”.
            </p>
          </nav>

          <div className="memx-main" ref={mainRef}>
            {IS_MOBILE && (
              <p className="memx-lede">
                What JARVIS knows. Facts and routines are shared with your paired PC, and forgetting
                one there or here is permanent on both.
              </p>
            )}
            <div className="memx-sec-hd">
              <h3>{cur.label}</h3>
              <p>{cur.note}</p>
            </div>

            {tab === "facts" && !q && (
              <form className="memx-add" onSubmit={remember}>
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  aria-label="New fact"
                  placeholder="Something JARVIS should always know — e.g. I'm vegetarian"
                  maxLength={300}
                />
                <button type="submit" disabled={!draft.trim()}>
                  Remember
                </button>
              </form>
            )}
            {tab === "facts" && !q && (
              <label className="memx-digest">
                <input
                  type="checkbox"
                  checked={digestOn}
                  onChange={(e) => {
                    setDigestEnabled(e.target.checked);
                    setDigestOn(e.target.checked);
                  }}
                />
                <span>
                  Each night, keep what&apos;s worth remembering from your chats (your own words
                  only, up to five facts)
                </span>
              </label>
            )}

            {tab === "conversations" && currentCount > 0 && !q && (
              <div className="memx-row memx-row--current">
                <span className="memx-text">This conversation</span>
                <span className="memx-meta">{currentCount} messages</span>
                <button type="button" className="memx-open" onClick={onOpenChat}>
                  Open
                </button>
              </div>
            )}

            {!memory && <p className="memx-empty">Reading memory…</p>}
            {memory && q && list.length === 0 && (
              <p className="memx-empty">
                Nothing in {cur.label.toLowerCase()} matches “{query}”.
                {MEM_KINDS.filter((k) => k.key !== tab && hits[k.key]).map((k) => (
                  <button
                    key={k.key}
                    type="button"
                    className="memx-jump"
                    onClick={() => pick(k.key)}
                  >
                    {hits[k.key]} in {k.label}
                  </button>
                ))}
              </p>
            )}
            {memory && !q && list.length === 0 && (
              <p className="memx-empty">
                {
                  {
                    facts: "Nothing yet. Tell JARVIS “remember that…”, or add something above.",
                    playbooks: "No playbooks. Teach one by saying “learn a playbook called…”.",
                    conversations:
                      "No saved chats. Starting a new chat saves the current one here.",
                  }[tab]
                }
              </p>
            )}

            <ul className="memx-list">
              {tab === "facts" &&
                list.map((f) => (
                  <li key={f.id} {...row(f.id)}>
                    <div className="memx-row">
                      <span className="memx-text">{f.text}</span>
                      <span className="memx-meta">{memDate(f.ts)}</span>
                      {forgetBtn("fact", f.id)}
                    </div>
                  </li>
                ))}

              {tab === "playbooks" &&
                list.map((p) => (
                  <li key={p.id} {...row(p.id)}>
                    <div className="memx-card">
                      <div className="memx-row">
                        <span className="memx-name">{p.name}</span>
                        <span className="memx-badge">{PLAYBOOK_STATUS[p.status] || p.status}</span>
                        <span className="memx-meta">{memDate(p.ts)}</span>
                        {forgetBtn("playbook", p.id, "Remove")}
                      </div>
                      {p.triggers.length > 0 && (
                        <div className="memx-trig">
                          <span>When you say</span>
                          {p.triggers.map((t) => (
                            <em key={t}>{t}</em>
                          ))}
                        </div>
                      )}
                      {p.steps && <p className="memx-steps">{p.steps}</p>}
                    </div>
                  </li>
                ))}

              {tab === "conversations" &&
                list.map((c) => (
                  <li key={c.id} {...row(c.id)}>
                    <div className="memx-row">
                      <span className="memx-text">{c.title}</span>
                      <span className="memx-meta">
                        {c.count} messages · {memDate(c.ts)}
                      </span>
                      {forgetBtn("conversation", c.id, "Delete")}
                      <button
                        type="button"
                        className="memx-open"
                        onClick={() => onOpenConversation(c.id)}
                      >
                        Open
                      </button>
                    </div>
                  </li>
                ))}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}

/* ───────── Device (phone) / Power (desktop) ───────── */
/** "WIFI" / "4G" / "OFFLINE" … from deviceTelemetry → a readout for the Wi-Fi row. */
function networkReadout(label) {
  if (!label) return null;
  if (label === "WIFI") return { text: "On Wi-Fi", tone: "on" };
  if (/^[2-5]G$/.test(label)) return { text: `On ${label}`, tone: "on" };
  if (label === "OFFLINE") return { text: "Offline", tone: "warn" };
  return null;
}

export function PowerOverlay({ open, onClose, runAction, d = {}, appControlOn }) {
  const [note, setNote] = useState(null); // result of an action that stays in the sheet
  // Rows that open an Android settings screen leave JARVIS — close first.
  const openSettings = (target) => {
    onClose();
    runAction({ type: "system", target });
  };
  const power = (command) => {
    onClose();
    runAction({ type: "power", command });
  };

  if (!IS_MOBILE) {
    return (
      <Sheet open={open} title="Power" sub="Lock, sleep, restart…" onClose={onClose}>
        <div className="sp-sheet">
          <Group title="This PC">
            <ActionRow icon="lock" title="Lock" onClick={() => power("lock")} />
            <ActionRow icon="moon" title="Sleep" onClick={() => power("sleep")} />
          </Group>
          <Group title="Asks before it runs">
            <ActionRow icon="restart" title="Restart" onClick={() => power("restart")} />
            <ActionRow
              icon="moon"
              title="Hibernate"
              desc="Saves your session, then powers off."
              onClick={() => power("hibernate")}
            />
            <ActionRow icon="logout" title="Log off" onClick={() => power("logoff")} />
            <ActionRow icon="power" title="Shut down" danger onClick={() => power("shutdown")} />
          </Group>
        </div>
      </Sheet>
    );
  }

  const net = networkReadout(d.linkLabel);
  const pct = d.batteryPct;
  const battery =
    pct == null
      ? null
      : {
          text: `${Math.round(pct)}%${d.charging ? ", charging" : ""}`,
          tone: pct < 20 && !d.charging ? "warn" : "on",
        };

  return (
    <Sheet open={open} title="Device" sub="Wi-Fi, sound, battery and app control" onClose={onClose}>
      <div className="sp-sheet">
        <Group title="Connections">
          <ActionRow
            icon="wifi"
            title="Wi-Fi"
            readout={net?.text}
            tone={net?.tone}
            leaves
            onClick={() => openSettings("wifi")}
          />
          <ActionRow
            icon="bluetooth"
            title="Bluetooth"
            leaves
            onClick={() => openSettings("bluetooth")}
          />
        </Group>
        <Group title="Sound">
          <ActionRow
            icon="volumeOff"
            title="Mute media"
            desc="Sets music and video volume to zero. Calls and alarms still ring."
            onClick={async () => setNote(await runAction({ type: "power", command: "mute" }))}
          />
          {note?.summary && (
            <div className="sp-field">
              <span className={`sp-desc ${note.ok === false ? "skill-err" : "skill-out"}`}>
                {note.summary}
              </span>
            </div>
          )}
          <ActionRow
            icon="volume"
            title="Sound settings"
            leaves
            onClick={() => openSettings("sound")}
          />
        </Group>
        <Group title="Battery">
          <ActionRow
            icon="battery"
            title="Battery settings"
            readout={battery?.text}
            tone={battery?.tone}
            leaves
            onClick={() => openSettings("battery")}
          />
        </Group>
        <Group title="Phone">
          <ActionRow
            icon="hand"
            title="App control"
            desc="Lets JARVIS tap and type in other apps. Turn on JARVIS in Accessibility."
            readout={appControlOn == null ? undefined : appControlOn ? "On" : "Off"}
            tone={appControlOn ? "on" : "warn"}
            leaves
            onClick={() => {
              onClose();
              runAction({ type: "open_a11y_settings" });
            }}
          />
          <ActionRow
            icon="settings"
            title="All settings"
            leaves
            onClick={() => openSettings("settings")}
          />
        </Group>
        <p className="sp-desc sp-sheet-note">
          Android doesn&apos;t let apps shut down or restart the phone.
        </p>
      </div>
    </Sheet>
  );
}

/* ───────── Conversation ───────── */
// One message, memoized: during streaming only the live message's object identity
// changes (useWebSocket replaces just that entry), so finalized messages skip both
// re-render and ResponseRenderer's re-parse. runAction is a stable useCallback.
const ChatMessage = memo(function ChatMessage({ m, runAction, onCopy }) {
  const user = m.role === "user";
  return (
    <div className={`cv-msg cv-msg--${user ? "user" : "jarvis"}`}>
      <span className="sp-sr">{user ? "You:" : "JARVIS:"}</span>
      <div className="cv-bubble">
        {user ? (
          <>
            {m.image && <img className="cv-photo" src={m.image} alt="Attached photo" />}
            {m.text}
          </>
        ) : (
          <ResponseRenderer text={m.text} actions={m.actions} runAction={runAction} />
        )}
      </div>
      {!user && !m.streaming && m.text && onCopy && (
        <button
          type="button"
          className="cv-copy"
          onClick={() => onCopy(m.text)}
          aria-label="Copy reply"
        >
          <Icon name="copy" size={13} />
          Copy
        </button>
      )}
    </div>
  );
});

// Relative "time ago" for the history list (ts is epoch seconds).
function timeAgo(ts) {
  if (!ts) return "";
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return d === 1 ? "yesterday" : `${d} days ago`;
  return `${Math.floor(d / 7)} wk ago`;
}

// Starters for an empty chat: one tap sends it.
const STARTERS = [
  "What's on my agenda today?",
  "What's the weather this week?",
  "Play lofi on YouTube",
  "What can you do?",
];

/** The agent row (brain/agents.ts): one chip per agent, each in its own colour; the PC's
 *  agents only while a PC is paired. Scrolls sideways. */
export function AgentRow({ active = "auto", pcPaired, onPick }) {
  const rowRef = useRef(null);
  // Keep the picked chip in view when the row is narrower than it.
  useEffect(() => {
    const row = rowRef.current;
    const chip = row?.querySelector(".is-on");
    if (chip)
      row.scrollLeft = Math.max(0, chip.offsetLeft - (row.clientWidth - chip.offsetWidth) / 2);
  }, [active]);
  return (
    <div className="agent-row" role="radiogroup" aria-label="Agent" ref={rowRef}>
      {agentsFor(pcPaired).map((a) => (
        <button
          key={a.id}
          type="button"
          role="radio"
          aria-checked={active === a.id}
          className={`agent-chip${active === a.id ? " is-on" : ""}`}
          style={{ "--agent": a.color }}
          title={`${a.hint} — or type @${a.handle}`}
          onClick={() => onPick?.(a.id)}
        >
          <span className="agent-dot" aria-hidden="true" />
          {a.name}
          {a.pc && a.id !== "research" && <span className="agent-pc">PC</span>}
        </button>
      ))}
    </div>
  );
}

export function ChatOverlay({
  open,
  onClose,
  status,
  messages = [],
  onSend,
  onStop,
  onUpload,
  runAction,
  onNotify,
  conversations = [],
  onNewChat,
  onOpenConversation,
  onDeleteConversation,
  onRefreshConversations,
  onClearConversations,
  prefill, // {text, n}: text to drop into the box (from Capabilities); n makes repeats count
  onListen, // phone: the composer's mic (the HUD's mic button is hidden under this sheet)
  conversationMode,
  onConversationMode,
  agentMode = false, // the agent row (brain/agents.ts) and the header's Agents switch
  activeAgent = "auto",
  pcPaired = false,
  onPickAgent,
  onToggleAgents,
}) {
  const [draft, setDraft] = useState("");
  const [histOpen, setHistOpen] = useState(false);
  const [histQuery, setHistQuery] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null); // id awaiting its confirming second tap
  const bodyRef = useRef(null);
  const fileRef = useRef(null);
  const inputRef = useRef(null);

  // A Capabilities example lands in the box, ready to edit or send. Adjusted while
  // rendering (not in an effect) so the box never paints with the old draft first.
  const [seenPrefill, setSeenPrefill] = useState(prefill);
  if (prefill !== seenPrefill) {
    setSeenPrefill(prefill);
    if (prefill?.text) {
      setDraft(prefill.text);
      setHistOpen(false);
    }
  }
  useEffect(() => {
    if (open && prefill?.text) inputRef.current?.focus();
  }, [open, prefill]);

  const startNewChat = () => {
    onNewChat?.();
    setHistOpen(false);
  };
  const showHistory = () => {
    setConfirmClear(false);
    setConfirmDel(null);
    setHistQuery("");
    onRefreshConversations?.();
    setHistOpen(true);
  };
  const openConv = (id) => {
    onOpenConversation?.(id);
    setHistOpen(false);
  };
  // Two taps so a stray one can't wipe the whole archive.
  const clearAll = () => {
    if (!confirmClear) return setConfirmClear(true);
    onClearConversations?.();
    setConfirmClear(false);
  };

  const pickFile = (e) => {
    const file = e.target.files?.[0];
    if (file && onUpload) onUpload(file, draft.trim());
    setDraft("");
    e.target.value = ""; // allow re-selecting the same file
  };

  // Keep the newest message in view.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages, status, open, histOpen]);

  // Mid-reply (thinking/working, speaking it, or a message still streaming): Stop
  // replaces Send. The brain drops a message sent mid-reply, so the draft stays put.
  const busy =
    status === "thinking" ||
    status === "working" ||
    status === "speaking" ||
    messages.some((m) => m.streaming);

  const send = (text = draft) => {
    const t = text.trim();
    if (!t || busy) return;
    onSend(t);
    setDraft("");
  };
  const copy = useCallback(
    (text) => {
      navigator.clipboard
        ?.writeText(text)
        .then(() => onNotify?.("Copied"))
        .catch(() => {});
    },
    [onNotify],
  );
  const hq = histQuery.trim().toLowerCase();
  const shownConvs = hq
    ? conversations.filter((c) => (c.title || "").toLowerCase().includes(hq))
    : conversations;

  if (histOpen) {
    return (
      <Sheet
        open={open}
        title="Recent chats"
        onClose={onClose}
        onBack={() => setHistOpen(false)}
        backLabel="Conversation"
      >
        <div className="sp-sheet">
          <h2 className="sp-page-title">Recent chats</h2>
          <button type="button" className="sp-btn cv-newchat" onClick={startNewChat}>
            <Icon name="plus" size={16} />
            New chat
          </button>
          {conversations.length > 0 && (
            <label className="sp-search">
              <Icon name="search" size={16} />
              <input
                type="search"
                value={histQuery}
                onChange={(e) => setHistQuery(e.target.value)}
                placeholder="Search saved chats…"
                aria-label="Search saved chats"
              />
            </label>
          )}
          {conversations.length === 0 ? (
            <StateMessage variant="empty" icon="history" title="No saved chats yet">
              Start a new chat and the current one is saved here.
            </StateMessage>
          ) : shownConvs.length === 0 ? (
            <p className="sp-none">No saved chat matches “{histQuery}”.</p>
          ) : (
            <Group title="Saved chats">
              {shownConvs.map((c) => (
                <div key={c.id} className="sp-field cv-hist-row">
                  <button type="button" className="cv-hist-open" onClick={() => openConv(c.id)}>
                    <span className="sp-label">{c.title}</span>
                    <span className="sp-desc">
                      {timeAgo(c.ts)}
                      {c.count ? `, ${c.count} message${c.count === 1 ? "" : "s"}` : ""}
                    </span>
                  </button>
                  {/* Two taps, as on the desktop: a stray one can't lose a chat. */}
                  <button
                    type="button"
                    className={`cv-hist-del${confirmDel === c.id ? " is-armed" : ""}`}
                    aria-label={
                      confirmDel === c.id
                        ? `Tap again to delete “${c.title}”`
                        : `Delete “${c.title}”`
                    }
                    onClick={() => {
                      if (confirmDel !== c.id) return setConfirmDel(c.id);
                      setConfirmDel(null);
                      onDeleteConversation?.(c.id);
                    }}
                    onBlur={() => confirmDel === c.id && setConfirmDel(null)}
                  >
                    {confirmDel === c.id ? "Delete?" : <Icon name="trash" size={17} />}
                  </button>
                </div>
              ))}
            </Group>
          )}
          {conversations.length > 0 && (
            <button
              type="button"
              className={`sp-btn sp-btn--quiet cv-clearall ${confirmClear ? "is-armed" : ""}`}
              onClick={clearAll}
              onBlur={() => setConfirmClear(false)}
            >
              {confirmClear ? "Tap again to delete all" : "Delete all saved chats"}
            </button>
          )}
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      open={open}
      title="Conversation"
      sub={
        messages.length
          ? `${messages.length} message${messages.length === 1 ? "" : "s"} in this chat`
          : "A new chat"
      }
      onClose={onClose}
      className="sp--chat"
      bodyRef={bodyRef}
      actions={
        <>
          {onConversationMode && (
            <HeaderButton
              icon="talk"
              label={
                conversationMode
                  ? "Conversation mode on: short, natural replies"
                  : "Conversation mode: short, natural replies"
              }
              pressed={Boolean(conversationMode)}
              onClick={() => onConversationMode(!conversationMode)}
            />
          )}
          {onToggleAgents && (
            <HeaderButton
              icon="route"
              label={agentMode ? "Agents on: pick one below" : "Agents: pick who handles a request"}
              pressed={agentMode}
              onClick={onToggleAgents}
            />
          )}
          <HeaderButton icon="history" label="Recent chats" onClick={showHistory} />
          <HeaderButton icon="plus" label="New chat (saves this one)" onClick={startNewChat} />
        </>
      }
      footer={
        <div className="cv-foot-stack">
          {agentMode && <AgentRow active={activeAgent} pcPaired={pcPaired} onPick={onPickAgent} />}
          <div className="cv-compose">
            {onUpload && (
              <>
                {/* The phone's brain only reads photos; the desktop backend takes documents too. */}
                <input
                  ref={fileRef}
                  type="file"
                  accept={IS_MOBILE ? "image/*" : "image/*,.pdf,.txt,.md,.csv,.json,.log"}
                  onChange={pickFile}
                  hidden
                />
                <button
                  type="button"
                  className="cv-attach"
                  aria-label={IS_MOBILE ? "Attach a photo" : "Attach an image or document"}
                  title={IS_MOBILE ? "Attach a photo" : "Attach an image or document"}
                  disabled={busy}
                  onClick={() => fileRef.current?.click()}
                >
                  <Icon name="paperclip" size={20} />
                </button>
              </>
            )}
            <input
              ref={inputRef}
              className="sp-input cv-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder={
                agentMode && activeAgent !== "auto"
                  ? `Message the ${agentById(activeAgent).name} agent`
                  : "Message JARVIS (@ picks an agent)"
              }
              aria-label="Message JARVIS"
            />
            {busy && onStop ? (
              <button
                type="button"
                className="cv-send cv-send--stop"
                aria-label="Stop"
                onClick={onStop}
              >
                <Icon name="stop" size={18} />
              </button>
            ) : IS_MOBILE && onListen && (status === "listening" || !draft.trim()) ? (
              // Empty box → talk instead; tapping again while listening sends what was said.
              <button
                type="button"
                className={`cv-send ${status === "listening" ? "cv-send--listening" : ""}`}
                aria-label={status === "listening" ? "Stop and send" : "Talk"}
                onClick={onListen}
              >
                <Icon name={status === "listening" ? "stop" : "mic"} size={19} />
              </button>
            ) : (
              <button
                type="button"
                className="cv-send"
                aria-label="Send"
                disabled={!draft.trim()}
                onClick={() => send()}
              >
                <Icon name="send" size={19} />
              </button>
            )}
          </div>
        </div>
      }
    >
      <div className="cv" aria-live="polite">
        {messages.map((m) => (
          <ChatMessage key={m.id} m={m} runAction={runAction} onCopy={copy} />
        ))}
        {/* Until you've said something — the launch greeting alone used to hide these. */}
        {!messages.some((m) => m.role === "user") && (
          <div className="cv-empty">
            {messages.length === 0 && <p className="cv-empty-title">Standing by, sir.</p>}
            <p className="sp-desc">
              Ask me anything — type below, tap the mic, or say “Hey Jarvis”.
            </p>
            <div className="cv-starters">
              {STARTERS.map((t) => (
                <button key={t} type="button" className="cv-starter" onClick={() => send(t)}>
                  <Icon name="chevRight" size={14} />
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}
        {status === "thinking" && (
          <div className="cv-msg cv-msg--jarvis">
            <span className="sp-sr">JARVIS is thinking</span>
            <div className="cv-typing" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}
