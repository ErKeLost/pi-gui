export type EffortFieldMode = "high" | "extra" | "max" | null;

type Rgb = readonly [number, number, number];

const LEVEL_COLORS: readonly Rgb[] = [
  [158, 158, 158],
  [151, 151, 151],
  [144, 144, 144],
  [192, 186, 236],
  [186, 176, 232],
  [182, 156, 240],
];

const LEVEL_COLORS_SOFT: readonly Rgb[] = [
  [214, 214, 214],
  [210, 210, 210],
  [206, 206, 206],
  [212, 208, 242],
  [208, 202, 240],
  [206, 184, 244],
];

const LEVEL_COLORS_DEEP: readonly Rgb[] = [
  [120, 120, 120],
  [114, 114, 114],
  [108, 108, 108],
  [124, 110, 190],
  [120, 102, 186],
  [114, 74, 198],
];

const VISUAL_SLOT: Record<string, number> = {
  none: 0,
  off: 0,
  minimal: 1,
  low: 1,
  medium: 2,
  high: 3,
  extra: 4,
  xhigh: 4,
  max: 5,
};

const VISUAL_POSITION: Record<string, number> = { ...VISUAL_SLOT, minimal: 0.5 };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const smoothstep = (value: number) => {
  const x = clamp(value, 0, 1);
  return x * x * (3 - 2 * x);
};
const normalize = (level?: string) => (level ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
const mix = (from: number, to: number, amount: number) => from + (to - from) * amount;
const mixColor = (from: Rgb, to: Rgb, amount: number): Rgb => [
  mix(from[0], to[0], amount),
  mix(from[1], to[1], amount),
  mix(from[2], to[2], amount),
];
const rgb = (color: Rgb) => `rgb(${Math.round(color[0])} ${Math.round(color[1])} ${Math.round(color[2])})`;

export function effortLabel(level?: string) {
  if (!level || level === "off") return "Off";
  if (level === "xhigh") return "XHigh";
  return level.charAt(0).toUpperCase() + level.slice(1);
}

export function effortVisualSlot(level?: string) {
  return VISUAL_SLOT[normalize(level)] ?? 0;
}

export function effortVisualPosition(level?: string) {
  return VISUAL_POSITION[normalize(level)] ?? 0;
}

export function effortFieldMode(level?: string): EffortFieldMode {
  const canonical = normalize(level);
  if (canonical === "max") return "max";
  if (canonical === "extra" || canonical === "xhigh") return "extra";
  if (canonical === "high") return "high";
  return null;
}

function paletteColorAt(palette: readonly Rgb[], value: number) {
  const safe = clamp(Number.isFinite(value) ? value : 0, 0, 5);
  const lowerIndex = Math.floor(safe);
  const upperIndex = Math.min(lowerIndex + 1, 5);
  const amount = smoothstep(safe - lowerIndex);
  return mixColor(palette[lowerIndex], palette[upperIndex], amount);
}

export function effortColorsAt(value: number) {
  return {
    base: rgb(paletteColorAt(LEVEL_COLORS, value)),
    soft: rgb(paletteColorAt(LEVEL_COLORS_SOFT, value)),
    deep: rgb(paletteColorAt(LEVEL_COLORS_DEEP, value)),
  };
}

export function effortColorsForLevels(levels: readonly string[], value: number) {
  const max = Math.max(0, levels.length - 1);
  const safe = clamp(Number.isFinite(value) ? value : 0, 0, max);
  const lowerIndex = Math.floor(safe);
  const upperIndex = Math.min(lowerIndex + 1, max);
  const amount = smoothstep(safe - lowerIndex);
  const lowerPosition = effortVisualPosition(levels[lowerIndex]);
  const upperPosition = effortVisualPosition(levels[upperIndex]);
  const combine = (palette: readonly Rgb[]) => rgb(mixColor(paletteColorAt(palette, lowerPosition), paletteColorAt(palette, upperPosition), amount));
  return { base: combine(LEVEL_COLORS), soft: combine(LEVEL_COLORS_SOFT), deep: combine(LEVEL_COLORS_DEEP) };
}

export function magnetizeEffort(value: number, targets: number[]) {
  if (!targets.length) return value;
  let nearest = targets[0];
  let distance = Number.POSITIVE_INFINITY;
  for (const target of targets) {
    const delta = Math.abs(value - target);
    if (delta < distance) {
      distance = delta;
      nearest = target;
    }
  }
  if (distance < 0.001 || distance > 0.5) return value;
  const delta = value - nearest;
  const strength = 1 - distance / 0.5;
  return value - delta * (0.68 + 0.42 * strength) * strength * strength;
}
