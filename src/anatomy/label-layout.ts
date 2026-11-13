// Anchor coordinates are normalized in the unmirrored camera image.
export interface LabelAnchor {
  text: string;
  x: number;
  y: number;
  estimated?: boolean;
}

// Screen anchors use CSS pixels in the mirrored preview.
export interface ScreenLabel extends LabelAnchor {
  side: 'left' | 'right';
  rowY: number;
}

export const LABEL_HEIGHT = 20;
export const LABEL_MARGIN = 8;
export const COMPACT_LABEL_HEIGHT = 15;

export function layoutLabels(
  anchors: readonly LabelAnchor[],
  centerX: number,
  height: number,
  compact = false,
): ScreenLabel[] {
  const rowStep = compact ? COMPACT_LABEL_HEIGHT + 2 : LABEL_HEIGHT + 4;
  const top = compact ? 4 + COMPACT_LABEL_HEIGHT / 2 : LABEL_MARGIN + LABEL_HEIGHT / 2;
  const bottom = height - top;
  const capacity = Math.floor((bottom - top) / rowStep) + 1;
  if (capacity < 1) return [];

  // Keep higher-priority labels when a short preview cannot fit every row.
  const byX = anchors.slice(0, 2 * capacity).sort((a, b) => a.x - b.x);
  const firstRight = byX.findIndex((anchor) => anchor.x >= centerX);
  const preferredSplit = firstRight === -1 ? byX.length : firstRight;
  const minPerSide = byX.length > 1 ? 1 : 0;
  const split = Math.min(
    Math.min(capacity, byX.length - minPerSide),
    Math.max(minPerSide, byX.length - capacity, preferredSplit),
  );

  function place(column: LabelAnchor[], side: ScreenLabel['side']): ScreenLabel[] {
    column.sort((a, b) => a.y - b.y);
    let nextY = top;
    return column.map((anchor, index) => {
      const limit = bottom - (column.length - index - 1) * rowStep;
      const rowY = Math.max(nextY, Math.min(anchor.y, limit));
      nextY = rowY + rowStep;
      return { ...anchor, side, rowY };
    });
  }

  return [...place(byX.slice(0, split), 'left'), ...place(byX.slice(split), 'right')];
}
