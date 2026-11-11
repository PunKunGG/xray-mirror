export const FACE_LANDMARK_COUNT = 478;

export type TrackingDelegate = 'GPU' | 'CPU';

export interface TrackedFace {
  /** Unmirrored normalized x, y and relative z, in landmark index order. */
  landmarks: Float32Array;
  /** Column-major canonical-to-observed face transform in MediaPipe coordinates. */
  poseMatrix: Float32Array;
}

export interface FaceTrackingFrame {
  /** Main-thread video callback time in milliseconds. */
  timestampMs: number;
  inferenceMs: number;
  face: TrackedFace | null;
}
