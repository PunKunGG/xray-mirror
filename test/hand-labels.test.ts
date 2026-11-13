import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handLabelAnchors } from '../src/anatomy/hand-bones.ts';
import { COMPACT_LABEL_HEIGHT, layoutLabels } from '../src/anatomy/label-layout.ts';
import type { TrackedHand } from '../src/tracking/types.ts';

function hand(id: number, flipped = false): TrackedHand {
  const landmarks = new Float32Array(21 * 3);
  const joints = [
    [0, 0.50, 0.70], [5, 0.60, 0.40], [9, 0.50, 0.38],
    [11, 0.50, 0.24], [17, 0.38, 0.45], [18, 0.36, 0.39],
    [19, 0.34, 0.34], [20, 0.32, 0.30],
  ];
  for (const [index, x, y] of joints) landmarks.set([flipped ? 1 - x : x, y, 0], index * 3);
  return { id, landmarks, handedness: null };
}

test('hand labels follow finger segments and mirror the radial and ulnar sides', () => {
  const labels = handLabelAnchors([hand(1)]);
  const reflected = handLabelAnchors([hand(2, true)]);
  assert.equal(labels.length, 17);
  assert.equal(new Set(labels.map(({ text }) => text)).size, 17);
  const distal = labels.find(({ text }) => text === 'Distal phalanx')!;
  assert.ok(Math.abs(distal.x - 0.33) < 1e-6);
  assert.ok(Math.abs(distal.y - 0.32) < 1e-6);
  const radius = labels.find(({ text }) => text === 'Radius')!;
  const ulna = labels.find(({ text }) => text === 'Ulna')!;
  assert.ok(radius.x > 0.5 && ulna.x < 0.5 && radius.y > 0.7);
  assert.equal(labels.filter(({ estimated }) => estimated).length, 11);
  for (const [index, anchor] of labels.entries()) {
    assert.ok(Math.abs(anchor.x + reflected[index].x - 1) < 1e-6, anchor.text);
    assert.equal(anchor.y, reflected[index].y);
  }
});

test('compact layout fits all labels for one hand and keeps both hands represented when crowded', () => {
  const toScreen = (labels: ReturnType<typeof handLabelAnchors>) =>
    labels.map((label) => ({ ...label, x: label.x * 320, y: label.y * 210 }));
  assert.equal(layoutLabels(toScreen(handLabelAnchors([hand(1)])), 160, 210, true).length, 17);

  const rows = layoutLabels(toScreen(handLabelAnchors([hand(1), hand(2, true)])), 160, 210, true);
  assert.equal(rows.length, 24);
  for (const name of ['Phalanges', 'Metacarpus', 'Carpus', 'Distal phalanx', 'Metacarpal']) {
    assert.equal(rows.filter(({ text }) => text === name).length, 2);
  }
  for (const side of ['left', 'right']) {
    const column = rows.filter((label) => label.side === side);
    assert.ok(column.every((row, index) => index === 0 || row.rowY - column[index - 1].rowY > COMPACT_LABEL_HEIGHT));
  }
});

test('edge-on wrist hides estimates while a second, open hand keeps all of its labels', () => {
  const edge = hand(1);
  edge.landmarks.set(edge.landmarks.slice(15, 18), 51);
  for (const hands of [[edge, hand(2)], [hand(2), edge]]) {
    const labels = handLabelAnchors(hands);
    assert.equal(labels.length, 23);
    assert.equal(labels.filter(({ estimated }) => estimated).length, 11);
    assert.equal(labels.filter(({ text }) => text === 'Phalanges').length, 2);
  }
});
