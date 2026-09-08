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
  if (!landmarks)
    return kind === 'earrings'
      ? [
          { x: 0.3, y: 0.48 },
          { x: 0.7, y: 0.48 },
        ]
      : [{ x: 0.5, y: 0.73 }];
  const left = landmarks[234],
    right = landmarks[454],
    chin = landmarks[152],
    top = landmarks[10];
  const clamp = (n: number) => Math.max(0.03, Math.min(0.95, n));
  const h = chin.y - top.y;
  // Cheek landmarks estimate nearby earlobes, not actual piercing locations.
  if (kind === 'earrings')
    return [left, right]
      .sort((a, b) => a.x - b.x)
      .map((p, i) => ({
        x: clamp(p.x + (i === 0 ? -0.025 : 0.025)),
        y: clamp(p.y + h * 0.12),
      }));
  return [{ x: clamp(chin.x), y: clamp(chin.y + h * 0.4) }];
}
