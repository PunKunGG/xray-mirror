const straightPoints = [
  [0.57, 0.78],
  [0.44, 0.68], [0.36, 0.60], [0.29, 0.53], [0.23, 0.47],
  [0.45, 0.47], [0.44, 0.36], [0.43, 0.26], [0.42, 0.18],
  [0.56, 0.44], [0.56, 0.30], [0.56, 0.19], [0.56, 0.11],
  [0.66, 0.46], [0.68, 0.33], [0.69, 0.23], [0.70, 0.16],
  [0.75, 0.51], [0.80, 0.42], [0.83, 0.34], [0.85, 0.28],
];

export type ExamplePose = 'straight' | 'bent';

const straight = Float32Array.from(straightPoints.flatMap(([x, y]) => [x, y, 0]));
const bent = straight.slice();
bent.set([0.34, 0.37, 0, 0.27, 0.41, 0], 7 * 3);

export const EXAMPLE_HAND: Readonly<Record<ExamplePose, Float32Array>> = { straight, bent };
