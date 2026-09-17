import { describe, expect, test } from "bun:test";
import { compactTitle, sessionGlyph } from "../src/lib/session-visual";

describe("sessionGlyph", () => {
  test("picks a content icon from the title", () => {
    expect(sessionGlyph("如何提高图片的清晰度?")).toBe("image-square");
    expect(sessionGlyph("Generate Light Theme SVG Image")).toBe("image-square");
    expect(sessionGlyph("全栈todolist网站开发请求")).toBe("list-checks");
    expect(sessionGlyph("你好")).toBe("robot");
    expect(sessionGlyph("天气应用的产品结构设计")).toBe("cloud-sun");
    expect(sessionGlyph("创建一个Landing Page")).toBe("palette");
  });

  test("compacts first-message titles for the header", () => {
    expect(compactTitle("  还有一个\n你看看这个是 我用户的 也是可以支持 user message 气泡  ")).toBe(
      "还有一个 你看看这个是 我用户的 也是可以支持…",
    );
    expect(compactTitle("设置")).toBe("设置");
    expect(compactTitle("   ")).toBe("新会话");
  });

  test("keeps unnamed sessions and unrelated titles stable", () => {
    expect(sessionGlyph("")).toBe("chat-teardrop-text");
    expect(sessionGlyph("随机标题甲")).toBe(sessionGlyph("随机标题甲"));
    expect(sessionGlyph("随机标题甲")).not.toBe(sessionGlyph("另一个完全不同的标题"));
  });
});
