import { useMemo, useState } from "react";

/* ANDROID FORK first-run setup — key entry.
 * Two paths: Vertex AI (Service Account JSON) or Free API Keys (Groq/Gemini). */
export default function MobileOnboarding({ sysInfo, onSave }) {
  const [mode, setMode] = useState("vertex"); // "vertex" | "keys"
  const [vertexSaJson, setVertexSaJson] = useState("");
  const [groqKey, setGroqKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [touched, setTouched] = useState(false);

  const hasGroq = groqKey.trim() || sysInfo.has_groq_key;
  const hasGemini = geminiKey.trim() || sysInfo.has_gemini_key;
  const hasVertex = vertexSaJson.trim() || sysInfo.has_vertex_sa;

  const project = useMemo(() => {
    try {
      return JSON.parse(vertexSaJson).project_id || "";
    } catch {
      return "";
    }
  }, [vertexSaJson]);

  // Either free key is enough — gating on Groq alone locked gemini-only users out.
  const canFinish = mode === "vertex" ? hasVertex : hasGroq || hasGemini;

  const finish = () => {
    setTouched(true);
    if (!canFinish) return;

    const cfg = {};
    if (mode === "vertex") {
      cfg.provider_mode = "vertex";
      if (vertexSaJson.trim()) cfg.vertex_sa_json = vertexSaJson.trim();
      // Optional Groq key: Vertex handles chat, but a Groq key makes voice/wake-word
      // use Whisper Large v3 Turbo (preferred over Vertex Chirp when present).
      if (groqKey.trim()) cfg.groq_api_key = groqKey.trim();
    } else {
      // Auto: route each request across whichever of these keys fits it best.
      cfg.provider_mode = "auto";
      if (groqKey.trim()) cfg.groq_api_key = groqKey.trim();
      if (geminiKey.trim()) cfg.gemini_api_key = geminiKey.trim();
    }
    onSave(cfg);
  };

  return (
    <div className="onboard-overlay">
      <div className="onboard-panel" role="dialog" aria-label="Welcome to JARVIS">
        <div className="onboard-hd">
          <span className="onboard-kicker">FIRST-RUN SETUP</span>
          <h2>Welcome to J.A.R.V.I.S</h2>
          <p className="onboard-sub">
            Connect JARVIS to your AI provider. Keys stay on this device only.
          </p>
        </div>

        <div className="onboard-mode-toggle">
          <button
            className={`onboard-mode-btn${mode === "vertex" ? " onboard-mode-btn--active" : ""}`}
            onClick={() => setMode("vertex")}
          >
            Vertex AI ($300 Credit)
          </button>
          <button
            className={`onboard-mode-btn${mode === "keys" ? " onboard-mode-btn--active" : ""}`}
            onClick={() => setMode("keys")}
          >
            Free API Keys
          </button>
        </div>

        {mode === "vertex" ? (
          <div className="onboard-sec">
            <label>
              Service Account JSON (Recommended){" "}
              {sysInfo.has_vertex_sa && <span className="onboard-ok">✓ set</span>}
            </label>
            <textarea
              value={vertexSaJson}
              onChange={(e) => setVertexSaJson(e.target.value)}
              placeholder="Paste the entire JSON file contents here..."
            />
            {project && (
              <div className="onboard-ok" style={{ marginTop: 8 }}>
                ✓ Project: {project}
              </div>
            )}
            <div className="onboard-hint">
              Uses your Google Cloud $300 free trial credits for Gemini chat and Cloud
              Speech-to-Text (Chirp).
            </div>

            <label style={{ marginTop: 16 }}>
              Groq API keys (optional — better voice){" "}
              {sysInfo.has_groq_key && <span className="onboard-ok">✓ set</span>}
            </label>
            <textarea
              className="onboard-keys"
              rows={2}
              value={groqKey}
              onChange={(e) => setGroqKey(e.target.value)}
              placeholder="gsk_…  (console.groq.com/keys — one per line)"
              autoComplete="off"
            />
            <div className="onboard-hint">
              Optional. Adds Whisper Large v3 Turbo for voice input and “Hey Jarvis” (used instead
              of Vertex Chirp when set). Chat still runs on Vertex Gemini. Free-tier limits are per
              key — paste several, one per line, and I'll rotate through them.
            </div>
          </div>
        ) : (
          <>
            <div className="onboard-sec">
              <label>
                Groq API keys (required){" "}
                {sysInfo.has_groq_key && <span className="onboard-ok">✓ set</span>}
              </label>
              <textarea
                className="onboard-keys"
                rows={2}
                value={groqKey}
                onChange={(e) => setGroqKey(e.target.value)}
                placeholder="gsk_…  (console.groq.com/keys — one per line)"
                autoComplete="off"
              />
              <div className="onboard-hint">
                Powers voice input and “Hey Jarvis” via Whisper Large v3 Turbo, and Groq chat models
                on the free tier. Free-tier limits are counted per key — paste as many as you have,
                one per line, and I'll rotate through them instead of stopping at a rate limit.
              </div>
            </div>

            <div className="onboard-sec">
              <label>
                Google Gemini API keys (optional){" "}
                {sysInfo.has_gemini_key && <span className="onboard-ok">✓ set</span>}
              </label>
              <textarea
                className="onboard-keys"
                rows={2}
                value={geminiKey}
                onChange={(e) => setGeminiKey(e.target.value)}
                placeholder="AIza…  (aistudio.google.com — one per line)"
                autoComplete="off"
              />
              <div className="onboard-hint">
                Optional — unlocks Gemini free-tier models in Settings. Several keys are fine here
                too. Voice always uses Groq Whisper.
              </div>
            </div>
          </>
        )}

        {touched && !canFinish && (
          <div className="onboard-warn">
            {mode === "vertex"
              ? "Paste a valid Service Account JSON to continue."
              : "Add your Groq or Gemini API key to continue."}
          </div>
        )}

        <button
          className="onboard-go"
          disabled={!canFinish}
          onClick={finish}
          style={{ marginTop: 20 }}
        >
          Start JARVIS →
        </button>
      </div>
    </div>
  );
}
