import type { TrackedHand } from '../tracking/types.ts';
import type { LabelAnchor } from './label-layout.ts';
import type { SkullLook } from './xray-material.ts';

// Palm rays followed by finger joints. The thumb starts at its tracked CMC.
const BONE_CHAINS = [
  [1, 2, 3, 4],
  [0, 5, 6, 7, 8],
  [0, 9, 10, 11, 12],
  [0, 13, 14, 15, 16],
  [0, 17, 18, 19, 20],
];

const PALM_POINTS = [0, 5, 9, 13, 17];
const BONES = BONE_CHAINS.flatMap((chain) => chain.slice(1).map((end, index) => ({
  start: chain[index] * 3,
  end: end * 3,
  palmBase: chain[index] === 0 ? end : undefined,
  width: 1 - index * 0.17,
})));

// Fractions of the palm length and knuckle span from the tracked wrist.
// Positive across is the thumb (radial) side for either hand.
const CARPAL_BONES = [
  { text: 'Trapezium', along: 0.31, across: 0.38, length: 0.16, width: 0.20 },
  { text: 'Trapezoid', along: 0.34, across: 0.19, length: 0.14, width: 0.17 },
  { text: 'Capitate', along: 0.31, across: -0.02, length: 0.20, width: 0.23 },
  { text: 'Hamate', along: 0.28, across: -0.27, length: 0.19, width: 0.23 },
  { text: 'Scaphoid', along: 0.13, across: 0.22, length: 0.15, width: 0.32 },
  { text: 'Lunate', along: 0.11, across: -0.04, length: 0.16, width: 0.21 },
  { text: 'Triquetrum', along: 0.12, across: -0.25, length: 0.15, width: 0.18 },
  { text: 'Pisiform', along: 0.16, across: -0.36, length: 0.12, width: 0.14 },
];
const FOREARM_BONES = [
  { text: 'Radius', along: -0.35, across: 0.21, length: 0.76, wristWidth: 0.38, shaftWidth: 0.23 },
  { text: 'Ulna', along: -0.38, across: -0.24, length: 0.73, wristWidth: 0.23, shaftWidth: 0.17 },
];

interface Point {
  x: number;
  y: number;
}

export function createHandBoneAppearance(look: SkullLook, brightness: number) {
  const light = Math.sqrt(brightness);
  const shade = (red: number, green: number, blue: number) =>
    `rgb(${[red, green, blue].map((channel) => Math.min(255, Math.round(channel * light))).join(', ')})`;
  if (look === 'solid') {
    return {
      fill: shade(187, 174, 148),
      highlight: shade(237, 226, 201),
      stroke: shade(112, 100, 81),
      opacity: 1,
    };
  }
  return {
    fill: '#dcf9ff',
    highlight: null,
    stroke: shade(61, 145, 191),
    opacity: Math.min(1, brightness),
  };
}

type HandBoneAppearance = ReturnType<typeof createHandBoneAppearance>;

function boneFill(
  context: CanvasRenderingContext2D,
  appearance: HandBoneAppearance,
  x: number,
  y: number,
  offsetX: number,
  offsetY: number,
): string | CanvasGradient {
  if (!appearance.highlight) return appearance.fill;
  const gradient = context.createLinearGradient(x - offsetX, y - offsetY, x + offsetX, y + offsetY);
  gradient.addColorStop(0, appearance.fill);
  gradient.addColorStop(0.45, appearance.highlight);
  gradient.addColorStop(1, appearance.fill);
  return gradient;
}

function palmFrame(landmarks: Float32Array) {
  const x = landmarks[0];
  const y = landmarks[1];
  const alongX = landmarks[27] - x;
  const alongY = landmarks[28] - y;
  const acrossX = landmarks[15] - landmarks[51];
  const acrossY = landmarks[16] - landmarks[52];
  const length = Math.hypot(alongX, alongY);
  const span = Math.hypot(acrossX, acrossY);
  const area = Math.abs(alongX * acrossY - alongY * acrossX);
  const project = (along: number, across: number): Point => ({
    x: x + along * alongX + across * acrossX,
    y: y + along * alongY + across * acrossY,
  });
  const hasArea = area > 0.12 * length * Math.max(span, length);
  return { x, y, alongX, alongY, acrossX, acrossY, hasArea, project };
}

// Bases fan out from the distal row of carpals instead of meeting at the wrist.
const METACARPAL_BASE_ACROSS: Readonly<Record<number, number>> = { 5: 0.20, 9: 0, 13: -0.16, 17: -0.28 };

function metacarpalBase(palm: ReturnType<typeof palmFrame>, mcp: number): Point {
  return palm.hasArea
    ? palm.project(0.39, METACARPAL_BASE_ACROSS[mcp])
    : palm;
}

export interface Lens {
  x: number;
  y: number;
  size: number;
}

export function palmCenter(landmarks: Float32Array): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const point of PALM_POINTS) {
    x += landmarks[point * 3];
    y += landmarks[point * 3 + 1];
  }
  return { x: x / PALM_POINTS.length, y: y / PALM_POINTS.length };
}

export function handLabelAnchors(hands: readonly TrackedHand[]): LabelAnchor[] {
  const [first, second] = hands.map(({ landmarks }) => labelsForHand(landmarks));
  if (!first) return [];
  if (!second) return [...first.groups, ...first.bones];
  const pairedBones: LabelAnchor[] = [];
  for (let index = 0; index < Math.max(first.bones.length, second.bones.length); index++) {
    if (first.bones[index]) pairedBones.push(first.bones[index]);
    if (second.bones[index]) pairedBones.push(second.bones[index]);
  }
  return [
    ...first.groups, ...second.groups,
    ...pairedBones,
  ];
}

function labelsForHand(landmarks: Float32Array): { groups: LabelAnchor[]; bones: LabelAnchor[] } {
  const [, middleMcp, , middleDip] = BONE_CHAINS[2];
  const [, pinkyMcp, pinkyPip, pinkyDip, pinkyTip] = BONE_CHAINS[4];
  const segment = (text: string, start: number, end: number): LabelAnchor => ({
    text,
    x: (landmarks[start * 3] + landmarks[end * 3]) / 2,
    y: (landmarks[start * 3 + 1] + landmarks[end * 3 + 1]) / 2,
  });

  const palm = palmFrame(landmarks);
  const metacarpal = (text: string, mcp: number): LabelAnchor => {
    const base = metacarpalBase(palm, mcp);
    return {
      text,
      x: (base.x + landmarks[mcp * 3]) / 2,
      y: (base.y + landmarks[mcp * 3 + 1]) / 2,
    };
  };
  const estimate = (text: string, along: number, across: number): LabelAnchor => ({
    text,
    ...palm.project(along, across),
    estimated: true,
  });

  return {
    groups: [
      segment('Phalanges', middleMcp, middleDip),
      metacarpal('Metacarpus', middleMcp),
      ...(palm.hasArea ? [estimate('Carpus', 0.20, 0)] : []),
    ],
    bones: [
      segment('Distal phalanx', pinkyDip, pinkyTip),
      segment('Middle phalanx', pinkyPip, pinkyDip),
      segment('Proximal phalanx', pinkyMcp, pinkyPip),
      metacarpal('Metacarpal', pinkyMcp),
      ...(palm.hasArea ? [...CARPAL_BONES, ...FOREARM_BONES].map(({ text, along, across }) =>
        estimate(text, along, across)) : []),
    ],
  };
}

function drawWristBones(
  context: CanvasRenderingContext2D,
  palm: ReturnType<typeof palmFrame>,
  width: number,
  height: number,
  strokeWidth: number,
  appearance: HandBoneAppearance,
): void {
  // Author the silhouettes in palm coordinates and stroke them in screen pixels.
  const begin = () => {
    context.beginPath();
    context.save();
    context.transform(
      palm.acrossX * width, palm.acrossY * height,
      palm.alongX * width, palm.alongY * height,
      palm.x * width, palm.y * height,
    );
  };
  const finish = (along: number, across: number, halfWidth: number) => {
    context.closePath();
    context.restore();
    const center = palm.project(along, across);
    context.fillStyle = boneFill(
      context, appearance, center.x * width, center.y * height,
      palm.acrossX * width * halfWidth, palm.acrossY * height * halfWidth,
    );
    context.fill();
    context.stroke();
  };

  context.lineWidth = strokeWidth;
  for (const bone of FOREARM_BONES) {
    const { along, across, length, wristWidth, shaftWidth } = bone;
    const top = along + length / 2;
    const bottom = along - length / 2;
    const joint = wristWidth / 2;
    const shaft = shaftWidth / 2;
    begin();
    context.moveTo(across - shaft, bottom);
    context.bezierCurveTo(across - shaft, along, across - joint, top - 0.14, across - joint, top - 0.06);
    context.quadraticCurveTo(across, top + 0.06, across + joint, top - 0.06);
    context.bezierCurveTo(across + joint, top - 0.14, across + shaft, along, across + shaft, bottom);
    context.quadraticCurveTo(across, bottom - 0.05, across - shaft, bottom);
    finish(along, across, joint);
  }

  for (const { along, across, length, width: boneWidth } of CARPAL_BONES) {
    const side = boneWidth / 2;
    const end = length / 2;
    begin();
    context.moveTo(across - side * 0.8, along);
    context.bezierCurveTo(
      across - side, along + end, across + side * 0.3, along + end * 1.2, across + side * 0.8, along + end * 0.45,
    );
    context.bezierCurveTo(
      across + side * 1.2, along - end * 0.4, across + side * 0.4, along - end, across - side * 0.2, along - end,
    );
    context.quadraticCurveTo(across - side, along - end * 0.9, across - side * 0.8, along);
    finish(along, across, side);
  }
}

export function drawHandBones(
  context: CanvasRenderingContext2D,
  landmarks: Float32Array,
  appearance: HandBoneAppearance,
): void {
  if (appearance.opacity === 0) return;
  const { width, height } = context.canvas;
  const palmWidth = Math.hypot((landmarks[15] - landmarks[51]) * width, (landmarks[16] - landmarks[52]) * height);
  const palmLength = Math.hypot((landmarks[27] - landmarks[0]) * width, (landmarks[28] - landmarks[1]) * height);
  const thickness = Math.max(1, Math.max(palmWidth, palmLength * 0.65) * 0.06);
  const palm = palmFrame(landmarks);

  // Draw distant segments first so curled fingers retain their overlap.
  const bones = [...BONES].sort((a, b) => (landmarks[b.start + 2] + landmarks[b.end + 2]) -
    (landmarks[a.start + 2] + landmarks[a.end + 2]));

  context.save();
  context.lineJoin = 'round';
  context.globalAlpha = appearance.opacity;
  context.strokeStyle = appearance.stroke;
  if (palm.hasArea) drawWristBones(context, palm, width, height, Math.max(0.75, thickness * 0.24), appearance);
  for (const bone of bones) {
    const base = bone.palmBase === undefined ? undefined : metacarpalBase(palm, bone.palmBase);
    const x = (base?.x ?? landmarks[bone.start]) * width;
    const y = (base?.y ?? landmarks[bone.start + 1]) * height;
    const endX = landmarks[bone.end] * width;
    const endY = landmarks[bone.end + 1] * height;
    const length = Math.hypot(endX - x, endY - y);
    if (length < 0.5) continue;

    const halfWidth = thickness * bone.width;
    const nx = (y - endY) / length * halfWidth;
    const ny = (endX - x) / length * halfWidth;
    const cx = (x + endX) / 2;
    const cy = (y + endY) / 2;
    context.beginPath();
    context.moveTo(x + nx, y + ny);
    context.quadraticCurveTo(cx + nx * 0.4, cy + ny * 0.4, endX + nx * 0.8, endY + ny * 0.8);
    context.quadraticCurveTo(endX + ny * 0.6, endY - nx * 0.6, endX - nx * 0.8, endY - ny * 0.8);
    context.quadraticCurveTo(cx - nx * 0.4, cy - ny * 0.4, x - nx, y - ny);
    context.quadraticCurveTo(x - ny * 0.6, y + nx * 0.6, x + nx, y + ny);
    context.closePath();
    context.lineWidth = Math.max(0.75, halfWidth * 0.24);
    context.fillStyle = boneFill(context, appearance, cx, cy, nx, ny);
    context.fill();
    context.stroke();
  }
  context.restore();
}
