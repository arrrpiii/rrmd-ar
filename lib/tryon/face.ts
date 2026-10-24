import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { Point, Settings } from './engine';
let detector: Promise<FaceLandmarker> | null = null;
export async function detectFace(photo: HTMLCanvasElement) {
  detector ??= FilesetResolver.forVisionTasks('/vendor/vision')
    .then((files) =>
      FaceLandmarker.createFromOptions(files, {
        baseOptions: {
          modelAssetPath: '/models/face_landmarker.task',
          delegate: 'CPU',
        },
        runningMode: 'IMAGE',
        numFaces: 2,
      }),
    )
    .catch((e) => {
      detector = null;
      throw e;
    });
  const face = await detector;
  await new Promise((r) => setTimeout(r, 0));
  return face.detect(photo).faceLandmarks;
}
export function suggestPoints(
  landmarks: Point[] | null,
  kind: Settings['kind'],
): Point[] {
  const clamp = (n: number) => Math.max(0.03, Math.min(0.95, n));
  if (kind === 'ring' || kind === 'bracelet') {
    if (!landmarks || landmarks.length !== 21) return [{ x: 0.5, y: 0.5 }];
    const a = landmarks[kind === 'ring' ? 13 : 0],
      b = landmarks[kind === 'ring' ? 14 : 9];
    return [
      {
        x: clamp(
          kind === 'ring' ? a.x * 0.65 + b.x * 0.35 : a.x + (a.x - b.x) * 0.12,
        ),
        y: clamp(
          kind === 'ring' ? a.y * 0.65 + b.y * 0.35 : a.y + (a.y - b.y) * 0.12,
        ),
      },
    ];
  }
  if (kind === 'pendant' || kind === 'necklace') {
    if (!landmarks || landmarks.length !== 33) return [{ x: 0.5, y: 0.65 }];
    const left = landmarks[11],
      right = landmarks[12];
    const width = Math.abs(left.x - right.x);
    return [
      {
        x: clamp((left.x + right.x) / 2),
        y: clamp(
          (left.y + right.y) / 2 + width * (kind === 'pendant' ? 0.25 : 0.08),
        ),
      },
    ];
  }
  if (!landmarks || landmarks.length < 455)
    return [
      { x: 0.3, y: 0.48 },
      { x: 0.7, y: 0.48 },
    ];
  const h = landmarks[152].y - landmarks[10].y;
  return [landmarks[234], landmarks[454]]
    .sort((a, b) => a.x - b.x)
    .map((p, i) => ({
      x: clamp(p.x + (i === 0 ? -0.025 : 0.025)),
      y: clamp(p.y + h * 0.12),
    }));
}
