import { memo, useState, type ReactNode } from "react";
import { m } from "motion/react";
import type { DisplayMessage, Part, PiMessage, Tool } from "../../lib/protocol";
import { formatTranscriptError } from "../../lib/protocol";
import { ProcessingPanel, Thinking } from "../RichMessage";
import { ToolActivityGroup, ToolCall } from "../ai-elements/tool-call";
import { Message, MessageContent, MessageResponse } from "../ai-elements/message";
import { Button } from "../UI";
import { Icon } from "../Icon";

const turnTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

type PartViewProps = {
  part: Part;
  tools: Record<string, Tool>;
  running: boolean;
  thinking: boolean;
  collapse?: boolean;
};

function TextPart({ part, running, collapse }: PartViewProps) {
  if (!part.text) return null;
  return <MessageResponse animated={running} collapse={collapse}>{part.text}</MessageResponse>;
}

function ThinkingPart({ part, thinking }: PartViewProps) {
  const active = thinking && !part.thinkingComplete;
  if (!part.thinking?.trim() && !active) return null;
  return <Thinking text={part.thinking ?? ""} running={active} />;
}

function ToolPart({ part, tools }: PartViewProps) {
  const tool = tools[part.id ?? ""];
  const result = tool?.result;
  return <ToolCall
    toolName={part.name ?? tool?.name ?? "工具"}
    request={part.argsText ?? JSON.stringify(part.arguments ?? {})}
    result={result === undefined ? "" : typeof result === "string" ? result : JSON.stringify(result)}
    usage={tool?.usage}
    running={tool?.running ?? false}
  />;
}

function PartView(props: PartViewProps) {
  if (props.part.type === "text") return <TextPart {...props} />;
  if (props.part.type === "thinking") return <ThinkingPart {...props} />;
  if (props.part.type === "image") return <img className="message-image" src={`data:${props.part.mimeType};base64,${props.part.data}`} alt="会话附件" />;
  if (props.part.type === "toolCall") return <ToolPart {...props} />;
  return null;
}

function BashExecution({ message }: { message: PiMessage }) {
  const status = message.cancelled ? "已取消" : message.exitCode === 0 ? "完成" : message.exitCode == null ? "运行中" : `退出 ${message.exitCode}`;
  return <div className="bash-execution-card"><div className="bash-execution-heading"><span>Bash</span><code>{message.command ?? ""}</code><small>{status}</small></div><pre>{message.output ?? ""}</pre>{message.truncated && message.fullOutputPath && <small className="metric-note">完整输出：{message.fullOutputPath}</small>}</div>;
}

export function ErrorOutput({ error }: { error: string }) {
  return <div className="transcript-error" role="alert"><Icon name="warning-circle" /><p><strong>请求未完成</strong><span> · {formatTranscriptError(error)}</span></p></div>;
}

function turnTime(items: DisplayMessage[]) {
  const timestamp = [...items].reverse().find(entry => typeof entry.message.timestamp === "number")?.message.timestamp;
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return { dateTime: date.toISOString(), label: turnTimeFormatter.format(date) };
}

function MessageCopyFooter({ text, time, copied, onCopied }: {
  text: string;
  time: { dateTime: string; label: string } | null;
  copied: boolean;
  onCopied: () => void;
}) {
  return <footer className="message-response-footer">
    {time && <time dateTime={time.dateTime}>{time.label}</time>}
    <Button type="button" variant="ghost" size="icon-lg" className="message-response-copy" aria-label={copied ? "已复制" : "复制消息"} title={copied ? "已复制" : "复制消息"} onClick={() => { void navigator.clipboard.writeText(text).then(onCopied).catch(() => undefined); }}><Icon name={copied ? "check" : "copy"} className="size-5" /></Button>
  </footer>;
}

type TranscriptMessageProps = {
  items: DisplayMessage[];
  tools: Record<string, Tool>;
  streaming: boolean;
  thinking: boolean;
  savedDuration?: number;
};

type ProjectedPart = { part: Part; key: string; active: boolean };

function projectParts(items: DisplayMessage[], streaming: boolean): ProjectedPart[] {
  return items.flatMap((entry, itemIndex) => {
    const parts = Array.isArray(entry.message.content) ? entry.message.content : [{ type: "text", text: entry.message.content ?? "" }];
    return parts.map((part, partIndex) => ({ part: part as Part, key: `${entry.id}-${partIndex}`, active: streaming && itemIndex === items.length - 1 }));
  });
}

function specialMessage(item: DisplayMessage) {
  if (item.message.role === "bashExecution") return <m.div className="transcript-message assistant"><BashExecution message={item.message} /></m.div>;
  if (item.message.role !== "compactionSummary") return null;
  const summary = item.message.summary || (typeof item.message.content === "string" ? item.message.content : "");
  return <m.div className="transcript-message assistant" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16 }}><div className="transcript-compaction"><div className="transcript-compaction-heading"><Icon name="arrows-clockwise" /><span>上下文已压缩</span></div>{summary.trim() ? <pre>{summary.trim()}</pre> : null}</div></m.div>;
}

function buildNodes(content: ProjectedPart[], item: DisplayMessage, tools: Record<string, Tool>, streaming: boolean, thinking: boolean, role: "user" | "assistant") {
  const thinkingParts = content.filter(({ part }) => part.type === "thinking" && (part.thinking?.trim() || (thinking && !part.thinkingComplete)));
  const toolCalls = content.filter(({ part }) => part.type === "toolCall");
  const progress: ReactNode[] = [];
  const media: ReactNode[] = [];
  const body: ReactNode[] = [];
  const latestThinking = thinkingParts.at(-1);
  if (latestThinking) progress.push(<Thinking key={`${item.id}-reasoning`} text={latestThinking.part.thinking ?? ""} running={streaming} />);
  if (toolCalls.length) progress.push(<ToolActivityGroup key={`${item.id}-tools`} toolNames={toolCalls.map(({ part }) => part.name ?? tools[part.id ?? ""]?.name ?? "工具")} running={streaming || toolCalls.some(({ part }) => tools[part.id ?? ""]?.running)}>{toolCalls.map(({ part, key, active }) => <PartView key={key} part={part} tools={tools} running={active} thinking={false} />)}</ToolActivityGroup>);
  for (const projected of content) {
    const { part, key, active } = projected;
    if (part.type === "thinking" || part.type === "toolCall" || (part.type === "text" && !part.text)) continue;
    const node = <PartView key={key} part={part} tools={tools} running={active} thinking={false} collapse={role === "user"} />;
    if (role === "user" && part.type === "image") media.push(node);
    else body.push(node);
  }
  return { progress, media, body };
}

function TranscriptMessageComponent({ items, tools, streaming, thinking, savedDuration }: TranscriptMessageProps) {
  const item = items[0];
  const role = item.message.role === "user" ? "user" : "assistant";
  const [copied, setCopied] = useState(false);
  const special = specialMessage(item);
  if (special) return special;
  const content = projectParts(items, streaming);
  const responseText = content.flatMap(({ part }) => part.type === "text" && part.text?.trim() ? [part.text] : []).join("\n\n");
  const nodes = buildNodes(content, item, tools, streaming, thinking, role);
  if (nodes.progress.length === 0 && nodes.body.length === 0 && nodes.media.length === 0) return null;
  const startedAt = items.find(entry => entry.startedAt !== undefined)?.startedAt;
  const elapsedMs = [...items].reverse().find(entry => entry.elapsedMs !== undefined)?.elapsedMs ?? savedDuration;
  return <m.div className={`transcript-message ${role}`} initial={streaming ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16 }}>
    <Message from={role}>
      {nodes.media.length > 0 && <div className="user-message-media">{nodes.media}</div>}
      {(nodes.progress.length > 0 || nodes.body.length > 0) && <MessageContent>
        {nodes.progress.length > 0 && <ProcessingPanel key={`${item.id}-${streaming ? "running" : "complete"}`} running={streaming} startedAt={startedAt} durationMs={elapsedMs}>{nodes.progress}</ProcessingPanel>}
        {nodes.body}
      </MessageContent>}
      {role === "user" && responseText && <MessageCopyFooter text={responseText} time={turnTime(items)} copied={copied} onCopied={() => { setCopied(true); window.setTimeout(() => setCopied(false), 1600); }} />}
    </Message>
  </m.div>;
}

export const TranscriptMessage = memo(TranscriptMessageComponent, (previous, next) => {
  if (previous.streaming !== next.streaming || previous.thinking !== next.thinking || previous.savedDuration !== next.savedDuration || previous.items.length !== next.items.length || previous.items.some((item, index) => item !== next.items[index])) return false;
  const content = previous.items.flatMap(item => Array.isArray(item.message.content) ? item.message.content : []);
  return content.every(part => part.type !== "toolCall" || previous.tools[part.id ?? ""] === next.tools[part.id ?? ""]);
});
