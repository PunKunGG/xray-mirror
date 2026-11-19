import { MODEL_LAYERS, type ModelLayer } from './layers.ts';

export const LABEL_FOCI = ['overview', 'head', 'hands', 'everything'] as const;
export const HAND_LABEL_GROUPS = ['fingers', 'palm', 'wrist', 'forearm'] as const;
export type LabelFocus = (typeof LABEL_FOCI)[number];
export type HandLabelGroup = (typeof HAND_LABEL_GROUPS)[number];

export interface LabelOptions {
  focus: LabelFocus;
  headGroup: ModelLayer;
  handGroup: HandLabelGroup;
}

export const DEFAULT_LABEL_OPTIONS: LabelOptions = { focus: 'overview', headGroup: 'skull', handGroup: 'fingers' };

interface LabelPosition {
  text: string;
  x: number;
  y: number;
  estimated?: boolean;
}

export type HeadLabelAnchor = LabelPosition & { layer: ModelLayer };
export type HandLabelAnchor = LabelPosition & { handId: number; group: HandLabelGroup; overview?: boolean };
export type LabelAnchor = HeadLabelAnchor | HandLabelAnchor;

export function decodeLabelOptions(value: unknown): LabelOptions {
  if (!value || typeof value !== 'object') return DEFAULT_LABEL_OPTIONS;
  const saved = value as Partial<Record<keyof LabelOptions, unknown>>;
  return {
    focus: LABEL_FOCI.find((focus) => focus === saved.focus) ?? DEFAULT_LABEL_OPTIONS.focus,
    headGroup: MODEL_LAYERS.find((layer) => layer === saved.headGroup) ?? DEFAULT_LABEL_OPTIONS.headGroup,
    handGroup: HAND_LABEL_GROUPS.find((group) => group === saved.handGroup) ?? DEFAULT_LABEL_OPTIONS.handGroup,
  };
}

const HEAD_OVERVIEW: Record<ModelLayer, readonly string[]> = {
  skull: ['Frontal bone', 'Mandible', 'Maxilla', 'Zygomatic bone', 'Parietal bone', 'Temporal bone', 'Occipital bone'],
  brain: ['Cerebrum', 'Cerebellum', 'Brainstem'],
  muscles: ['Eye muscles', 'Tongue muscles', 'Soft palate muscles'],
  eyes: ['Left eye', 'Right eye'],
};

function handSubjects(anchors: readonly HandLabelAnchor[]): HandLabelAnchor[][] {
  const byHand = new Map<number, HandLabelAnchor[]>();
  for (const anchor of anchors) {
    const group = byHand.get(anchor.handId) ?? [];
    group.push(anchor);
    byHand.set(anchor.handId, group);
  }
  return [...byHand.entries()].sort(([first], [second]) => first - second).map(([, group]) => group);
}

function interleave(subjects: readonly LabelAnchor[][]): LabelAnchor[] {
  const ordered: LabelAnchor[] = [];
  const count = Math.max(0, ...subjects.map((group) => group.length));
  for (let index = 0; index < count; index++) {
    for (const group of subjects) if (group[index]) ordered.push(group[index]);
  }
  return ordered;
}

export function labelsForFocus(
  head: readonly HeadLabelAnchor[],
  hands: readonly HandLabelAnchor[],
  options: LabelOptions,
): LabelAnchor[] {
  if (options.focus === 'head') return head.filter(({ layer }) => layer === options.headGroup);
  if (options.focus === 'hands') {
    return interleave(handSubjects(hands.filter(({ group, overview }) => group === options.handGroup && !overview)));
  }
  if (options.focus === 'everything') return interleave([[...head], ...handSubjects(hands)]);

  const primary: HeadLabelAnchor[] = [];
  const secondary: HeadLabelAnchor[] = [];
  for (const layer of MODEL_LAYERS) {
    const group = HEAD_OVERVIEW[layer]
      .map((text) => head.find((anchor) => anchor.layer === layer && anchor.text === text))
      .filter((anchor) => anchor !== undefined);
    if (group.length) {
      primary.push(group[0]);
      secondary.push(...group.slice(1));
    }
  }
  return interleave([
    [...primary, ...secondary],
    ...handSubjects(hands.filter(({ overview }) => overview)),
  ]);
}
