import { describe, expect, test } from "bun:test";
import { findBranchEntry, type BranchEntry } from "../src/lib/session-branch";
import type { PiMessage } from "../src/lib/protocol";

const answer: PiMessage = { role: "assistant", timestamp: 12, content: [{ type: "thinking", thinking: "检查" }, { type: "text", text: "完成" }] };
const entries: BranchEntry[] = [
  { id: "user", parentId: null, type: "message", message: { role: "user", content: "修复" } },
  { id: "answer", parentId: "user", type: "message", message: answer },
  { id: "label", parentId: "answer", type: "label" },
  { id: "later", parentId: "label", type: "message", message: { role: "assistant", timestamp: 13, content: "后来" } },
  { id: "other-branch", parentId: "user", type: "message", message: answer },
];

describe("message branch target", () => {
  test("resolves historical replies only on the active ancestry", () => {
    expect(findBranchEntry(entries, "later", answer)).toBe("answer");
    expect(findBranchEntry(entries, "other-branch", answer)).toBe("other-branch");
  });
  test("ignores UI-only thinking completion metadata", () => {
    const projected = { ...answer, content: [{ type: "thinking", thinking: "检查", thinkingComplete: true }, { type: "text", text: "完成" }] };
    expect(findBranchEntry(entries, "later", projected)).toBe("answer");
  });
  test("rejects missing and ambiguous targets instead of branching from a different reply", () => {
    expect(() => findBranchEntry(entries, "user", answer)).toThrow("无法准确定位");
    const duplicate = { id: "duplicate", parentId: "answer", type: "message", message: answer };
    expect(() => findBranchEntry([...entries, duplicate], "duplicate", answer)).toThrow("无法准确定位");
  });
  test("matches normalized text messages and stops at broken ancestry", () => {
    expect(findBranchEntry(entries, "later", { role: "assistant", timestamp: 13, content: [{ type: "text", text: "后来" }] })).toBe("later");
    expect(() => findBranchEntry(entries, "missing", answer)).toThrow();
  });
});
