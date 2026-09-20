import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { AnimatePresence, m } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkspace } from "../../lib/store";
import { report, request, stop, syncComputerUseMode, syncMultiAgentMode } from "../../lib/rpc";
import { Beam } from "../Effects";
import { Icon } from "../Icon";
import { PromptInput, PromptInputSubmit, PromptInputTextarea, type PromptInputMessage } from "../ai-elements/prompt-input";
import { Button } from "../ui/button";
import { ComposerModelSelector } from "./ComposerModelSelector";
import { ComposerContext } from "./ComposerContext";
import { ComposerAgentMode } from "./ComposerAgentMode";

type ImageAttachment = { kind: "image"; id: string; name: string; data: string; mimeType: string };
type FileAttachment = { kind: "file"; id: string; name: string; path: string };
type Attachment = ImageAttachment | FileAttachment;
const composerCache = new Map<string, { text: string; attachments: Attachment[] }>();

function cacheComposer(project: string, value: { text: string; attachments: Attachment[] }) {
  composerCache.delete(project);
  composerCache.set(project, value);
  while (composerCache.size > 4) composerCache.delete(composerCache.keys().next().value!);
}

function imageAttachments(files: Iterable<File>) {
  return Promise.all(Array.from(files).flatMap(file => file.type.startsWith("image/") ? [new Promise<Attachment>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ kind: "image", id: crypto.randomUUID(), name: file.name || "粘贴的图片", data: String(reader.result).split(",")[1], mimeType: file.type });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  })] : []));
}

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp"]);
const BADGE_TONES: Record<string, string> = {
  pdf: "red", doc: "blue", docx: "blue", pages: "blue", rtf: "blue",
  xls: "green", xlsx: "green", csv: "green", numbers: "green",
  ppt: "orange", pptx: "orange", key: "orange",
  md: "violet", tsx: "violet", ts: "violet", jsx: "violet", js: "violet", py: "violet", rs: "violet", go: "violet", rb: "violet", java: "violet", c: "violet", cpp: "violet", h: "violet", swift: "violet", kt: "violet", sh: "violet", sql: "violet", html: "violet", css: "violet", json: "violet", yaml: "violet", yml: "violet", toml: "violet", lock: "violet",
  zip: "amber", rar: "amber", "7z": "amber", tar: "amber", gz: "amber", dmg: "amber",
  mp4: "pink", mov: "pink", mp3: "pink", wav: "pink", aac: "pink",
};

function fileBadge(name: string): { text: string; tone: string } {
  const extension = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  const text = (extension || "file").slice(0, 4).toUpperCase();
  return { text, tone: BADGE_TONES[extension] ?? "neutral" };
}

function fileKindLabel(name: string): string {
  const extension = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return extension ? extension.toUpperCase() : "文件";
}

export function ChatComposer({ compacting, onSubmitted }: { compacting: boolean; onSubmitted: () => void }) {
  const project = useWorkspace(state => state.cwd);
  const connectionId = useWorkspace(state => state.connectionId);
  const transcript = useWorkspace(state => state.transcript);
  const online = useWorkspace(state => state.connection === "online");
  const runtimeTarget = useWorkspace(state => state.runtimeTarget);
  const composerKey = connectionId || project;
  const [attachments, setAttachments] = useState<Attachment[]>(() => composerCache.get(composerKey)?.attachments ?? []);
  const [draft, setDraft] = useState(() => useWorkspace.getState().draft || composerCache.get(composerKey)?.text || "");
  const deliveryOverride = useRef<"steer" | "followUp" | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const addFilePaths = useCallback((paths: string[]) => {
    if (!paths.length) return;
    void Promise.all(paths.map(async path => {
      const name = path.split("/").pop() || path.split("\\").pop() || path;
      if (IMAGE_EXTENSIONS.has(name.includes(".") ? name.split(".").pop()!.toLowerCase() : "")) {
        try {
          const file = await invoke<{ name: string; data: string; mimeType: string }>("read_file_attachment", { path });
          return { kind: "image", id: crypto.randomUUID(), ...file } as Attachment;
        } catch { /* fall through to a path chip */ }
      }
      return { kind: "file", id: crypto.randomUUID(), name, path } as Attachment;
    })).then(next => setAttachments(current => [...current, ...next])).catch(report);
  }, []);

  useEffect(() => {
    const pasteInto = async (event: ClipboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest(".composer")) return;
      const files = Array.from(event.clipboardData?.files ?? []);
      const images = files.filter(file => file.type.startsWith("image/"));
      if (images.length > 0) {
        event.preventDefault();
        void imageAttachments(images).then(next => setAttachments(current => [...current, ...next])).catch(report);
        return;
      }
      // WKWebView drops Finder file copies on the floor; ask the native
      // pasteboard for the absolute paths instead.
      if (files.length === 0 && !event.clipboardData?.getData("text/plain")) {
        event.preventDefault();
        addFilePaths(await invoke<string[]>("clipboard_file_paths"));
      }
    };
    window.addEventListener("paste", listener, { passive: true });
    function listener(event: ClipboardEvent) { void pasteInto(event); }
    return () => window.removeEventListener("paste", listener);
  }, [addFilePaths]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void getCurrentWebview().onDragDropEvent(event => {
      if (event.payload.type === "drop") addFilePaths(event.payload.paths);
    }).then(dispose => { unlisten = dispose; });
    return () => unlisten?.();
  }, [addFilePaths]);

  useEffect(() => { cacheComposer(composerKey, { text: draft, attachments }); }, [attachments, composerKey, draft]);

  async function submit(message: PromptInputMessage) {
    const streamingBehavior = deliveryOverride.current ?? "steer";
    deliveryOverride.current = null;
    useWorkspace.getState().event({ type: "prompt_submitted" });
    try {
      if (!transcript.running) await Promise.all([syncMultiAgentMode(project), syncComputerUseMode(project)]);
    const fileChips = attachments.filter((attachment): attachment is FileAttachment => attachment.kind === "file");
    const images = attachments.filter((attachment): attachment is ImageAttachment => attachment.kind === "image");
    const prefix = fileChips.map(attachment => `[文件] ${attachment.path}`).join("\n");
    const text = prefix ? `${prefix}\n\n${message.text}`.trim() : message.text;
      await request({ type: "prompt", message: text, images: images.map(attachment => ({ type: "image" as const, data: attachment.data, mimeType: attachment.mimeType })), ...(transcript.running ? { streamingBehavior } : {}) }, 45000, project);
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
          {attachments.map(attachment => attachment.kind === "image"
            ? <div className="attachment-preview" key={attachment.id}><img src={`data:${attachment.mimeType};base64,${attachment.data}`} alt={attachment.name} decoding="async" /><Button type="button" variant="secondary" size="icon" className="attachment-remove" title={`移除 ${attachment.name}`} aria-label={`移除 ${attachment.name}`} onClick={() => setAttachments(current => current.filter(item => item.id !== attachment.id))}><Icon name="x" /></Button></div>
            : <div className="attachment-file" key={attachment.id}>
              <span className={`attachment-file-badge tone-${fileBadge(attachment.name).tone}`}>{fileBadge(attachment.name).text}</span>
              <span className="attachment-file-meta">
                <strong title={attachment.name}>{attachment.name}</strong>
                <small>{fileKindLabel(attachment.name)}</small>
              </span>
              <Button type="button" variant="secondary" size="icon" className="attachment-remove" title={`移除 ${attachment.name}`} aria-label={`移除 ${attachment.name}`} onClick={() => setAttachments(current => current.filter(item => item.id !== attachment.id))}><Icon name="x" /></Button>
            </div>)}
        </m.div>}</AnimatePresence>
        <PromptInputTextarea placeholder="输入消息，发送给助手…" value={draft} onChange={event => setDraft(event.currentTarget.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) deliveryOverride.current = event.altKey ? "followUp" : "steer"; }} />
        <div className="composer-bottom">
          <input type="file" multiple accept="image/*" hidden ref={fileInput} onChange={event => { const files = event.target.files; if (files) void imageAttachments(files).then(next => setAttachments(current => [...current, ...next])).catch(report); event.target.value = ""; }} />
          <div className="composer-tool-cluster"><Button variant="ghost" className="size-8 rounded-full p-0 text-muted-foreground hover:text-foreground hover:bg-accent" aria-label="上传附件" title="上传图片" onClick={() => fileInput.current?.click()}><Icon name="plus" className="size-4" /></Button></div>
          <ComposerModelSelector />
          <ComposerAgentMode />
          {(transcript.queue.steering.length > 0 || transcript.queue.followUp.length > 0) && <span className="composer-queue-status" aria-live="polite">已排队 {transcript.queue.steering.length + transcript.queue.followUp.length}</span>}
          {runtimeTarget !== "mobile" && <ComposerContext />}
          <PromptInputSubmit status={transcript.running ? "streaming" : "ready"} disabled={!online} title={transcript.running ? "暂停生成" : "发送消息"} aria-label={transcript.running ? "暂停生成" : "发送消息"} onClick={transcript.running ? () => void stop().catch(report) : undefined} />
        </div>
      </PromptInput>
    </Beam>
  </div></div>;
}
