import type { Settings } from './engine';
import { usesHand, usesBody, type Landmark } from './landmarks';
export type FitCheck = { label: string; pass: boolean };
// Conservative framing heuristics, not a physical fit or ear-visibility classifier.
export function assessCamera(
  faces: Landmark[][],
  kind: Settings['kind'],
  aspect: number,
): FitCheck[] {
  if (usesHand(kind)) return assessHand(faces, kind, aspect);
  if (usesBody(kind)) return assessBody(faces, kind, aspect);
  if (faces.length !== 1)
    return [
      {
        label: faces.length
          ? 'Only one person should be in frame'
          : 'Bring your face into view',
        pass: false,
      },
    ];
  const f = faces[0];
  if (f.length < 455)
    return [{ label: 'Waiting for reliable face landmarks', pass: false }];
  const left = f[234],
    right = f[454],
    nose = f[1],
    top = f[10],
    chin = f[152];
  const width = Math.abs(right.x - left.x),
    height = chin.y - top.y;
  const center = (left.x + right.x) / 2;
  const roll = Math.abs(
    Math.atan2(f[263].y - f[33].y, (f[263].x - f[33].x) * aspect),
  );
  const tilt = Math.min(roll, Math.abs(Math.PI - roll));
  return [
    { label: 'One face detected', pass: true },
    {
      label: 'Keep your whole face inside the frame',
      pass:
        top.y > 0.04 &&
        chin.y < 0.92 &&
        Math.min(left.x, right.x) > 0.07 &&
        Math.max(left.x, right.x) < 0.93,
    },
    { label: 'Center your face', pass: Math.abs(center - 0.5) < 0.15 },
    {
      label: 'Look straight at the camera and keep your head level',
      pass:
        width > 0 && Math.abs(nose.x - center) / width < 0.17 && tilt < 0.16,
    },
    {
      label: 'Move closer or farther until your face fits the guide',
      pass: height > 0.27 && height < 0.72,
    },
  ];
}

const inside = (p: Landmark, margin = 0.04) =>
  Number.isFinite(p.x) &&
  Number.isFinite(p.y) &&
  p.x > margin &&
  p.x < 1 - margin &&
  p.y > margin &&
  p.y < 1 - margin;
const distance = (a: Landmark, b: Landmark, aspect: number) =>
  Math.hypot((a.x - b.x) * aspect, a.y - b.y);
function assessHand(
  hands: Landmark[][],
  kind: Settings['kind'],
  aspect: number,
): FitCheck[] {
  if (hands.length !== 1)
    return [
      {
        label: hands.length
          ? 'Show only one hand'
          : 'Bring your hand and wrist into view',
        pass: false,
      },
    ];
  const h = hands[0];
  if (h.length !== 21)
    return [{ label: 'Waiting for hand landmarks', pass: false }];
  const palm = distance(h[5], h[17], aspect),
    wrist = h[0],
    middle = h[9];
  const ringLength = distance(h[13], h[16], aspect),
    ringPath =
      distance(h[13], h[14], aspect) +
      distance(h[14], h[15], aspect) +
      distance(h[15], h[16], aspect);
  const wristArea = {
    x: wrist.x + (wrist.x - middle.x) * 0.5,
    y: wrist.y + (wrist.y - middle.y) * 0.5,
  };
  return [
    { label: 'Keep the whole hand in frame', pass: h.every((p) => inside(p)) },
    {
      label: 'Move your hand closer or farther',
      pass: palm > 0.1 && palm < 0.55,
    },
    {
      label: 'Face your palm or back of hand toward the camera',
      pass: Math.abs((h[5].z ?? 0) - (h[17].z ?? 0)) * aspect < palm * 0.6,
    },
    ...(kind === 'ring'
      ? [
          {
            label: 'Straighten your ring finger',
            pass:
              ringLength > palm * 0.65 &&
              ringLength / Math.max(ringPath, 0.001) > 0.88,
          },
          {
            label: 'Separate the ring finger from its neighbours',
            pass:
              distance(h[14], h[10], aspect) > palm * 0.14 &&
              distance(h[14], h[18], aspect) > palm * 0.14,
          },
        ]
      : [
          {
            label: 'Include your wrist and some forearm',
            pass: inside(wrist, 0.14) && inside(wristArea, 0.08),
          },
        ]),
  ];
}
function assessBody(
  bodies: Landmark[][],
  kind: Settings['kind'],
  aspect: number,
): FitCheck[] {
  if (bodies.length !== 1)
    return [
      {
        label: bodies.length
          ? 'Only one person should be in frame'
          : 'Show your neck and both shoulders',
        pass: false,
      },
    ];
  const p = bodies[0];
  if (p.length !== 33)
    return [{ label: 'Waiting for body landmarks', pass: false }];
  const left = p[11],
    right = p[12],
    nose = p[0];
  const width = Math.abs(left.x - right.x),
    center = (left.x + right.x) / 2,
    shoulderY = (left.y + right.y) / 2;
  const chestY =
    shoulderY + width * aspect * (kind === 'pendant' ? 0.55 : 0.35);
  return [
    {
      label: 'Keep your face and both shoulders visible',
      pass: [nose, left, right].every(
        (v) => inside(v) && (v.visibility ?? 0) > 0.65,
      ),
    },
    {
      label: 'Center your neck and shoulders',
      pass:
        Math.abs(center - 0.5) < 0.14 &&
        Math.abs(nose.x - center) < width * 0.2,
    },
    {
      label: 'Face the camera with shoulders level',
      pass:
        width > 0.01 &&
        Math.abs(left.y - right.y) / (width * aspect) < 0.18 &&
        Math.abs((left.z ?? 0) - (right.z ?? 0)) < width * 0.65,
    },
    {
      label: 'Step back to fit both shoulders',
      pass: width > 0.28 && width < 0.82,
    },
    {
      label:
        kind === 'pendant'
          ? 'Include more chest below the pendant'
          : 'Leave space for the neckline',
      pass: chestY < 0.92 && nose.y < shoulderY - 0.04,
    },
  ];
}
