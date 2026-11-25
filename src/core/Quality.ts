/**
 * Device tiering. Everything that scales with GPU cost (instance counts,
 * raymarch resolution, particle budget, MSAA, shadows) reads from here.
 * Force a tier with ?q=low|mid|high for testing.
 */
export type Tier = 'low' | 'mid' | 'high';

const params = new URLSearchParams(location.search);
const forced = params.get('q') as Tier | null;

export const isTouch = matchMedia('(pointer: coarse)').matches;
export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

function detect(): Tier {
  if (forced === 'low' || forced === 'mid' || forced === 'high') return forced;
  const short = Math.min(screen.width, screen.height);
  if (isTouch) return short < 500 ? 'low' : 'mid';
  const cores = navigator.hardwareConcurrency || 4;
  return cores <= 4 ? 'mid' : 'high';
}

export const tier: Tier = detect();

const table = {
  low: { dpr: 1.25, msaa: 0, grid: [24, 68], rayScale: 0.42, raySteps: 56, blocks: 1600, particles: 45000, shadows: false },
  mid: { dpr: 1.5, msaa: 0, grid: [32, 68], rayScale: 0.5, raySteps: 72, blocks: 2600, particles: 80000, shadows: true },
  high: { dpr: 2, msaa: 4, grid: [40, 70], rayScale: 0.6, raySteps: 90, blocks: 4096, particles: 140000, shadows: true },
} as const;

const t = table[tier];

export const Q = {
  tier,
  dpr: Math.min(window.devicePixelRatio || 1, t.dpr),
  msaa: t.msaa,
  grid: t.grid as readonly [number, number],
  rayScale: t.rayScale,
  raySteps: t.raySteps,
  blocks: t.blocks,
  particles: t.particles,
  shadows: t.shadows,
  reducedMotion,
  isTouch,
};
