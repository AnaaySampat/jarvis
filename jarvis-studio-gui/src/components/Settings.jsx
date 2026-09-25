import { useState, useEffect } from "react";
import { IS_MOBILE } from "../hooks/useAssistant";
import { getGrantedFolder, pickGrantedFolder, requestCalendarPermission } from "../brain/platform";
import { modelClassFor } from "../brain/modelPolicy";
import * as quota from "../brain/quota";
import Icon from "./Icon";
import StateMessage from "./StateMessage";
import { Field, Group, More, Toggle, WIDE_QUERY, Warn } from "./Sheet";
import { useAndroidBack } from "../hooks/useAndroidBack";

// Fallback model groups — used only until the backend's per-key discovery arrives
// via sysInfo.available_models (Phase 3), which lists ONLY models the active keys
// can actually serve (Vertex curated / Gemini-key / Groq / local Ollama). Kept
// deliberately tiny; the live discovered list supersedes it.
const FALLBACK_GROUPS = [
  { label: "Auto", opts: [{ value: "auto", label: "Auto — pick the best model per request" }] },
];

const MOBILE_FALLBACK_GROUPS = [
  { label: "Auto", opts: [{ value: "auto", label: "Auto — pick the best free-tier model" }] },
];

const TTS_OPTS = [
  { value: "piper", label: "Piper — offline neural voice, free", short: "Piper" },
  { value: "elevenlabs", label: "ElevenLabs — premium cloud, needs a key", short: "ElevenLabs" },
  { value: "chirp", label: "Google Chirp 3 HD — on your GCP credits", short: "Chirp 3 HD" },
  { value: "edge-tts", label: "Edge TTS — online", short: "Edge TTS" },
  { value: "pyttsx3", label: "pyttsx3 — offline, robotic", short: "pyttsx3" },
  { value: "off", label: "Off", short: "Off" },
];

const PROVIDER_NAME = {
  auto: "Auto",
  vertex: "Vertex AI",
  gemini: "Gemini",
  groq: "Groq",
  openrouter: "OpenRouter",
  nvidia: "NVIDIA NIM",
  mistral: "Mistral",
  offline: "Offline",
};

const isGemini = (m) => /^(gemini|gemma)/i.test(m || "");

/* ── Building blocks (shared ones live in Sheet.jsx) ─────────────────────────── */

/** Two-click Remove for a saved key (the first click arms, the second deletes). */
function RemoveKey({ name, configured, onSave }) {
  const [armed, setArmed] = useState(false);
  if (!configured) return null;
  return (
    <button
      type="button"
      className={`key-remove ${armed ? "key-remove--armed" : ""}`}
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        onSave({ [name]: "" }); // an empty value deletes the stored secret
      }}
      onBlur={() => setArmed(false)}
      title="Delete this saved key"
    >
      {armed ? "Confirm remove" : "Remove"}
    </button>
  );
}

/** A secret: name, whether one is stored, and a write-only field to replace it. */
function KeyField({
  label,
  note,
  configured,
  status,
  value,
  onChange,
  placeholder,
  multiline,
  removeName,
  onSave,
}) {
  const Input = multiline ? "textarea" : "input";
  return (
    <div className="sp-field sp-key">
      <div className="sp-key-hd">
        <span className="sp-label">{label}</span>
        <span className={`sp-lamp ${configured ? "sp-lamp--on" : ""}`}>
          {status || (configured ? "Connected" : "Not set")}
        </span>
        {removeName && <RemoveKey name={removeName} configured={configured} onSave={onSave} />}
      </div>
      {note && <div className="sp-desc">{note}</div>}
      <Input
        className="sp-input sp-mono"
        type={multiline ? undefined : "password"}
        rows={multiline ? 2 : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={configured ? "Saved. Paste a new key to replace it" : placeholder}
        autoComplete="off"
        spellCheck={false}
      />
    </div>
  );
}

/* ── Routing + quota readouts ──────────────────────────────────────────────── */

/**
 * Free-tier route health.
 *
 * JARVIS benches a model+key after a 429 and skips it until it recovers, which is
 * what stops the free tier dead-ending on rate limits. Without this panel that is
 * entirely invisible: "I've used up the free quota, back in about 4 minutes" is
 * unverifiable, and a route benched for a day off one bad window has no way back
 * short of re-saving your keys. Read-only apart from the reset.
 */
function QuotaPanel() {
  const [snap, setSnap] = useState(() => quota.snapshot());
  // Countdowns go stale on their own, so re-read while the panel is open.
  useEffect(() => {
    const t = setInterval(() => setSnap(quota.snapshot()), 5000);
    return () => clearInterval(t);
  }, []);

  const benched = snap.benched ?? [];
  const remaining = Object.entries(snap.remaining ?? {});

  const label = (s) => {
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.round(s / 60)} min`;
    if (s < 86400) return `${Math.round(s / 3600)}h`;
    return "tomorrow";
  };

  return (
    <Group title="Rate limits">
      <div className="sp-field">
        {benched.length === 0 ? (
          <div className="sp-status">
            <span className="sp-lamp sp-lamp--on">All routes available</span>
          </div>
        ) : (
          <>
            <div className="sp-status">
              <span className="sp-lamp sp-lamp--warn">
                {benched.length} resting after a rate limit
              </span>
              <button
                type="button"
                className="sp-btn sp-btn--quiet"
                onClick={() => {
                  quota.clear();
                  setSnap(quota.snapshot());
                }}
              >
                Clear all
              </button>
            </div>
            <div className="sp-table">
              {benched.map((b) => (
                <div className="quota-row" key={`${b.route}`}>
                  <span className="quota-route">{b.route.split("\u001f").join(" / ")}</span>
                  <span className="quota-eta">back in {label(b.secondsLeft)}</span>
                </div>
              ))}
            </div>
          </>
        )}
        {remaining.length > 0 && (
          <div className="sp-desc">
            Reported remaining:{" "}
            {remaining.map(([k, v]) => `${k.split("\u001f").pop()} ${v}`).join(", ")}
          </div>
        )}
        <More>
          A route is one model on one key. After a rate limit JARVIS rests that route and uses the
          next one instead of failing. Clearing only helps if you&apos;ve fixed the cause.
        </More>
      </div>
    </Group>
  );
}

/**
 * Smart routing (brain/modelRanker.ts). Every model the keys reach is ranked from
 * benchmarks (an LLM with Google Search only estimates the ones the catalog lacks);
 * each request goes to the weakest model that is still good enough, falling through
 * to the next on failure. Re-ranked on its own whenever a key is added or removed.
 */
const TIER_LABEL = { fast: "Fast", mid: "Everyday", flagship: "Flagship" };
const SOURCE_LABEL = { benchmark: "Benchmark", llm: "Estimated", guess: "Unscored" };

function RoutingSection({ routing, onRerank }) {
  const r = routing || {};
  const models = r.models || [];
  const c = r.counts || {};
  return (
    <Group title="Model ranking">
      <div className="sp-field">
        <div className="sp-status">
          <span className={`sp-lamp ${models.length ? "sp-lamp--on" : ""}`}>
            {r.in_progress
              ? "Ranking…"
              : models.length
                ? `${models.length} models ranked`
                : "Not ranked yet"}
          </span>
          {onRerank && (
            <button
              type="button"
              className="sp-btn sp-btn--quiet"
              disabled={!!r.in_progress}
              onClick={onRerank}
              title="Re-read every provider's models and look up the ones without benchmark data again"
            >
              {r.in_progress ? "Ranking…" : "Re-rank"}
            </button>
          )}
        </div>
        {/* The last ranking run's own outcome already carries the counts, so it
            replaces the computed summary instead of repeating it. */}
        {models.length === 0 && !r.in_progress ? (
          <div className="sp-desc">
            JARVIS ranks your models once it can see them. Until then it uses its built-in Gemini
            and Groq tiers.
          </div>
        ) : (
          !r.in_progress && (
            <div className="sp-desc">
              {r.last_result ||
                `${c.benchmark || 0} of ${models.length} scored from benchmarks` +
                  (c.llm ? `, ${c.llm} estimated` : "") +
                  (c.guess ? `, ${c.guess} not scored yet` : "") +
                  "."}
            </div>
          )
        )}
      </div>
      {models.length > 0 && (
        <div className="route-list">
          {models.map((m, i) => (
            <div className="route-row" key={`${m.provider}/${m.model}`} title={m.basis || ""}>
              <span className="route-n">{i + 1}</span>
              <span className="route-id">{m.model}</span>
              <span className={`route-tier route-tier--${m.tier}`}>
                {TIER_LABEL[m.tier] || m.tier}
              </span>
              <span className="route-score">{m.score}</span>
              <span className={`route-note route-src--${m.source}`}>
                {m.provider}, {(SOURCE_LABEL[m.source] || m.source).toLowerCase()}
                {m.basis ? ` (${m.basis})` : ""}
                {!m.tools ? ". Chat only, no tool calling" : ""}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="sp-field">
        <More>
          Each request gets the weakest tier that can handle it: quick chat goes to Fast, everyday
          commands to Everyday, hard reasoning to Flagship. If that model fails or hits a rate
          limit, the next one in line takes over, then stronger tiers, then weaker. The ranking
          refreshes on its own when you add or remove a key.
          <br />
          <br />
          Scores come from the Artificial Analysis Intelligence Index ({r.catalog ||
            "benchmark"}{" "}
          snapshot). Models it doesn&apos;t cover are estimated by {r.estimated_by || "an LLM"} with
          Google Search when you press Re-rank.
        </More>
      </div>
    </Group>
  );
}

/* ── Settings ──────────────────────────────────────────────────────────────── */

export default function Settings({
  sysInfo,
  onClose,
  onSave,
  onSetLocation,
  onRefreshModels,
  onRerankModels,
  onRepairSetup,
}) {
  // Re-discover models when the panel opens so the dropdown is current (e.g. a
  // local Ollama model pulled since launch, or a key just added in another client).
  // Cheap — the backend skips the network when credentials are unchanged.
  useEffect(() => {
    onRefreshModels && onRefreshModels();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once per open, not per sysInfo change

  // ponytail: read once on open; resizing across the breakpoint mid-session keeps the first layout.
  const [wide] = useState(() => window.matchMedia?.(WIDE_QUERY).matches ?? false);
  const [page, setPage] = useState(wide ? "models" : null);

  // Android back: leave the page first, then close Settings.
  useAndroidBack(true, () => (!wide && page ? setPage(null) : onClose()));

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Prefer the backend's per-key discovered list; fall back to the curated set
  // until it lands. Both share the {label, opts:[{value,label}]} shape.
  const modelGroups =
    Array.isArray(sysInfo.available_models) && sysInfo.available_models.length
      ? sysInfo.available_models
      : IS_MOBILE
        ? MOBILE_FALLBACK_GROUPS
        : FALLBACK_GROUPS;
  const allValues = modelGroups.flatMap((g) =>
    g.opts.filter((o) => o.selectable !== false).map((o) => o.value),
  );
  // Local (Ollama) models discovered by the backend — the offline-mode picker.
  const localOpts = modelGroups.find((g) => /ollama|local/i.test(g.label))?.opts ?? [];
  // "" means no override, which the brain treats exactly like "auto".
  const [model, setModel] = useState((sysInfo.model_override ?? sysInfo.model) || "auto");
  // Provider EDITION: vertex | gemini | groq (| offline on desktop). Keep the
  // reported mode verbatim — coercing vertex→gemini silently kicked mobile users
  // off their Vertex AI (GCP credit) tier every time they saved Settings.
  const [providerMode, setProviderMode] = useState(
    sysInfo.provider_mode || (IS_MOBILE ? "auto" : "groq"),
  );
  const [wakeWordOn, setWakeWordOn] = useState(sysInfo.wake_word !== false);
  const [autoSwitch, setAutoSwitch] = useState(sysInfo.auto_switch_models !== false);
  const [offlineModel, setOfflineModel] = useState(sysInfo.offline_model ?? "");
  const [ollamaUrl, setOllamaUrl] = useState(sysInfo.ollama_url ?? "http://localhost:11434");
  const [locInput, setLocInput] = useState("");
  const [grantedFolder, setGrantedFolderState] = useState(() => getGrantedFolder());
  const chooseFolder = async () => {
    const res = await pickGrantedFolder();
    if (res.ok && res.folder) setGrantedFolderState(res.folder);
  };
  const pinnedLoc = sysInfo.manual_location; // {lat,lon,label} or null = automatic
  const pinLocation = () => {
    const p = locInput.trim();
    if (p && onSetLocation) {
      onSetLocation({ place: p });
      setLocInput("");
    }
  };
  const [tts, setTts] = useState(sysInfo.tts ?? "piper");
  const [dirs, setDirs] = useState(sysInfo.allowed_dirs ?? []);
  const [newDir, setNewDir] = useState("");
  const [storageDir, setStorageDir] = useState(sysInfo.storage_dir ?? "");
  const [vertexSaJson, setVertexSaJson] = useState("");
  const [groqKey, setGroqKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [openrouterKey, setOpenrouterKey] = useState("");
  const [mistralKey, setMistralKey] = useState("");
  const [nvidiaKey, setNvidiaKey] = useState("");
  const [elevenKey, setElevenKey] = useState("");
  const [mapsKey, setMapsKey] = useState("");
  const [sysAlerts, setSysAlerts] = useState(!!sysInfo.system_alerts);
  const [calendarSync, setCalendarSync] = useState(sysInfo.calendar_sync !== false);
  const [autopilotModel, setAutopilotModel] = useState(sysInfo.autopilot_model ?? "");
  const [autopilotThinking, setAutopilotThinking] = useState(
    (sysInfo.autopilot_thinking ?? -1) === 0 ? "off" : "dynamic",
  );
  const [autopilotVision, setAutopilotVision] = useState(sysInfo.autopilot_vision !== false);
  const [ovlEnabled, setOvlEnabled] = useState(sysInfo.overlay?.enabled !== false);
  const [ovlApps, setOvlApps] = useState(sysInfo.overlay?.apps ?? []);
  // Preserve whatever mode is in effect (it can be changed by voice via
  // set_overlay) so saving Settings doesn't silently reset it to "except".
  const [ovlMode] = useState(sysInfo.overlay?.mode ?? "except");
  const [newApp, setNewApp] = useState("");

  const addApp = () => {
    const a = newApp
      .trim()
      .toLowerCase()
      .replace(/\.exe$/, "");
    if (a && !ovlApps.includes(a)) setOvlApps([...ovlApps, a]);
    setNewApp("");
  };
  const removeApp = (a) => setOvlApps(ovlApps.filter((x) => x !== a));

  const addDir = () => {
    const d = newDir.trim().replace(/^["']|["']$/g, "");
    if (d && !dirs.includes(d)) setDirs([...dirs, d]);
    setNewDir("");
  };
  const removeDir = (d) => setDirs(dirs.filter((x) => x !== d));

  const buildCfg = () => {
    // Image models are intentionally not chat models. A hand-typed image id must
    // not sneak around the disabled entry in the model picker.
    const chatModel = modelClassFor(model) === "image" ? "auto" : model;
    const cfg = {
      model_override: chatModel,
      tts,
      allowed_dirs: dirs,
      system_alerts: sysAlerts,
      calendar_sync: calendarSync,
      overlay: { enabled: ovlEnabled, mode: ovlMode, apps: ovlApps },
      autopilot_model: autopilotModel.trim(),
      autopilot_thinking: autopilotThinking === "off" ? 0 : -1,
      autopilot_vision: autopilotVision,
      provider_mode: providerMode,
    };
    cfg.auto_switch_models = autoSwitch;
    if (IS_MOBILE) cfg.wake_word = wakeWordOn;
    // Offline-only fields — sent just for the offline edition so switching modes
    // doesn't trigger needless model re-discovery.
    if (providerMode === "offline") {
      cfg.offline_model = offlineModel.trim();
      cfg.ollama_url = ollamaUrl.trim();
    }
    if (storageDir.trim()) cfg.storage_dir = storageDir.trim();
    if (vertexSaJson.trim()) cfg.vertex_sa_json = vertexSaJson.trim();
    if (groqKey.trim()) cfg.groq_api_key = groqKey.trim();
    if (geminiKey.trim()) cfg.gemini_api_key = geminiKey.trim();
    if (openrouterKey.trim()) cfg.openrouter_api_key = openrouterKey.trim();
    if (mistralKey.trim()) cfg.mistral_api_key = mistralKey.trim();
    if (nvidiaKey.trim()) cfg.nvidia_api_key = nvidiaKey.trim();
    if (elevenKey.trim()) cfg.elevenlabs_api_key = elevenKey.trim();
    if (mapsKey.trim()) cfg.google_maps_key = mapsKey.trim();
    return cfg;
  };
  const cfgNow = JSON.stringify(buildCfg());
  const [cfgOnOpen] = useState(cfgNow);
  const dirty = cfgNow !== cfgOnOpen;

  const handleSave = () => {
    onSave(buildCfg());
    onRefreshModels && onRefreshModels();
    onClose();
  };

  const geminiSelected = isGemini(model);
  const nativeAudio = /native-audio/.test(model);
  const imageModelSelected = modelClassFor(model) === "image";

  /* ── Pages ── */

  const desktopModelsPage = (
    <>
      <Group title="Provider">
        <Field>
          <select
            className="sp-input"
            value={providerMode}
            onChange={(e) => setProviderMode(e.target.value)}
            aria-label="AI provider"
          >
            <option value="vertex">Vertex AI — Gemini on your Google Cloud credits</option>
            <option value="gemini">Gemini API key — with Groq as fallback</option>
            <option value="offline">Offline — a local Ollama model, no cloud</option>
          </select>
          {providerMode === "vertex" &&
            (sysInfo.has_vertex_sa ? (
              <div className="sp-desc">
                Billed to your Google Cloud project through your gcloud login. Login detected.
              </div>
            ) : (
              <Warn>
                No gcloud login found. Run <code>gcloud auth application-default login</code>.
              </Warn>
            ))}
          {providerMode === "gemini" &&
            (sysInfo.has_gemini_key ? (
              <div className="sp-desc">Gemini runs on your API key. Vertex stays off.</div>
            ) : (
              <Warn>Add a Gemini key in API keys.</Warn>
            ))}
        </Field>
        {providerMode === "offline" && (
          <>
            <Field
              label="Local model"
              hint="Slower and less capable than the cloud tiers. Commands still work."
            >
              <select
                className="sp-input"
                value={offlineModel}
                onChange={(e) => setOfflineModel(e.target.value)}
              >
                <option value="">Auto — first installed model</option>
                {localOpts.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {localOpts.length === 0 && (
                <Warn>
                  No local models at {ollamaUrl}. Install Ollama, then pull one, e.g.{" "}
                  <code>ollama pull llama3.1</code>.
                </Warn>
              )}
            </Field>
            <Field label="Ollama address">
              <input
                type="text"
                className="sp-input sp-mono"
                value={ollamaUrl}
                onChange={(e) => setOllamaUrl(e.target.value)}
                placeholder="http://localhost:11434"
              />
            </Field>
          </>
        )}
      </Group>

      <Group title="Chat model">
        <Field>
          <select
            className="sp-input"
            value={allValues.includes(model) ? model : "__custom"}
            onChange={(e) => {
              if (e.target.value !== "__custom") setModel(e.target.value);
            }}
            aria-label="Chat model"
          >
            {modelGroups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.opts.map((o) => (
                  <option key={o.value} value={o.value} disabled={o.selectable === false}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ))}
            {!allValues.includes(model) && <option value="__custom">Custom: {model}</option>}
          </select>
          {geminiSelected && sysInfo.has_vertex_sa && (
            <div className="sp-desc">Served through Vertex AI on your Google Cloud credits.</div>
          )}
          {geminiSelected && !sysInfo.has_vertex_sa && !sysInfo.has_gemini_key && (
            <Warn>
              This is a Gemini model. Add a Gemini key in API keys, or sign in to Vertex with
              gcloud.
            </Warn>
          )}
          {imageModelSelected && (
            <Warn>
              Image models only make images, so saving keeps Auto for chat. Ask JARVIS for an image
              and it uses this model on its own.
            </Warn>
          )}
          {nativeAudio && (
            <div className="sp-desc">
              Native-audio models talk through Google&apos;s Live API: full-duplex voice with
              barge-in, no Whisper or TTS. Typed messages use a Gemini text model. Needs Vertex or a
              Gemini key.
            </div>
          )}
          <details className="sp-more" open={!allValues.includes(model)}>
            <summary>Use a model ID</summary>
            <input
              type="text"
              className="sp-input sp-mono"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="exact model id"
              spellCheck={false}
            />
          </details>
          <More>
            In Auto, each request goes to the weakest ranked model that can handle it, across every
            provider you have a key for. The order is under Routing. Image requests skip chat and go
            straight to an image-only Gemini model.
          </More>
        </Field>
        <Toggle
          label="Fall back when a model is unavailable"
          checked={autoSwitch}
          onChange={setAutoSwitch}
          hint={
            autoSwitch
              ? "If your model is rate-limited or down, the next one in the routing order answers, and the reply says so."
              : "Only this model is used. Several keys for it still rotate. When it runs out, the turn fails and says so."
          }
        />
      </Group>
    </>
  );

  // Phone: the provider list is Auto plus every provider you have a key for, and
  // the model list is exactly what those keys reach (sysInfo.reachable_models). An
  // option's value carries its provider ("groq::llama-…"): the same id can be
  // served by two providers, and picking a model picks its provider too.
  const keyedProviders = ["gemini", "vertex", "groq", "openrouter", "nvidia", "mistral"].filter(
    (p) => (p === "vertex" ? sysInfo.has_vertex_sa : sysInfo[`has_${p}_key`]),
  );
  const reachable = (sysInfo.reachable_models || []).filter(
    (g) => providerMode === "auto" || g.provider === providerMode,
  );
  const modelValue = model === "auto" ? "auto" : `${providerMode}::${model}`;
  const modelListed = reachable.some((g) =>
    g.models.some((m) => `${g.provider}::${m}` === modelValue),
  );
  const providerName = PROVIDER_NAME[providerMode] || providerMode;
  const pickProvider = (next) => {
    setProviderMode(next);
    // A model the new provider can't serve would silently stop routing.
    const stays =
      next === "auto" ||
      (sysInfo.reachable_models || []).some((g) => g.provider === next && g.models.includes(model));
    if (!stays) setModel("auto");
  };
  const fallbackHint =
    model !== "auto"
      ? autoSwitch
        ? `If ${model} is rate-limited or down, another ${providerName} model answers first, then other providers. The reply says so.`
        : `Only ${model} is used. Several keys for it still rotate. When it runs out, the turn fails and says so.`
      : autoSwitch
        ? `If every ${providerName} model is rate-limited or down, another provider answers, and the reply says so.`
        : `Only ${providerName} models are used. When they're all out, the turn fails and says so.`;

  const mobileModelsPage = (
    <>
      <Group title="Provider">
        <Field
          hint={
            providerMode === "auto"
              ? "Each request goes to the best model across all your keys."
              : `Chat and phone tasks use ${providerName}. Voice input isn't affected.`
          }
        >
          <select
            className="sp-input"
            value={providerMode}
            onChange={(e) => pickProvider(e.target.value)}
            aria-label="AI provider"
          >
            <option value="auto">Auto</option>
            {keyedProviders.map((p) => (
              <option key={p} value={p}>
                {PROVIDER_NAME[p]}
              </option>
            ))}
            {providerMode !== "auto" && !keyedProviders.includes(providerMode) && (
              <option value={providerMode}>{providerName} (no key)</option>
            )}
          </select>
          {["openrouter", "nvidia", "mistral"].includes(providerMode) && (
            <Warn>
              {providerName}&apos;s free models run on shared capacity and are often busy, so
              replies can be slow or fail.
            </Warn>
          )}
        </Field>
      </Group>

      <Group title="Chat model">
        <Field
          hint={
            model !== "auto"
              ? `Every request goes to ${model} on ${providerName}.`
              : providerMode === "auto"
                ? "JARVIS picks the model for each request: a quick one for small talk, a stronger one for real work."
                : `JARVIS picks the best ${providerName} model for each request.`
          }
        >
          <select
            className="sp-input"
            value={modelListed || model === "auto" ? modelValue : "__custom"}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "__custom") return;
              if (v === "auto") return setModel("auto");
              const [p, ...rest] = v.split("::");
              setProviderMode(p);
              setModel(rest.join("::"));
            }}
            aria-label="Chat model"
          >
            <option value="auto">
              {providerMode === "auto" ? "Auto" : `Auto — best ${providerName} model`}
            </option>
            {reachable.map((g) => (
              <optgroup key={g.provider} label={PROVIDER_NAME[g.provider]}>
                {g.models.map((m) => (
                  <option key={m} value={`${g.provider}::${m}`}>
                    {m}
                  </option>
                ))}
              </optgroup>
            ))}
            {!modelListed && model !== "auto" && (
              <option value="__custom">{model} (not reachable)</option>
            )}
          </select>
          {reachable.length === 0 && (
            <div className="sp-desc">Models appear here once your keys&apos; model lists load.</div>
          )}
          {!modelListed && model !== "auto" && (
            <Warn>None of your keys list {model} any more. Pick another model or Auto.</Warn>
          )}
        </Field>
        {!(providerMode === "auto" && model === "auto") && (
          <Toggle
            label="Fall back when unavailable"
            checked={autoSwitch}
            onChange={setAutoSwitch}
            hint={fallbackHint}
          />
        )}
        <div className="sp-field">
          <More>
            Auto sends each request to the weakest ranked model that can handle it; the order is
            under Routing. If that model is rate-limited, the next one takes over. Image requests
            skip chat and go straight to an image-only Gemini model.
          </More>
        </div>
      </Group>
    </>
  );

  const modelsPage = IS_MOBILE ? mobileModelsPage : desktopModelsPage;

  const routingPage = (
    <>
      <RoutingSection routing={sysInfo.routing} onRerank={onRerankModels} />
      <QuotaPanel />
    </>
  );

  const multiKeyHint =
    "Free-tier limits count per key. Paste several, one per line, and JARVIS rotates through them.";
  const keysPage = (
    <>
      <p className="sp-lede">
        {IS_MOBILE
          ? "Keys stay on this device. A saved key is never shown again; paste a new one to replace it."
          : "Keys are stored in app data, outside the project folder. A saved key is never shown again."}
      </p>
      {IS_MOBILE && providerMode === "vertex" ? (
        <Group title="Vertex AI">
          <KeyField
            label="Service account JSON"
            configured={sysInfo.has_vertex_sa}
            status={sysInfo.vertex_project ? `Project ${sysInfo.vertex_project}` : undefined}
            note="Runs Gemini chat on your Google Cloud credits."
            value={vertexSaJson}
            onChange={setVertexSaJson}
            placeholder="Paste the whole JSON file"
            multiline
          />
          <KeyField
            label="Groq"
            configured={sysInfo.has_groq_key}
            note="Optional. Uses Whisper for “Hey Jarvis” and voice input instead of Chirp. Chat stays on Vertex."
            value={groqKey}
            onChange={setGroqKey}
            placeholder="gsk_…"
            removeName="groq_api_key"
            onSave={onSave}
          />
        </Group>
      ) : (
        <Group title="Chat and voice">
          <KeyField
            label="Groq"
            configured={sysInfo.has_groq_key}
            note="Voice input and chat."
            value={groqKey}
            onChange={setGroqKey}
            placeholder="gsk_…  one per line"
            multiline
            removeName="groq_api_key"
            onSave={onSave}
          />
          <KeyField
            label={IS_MOBILE ? "Google" : "Gemini"}
            configured={sysInfo.has_gemini_key}
            value={geminiKey}
            onChange={setGeminiKey}
            placeholder={IS_MOBILE ? "AIza… or AQ.…  one per line" : "AIza…  one per line"}
            multiline
            removeName="gemini_api_key"
            onSave={onSave}
          />
          <div className="sp-field">
            <div className="sp-desc">{multiKeyHint}</div>
          </div>
        </Group>
      )}
      {IS_MOBILE && (
        <Group title="Extra free providers">
          {[
            ["OpenRouter", "openrouter", openrouterKey, setOpenrouterKey, "sk-or-…"],
            ["NVIDIA NIM", "nvidia", nvidiaKey, setNvidiaKey, "nvapi-…"],
            ["Mistral", "mistral", mistralKey, setMistralKey, "Mistral API key"],
          ].map(([label, id, value, set, hint]) => (
            <KeyField
              key={id}
              label={label}
              configured={sysInfo[`has_${id}_key`]}
              value={value}
              onChange={set}
              placeholder={hint}
              removeName={`${id}_api_key`}
              onSave={onSave}
            />
          ))}
          <div className="sp-field">
            <div className="sp-desc">
              More free quota. Their free models are found and ranked alongside Gemini and Groq.
            </div>
            <Warn>
              Whatever a fallback answers includes what&apos;s on screen during a phone task.
              Mistral&apos;s free tier trains on the data it&apos;s sent.
            </Warn>
          </div>
        </Group>
      )}
      {!IS_MOBILE && (
        <Group title="Voice and places">
          <KeyField
            label="ElevenLabs"
            configured={sysInfo.has_elevenlabs_key}
            note="Premium text-to-speech."
            value={elevenKey}
            onChange={setElevenKey}
            placeholder="ElevenLabs API key"
          />
          <KeyField
            label="Google Maps"
            configured={sysInfo.has_google_maps_key || sysInfo.places_source === "google"}
            status={
              !sysInfo.has_google_maps_key && sysInfo.places_source === "google"
                ? "Via Vertex"
                : undefined
            }
            note={
              sysInfo.places_source === "google"
                ? "Accurate nearby places and distances. Active."
                : "Accurate nearby places and distances, instead of OpenStreetMap. On Vertex, enabling “Places API (New)” in your project is enough."
            }
            value={mapsKey}
            onChange={setMapsKey}
            placeholder="AIza…"
          />
        </Group>
      )}
    </>
  );

  const voicePage = (
    <Group>
      {IS_MOBILE ? (
        <>
          <Toggle
            label="“Hey Jarvis” wake word"
            checked={wakeWordOn}
            onChange={setWakeWordOn}
            hint="Listens on the phone itself. Nothing is sent until it hears the wake word."
          />
          <div className="sp-field">
            <More>
              Needs microphone permission. Speech-to-text uses Cloud Speech-to-Text on Vertex, or
              Groq Whisper on Groq and Gemini. Replies are spoken by the phone&apos;s built-in
              text-to-speech.
            </More>
          </div>
        </>
      ) : (
        <Field label="Voice">
          <select className="sp-input" value={tts} onChange={(e) => setTts(e.target.value)}>
            {TTS_OPTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {tts === "piper" && (
            <div className="sp-desc">
              Private and unlimited. The 60 MB voice downloads the first time JARVIS speaks.
            </div>
          )}
          {tts === "elevenlabs" &&
            (sysInfo.has_elevenlabs_key ? (
              <div className="sp-desc">
                The most natural voice, but the free tier is about 10k characters a month.
              </div>
            ) : (
              <Warn>ElevenLabs needs a key. Add it in API keys.</Warn>
            ))}
        </Field>
      )}
      <div className="sp-field sp-row">
        <span className="sp-label">Wake phrase</span>
        <span className="sp-value sp-mono">{sysInfo.wakeWord || "hey_jarvis"}</span>
      </div>
    </Group>
  );

  const automationPage = (
    <>
      <Group title="Autopilot">
        <Field
          label="Model"
          hint={
            sysInfo.autopilot_model_active
              ? `Drives multi-step browser and desktop tasks. Now using ${sysInfo.autopilot_model_active}.`
              : "Drives multi-step browser and desktop tasks. Leave blank for auto."
          }
        >
          <input
            type="text"
            className="sp-input sp-mono"
            value={autopilotModel}
            onChange={(e) => setAutopilotModel(e.target.value)}
            placeholder="auto, a model id, or ollama:llama3.1"
            spellCheck={false}
          />
        </Field>
        <Field
          label="Step reasoning"
          hint="Dynamic thinks harder on tricky steps. Off is quickest but picks worse moves on hard pages."
        >
          <select
            className="sp-input"
            value={autopilotThinking}
            onChange={(e) => setAutopilotThinking(e.target.value)}
          >
            <option value="dynamic">Dynamic (recommended)</option>
            <option value="off">Off</option>
          </select>
        </Field>
        <Toggle
          label="Look at screenshots when stuck"
          checked={autopilotVision}
          onChange={setAutopilotVision}
        />
      </Group>
      <Group title="Alerts">
        <Toggle
          label="Speak up about system load"
          checked={sysAlerts}
          onChange={setSysAlerts}
          hint="High CPU, full memory or a low battery. Agenda reminders and timers aren't affected."
        />
      </Group>
      <Group title="Status pill">
        <Toggle
          label="Show over other apps"
          checked={ovlEnabled}
          onChange={setOvlEnabled}
          hint="A small pill above the taskbar shows whether JARVIS is listening or working, with a stop button."
        />
        {ovlEnabled && (
          <Field label="Hide it in these apps">
            <div className="dirlist">
              {ovlApps.length === 0 && (
                <StateMessage variant="empty" icon="info" title="Shown in every app">
                  Add an app&apos;s process name, like chrome or code.
                </StateMessage>
              )}
              {ovlApps.map((a) => (
                <div key={a} className="dirlist-row">
                  <span className="dirlist-path" title={a}>
                    {a}
                  </span>
                  <button
                    className="dirlist-rm"
                    aria-label={`Show in ${a} again`}
                    onClick={() => removeApp(a)}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </div>
              ))}
            </div>
            <div className="sp-inline">
              <input
                type="text"
                className="sp-input sp-mono"
                value={newApp}
                placeholder="chrome"
                onChange={(e) => setNewApp(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addApp()}
              />
              <button type="button" className="sp-btn" onClick={addApp}>
                Hide
              </button>
            </div>
          </Field>
        )}
      </Group>
    </>
  );

  const locationPage = (
    <Group>
      <div className="sp-field sp-row">
        <span className="sp-label">Current</span>
        <span className="sp-value">
          {pinnedLoc?.label ? pinnedLoc.label.split(",")[0] : "Automatic"}
        </span>
      </div>
      <Field
        label={pinnedLoc?.label ? "Pin somewhere else" : "Pin a place"}
        hint={
          IS_MOBILE
            ? "Uses GPS when allowed, otherwise your IP. Pin your area if weather or distances are off."
            : "Uses browser GPS or your IP. A pin overrides it everywhere. You can also say “set my location to…”."
        }
      >
        <div className="sp-inline">
          <input
            type="text"
            className="sp-input"
            value={locInput}
            placeholder="Powai, Mumbai"
            onChange={(e) => setLocInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && pinLocation()}
          />
          <button
            type="button"
            className="sp-btn"
            onClick={pinLocation}
            disabled={!locInput.trim()}
          >
            Pin
          </button>
        </div>
        {pinnedLoc?.label && (
          <button
            type="button"
            className="sp-link"
            onClick={() => onSetLocation && onSetLocation({ clear: true })}
          >
            Go back to automatic
          </button>
        )}
      </Field>
    </Group>
  );

  const calendarPage = (
    <Group>
      <Toggle
        label="Add agenda items to my phone's calendar"
        checked={calendarSync}
        onChange={(on) => {
          setCalendarSync(on);
          // Ask here, not mid-action: at the moment JARVIS is adding an
          // event it is also launching the calendar, and the permission
          // dialog would lose that race.
          if (on) void requestCalendarPermission();
        }}
        hint="Items show up in Google Calendar and on your other devices. Turn off to keep the agenda inside JARVIS."
      />
      <div className="sp-field">
        <More label="If you decline calendar permission">
          JARVIS opens the calendar&apos;s own new-event screen instead, so you can still add the
          item yourself.
        </More>
      </div>
    </Group>
  );

  const filesPage = IS_MOBILE ? (
    <Group>
      <div className="sp-field sp-row">
        <span className="sp-label">Folder</span>
        <span className="sp-value sp-mono">{grantedFolder ? grantedFolder.name : "None"}</span>
      </div>
      <Field hint="JARVIS can list this folder and read the text files in it. It can never write, move or delete anything.">
        <button type="button" className="sp-btn" onClick={chooseFolder}>
          {grantedFolder ? "Change folder" : "Choose folder"}
        </button>
      </Field>
    </Group>
  ) : (
    <>
      <Group title="Where JARVIS saves things">
        <Field hint="Images, recordings and documents go into subfolders here.">
          <input
            type="text"
            className="sp-input sp-mono"
            value={storageDir}
            onChange={(e) => setStorageDir(e.target.value)}
            placeholder="C:\Users\you\Jarvis"
            spellCheck={false}
          />
        </Field>
      </Group>
      <Group title="Folders JARVIS can read">
        <Field hint="It can list these and read files inside, asking you each time. It can never run, write, move or delete anything.">
          <div className="dirlist">
            {dirs.length === 0 && (
              <StateMessage variant="empty" icon="folder" title="No folders yet">
                Add one to let JARVIS read files from it.
              </StateMessage>
            )}
            {dirs.map((d) => (
              <div key={d} className="dirlist-row">
                <span className="dirlist-path" title={d}>
                  {d}
                </span>
                <button
                  className="dirlist-rm"
                  aria-label={`Remove ${d}`}
                  onClick={() => removeDir(d)}
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
            ))}
          </div>
          <div className="sp-inline">
            <input
              type="text"
              className="sp-input sp-mono"
              value={newDir}
              placeholder="C:\Users\you\Documents"
              onChange={(e) => setNewDir(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addDir()}
              spellCheck={false}
            />
            <button type="button" className="sp-btn" onClick={addDir}>
              Add
            </button>
          </div>
        </Field>
      </Group>
    </>
  );

  const diagnosticsPage = (
    <>
      <Group title="Now">
        <div className="sp-field sp-row">
          <span className="sp-label">Provider</span>
          <span className="sp-value">
            {PROVIDER_NAME[sysInfo.provider_mode || sysInfo.provider] ||
              sysInfo.provider_mode ||
              sysInfo.provider}
          </span>
        </div>
        {sysInfo.ram != null && (
          <div className="sp-field sp-row">
            <span className="sp-label">Memory available</span>
            <span className="sp-value sp-mono">{sysInfo.ram} GB</span>
          </div>
        )}
      </Group>
      <Group title={IS_MOBILE ? "Connection" : "Components"}>
        <Field
          hint={
            IS_MOBILE
              ? "Checks the network and whether your keys can reach Groq and Gemini."
              : "Re-downloads the browser engine, speech model or voice if a feature says it needs setup. Progress shows on the main screen."
          }
        >
          <button
            type="button"
            className="sp-btn"
            onClick={() => {
              if (onRepairSetup) onRepairSetup();
              onClose();
            }}
            disabled={!onRepairSetup}
          >
            {IS_MOBILE ? "Run connection test" : "Repair components"}
          </button>
        </Field>
      </Group>
    </>
  );

  /* ── Index: every page with its live readout ── */

  const keyFlags = IS_MOBILE
    ? ["vertex_sa", "groq_key", "gemini_key", "openrouter_key", "nvidia_key", "mistral_key"]
    : ["groq_key", "gemini_key", "elevenlabs_key", "google_maps_key"];
  const keyCount = keyFlags.filter((k) => sysInfo[`has_${k}`]).length;
  const rankedCount = sysInfo.routing?.models?.length ?? 0;
  const restingCount = quota.snapshot().benched?.length ?? 0;

  // tone: "on" = configured/active, "off" = inactive, "warn" = needs attention.
  // Each inner array is one group in the nav.
  const sections = [
    [
      {
        id: "models",
        title: "Models",
        icon: "sparkle",
        value: model !== "auto" ? model : PROVIDER_NAME[providerMode] || providerMode,
        tone: "on",
        body: modelsPage,
      },
      {
        id: "routing",
        title: "Routing",
        icon: "route",
        value: restingCount
          ? `${restingCount} resting`
          : rankedCount
            ? `${rankedCount} ranked`
            : "Not ranked",
        tone: restingCount ? "warn" : rankedCount ? "on" : "off",
        body: routingPage,
      },
      {
        id: "keys",
        title: "API keys",
        icon: "key",
        value: keyCount ? `${keyCount} connected` : "None",
        tone: keyCount ? "on" : "warn",
        body: keysPage,
      },
    ],
    [
      {
        id: "voice",
        title: "Voice",
        icon: "mic",
        value: IS_MOBILE
          ? wakeWordOn
            ? "Wake word on"
            : "Wake word off"
          : TTS_OPTS.find((o) => o.value === tts)?.short || tts,
        tone: (IS_MOBILE ? wakeWordOn : tts !== "off") ? "on" : "off",
        body: voicePage,
      },
      !IS_MOBILE && {
        id: "automation",
        title: "Automation",
        icon: "robot",
        value: autopilotModel.trim() || "Auto",
        tone: "on",
        body: automationPage,
      },
      {
        id: "location",
        title: "Location",
        icon: "pin",
        value: pinnedLoc?.label ? pinnedLoc.label.split(",")[0] : "Automatic",
        tone: "on",
        body: locationPage,
      },
      {
        id: "calendar",
        title: "Calendar",
        icon: "calendar",
        value: calendarSync ? "Syncing" : "In app only",
        tone: calendarSync ? "on" : "off",
        body: calendarPage,
      },
      {
        id: "files",
        title: "Files",
        icon: "folder",
        value: IS_MOBILE
          ? grantedFolder?.name || "No folder"
          : `${dirs.length} folder${dirs.length === 1 ? "" : "s"}`,
        tone: (IS_MOBILE ? grantedFolder : dirs.length) ? "on" : "off",
        body: filesPage,
      },
    ],
    [
      {
        id: "diagnostics",
        title: "Diagnostics",
        icon: "activity",
        value: "",
        tone: null,
        body: diagnosticsPage,
      },
    ],
  ].map((group) => group.filter(Boolean));

  const current = sections.flat().find((p) => p.id === page);
  const drilled = !wide && current;

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div
        className={`sp ${wide ? "sp--wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sp-hdr">
          {drilled ? (
            <button type="button" className="sp-back" onClick={() => setPage(null)}>
              <Icon name="chevronLeft" size={18} />
              <span>Settings</span>
            </button>
          ) : (
            <h2 className="sp-title">Settings</h2>
          )}
          <button type="button" className="sp-close" onClick={onClose} aria-label="Close settings">
            <Icon name="close" size={18} />
          </button>
        </header>

        {/* On the phone each page starts at the top, not at the index's scroll. */}
        <div className="sp-body" key={wide ? "wide" : page || "index"}>
          {(wide || !current) && (
            <nav className="sp-nav" aria-label="Settings sections">
              {sections.map((group) => (
                <div className="sp-nav-group" key={group[0].id}>
                  {group.map((p) => (
                    <button
                      type="button"
                      key={p.id}
                      className={`sp-nav-row ${p.id === page ? "is-current" : ""}`}
                      aria-current={p.id === page ? "page" : undefined}
                      onClick={() => setPage(p.id)}
                    >
                      <Icon name={p.icon} size={18} className="sp-nav-ico" />
                      <span className="sp-nav-title">{p.title}</span>
                      {p.value && (
                        <span className={`sp-readout ${p.tone ? `sp-readout--${p.tone}` : ""}`}>
                          {p.value}
                        </span>
                      )}
                      {!wide && <Icon name="chevronRight" size={16} className="sp-nav-chev" />}
                    </button>
                  ))}
                </div>
              ))}
            </nav>
          )}
          {current && (
            <div className="sp-page" key={current.id}>
              <h2 className="sp-page-title">{current.title}</h2>
              {current.body}
            </div>
          )}
        </div>

        <footer className="sp-foot">
          <span className="sp-foot-note" aria-live="polite">
            {dirty ? "Unsaved changes" : ""}
          </span>
          <button
            type="button"
            className={`sp-btn ${dirty ? "sp-btn--primary" : ""}`}
            onClick={handleSave}
          >
            Save changes
          </button>
        </footer>
      </div>
    </div>
  );
}
