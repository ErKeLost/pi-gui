import { useState } from "react";
import { MetalFx } from "metal-fx";
import { useTheme } from "next-themes";
import { useReducedMotion } from "motion/react";
import { Button } from "../ui/button";
import { Switch } from "../UI";
import { refresh, report, request } from "../../lib/rpc";
import {
  Context,
  ContextContent,
  ContextContentBody,
  ContextContentFooter,
  ContextContentHeader,
  ContextTrigger,
  ContextIcon,
} from "../ai-elements/context";
import { useMetrics } from "../../hooks/use-metrics";
import { useWorkspace } from "../../lib/store";

const format = (value: number | null | undefined) => value == null ? "待更新" : value.toLocaleString("zh-CN");

export function ComposerContext() {
  const { stats, runtime, online } = useMetrics();
  const state = useWorkspace(workspace => workspace.state);
  const compacting = useWorkspace(workspace => workspace.transcript.compacting);
  const { resolvedTheme } = useTheme();
  const reducedMotion = useReducedMotion();
  const connectionId = useWorkspace(workspace => workspace.connectionId);
  const running = useWorkspace(workspace => workspace.transcript.running || workspace.transcript.compacting);
  const [saving, setSaving] = useState(false);
  async function setAutoCompaction(enabled: boolean) {
    setSaving(true);
    try {
      await request({ type: "set_auto_compaction", enabled }, 30000, connectionId);
      await refresh(connectionId);
    } catch (error) { report(error); }
    finally { setSaving(false); }
  }
  const usage = stats?.contextUsage;
  const usedTokens = usage?.tokens ?? 0;
  const maxTokens = usage?.contextWindow ?? state?.model?.contextWindow ?? 1;
  const remaining = usage?.tokens == null ? null : Math.max(0, maxTokens - usage.tokens);
  const threshold = runtime ? Math.max(0, maxTokens - runtime.compaction.reserveTokens) : null;

  return <Context usedTokens={usedTokens} maxTokens={Math.max(1, maxTokens)}>
    <ContextTrigger showPercentage={false} className="composer-context-trigger" disabled={!online} title="上下文用量" aria-label="上下文用量">
      {compacting ? <MetalFx preset="chromatic" variant="circle" strength={1} innerShadow theme={resolvedTheme === "dark" ? "dark" : "light"} paused={!!reducedMotion} className="composer-context-metal">
        <Button type="button" variant="ghost" className="composer-context-trigger" title="正在压缩上下文" aria-label="正在压缩上下文" aria-busy="true"><ContextIcon /></Button>
      </MetalFx> : undefined}
    </ContextTrigger>
    <ContextContent side="top" align="end" sideOffset={10} className="composer-context-content">
      <ContextContentHeader />
      <ContextContentBody className="composer-context-body">
        <dl>
          <div><dt>已使用</dt><dd>{format(usage?.tokens)}</dd></div>
          <div><dt>剩余</dt><dd>{format(remaining)}</dd></div>
          <div><dt>模型最大输出</dt><dd>{format(state?.model?.maxTokens)}</dd></div>
          <div><dt>自动压缩阈值</dt><dd>{format(threshold)}</dd></div>
        </dl>
      </ContextContentBody>
      <ContextContentFooter className="composer-context-footer">
        <span>自动压缩</span>
        <Switch aria-label="自动压缩" checked={state?.autoCompactionEnabled ?? false} disabled={!online || !state || running || saving} onChange={enabled => void setAutoCompaction(enabled)} />
      </ContextContentFooter>
    </ContextContent>
  </Context>;
}
