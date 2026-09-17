import type { RefObject } from "react";

export type EffortFieldMode = "off" | "minimal" | "low" | "medium" | "high" | "extra" | "max";

type BooleanSource = boolean | RefObject<boolean>;
type Color = readonly [number, number, number];

interface PixelCell {
  x: number;
  y: number;
  row: number;
  column: number;
  nX: number;
  base: number;
  tempo: number;
  phase: number;
  chroma: number;
  purple: number;
  intensity: number;
  depth: number;
}

export interface EffortPixelFieldOptions {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  thumbRef: RefObject<HTMLElement | null>;
  /** The slider's current display position, normalized to the inclusive 0..1 range. */
  continuousValueRef: RefObject<number>;
  mode: EffortFieldMode;
  active: boolean;
  /** A ref avoids rebuilding the canvas effect when pointer capture changes. */
  dragging?: BooleanSource;
}

const FRAME_INTERVAL = 33;
const PIXEL_GAP = 1.1;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const x = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return x * x * (3 - 2 * x);
};

const mix = (from: number, to: number, amount: number) => from + (to - from) * amount;

const mixColor = (from: Color, to: Color, amount: number) =>
  `rgb(${Math.round(mix(from[0], to[0], amount))} ${Math.round(
    mix(from[1], to[1], amount),
  )} ${Math.round(mix(from[2], to[2], amount))})`;

const readBoolean = (source: BooleanSource | undefined) =>
  typeof source === "boolean" ? source : Boolean(source?.current);

const pixelRatio = () => Math.min(window.devicePixelRatio || 1, 2);

function clipToTrack(context: CanvasRenderingContext2D, width: number, height: number) {
  context.beginPath();
  if (typeof context.roundRect === "function") context.roundRect(0, 0, width, height, 10);
  else context.rect(0, 0, width, height);
  context.clip();
}

function buildPixelGrid(width: number, height: number) {
  const cell = width < 280 ? 5 : 6;
  const columns = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const cells: PixelCell[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = column * cell;
      const y = row * cell;
      const nX = (x + cell * 0.5) / width;
      cells.push({
        x,
        y,
        row,
        column,
        nX,
        base: Math.abs(Math.sin(column * 12.9898 + row * 78.233) * 43758.5453) % 1,
        tempo: Math.abs(Math.sin(column * 7.13 + row * 19.41) * 19341.731) % 1,
        phase: Math.abs(Math.sin(column * 31.17 + row * 11.93) * 28437.123) % 1,
        chroma: Math.abs(Math.sin(column * 9.47 + row * 67.13) * 15823.917) % 1,
        purple: smoothstep(0.1, 0.88, nX),
        intensity: smoothstep(0.04, 0.38, nX),
        depth: smoothstep(0.35, 0.95, nX),
      });
    }
  }

  return { cells, cell };
}

interface DrawMaxOptions {
  context: CanvasRenderingContext2D;
  width: number;
  height: number;
  time: number;
  startedAt: number;
  reveal: number;
  cells: PixelCell[];
  cell: number;
}

function drawMaxField({ context, width, height, time, startedAt, reveal, cells, cell }: DrawMaxOptions) {
  const frontier = 1 - reveal;
  const elapsed = Math.max(0, time - startedAt);

  const leftColor: Color = [210, 206, 214];
  const deepViolet: Color = [150, 96, 205];
  const deepMid: Color = [156, 118, 200];
  const midPurple: Color = [166, 140, 206];
  const softMid: Color = [170, 154, 206];
  const softLilac: Color = [182, 168, 206];
  const paleCool: Color = [194, 182, 206];
  const highlightColor: Color = [196, 182, 222];
  const peakColor: Color = [212, 198, 234];
  const tones: Color[] = [
    deepViolet,
    deepViolet,
    deepMid,
    deepMid,
    midPurple,
    midPurple,
    midPurple,
    softMid,
    softMid,
    softLilac,
    paleCool,
  ];

  const rawFlow = elapsed / FIELD_PROFILE.max.period;
  const flowCycle = Math.floor(rawFlow);
  const easedFlow = flowCycle + smoothstep(0, 1, rawFlow - flowCycle);

  context.save();
  clipToTrack(context, width, height);

  for (const current of cells) {
    const { x, y, row, nX, base, tempo, phase, chroma, purple, intensity, depth } = current;
    const revealAlpha = smoothstep(frontier - 0.1, frontier + 0.07, nX);
    if (revealAlpha <= 0.002) continue;

    const period = 500 + tempo * 1500;
    const localTime = elapsed + phase * period;
    const cycle = Math.floor(localTime / period);
    const cycleProgress = (localTime % period) / period;
    const cycleHash =
      Math.abs(Math.sin(current.column * 17.17 + row * 41.73 + cycle * 13.11) * 24634.6345) % 1;
    const widthHash =
      Math.abs(Math.sin(current.column * 5.37 + row * 29.11 + cycle * 7.43) * 17391.443) % 1;

    const pulseCenter = 0.2 + cycleHash * 0.55;
    const pulseWidth = 0.09 + widthHash * 0.08;
    const pulseDistance = (cycleProgress - pulseCenter) / pulseWidth;
    const pulseEnvelope = Math.exp(-pulseDistance * pulseDistance * 1.45);
    const activeCycle = cycleHash > 0.12 ? 1 : 0.26;
    const irregularFlicker = pulseEnvelope * activeCycle;

    const flowCoordinate = (nX + easedFlow) * 9;
    const flowIndex = Math.floor(flowCoordinate);
    const flowProgress = smoothstep(0, 1, flowCoordinate - flowIndex);
    const flowHashA = Math.abs(Math.sin(flowIndex * 18.31 + row * 37.17) * 19283.173) % 1;
    const flowHashB = Math.abs(Math.sin((flowIndex + 1) * 18.31 + row * 37.17) * 19283.173) % 1;
    const clusterGate = smoothstep(0.46, 0.84, mix(flowHashA, flowHashB, flowProgress));
    const wavePhase = (nX + easedFlow + row * 0.06 + base * 0.02) * Math.PI * 2;
    const directionalWave = Math.pow(0.5 + 0.5 * Math.cos(wavePhase), 5);
    const directionalFlow = Math.max(clusterGate, directionalWave * 0.62);
    const flowingFlicker = Math.max(
      irregularFlicker * (0.48 + directionalFlow * 0.58),
      directionalFlow * (0.38 + base * 0.28),
    );

    let lightAmount = flowingFlicker;
    const revealGlow =
      reveal < 0.995
        ? Math.exp(-((nX - frontier) ** 2) / 0.012) * (1 - smoothstep(0.7, 1, reveal))
        : 0;
    lightAmount = Math.max(lightAmount, revealGlow * (0.4 + base * 0.4));

    const peakHighlight =
      lightAmount > 0.4 && irregularFlicker > 0.16 && cycleHash > 0.26 && clusterGate > 0.04;
    const hottestHighlight =
      lightAmount > 0.68 && irregularFlicker > 0.3 && cycleHash > 0.48 && clusterGate > 0.12;
    const highlightAmount = peakHighlight ? 0.97 : clamp(lightAmount * (0.44 + cycleHash * 0.3), 0, 0.64);

    const toneDrift =
      base * 0.28 +
      depth * 0.28 +
      cycleProgress * 0.38 +
      easedFlow * 0.18 +
      cycleHash * 0.2 +
      Math.sin(elapsed * 0.00135 + phase * Math.PI * 2) * 0.14;
    const tonePosition = (((toneDrift % 1) + 1) % 1) * tones.length;
    const toneIndex = Math.floor(tonePosition);
    const toneMix = tonePosition - toneIndex;
    const toneA = tones[toneIndex];
    const toneB = tones[(toneIndex + 1) % tones.length];
    const cellTone: Color = [
      mix(toneA[0], toneB[0], toneMix),
      mix(toneA[1], toneB[1], toneMix),
      mix(toneA[2], toneB[2], toneMix),
    ];

    const chromaNudge = (chroma - 0.5) * 10 + depth * 12;
    const variedPurple: Color = [
      clamp(cellTone[0] + chromaNudge * 0.35 - depth * 8, 140, 196),
      clamp(cellTone[1] - depth * 16 + (base - 0.5) * 8, 104, 168),
      clamp(cellTone[2] + depth * 6 + (cycleHash - 0.5) * 6, 182, 216),
    ];
    const baseColor: Color = [
      mix(leftColor[0], variedPurple[0], purple),
      mix(leftColor[1], variedPurple[1], purple),
      mix(leftColor[2], variedPurple[2], purple),
    ];
    const color = hottestHighlight
      ? mixColor(baseColor, peakColor, 0.95)
      : mixColor(baseColor, highlightColor, highlightAmount);

    const baseOpacity = 0.7 + base * 0.2;
    context.globalAlpha =
      peakHighlight || hottestHighlight
        ? revealAlpha * intensity
        : revealAlpha * intensity * clamp(baseOpacity + flowingFlicker * 0.12, 0, 1);
    context.fillStyle = color;
    context.fillRect(x + PIXEL_GAP * 0.5, y + PIXEL_GAP * 0.5, cell - PIXEL_GAP, cell - PIXEL_GAP);
  }

  context.restore();
  context.globalAlpha = 1;
}

interface DrawStageOptions {
  context: CanvasRenderingContext2D;
  width: number;
  height: number;
  time: number;
  startedAt: number;
  mode: Exclude<EffortFieldMode, "max">;
  progress: number;
  thumbWidth: number;
  reducedMotion: boolean;
  cells: PixelCell[];
  cell: number;
}

const FIELD_PROFILE = {
  off: { color: [145, 145, 150], density: 0.1, period: 2600 },
  minimal: { color: [105, 165, 180], density: 0.18, period: 2200 },
  low: { color: [88, 143, 220], density: 0.28, period: 1800 },
  medium: { color: [74, 190, 155], density: 0.4, period: 1450 },
  high: { color: [120, 160, 255], density: 0.56, period: 1100 },
  extra: { color: [185, 130, 250], density: 0.74, period: 820 },
  max: { color: [211, 126, 232], density: 1, period: 680 },
} as const satisfies Record<EffortFieldMode, { color: Color; density: number; period: number }>;

export function effortFieldProfile(mode: EffortFieldMode) {
  return FIELD_PROFILE[mode];
}

function drawStageField({
  context,
  width,
  height,
  time,
  startedAt,
  mode,
  progress,
  thumbWidth,
  reducedMotion,
  cells,
  cell,
}: DrawStageOptions) {
  const thumbX = (width - thumbWidth) * progress + thumbWidth * 0.5;
  const originX = clamp(thumbX, 4, width - 4);
  const profile = effortFieldProfile(mode);
  const color = profile.color;
  const elapsed = Math.max(0, time - startedAt);
  const reveal = reducedMotion ? 1 : smoothstep(0, 1, elapsed / 520);
  const ripplePhase = (elapsed % profile.period) / profile.period;

  context.save();
  clipToTrack(context, width, height);

  for (const current of cells) {
    const { x, y, base, tempo, phase } = current;
    if (x + cell * 0.5 > originX) continue;
    const dx = Math.abs(x - originX) / (width * 0.5);
    if (dx > 1) continue;
    const near = clamp(1 - dx * 0.92, 0, 1);
    const density = profile.density * (0.56 + near * 0.44);
    if (base > density) continue;

    const flicker = 0.5 + 0.5 * Math.sin((elapsed / profile.period) * Math.PI * 2 * (1.4 + tempo * 1.8) + phase * 6.28);
    const wave = 0.5 + 0.5 * Math.sin((dx * 2.7 - ripplePhase) * Math.PI * 2);
    const revealAlpha = smoothstep(0, 1, reveal * (1 - dx * 0.85) + dx * 0.15);
    const brightness = (0.18 + 0.48 * flicker + near * 0.4) * (0.25 + 0.75 * wave) * revealAlpha;
    const alpha = clamp(brightness, 0, 1);

    context.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha.toFixed(3)})`;
    context.fillRect(x + PIXEL_GAP * 0.5, y + PIXEL_GAP * 0.5, cell - PIXEL_GAP, cell - PIXEL_GAP);
  }

  context.restore();
  context.globalAlpha = 1;
}

/**
 * Mounts the original DSH pixel/ripple renderer without coupling animation
 * frames to React. Call once from an effect and return its cleanup function.
 */
export function mountEffortPixelField({
  canvasRef,
  thumbRef,
  continuousValueRef,
  mode,
  active,
  dragging,
}: EffortPixelFieldOptions) {
  const canvas = canvasRef.current;
  if (!canvas) return () => undefined;

  const context = canvas.getContext("2d");
  if (!context) return () => undefined;

  let cells: PixelCell[] = [];
  let cell = 6;
  let animationFrame = 0;
  let lastCanvasFrame = 0;
  let maxReveal = mode === "max" ? 0 : 1;
  let startedAt = Date.now();
  let disposed = false;
  let resizePending = false;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const resizeTarget = canvas.parentElement ?? canvas;

  const clear = () => {
    const ratio = pixelRatio();
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, canvas.width / ratio, canvas.height / ratio);
  };

  const draw = (time: number) => {
    if (!canvas.width || !canvas.height || !mode || !active) return;
    const ratio = pixelRatio();
    const width = canvas.width / ratio;
    const height = canvas.height / ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    if (mode !== "max") {
      drawStageField({
        context,
        width,
        height,
        time,
        startedAt,
        mode,
        progress: clamp(continuousValueRef.current ?? 0, 0, 1),
        thumbWidth: thumbRef.current?.offsetWidth ?? 0,
        reducedMotion: reducedMotion.matches,
        cells,
        cell,
      });
      return;
    }

    drawMaxField({
      context,
      width,
      height,
      time,
      startedAt,
      reveal: reducedMotion.matches ? 1 : maxReveal,
      cells,
      cell,
    });
  };

  const resize = () => {
    const rect = resizeTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const ratio = pixelRatio();
    const width = Math.round(rect.width * ratio);
    const height = Math.round(rect.height * ratio);
    const dimensionsChanged = canvas.width !== width || canvas.height !== height;
    if (dimensionsChanged) {
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    }
    if (dimensionsChanged || cells.length === 0) ({ cells, cell } = buildPixelGrid(rect.width, rect.height));
    draw(Date.now());
  };

  const cancelLoop = () => {
    if (!animationFrame) return;
    cancelAnimationFrame(animationFrame);
    animationFrame = 0;
  };

  const frame = () => {
    animationFrame = 0;
    if (disposed || !canvas.isConnected || !mode || !active || reducedMotion.matches) return;

    const time = Date.now();
    if (resizePending && !readBoolean(dragging)) {
      resizePending = false;
      resize();
    }
    if (time - lastCanvasFrame >= FRAME_INTERVAL) {
      lastCanvasFrame = time;
      if (mode === "max") maxReveal = smoothstep(0, 1, (time - startedAt) / 640);
      draw(time);
    }
    animationFrame = requestAnimationFrame(frame);
  };

  const ensureLoop = () => {
    if (animationFrame || disposed || !mode || !active) return;
    if (reducedMotion.matches) {
      draw(Date.now());
      return;
    }
    animationFrame = requestAnimationFrame(frame);
  };

  const handleReducedMotionChange = () => {
    cancelLoop();
    if (mode === "max") {
      maxReveal = reducedMotion.matches ? 1 : 0;
      startedAt = Date.now();
    }
    if (reducedMotion.matches) draw(Date.now());
    else ensureLoop();
  };

  const resizeObserver = new ResizeObserver(() => {
    if (readBoolean(dragging) && canvas.width && canvas.height) {
      resizePending = true;
      return;
    }
    resize();
  });

  if (!active || !mode) {
    clear();
    return () => undefined;
  }

  resizeObserver.observe(resizeTarget);
  reducedMotion.addEventListener("change", handleReducedMotionChange);
  resize();
  ensureLoop();

  return () => {
    disposed = true;
    cancelLoop();
    resizeObserver.disconnect();
    reducedMotion.removeEventListener("change", handleReducedMotionChange);
    clear();
  };
}
