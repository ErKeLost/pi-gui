import { memo, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, m } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useWorkspace } from "../lib/store";
import {
  persistDefaultModel,
  request,
  report,
  stop,
} from "../lib/rpc";
import type { Model, Part, DisplayMessage, Tool, PiMessage } from "../lib/protocol";
import { Icon } from "./Icon";
import { Button, Skeleton } from "./UI";
import { Thinking } from "./RichMessage";
import { Beam } from "./Effects";
import { ToolActivityGroup, ToolCall } from "./ai-elements/tool-call";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  useConversationScroll,
} from "./ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "./ai-elements/message";
import {
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
  type PromptInputMessage,
} from "./ai-elements/prompt-input";
import LoadingState from "./ai-elements/loading-state";
import { modelLabel } from "../lib/model-meta";
import { ModelLogo } from "./ModelMeta";

type Attachment = { name: string; data: string; mimeType: string };
const composerCache = new Map<
  string,
  { text: string; attachments: Attachment[] }
>();
function composerModelLabel(id: string, fallback?: string) {
  return modelLabel(id, fallback)
    .replace(/^gpt-/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}
function effortLabel(level?: string) {
  if (!level || level === "off") return "Off";
  return level === "xhigh" ? "XHigh" : level.charAt(0).toUpperCase() + level.slice(1);
}
function imageAttachments(files: Iterable<File>) {
  return Promise.all(
    Array.from(files).flatMap((file) => file.type.startsWith("image/") ? [
          new Promise<Attachment>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve({
                name: file.name || "粘贴的图片",
                data: String(reader.result).split(",")[1],
                mimeType: file.type,
              });
            reader.onerror = reject;
            reader.readAsDataURL(file);
          }),
        ] : []),
  );
}
function PartView({
  part,
  tools,
  running,
  thinking,
}: {
  part: Part;
  tools: Record<string, Tool>;
  running: boolean;
  thinking: boolean;
}) {
  if (part.type === "text")
    return (
      <MessageResponse animated={running}>{part.text ?? ""}</MessageResponse>
    );
  if (part.type === "thinking")
    return <Thinking text={part.thinking ?? ""} running={thinking && !part.thinkingComplete} />;
  if (part.type === "image")
    return (
      <img
        className="message-image"
        src={`data:${part.mimeType};base64,${part.data}`}
        alt="会话附件"
      />
    );
  if (part.type === "toolCall") {
    const tool = tools[part.id ?? ""];
    const result = tool?.result;
    return (
      <ToolCall
        toolName={part.name ?? tool?.name ?? "工具"}
        request={part.argsText ?? JSON.stringify(part.arguments ?? {})}
        result={
          result === undefined
            ? ""
            : typeof result === "string"
              ? result
              : JSON.stringify(result)
        }
        usage={tool?.usage}
        running={tool?.running ?? false}
      />
    );
  }
  return null;
}
function BashExecutionView({message}:{message:PiMessage}) {
  return <div className="bash-execution-card"><div className="bash-execution-heading"><span>Bash</span><code>{message.command ?? ""}</code><small>{message.cancelled ? "已取消" : message.exitCode === 0 ? "完成" : message.exitCode == null ? "运行中" : `退出 ${message.exitCode}`}</small></div><pre>{message.output ?? ""}</pre>{message.truncated && message.fullOutputPath && <small className="metric-note">完整输出：{message.fullOutputPath}</small>}</div>
}
const TranscriptMessage = memo(
  function TranscriptMessage({
    item,
    tools,
    streaming,
    thinking,
  }: {
    item: DisplayMessage;
    tools: Record<string, Tool>;
    streaming: boolean;
    thinking: boolean;
  }) {
    const role = item.message.role === "user" ? "user" : "assistant";
    if (item.message.role === "bashExecution") return <m.div className="transcript-message assistant"><BashExecutionView message={item.message} /></m.div>;
    const content = Array.isArray(item.message.content)
      ? item.message.content
      : [{ type: "text", text: item.message.content ?? "" }];
    const contentNodes: ReactNode[] = [];
    for (let index = 0; index < content.length; index += 1) {
      const part = content[index] as Part;
      if (part.type !== "toolCall") {
        contentNodes.push(
          <PartView
            key={item.id + "-" + index}
            part={part}
            tools={tools}
            running={streaming}
            thinking={thinking && index === content.length - 1}
          />,
        );
        continue;
      }
      const calls: Part[] = [];
      while (index < content.length && content[index]?.type === "toolCall") {
        calls.push(content[index] as Part);
        index += 1;
      }
      index -= 1;
      contentNodes.push(
        <ToolActivityGroup
          key={item.id + "-" + index}
          toolNames={calls.map(call => call.name ?? tools[call.id ?? ""]?.name ?? "工具")}
          running={calls.some(call => tools[call.id ?? ""]?.running)}
        >
          {calls.map((call, callIndex) => (
            <PartView
              key={item.id + "-" + (index + callIndex)}
              part={call}
              tools={tools}
              running={streaming}
              thinking={false}
            />
          ))}
        </ToolActivityGroup>,
      );
    }
    return (
      <m.div
        className={`transcript-message ${role}`}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.16 }}
      >
        <Message from={role}>
          <MessageContent>
            {contentNodes}
          </MessageContent>
        </Message>
      </m.div>
    );
  },
  (previous, next) => {
    if (
      previous.item !== next.item ||
      previous.streaming !== next.streaming ||
      previous.thinking !== next.thinking
    )
      return false;
    const content = Array.isArray(previous.item.message.content)
      ? previous.item.message.content
      : [];
    return content.every(
      (part) =>
        part.type !== "toolCall" ||
        previous.tools[part.id ?? ""] === next.tools[part.id ?? ""],
    );
  },
);
export function Chat() {
  const project = useWorkspace((s) => s.cwd),
    transcript = useWorkspace((s) => s.transcript),
    telemetry = useWorkspace((s) => s.telemetry),
    online = useWorkspace((s) => s.connection === "online"),
    state = useWorkspace((s) => s.state);
  const [attachments, setAttachments] = useState<Attachment[]>(
      () => composerCache.get(project)?.attachments ?? [],
    ),
    [draft, setDraft] = useState(() => composerCache.get(project)?.text ?? ""),
    [modelMenuOpen, setModelMenuOpen] = useState(false),
    [modelSearch, setModelSearch] = useState(""),
    deliveryOverride = useRef<"steer" | "followUp" | null>(null),
    fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const pasteImage = (event: ClipboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const files = Array.from(event.clipboardData?.files ?? []).filter(
        (file) => file.type.startsWith("image/"),
      );
      if (!target?.closest(".composer") || files.length === 0) return;
      event.preventDefault();
      void imageAttachments(files)
        .then((next) => setAttachments((current) => [...current, ...next]))
        .catch(report);
    };
    window.addEventListener("paste", pasteImage);
    return () => window.removeEventListener("paste", pasteImage);
  }, []);
  const { ref, atBottom, scrollToBottom } = useConversationScroll();
  const models = useQuery({
    queryKey: ["pi", "models", project],
    queryFn: () =>
      request<{ models: Model[] }>(
        { type: "get_available_models" },
        30000,
        project,
      ),
    enabled: online,
  });
  const levels = useQuery({
    queryKey: ["pi", "levels", project, state?.model?.id],
    queryFn: () =>
      request<{ levels: string[] }>(
        { type: "get_available_thinking_levels" },
        30000,
        project,
      ),
    enabled: online,
  });
  const activeProvider = state?.model?.provider;
  const availableLevels = levels.data?.levels ?? [];
  const hasEffort = availableLevels.some((level) => level !== "off");
  const activeMessage = transcript.messages[transcript.active]?.message;
  const activeHasOutput = Boolean(
    Array.isArray(activeMessage?.content)
      ? activeMessage.content.some(part =>
          part.type === "toolCall" ||
          part.type === "image" ||
          Boolean(part.text?.trim()) ||
          Boolean(part.thinking?.trim()),
        )
      : typeof activeMessage?.content === "string" && activeMessage.content.trim(),
  ) || Object.values(transcript.tools).some(tool => tool.running);
  const configuredModels = activeProvider
    ? (models.data?.models ?? []).filter((model) => model.provider === activeProvider)
    : [];
  const modelQuery = modelSearch.trim().toLowerCase();
  const visibleModels = modelQuery ? configuredModels.filter((model) => `${model.name} ${model.id}`.toLowerCase().includes(modelQuery)) : configuredModels;
  const effortIndex = Math.max(0, availableLevels.indexOf(state?.thinkingLevel ?? "off"));
  const effortProgress = availableLevels.length > 1 ? effortIndex / (availableLevels.length - 1) * 100 : 0;
  const retry = telemetry.retry;
  const retrying = retry?.status === "waiting" || retry?.status === "running";
  const retryDetail = retrying && retry
    ? `第 ${Number.isFinite(retry.attempt) ? retry.attempt : "?"}${retry.maxAttempts && Number.isFinite(retry.maxAttempts) ? ` / ${retry.maxAttempts}` : ""} 次${retry.delayMs && Number.isFinite(retry.delayMs) ? ` · 等待 ${retry.delayMs} ms` : ""} · ${retry.error || "原因未提供"}`
    : undefined;
  useEffect(() => {
    const timer = setTimeout(
      () =>
        composerCache.set(project, {
          text: composerCache.get(project)?.text ?? "",
          attachments,
        }),
      0,
    );
    return () => clearTimeout(timer);
  }, [attachments, project]);
  useEffect(() => { composerCache.set(project, {text: draft, attachments: composerCache.get(project)?.attachments ?? attachments}); }, [draft, attachments, project]);
  async function submit(message: PromptInputMessage) {
    const streamingBehavior = deliveryOverride.current ?? "steer";
    deliveryOverride.current = null;
    try {
      await request(
        {
          type: "prompt",
          message: message.text,
          images: attachments.map((a) => ({
            type: "image" as const,
            data: a.data,
            mimeType: a.mimeType,
          })),
          ...(transcript.running ? { streamingBehavior } : {}),
        },
        45000,
        project,
      );
      setAttachments([]);
      setDraft("");
      scrollToBottom();
    } catch (error) {
      report(error);
    }
  }
  async function choose(command: Parameters<typeof request>[0]) {
    try {
      await request(command, 30000, project);
      const next = await request<typeof state>(
        { type: "get_state" },
        30000,
        project,
      );
      if (command.type === "set_model") {
        if (next?.model?.provider !== command.provider || next.model.id !== command.modelId) throw new Error("Pi 没有确认模型切换");
        await persistDefaultModel(command.provider, command.modelId);
      }
      useWorkspace.getState().set({ state: next });
    } catch (error) {
      report(error);
    }
  }
  return (
    <div className="chat-root tessera-thread-root">
      <Conversation
        ref={ref}
        className="chat-conversation tessera-conversation"
      >
        <ConversationContent className="tessera-conversation-content">
          {transcript.messages.length === 0 ? null : (
            transcript.messages.map((item, index) => (
              <TranscriptMessage
                key={item.id}
                item={item}
                tools={transcript.tools}
                streaming={transcript.running && index === transcript.active}
                thinking={transcript.running && index === transcript.active && !item.message.stopReason}
              />
            ))
          )}
          {transcript.running && !activeHasOutput && (
            <LoadingState className="chat-loading-state" label={transcript.phase || "正在处理"} detail={retryDetail} />
          )}
        </ConversationContent>
        {!atBottom && <ConversationScrollButton onClick={scrollToBottom} />}
      </Conversation>
      <div className="composer-container tessera-composer-dock">
        <div className="tessera-composer-form">
          <Beam className="studio-composer-beam" borderRadius={24} active={transcript.running}>
                <PromptInput
                  onSubmit={(message) => void submit(message)}
                  className="composer studio-composer"
                  allowEmpty={attachments.length > 0}
                >
                <AnimatePresence>
                  {attachments.length > 0 && (
                    <m.div className="attachments" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                      {attachments.map((a) => (
                        <div className="attachment-preview" key={`${a.name}-${a.data.slice(0, 16)}`}>
                          <img src={`data:${a.mimeType};base64,${a.data}`} alt={a.name} />
                          <Button className="attachment-remove" title={`移除 ${a.name}`} aria-label={`移除 ${a.name}`} onClick={() => setAttachments((current) => current.filter((item) => item !== a))}>
                            <Icon name="x" />
                          </Button>
                        </div>
                      ))}
                    </m.div>
                  )}
                </AnimatePresence>
                <PromptInputTextarea
                  placeholder="输入消息，发送给助手…"
                  value={draft}
                  onChange={event => setDraft(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                      deliveryOverride.current = event.altKey ? "followUp" : "steer";
                    }
                  }}
                />
                <div className="composer-bottom">
                  <input
                    type="file"
                    multiple
                    accept="image/*"
                    hidden
                    ref={fileInput}
                    onChange={(event) => {
                      const files = event.target.files;
                      if (files)
                        void imageAttachments(files)
                          .then((next) => setAttachments((current) => [...current, ...next]))
                          .catch(report);
                      event.target.value = "";
                    }}
                  />
                  <div className="composer-tool-cluster">
                    <Button
                      variant="ghost"
                      className="size-8 rounded-full p-0 text-muted-foreground hover:text-foreground hover:bg-accent"
                      aria-label="上传附件"
                      title="上传图片"
                      onClick={() => fileInput.current?.click()}
                    >
                      <Icon name="plus" className="size-4" />
                    </Button>
                  </div>
                  <div className="composer-selectors">
                    {models.isLoading ? (
                      <span className="studio-model-loading" aria-busy="true">
                        <Skeleton className="studio-model-loading-icon" />
                        <Skeleton className="studio-model-loading-label" />
                      </span>
                    ) : (
                      <Popover open={modelMenuOpen} onOpenChange={(open) => {setModelMenuOpen(open);if(!open)setModelSearch("")}}>
                        <PopoverTrigger
                          render={<button type="button" className="composer-model-control" disabled={!online || transcript.running} aria-label="选择模型和思考强度" />}
                        >
                          {state?.model && <ModelLogo modelId={state.model.id} size={18} />}
                          <span>{state?.model ? composerModelLabel(state.model.id, state.model.name) : "选择模型"}</span>
                          {hasEffort && <><i aria-hidden>·</i><small>{effortLabel(state?.thinkingLevel)}</small></>}
                          <Icon name="caret-down" />
                        </PopoverTrigger>
                        <PopoverContent side="top" align="start" sideOffset={10} className="composer-model-menu">
                          {hasEffort && <section className="composer-effort-tuner">
                            <div><span>Effort</span><strong>{effortLabel(state?.thinkingLevel)}</strong></div>
                            <input
                              type="range"
                              min={0}
                              max={availableLevels.length - 1}
                              step={1}
                              value={effortIndex}
                              aria-label="思考强度"
                              style={{"--effort-progress":`${effortProgress}%`} as CSSProperties}
                              onChange={(event) => {const level=availableLevels[Number(event.target.value)];if(level)void choose({type:"set_thinking_level",level:level as "high"})}}
                            />
                            <div className="composer-effort-scale"><span>{effortLabel(availableLevels[0])}</span><span>{effortLabel(availableLevels.at(-1))}</span></div>
                          </section>}
                          <section className="composer-model-picker">
                            <label className="composer-model-search"><Icon name="magnifying-glass"/><input value={modelSearch} onChange={(event)=>setModelSearch(event.target.value)} placeholder="搜索模型" /></label>
                            <div className="composer-model-options">
                              {visibleModels.map((model) => {
                                const active = state?.model?.provider === model.provider && state.model.id === model.id;
                                return <button type="button" className={active ? "active" : ""} aria-pressed={active} key={`${model.provider}/${model.id}`} onClick={() => void choose({type:"set_model",provider:model.provider,modelId:model.id})}>
                                  <ModelLogo modelId={model.id} size={18} />
                                  <span>{composerModelLabel(model.id, model.name)}</span>
                                </button>;
                              })}
                              {visibleModels.length === 0 && <p className="composer-model-empty">没有匹配的模型</p>}
                            </div>
                          </section>
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>
                  {(transcript.queue.steering.length > 0 || transcript.queue.followUp.length > 0) && (
                    <span className="composer-queue-status" aria-live="polite">
                      已排队 {transcript.queue.steering.length + transcript.queue.followUp.length}
                    </span>
                  )}
                  <PromptInputSubmit
                    status={transcript.running ? "streaming" : "ready"}
                    disabled={!online}
                    title={transcript.running ? "暂停生成" : "发送消息"}
                    aria-label={transcript.running ? "暂停生成" : "发送消息"}
                    onClick={transcript.running ? () => void stop().catch(report) : undefined}
                  />
                </div>
                </PromptInput>
          </Beam>
        </div>
      </div>
    </div>
  );
}
