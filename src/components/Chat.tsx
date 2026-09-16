import { memo, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, m } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useWorkspace } from "../lib/store";
import {
  persistDefaultModel,
  getSessionTurnDurations,
  native,
  persistedSessionFile,
  request,
  report,
  stop,
} from "../lib/rpc";
import { formatTranscriptError, groupDisplayMessages, type Model, type Part, type DisplayMessage, type Tool, type PiMessage } from "../lib/protocol";
import { Icon } from "./Icon";
import { Button, Skeleton } from "./UI";
import { ProcessingPanel, Thinking } from "./RichMessage";
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
import ProximitySidebar, { type ProximitySection } from "./ui/proximity-sidebar";
import { modelLabel } from "../lib/model-meta";
import { ModelLogo } from "./ModelMeta";
import { readTurnDurations, saveTurnDurations, turnDurationId } from "../lib/turn-duration";

type Attachment = { name: string; data: string; mimeType: string };
const composerCache = new Map<
  string,
  { text: string; attachments: Attachment[] }
>();
function cacheComposer(project:string,value:{text:string;attachments:Attachment[]}){
  composerCache.delete(project);
  composerCache.set(project,value);
  while(composerCache.size>4)composerCache.delete(composerCache.keys().next().value!);
}
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
function messageKind(element: HTMLElement): "title" | "section" | "body" {
  if (element.closest(".transcript-message.user")) return "title";
  if (element.matches(".turn-activity, .transcript-error, .transcript-compaction, .bash-execution-card")) return "section";
  return "body";
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
  if (part.type === "text") {
    if (!part.text) return null;
    return (
      <MessageResponse animated={running}>{part.text}</MessageResponse>
    );
  }
  if (part.type === "thinking") {
    if (!part.thinking?.trim() && !(thinking && !part.thinkingComplete)) return null;
    return <Thinking text={part.thinking ?? ""} running={thinking && !part.thinkingComplete} />;
  }
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
function ErrorOutput({ error }: { error: string }) {
  return (
    <div className="transcript-error" role="alert">
      <div className="transcript-error-heading">
        <Icon name="warning-circle" />
        <span>会话异常</span>
      </div>
      <p>{formatTranscriptError(error)}</p>
    </div>
  );
}
function turnTime(items: DisplayMessage[]) {
  const timestamp = [...items].reverse().find(entry => typeof entry.message.timestamp === "number")?.message.timestamp;
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return {
    dateTime: date.toISOString(),
    label: new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false }).format(date),
  };
}
const TranscriptMessage = memo(
  function TranscriptMessage({
    items,
    tools,
    streaming,
    thinking,
    savedDuration,
  }: {
    items: DisplayMessage[];
    tools: Record<string, Tool>;
    streaming: boolean;
    thinking: boolean;
    savedDuration?: number;
  }) {
    const item = items[0];
    const role = item.message.role === "user" ? "user" : "assistant";
    const [copied, setCopied] = useState(false);
    if (item.message.role === "bashExecution") return <m.div className="transcript-message assistant"><BashExecutionView message={item.message} /></m.div>;
    if (item.message.role === "compactionSummary") {
      const summary = item.message.summary || (typeof item.message.content === "string" ? item.message.content : "");
      return <m.div className="transcript-message assistant" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16 }}><div className="transcript-compaction"><div className="transcript-compaction-heading"><Icon name="arrows-clockwise" /><span>上下文已压缩</span></div>{summary.trim() ? <pre>{summary.trim()}</pre> : null}</div></m.div>;
    }
    const content = items.flatMap((entry, itemIndex) => {
      const parts = Array.isArray(entry.message.content)
        ? entry.message.content
        : [{ type: "text", text: entry.message.content ?? "" }];
      return parts.map((part, partIndex) => ({
        part: part as Part,
        key: `${entry.id}-${partIndex}`,
        active: streaming && itemIndex === items.length - 1,
      }));
    });
    const thinkingParts = content.filter(({ part }) =>
      part.type === "thinking" && (part.thinking?.trim() || (thinking && !part.thinkingComplete)),
    );
    const toolCalls = content.filter(({ part }) => part.type === "toolCall");
    const responseText = content.flatMap(({ part }) => part.type === "text" && part.text?.trim() ? [part.text] : []).join("\n\n");
    const responseTime = turnTime(items);
    const progressNodes: ReactNode[] = [];
    const contentNodes: ReactNode[] = [];
    const latestThinking = thinkingParts.at(-1);
    if (latestThinking) {
      progressNodes.push(
        <Thinking
          key={`${item.id}-reasoning`}
          text={latestThinking.part.thinking ?? ""}
          running={streaming}
        />,
      );
    }
    if (toolCalls.length > 0) {
      progressNodes.push(
        <ToolActivityGroup
          key={`${item.id}-tools`}
          toolNames={toolCalls.map(({ part: call }) => call.name ?? tools[call.id ?? ""]?.name ?? "工具")}
          running={streaming || toolCalls.some(({ part: call }) => tools[call.id ?? ""]?.running)}
        >
          {toolCalls.map(({ part: call, key: callKey, active: isActive }) => (
            <PartView
              key={callKey}
              part={call}
              tools={tools}
              running={isActive}
              thinking={false}
            />
          ))}
        </ToolActivityGroup>,
      );
    }
    for (const { part, key, active } of content) {
      if (part.type === "thinking" || part.type === "toolCall" || (part.type === "text" && !part.text)) continue;
      contentNodes.push(
        <PartView
          key={key}
          part={part}
          tools={tools}
          running={active}
          thinking={false}
        />,
      );
    }
    items.forEach(entry => {
      if (entry.message.errorMessage) contentNodes.push(<ErrorOutput key={`${entry.id}-error`} error={entry.message.errorMessage} />);
    });
    if (progressNodes.length === 0 && contentNodes.length === 0) return null;
    const startedAt = items.find(entry => entry.startedAt !== undefined)?.startedAt;
    const elapsedMs = [...items].reverse().find(entry => entry.elapsedMs !== undefined)?.elapsedMs ?? savedDuration;
    return (
      <m.div
        className={`transcript-message ${role}`}
        initial={streaming ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.16 }}
      >
        <Message from={role}>
          <MessageContent>
            {progressNodes.length > 0 && (
              <ProcessingPanel key={`${item.id}-${streaming ? "running" : "complete"}`} running={streaming} startedAt={startedAt} durationMs={elapsedMs}>
                {progressNodes}
              </ProcessingPanel>
            )}
            {contentNodes}
            {role === "assistant" && !streaming && responseText && (
              <footer className="message-response-footer">
                {responseTime && <time dateTime={responseTime.dateTime}>{responseTime.label}</time>}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="message-response-copy"
                  aria-label={copied ? "已复制" : "复制回复"}
                  title={copied ? "已复制" : "复制回复"}
                  onClick={() => {
                    void navigator.clipboard.writeText(responseText).then(() => {
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 1600);
                    }).catch(() => undefined);
                  }}
                >
                  <Icon name={copied ? "check" : "copy"} />
                </Button>
              </footer>
            )}
          </MessageContent>
        </Message>
      </m.div>
    );
  },
  (previous, next) => {
    if (
      previous.streaming !== next.streaming ||
      previous.thinking !== next.thinking ||
      previous.savedDuration !== next.savedDuration ||
      previous.items.length !== next.items.length ||
      previous.items.some((item, index) => item !== next.items[index])
    )
      return false;
    const content = previous.items.flatMap(item => Array.isArray(item.message.content) ? item.message.content : []);
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
  const proximityId = useId().replace(/[^a-zA-Z0-9_-]/g, "") || "conversation";
  const [proximitySections, setProximitySections] = useState<ProximitySection[]>([]);
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
          Boolean(part.thinking?.trim()) ||
          (transcript.running && part.type === "thinking"),
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
  const messageGroups = useMemo(() => groupDisplayMessages(transcript.messages), [transcript.messages]);
  const sessionFile = state?.sessionFile ?? persistedSessionFile(project);
  const historicalDurations = useQuery({
    queryKey: ["pi", "turn-durations", sessionFile],
    queryFn: () => getSessionTurnDurations(sessionFile),
    enabled: native && Boolean(sessionFile),
    staleTime: Infinity,
  });
  const savedDurations = useMemo(() => ({
    ...(historicalDurations.data ?? {}),
    ...readTurnDurations(sessionFile),
  }), [historicalDurations.data, sessionFile]);
  const retrying = retry?.status === "waiting" || retry?.status === "running";
  const retryDetail = retrying && retry
    ? `第 ${Number.isFinite(retry.attempt) ? retry.attempt : "?"}${retry.maxAttempts && Number.isFinite(retry.maxAttempts) ? ` / ${retry.maxAttempts}` : ""} 次${retry.delayMs && Number.isFinite(retry.delayMs) ? ` · 等待 ${retry.delayMs} ms` : ""} · ${retry.error || "原因未提供"}`
    : undefined;
  const compacting = transcript.compacting || telemetry.compaction?.status === "running";
  const compactionReason = telemetry.compaction?.reason;
  const compactionDetail = compacting
    ? ({ manual: "手动", threshold: "达到阈值", overflow: "上下文溢出" }[compactionReason ?? ""] ?? compactionReason)
    : undefined;
  useEffect(() => {
    const conversation = ref.current;
    if (!conversation) return;
    let frame = 0;
    const scanSections = () => {
      frame = 0;
      const blocks = Array.from(conversation.querySelectorAll<HTMLElement>(".transcript-message")).flatMap(message => {
        if (message.classList.contains("user")) {
          return [message.querySelector<HTMLElement>(".ai-message-content") ?? message];
        }
        const children = Array.from(message.querySelectorAll<HTMLElement>(
          ".turn-activity, .message-image, .transcript-error, .transcript-compaction, .bash-execution-card, .ai-message-response.markdown-static .streamdown-animated > *",
        )).filter(element => !element.matches("style, script") && (element.textContent?.trim() || element.matches("img") || element.querySelector("img, svg, pre, table")));
        return children.length > 0 ? children : [message];
      });
      const sections = blocks.map<ProximitySection>((block, index) => {
        const id = `${proximityId}-section-${index + 1}`;
        const heading = block.matches("h1, h2, h3") ? block : block.querySelector<HTMLElement>("h1, h2, h3");
        const level = heading?.tagName === "H1" ? 1 : heading?.tagName === "H2" ? 2 : heading?.tagName === "H3" ? 3 : undefined;
        block.id = id;
        return {
          id,
          label: block.textContent?.replace(/\s+/g, " ").trim().slice(0, 72) || `Section ${index + 1}`,
          ...(level ? { level: level as 1 | 2 | 3 } : { kind: messageKind(block) }),
        };
      });
      setProximitySections(current => {
        const unchanged = current.length === sections.length && current.every((section, index) => section.id === sections[index]?.id && section.label === sections[index]?.label);
        return unchanged ? current : sections;
      });
    };
    const scheduleScan = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(scanSections);
    };
    const observer = new MutationObserver(scheduleScan);
    observer.observe(conversation, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    scheduleScan();
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [proximityId, ref]);
  useEffect(() => {
    if (!sessionFile || transcript.running) return;
    const completed = Object.fromEntries(messageGroups.flatMap(group => {
      const id = turnDurationId(group.items);
      const elapsed = [...group.items].reverse().find(item => item.elapsedMs !== undefined)?.elapsedMs;
      return id && elapsed !== undefined ? [[id, elapsed]] : [];
    }));
    saveTurnDurations(sessionFile, completed);
  }, [messageGroups, sessionFile, transcript.running]);
  useEffect(() => {
    const timer = setTimeout(
      () =>
        cacheComposer(project, {
          text: composerCache.get(project)?.text ?? "",
          attachments,
        }),
      0,
    );
    return () => clearTimeout(timer);
  }, [attachments, project]);
  useEffect(() => { cacheComposer(project, {text: draft, attachments: composerCache.get(project)?.attachments ?? attachments}); }, [draft, attachments, project]);
  async function submit(message: PromptInputMessage) {
    const streamingBehavior = deliveryOverride.current ?? "steer";
    deliveryOverride.current = null;
    useWorkspace.getState().event({ type: "prompt_submitted" });
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
      {proximitySections.length > 0 && (
        <ProximitySidebar
          sections={proximitySections}
          side="left"
          className="conversation-proximity-sidebar"
          onSelectSection={id => {
            const disclosure = document.getElementById(id)?.closest<HTMLElement>(".message-response-disclosure");
            if (disclosure?.dataset.collapsible === "true" && disclosure.dataset.open === "false") {
              disclosure.querySelector<HTMLButtonElement>(".message-response-toggle")?.click();
            }
          }}
        />
      )}
      <Conversation
        ref={ref}
        className="chat-conversation tessera-conversation"
      >
        <ConversationContent className="tessera-conversation-content">
          {transcript.messages.length === 0 ? null : (
            messageGroups.map((group) => (
              <TranscriptMessage
                key={group.id}
                items={group.items}
                tools={transcript.tools}
                streaming={transcript.running && group.indexes.includes(transcript.active)}
                thinking={transcript.running && group.indexes.includes(transcript.active) && !group.items.at(-1)?.message.stopReason}
                savedDuration={savedDurations[turnDurationId(group.items) ?? ""]}
              />
            ))
          )}
          {transcript.error && !transcript.messages.some(item => item.message.errorMessage === transcript.error) && (
            <m.div className="transcript-message assistant" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16 }}>
              <ErrorOutput error={transcript.error} />
            </m.div>
          )}
          {(compacting || (transcript.running && !activeHasOutput)) && (
            <LoadingState className="chat-loading-state" label={compacting ? "正在压缩上下文" : (transcript.phase || "正在处理")} detail={compacting ? compactionDetail : retryDetail} />
          )}
        </ConversationContent>
        {!atBottom && <ConversationScrollButton onClick={scrollToBottom} />}
      </Conversation>
      <div className="composer-container tessera-composer-dock">
        <div className="tessera-composer-form">
          <Beam className="studio-composer-beam" borderRadius={14} active={transcript.running || compacting}>
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
                          <Button type="button" className="attachment-remove" title={`移除 ${a.name}`} aria-label={`移除 ${a.name}`} onClick={() => setAttachments((current) => current.filter((item) => item !== a))}>
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
