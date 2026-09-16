import { describe, expect, test } from "bun:test";
import { COLLAPSED_MESSAGE_LINES, estimateMarkdownLines, markdownHeadingSections, shouldCollapseMessage } from "../src/lib/message-layout";

describe("long assistant message disclosure", () => {
  test("keeps short replies fully visible", () => {
    expect(shouldCollapseMessage("Short answer.\n\nSecond paragraph.")).toBe(false);
  });

  test("collapses markdown that exceeds the visible line budget", () => {
    const timeline = Array.from({ length: COLLAPSED_MESSAGE_LINES + 1 }, (_, index) => `${index + 1}. [Project ${index}](https://example.com/${index})`).join("\n");
    expect(shouldCollapseMessage(timeline)).toBe(true);
  });

  test("counts wrapped text without inflating markdown link destinations", () => {
    const longLine = `[${"Visible description ".repeat(8)}](https://example.com/${"path/".repeat(40)})`;
    expect(estimateMarkdownLines(longLine)).toBeGreaterThan(1);
    expect(estimateMarkdownLines("[label](https://example.com/a/very/long/path)")).toBe(1);
  });

  test("extracts heading navigation without reading fenced code", () => {
    const sections = markdownHeadingSections("# Project\n## [Setup](https://example.com)\n```md\n### Not a heading\n```\n### Usage", "reply");
    expect(sections).toEqual([
      { id: "reply-heading-1", label: "Project", level: 1 },
      { id: "reply-heading-2", label: "Setup", level: 2 },
      { id: "reply-heading-3", label: "Usage", level: 3 },
    ]);
  });
});
