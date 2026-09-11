import { BookOpen, Braces, ChevronRight, FilePenLine, FileSearch, Terminal, Wrench } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { FileIcon } from "../Icon";
import { Button } from "@/components/ui/button";
import { summarizeToolCalls, toolKind, type ToolKind } from "../../lib/tool-activity";
import "./tool-call.css";

type JsonRecord = Record<string, unknown>;

const toolKinds: Record<ToolKind, { label: string; icon: typeof BookOpen }> = {
  read: { label: "读取", icon: BookOpen },
  search: { label: "搜索", icon: FileSearch },
  command: { label: "运行", icon: Terminal },
  edit: { label: "编辑", icon: FilePenLine },
  other: { label: "调用", icon: Wrench },
};

function parseArguments(request: string): JsonRecord | null {
  try {
    const parsed: unknown = JSON.parse(request);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JsonRecord : null;
  } catch {
    return null;
  }
}

function firstText(input: JsonRecord | null, fields: string[]) {
  for (const field of fields) {
    const value = input?.[field];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function displayTarget(kind: ToolKind, request: string) {
  const args = parseArguments(request);
  const fields = kind === "command"
    ? ["command", "cmd", "script", "input"]
    : kind === "search"
      ? ["query", "pattern", "path", "glob", "input"]
      : ["path", "filePath", "file", "filename", "target", "url", "input"];
  const target = firstText(args, fields) || (args ? "" : request.trim());
  return target.replace(/\s+/g, " ").slice(0, 180);
}

function patchCounts(value: string) {
  const lines = value.split("\n");
  const additions = lines.filter(line => /^\+(?!\+\+)/.test(line)).length;
  const deletions = lines.filter(line => /^-(?!---)/.test(line)).length;
  return additions || deletions ? { additions, deletions } : null;
}

function editCounts(request: string, result: string) {
  const args = parseArguments(request);
  const patch = firstText(args, ["patch", "diff", "unifiedDiff"]);
  return patchCounts(patch) ?? patchCounts(request) ?? patchCounts(result);
}

function renderedRequest(request: string) {
  const args = parseArguments(request);
  return args ? JSON.stringify(args, null, 2) : request;
}

export function ToolActivityGroup({ toolNames, running, children }: { toolNames: string[]; running: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  const listId = useId();
  return <section className="tool-activity-group" data-open={open}>
    <Button type="button" variant="ghost" className="tool-activity-group-header" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(value => !value)}>
      <Braces aria-hidden="true" /><span>{summarizeToolCalls(toolNames) || "工具调用"}</span>{running && <span className="tool-activity-group-status">运行中</span>}<ChevronRight className="tool-activity-group-chevron" aria-hidden="true" />
    </Button>
    <div id={listId} className="tool-activity-list" aria-hidden={!open} inert={!open}>{children}</div>
  </section>;
}

export function ToolCall({ toolName, request, result, usage, running, open: controlledOpen, onOpenChange, className = '' }: { toolName: string; request: string; result: string; usage?: { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number; cost?: { total?: number } }; running: boolean; open?: boolean; onOpenChange?: (open: boolean) => void; className?: string }) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const detailsId = useId();
  const kind = toolKind(toolName);
  const presentation = toolKinds[kind];
  const ToolIcon = presentation.icon;
  const target = displayTarget(kind, request);
  const changes = kind === "edit" ? editCounts(request, result) : null;
  const setOpen = (value: boolean) => { setLocalOpen(value); onOpenChange?.(value); };

  return <div className={`ai-tool-call tool-activity-item ${className}`} data-running={running} data-open={open}>
    <Button type="button" variant="ghost" className="tool-activity-row" aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen(!open)}>
      <ToolIcon className="tool-activity-icon" aria-hidden="true" /><span className="tool-activity-action">{presentation.label}</span>{target && (kind === "read" || kind === "edit") && <FileIcon path={target} className="tool-activity-file-icon" />}{target && <code className="tool-activity-target" title={target}>{target}</code>}{changes && <span className="tool-activity-changes"><b>+{changes.additions}</b><i>-{changes.deletions}</i></span>}{running && <span className="tool-activity-running" aria-live="polite">运行中</span>}<ChevronRight className="tool-activity-chevron" aria-hidden="true" />
    </Button>
    <div id={detailsId} className="tool-activity-details" aria-hidden={!open} inert={!open}><div className="tool-activity-details-inner">
      <section><small>请求</small><pre>{renderedRequest(request)}</pre></section>
      {(result || !running) && <section><small>结果</small><pre>{result || "未返回输出"}</pre></section>}
      {usage && <div className="tool-usage"><small>工具关联用量</small><span>{usage.totalTokens.toLocaleString()} tokens</span>{usage.cost?.total != null && <span>${usage.cost.total.toFixed(4)}</span>}</div>}
    </div></div>
  </div>;
}
