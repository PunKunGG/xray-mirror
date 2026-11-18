/** Pixel-space anchor for a label rendered over the camera frame. */
export interface NearLabelAnchor {
  id: string;
  /** Labels with the same subject share one coverage slot (for example `head` or `left-hand`). */
  subject: string;
  x: number;
  y: number;
  width: number;
}

export interface NearLabelPlacement<T extends NearLabelAnchor = NearLabelAnchor> {
  anchor: T;
  /** Top-left of the label box in CSS pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Start of the leader, on the nearest edge of the label box. */
  lineX: number;
  lineY: number;
  /** Reusable relative slot for stable placement between frames. */
  slot: { side: 'left' | 'right'; offsetY: number };
}

const FRAME_MARGIN = 5;

function segmentEntersBox(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  box: { x: number; y: number; width: number; height: number },
): boolean {
  let enter = 0;
  let exit = 1;
  for (const [origin, delta, low, high] of [
    [x1, x2 - x1, box.x + 0.5, box.x + box.width - 0.5],
    [y1, y2 - y1, box.y + 0.5, box.y + box.height - 0.5],
  ]) {
    if (Math.abs(delta) < 1e-6) {
      if (origin <= low || origin >= high) return false;
      continue;
    }
    const first = (low - origin) / delta;
    const last = (high - origin) / delta;
    enter = Math.max(enter, Math.min(first, last));
    exit = Math.min(exit, Math.max(first, last));
    if (enter >= exit) return false;
  }
  return exit > 0 && enter < 1;
}

/**
 * Places a priority-ordered set of labels near their anchors. The first pass
 * reserves one feasible label per subject, then a second pass fills remaining
 * capacity in input priority order.
 */
export function layoutNearLabels<T extends NearLabelAnchor>(
  anchors: readonly T[],
  frame: { left: number; top: number; width: number; height: number },
  options: { limit: number; maxLeader: number; rowHeight: number },
  previous: ReadonlyMap<string, NearLabelPlacement['slot']> = new Map(),
): NearLabelPlacement<T>[] {
  const { limit, maxLeader, rowHeight } = options;
  const right = frame.left + frame.width;
  const bottom = frame.top + frame.height;
  const minX = frame.left + FRAME_MARGIN;
  const maxX = right - FRAME_MARGIN;
  const minY = frame.top + FRAME_MARGIN;
  const maxY = bottom - FRAME_MARGIN;
  if (limit <= 0 || rowHeight <= 0 || maxLeader < 0 || maxX <= minX || maxY - minY < rowHeight) return [];

  const selected: NearLabelPlacement<T>[] = [];
  const placedIds = new Set<string>();

  const canPlace = (candidate: NearLabelPlacement<T>): boolean => {
    if (candidate.x < minX || candidate.x + candidate.width > maxX || candidate.y < minY || candidate.y + rowHeight > maxY) return false;
    const dx = candidate.anchor.x - candidate.lineX;
    const dy = candidate.anchor.y - candidate.lineY;
    if (Math.hypot(dx, dy) > maxLeader) return false;
    return selected.every((other) => {
      const overlap = candidate.x + candidate.width > other.x && other.x + other.width > candidate.x &&
        candidate.y + rowHeight > other.y && other.y + rowHeight > candidate.y;
      if (overlap) return false;
      const candidateCrossesOther = segmentEntersBox(candidate.anchor.x, candidate.anchor.y, candidate.lineX, candidate.lineY, other);
      const otherCrossesCandidate = segmentEntersBox(other.anchor.x, other.anchor.y, other.lineX, other.lineY, candidate);
      return !candidateCrossesOther && !otherCrossesCandidate;
    });
  };

  function* candidates(anchor: T): Generator<NearLabelPlacement<T>> {
    if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y) || !Number.isFinite(anchor.width) || anchor.width <= 0) return;
    const old = previous.get(anchor.id);
    const gap = maxLeader <= 64 ? 10 : 14;
    const preferred = old?.side ?? (anchor.x < frame.left + frame.width / 2 ? 'left' : 'right');
    const sides = [preferred, preferred === 'left' ? 'right' : 'left'] as const;
    const offsets: number[] = [];
    if (old && Number.isFinite(old.offsetY)) offsets.push(old.offsetY);
    offsets.push(0);
    const maxOffset = Math.min(maxLeader + rowHeight / 2, Math.max(0, maxY - minY - rowHeight));
    const step = rowHeight + 3;
    for (let distance = step; distance <= maxOffset; distance += step) offsets.push(-distance, distance);
    // Also try the two available vertical boundaries when rows are sparse.
    offsets.push(minY + rowHeight / 2 - anchor.y, maxY - rowHeight / 2 - anchor.y);
    const uniqueOffsets = [...new Set(offsets.map((value) => Math.round(value * 100) / 100))];
    for (const side of sides) {
      const x = side === 'right' ? anchor.x + gap : anchor.x - anchor.width - gap;
      for (const offsetY of uniqueOffsets) {
        const y = anchor.y + offsetY - rowHeight / 2;
        const lineY = Math.max(y, Math.min(anchor.y, y + rowHeight));
        const lineX = side === 'right' ? x : x + anchor.width;
        yield { anchor, x, y, width: anchor.width, height: rowHeight, lineX, lineY, slot: { side, offsetY } };
      }
    }
  }

  const place = (anchor: T): boolean => {
    if (placedIds.has(anchor.id) || selected.length >= limit) return false;
    for (const placement of candidates(anchor)) {
      if (!canPlace(placement)) continue;
      selected.push(placement);
      placedIds.add(anchor.id);
      return true;
    }
    return false;
  };

  const anchorsBySubject = new Map<string, T[]>();
  for (const anchor of anchors) {
    const group = anchorsBySubject.get(anchor.subject) ?? [];
    group.push(anchor);
    anchorsBySubject.set(anchor.subject, group);
  }
  for (const subjectAnchors of anchorsBySubject.values()) {
    if (selected.length >= limit) break;
    // A subject is covered only after one of its candidates actually fits.
    for (const anchor of subjectAnchors) {
      if (place(anchor)) break;
    }
  }
  for (const anchor of anchors) {
    if (selected.length >= limit) break;
    place(anchor);
  }
  return selected;
}
