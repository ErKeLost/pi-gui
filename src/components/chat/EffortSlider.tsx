import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import type { RpcSessionState } from "../../lib/protocol";
import { mountEffortPixelField } from "./effort-pixel-field";
import {
  effortColorsForLevels,
  effortFieldMode,
  effortLabel,
  effortVisualSlot,
  magnetizeEffort,
} from "./effort-slider-model";
import "./effort-slider.css";

type EffortSliderProps = {
  levels: ThinkingLevel[];
  value?: ThinkingLevel;
  disabled?: boolean;
  onChange: (level: ThinkingLevel) => void;
};

type ThinkingLevel = NonNullable<RpcSessionState["thinkingLevel"]>;

type EffortStyle = CSSProperties & {
  "--ds-effort-progress": number;
  "--fill-x": string;
  "--ds-effort-level-color": string;
  "--ds-effort-level-soft": string;
  "--ds-effort-level-deep": string;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function moveLight(event: PointerEvent<HTMLElement>) {
  const track = event.currentTarget.querySelector<HTMLElement>(".effort-slider-track");
  if (!track) return;
  const rect = track.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
  const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
  const distance = Math.max(
    event.clientY < rect.top ? rect.top - event.clientY : Math.max(0, event.clientY - rect.bottom),
    event.clientX < rect.left ? rect.left - event.clientX : Math.max(0, event.clientX - rect.right),
  );
  event.currentTarget.style.setProperty("--light-x", `${(x * 100).toFixed(1)}%`);
  event.currentTarget.style.setProperty("--light-y", `${(y * 100).toFixed(1)}%`);
  event.currentTarget.style.setProperty("--light-strength", clamp(1 - distance / 70, 0, 1).toFixed(3));
}

function clearLight(event: PointerEvent<HTMLElement>) {
  event.currentTarget.style.setProperty("--light-strength", "0");
}

export function EffortSlider({ levels, value, disabled, onChange }: EffortSliderProps) {
  const maxIndex = Math.max(0, levels.length - 1);
  const selectedIndex = Math.max(0, levels.indexOf(value ?? levels[0]));
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const activeIndexRef = useRef(selectedIndex);
  const rootRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const continuousValueRef = useRef(selectedIndex);
  const progressRef = useRef(maxIndex ? selectedIndex / maxIndex : 0.5);
  const draggingRef = useRef(false);
  const lastCommittedRef = useRef(value);
  const activeLevel = levels[activeIndex];
  const activeVisualSlot = effortVisualSlot(activeLevel);
  const fieldMode = effortFieldMode(activeLevel);
  const initialColors = effortColorsForLevels(levels, selectedIndex);

  const applyVisual = useCallback((nextValue: number) => {
    const safeValue = clamp(Number.isFinite(nextValue) ? nextValue : 0, 0, maxIndex);
    const nextIndex = clamp(Math.round(safeValue), 0, maxIndex);
    const nextLevel = levels[nextIndex];
    const nextVisualSlot = effortVisualSlot(nextLevel);
    const nextMode = effortFieldMode(nextLevel);
    const progress = maxIndex ? safeValue / maxIndex : 0.5;
    const colors = effortColorsForLevels(levels, safeValue);
    continuousValueRef.current = safeValue;
    progressRef.current = progress;
    if (inputRef.current) {
      inputRef.current.value = String(safeValue);
      inputRef.current.setAttribute("aria-valuetext", effortLabel(nextLevel));
    }
    const root = rootRef.current;
    if (root) {
      root.style.setProperty("--ds-effort-progress", String(progress));
      root.style.setProperty("--fill-x", `${(progress * 100).toFixed(1)}%`);
      root.style.setProperty("--ds-effort-level-color", colors.base);
      root.style.setProperty("--ds-effort-level-soft", colors.soft);
      root.style.setProperty("--ds-effort-level-deep", colors.deep);
      root.dataset.level = String(nextVisualSlot);
      root.toggleAttribute("data-glow", nextVisualSlot >= 3);
      root.toggleAttribute("data-max", nextMode === "max");
      root.toggleAttribute("data-field", nextMode === "high" || nextMode === "extra");
      root.toggleAttribute("data-pixels-ready", nextMode === "max");
    }
    if (activeIndexRef.current !== nextIndex) {
      activeIndexRef.current = nextIndex;
      setActiveIndex(nextIndex);
    }
  }, [levels, maxIndex]);

  const commit = useCallback((target = Math.round(continuousValueRef.current)) => {
    const snapped = clamp(target, 0, maxIndex);
    applyVisual(snapped);
    const next = levels[snapped];
    if (next && next !== lastCommittedRef.current) {
      lastCommittedRef.current = next;
      onChange(next);
    }
  }, [applyVisual, levels, maxIndex, onChange]);

  useEffect(() => mountEffortPixelField({
    canvasRef,
    thumbRef,
    continuousValueRef: progressRef,
    mode: fieldMode,
    active: fieldMode != null,
    dragging: draggingRef,
  }), [fieldMode]);

  useEffect(() => {
    if (draggingRef.current) return;
    lastCommittedRef.current = value;
    applyVisual(Math.max(0, levels.indexOf(value ?? levels[0])));
  }, [applyVisual, levels, value]);

  const handleKey = (event: KeyboardEvent<HTMLInputElement>) => {
    const direction = event.key === "ArrowLeft" || event.key === "ArrowDown" || event.key === "PageDown" ? -1 : event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "PageUp" ? 1 : null;
    const target = event.key === "Home" ? 0 : event.key === "End" ? maxIndex : direction == null ? null : clamp(activeIndex + direction, 0, maxIndex);
    if (target == null) return;
    event.preventDefault();
    commit(target);
  };

  if (levels.length < 2) return null;
  const style: EffortStyle = {
    "--ds-effort-progress": maxIndex ? selectedIndex / maxIndex : 0.5,
    "--fill-x": `${((maxIndex ? selectedIndex / maxIndex : 0.5) * 100).toFixed(1)}%`,
    "--ds-effort-level-color": initialColors.base,
    "--ds-effort-level-soft": initialColors.soft,
    "--ds-effort-level-deep": initialColors.deep,
  };
  const hasMax = levels.some(level => effortFieldMode(level) === "max");

  return (
    <section
      ref={rootRef}
      className="effort-slider"
      data-disabled={disabled || undefined}
      data-field={fieldMode === "high" || fieldMode === "extra" ? "" : undefined}
      data-glow={activeVisualSlot >= 3 ? "" : undefined}
      data-level={activeVisualSlot}
      data-max={fieldMode === "max" ? "" : undefined}
      data-max-supported={hasMax ? "" : undefined}
      data-pixels-ready={fieldMode === "max" ? "" : undefined}
      onPointerMove={moveLight}
      onPointerLeave={clearLight}
      style={style}
    >
      <div className="effort-slider-shell">
        <div className="effort-slider-track" aria-hidden>
          <div className="effort-slider-fill" />
          <div className="effort-slider-max-fallback" />
          <canvas ref={canvasRef} className="effort-slider-pixels" />
          <div className="effort-slider-ticks">
            {levels.map((level, index) => (
              <i
                className={index <= activeIndex ? "on" : ""}
                data-max-tick={effortFieldMode(level) === "max" || undefined}
                style={{ "--tick-progress": maxIndex ? index / maxIndex : 0.5 } as CSSProperties}
                key={level}
              />
            ))}
          </div>
          <div className="effort-slider-light" />
          <div className="effort-slider-thumb-light" />
          <div ref={thumbRef} className="effort-slider-thumb" />
        </div>
        <div className="effort-slider-outline" aria-hidden />
        <input
          ref={inputRef}
          type="range"
          min={0}
          max={maxIndex}
          step={0.001}
          defaultValue={selectedIndex}
          disabled={disabled}
          aria-label="思考强度"
          aria-valuetext={effortLabel(activeLevel)}
          onPointerDown={event => {
            draggingRef.current = true;
            rootRef.current?.setAttribute("data-dragging", "");
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerUp={() => {
            if (!draggingRef.current) return;
            draggingRef.current = false;
            rootRef.current?.removeAttribute("data-dragging");
            commit();
          }}
          onPointerCancel={() => {
            if (!draggingRef.current) return;
            draggingRef.current = false;
            rootRef.current?.removeAttribute("data-dragging");
            commit();
          }}
          onInput={event => {
            const raw = Number(event.currentTarget.value);
            const next = draggingRef.current ? magnetizeEffort(raw, levels.map((_, index) => index)) : raw;
            event.currentTarget.value = String(next);
            applyVisual(next);
          }}
          onKeyDown={handleKey}
          onBlur={() => commit()}
        />
      </div>
    </section>
  );
}
