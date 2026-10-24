'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { ImagePlus, Box, Download, RotateCcw } from 'lucide-react';
import {
  defaults,
  loadModel,
  readPhoto,
  TryOnRenderer,
  type Settings,
  type Point,
} from '@/lib/tryon/engine';
import { CameraCapture } from '@/components/tryon/camera-capture';
import { suggestPoints } from '@/lib/tryon/face';
import { detectJewelleryLandmarks } from '@/lib/tryon/landmarks';
import {
  isLocalPage,
  localStatus,
  createLocalJob,
  pollLocalJob,
  cancelLocalJob,
} from '@/lib/tryon/local';

type Loaded = { name: string; meshes: number; triangles: number };
export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null),
    engine = useRef<TryOnRenderer | null>(null),
    landmarks = useRef<Point[] | null>(null),
    photoTicket = useRef(0);
  const [photoName, setPhotoName] = useState(''),
    [model, setModel] = useState<Loaded | null>(null),
    [settings, setSettings] = useState<Settings>({ ...defaults }),
    [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [_notice, setNotice] = useState(''),
    [_faceStatus, setFaceStatus] = useState(''),
    [generated, setGenerated] = useState(false),
    [result, setResult] = useState(''),
    [before, setBefore] = useState(false),
    [selected, setSelected] = useState(0),
    [ready, setReady] = useState(false),
    [localReady, setLocalReady] = useState(false),
    [localMessage, setLocalMessage] = useState('Checking editor…'),
    [natural, setNatural] = useState(false),
    [jobId, setJobId] = useState(''),
    [cameraOpen, setCameraOpen] = useState(false);
  const resultRef = useRef('');
  const clearResult = useCallback(() => {
    if (resultRef.current) URL.revokeObjectURL(resultRef.current);
    resultRef.current = '';
    setResult('');
    setNatural(false);
  }, []);
  async function connectLocal() {
    try {
      const status = await localStatus();
      setLocalReady(status.model_ready);
      setLocalMessage(
        status.model_ready
          ? 'FLUX.2 Klein · ready'
          : 'The image editor is not ready yet.',
      );
    } catch {
      setLocalReady(false);
      setLocalMessage(
        isLocalPage()
          ? 'Start npm run local in the tryon folder, then reconnect.'
          : 'The image editor is unavailable. Please reconnect shortly.',
      );
    }
  }
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void connectLocal();
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    let instance: TryOnRenderer | null = null;
    const ticket = photoTicket;
    const output = resultRef;
    const startup = requestAnimationFrame(() => {
      try {
        instance = new TryOnRenderer();
        engine.current = instance;
        setReady(true);
      } catch {
        setError(
          '3D rendering is unavailable in this browser. Enable hardware acceleration or use a recent Chrome, Edge or Safari.',
        );
      }
    });
    return () => {
      cancelAnimationFrame(startup);
      ticket.current++;
      instance?.dispose();
      engine.current = null;
      if (output.current) URL.revokeObjectURL(output.current);
    };
  }, []);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        if (canvasRef.current)
          engine.current?.draw(
            canvasRef.current,
            settings,
            generated && !before,
          );
      } catch (e) {
        setError(
          'Rendering failed. Try a smaller model or reduce the image size.',
        );
        console.error(e);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [settings, generated, before, photoName, model]);
  const update = (patch: Partial<Settings>) => {
    clearResult();
    setBefore(false);
    setSettings((s) => ({ ...s, ...patch }));
  };
  async function onPhoto(file?: File) {
    if (!file || !engine.current) return;
    setBusy('Reading photo…');
    setError('');
    setNotice('');
    const ticket = ++photoTicket.current;
    clearResult();
    setGenerated(false);
    setFaceStatus('');
    try {
      const photo = await readPhoto(file);
      if (ticket !== photoTicket.current) return;
      engine.current.photo = photo;
      setPhotoName(file.name);
      landmarks.current = null;
      if (canvasRef.current)
        engine.current.draw(canvasRef.current, settings, false);
      setBusy('Checking placement…');
      try {
        const faces = await detectJewelleryLandmarks(photo, settings.kind);
        if (ticket !== photoTicket.current) return;
        if (faces.length === 1) {
          landmarks.current = faces[0];
          setFaceStatus('Face detected');
          setNotice(
            'Placement is estimated. Click the photo to refine each attachment point.',
          );
        } else {
          setFaceStatus(
            faces.length > 1 ? 'Multiple faces' : 'Manual placement',
          );
          setNotice(
            faces.length > 1
              ? 'More than one face found. Use a solo portrait or position the jewellery manually.'
              : 'No face found. You can still generate a preview and click the photo to position the jewellery.',
          );
        }
      } catch {
        if (ticket !== photoTicket.current) return;
        setFaceStatus('Manual placement');
        setNotice(
          'Face detection is unavailable. Generate a preview, then click the photo to place the jewellery.',
        );
      }
      setSettings((s) => ({
        ...s,
        points: suggestPoints(landmarks.current, s.kind),
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open that photo.');
    } finally {
      if (ticket === photoTicket.current) setBusy('');
    }
  }
  async function changeKind(kind: Settings['kind']) {
    setSelected(0);
    landmarks.current = null;
    update({
      kind,
      points: suggestPoints(null, kind),
      size:
        kind === 'ring'
          ? 5
          : kind === 'bracelet'
            ? 16
            : kind === 'necklace'
              ? 30
              : 14,
    });
    const photo = engine.current?.photo;
    if (!photo) return;
    setBusy('Checking placement…');
    try {
      const found = await detectJewelleryLandmarks(photo, kind);
      landmarks.current = found.length === 1 ? found[0] : null;
      setSettings((s) => ({
        ...s,
        points: suggestPoints(landmarks.current, kind),
      }));
    } catch {
      landmarks.current = null;
    } finally {
      setBusy('');
    }
  }
  async function onModel(file?: File) {
    if (!file || !engine.current) return;
    setBusy('Opening 3D model…');
    setError('');
    clearResult();
    setGenerated(false);
    try {
      const loaded = await loadModel(file);
      if (!engine.current) return;
      engine.current.setModel(loaded.object);
      setModel({
        name: file.name,
        meshes: loaded.meshes,
        triangles: loaded.triangles,
      });
      setSettings((s) => ({
        ...s,
        rx: loaded.ext === '3dm' ? -90 : 0,
        ry: 0,
        rz: 0,
        finish: 'original',
      }));
    } catch (e) {
      setModel(null);
      setError(
        e instanceof Error
          ? e.message
          : 'Could not open this model. Try exporting a meshed GLB or STL.',
      );
    } finally {
      setBusy('');
    }
  }
  const generate = useCallback(async () => {
    if (!engine.current?.photo || !model || !canvasRef.current)
      throw new Error('Upload both a photo and a model first.');
    setBusy('Preparing placement guide…');
    setError('');
    setBefore(false);
    clearResult();
    try {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      engine.current.draw(canvasRef.current, settings, true);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvasRef.current!.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Image export failed.'))),
          'image/png',
        ),
      );
      resultRef.current = URL.createObjectURL(blob);
      setResult(resultRef.current);
      setGenerated(true);
      return {
        status: 'generated',
        width: canvasRef.current.width,
        height: canvasRef.current.height,
      };
    } finally {
      setBusy('');
    }
    // eslint-disable-next-line react/react-compiler -- The external renderer consumes the complete settings object.
  }, [model, settings, clearResult]);
  async function generateNatural() {
    if (!engine.current?.photo || !model || busy) return;
    setBusy('Preparing local edit…');
    setError('');
    clearResult();
    setBefore(false);
    try {
      const data = await engine.current.localEditInputs(settings);
      const job = await createLocalJob(data);
      setJobId(job.id);
      const blob = await pollLocalJob(job.id, setBusy);
      resultRef.current = URL.createObjectURL(blob);
      setResult(resultRef.current);
      setNatural(true);
      setGenerated(true);
      setNotice(
        'Local AI result is below the placement guide. Adjusting the fit clears the result.',
      );
      requestAnimationFrame(() =>
        document
          .getElementById('generated-result')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Local generation failed.');
    } finally {
      setBusy('');
      setJobId('');
    }
  }
  // Optional WebMCP surface uses the same completed action as the visible button.
  const generateRef = useRef(generate);
  useEffect(() => {
    generateRef.current = generate;
  }, [generate]);
  useEffect(() => {
    const context = (
      document as Document & {
        modelContext?: {
          registerTool: (tool: unknown, options: unknown) => unknown;
        };
      }
    ).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      Promise.resolve(
        context.registerTool(
          {
            name: 'generate_tryon_image',
            description:
              'Generate and display a PNG using the currently uploaded photo, model and placement. Requires both uploads.',
            inputSchema: {
              type: 'object',
              properties: {},
              additionalProperties: false,
            },
            annotations: { readOnlyHint: false },
            execute: async (input: unknown) => {
              if (
                !input ||
                typeof input !== 'object' ||
                Array.isArray(input) ||
                Object.keys(input).length
              )
                throw new Error('Expected an empty object.');
              return generateRef.current();
            },
          },
          { signal: lifecycle.signal },
        ),
      ).catch(() => {});
    } catch {}
    return () => lifecycle.abort();
  }, []);
  const uploadDisabled = !ready || !!busy;
  const p = settings.points[selected] ?? settings.points[0];
  function setPoint(point: Point) {
    update({
      points: settings.points.map((old, i) => (i === selected ? point : old)),
    });
  }
  return (
    <main className="steps-layout">
      <section className="step-card step-wide" aria-label="Jewellery">
        <h2>
          <span>01</span> Jewellery
        </h2>
        <label className="upload">
          <Box size={23} />
          <strong>{model?.name || 'Choose a 3D model'}</strong>
          <input
            aria-label="Upload jewellery model"
            disabled={uploadDisabled || cameraOpen}
            type="file"
            accept=".3dm,.glb,.stl"
            onChange={(e) => {
              void onModel(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
        <label className="field">
          Try-on type
          <select
            aria-label="Try-on type"
            disabled={!!busy || cameraOpen}
            value={settings.kind}
            onChange={(e) =>
              void changeKind(e.target.value as Settings['kind'])
            }
          >
            <option value="ring">Ring</option>
            <option value="earrings">Earring</option>
            <option value="pendant">Pendant</option>
            <option value="necklace">Necklace</option>
            <option value="bracelet">Bracelet</option>
          </select>
        </label>
      </section>
      <section className="step-card step-wide" aria-label="Photo">
        <h2>
          <span>02</span> Photo
        </h2>
        <label className="upload">
          <ImagePlus size={23} />
          <strong>{photoName || 'Choose a portrait'}</strong>
          <input
            aria-label="Upload portrait"
            disabled={uploadDisabled || cameraOpen}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => {
              void onPhoto(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
        <button
          className="camera-open"
          disabled={uploadDisabled || cameraOpen}
          onClick={() => setCameraOpen(true)}
        >
          Use camera
        </button>
        {cameraOpen && (
          <CameraCapture
            kind={settings.kind}
            onClose={() => setCameraOpen(false)}
            onCapture={(file) => {
              setCameraOpen(false);
              void onPhoto(file);
            }}
          />
        )}
      </section>
      <section className="step-card step-wide" aria-label="Preview">
        <div className="step-toolbar">
          <h2>
            <span>03</span> Preview
          </h2>
          <button
            disabled={!photoName || !model || !ready || !!busy || cameraOpen}
            onClick={() => void generate().catch((e) => setError(e.message))}
          >
            Preview placement
          </button>
          {generated && (
            <button onClick={() => setBefore((v) => !v)}>
              {before ? 'Show placement' : 'Show original'}
            </button>
          )}
        </div>
        <div className="preview-layout">
          <div className="canvas-area" hidden={!photoName}>
            <div className="canvas-wrap">
              <canvas
                ref={canvasRef}
                aria-label="Interactive try-on preview"
                onClick={(e) => {
                  if (!generated || before || busy) return;
                  const b = e.currentTarget.getBoundingClientRect();
                  setPoint({
                    x: Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)),
                    y: Math.max(0, Math.min(1, (e.clientY - b.top) / b.height)),
                  });
                }}
              />
              {generated &&
                !before &&
                settings.points.map((pt, i) => (
                  <span
                    key={i}
                    className={`anchor ${selected === i ? 'selected' : ''}`}
                    style={{ left: `${pt.x * 100}%`, top: `${pt.y * 100}%` }}
                  >
                    {i + 1}
                  </span>
                ))}
            </div>
          </div>
          {generated && (
            <fieldset className="fitting" disabled={!!busy}>
              <div className="segmented">
                {settings.points.map((_, i) => (
                  <button
                    aria-pressed={selected === i}
                    key={i}
                    onClick={() => setSelected(i)}
                  >
                    {settings.kind === 'earrings'
                      ? i === 0
                        ? 'Image left'
                        : 'Image right'
                      : 'Attachment point'}
                  </button>
                ))}
              </div>
              <Range
                label="Horizontal position"
                value={Math.round(p.x * 100)}
                min={0}
                max={100}
                onChange={(v) => setPoint({ ...p, x: v / 100 })}
                suffix="%"
              />
              <Range
                label="Vertical position"
                value={Math.round(p.y * 100)}
                min={0}
                max={100}
                onChange={(v) => setPoint({ ...p, y: v / 100 })}
                suffix="%"
              />
              <Range
                label="Size"
                value={settings.size}
                min={1}
                max={70}
                onChange={(v) => update({ size: v })}
                suffix="%"
              />
              <details>
                <summary>Orientation & finish</summary>
                <Range
                  label="Tilt X"
                  value={settings.rx}
                  min={-180}
                  max={180}
                  onChange={(v) => update({ rx: v })}
                  suffix="°"
                />
                <Range
                  label="Turn Y"
                  value={settings.ry}
                  min={-180}
                  max={180}
                  onChange={(v) => update({ ry: v })}
                  suffix="°"
                />
                <Range
                  label="Rotate Z"
                  value={settings.rz}
                  min={-180}
                  max={180}
                  onChange={(v) => update({ rz: v })}
                  suffix="°"
                />
                <label className="field">
                  Finish
                  <select
                    aria-label="Finish"
                    value={settings.finish}
                    onChange={(e) =>
                      update({ finish: e.target.value as Settings['finish'] })
                    }
                  >
                    <option value="original">Original materials</option>
                    <option value="gold">Gold — whole piece</option>
                    <option value="silver">Silver — whole piece</option>
                    <option value="rose">Rose gold — whole piece</option>
                  </select>
                </label>
                <Range
                  label="Lighting"
                  value={Math.round(settings.exposure * 100)}
                  min={30}
                  max={250}
                  onChange={(v) => update({ exposure: v / 100 })}
                  suffix="%"
                />
              </details>
              <button
                className="reset"
                onClick={() => {
                  setSelected(0);
                  update({
                    points: suggestPoints(landmarks.current, settings.kind),
                    size: 14,
                    ry: 0,
                    rz: 0,
                  });
                }}
              >
                <RotateCcw size={14} />
                Reset placement
              </button>
            </fieldset>
          )}
        </div>
      </section>
      <section
        className="step-card step-wide"
        aria-label="Try on"
        id="generated-result"
      >
        <div className="step-toolbar">
          <h2>
            <span>04</span> Try on
          </h2>
          <button
            className="natural-button"
            disabled={!generated || !localReady || !!busy || cameraOpen}
            onClick={() => void generateNatural()}
          >
            {jobId ? 'Generating…' : 'Generate try-on'}
          </button>
          {jobId && (
            <button
              onClick={() =>
                void cancelLocalJob(jobId).catch((e) => setError(e.message))
              }
            >
              Cancel generation
            </button>
          )}
          {!localReady && (
            <button
              disabled={!!busy}
              title={localMessage}
              onClick={() => void connectLocal()}
            >
              Reconnect editor
            </button>
          )}
          {natural && result && (
            <a
              className="download"
              href={result}
              download="atelier-local-ai-try-on.png"
            >
              <Download size={17} /> Download PNG
            </a>
          )}
        </div>
        {busy && <output className="status">{busy}</output>}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {natural &&
          result && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="result-image"
              src={result}
              alt="Locally generated natural jewellery try-on"
            />
          )}
      </section>
    </main>
  );
}

function Range({
  label,
  value,
  min,
  max,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  suffix: string;
}) {
  return (
    <label className="range">
      <span>
        {label}
        <output>
          {value}
          {suffix}
        </output>
      </span>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
