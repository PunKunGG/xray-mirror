import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Group, Matrix4, Vector3 } from 'three';
import { DEFAULT_FIT, decodeFit } from '../src/anatomy/fit.ts';
import { applyHeadFit, applyHeadPose, createHeadCamera } from '../src/anatomy/head-transform.ts';

test('saved fit normalizes missing, invalid and out-of-range settings', () => {
  assert.deepEqual(decodeFit('malformed'), DEFAULT_FIT);
  assert.deepEqual(decodeFit('null'), DEFAULT_FIT);
  assert.deepEqual(decodeFit('{"size":4,"width":0.1,"depth":"1.2","x":-12,"y":2.24,"z":1e400}'), {
    ...DEFAULT_FIT, size: 1.5, width: 0.5, x: -8, y: 2.2,
  });
});

test('head fit composes size, per-axis scale and mirror-facing offsets in head space', () => {
  const fit = new Group();
  applyHeadFit(fit, { size: 1.25, width: 1.2, height: 0.8, depth: 0.6, x: 2, y: -1, z: 3 });
  assert.deepEqual(fit.scale.toArray(), [1.5, 1, 0.75]);
  assert.deepEqual(fit.position.toArray(), [-2, -1, 3]);
  applyHeadFit(fit, DEFAULT_FIT);
  assert.deepEqual(fit.scale.toArray(), [1, 1, 1]);
  assert.ok(fit.position.lengthSq() === 0);
});

test('column-major pose projects yaw, roll and distance with the Face Geometry camera', () => {
  const camera = createHeadCamera();
  camera.aspect = 16 / 9;
  camera.updateProjectionMatrix();
  const pose = new Group();
  pose.matrixAutoUpdate = false;
  const canonical = new Vector3(4, 0, 4);

  function project(matrix: Matrix4): Vector3 {
    applyHeadPose(pose, Float32Array.from(matrix.elements));
    pose.updateMatrixWorld();
    return canonical.clone().applyMatrix4(pose.matrixWorld).project(camera);
  }

  const frontal = project(new Matrix4().makeTranslation(0, 0, -60));
  const closer = project(new Matrix4().makeTranslation(0, 0, -35));
  const yaw = project(new Matrix4().makeRotationY(Math.PI / 4).setPosition(0, 0, -60));
  const roll = project(new Matrix4().makeRotationZ(Math.PI / 4).setPosition(0, 0, -60));
  assert.ok(Math.abs(frontal.x - 4 / (56 * Math.tan(31.5 * Math.PI / 180) * (16 / 9))) < 1e-8);
  assert.ok(closer.x > frontal.x);
  assert.ok(yaw.x > frontal.x);
  assert.ok(roll.y > 0 && roll.x < frontal.x);
});
