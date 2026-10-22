import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import Icon from "./Icon";
import Orb from "../hud/Orb";
import { useAndroidBack } from "../hooks/useAndroidBack";
import { checkKey } from "../brain/providers/models";
import { extractProjectId } from "../brain/providers/vertexAuth";
import { splitKeys } from "../brain/resolveConfig";
import { inTauri } from "../brain/tools/httpClient";
import "./onboarding.css";

/* ANDROID FORK first-run setup. Step 1 picks how JARVIS reaches a model (free keys,
 * or a Google Cloud service account); step 2 takes the credentials and checks each
 * one against its provider as it is pasted, so a bad key shows up here instead of
 * as a failed first conversation. */

const PROVIDERS = {
  groq: { name: "Groq", url: "https://console.groq.com/keys", host: "console.groq.com" },
  gemini: {
    name: "Google AI Studio",
    url: "https://aistudio.google.com/apikey",
    host: "aistudio.google.com",
  },
  vertex: {
    name: "Google Cloud",
    url: "https://console.cloud.google.com/iam-admin/serviceaccounts",
    host: "console.cloud.google.com",
  },
};

// The phone's browser, not JARVIS's own WebView (same command as the update notice).
function openExternal(e, url) {
  if (!inTauri()) return; // browser preview: the link's own target=_blank opens it
  e.preventDefault();
  void invoke("plugin:phone|open_url", { url }).catch(() => {});
}

/** Live verdict for one field: empty | checking | ok | unverified | partial | rejected. */
function useKeyCheck(provider, raw) {
  const keys = useMemo(
    () => (provider === "vertex" ? [raw.trim()].filter(Boolean) : splitKeys(raw)),
    [provider, raw],
  );
  const [done, setDone] = useState({ raw: null, states: [] });
  useEffect(() => {
    if (!keys.length) return undefined;
    let live = true;
    // Wait for typing/pasting to settle so each keystroke isn't a network call.
    const t = setTimeout(() => {
      void Promise.all(keys.map((k) => checkKey(provider, k))).then(
        (states) => live && setDone({ raw, states }),
      );
    }, 600);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [provider, raw, keys]);

  const total = keys.length;
  if (!total) return { state: "empty", total };
  if (done.raw !== raw) return { state: "checking", total };
  const count = (s) => done.states.filter((x) => x === s).length;
  const bad = count("rejected");
  const state =
    bad === total ? "rejected" : bad ? "partial" : count("ok") === total ? "ok" : "unverified";
  return { state, total, bad };
}

const usable = (c) => c.state === "ok" || c.state === "unverified" || c.state === "partial";

function lampText({ state, total, bad }, okText) {
  switch (state) {
    case "empty":
      return "Not added";
    case "checking":
      return "Checking…";
    case "ok":
      return okText || (total > 1 ? `${total} keys working` : "Working");
    case "unverified":
      return "Couldn't check";
    case "partial":
      return `${bad} of ${total} not accepted`;
    default:
      return "Not accepted";
  }
}

function fieldNote(provider, { state, total }) {
  const p = PROVIDERS[provider];
  if (state === "rejected" || state === "partial") {
    if (provider === "vertex") {
      return "Google Cloud didn't accept this. Use the service account's JSON key file exactly as downloaded.";
    }
    return `${p.name} didn't accept ${total > 1 ? "one of these keys" : "this key"}. Copy it again from ${p.host}.`;
  }
  if (state === "unverified") {
    return `Couldn't reach ${p.name} to check. It will be tried when you start.`;
  }
  return "";
}

function KeyField({ provider, label, purpose, optional, value, onChange, check, okText, json }) {
  const p = PROVIDERS[provider];
  const note = fieldNote(provider, check);
  const readFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // picking the same file again should still fire
    if (file) onChange(await file.text());
  };
  return (
    <section className={`ob-field ob-field--${check.state}`}>
      <div className="ob-field-hd">
        <div className="ob-field-title">
          <span className="ob-field-name">
            {label}
            {optional && <span className="ob-opt">Optional</span>}
          </span>
          <span className="ob-field-purpose">{purpose}</span>
        </div>
        <span className={`ob-lamp ob-lamp--${check.state}`}>{lampText(check, okText)}</span>
      </div>
      <textarea
        className={`ob-input${json ? " ob-input--json" : ""}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={json ? '{ "type": "service_account", … }' : "Paste your key"}
        rows={json ? 4 : 1}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        aria-label={json ? `${label} JSON key` : `${label} API key`}
      />
      {note && (
        <p className="ob-note" role={check.state === "unverified" ? undefined : "alert"}>
          {note}
        </p>
      )}
      <div className="ob-field-actions">
        <a
          className="ob-link"
          href={p.url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => openExternal(e, p.url)}
        >
          {json ? "Open Google Cloud" : "Get a free key"}
          <Icon name="external" size={14} />
        </a>
        {json && (
          <label className="ob-link">
            Choose file
            <Icon name="folder" size={14} />
            <input type="file" className="ob-file" onChange={readFile} />
          </label>
        )}
      </div>
    </section>
  );
}

function Privacy() {
  return (
    <p className="ob-privacy">
      <Icon name="lock" size={14} />
      Keys are encrypted on this phone and only ever sent to the provider they belong to.
    </p>
  );
}

export default function MobileOnboarding({ onSave }) {
  const [path, setPath] = useState(null); // null = choose | "keys" | "vertex"
  const [groq, setGroq] = useState("");
  const [gemini, setGemini] = useState("");
  const [vertex, setVertex] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  useAndroidBack(path !== null, () => setPath(null));

  const groqCheck = useKeyCheck("groq", groq);
  const geminiCheck = useKeyCheck("gemini", gemini);
  const vertexCheck = useKeyCheck("vertex", vertex);

  const isVertex = path === "vertex";
  const fields = isVertex ? [vertexCheck, groqCheck] : [groqCheck, geminiCheck];
  const required = isVertex ? [vertexCheck] : fields;
  const checking = fields.some((c) => c.state === "checking");
  // A field you filled that nothing in accepted would only fail later, mid-sentence.
  const blocked = fields.some((c) => c.state === "rejected");
  const ready = required.some(usable);
  const canStart = ready && !checking && !blocked && !saving;

  const startLabel = saving
    ? "Starting…"
    : checking
      ? "Checking keys…"
      : blocked
        ? "Fix the key marked above"
        : !ready
          ? isVertex
            ? "Add your service account"
            : "Add a key to continue"
          : "Start JARVIS";

  const start = async () => {
    if (!canStart) return;
    const keys = (raw) => splitKeys(raw).join("\n");
    const cfg = { provider_mode: isVertex ? "vertex" : "auto" };
    if (isVertex) cfg.vertex_sa_json = vertex.trim();
    if (keys(groq)) cfg.groq_api_key = keys(groq);
    if (!isVertex && keys(gemini)) cfg.gemini_api_key = keys(gemini);
    setSaving(true);
    setSaveFailed(false);
    // Success flips needs_setup and unmounts this screen; only a failure lands here.
    if ((await onSave(cfg)) === false) {
      setSaving(false);
      setSaveFailed(true);
    }
  };

  if (!path) {
    return (
      <div className="ob" role="dialog" aria-modal="true" aria-labelledby="ob-title">
        <div className="ob-inner ob-inner--intro">
          <header className="ob-hero">
            <div className="ob-orb">
              <Orb label="JARVIS" />
            </div>
            <div className="ob-word">J.A.R.V.I.S</div>
            <h1 id="ob-title" className="ob-title">
              Let&apos;s get you set up
            </h1>
            <p className="ob-lede">
              JARVIS thinks with a cloud AI model. Connect one and it can talk with you, use your
              apps, and run your PC and TV.
            </p>
          </header>

          <div className="ob-choices">
            <button type="button" className="ob-choice" onClick={() => setPath("keys")}>
              <span className="ob-choice-ic">
                <Icon name="key" size={22} />
              </span>
              <span className="ob-choice-body">
                <span className="ob-choice-name">
                  Free API keys <span className="ob-tag">Recommended</span>
                </span>
                <span className="ob-choice-desc">
                  Groq and Google AI Studio. No card needed, about two minutes.
                </span>
              </span>
              <Icon name="chevronRight" size={18} className="ob-choice-go" />
            </button>
            <button type="button" className="ob-choice" onClick={() => setPath("vertex")}>
              <span className="ob-choice-ic">
                <Icon name="cloud" size={22} />
              </span>
              <span className="ob-choice-body">
                <span className="ob-choice-name">Google Cloud</span>
                <span className="ob-choice-desc">
                  Vertex AI on your Google Cloud credit. Needs a service account key file.
                </span>
              </span>
              <Icon name="chevronRight" size={18} className="ob-choice-go" />
            </button>
          </div>

          <Privacy />
        </div>
      </div>
    );
  }

  return (
    <div className="ob" role="dialog" aria-modal="true" aria-labelledby="ob-title">
      <div className="ob-inner" key={path}>
        <nav className="ob-nav">
          <button type="button" className="ob-back" onClick={() => setPath(null)}>
            <Icon name="chevronLeft" size={18} />
            Back
          </button>
          <span className="ob-crumb">{isVertex ? "Google Cloud" : "Free API keys"}</span>
        </nav>

        <h1 id="ob-title" className="ob-title">
          {isVertex ? "Connect Google Cloud" : "Add your keys"}
        </h1>
        <p className="ob-lede">
          {isVertex
            ? "Paste or pick the JSON key of a service account that has the Vertex AI User role."
            : "One is enough to start. With both, JARVIS gets voice, chat and web search."}
        </p>

        {isVertex ? (
          <>
            <KeyField
              provider="vertex"
              label="Service account"
              purpose="Gemini chat and voice on Vertex AI"
              value={vertex}
              onChange={setVertex}
              check={vertexCheck}
              okText={extractProjectId(vertex) || undefined}
              json
            />
            <details className="ob-how">
              <summary>How do I get this file?</summary>
              <ol>
                <li>In Google Cloud, open IAM &amp; Admin → Service accounts.</li>
                <li>Create a service account and give it the Vertex AI User role.</li>
                <li>Open it, then Keys → Add key → Create new key → JSON.</li>
                <li>Pick the downloaded file here with Choose file.</li>
              </ol>
            </details>
            <KeyField
              provider="groq"
              label="Groq"
              purpose="Faster voice recognition with Whisper"
              optional
              value={groq}
              onChange={setGroq}
              check={groqCheck}
            />
          </>
        ) : (
          <>
            <KeyField
              provider="groq"
              label="Groq"
              purpose="Voice, “Hey Jarvis” and fast chat"
              value={groq}
              onChange={setGroq}
              check={groqCheck}
            />
            <KeyField
              provider="gemini"
              label="Google AI Studio"
              purpose="Gemini chat, web search and images"
              value={gemini}
              onChange={setGemini}
              check={geminiCheck}
            />
            {groqCheck.state === "empty" && usable(geminiCheck) && (
              <p className="ob-hint">
                <Icon name="mic" size={15} />
                Without a Groq key JARVIS can&apos;t hear you, so you&apos;ll type instead. You can
                add one later in Settings.
              </p>
            )}
            <p className="ob-hint">
              <Icon name="info" size={15} />
              Got several keys? Put one per line. Free limits count per key, so JARVIS moves to the
              next when one runs out.
            </p>
          </>
        )}

        <div className="ob-foot">
          {saveFailed && (
            <p className="ob-error" role="alert">
              Couldn&apos;t save to this phone&apos;s secure storage. Try again.
            </p>
          )}
          <button type="button" className="ob-start" disabled={!canStart} onClick={start}>
            {startLabel}
          </button>
          <Privacy />
        </div>
      </div>
    </div>
  );
}
