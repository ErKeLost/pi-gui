import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TranscriptMessage } from "../src/components/chat/TranscriptMessage";
import type { DisplayMessage } from "../src/lib/protocol";

function render(message: DisplayMessage["message"]) {
  return renderToStaticMarkup(
    <TranscriptMessage
      items={[{ id: "message", message }]}
      tools={{}}
      streaming={false}
      thinking={false}
    />,
  );
}

describe("transcript message actions", () => {
  test("places the user timestamp and copy action below the message bubble", () => {
    const html = render({ role: "user", content: "你好", timestamp: Date.UTC(2026, 8, 17, 6, 0) });
    expect(html.indexOf("ai-message-content")).toBeGreaterThan(-1);
    expect(html.indexOf("message-response-footer")).toBeGreaterThan(html.indexOf("ai-message-content"));
  });

  test("does not render timestamp or copy actions for assistant replies", () => {
    const html = render({ role: "assistant", content: "你好，有什么可以帮你的？", timestamp: Date.UTC(2026, 8, 17, 6, 0) });
    expect(html).not.toContain("message-response-footer");
  });

  test("does not turn transient provider errors into transcript cards", () => {
    const html = render({ role: "assistant", content: [], errorMessage: "Our servers are currently overloaded." });
    expect(html).not.toContain("transcript-error");
    expect(html).not.toContain("会话异常");
  });
});
