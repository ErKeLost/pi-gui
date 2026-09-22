import { describe, expect, test } from "bun:test";
import { contextSegments, estimateTokensFromChars, fixedContextChars, messageChars } from "../src/lib/context-breakdown";

describe("context usage segments", () => {
  test("keeps Cursor's category order and colors", () => {
    const segments = contextSegments({
      systemChars: 40,
      toolChars: 80,
      dynamicChars: 40,
      subagentChars: 36,
      rulesChars: 60,
      skillsChars: 20,
    }, 1000);
    expect(segments.map(segment => segment.label)).toEqual([
      "System prompt",
      "Tool definitions",
      "Rules",
      "Skills",
      "MCP & dynamic tools",
      "Subagent definitions",
      "Conversation",
    ]);
    expect(segments.map(segment => segment.color)).toEqual(["#8b9099", "#9d94c7", "#7eae98", "#c4ae78", "#b48aaf", "#88a0c4", "#c98b86"]);
    expect(segments.reduce((total, segment) => total + segment.tokens, 0)).toBe(1000);
    expect(segments.at(-1)?.tokens).toBeGreaterThan(segments[0].tokens);
  });

  test("uses pi's chars/4 estimate and leaves conversation empty before usage exists", () => {
    expect(estimateTokensFromChars(7)).toBe(2);
    expect(fixedContextChars({ systemChars: 4, rulesChars: 0 }).system).toBe(4);
    const waiting = contextSegments({ systemChars: 4 }, null);
    expect(waiting.find(segment => segment.id === "system")?.tokens).toBe(1);
    expect(waiting.find(segment => segment.id === "conversation")?.tokens).toBe(0);
  });

  test("counts images and tool calls the same way pi estimates messages", () => {
    expect(messageChars({ role: "user", content: [{ type: "image" }, { type: "text", text: "hi" }] })).toBe(4802);
    expect(messageChars({ role: "assistant", content: [{ type: "toolCall", name: "read", arguments: { path: "a" } }] })).toBe(4 + JSON.stringify({ path: "a" }).length);
  });
});
