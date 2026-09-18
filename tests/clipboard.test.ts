import { describe, expect, test } from "bun:test";
import { normalizeSelectionText } from "../src/lib/clipboard";

describe("chat selection clipboard", () => {
  test("copies text without layout-only blank lines or trailing whitespace", () => {
    expect(normalizeSelectionText("标题  \n\n\n第一段\t\n   \n第二段\n")).toBe("标题\n第一段\n第二段");
  });

  test("keeps meaningful indentation while removing empty lines", () => {
    expect(normalizeSelectionText("\nconst value = {\n  nested: true,\n\n};\n")).toBe("const value = {\n  nested: true,\n};");
  });
});
