'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, X } from 'lucide-react';

/**
 * Camera SKU scanner for the invoice form (Android / Chromium).
 *
 * Uses the browser's built-in BarcodeDetector — zero dependencies. Reads the
 * QR and Code128 that the printed SKU labels carry (both encode the verbatim
 * sku_code), and hands the decoded string back via onDetected, straight into
 * the caller's existing handleScan() path.
 *
 * Requires HTTPS (or localhost). Over plain http the camera is blocked by the
 * browser with no prompt; that surfaces here as a start error. If the browser
 * has no BarcodeDetector (e.g. iOS Safari), the overlay explains that and the
 * user can still type / hardware-scan the code as before.
 */

const FORMATS = ['qr_code', 'code_128'];

// BarcodeDetector isn't in the TS DOM lib yet — minimal local typing.
type DetectedBarcode = { rawValue: string };
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
interface BarcodeDetectorCtor {
  new (opts?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats(): Promise<string[]>;
}

function getNativeCtor(): BarcodeDetectorCtor | undefined {
  return (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor })
    .BarcodeDetector;
}

async function nativeUsable(): Promise<boolean> {
  const Ctor = getNativeCtor();
  if (!Ctor) return false;
  try {
    const supported = await Ctor.getSupportedFormats();
    return FORMATS.some((f) => supported.includes(f));
  } catch {
    return false;
  }
}

export function ScanButton({
  onDetected,
  label = 'Scan',
}: {
  onDetected: (code: string) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    let stream: MediaStream | null = null;
    let rafId: number | null = null;

    function cleanup() {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
    }

    function finish(code: string) {
      if (cancelled) return;
      cancelled = true;
      cleanup();
      setOpen(false);
      onDetected(code.trim());
    }

    (async () => {
      try {
        if (!(await nativeUsable())) {
          setError(
            "This phone's browser can't scan. Use Chrome on Android, or type the code.",
          );
          return;
        }

        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (cancelled) return cleanup();

        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();

        const detector = new (getNativeCtor()!)({ formats: FORMATS });

        const tick = async () => {
          if (cancelled) return;
          try {
            const codes = await detector.detect(video);
            const hit = codes.find((c) => c.rawValue);
            if (hit) return finish(hit.rawValue);
          } catch {
            // transient per-frame detect errors are expected; keep looping
          }
          rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
      } catch (e) {
        // Most common causes: no HTTPS, permission denied, no camera.
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : 'Camera could not be started',
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [open, onDetected]);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="btn-ghost flex items-center gap-1 border border-neutral-300"
      >
        <Camera className="h-4 w-4" />
        {label}
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-black">
          <div className="flex items-center justify-between p-3 text-white">
            <span className="text-sm">{label}</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="rounded-full p-2 hover:bg-white/10"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="relative flex-1">
            {/* playsInline keeps the stream inline instead of opening a native
                fullscreen player; muted allows autoplay after the click */}
            <video
              ref={videoRef}
              className="h-full w-full object-cover"
              muted
              playsInline
            />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-48 w-48 rounded-lg border-2 border-white/80" />
            </div>
          </div>

          {error ? (
            <p className="bg-red-600 p-3 text-center text-sm text-white">
              {error}
            </p>
          ) : (
            <p className="p-3 text-center text-xs text-white/70">
              Point the camera at the label barcode or QR code
            </p>
          )}
        </div>
      ) : null}
    </>
  );
}
