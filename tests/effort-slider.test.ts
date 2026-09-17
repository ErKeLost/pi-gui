import { describe, expect, test } from "bun:test";
import { effortFieldMode, effortVisualPosition, effortVisualSlot } from "../src/components/chat/effort-slider-model";

describe("effort slider visual semantics", () => {
  test("does not treat the final available level as Max", () => {
    expect(effortVisualSlot("low")).toBe(1);
    expect(effortFieldMode("low")).toBeNull();
  });

  test("maps Pi thinking levels onto the original six visual stages", () => {
    expect(["off", "minimal", "low", "medium", "high", "xhigh", "max"].map(level => effortVisualSlot(level))).toEqual([0, 1, 1, 2, 3, 4, 5]);
    expect(effortFieldMode("high")).toBe("high");
    expect(effortFieldMode("xhigh")).toBe("extra");
    expect(effortFieldMode("max")).toBe("max");
  });

  test("gives Pi's extra minimal level its own interpolated color position", () => {
    expect(effortVisualPosition("off")).toBe(0);
    expect(effortVisualPosition("minimal")).toBe(0.5);
    expect(effortVisualPosition("low")).toBe(1);
  });
});
