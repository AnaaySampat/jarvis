import { lazy, Suspense, useState } from "react";
import ModalPanel from "./ModalPanel";
import Sheet, { ActionRow, Field, Group, More, Warn } from "./Sheet";

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
 * Built from the shared Sheet pieces, so it reads like Settings and the dock's menus.
 */

// tone = the readout lamp (sp-readout--on/off/warn).
const STATE_META = {
  idle: { label: "Not paired", tone: "off" },
  connecting: { label: "Connecting…", tone: "off" },
  online: { label: "Online", tone: "on" },
  offline: { label: "Offline, retrying", tone: "off" },
  unauthorized: { label: "Identity rejected", tone: "warn" },
};

export default function MobileRemotePC({
  pcConfig,
  pcState,
  onPair,
  onUnpair,
  onViewScreen,
  onClose,
  tvConfig,
  onTvPair,
  onTvUnpair,
}) {
  const [tvHost, setTvHost] = useState(tvConfig?.host ?? "");
  const [tvBusy, setTvBusy] = useState(false);
  const [tvResult, setTvResult] = useState(null);
  const connectTv = async () => {
    setTvBusy(true);
    setTvResult(null);
    try {
      setTvResult(await onTvPair(tvHost));
    } finally {
      setTvBusy(false);
    }
  };
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  // After a valid QR scan we hold the parsed pairing config here and ask for the
  // 6-digit PIN shown on the PC (which is deliberately NOT in the QR) before pairing.
  const [pendingPair, setPendingPair] = useState(null);
  const [pin, setPin] = useState("");
  const [confirmUnpair, setConfirmUnpair] = useState(false); // two taps: re-pairing needs the PC

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
    const ready = pin.replace(/\D/g, "").length === 6;
    return (
      <Sheet
        open
        title="Enter pairing PIN"
        onClose={onClose}
        onBack={() => setPendingPair(null)}
        backLabel="Remote PC & TV"
      >
        <div className="sp-sheet">
          <h2 className="sp-page-title">Enter the PIN</h2>
          <p className="sp-lede">
            Your PC shows a 6-digit PIN next to the code you just scanned. It expires in about two
            minutes.
          </p>
          <Group>
            <div className="sp-field">
              <input
                className="sp-input rpc-pin"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="123456"
                aria-label="Pairing PIN"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                onKeyDown={(e) => e.key === "Enter" && ready && confirmPin()}
              />
            </div>
          </Group>
          {scanError && <Warn>{scanError}</Warn>}
          <button
            type="button"
            className="sp-btn sp-btn--primary rpc-wide"
            disabled={!ready}
            onClick={confirmPin}
          >
            Pair this PC
          </button>
        </div>
      </Sheet>
    );
  }

  const address = paired ? `${pcConfig.host}:${pcConfig.port || 8765}` : "";
  return (
    <Sheet open title="Remote PC & TV" onClose={onClose}>
      <div className="sp-sheet">
        <p className="sp-lede">
          Hand whole tasks to your Windows PC, and control an Android TV on this Wi-Fi, from here or
          by voice.
        </p>

        <Group title="PC">
          <div className="sp-field sp-row">
            <span className="rpc-name">
              <span className="sp-label">{paired ? "Windows PC" : "No PC paired"}</span>
              {paired && <span className="sp-desc sp-mono">{address}</span>}
            </span>
            {paired && <span className={`sp-readout sp-readout--${meta.tone}`}>{meta.label}</span>}
          </div>
          {paired && (
            <ActionRow
              icon="monitor"
              title="View and control the screen"
              desc={
                online
                  ? "Live screen, driven by touch. You arm control on the PC first."
                  : "Available once the PC is online."
              }
              disabled={!online}
              onClick={onViewScreen}
            />
          )}
          <ActionRow
            icon="camera"
            title={paired ? "Scan a new pairing code" : "Scan the code on your PC"}
            desc="On the PC: JARVIS, Settings, Remote Access."
            onClick={() => {
              setScanError("");
              setScanning(true);
            }}
          />
          {scanError && (
            <div className="sp-field">
              <Warn>{scanError}</Warn>
            </div>
          )}
          <div className="sp-field">
            <More label="How pairing works">
              The code carries the PC&apos;s address and an expiring identity challenge, never a
              password. When Tailscale is set up it includes that address too, so JARVIS reaches the
              PC from any network and switches to the faster direct link on the same Wi-Fi.
              {paired && pcConfig.hostFingerprint && (
                <> This PC&apos;s identity: {pcConfig.hostFingerprint.slice(0, 24)}…</>
              )}
            </More>
          </div>
        </Group>
        {paired && (
          <button
            type="button"
            className={`sp-btn sp-btn--quiet rpc-wide ${confirmUnpair ? "is-armed" : ""}`}
            onClick={() => {
              if (!confirmUnpair) return setConfirmUnpair(true);
              onUnpair();
              onClose();
            }}
            onBlur={() => setConfirmUnpair(false)}
          >
            {confirmUnpair ? "Tap again to unpair" : "Unpair this PC"}
          </button>
        )}

        {/* The user's TV — network ADB from this phone; nothing is installed on the TV. */}
        <Group title="TV">
          <div className="sp-field sp-row">
            <span className="sp-label">
              {tvConfig ? tvConfig.model || "Android TV" : "No TV set up"}
            </span>
            {tvConfig && <span className="sp-readout sp-readout--on">{tvConfig.host}</span>}
          </div>
          <Field label="TV's IP address" hint="On the TV: Settings, Network shows it.">
            <div className="sp-inline">
              <input
                className="sp-input sp-mono"
                type="text"
                inputMode="decimal"
                placeholder="192.168.0.50"
                aria-label="TV's IP address"
                value={tvHost}
                onChange={(e) => setTvHost(e.target.value.trim())}
              />
              <button
                type="button"
                className="sp-btn"
                disabled={tvBusy || !tvHost}
                onClick={connectTv}
              >
                {tvBusy ? "Waiting…" : tvConfig ? "Reconnect" : "Connect"}
              </button>
            </div>
          </Field>
          {tvBusy && (
            <div className="sp-field">
              <span className="sp-desc">
                If the TV asks “Allow USB debugging?”, tick Always allow and press OK.
              </span>
            </div>
          )}
          {tvResult && (
            <div className="sp-field">
              <span className={`sp-desc ${tvResult.ok ? "skill-out" : "skill-err"}`}>
                {tvResult.summary}
              </span>
            </div>
          )}
          <div className="sp-field">
            <More label="First time on this TV">
              On the TV: Settings, Device Preferences, About. Click Build 7 times, then turn on USB
              debugging in Developer options. Then enter its IP above and tap Connect.
            </More>
          </div>
        </Group>
        {tvConfig && (
          <button
            type="button"
            className="sp-btn sp-btn--quiet rpc-wide"
            onClick={() => {
              onTvUnpair();
              setTvResult(null);
            }}
          >
            Forget this TV
          </button>
        )}
      </div>
    </Sheet>
  );
}
