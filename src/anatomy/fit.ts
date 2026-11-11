const STORAGE_KEY = 'xray-mirror.fit.v1';

export const FIT_RANGES = {
  size: [0.5, 1.5],
  width: [0.5, 1.5],
  height: [0.5, 1.5],
  depth: [0.5, 1.5],
  x: [-8, 8],
  y: [-8, 8],
  z: [-8, 8],
} as const;

export type FitKey = keyof typeof FIT_RANGES;
export type HeadFit = Record<FitKey, number>;

export const FIT_KEYS = Object.keys(FIT_RANGES) as FitKey[];
export const DEFAULT_FIT: Readonly<HeadFit> = Object.freeze({
  size: 1, width: 1, height: 1, depth: 1, x: 0, y: 0, z: 0,
});

export function fitValue(key: FitKey, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_FIT[key];
  const [min, max] = FIT_RANGES[key];
  const precision = min < 0 ? 10 : 100;
  return Math.round(Math.min(max, Math.max(min, value)) * precision) / precision;
}

export function decodeFit(json: string | null): HeadFit {
  const fit = { ...DEFAULT_FIT };
  try {
    const saved: unknown = json === null ? null : JSON.parse(json);
    if (typeof saved === 'object' && saved !== null) {
      for (const key of FIT_KEYS) fit[key] = fitValue(key, (saved as Record<string, unknown>)[key]);
    }
  } catch {
    // A corrupted saved value should never prevent startup.
  }
  return fit;
}

export function readFit(): HeadFit {
  try {
    return decodeFit(localStorage.getItem(STORAGE_KEY));
  } catch {
    return { ...DEFAULT_FIT };
  }
}

export function saveFit(fit: HeadFit): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fit));
  } catch {
    // Adjustments still work in the current tab when storage is unavailable.
  }
}
