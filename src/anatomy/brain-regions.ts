export const BRAIN_REGIONS = ['Cerebrum', 'Cerebellum', 'Brainstem'] as const;
export type BrainRegion = (typeof BRAIN_REGIONS)[number];

// BodyParts3D 4.0 IS-A element IDs present in brain.glb. Use cortical surfaces as well as white matter.
const ELEMENTS: Record<BrainRegion, ReadonlySet<string>> = {
  Cerebrum: new Set([
    'FJ1732', 'FJ1733', 'FJ1739', 'FJ1740', 'FJ1744', 'FJ1745', 'FJ1746', 'FJ1747',
    'FJ1748', 'FJ1749', 'FJ1750', 'FJ1751', 'FJ1758', 'FJ1759', 'FJ1783', 'FJ1784',
    'FJ1785', 'FJ1786', 'FJ1787', 'FJ1788', 'FJ1789', 'FJ1790', 'FJ1791', 'FJ1792',
    'FJ1797', 'FJ1798', 'FJ1800', 'FJ1801', 'FJ1806', 'FJ1807', 'FJ1833', 'FJ1834',
    'FJ1835', 'FJ1836', 'FJ1841', 'FJ1842',
  ]),
  Cerebellum: new Set(['FJ1781', 'FJ1830']),
  Brainstem: new Set([
    'FJ1762', 'FJ1769', 'FJ1770', 'FJ1775', 'FJ1779',
    'FJ1810', 'FJ1817', 'FJ1822', 'FJ1826', 'FJ1831',
  ]),
};

export function brainRegionForMesh(name: string | undefined): BrainRegion | undefined {
  if (!name?.startsWith('Brain ')) return undefined;
  const id = name.slice('Brain '.length);
  return BRAIN_REGIONS.find((region) => ELEMENTS[region].has(id));
}
