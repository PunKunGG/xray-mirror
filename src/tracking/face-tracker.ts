import { startFrameTracker, type TrackerCallbacks } from './frame-tracker.ts';
import { FACE_MODEL_URL } from './model-url.ts';
import type { FaceTrackingFrame } from './types.ts';

export function startFaceTracker(video: HTMLVideoElement, callbacks: TrackerCallbacks<FaceTrackingFrame>): () => void {
  const worker = new Worker(new URL('./face.worker.ts', import.meta.url), { type: 'module' });
  return startFrameTracker(video, worker, FACE_MODEL_URL, 'Face', callbacks);
}
