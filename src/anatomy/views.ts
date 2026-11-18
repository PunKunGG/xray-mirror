import { PRESETS, type AnatomyLayer } from './layers.ts';
import { DEFAULT_LABEL_OPTIONS, type LabelOptions } from './label-options.ts';
import type { SkullLook } from './xray-material.ts';

export interface ViewSettings {
  layers: readonly AnatomyLayer[];
  look: SkullLook;
  brightness: number;
  reveal: 'whole-head' | 'hand-lens';
  lensSize: number;
  realMe: number;
  feather: number;
  labels: boolean;
  labelOptions: LabelOptions;
}

const classic: ViewSettings = {
  layers: PRESETS.skull, look: 'xray', brightness: 100, reveal: 'whole-head',
  lensSize: 30, realMe: 0, feather: 0, labels: false, labelOptions: DEFAULT_LABEL_OPTIONS,
};

export const VIEWS = {
  classic,
  study: { ...classic, layers: PRESETS.everything, labels: true },
  lens: { ...classic, layers: ['skull', 'hands'], reveal: 'hand-lens', lensSize: 40 },
  hands: { ...classic, layers: PRESETS.hands, look: 'solid', labels: true, labelOptions: { ...DEFAULT_LABEL_OPTIONS, focus: 'hands' } },
} as const satisfies Record<string, ViewSettings>;
