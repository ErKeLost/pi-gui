import { describe, expect, test } from "bun:test";
import { compactTitle, sessionGlyph } from "../src/lib/session-visual";
import { modelFamily } from "../src/lib/model-meta";

describe("sessionGlyph", () => {
  test("uses persisted agent metadata when the icon is bundled", () => {
    expect(sessionGlyph("image-square")).toBe("image-square");
    expect(sessionGlyph("code")).toBe("code");
  });

  test("compacts first-message titles for the header", () => {
    expect(compactTitle("  还有一个\n你看看这个是 我用户的 也是可以支持 user message 气泡  ")).toBe(
      "还有一个 你看看这个是 我用户的 也是可以支持…",
    );
    expect(compactTitle("设置")).toBe("设置");
    expect(compactTitle("   ")).toBe("新会话");
  });

  test("falls back to one default for missing or invalid metadata", () => {
    expect(sessionGlyph()).toBe("chat-teardrop-text");
    expect(sessionGlyph("not-a-bundled-icon")).toBe("chat-teardrop-text");
  });
});

describe("modelFamily", () => {
  test("uses the same model mapping as the rendered model icon", () => {
    expect(modelFamily("claude-opus-5")).toBe("Claude");
    expect(modelFamily("gpt-5.6-sol")).toBe("OpenAI");
    expect(modelFamily("glm-5.3-flash")).toBe("GLM");
    expect(modelFamily("kimi-k2.7-code")).toBe("Kimi");
  });
});
