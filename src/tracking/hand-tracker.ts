import { startFrameTracker, type TrackerCallbacks } from './frame-tracker.ts';
import { HAND_MODEL_URL } from './model-url.ts';
import type { HandTrackingFrame } from './types.ts';

export function startHandTracker(video: HTMLVideoElement, callbacks: TrackerCallbacks<HandTrackingFrame>): () => void {
  let worker: Worker;
  try {
    worker = new Worker(new URL('./hand.worker.ts', import.meta.url), { type: 'module' });
  } catch (error) {
    let disposed = false;
    queueMicrotask(() => {
      if (!disposed) callbacks.onError(error);
    });
    return () => { disposed = true; };
  }
  return startFrameTracker(video, worker, HAND_MODEL_URL, 'Hand', callbacks);
}
