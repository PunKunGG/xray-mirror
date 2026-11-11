import type { FaceTrackingFrame, TrackingDelegate } from './types.ts';

export type TrackerRequest =
  | { type: 'initialize'; wasmUrl: string; model: ArrayBuffer }
  | { type: 'frame'; bitmap: ImageBitmap; timestampMs: number }
  | { type: 'dispose' };

export type TrackerReply =
  | { type: 'ready'; delegate: TrackingDelegate }
  | { type: 'frame'; result: FaceTrackingFrame }
  | { type: 'error'; message: string }
  | { type: 'disposed' };
