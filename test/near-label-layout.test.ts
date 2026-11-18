import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layoutNearLabels, type NearLabelAnchor } from '../src/anatomy/near-label-layout.ts';

const frame = { left: 0, top: 0, width: 640, height: 400 };
const options = { limit: 6, maxLeader: 96, rowHeight: 22 };

test('respects the requested label limit and reserves coverage across head and both hands', () => {
  const anchors: NearLabelAnchor[] = [
    { id: 'head-a', subject: 'head', x: 320, y: 120, width: 80 },
    { id: 'head-b', subject: 'head', x: 322, y: 121, width: 80 },
    { id: 'left-a', subject: 'left-hand', x: 180, y: 250, width: 80 },
    { id: 'right-a', subject: 'right-hand', x: 460, y: 250, width: 80 },
    { id: 'left-b', subject: 'left-hand', x: 185, y: 275, width: 80 },
  ];
  const labels = layoutNearLabels(anchors, frame, { ...options, limit: 4 });

  assert.equal(labels.length, 4);
  assert.deepEqual(new Set(labels.map(({ anchor }) => anchor.subject)), new Set(['head', 'left-hand', 'right-hand']));
  assert.equal(labels[0].anchor.id, 'head-a');
});

test('skips infeasible candidates while still reserving one label for each subject', () => {
  const anchors: NearLabelAnchor[] = [
    { id: 'head-offscreen', subject: 'head', x: 0, y: 20, width: 700 },
    { id: 'head-feasible', subject: 'head', x: 220, y: 120, width: 80 },
    { id: 'left', subject: 'left-hand', x: 180, y: 260, width: 80 },
    { id: 'right', subject: 'right-hand', x: 460, y: 260, width: 80 },
  ];
  const labels = layoutNearLabels(anchors, frame, { ...options, limit: 3 });

  assert.deepEqual(new Set(labels.map(({ anchor }) => anchor.subject)), new Set(['head', 'left-hand', 'right-hand']));
  assert.ok(!labels.some(({ anchor }) => anchor.id === 'head-offscreen'));
  assert.ok(labels.some(({ anchor }) => anchor.id === 'head-feasible'));
});

test('reserves a hand subject using its next viable anchor before filling extra head labels', () => {
  const anchors: NearLabelAnchor[] = [
    { id: 'head-primary', subject: 'head', x: 320, y: 100, width: 76 },
    { id: 'left-impossible', subject: 'left-hand', x: 0, y: 30, width: 700 },
    { id: 'head-extra', subject: 'head', x: 320, y: 145, width: 76 },
    { id: 'left-viable', subject: 'left-hand', x: 180, y: 280, width: 76 },
  ];
  const labels = layoutNearLabels(anchors, frame, { limit: 2, maxLeader: 96, rowHeight: 20 });

  assert.deepEqual(labels.map(({ anchor }) => anchor.id), ['head-primary', 'left-viable']);
});

test('keeps every box inside the frame, avoids overlap, and bounds leaders', () => {
  const anchors = Array.from({ length: 14 }, (_, index) => ({
    id: `label-${index}`,
    subject: index < 5 ? 'head' : index < 10 ? 'left-hand' : 'right-hand',
    x: 250 + (index % 3) * 6,
    y: 100 + (index % 5) * 4,
    width: 86,
  }));
  const labels = layoutNearLabels(anchors, frame, { limit: 8, maxLeader: 64, rowHeight: 20 });

  assert.ok(labels.length <= 8);
  for (const [index, label] of labels.entries()) {
    assert.ok(label.x >= 5 && label.x + label.width <= frame.width - 5);
    assert.ok(label.y >= 5 && label.y + label.height <= frame.height - 5);
    assert.ok(Math.hypot(label.anchor.x - label.lineX, label.anchor.y - label.lineY) <= 64);
    for (const other of labels.slice(index + 1)) {
      const separated = label.x + label.width <= other.x || other.x + other.width <= label.x ||
        label.y + label.height <= other.y || other.y + other.height <= label.y;
      assert.ok(separated, `${label.anchor.id} overlaps ${other.anchor.id}`);
    }
  }
});

test('retains a previous side and vertical slot when it remains feasible', () => {
  const anchor: NearLabelAnchor = { id: 'stable', subject: 'head', x: 320, y: 180, width: 90 };
  const previous = new Map([['stable', { side: 'right' as const, offsetY: 24 }]]);
  const first = layoutNearLabels([anchor], frame, options, previous);
  const next = layoutNearLabels([anchor], frame, options, new Map([[anchor.id, first[0].slot]]));

  assert.deepEqual(next[0].slot, first[0].slot);
  assert.equal(next[0].x, first[0].x);
  assert.equal(next[0].y, first[0].y);
});

test('returns no placements when the frame cannot fit a label', () => {
  assert.deepEqual(layoutNearLabels(
    [{ id: 'small', subject: 'head', x: 10, y: 10, width: 80 }],
    { left: 0, top: 0, width: 40, height: 20 },
    { limit: 2, maxLeader: 64, rowHeight: 18 },
  ), []);
});
