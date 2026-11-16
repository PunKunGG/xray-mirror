import type { HandTrackingFrame, TrackedHand } from '../tracking/types.ts';

export const INDEX_MIDDLE_JOINT = 6;
export const HAND_FRAME_MAX_AGE_MS = 500;
const HOLD_MS = 300;

type FingerPose = 'straight' | 'bent';

export interface FingerMotion {
  hand: TrackedHand | null;
  straightened: boolean;
  bent: boolean;
}

// MediaPipe normalizes y by video height, while x and relative z use the width scale.
export function indexJointAngle(points: Float32Array, aspect: number): number | null {
  if (!Number.isFinite(aspect) || aspect <= 0) return null;
  const base = 5 * 3;
  const middle = INDEX_MIDDLE_JOINT * 3;
  const outer = 7 * 3;
  for (const offset of [base, middle, outer]) {
    const x = points[offset];
    const y = points[offset + 1];
    if (!Number.isFinite(x) || x < 0 || x > 1 || !Number.isFinite(y) || y < 0 || y > 1) return null;
  }

  const ax = points[base] - points[middle];
  const ay = (points[base + 1] - points[middle + 1]) / aspect;
  const az = points[base + 2] - points[middle + 2];
  const bx = points[outer] - points[middle];
  const by = (points[outer + 1] - points[middle + 1]) / aspect;
  const bz = points[outer + 2] - points[middle + 2];
  const lengths = Math.hypot(ax, ay, az) * Math.hypot(bx, by, bz);
  if (!Number.isFinite(lengths) || lengths < 1e-6) return null;
  const cosine = Math.max(-1, Math.min(1, (ax * bx + ay * by + az * bz) / lengths));
  return Math.acos(cosine) * (180 / Math.PI);
}

export function createFingerMotion() {
  let motion: FingerMotion = { hand: null, straightened: false, bent: false };
  let lastTimestamp = -Infinity;
  let candidate: FingerPose | null = null;
  let since = 0;

  function reset(): FingerMotion {
    motion = { hand: null, straightened: false, bent: false };
    lastTimestamp = -Infinity;
    candidate = null;
    return motion;
  }

  return {
    reset,
    beginBend() {
      motion = { ...motion, bent: false };
      candidate = null;
      return motion;
    },
    observe(frame: HandTrackingFrame, aspect: number): FingerMotion {
      if (!Number.isFinite(frame.timestampMs) || frame.timestampMs <= lastTimestamp) return motion;
      if (frame.timestampMs - lastTimestamp > HAND_FRAME_MAX_AGE_MS) reset();

      const visible = frame.hands.map((hand) => ({ hand, angle: indexJointAngle(hand.landmarks, aspect) }));
      const previous = visible.find(({ hand, angle }) => angle !== null && hand.id === motion.hand?.id);
      const selected = previous ?? visible.find(({ angle }) => angle !== null);
      if (!selected || selected.angle === null) {
        reset();
        lastTimestamp = frame.timestampMs;
        return motion;
      }
      if (!previous) reset();

      lastTimestamp = frame.timestampMs;
      const angle = selected.angle;
      const pose = angle >= 155 ? 'straight' : angle <= 115 ? 'bent' : null;
      if (pose !== candidate) {
        candidate = pose;
        since = lastTimestamp;
      }
      const held = lastTimestamp - since >= HOLD_MS;
      const straightened = motion.straightened || (candidate === 'straight' && held);
      motion = {
        hand: selected.hand,
        straightened,
        bent: motion.bent || (straightened && candidate === 'bent' && held),
      };
      return motion;
    },
  };
}
