import { describe, expect, test } from "bun:test";
import { contextSegments, estimateTokensFromChars } from "../src/lib/context-breakdown";

describe("context usage segments", () => {
  test("splits the provider total into tools and messages", () => {
    const segments = contextSegments({ toolChars: 80 }, 1000);
    expect(segments.map(segment => segment.label)).toEqual([
      "Tools",
      "Messages & prompt",
    ]);
    expect(segments.map(segment => segment.color)).toEqual(["#9d94c7", "#c98b86"]);
    expect(segments.map(segment => segment.tokens)).toEqual([20, 980]);
    expect(segments.reduce((total, segment) => total + segment.tokens, 0)).toBe(1000);
  });

  test("uses pi's chars/4 estimate and leaves messages empty before usage exists", () => {
    expect(estimateTokensFromChars(7)).toBe(2);
    const waiting = contextSegments({ toolChars: 4 }, null);
    expect(waiting.find(segment => segment.id === "tools")?.tokens).toBe(1);
    expect(waiting.find(segment => segment.id === "messages")?.tokens).toBe(0);
  });

  test("never lets an estimated tool schema exceed the provider total", () => {
    expect(contextSegments({ toolChars: 400 }, 50).map(segment => segment.tokens)).toEqual([50, 0]);
  });
});
