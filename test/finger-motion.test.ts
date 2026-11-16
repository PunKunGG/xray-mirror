import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EXAMPLE_HAND, type ExamplePose } from '../src/lab/example-hand.ts';
import { createFingerMotion, indexJointAngle } from '../src/lab/finger-motion.ts';
import type { TrackedHand } from '../src/tracking/types.ts';

function hand(id: number, pose: ExamplePose, mirror = false): TrackedHand {
  const landmarks = EXAMPLE_HAND[pose].map((coordinate, index) => mirror && index % 3 === 0 ? 1 - coordinate : coordinate);
  return { id, landmarks, handedness: mirror ? 'Left' : 'Right' };
}

const frame = (timestampMs: number, ...hands: TrackedHand[]) => ({ timestampMs, inferenceMs: 0, hands });
const ASPECT = 16 / 9;

test('index joint classification uses the video aspect and works on either hand', () => {
  for (const mirror of [false, true]) {
    assert.ok((indexJointAngle(hand(1, 'straight', mirror).landmarks, ASPECT) ?? 0) >= 155);
    assert.ok((indexJointAngle(hand(1, 'bent', mirror).landmarks, ASPECT) ?? 180) <= 115);
  }
  const points = hand(1, 'straight').landmarks;
  points.set(points.slice(15, 18), 18);
  assert.equal(indexJointAngle(points, ASPECT), null);
});

test('short poses and interrupted holds do not unlock the next activity', () => {
  const tracker = createFingerMotion();
  const straight = hand(1, 'straight');
  const bent = hand(1, 'bent');
  tracker.observe(frame(0, straight), ASPECT);
  assert.equal(tracker.observe(frame(299, straight), ASPECT).straightened, false);
  assert.equal(tracker.observe(frame(300, straight), ASPECT).straightened, true);
  tracker.beginBend();
  tracker.observe(frame(330, bent), ASPECT);
  assert.equal(tracker.observe(frame(620, bent), ASPECT).bent, false);
  tracker.observe(frame(630, straight), ASPECT);
  tracker.observe(frame(640, bent), ASPECT);
  assert.equal(tracker.observe(frame(639, straight), ASPECT).bent, false);
  assert.equal(tracker.observe(frame(939, bent), ASPECT).bent, false);
  assert.equal(tracker.observe(frame(940, bent), ASPECT).bent, true);
});

test('the first hand stays selected through reordering and a replacement needs a new baseline', () => {
  const tracker = createFingerMotion();
  const right = hand(1, 'straight');
  const left = hand(2, 'bent', true);
  assert.equal(tracker.observe(frame(0, right, left), ASPECT).hand?.id, 1);
  assert.equal(tracker.observe(frame(300, left, right), ASPECT).straightened, true);
  tracker.beginBend();
  assert.equal(tracker.observe(frame(350, left), ASPECT).hand?.id, 2);
  assert.equal(tracker.observe(frame(650, left), ASPECT).bent, false);
  const leftStraight = hand(2, 'straight', true);
  tracker.observe(frame(700, leftStraight), ASPECT);
  assert.equal(tracker.observe(frame(1000, leftStraight), ASPECT).straightened, true);
  tracker.observe(frame(1050, left), ASPECT);
  assert.equal(tracker.observe(frame(1350, left), ASPECT).bent, true);
});

test('an empty or stale frame clears unfinished progress even for the same hand ID', () => {
  const tracker = createFingerMotion();
  const straight = hand(1, 'straight');
  const bent = hand(1, 'bent');
  tracker.observe(frame(0, straight), ASPECT);
  tracker.observe(frame(300, straight), ASPECT);
  tracker.beginBend();
  tracker.observe(frame(350, bent), ASPECT);
  assert.equal(tracker.observe(frame(500), ASPECT).hand, null);
  assert.equal(tracker.observe(frame(450, bent), ASPECT).hand, null);
  tracker.observe(frame(510, bent), ASPECT);
  assert.equal(tracker.observe(frame(810, bent), ASPECT).bent, false);
  tracker.observe(frame(850, straight), ASPECT);
  assert.equal(tracker.observe(frame(1360, straight), ASPECT).straightened, false);
  assert.equal(tracker.observe(frame(1660, straight), ASPECT).straightened, true);
});
