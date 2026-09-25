import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

/* ANDROID FORK — Camera QR scanner for Remote PC pairing.
 *
 * Opens the back camera, decodes frames with jsQR (pure JS, no native plugin needed —
 * the WebView's own getUserMedia works here exactly like it already does for the mic.
 * The OS-permission half is handled by Tauri's generated RustWebChromeClient
 * onPermissionRequest — there is no requestCameraPermission plugin command).
 * Calls onResult(text) once with the first decoded QR payload, or onCancel() if the
 * user backs out or the camera can't be used.
 */

export default function QrScanner({ onResult, onCancel }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const doneRef = useRef(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    const stop = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };

    const scanLoop = () => {
      if (cancelled || doneRef.current) return;
      const v = videoRef.current;
      const c = canvasRef.current;
      if (v && c && v.videoWidth) {
        c.width = v.videoWidth;
        c.height = v.videoHeight;
        const ctx = c.getContext("2d");
        ctx.drawImage(v, 0, 0, c.width, c.height);
        const frame = ctx.getImageData(0, 0, c.width, c.height);
        const code = jsQR(frame.data, c.width, c.height);
        if (code?.data) {
          doneRef.current = true;
          stop();
          onResult(code.data);
          return;
        }
      }
      rafRef.current = requestAnimationFrame(scanLoop);
    };

    (async () => {
      try {
        // No explicit pre-flight: `plugin:phone|request_camera_permission` never
        // existed in ANY layer (not in PhonePlugin.kt, not in the Rust commands, not
        // in build.rs COMMANDS), so the invoke always rejected with "command not
        // found" and the catch swallowed it — the comment claiming it "resolves
        // ok:false" was simply wrong.
        //
        // Nothing is lost by dropping it: getUserMedia below triggers the WebView's
        // onPermissionRequest, and Tauri's generated RustWebChromeClient already
        // requests the OS-level CAMERA grant from there.
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          await v.play().catch(() => {});
        }
        rafRef.current = requestAnimationFrame(scanLoop);
      } catch (e) {
        setError(
          "Couldn't open the camera — check JARVIS has camera permission in Android Settings, or enter the details manually instead. (" +
            (e?.message || e) +
            ")",
        );
      }
    })();

    return () => {
      cancelled = true;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 290, // above the settings-overlay (270) this replaces on screen
        background: "#000",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          background: "rgba(10,16,26,0.9)",
        }}
      >
        <span style={{ color: "#8fd0ff", fontWeight: 700 }}>Scan the code on your PC</span>
        <button className="settings-x" onClick={onCancel}>
          ✕
        </button>
      </div>

      <div style={{ position: "relative", flex: 1 }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
        <canvas ref={canvasRef} style={{ display: "none" }} />
        {!error && (
          <div
            style={{
              position: "absolute",
              inset: "18%",
              border: "3px solid #6fb4ff",
              borderRadius: 16,
              boxShadow: "0 0 0 999px rgba(0,0,0,0.35)",
              pointerEvents: "none",
            }}
          />
        )}
        {error && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
              color: "#ffb3b3",
              textAlign: "center",
              background: "rgba(0,0,0,0.7)",
            }}
          >
            {error}
          </div>
        )}
      </div>

      <div style={{ padding: 16, color: "#9fb2c8", fontSize: 13, textAlign: "center" }}>
        Point your camera at the code shown in the JARVIS window on your PC.
      </div>
    </div>
  );
}
