export const MODEL_LAYERS = ['skull', 'brain', 'muscles', 'eyes'] as const;
export type ModelLayer = (typeof MODEL_LAYERS)[number];

export const HEAD_LAYERS = [...MODEL_LAYERS, 'outline'] as const;
export type HeadLayer = (typeof HEAD_LAYERS)[number];

export const PRESETS = {
  skull: ['skull'],
  brain: ['brain'],
  muscles: ['muscles'],
  everything: HEAD_LAYERS,
} as const satisfies Record<string, readonly HeadLayer[]>;
