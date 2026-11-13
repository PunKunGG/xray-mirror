import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LABEL_HEIGHT, LABEL_MARGIN, layoutLabels } from '../src/anatomy/label-layout.ts';

test('keeps labels on their side of the head and orders them by anchor Y', () => {
  const labels = layoutLabels([
    { text: 'Mandible', x: 170, y: 125 },
    { text: 'Frontal bone', x: 145, y: 68 },
    { text: 'Brain', x: 174, y: 52 },
    { text: 'Left eye', x: 120, y: 82 },
  ], 160, 200);

  assert.deepEqual(labels.map(({ text, side, rowY }) => [text, side, rowY]), [
    ['Frontal bone', 'left', 68],
    ['Left eye', 'left', 92],
    ['Brain', 'right', 52],
    ['Mandible', 'right', 125],
  ]);
});

test('redistributes a crowded column and keeps all rows within a short preview', () => {
  const anchors = Array.from({ length: 10 }, (_, index) => ({
    text: String(index), x: 10 + index, y: 129 - index,
  }));
  const height = 140;
  const labels = layoutLabels(anchors, 150, height);
  assert.equal(labels.length, 10);
  for (const side of ['left', 'right']) {
    const column = labels.filter((label) => label.side === side);
    assert.equal(column.length, 5);
    for (const [index, row] of column.entries()) {
      assert.ok(row.rowY - LABEL_HEIGHT / 2 >= LABEL_MARGIN);
      assert.ok(row.rowY + LABEL_HEIGHT / 2 <= height - LABEL_MARGIN);
      if (index === 0) continue;
      assert.ok(row.y >= column[index - 1].y);
      assert.ok(row.rowY - column[index - 1].rowY > LABEL_HEIGHT);
    }
  }
});

test('returns no rows when there is no room for a label', () => {
  assert.deepEqual(layoutLabels([{ text: 'Brain', x: 10, y: 10 }], 40, 24), []);
});
