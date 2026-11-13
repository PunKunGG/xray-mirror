import { OneEuroFilter } from './one-euro.ts';
import { HAND_LANDMARK_COUNT, type TrackedHand } from './types.ts';

type Detection = Pick<TrackedHand, 'handedness' | 'landmarks'>;
type Anchors = [wristX: number, wristY: number, palmX: number, palmY: number];

interface Track {
  id: number;
  filter: OneEuroFilter;
  handedness: TrackedHand['handedness'];
  anchors: Anchors;
  previousAnchors: Anchors;
  timestampMs: number;
  previousTimestampMs: number;
}

const COORDINATE_COUNT = HAND_LANDMARK_COUNT * 3;
const MAX_FRAME_GAP_MS = 150;
const MAX_JUMP = 0.24;
const HANDEDNESS_PENALTY = 0.025;
const PALM_JOINTS = [0, 5, 9, 13, 17];

export class HandFilter {
  private tracks: Track[] = [];
  private nextId = 1;

  reset(): void {
    this.tracks = [];
  }

  apply(detections: Detection[], timestampMs: number): TrackedHand[] {
    const anchors = detections.map(({ landmarks }) => getAnchors(landmarks));
    const matches = matchHands(this.tracks, detections, anchors, timestampMs);
    this.tracks = matches.map((track, index) => ({
      id: track?.id ?? this.nextId++,
      filter: track?.filter ?? new OneEuroFilter(COORDINATE_COUNT, 1.5, 8),
      handedness: detections[index].handedness ?? track?.handedness ?? null,
      anchors: anchors[index],
      previousAnchors: track?.anchors ?? anchors[index],
      timestampMs,
      previousTimestampMs: track?.timestampMs ?? timestampMs,
    }));

    return this.tracks.map(({ id, filter }, index) => ({
      id,
      landmarks: Float32Array.from(filter.apply(detections[index].landmarks, timestampMs)),
      handedness: detections[index].handedness,
    })).sort((first, second) => first.id - second.id);
  }
}

function getAnchors(landmarks: Float32Array): Anchors {
  let palmX = 0;
  let palmY = 0;
  for (const index of PALM_JOINTS) {
    palmX += landmarks[index * 3];
    palmY += landmarks[index * 3 + 1];
  }
  return [landmarks[0], landmarks[1], palmX / PALM_JOINTS.length, palmY / PALM_JOINTS.length];
}

function anchorDistance(from: Anchors, to: Anchors): number {
  return Math.hypot(from[0] - to[0], from[1] - to[1], from[2] - to[2], from[3] - to[3]) / Math.SQRT2;
}

function matchCost(track: Track, detection: Detection, anchors: Anchors, timestampMs: number): number {
  const elapsed = timestampMs - track.timestampMs;
  if (elapsed > MAX_FRAME_GAP_MS || anchorDistance(track.anchors, anchors) > MAX_JUMP) return Infinity;

  // Predict at most one frame ahead to distinguish hands moving past each other.
  const previousElapsed = track.timestampMs - track.previousTimestampMs;
  const step = previousElapsed > 0 ? Math.min(1, elapsed / previousElapsed) : 0;
  const predicted = track.anchors.map((value, index) => (
    value + step * (value - track.previousAnchors[index])
  )) as Anchors;
  const mismatch = track.handedness && detection.handedness && track.handedness !== detection.handedness;
  return anchorDistance(predicted, anchors) + (mismatch ? HANDEDNESS_PENALTY : 0);
}

function matchHands(tracks: Track[], detections: Detection[], anchors: Anchors[], timestampMs: number): (Track | undefined)[] {
  if (detections.length === 0) return [];

  // MediaPipe emits up to two hands. Compare each one-to-one assignment, allowing unmatched detections.
  const choices = [...tracks, undefined];
  const cost = (track: Track | undefined, index: number) => (
    track ? matchCost(track, detections[index], anchors[index], timestampMs) : MAX_JUMP
  );
  let bestCost = Infinity;
  let matches: (Track | undefined)[] = [];
  for (const first of choices) {
    for (const second of detections.length === 2 ? choices : [undefined]) {
      if (first && first === second) continue;
      const total = cost(first, 0) + (detections.length === 2 ? cost(second, 1) : 0);
      if (total >= bestCost) continue;
      bestCost = total;
      matches = detections.length === 2 ? [first, second] : [first];
    }
  }
  return matches;
}
