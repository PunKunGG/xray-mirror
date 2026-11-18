import type { Lens } from './hand-bones.ts';
import { labelsForFocus, type HandLabelAnchor, type HeadLabelAnchor, type LabelAnchor, type LabelOptions } from './label-options.ts';
import { layoutNearLabels, type NearLabelPlacement } from './near-label-layout.ts';

export function createLabelOverlay(canvas: HTMLCanvasElement, onOverflow: (names: readonly string[]) => void) {
  const context = canvas.getContext('2d');
  const widths = new Map<string, number>();
  let viewportWidth = 0;
  let viewportHeight = 0;
  let imageWidth = 0;
  let imageHeight = 0;
  let painted = false;
  let slots = new Map<string, NearLabelPlacement['slot']>();
  let overflowKey = '';

  function clearDrawing(): void {
    if (!painted) return;
    context?.clearRect(0, 0, viewportWidth, viewportHeight);
    painted = false;
  }

  function updateOverflow(names: readonly string[]): void {
    const key = names.join('\n');
    if (key === overflowKey) return;
    overflowKey = key;
    onOverflow(names);
  }

  function reset(): void {
    clearDrawing();
    slots.clear();
    updateOverflow([]);
  }

  function insideImage({ x, y }: LabelAnchor): boolean {
    return x >= 0 && x <= 1 && y >= 0 && y <= 1;
  }

  function insideLens(anchor: LabelAnchor, lens: Lens): boolean {
    const radius = lens.size * Math.min(imageWidth, imageHeight) / 2;
    return Math.hypot((anchor.x - lens.x) * imageWidth, (anchor.y - lens.y) * imageHeight) < radius;
  }

  return {
    clear: reset,
    resize(width: number, height: number, videoWidth: number, videoHeight: number, dpr: number): void {
      reset();
      widths.clear();
      viewportWidth = width;
      viewportHeight = height;
      imageWidth = videoWidth;
      imageHeight = videoHeight;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      if (width && height) context?.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
    },
    render(head: readonly HeadLabelAnchor[], hands: readonly HandLabelAnchor[], options: LabelOptions, lens: Lens | null): void {
      if (!context || !viewportWidth || !viewportHeight) return;
      clearDrawing();
      const left = (viewportWidth - imageWidth) / 2;
      const top = (viewportHeight - imageHeight) / 2;
      const visibleHead = new Map<string, HeadLabelAnchor>();
      for (const anchor of head) {
        const id = `${anchor.layer}:${anchor.text}`;
        if (visibleHead.has(id) || !insideImage(anchor) || (lens && !insideLens(anchor, lens))) continue;
        visibleHead.set(id, anchor);
      }
      const compact = viewportWidth < 460;
      const padding = compact ? 5 : 7;
      context.font = compact ? '600 11px system-ui, sans-serif' : '600 12px system-ui, sans-serif';
      context.textAlign = 'left';
      context.textBaseline = 'middle';
      const selected = labelsForFocus([...visibleHead.values()], hands.filter(insideImage), options);
      const anchors = selected.map((anchor) => {
        const subject = 'handId' in anchor ? `hand:${anchor.handId}` : 'head';
        const id = 'layer' in anchor ? `${subject}:${anchor.layer}:${anchor.text}` : `${subject}:${anchor.text}`;
        let width = widths.get(anchor.text);
        if (width === undefined) {
          width = Math.ceil(context.measureText(anchor.text).width) + 2 * padding;
          widths.set(anchor.text, width);
        }
        return { ...anchor, subject, id, width, x: left + (1 - anchor.x) * imageWidth, y: top + anchor.y * imageHeight };
      });
      const limit = options.focus === 'overview' ? (compact ? 4 : 6) : (compact ? 5 : 8);
      const rows = layoutNearLabels(anchors, { left, top, width: imageWidth, height: imageHeight }, {
        limit, maxLeader: compact ? 64 : 96, rowHeight: compact ? 18 : 22,
      }, slots);
      slots = new Map(rows.map(({ anchor, slot }) => [anchor.id, slot]));

      const overflow = options.focus === 'overview' ? []
        : [...new Set(anchors.filter(({ id }) => !slots.has(id)).map(({ text }) => text))].sort();
      updateOverflow(overflow);
      if (!rows.length) return;

      for (const { anchor, lineX, lineY } of rows) {
        context.beginPath();
        context.moveTo(lineX, lineY);
        context.lineTo(anchor.x, anchor.y);
        context.setLineDash(anchor.estimated ? [3, 3] : []);
        context.strokeStyle = '#07131d';
        context.lineWidth = 3;
        context.stroke();
        context.strokeStyle = '#8bdbf6';
        context.lineWidth = 1;
        context.stroke();
        context.beginPath();
        context.arc(anchor.x, anchor.y, 2.5, 0, Math.PI * 2);
        context.fillStyle = '#8bdbf6';
        context.fill();
      }
      context.setLineDash([]);

      for (const { anchor, x, y, width, height } of rows) {
        context.beginPath();
        context.roundRect(x, y, width, height, 4);
        context.fillStyle = '#10222e';
        context.fill();
        context.strokeStyle = '#426477';
        context.stroke();
        context.fillStyle = '#eefaff';
        context.fillText(anchor.text, x + padding, y + height / 2);
      }
      painted = true;
    },
  };
}
