import { describe, expect, test } from "bun:test";
import { effortFieldProfile, type EffortFieldMode } from "../src/components/chat/effort-pixel-field";
import { effortColorsForLevels, effortFieldMode, effortVisualPosition, effortVisualSlot } from "../src/components/chat/effort-slider-model";

describe("effort slider visual semantics", () => {
  test("does not treat the final available level as Max", () => {
    expect(effortVisualSlot("low")).toBe(1);
    expect(effortFieldMode("low")).toBe("low");
  });

  test("maps Pi thinking levels onto the original six visual stages", () => {
    expect(["off", "minimal", "low", "medium", "high", "xhigh", "max"].map(level => effortVisualSlot(level))).toEqual([0, 1, 1, 2, 3, 4, 5]);
    expect(effortFieldMode("high")).toBe("high");
    expect(effortFieldMode("xhigh")).toBe("extra");
    expect(effortFieldMode("max")).toBe("max");
  });

  test("keeps the original semantic positions while rendering every Pi stage", () => {
    expect(effortVisualPosition("off")).toBe(0);
    expect(effortVisualPosition("minimal")).toBe(1);
    expect(effortVisualPosition("low")).toBe(1);
    expect(effortFieldMode("minimal")).toBe("minimal");
    expect(effortFieldMode("medium")).toBe("medium");
  });

  test("increases pixel density and animation speed at every stage", () => {
    const modes: EffortFieldMode[] = ["off", "minimal", "low", "medium", "high", "extra", "max"];
    const profiles = modes.map(effortFieldProfile);
    expect(profiles.every((profile, index) => index === 0 || profile.density > profiles[index - 1].density)).toBe(true);
    expect(profiles.every((profile, index) => index === 0 || profile.period < profiles[index - 1].period)).toBe(true);
    const colors = modes.map((_, index) => effortColorsForLevels(modes, index).base);
    expect(new Set(colors).size).toBe(modes.length);
  });
});
