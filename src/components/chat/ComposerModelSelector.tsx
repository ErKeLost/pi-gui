import { useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspace } from "../../lib/store";
import { modelLabel } from "../../lib/model-meta";
import { persistDefaultModel, report, request } from "../../lib/rpc";
import type { Model } from "../../lib/protocol";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { ModelLogo } from "../ModelMeta";
import { Skeleton } from "../UI";
import { Icon } from "../Icon";

function composerModelLabel(id: string, fallback?: string) {
  return modelLabel(id, fallback).replace(/^gpt-/i, "").replace(/[-_]+/g, " ").replace(/\b[a-z]/g, letter => letter.toUpperCase());
}

function effortLabel(level?: string) {
  if (!level || level === "off") return "Off";
  return level === "xhigh" ? "XHigh" : level.charAt(0).toUpperCase() + level.slice(1);
}

export function ComposerModelSelector() {
  const project = useWorkspace(state => state.cwd);
  const online = useWorkspace(state => state.connection === "online");
  const streaming = useWorkspace(state => state.transcript.running);
  const state = useWorkspace(workspace => workspace.state);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const models = useQuery({ queryKey: ["pi", "models", project], queryFn: () => request<{ models: Model[] }>({ type: "get_available_models" }, 30000, project), enabled: online });
  const levels = useQuery({ queryKey: ["pi", "levels", project, state?.model?.id], queryFn: () => request<{ levels: string[] }>({ type: "get_available_thinking_levels" }, 30000, project), enabled: online });
  const availableLevels = levels.data?.levels ?? [];
  const hasEffort = availableLevels.some(level => level !== "off");
  const configuredModels = state?.model?.provider ? (models.data?.models ?? []).filter(model => model.provider === state.model?.provider) : [];
  const query = search.trim().toLowerCase();
  const visibleModels = query ? configuredModels.filter(model => `${model.name} ${model.id}`.toLowerCase().includes(query)) : configuredModels;
  const effortIndex = Math.max(0, availableLevels.indexOf(state?.thinkingLevel ?? "off"));
  const effortProgress = availableLevels.length > 1 ? effortIndex / (availableLevels.length - 1) * 100 : 0;

  async function choose(command: Parameters<typeof request>[0]) {
    try {
      await request(command, 30000, project);
      const next = await request<typeof state>({ type: "get_state" }, 30000, project);
      if (command.type === "set_model") {
        if (next?.model?.provider !== command.provider || next.model.id !== command.modelId) throw new Error("Pi 没有确认模型切换");
        await persistDefaultModel(command.provider, command.modelId);
      }
      useWorkspace.getState().set({ state: next });
    } catch (error) { report(error); }
  }

  if (models.isLoading) return <div className="composer-selectors"><span className="studio-model-loading" aria-busy="true"><Skeleton className="studio-model-loading-icon" /><Skeleton className="studio-model-loading-label" /></span></div>;
  return <div className="composer-selectors"><Popover open={open} onOpenChange={next => { setOpen(next); if (!next) setSearch(""); }}>
    <PopoverTrigger render={<button type="button" className="composer-model-control" disabled={!online || streaming} aria-label="选择模型和思考强度" />}>
      {state?.model && <ModelLogo modelId={state.model.id} size={18} />}<span>{state?.model ? composerModelLabel(state.model.id, state.model.name) : "选择模型"}</span>{hasEffort && <><i aria-hidden>·</i><small>{effortLabel(state?.thinkingLevel)}</small></>}<Icon name="caret-down" />
    </PopoverTrigger>
    <PopoverContent side="top" align="start" sideOffset={10} className="composer-model-menu">
      {hasEffort && <section className="composer-effort-tuner"><div><span>Effort</span><strong>{effortLabel(state?.thinkingLevel)}</strong></div><input type="range" min={0} max={availableLevels.length - 1} step={1} value={effortIndex} aria-label="思考强度" style={{ "--effort-progress": `${effortProgress}%` } as CSSProperties} onChange={event => { const level = availableLevels[Number(event.target.value)]; if (level) void choose({ type: "set_thinking_level", level: level as "high" }); }} /><div className="composer-effort-scale"><span>{effortLabel(availableLevels[0])}</span><span>{effortLabel(availableLevels.at(-1))}</span></div></section>}
      <section className="composer-model-picker"><label className="composer-model-search"><Icon name="magnifying-glass" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索模型" /></label><div className="composer-model-options">{visibleModels.map(model => { const active = state?.model?.provider === model.provider && state.model.id === model.id; return <button type="button" className={active ? "active" : ""} aria-pressed={active} key={`${model.provider}/${model.id}`} onClick={() => void choose({ type: "set_model", provider: model.provider, modelId: model.id })}><ModelLogo modelId={model.id} size={18} /><span>{composerModelLabel(model.id, model.name)}</span></button>; })}{visibleModels.length === 0 && <p className="composer-model-empty">没有匹配的模型</p>}</div></section>
    </PopoverContent>
  </Popover></div>;
}
