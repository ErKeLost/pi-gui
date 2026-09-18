import { AnimatePresence, m } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "../../lib/store";
import { report, request, stop } from "../../lib/rpc";
import { Beam } from "../Effects";
import { Button } from "../UI";
import { Icon } from "../Icon";
import { PromptInput, PromptInputSubmit, PromptInputTextarea, type PromptInputMessage } from "../ai-elements/prompt-input";
import { ComposerModelSelector } from "./ComposerModelSelector";
import { ComposerContext } from "./ComposerContext";
import { ComposerAgentMode } from "./ComposerAgentMode";

type Attachment = { name: string; data: string; mimeType: string };
const composerCache = new Map<string, { text: string; attachments: Attachment[] }>();

function cacheComposer(project: string, value: { text: string; attachments: Attachment[] }) {
  composerCache.delete(project);
  composerCache.set(project, value);
  while (composerCache.size > 4) composerCache.delete(composerCache.keys().next().value!);
}

function imageAttachments(files: Iterable<File>) {
  return Promise.all(Array.from(files).flatMap(file => file.type.startsWith("image/") ? [new Promise<Attachment>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name || "粘贴的图片", data: String(reader.result).split(",")[1], mimeType: file.type });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  })] : []));
}

export function ChatComposer({ compacting, onSubmitted }: { compacting: boolean; onSubmitted: () => void }) {
  const project = useWorkspace(state => state.cwd);
  const connectionId = useWorkspace(state => state.connectionId);
  const transcript = useWorkspace(state => state.transcript);
  const online = useWorkspace(state => state.connection === "online");
  const composerKey = connectionId || project;
  const [attachments, setAttachments] = useState<Attachment[]>(() => composerCache.get(composerKey)?.attachments ?? []);
  const [draft, setDraft] = useState(() => useWorkspace.getState().draft || composerCache.get(composerKey)?.text || "");
  const deliveryOverride = useRef<"steer" | "followUp" | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const pasteImage = (event: ClipboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const files = Array.from(event.clipboardData?.files ?? []).filter(file => file.type.startsWith("image/"));
      if (!target?.closest(".composer") || files.length === 0) return;
      event.preventDefault();
      void imageAttachments(files).then(next => setAttachments(current => [...current, ...next])).catch(report);
    };
    window.addEventListener("paste", pasteImage);
    return () => window.removeEventListener("paste", pasteImage);
  }, []);

  useEffect(() => { cacheComposer(composerKey, { text: draft, attachments }); }, [attachments, composerKey, draft]);

  async function submit(message: PromptInputMessage) {
    const streamingBehavior = deliveryOverride.current ?? "steer";
    deliveryOverride.current = null;
    useWorkspace.getState().event({ type: "prompt_submitted" });
    try {
      await request({ type: "prompt", message: message.text, images: attachments.map(attachment => ({ type: "image" as const, data: attachment.data, mimeType: attachment.mimeType })), ...(transcript.running ? { streamingBehavior } : {}) }, 45000, project);
      setAttachments([]);
      setDraft("");
      onSubmitted();
    } catch (error) {
      report(error);
    }
  }

  return <div className="composer-container tessera-composer-dock"><div className="tessera-composer-form">
    <Beam className="studio-composer-beam" borderRadius={14} active={transcript.running || compacting}>
      <PromptInput onSubmit={message => void submit(message)} className="composer studio-composer" allowEmpty={attachments.length > 0}>
        <AnimatePresence>{attachments.length > 0 && <m.div className="attachments" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
          {attachments.map(attachment => <div className="attachment-preview" key={`${attachment.name}-${attachment.data.slice(0, 16)}`}><img src={`data:${attachment.mimeType};base64,${attachment.data}`} alt={attachment.name} /><Button type="button" className="attachment-remove" title={`移除 ${attachment.name}`} aria-label={`移除 ${attachment.name}`} onClick={() => setAttachments(current => current.filter(item => item !== attachment))}><Icon name="x" /></Button></div>)}
        </m.div>}</AnimatePresence>
        <PromptInputTextarea placeholder="输入消息，发送给助手…" value={draft} onChange={event => setDraft(event.currentTarget.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) deliveryOverride.current = event.altKey ? "followUp" : "steer"; }} />
        <div className="composer-bottom">
          <input type="file" multiple accept="image/*" hidden ref={fileInput} onChange={event => { const files = event.target.files; if (files) void imageAttachments(files).then(next => setAttachments(current => [...current, ...next])).catch(report); event.target.value = ""; }} />
          <div className="composer-tool-cluster"><Button variant="ghost" className="size-8 rounded-full p-0 text-muted-foreground hover:text-foreground hover:bg-accent" aria-label="上传附件" title="上传图片" onClick={() => fileInput.current?.click()}><Icon name="plus" className="size-4" /></Button></div>
          <ComposerModelSelector />
          <ComposerAgentMode />
          {(transcript.queue.steering.length > 0 || transcript.queue.followUp.length > 0) && <span className="composer-queue-status" aria-live="polite">已排队 {transcript.queue.steering.length + transcript.queue.followUp.length}</span>}
          <ComposerContext />
          <PromptInputSubmit status={transcript.running ? "streaming" : "ready"} disabled={!online} title={transcript.running ? "暂停生成" : "发送消息"} aria-label={transcript.running ? "暂停生成" : "发送消息"} onClick={transcript.running ? () => void stop().catch(report) : undefined} />
        </div>
      </PromptInput>
    </Beam>
  </div></div>;
}
