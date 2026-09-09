import { memo, useEffect, useRef, useState } from "react";
import { AnimatePresence, m } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AtSign, FileText, List, RefreshCw } from "lucide-react";
import { useWorkspace } from "../lib/store";
import {
  listProjectFiles,
  listProviderModels,
  request,
  report,
  stop,
} from "../lib/rpc";
import type { Model, Part, DisplayMessage, Tool, PiMessage } from "../lib/protocol";
import { Icon } from "./Icon";
import { Button, Input, Select, Skeleton } from "./UI";
import { ProjectPicker } from "./ProjectPicker";
import { ContextBar } from "./Inspector";
import { ThemeToggle } from "../App";
import { Thinking } from "./RichMessage";
import { ToolCall } from "./ai-elements/tool-call";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
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
import { ThinkingOrb } from "thinking-orbs";
import { Beam } from "./Effects";
import { BorderBeam } from "border-beam";
import { ModelLogo, ModelModalities } from "./ModelMeta";
import { formatContextLength, modelLabel, modelModalities } from "../lib/model-meta";

type Attachment = { name: string; data: string; mimeType: string };
const composerCache = new Map<
  string,
  { text: string; attachments: Attachment[] }
>();
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
    return <Thinking text={part.thinking ?? ""} running={thinking} />;
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
        label={`完成 ${part.name ?? "工具"}`}
        activeLabel={`正在执行 ${part.name ?? "工具"}`}
        query={part.argsText ?? ""}
        request={part.argsText ?? JSON.stringify(part.arguments ?? {})}
        result={
          result === undefined
            ? ""
            : typeof result === "string"
              ? result
              : JSON.stringify(result)
        }
        usage={tool?.usage}
        running={result === undefined}
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
    return (
      <m.div
        className={`transcript-message ${role}`}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.16 }}
      >
        <Message from={role}>
          <MessageContent>
            {content.map((part, index) => (
              <PartView
                key={`${item.id}-${index}`}
                part={part as Part}
                tools={tools}
                running={streaming}
                thinking={thinking}
              />
            ))}
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
    online = useWorkspace((s) => s.connection === "online"),
    state = useWorkspace((s) => s.state);
  const [attachments, setAttachments] = useState<Attachment[]>(
      () => composerCache.get(project)?.attachments ?? [],
    ),
    [draft, setDraft] = useState(() => composerCache.get(project)?.text ?? ""),
    [delivery, setDelivery] = useState<"steer" | "followUp">("steer"),
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
  const [filePickerOpen, setFilePickerOpen] = useState(false), [fileSearch, setFileSearch] = useState("");
  const projectFiles = useQuery({queryKey:["pi", "project-files", project], queryFn:()=>listProjectFiles(project), enabled:filePickerOpen && !!project, staleTime:300000});
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
  const activeMessage = transcript.messages[transcript.active]?.message;
  const activeHasText = Boolean(
    activeMessage &&
      (Array.isArray(activeMessage.content)
        ? activeMessage.content.some(
            (part) => part.type === "text" && Boolean(part.text?.trim()),
          )
        : typeof activeMessage.content === "string" &&
          activeMessage.content.trim()),
  );
  const configuredModels = activeProvider
    ? (models.data?.models ?? []).filter((model) => model.provider === activeProvider)
    : [];
  const [catalogOpen, setCatalogOpen] = useState(false);
  const catalog = useQuery({
    queryKey: ["pi", "provider-models", project, state?.model?.provider],
    queryFn: () => listProviderModels(state?.model?.provider ?? ""),
    enabled: online && !!state?.model?.provider,
    staleTime: 300000,
    refetchOnWindowFocus: false,
  });
  const configuredIds = new Set((models.data?.models ?? []).map((model) => `${model.provider}/${model.id}`));
  const remoteModels = (catalog.data?.data ?? []).filter((model) => model.id);
  const catalogContent = (
    <div className="provider-catalog">
      <div className="provider-catalog-header">
        <strong>中转站模型</strong>
        <Button title="刷新模型目录" onClick={() => void catalog.refetch()}>
          <RefreshCw className={catalog.isFetching ? "spin" : ""} />
        </Button>
      </div>
      {catalog.isLoading ? (
        <span className="orb-status"><ThinkingOrb state="searching" size={20} theme="dark" aria-label="查询中" />查询中</span>
      ) : catalog.error ? (
        <p className="error-inline">{String(catalog.error)}</p>
      ) : remoteModels.length === 0 ? (
        <p className="metric-note">接口没有返回模型。</p>
      ) : (
        <>
          <div className="provider-model-table-head" aria-hidden="true"><span>模型</span><span>上下文</span><span>输入模态</span><span>输出模态</span></div>
          <div className="provider-model-list provider-model-table">
            {remoteModels.map((model) => {
              const key = `${state?.model?.provider}/${model.id}`;
              const inputs = modelModalities(model, "input");
              const outputs = modelModalities(model, "output");
              return (
                <div className="provider-model-row" key={model.id}>
                  <span className="provider-model-name"><ModelLogo modelId={model.id} size={16} /><strong>{modelLabel(model.id, model.name)}</strong><small>{configuredIds.has(key) ? "Pi 已配置" : "仅远端目录"}</small></span>
                  <span className="provider-model-context">{formatContextLength(model.context_length)}{typeof model.context_length === "number" && <small> tokens</small>}</span>
                  <ModelModalities values={inputs} />
                  <ModelModalities values={outputs} />
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
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
    const streamingBehavior = deliveryOverride.current ?? delivery;
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
      useWorkspace.getState().set({ state: next });
    } catch (error) {
      report(error);
    }
  }
  return (
    <div className="chat-root tessera-thread-root">
      <div className="chat-toolbar">
        <ProjectPicker compact />
        <ContextBar />
        <div className="chat-toolbar-actions">
          <ThemeToggle />
          <Button title="上下文与运行详情" onClick={()=>useWorkspace.getState().set({inspector:!useWorkspace.getState().inspector})}><Icon name="brain"/></Button>
        </div>
      </div>
      <Conversation
        ref={ref}
        className="chat-conversation tessera-conversation"
      >
        <ConversationContent className="tessera-conversation-content">
          {transcript.messages.length === 0 ? (
            <ConversationEmptyState
              title="开始对话"
              icon={<span className="empty-mark">π</span>}
            />
          ) : (
            transcript.messages.map((item, index) => (
              <TranscriptMessage
                key={item.id}
                item={item}
                tools={transcript.tools}
                streaming={transcript.running && index === transcript.active}
                thinking={transcript.running && index === transcript.active && !activeHasText}
              />
            ))
          )}
          {transcript.running && !activeHasText && <Beam active className="thinking-beam"><div className="run-status"><ThinkingOrb state="composing" size={20} theme="dark" aria-label={transcript.phase || "正在处理"} /><span>{transcript.phase || "正在处理"}</span></div></Beam>}
        </ConversationContent>
        {!atBottom && <ConversationScrollButton onClick={scrollToBottom} />}
      </Conversation>
      <div className="composer-container tessera-composer-dock">
        <div className="tessera-composer-form">
          <AnimatePresence>
            {attachments.length > 0 && (
              <m.div
                className="attachments"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                {attachments.map((a) => (
                  <div className="attachment-preview" key={`${a.name}-${a.data.slice(0, 16)}`}>
                    <img src={`data:${a.mimeType};base64,${a.data}`} alt={a.name} />
                    <Button
                      title={`移除 ${a.name}`}
                      onClick={() =>
                        setAttachments((current) => current.filter((item) => item !== a))
                      }
                    >
                      <Icon name="x" />
                    </Button>
                  </div>
                ))}
              </m.div>
            )}
          </AnimatePresence>
              <BorderBeam
                className="composer-beam"
                active
                size="md"
                colorVariant="mono"
                strength={0.55}
                theme="dark"
              >
                <PromptInput
                  onSubmit={(message) => void submit(message)}
                  className="composer studio-composer"
                  allowEmpty={attachments.length > 0}
                >
                <PromptInputTextarea
                  placeholder="Build anything…"
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
                  <Button
                    title="添加附件"
                    onClick={() => fileInput.current?.click()}
                  >
                    <Icon name="paperclip" />
                  </Button>
                  <Popover open={filePickerOpen} onOpenChange={setFilePickerOpen}>
                    <PopoverTrigger render={<Button title="引用项目文件" aria-label="引用项目文件" />}><AtSign /></PopoverTrigger>
                    <PopoverContent side="top" align="start" className="project-file-picker">
                      <Input autoFocus placeholder="搜索项目文件" value={fileSearch} onChange={event=>setFileSearch(event.target.value)} />
                      <div className="project-file-options">
                        {(projectFiles.data ?? []).filter(file=>file.toLowerCase().includes(fileSearch.toLowerCase())).slice(0,80).map(file=><Button key={file} onClick={()=>{setDraft(value=>`${value}${value && !value.endsWith(" ") ? " " : ""}@${file} `);setFilePickerOpen(false);setFileSearch("")}}><FileText/><span>{file}</span></Button>)}
                        {projectFiles.isLoading && <span className="metric-note">读取文件列表…</span>}
                        {projectFiles.error && <span className="error-inline">{String(projectFiles.error)}</span>}
                      </div>
                    </PopoverContent>
                  </Popover>
                  {transcript.running && (
                    <Button
                      title="停止"
                      onClick={() => void stop().catch(report)}
                    >
                      <Icon name="stop-fill" />
                    </Button>
                  )}
                  <div className="composer-selectors">
                    {models.isLoading ? (
                      <span className="studio-model-loading" aria-busy="true">
                        <Skeleton className="studio-model-loading-icon" />
                        <Skeleton className="studio-model-loading-label" />
                      </span>
                    ) : (
                      <Select
                        aria-label="模型"
                        className="composer-model-select"
                        disabled={!online || transcript.running}
                        value={
                          state?.model
                            ? `${state.model.provider}/${state.model.id}`
                            : ""
                        }
                        onChange={(event) => {
                          const model = configuredModels.find(
                            (m) =>
                              `${m.provider}/${m.id}` === event.target.value,
                          );
                          if (model)
                            void choose({
                              type: "set_model",
                              provider: model.provider,
                              modelId: model.id,
                            });
                        }}
                      >
                        {configuredModels.map((model) => (
                          <option
                            key={`${model.provider}/${model.id}`}
                            value={`${model.provider}/${model.id}`}
                          >
                            <span className="model-option"><ModelLogo modelId={model.id} size={16} /><span>{modelLabel(model.id, model.name)}</span></span>
                          </option>
                        ))}
                      </Select>
                    )}
                    <Popover open={catalogOpen} onOpenChange={setCatalogOpen}>
                      <PopoverTrigger render={<Button className="composer-catalog-button" aria-label="查询中转站模型" />}>
                        <List />
                      </PopoverTrigger>
                      <PopoverContent side="top">{catalogContent}</PopoverContent>
                    </Popover>
                    <Select
                      aria-label="思考强度"
                      className="composer-thinking-select"
                      disabled={!online || transcript.running}
                      value={state?.thinkingLevel ?? "off"}
                      onChange={(event) =>
                        void choose({
                          type: "set_thinking_level",
                          level: event.target.value as "high",
                        })
                      }
                    >
                      {(levels.data?.levels ?? ["off"]).map((level) => (
                        <option key={level} value={level}>
                          {level === "off" ? "Auto" : level}
                        </option>
                      ))}
                    </Select>
                    {transcript.running && (
                      <Select
                        aria-label="排队方式"
                        value={delivery}
                        onChange={(event) =>
                          setDelivery(event.target.value as typeof delivery)
                        }
                      >
                        <option value="steer">引导</option>
                        <option value="followUp">跟进</option>
                      </Select>
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
              </BorderBeam>
        </div>
      </div>
    </div>
  );
}
