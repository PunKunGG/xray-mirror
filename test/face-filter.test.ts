import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FaceFilter } from '../src/tracking/face-filter.ts';
import { OneEuroFilter } from '../src/tracking/one-euro.ts';
import { FACE_LANDMARK_COUNT } from '../src/tracking/types.ts';

function pose(angle: number, scale = 1, x = 0): number[] {
  const cosine = Math.cos(angle) * scale;
  const sine = Math.sin(angle) * scale;
  return [cosine, sine, 0, 0, -sine, cosine, 0, 0, 0, 0, scale, 0, x, 3, -60, 1];
}

test('One Euro reduces small motion, responds faster to large motion, and resets', () => {
  const slow = new OneEuroFilter(1, 1.5, 8);
  const fast = new OneEuroFilter(1, 1.5, 8);
  slow.apply([0], 10);
  fast.apply([0], 10);
  const [smallChange] = slow.apply([0.01], 43);
  const [largeChange] = fast.apply([0.5], 43);
  assert.ok(smallChange > 0 && smallChange < 0.01);
  assert.ok(largeChange / 0.5 > smallChange / 0.01);
  assert.equal(slow.apply([10], 43)[0], smallChange);
  slow.reset();
  assert.equal(slow.apply([0.75], 70)[0], 0.75);
});

test('pose filtering keeps column-major translation and a rigid rotation at the half turn', () => {
  const filter = new FaceFilter();
  const points = new Float32Array(FACE_LANDMARK_COUNT * 3).fill(0.4);
  const initialPose = pose(Math.PI - 0.02, 1.2, 5);
  const first = filter.apply(points, initialPose, 10);
  assert.ok(first);
  assert.deepEqual(first.poseMatrix, Float32Array.from(initialPose));

  const second = filter.apply(points, pose(-Math.PI + 0.02, 1.2, 7), 43);
  assert.ok(second);
  const [x0, x1, , , y0, y1, , , , , z2, , tx, ty, tz] = second.poseMatrix;
  assert.ok(x0 < -1.19 && y1 < -1.19);
  assert.ok(Math.abs(Math.hypot(x0, x1) - z2) < 1e-6);
  assert.ok(Math.abs(x0 * y0 + x1 * y1) < 1e-6);
  assert.ok(tx > 5 && tx < 7);
  assert.equal(ty, 3);
  assert.equal(tz, -60);

  filter.reset();
  const nextPose = pose(0, 1, -4);
  assert.ok(filter.apply(points, nextPose, 100)?.poseMatrix.every((value, index) => value === nextPose[index]));
});
