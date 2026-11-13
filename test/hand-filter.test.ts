import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HandFilter } from '../src/tracking/hand-filter.ts';
import { HAND_LANDMARK_COUNT, type TrackedHand } from '../src/tracking/types.ts';

function hand(wristX: number, handedness: TrackedHand['handedness'] = null) {
  const landmarks = new Float32Array(HAND_LANDMARK_COUNT * 3);
  for (let index = 0; index < HAND_LANDMARK_COUNT; index++) {
    landmarks.set([wristX + index / 1_000, 0.5, index / -1_000 || 0], index * 3);
  }
  return { landmarks, handedness };
}

test('keeps hand IDs through reversed detection order and crossing without handedness', () => {
  const filter = new HandFilter();
  const [left, right] = filter.apply([hand(0.25), hand(0.75)], 1);
  const before = filter.apply([hand(0.62), hand(0.38)], 34);
  assert.deepEqual(before.map(({ id }) => id), [left.id, right.id]);
  assert.ok(before[0].landmarks[0] < before[1].landmarks[0]);

  filter.apply([hand(0.49), hand(0.51)], 67);
  const after = filter.apply([hand(0.38), hand(0.62)], 100);
  assert.deepEqual(after.map(({ id }) => id), [left.id, right.id]);
  assert.ok(after[0].landmarks[0] > after[1].landmarks[0]);
});

test('uses handedness when wrists and palms overlap', () => {
  const filter = new HandFilter();
  const [left, right] = filter.apply([hand(0.5, 'Left'), hand(0.5, 'Right')], 1);
  const after = filter.apply([hand(0.5, 'Right'), hand(0.5, 'Left')], 34);
  assert.deepEqual(after.map(({ id, handedness }) => [id, handedness]), [[left.id, 'Left'], [right.id, 'Right']]);
});

test('filters each hand independently and reacquires a dropped hand without old filter state', () => {
  const filter = new HandFilter();
  const [left, right] = filter.apply([hand(0.3, 'Left'), hand(0.7, 'Right')], 1);
  const next = hand(0.32, 'Left');
  const [updatedLeft, updatedRight] = filter.apply([hand(0.7, 'Right'), next], 34);
  assert.equal(updatedLeft.id, left.id);
  assert.ok(updatedLeft.landmarks[0] > left.landmarks[0] && updatedLeft.landmarks[0] < next.landmarks[0]);
  assert.equal(updatedRight.id, right.id);
  assert.deepEqual(updatedRight.landmarks, right.landmarks);

  assert.deepEqual(filter.apply([hand(0.7, 'Right')], 67).map(({ id }) => id), [right.id]);
  const reacquired = hand(0.37, 'Left');
  const [sameRight, newLeft] = filter.apply([reacquired, hand(0.7, 'Right')], 100);
  assert.equal(sameRight.id, right.id);
  assert.notEqual(newLeft.id, left.id);
  assert.deepEqual(newLeft.landmarks, reacquired.landmarks);
  assert.deepEqual(filter.apply([], 133), []);
});
