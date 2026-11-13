export const MODEL_LAYERS = ['skull', 'brain', 'muscles', 'eyes'] as const;
export type ModelLayer = (typeof MODEL_LAYERS)[number];

export const ANATOMY_LAYERS = [...MODEL_LAYERS, 'outline', 'hands'] as const;
export type AnatomyLayer = (typeof ANATOMY_LAYERS)[number];

export const PRESETS = {
  skull: ['skull'],
  brain: ['brain'],
  muscles: ['muscles'],
  eyes: ['eyes'],
  hands: ['hands'],
  everything: ANATOMY_LAYERS,
} as const satisfies Record<string, readonly AnatomyLayer[]>;
