import { Group, PerspectiveCamera } from 'three';
import type { HeadFit } from './fit.ts';

// The MediaPipe Face Geometry graph uses a virtual camera looking down -Z.
// Its metric canonical model and pose translation are in centimeters.
export function createHeadCamera(): PerspectiveCamera {
  return new PerspectiveCamera(63, 1, 1, 10_000);
}

export function applyHeadPose(pose: Group, matrix: Float32Array): void {
  pose.matrix.fromArray(matrix);
  pose.matrixWorldNeedsUpdate = true;
}

export function applyHeadFit(adjustment: Group, fit: HeadFit): void {
  // The shared preview reflects X. A positive slider value moves right in that view.
  adjustment.position.set(-fit.x, fit.y, fit.z);
  adjustment.scale.set(fit.size * fit.width, fit.size * fit.height, fit.size * fit.depth);
}
