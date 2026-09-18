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
    expect(html).toContain('data-slot="message-actions"');
    expect(html).toContain("<time");
    expect(html).not.toContain('aria-label="分支到新聊天"');
  });

  test("renders registry message actions for assistant replies without a timestamp", () => {
    const html = render({ role: "assistant", content: "你好，有什么可以帮你的？", timestamp: Date.UTC(2026, 8, 17, 6, 0) });
    expect(html).toContain('data-slot="message-actions"');
    expect(html).toContain('aria-label="复制消息"');
    expect(html).not.toContain("<time");
    expect(html).toContain('aria-label="分支到新聊天"');
    expect(html).not.toContain("select-none");
  });

  test("does not turn transient provider errors into transcript cards", () => {
    const html = render({ role: "assistant", content: [], errorMessage: "Our servers are currently overloaded." });
    expect(html).not.toContain("transcript-error");
    expect(html).not.toContain("会话异常");
  });
});

const phases: DisplayMessage[] = [
  { id: "first", message: { role: "assistant", stopReason: "toolUse", content: [
    { type: "thinking", thinking: "第一轮思考", thinkingComplete: true },
    { type: "text", text: "先检查实现" },
    { type: "toolCall", id: "read", name: "read", arguments: { path: "src/app.ts" } },
  ] } },
  { id: "second", message: { role: "assistant", stopReason: "toolUse", content: [
    { type: "thinking", thinking: "第二轮思考", thinkingComplete: true },
    { type: "text", text: "现在运行验证" },
    { type: "toolCall", id: "test", name: "bash", arguments: { command: "bun test" } },
  ] } },
  { id: "final", message: { role: "assistant", stopReason: "stop", content: [
    { type: "thinking", thinking: "准备总结", thinkingComplete: true },
    { type: "text", text: "最终结果：已完成" },
  ] } },
];

function readableMarkup(html: string) {
  return html.replace(/<span\b[^>]*>/g, "").replace(/<\/span>/g, "");
}

function renderPhases(streaming = false, items = phases) {
  return renderToStaticMarkup(<TranscriptMessage items={items} tools={{
    read: { name: "read", running: false, result: "source" },
    test: { name: "bash", running: false, result: "passed" },
  }} streaming={streaming} thinking={false} savedDuration={33000} />);
}

describe("whole-turn process history", () => {
  test("preserves every phase in order and collapses only the process after completion", () => {
    const html = readableMarkup(renderPhases());
    expect(html).toContain('class="turn-activity" data-open="false"');
    expect(html).toContain("33秒");
    const ordered = ["第一轮思考", "先检查实现", "src/app.ts", "第二轮思考", "现在运行验证", "bun test", "准备总结", "最终结果：已完成"];
    for (let i = 1; i < ordered.length; i++) {
      expect(html.indexOf(ordered[i])).toBeGreaterThan(html.indexOf(ordered[i - 1]));
    }
    const panelEnd = html.indexOf('</section>', html.indexOf('准备总结'));
    expect(html.indexOf('最终结果：已完成')).toBeGreaterThan(panelEnd);
    expect(html.match(/class="turn-activity"/g)?.length).toBe(1);
  });

  test("shows the complete timeline while streaming", () => {
    const html = readableMarkup(renderPhases(true));
    expect(html).toContain('class="turn-activity" data-open="true" data-working="true"');
    expect(html).not.toContain('</section><section class="message-response-disclosure"');
    expect(html).toContain('最终结果：已完成');
    expect(html.indexOf('第一轮思考')).toBeLessThan(html.indexOf('第二轮思考'));
  });

  test("keeps interrupted, failed and tool-only runs expanded", () => {
    for (const stopReason of ["aborted", "error", "toolUse"]) {
      const items = [...phases.slice(0, -1), { ...phases[2], message: { ...phases[2].message, stopReason } }];
      const html = renderPhases(false, items);
      expect(html).toContain('class="turn-activity" data-open="true"');
    }
    expect(renderPhases(false, phases.slice(0, 2))).toContain('class="turn-activity" data-open="true"');
  });

  test("does not hide a plain final answer in an empty process disclosure", () => {
    const html = render({ role: "assistant", content: "直接回复", stopReason: "stop" });
    expect(html).not.toContain('class="turn-activity"');
    expect(readableMarkup(html)).toContain("直接回复");
  });

  test("places child-agent activity after the spawn tool and before later parent work", () => {
    const items: DisplayMessage[] = [
      { id: "spawn", message: { role: "assistant", stopReason: "toolUse", content: [
        { type: "text", text: "准备启动子任务" },
        { type: "toolCall", id: "spawn-agent", name: "spawn_agent", arguments: { task_name: "repo", message: "inspect" } },
      ] } },
      { id: "continue", message: { role: "assistant", stopReason: "toolUse", content: [
        { type: "text", text: "父任务继续读取" },
        { type: "toolCall", id: "read-after", name: "read", arguments: { path: "README.md" } },
      ] } },
    ];
    const html = readableMarkup(renderToStaticMarkup(<TranscriptMessage items={items} tools={{
      "spawn-agent": { name: "spawn_agent", running: false, result: "started" },
      "read-after": { name: "read", running: true },
    }} streaming thinking={false} activity={<div>子 agent timeline</div>} />));

    expect(html.indexOf("准备启动子任务")).toBeLessThan(html.indexOf("子 agent timeline"));
    expect(html.indexOf("子 agent timeline")).toBeLessThan(html.indexOf("父任务继续读取"));
  });
});
