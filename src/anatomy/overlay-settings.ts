import { ANATOMY_LAYERS } from './layers.ts';
import { decodeLabelOptions } from './label-options.ts';
import { VIEWS, type ViewSettings } from './views.ts';

type OverlaySettings = ViewSettings & { diagnostics: boolean };

const STORAGE_KEY = 'xray-mirror.overlay.v1';
const DEFAULT_SETTINGS: OverlaySettings = { ...VIEWS.classic, diagnostics: false };

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.min(max, Math.max(min, value)))
    : fallback;
}

function decodeSettings(value: unknown): OverlaySettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return DEFAULT_SETTINGS;

  const saved = value as Record<string, unknown>;
  const savedLayers = saved.layers;
  const layers = Array.isArray(savedLayers)
    ? ANATOMY_LAYERS.filter((layer) => savedLayers.includes(layer))
    : DEFAULT_SETTINGS.layers;

  return {
    layers,
    look: saved.look === 'xray' || saved.look === 'solid' ? saved.look : DEFAULT_SETTINGS.look,
    brightness: clampInteger(saved.brightness, 0, 200, DEFAULT_SETTINGS.brightness),
    reveal: saved.reveal === 'whole-head' || saved.reveal === 'hand-lens' ? saved.reveal : DEFAULT_SETTINGS.reveal,
    lensSize: clampInteger(saved.lensSize, 10, 100, DEFAULT_SETTINGS.lensSize),
    realMe: clampInteger(saved.realMe, 0, 100, DEFAULT_SETTINGS.realMe),
    feather: clampInteger(saved.feather, 0, 24, DEFAULT_SETTINGS.feather),
    labels: typeof saved.labels === 'boolean' ? saved.labels : DEFAULT_SETTINGS.labels,
    labelOptions: decodeLabelOptions(saved.labelOptions),
    diagnostics: typeof saved.diagnostics === 'boolean' ? saved.diagnostics : DEFAULT_SETTINGS.diagnostics,
  };
}

export function readOverlaySettings(): OverlaySettings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === null ? DEFAULT_SETTINGS : decodeSettings(JSON.parse(saved));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveOverlaySettings(settings: OverlaySettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Controls still work when storage is unavailable.
  }
}
