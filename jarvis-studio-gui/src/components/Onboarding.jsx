import { useState } from "react";

/* First-run setup. Shown whenever the backend reports `needs_setup` (no API key
   yet, or no storage location chosen). Collects at least one API key and a
   storage folder, then hands them to the backend via the same set_config path
   the Settings panel uses. Keys are stored in app data — never in committed
   source. */
export default function Onboarding({ sysInfo, onSave }) {
  const defaultStorage = sysInfo.storage_dir || "";
  const [groqKey, setGroqKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [storageDir, setStorageDir] = useState(defaultStorage);
  const [touched, setTouched] = useState(false);

  const hasAnyKey =
    groqKey.trim() || geminiKey.trim() || sysInfo.has_groq_key || sysInfo.has_gemini_key;
  const hasStorage = storageDir.trim().length > 0;
  const canFinish = hasAnyKey && hasStorage;

  const finish = () => {
    setTouched(true);
    if (!canFinish) return;
    const cfg = { storage_dir: storageDir.trim() };
    if (groqKey.trim()) cfg.groq_api_key = groqKey.trim();
    if (geminiKey.trim()) cfg.gemini_api_key = geminiKey.trim();
    onSave(cfg);
  };

  return (
    <div className="onboard-overlay">
      <div className="onboard-panel" role="dialog" aria-label="Welcome to JARVIS">
        <div className="onboard-hd">
          <span className="onboard-kicker">FIRST-RUN SETUP</span>
          <h2>Welcome to J.A.R.V.I.S</h2>
          <p className="onboard-sub">
            Add at least one AI provider key and choose where JARVIS should keep the files it
            creates. You can change all of this later in Settings.
          </p>
        </div>

        <div className="onboard-sec">
          <label>
            Groq API keys {sysInfo.has_groq_key && <span className="onboard-ok">✓ set</span>}
          </label>
          <textarea
            className="onboard-keys"
            rows={2}
            value={groqKey}
            onChange={(e) => setGroqKey(e.target.value)}
            placeholder="gsk_…  (groq.com/keys)"
          />
        </div>

        <div className="onboard-sec">
          <label>
            Gemini API keys {sysInfo.has_gemini_key && <span className="onboard-ok">✓ set</span>}
          </label>
          <textarea
            className="onboard-keys"
            rows={2}
            value={geminiKey}
            onChange={(e) => setGeminiKey(e.target.value)}
            placeholder="AIza…  (aistudio.google.com/apikey)"
          />
          <span className="onboard-hint">
            Free-tier limits are counted per key. Paste as many as you have, one per line,
            and I'll rotate through them instead of stopping at a rate limit.
          </span>
        </div>

        <div className="onboard-sec">
          <label>Storage folder</label>
          <input
            type="text"
            value={storageDir}
            onChange={(e) => setStorageDir(e.target.value)}
            placeholder="C:\Users\you\Jarvis"
          />
          <span className="onboard-hint">
            Created if it doesn't exist, with images / recordings / documents subfolders.
          </span>
        </div>

        {touched && !canFinish && (
          <div className="onboard-warn">
            {!hasAnyKey
              ? "Add at least one API key to continue."
              : "Choose a storage folder to continue."}
          </div>
        )}

        <button className="onboard-go" disabled={!canFinish} onClick={finish}>
          Start JARVIS →
        </button>
      </div>
    </div>
  );
}
