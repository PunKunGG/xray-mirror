import type { Lens } from './hand-bones.ts';
import { COMPACT_LABEL_HEIGHT, LABEL_HEIGHT, LABEL_MARGIN, layoutLabels, type LabelAnchor } from './label-layout.ts';

export function createLabelOverlay(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d');
  let viewportWidth = 0;
  let viewportHeight = 0;
  let imageWidth = 0;
  let imageHeight = 0;
  let painted = false;

  function clear(): void {
    if (!painted) return;
    context?.clearRect(0, 0, viewportWidth, viewportHeight);
    painted = false;
  }

  function insideImage({ x, y }: LabelAnchor): boolean {
    return x >= 0 && x <= 1 && y >= 0 && y <= 1;
  }

  function insideLens(anchor: LabelAnchor, lens: Lens): boolean {
    const radius = lens.size * Math.min(imageWidth, imageHeight) / 2;
    return Math.hypot((anchor.x - lens.x) * imageWidth, (anchor.y - lens.y) * imageHeight) < radius;
  }

  return {
    clear,
    resize(width: number, height: number, videoWidth: number, videoHeight: number, dpr: number): void {
      viewportWidth = width;
      viewportHeight = height;
      imageWidth = videoWidth;
      imageHeight = videoHeight;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      if (width && height) context?.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
      painted = false;
    },
    render(head: readonly LabelAnchor[], hands: readonly LabelAnchor[], centerX: number, lens: Lens | null): void {
      if (!context || !viewportWidth || !viewportHeight) return;
      clear();
      const offsetX = (viewportWidth - imageWidth) / 2;
      const offsetY = (viewportHeight - imageHeight) / 2;
      const screenX = (x: number) => offsetX + (1 - x) * imageWidth;
      const visibleHead = new Map<string, LabelAnchor>();
      for (const anchor of head) {
        if (visibleHead.has(anchor.text) || !insideImage(anchor) || (lens && !insideLens(anchor, lens))) continue;
        visibleHead.set(anchor.text, anchor);
      }
      const anchors = [...visibleHead.values(), ...hands.filter(insideImage)]
        .map((anchor) => ({ ...anchor, x: screenX(anchor.x), y: offsetY + anchor.y * imageHeight }));
      const compact = hands.length > 0 && (viewportWidth < 460 ||
        Math.ceil(anchors.length / 2) * (LABEL_HEIGHT + 4) + 2 * LABEL_MARGIN - 4 > viewportHeight);
      const labels = layoutLabels(anchors, screenX(centerX), viewportHeight, compact);
      if (!labels.length) return;

      const rowHeight = compact ? COMPACT_LABEL_HEIGHT : LABEL_HEIGHT;
      const padding = compact ? 5 : 7;
      const maxWidth = Math.min(140, Math.floor(viewportWidth * 0.42));
      context.font = compact ? '600 11px system-ui, sans-serif' : '600 12px "Inter", system-ui, sans-serif';
      context.textAlign = 'left';
      context.textBaseline = 'middle';
      const rows = labels.map((label) => {
        const width = Math.min(maxWidth, Math.ceil(context.measureText(label.text).width) + 2 * padding);
        const left = label.side === 'left';
        const boxX = left ? LABEL_MARGIN : viewportWidth - LABEL_MARGIN - width;
        return { ...label, boxX, width, lineStart: left ? boxX + width : boxX };
      });

      context.lineJoin = 'round';
      for (const row of rows) {
        const reach = row.x - row.lineStart;
        const elbow = row.lineStart + Math.sign(reach) * Math.min(12, Math.abs(reach) / 2);
        context.beginPath();
        context.moveTo(row.lineStart, row.rowY);
        context.lineTo(elbow, row.rowY);
        context.lineTo(row.x, row.y);
        context.setLineDash(row.estimated ? [3, 3] : []);
        context.strokeStyle = '#07131d';
        context.lineWidth = 3;
        context.stroke();
        context.strokeStyle = '#8bdbf6';
        context.lineWidth = 1;
        context.stroke();
        context.beginPath();
        context.arc(row.x, row.y, 2.5, 0, Math.PI * 2);
        context.fillStyle = '#8bdbf6';
        context.fill();
      }
      context.setLineDash([]);

      for (const row of rows) {
        context.beginPath();
        context.roundRect(row.boxX, row.rowY - rowHeight / 2, row.width, rowHeight, 4);
        context.fillStyle = '#10222e';
        context.fill();
        context.strokeStyle = '#426477';
        context.stroke();
        context.fillStyle = '#eefaff';
        context.fillText(row.text, row.boxX + padding, row.rowY, row.width - 2 * padding);
      }
      painted = true;
    },
  };
}
