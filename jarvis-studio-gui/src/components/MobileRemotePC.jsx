import { lazy, Suspense, useState } from "react";
import ModalPanel from "./ModalPanel";
import Icon from "./Icon";

// jsQR is ~127 kB and is only reachable once the user actually taps "scan" during
// pairing — a one-time action most sessions never perform. Loading it on demand
// keeps it out of every cold start. The camera permission prompt and stream setup
// already make this screen non-instant, so the fetch hides inside that.
const QrScanner = lazy(() => import("./QrScanner"));

/* ANDROID FORK — Remote-PC pairing (Phase 3).
 *
 * Pairs the phone to the user's Windows PC so "do X on my PC" runs the whole task
 * on the PC's JARVIS backend over a WebSocket. Pairing is two steps: scan the QR the
 * desktop shows (Settings → Remote Access), then type the 6-digit PIN shown beside it.
 * The QR carries public identity material only (host, host_id/fingerprint/public_key,
 * one-use challenge id, scopes) — the PIN is kept OUT of the QR so a shoulder-surfer or
 * tailnet peer who only photographed the code can't complete the pairing.
 *
 * The QR advertises the PC's Tailscale address; brain/remote/pc.ts connects over it and
 * (if an altHost LAN address was included) silently upgrades to the faster direct LAN
 * link when it detects they're on the same Wi-Fi — nothing for the user to switch by hand.
 *
 * Reuses the shared settings-* styles so it matches the rest of the HUD with no new CSS.
 */

const STATE_META = {
  idle: { label: "Not paired", color: "#7a8aa0" },
  connecting: { label: "Connecting…", color: "#e0a800" },
  online: { label: "Online", color: "#36d399" },
  offline: { label: "Offline — retrying", color: "#f06a4d" },
  unauthorized: { label: "Identity rejected", color: "#f0455a" },
};

export default function MobileRemotePC({
  pcConfig,
  pcState,
  onPair,
  onUnpair,
  onViewScreen,
  onClose,
}) {
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  // After a valid QR scan we hold the parsed pairing config here and ask for the
  // 6-digit PIN shown on the PC (which is deliberately NOT in the QR) before pairing.
  const [pendingPair, setPendingPair] = useState(null);
  const [pin, setPin] = useState("");

  const paired = Boolean(
    pcConfig?.host && pcConfig?.hostId && pcConfig?.hostFingerprint && pcConfig?.hostPublicKey,
  );
  const online = pcState === "online";
  const meta = STATE_META[pcState] || STATE_META.idle;

  // Parse the scanned QR (public identity material only — no PIN, no token). On
  // success we stage the config and ask for the on-screen PIN before pairing.
  const handleScanned = (text) => {
    setScanning(false);
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      setScanError(
        "That QR code isn't a JARVIS pairing code — try the one shown in the JARVIS window.",
      );
      return;
    }
    const payload = parsed?.payload && typeof parsed.payload === "object" ? parsed.payload : parsed;
    const hostId = payload?.host_id || payload?.hostId;
    const hostFingerprint = payload?.host_fingerprint || payload?.hostFingerprint;
    const hostPublicKey = payload?.host_public_key || payload?.hostPublicKey;
    const challengeId = payload?.challenge_id || payload?.pairingChallengeId;
    const expiresAt = Number(payload?.expires_at || payload?.expiresAt || 0);
    const scopes = Array.isArray(payload?.scopes) ? payload.scopes : [];
    if (
      payload?.kind !== "aura.pairing" ||
      !payload?.host ||
      !hostId ||
      !hostFingerprint ||
      !hostPublicKey ||
      !challengeId ||
      !Number.isSafeInteger(expiresAt) ||
      expiresAt * 1000 <= Date.now() ||
      !scopes.includes("tasks")
    ) {
      setScanError("That QR code is missing the PC address or pairing code — try again.");
      return;
    }
    setScanError("");
    // Stage the config; pairing needs the on-screen PIN too (not in the QR).
    setPin("");
    setPendingPair({
      host: String(payload.host),
      altHost: payload.altHost ? String(payload.altHost) : "",
      port: payload.port ? String(payload.port) : "8765",
      secure: Boolean(payload.secure),
      hostId: String(hostId),
      hostFingerprint: String(hostFingerprint),
      hostPublicKey: String(hostPublicKey),
      pairingChallengeId: String(challengeId),
      deviceName: "Aura Android",
    });
  };

  const confirmPin = () => {
    const clean = pin.replace(/\D/g, "");
    if (clean.length !== 6) {
      setScanError("Enter the 6-digit PIN shown on your PC.");
      return;
    }
    setScanError("");
    onPair({ ...pendingPair, pin: clean });
    setPendingPair(null);
    setPin("");
  };

  if (scanning) {
    return (
      <Suspense fallback={<ModalPanel title="Scan the QR code">Starting the camera…</ModalPanel>}>
        <QrScanner onResult={handleScanned} onCancel={() => setScanning(false)} />
      </Suspense>
    );
  }

  if (pendingPair) {
    return (
      <ModalPanel title="Enter pairing PIN" onClose={() => setPendingPair(null)}>
        <div className="settings-sec">
          <div className="settings-hint">
            On your PC, <b>Settings → Remote Access</b> shows a 6-digit PIN next to the code you
            just scanned. Type it here to finish pairing. It expires in about two minutes.
          </div>
          <input
            className="settings-model-id"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="123456"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
            style={{ fontSize: 24, letterSpacing: 6, textAlign: "center", marginTop: 10 }}
          />
          {scanError && <div className="settings-warn">{scanError}</div>}
          <button
            className="settings-save"
            style={{ marginTop: 12 }}
            disabled={pin.replace(/\D/g, "").length !== 6}
            onClick={confirmPin}
          >
            Pair this PC
          </button>
        </div>
      </ModalPanel>
    );
  }

  return (
    <ModalPanel title="Remote PC" onClose={onClose}>
      <div className="settings-sec">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: 0.3,
          }}
        >
          <span
            style={{
              width: 9,
              height: 9,
              borderRadius: "50%",
              background: meta.color,
              boxShadow: `0 0 8px ${meta.color}`,
              flex: "0 0 auto",
            }}
          />
          <span>{paired ? meta.label : "No PC paired"}</span>
          {paired && (
            <span style={{ marginLeft: "auto", opacity: 0.6, fontWeight: 400 }}>
              {pcConfig.secure ? "wss" : "ws"}://{pcConfig.host}:{pcConfig.port || 8765}
            </span>
          )}
        </div>
        <div className="settings-hint">
          Run whole tasks on your Windows PC from your phone. JARVIS forwards the goal to the
          desktop app, which does the work and reports back here.
        </div>
        {paired && pcConfig.altHost && (
          <div className="settings-hint">
            <Icon name="globe" size={14} /> Works on any network — JARVIS connects over your Tailscale address ({pcConfig.altHost})
            and switches to the faster direct link on its own when you're on the same Wi-Fi.
          </div>
        )}
        {paired && pcConfig.hostFingerprint && (
          <div className="settings-hint">
            Host identity: {pcConfig.hostFingerprint.slice(0, 24)}...
          </div>
        )}
      </div>

      <div className="settings-sec">
        <button
          className="settings-save"
          onClick={() => {
            setScanError("");
            setScanning(true);
          }}
        >
          <Icon name="camera" size={16} /> {paired ? "Re-scan the code on your PC" : "Scan the code on your PC"}
        </button>
        <div className="settings-hint">
          Open JARVIS on your computer, go to <b>Settings → Remote Access</b>, and point your
          camera at the code it shows. That's the whole setup — the code carries the address and
          expiring identity challenge, including the Tailscale address when you've set it up.
        </div>
        {scanError && <div className="settings-warn">{scanError}</div>}
      </div>

      {paired && (
        <div className="settings-sec">
          <button
            className="settings-save"
            onClick={onViewScreen}
            disabled={!online}
            style={{ opacity: online ? 1 : 0.5 }}
          >
            <Icon name="monitor" size={16} /> View &amp; control screen
          </button>
          <div className="settings-hint">
            {online
              ? "Live-stream your PC's screen here and drive it by touch. You'll arm control on the PC first."
              : "Connect to your PC (status above must be Online) to start the live screen."}
          </div>
        </div>
      )}

      {paired && (
        <button
          className="dirlist-addbtn"
          style={{ marginTop: 8 }}
          onClick={() => {
            onUnpair();
            onClose();
          }}
        >
          Unpair this PC
        </button>
      )}
    </ModalPanel>
  );
}
