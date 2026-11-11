import { OneEuroFilter } from './one-euro.ts';
import { FACE_LANDMARK_COUNT, type TrackedFace } from './types.ts';

export class FaceFilter {
  private readonly landmarks = new OneEuroFilter(FACE_LANDMARK_COUNT * 3, 1.5, 8);
  private readonly position = new OneEuroFilter(3, 1.5, 0.08);
  private readonly scale = new OneEuroFilter(1, 1.5, 2);
  private readonly rotation = new OneEuroFilter(4, 1.5, 8);
  private previousRotation: number[] | undefined;

  reset(): void {
    this.landmarks.reset();
    this.position.reset();
    this.scale.reset();
    this.rotation.reset();
    this.previousRotation = undefined;
  }

  apply(landmarks: Float32Array, matrix: number[], timestampMs: number): TrackedFace | null {
    const [x0, x1, x2, , y0, y1, y2, , z0, z1, z2, , tx, ty, tz] = matrix;
    const scale = (Math.hypot(x0, x1, x2) + Math.hypot(y0, y1, y2) + Math.hypot(z0, z1, z2)) / 3;
    if (!matrix.every(Number.isFinite) || !Number.isFinite(scale) || scale <= 0) {
      this.reset();
      return null;
    }

    const rotation = rotationFromMatrix(matrix, scale);
    const previous = this.previousRotation;
    // q and -q encode the same orientation. Stay in one hemisphere before filtering.
    if (previous && rotation.reduce((dot, value, index) => dot + value * previous[index], 0) < 0) {
      for (let index = 0; index < rotation.length; index++) rotation[index] *= -1;
    }
    this.previousRotation = rotation;

    const filteredRotation = this.rotation.apply(rotation, timestampMs);
    const norm = Math.hypot(...filteredRotation);
    const [x, y, z, w] = filteredRotation.map((value) => value / norm);
    const [positionX, positionY, positionZ] = this.position.apply([tx, ty, tz], timestampMs);
    const [s] = this.scale.apply([scale], timestampMs);

    return {
      landmarks: Float32Array.from(this.landmarks.apply(landmarks, timestampMs)),
      poseMatrix: new Float32Array([
        s * (1 - 2 * (y * y + z * z)), s * 2 * (x * y + w * z), s * 2 * (x * z - w * y), 0,
        s * 2 * (x * y - w * z), s * (1 - 2 * (x * x + z * z)), s * 2 * (y * z + w * x), 0,
        s * 2 * (x * z + w * y), s * 2 * (y * z - w * x), s * (1 - 2 * (x * x + y * y)), 0,
        positionX, positionY, positionZ, 1,
      ]),
    };
  }
}

function rotationFromMatrix(matrix: number[], scale: number): number[] {
  const [m00, m10, m20, , m01, m11, m21, , m02, m12, m22] = matrix.map((value) => value / scale);
  const trace = m00 + m11 + m22;

  // Extract the quaternion from its largest component for stability near 180 degrees.
  if (trace > 0) {
    const s = 2 * Math.sqrt(1 + trace);
    return [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4];
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    return [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  }
  if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    return [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s];
  }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
  return [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s];
}
