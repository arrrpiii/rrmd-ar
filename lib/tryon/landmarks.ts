import {
  FaceLandmarker,
  HandLandmarker,
  PoseLandmarker,
  FilesetResolver,
} from '@mediapipe/tasks-vision';
import type { Point, Settings } from './engine';
export type Landmark = Point & { z?: number; visibility?: number };
export const usesHand = (kind: Settings['kind']) =>
  kind === 'ring' || kind === 'bracelet';
export const usesBody = (kind: Settings['kind']) =>
  kind === 'pendant' || kind === 'necklace';
export async function createLandmarkDetector(
  kind: Settings['kind'],
  runningMode: 'IMAGE' | 'VIDEO',
) {
  const files = await FilesetResolver.forVisionTasks('/vendor/vision');
  const base = (name: string) => ({
    modelAssetPath: `/models/${name}_landmarker.task`,
    delegate: 'CPU' as const,
  });
  if (usesHand(kind)) {
    const d = await HandLandmarker.createFromOptions(files, {
      baseOptions: base('hand'),
      runningMode,
      numHands: 2,
    });
    return {
      detect: (
        input: HTMLVideoElement | HTMLCanvasElement,
        time?: number,
      ): Landmark[][] =>
        (time === undefined ? d.detect(input) : d.detectForVideo(input, time))
          .landmarks,
      close: () => d.close(),
    };
  }
  if (usesBody(kind)) {
    const d = await PoseLandmarker.createFromOptions(files, {
      baseOptions: base('pose'),
      runningMode,
      numPoses: 2,
    });
    return {
      detect: (
        input: HTMLVideoElement | HTMLCanvasElement,
        time?: number,
      ): Landmark[][] =>
        (time === undefined ? d.detect(input) : d.detectForVideo(input, time))
          .landmarks,
      close: () => d.close(),
    };
  }
  const d = await FaceLandmarker.createFromOptions(files, {
    baseOptions: base('face'),
    runningMode,
    numFaces: 2,
  });
  return {
    detect: (
      input: HTMLVideoElement | HTMLCanvasElement,
      time?: number,
    ): Landmark[][] =>
      (time === undefined ? d.detect(input) : d.detectForVideo(input, time))
        .faceLandmarks,
    close: () => d.close(),
  };
}
export async function detectJewelleryLandmarks(
  photo: HTMLCanvasElement,
  kind: Settings['kind'],
) {
  const detector = await createLandmarkDetector(kind, 'IMAGE');
  try {
    return detector.detect(photo);
  } finally {
    detector.close();
  }
}
