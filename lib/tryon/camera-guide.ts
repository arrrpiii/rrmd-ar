import type { Settings } from './engine';
import type { Landmark } from './landmarks';

/** Quiet framing corners and a soft guide around only the jewellery area. */
export function drawCameraGuide(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  points: Landmark[] | undefined,
  kind: Settings['kind'],
  valid: boolean,
) {
  // The caller paints the camera frame; guides share its exact pixel space.
  const unit = width / 480;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 2 * unit;
  ctx.strokeStyle = valid ? '#91ebc5' : '#fff0d6';
  ctx.shadowColor = 'rgba(14, 32, 25, .45)';
  ctx.shadowBlur = 5 * unit;
  // Open corners leave the face and hand unobstructed.
  const inset = width * 0.07,
    top = height * 0.07,
    size = 19 * unit;
  ctx.globalAlpha = 0.8;
  for (const [x, y, sx, sy] of [
    [inset, top, 1, 1],
    [width - inset, top, -1, 1],
    [inset, height - top, 1, -1],
    [width - inset, height - top, -1, -1],
  ]) {
    ctx.beginPath();
    ctx.moveTo(x, y + sy * size);
    ctx.lineTo(x, y + sy * 6 * unit);
    ctx.quadraticCurveTo(x, y, x + sx * 6 * unit, y);
    ctx.lineTo(x + sx * size, y);
    ctx.stroke();
  }
  if (!points) {
    ctx.restore();
    return;
  }
  const p = (i: number) => ({
    x: points[i].x * width,
    y: points[i].y * height,
  });
  const ellipse = (x: number, y: number, rx: number, ry: number, angle = 0) => {
    ctx.beginPath();
    ctx.ellipse(
      x,
      y,
      Math.max(rx, 4 * unit),
      Math.max(ry, 4 * unit),
      angle,
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = valid ? 'rgba(145,235,197,.08)' : 'rgba(255,240,214,.07)';
    ctx.fill();
    ctx.stroke();
  };
  ctx.globalAlpha = 0.9;
  if (kind === 'earrings' && points.length > 454) {
    const faceHeight = Math.abs(p(152).y - p(10).y);
    for (const [index, side] of [
      [234, -1],
      [454, 1],
    ]) {
      const cheek = p(index);
      ellipse(
        cheek.x + side * width * 0.018,
        cheek.y + faceHeight * 0.13,
        faceHeight * 0.065,
        faceHeight * 0.105,
        side * -0.12,
      );
    }
  } else if ((kind === 'ring' || kind === 'bracelet') && points.length >= 21) {
    const palm = Math.hypot(p(5).x - p(17).x, p(5).y - p(17).y);
    const a = p(kind === 'ring' ? 13 : 0),
      b = p(kind === 'ring' ? 14 : 9);
    const angle = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2;
    const t = kind === 'ring' ? 0.35 : -0.12;
    ellipse(
      a.x + (b.x - a.x) * t,
      a.y + (b.y - a.y) * t,
      palm * (kind === 'ring' ? 0.13 : 0.42),
      palm * (kind === 'ring' ? 0.09 : 0.17),
      angle,
    );
  } else if (
    (kind === 'pendant' || kind === 'necklace') &&
    points.length >= 33
  ) {
    const a = p(11),
      b = p(12);
    const cx = (a.x + b.x) / 2,
      cy = (a.y + b.y) / 2;
    const span = Math.hypot(a.x - b.x, a.y - b.y);
    ctx.translate(cx, cy);
    ctx.rotate(Math.atan2(a.y - b.y, a.x - b.x));
    ctx.beginPath();
    ctx.moveTo(-span * 0.22, -span * 0.08);
    ctx.bezierCurveTo(
      -span * 0.18,
      span * 0.25,
      span * 0.18,
      span * 0.25,
      span * 0.22,
      -span * 0.08,
    );
    ctx.stroke();
    if (kind === 'pendant') ellipse(0, span * 0.2, span * 0.025, span * 0.035);
  }
  ctx.restore();
}
