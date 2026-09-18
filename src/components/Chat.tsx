import { Wifi } from "lucide-react";
import { useEffect, useId, useMemo, useState, type RefObject } from "react";
import { m } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspace } from "../lib/store";
import { getSessionTurnDurations, native, persistedSessionFile } from "../lib/rpc";
import { formatTranscriptError, groupDisplayMessages, type Transcript } from "../lib/protocol";
import type { Telemetry } from "../lib/telemetry";
import { readTurnDurations, saveTurnDurations, turnDurationId } from "../lib/turn-duration";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "./ai-elements/conversation";
import { useConversationScroll } from "../hooks/use-conversation-scroll";
import LoadingState from "./ai-elements/loading-state";
import ProximitySidebar, { type ProximitySection } from "./ui/proximity-sidebar";
import { ChatComposer } from "./chat/ChatComposer";
import { ErrorOutput, TranscriptMessage } from "./chat/TranscriptMessage";
import { hasSectionMedia, messageKind, sectionPreview, sectionText } from "../lib/conversation-sections";

function useConversationSections(
  conversationRef: RefObject<HTMLDivElement | null>,
  proximityId: string,
) {
  const [sections, setSections] = useState<ProximitySection[]>([]);
  useEffect(() => {
    const conversation = conversationRef.current;
    if (!conversation) return;
    let frame = 0;
    const scan = () => {
      frame = 0;
      const blocks = Array.from(conversation.querySelectorAll<HTMLElement>(".transcript-message")).flatMap(message => {
        if (message.classList.contains("user")) return [message.querySelector<HTMLElement>(".ai-message-content") ?? message];
        const children = Array.from(message.querySelectorAll<HTMLElement>(
          ".turn-activity, .message-image, .transcript-error, .transcript-compaction, .bash-execution-card, .ai-message-response.markdown-static .streamdown-animated > *",
        )).filter(element => !element.matches("style, script") && Boolean(sectionText(element) || hasSectionMedia(element)));
        return children.length > 0 ? children : [message];
      });
      const contentBlocks = blocks.filter(block => {
        const text = sectionText(block);
        return Boolean(text || hasSectionMedia(block));
      });
      const next = contentBlocks.map<ProximitySection>((block, index) => {
        const id = `${proximityId}-section-${index + 1}`;
        const heading = block.matches("h1, h2, h3") ? block : block.querySelector<HTMLElement>("h1, h2, h3");
        const level = heading?.tagName === "H1" ? 1 : heading?.tagName === "H2" ? 2 : heading?.tagName === "H3" ? 3 : undefined;
        block.id = id;
        const text = sectionText(block);
        const kind = messageKind(block);
        const fallbackTitle = block.matches("img") || block.querySelector("img") ? "图片" : block.matches("pre") || block.querySelector("pre") ? "代码" : block.matches("table") || block.querySelector("table") ? "表格" : block.closest(".transcript-message.user") ? "你的消息" : ({ title: "标题", section: "运行记录", body: "助手回复" }[kind] ?? "助手回复");
        const title = heading?.textContent?.replace(/\s+/g, " ").trim().slice(0, 48) || fallbackTitle;
        return {
          id,
          label: title,
          preview: text && text !== title ? sectionPreview(block) : undefined,
          previewVersion: block.innerHTML,
          ...(level ? { level: level as 1 | 2 | 3 } : { kind: messageKind(block) }),
        };
      }).filter(section => section.level === 1 || section.level === 2);
      setSections(current => current.length === next.length && current.every((section, index) => section.id === next[index]?.id && section.label === next[index]?.label && section.previewVersion === next[index]?.previewVersion) ? current : next);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(scan);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(conversation, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    schedule();
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [conversationRef, proximityId]);
  return sections;
}

function deriveRunStatus(transcript: Transcript, telemetry: Telemetry) {
  const retry = telemetry.retry;
  const retrying = retry?.status === "waiting" || retry?.status === "running";
  const retryDetail = retrying && retry
    ? `第 ${Number.isFinite(retry.attempt) ? retry.attempt : "?"}${retry.maxAttempts && Number.isFinite(retry.maxAttempts) ? ` / ${retry.maxAttempts}` : ""} 次${retry.delayMs && Number.isFinite(retry.delayMs) ? ` · 等待 ${retry.delayMs} ms` : ""} · ${retry.error ? formatTranscriptError(retry.error) : "原因未提供"}`
    : undefined;
  const compacting = transcript.compacting || telemetry.compaction?.status === "running";
  const compactionReason = telemetry.compaction?.reason;
  const compactionDetail = compacting
    ? ({ manual: "手动", threshold: "达到阈值", overflow: "上下文溢出" }[compactionReason ?? ""] ?? compactionReason)
    : undefined;
  const activeMessage = transcript.messages[transcript.active]?.message;
  const activeHasOutput = Boolean(
    Array.isArray(activeMessage?.content)
      ? activeMessage.content.some(part => part.type === "toolCall" || part.type === "image" || Boolean(part.text?.trim()) || Boolean(part.thinking?.trim()) || (transcript.running && part.type === "thinking"))
      : typeof activeMessage?.content === "string" && activeMessage.content.trim(),
  ) || Object.values(transcript.tools).some(tool => tool.running);
  return { retrying, retryDetail, compacting, compactionDetail, activeHasOutput };
}

export function Chat() {
  const project = useWorkspace(state => state.cwd);
  const transcript = useWorkspace(state => state.transcript);
  const telemetry = useWorkspace(state => state.telemetry);
  const { ref, atBottom, scrollToBottom } = useConversationScroll();
  const proximityId = useId().replace(/[^a-zA-Z0-9_-]/g, "") || "conversation";
  const proximitySections = useConversationSections(ref, proximityId);
  const messageGroups = useMemo(() => groupDisplayMessages(transcript.messages), [transcript.messages]);
  const sessionFile = useWorkspace(state => state.state?.sessionFile) ?? persistedSessionFile(project);
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
  const { retrying, retryDetail, compacting, compactionDetail, activeHasOutput } = deriveRunStatus(transcript, telemetry);

  useEffect(() => {
    if (!sessionFile || transcript.running) return;
    const completed = Object.fromEntries(messageGroups.flatMap(group => {
      const id = turnDurationId(group.items);
      const elapsed = [...group.items].reverse().find(item => item.elapsedMs !== undefined)?.elapsedMs;
      return id && elapsed !== undefined ? [[id, elapsed]] : [];
    }));
    saveTurnDurations(sessionFile, completed);
  }, [messageGroups, sessionFile, transcript.running]);

  return <div className="chat-root tessera-thread-root">
    {proximitySections.length > 0 && <ProximitySidebar
      sections={proximitySections}
      side="left"
      className="conversation-proximity-sidebar"
      onSelectSection={id => {
        const target = document.getElementById(id);
        const activity = target?.closest<HTMLElement>(".turn-activity");
        if (activity?.dataset.open === "false") activity.querySelector<HTMLButtonElement>(".turn-activity-header")?.click();
        const disclosure = target?.closest<HTMLElement>(".message-response-disclosure");
        if (disclosure?.dataset.collapsible === "true" && disclosure.dataset.open === "false") disclosure.querySelector<HTMLButtonElement>(".message-response-toggle")?.click();
      }}
    />}
    <Conversation ref={ref} className="chat-conversation tessera-conversation">
      <ConversationContent className="tessera-conversation-content">
        {messageGroups.map(group => <TranscriptMessage
          key={group.id}
          items={group.items}
          tools={transcript.tools}
          streaming={transcript.running && group.indexes.includes(transcript.active)}
          thinking={transcript.running && group.indexes.includes(transcript.active) && !group.items.at(-1)?.message.stopReason}
          savedDuration={savedDurations[turnDurationId(group.items) ?? ""]}
        />)}
        {transcript.error && !transcript.running && <m.div className="transcript-message assistant" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16 }}><ErrorOutput error={transcript.error} /></m.div>}
        {(compacting || retrying || (transcript.running && !activeHasOutput)) && <LoadingState icon={retrying && !compacting ? <Wifi size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" /> : undefined} className="chat-loading-state" label={compacting ? "正在压缩上下文" : (transcript.phase || "正在处理")} detail={compacting ? compactionDetail : retryDetail} />}
      </ConversationContent>
      {!atBottom && <ConversationScrollButton onClick={scrollToBottom} />}
    </Conversation>
    <ChatComposer compacting={compacting} onSubmitted={scrollToBottom} />
  </div>;
}
