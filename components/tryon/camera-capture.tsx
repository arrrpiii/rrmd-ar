'use client';
import { useEffect, useRef, useState } from 'react';
import { createLandmarkDetector, type Landmark } from '@/lib/tryon/landmarks';
import { drawCameraGuide } from '@/lib/tryon/camera-guide';
import { assessCamera, type FitCheck } from '@/lib/tryon/camera-fit';
import type { Settings } from '@/lib/tryon/engine';

export function CameraCapture({
  kind,
  onCapture,
  onClose,
}: {
  kind: Settings['kind'];
  onCapture: (file: File) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const detectorRef = useRef<Awaited<
    ReturnType<typeof createLandmarkDetector>
  > | null>(null);
  const stableSince = useRef(0);
  const latest = useRef(0);
  const [mode, setMode] = useState<'manual' | 'auto'>('manual');
  const modeRef = useRef<'manual' | 'auto'>('manual');
  const captureRef = useRef<(automatic?: boolean) => Promise<void>>(
    async () => {},
  );
  const captureLock = useRef(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [checks, setChecks] = useState<FitCheck[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [capturing, setCapturing] = useState(false);
  useEffect(() => {
    let stopped = false,
      stream: MediaStream | undefined,
      detector: Awaited<ReturnType<typeof createLandmarkDetector>> | undefined;
    let frame = 0,
      lastCheck = 0,
      lastVideoTime = -1;
    let target: Landmark[] | undefined, smooth: Landmark[] | undefined;
    let guideValid = false;
    const stopTracks = () =>
      stream?.getTracks().forEach((track) => track.stop());
    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia)
          throw new Error(
            'Camera access requires localhost or HTTPS and a supported browser.',
          );
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: 'user',
            width: { ideal: 1280 },
            height: { ideal: 960 },
          },
        });
        if (stopped) {
          stopTracks();
          return;
        }
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        detector = await createLandmarkDetector(kind, 'VIDEO');
        if (stopped) {
          detector.close();
          return;
        }
        detectorRef.current = detector;
        // Feed MediaPipe an explicit pixel snapshot, avoiding browser-specific
        // video texture cropping. Draw the preview from this same pixel space.
        const input = document.createElement('canvas');
        const inputContext = input.getContext('2d')!;
        const snapshot = () => {
          if (
            input.width !== video.videoWidth ||
            input.height !== video.videoHeight
          ) {
            input.width = video.videoWidth;
            input.height = video.videoHeight;
          }
          inputContext.drawImage(video, 0, 0, input.width, input.height);
          return input;
        };
        function tick(now: number) {
          if (stopped) return;
          if (document.hidden || video.paused || video.readyState < 2) {
            stableSince.current = 0;
            latest.current = 0;
            setCountdown(null);
            setReady(false);
          } else if (
            now - lastCheck > 180 &&
            video.currentTime !== lastVideoTime
          ) {
            lastCheck = now;
            lastVideoTime = video.currentTime;
            try {
              const faces = detector!.detect(snapshot(), now);
              const next = assessCamera(
                faces,
                kind,
                video.videoWidth / video.videoHeight,
              );
              latest.current = now;
              const good = next.every((c) => c.pass);
              stableSince.current = good ? stableSince.current || now : 0;
              setReady(good && now - stableSince.current > 900);
              setChecks(next);
              if (modeRef.current === 'auto' && good) {
                const elapsed = now - stableSince.current;
                setCountdown(Math.max(1, Math.ceil((3000 - elapsed) / 1000)));
                if (elapsed >= 3000 && !captureLock.current)
                  void captureRef.current(true).catch(() => {
                    setError('Capture failed. Reopen the camera.');
                    setReady(false);
                  });
              } else setCountdown(null);
              target = faces.length === 1 ? faces[0] : undefined;
              guideValid = good;
            } catch {
              setError(
                'Live landmark detection failed. Close the camera and retry, or upload a photo.',
              );
              setReady(false);
              stopTracks();
              return;
            }
          } else if (now - latest.current > 1000) {
            stableSince.current = 0;
            setCountdown(null);
            setReady(false);
          }
          const canvas = overlayRef.current;
          if (canvas && video.videoWidth) {
            if (
              canvas.width !== video.videoWidth ||
              canvas.height !== video.videoHeight
            ) {
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
            }
            if (
              document.hidden ||
              video.paused ||
              now - latest.current > 1000
            ) {
              target = undefined;
              guideValid = false;
            }
            smooth = target?.map((point, i) => ({
              ...point,
              x: smooth?.[i]
                ? smooth[i].x + (point.x - smooth[i].x) * 0.22
                : point.x,
              y: smooth?.[i]
                ? smooth[i].y + (point.y - smooth[i].y) * 0.22
                : point.y,
            }));
            const context = canvas.getContext('2d')!;
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            drawCameraGuide(
              context,
              canvas.width,
              canvas.height,
              smooth,
              kind,
              guideValid,
            );
          }
          frame = requestAnimationFrame(tick);
        }
        frame = requestAnimationFrame(tick);
      } catch (e) {
        stopTracks();
        if (!stopped)
          setError(
            e instanceof DOMException && e.name === 'NotAllowedError'
              ? 'Camera permission was denied. Allow camera access in your browser, then reopen the camera.'
              : e instanceof Error
                ? e.message
                : 'Could not start the camera. You can still upload a photo.',
          );
      }
    }
    void start();
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stopTracks();
      detectorRef.current = null;
      detector?.close();
      stableSince.current = 0;
    };
  }, [kind]);
  async function capture(automatic = false) {
    const video = videoRef.current,
      detector = detectorRef.current;
    if (!video || !detector || (!automatic && !ready) || captureLock.current)
      return;
    const now = performance.now();
    const snapshot = document.createElement('canvas');
    snapshot.width = video.videoWidth;
    snapshot.height = video.videoHeight;
    snapshot.getContext('2d')!.drawImage(video, 0, 0);
    if (
      document.hidden ||
      video.paused ||
      now - latest.current > 1000 ||
      !assessCamera(
        detector.detect(snapshot, now),
        kind,
        video.videoWidth / video.videoHeight,
      ).every((c) => c.pass)
    ) {
      setReady(false);
      stableSince.current = 0;
      return;
    }
    captureLock.current = true;
    setCapturing(true);
    const canvas = snapshot;
    canvas.toBlob(
      (blob) => {
        if (blob)
          onCapture(
            new File([blob], 'camera-portrait.jpg', { type: 'image/jpeg' }),
          );
        else {
          setError('Could not capture the photo. Please retry.');
          captureLock.current = false;
          setCapturing(false);
        }
      },
      'image/jpeg',
      0.95,
    );
  }
  useEffect(() => {
    captureRef.current = capture;
  });
  return (
    <section className="camera-panel" aria-label="Live camera capture">
      <div className="camera-heading">
        <div className="segmented">
          {(['manual', 'auto'] as const).map((value) => (
            <button
              key={value}
              aria-pressed={mode === value}
              disabled={capturing}
              onClick={() => {
                modeRef.current = value;
                setMode(value);
                stableSince.current = 0;
                setReady(false);
                setCountdown(null);
              }}
            >
              {value === 'manual' ? 'Manual' : 'Automatic'}
            </button>
          ))}
        </div>
        <button onClick={onClose}>Close camera</button>
      </div>
      <div className="camera-view">
        <video ref={videoRef} autoPlay muted playsInline aria-hidden="true" />
        <canvas ref={overlayRef} role="img" aria-label="Live camera preview" />
      </div>
      <p
        className={`camera-status ${error ? 'camera-error' : ready || countdown !== null ? 'camera-ready' : ''}`}
        role="status"
      >
        <span className="camera-status-dot" aria-hidden="true" />
        {error ||
          (mode === 'auto' && countdown !== null
            ? `Capturing in ${countdown}…`
            : ready
              ? 'Ready to capture'
              : checks.find((check) => !check.pass)?.label || 'Hold still…')}
      </p>
      {mode === 'manual' && (
        <button
          className="primary"
          disabled={!ready || !!error || capturing}
          onClick={() =>
            void capture().catch(() => {
              setError('Capture failed. Close the camera and retry.');
              setReady(false);
              captureLock.current = false;
              setCapturing(false);
            })
          }
        >
          {capturing ? 'Capturing…' : 'Capture photo'}
        </button>
      )}
    </section>
  );
}
