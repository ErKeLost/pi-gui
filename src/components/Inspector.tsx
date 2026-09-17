import { useWorkspace } from "../lib/store";
import { useMetrics } from "../hooks/use-metrics";
import { Button } from "./UI";
import { Icon } from "./Icon";
import {
  CompactionSection,
  ContextWindowSection,
  CurrentResponseSection,
  EventsSection,
  ModelSessionSection,
  QueueToolsSection,
  RetrySection,
  UsageSection,
} from "./inspector/InspectorSections";
import { formatNumber as number } from "../lib/format";

function toggleInspector() { useWorkspace.getState().set({ inspector: !useWorkspace.getState().inspector }); }

export function ContextBar() {
  const { stats, online } = useMetrics();
  const compaction = useWorkspace(state => state.telemetry.compaction);
  const state = useWorkspace(workspace => workspace.state);
  const usage = stats?.contextUsage;
  const context = online ? `${number(usage?.tokens)} / ${number(usage?.contextWindow ?? state?.model?.contextWindow)}` : "—";
  const autoCompaction = state ? state.autoCompactionEnabled ? "自动压缩开启" : "自动压缩关闭" : "自动压缩 —";
  return <div className="context-bar"><Button title="上下文与运行详情" onClick={toggleInspector}><Icon name="brain" />Context {context}{usage?.percent != null && ` · ${usage.percent.toFixed(1)}%`}</Button><span>{compaction?.status === "running" ? "正在压缩…" : autoCompaction}</span></div>;
}

export function Inspector() {
  const { stats, runtime, error, updatedAt, online } = useMetrics();
  const state = useWorkspace(workspace => workspace.state);
  const telemetry = useWorkspace(workspace => workspace.telemetry);
  const transcript = useWorkspace(workspace => workspace.transcript);
  const footer = error ? `状态读取失败：${String(error)}` : updatedAt ? `更新于 ${new Date(updatedAt).toLocaleTimeString()}` : "等待 Pi 数据";
  return <aside className="inspector">
    <header><strong>运行详情</strong></header>
    <div className="inspector-scroll">
      <ContextWindowSection stats={stats} state={state} runtime={runtime} />
      <CompactionSection telemetry={telemetry} transcript={transcript} online={online} state={state} />
      <UsageSection stats={stats} />
      <CurrentResponseSection telemetry={telemetry} transcript={transcript} />
      <QueueToolsSection stats={stats} state={state} transcript={transcript} />
      <RetrySection telemetry={telemetry} runtime={runtime} online={online} />
      <ModelSessionSection state={state} runtime={runtime} />
      <EventsSection telemetry={telemetry} />
    </div>
    <footer>{footer}</footer>
  </aside>;
}
