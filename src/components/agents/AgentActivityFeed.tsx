import { createAvatar } from "@dicebear/core";
import * as bottts from "@dicebear/bottts";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { elapsedMs, formatAgentElapsed, hasRunningAgents, type AgentNode, type AgentSnapshot } from "../../lib/agents";
import "./agent-activity.css";

type AgentActivityFeedProps = {
  snapshot: AgentSnapshot;
  onOpenAgent?: (agent: AgentNode) => void;
};

function AgentAvatar({ agent }: { agent: AgentNode }) {
  const source = useMemo(() => createAvatar(bottts, { seed: agent.id }).toDataUri(), [agent.id]);
  return <span className="agent-feed-avatar" aria-hidden="true"><img src={source} alt="" /></span>;
}

function statusText(agent: AgentNode) {
  if (agent.status === "running") return agent.summary || "正在处理";
  if (agent.status === "queued") return "等待启动";
  if (agent.status === "completed") return "已完成";
  if (agent.status === "aborted") return "已中止";
  if (agent.status === "failed") return agent.error || "执行失败";
  return agent.summary || "状态更新";
}

function AgentLine({ agent, depth, now, onOpenAgent }: { agent: AgentNode; depth: number; now: number; onOpenAgent?: (agent: AgentNode) => void }) {
  const canOpen = Boolean(agent.sessionPath) && ["completed", "failed", "aborted"].includes(agent.status);
  const content = <>
    <AgentAvatar agent={agent} />
    <span className="agent-feed-copy"><strong>{agent.name}</strong><span className={agent.status === "running" ? "agent-feed-shimmer" : undefined}>{statusText(agent)}</span></span>
    <time>{formatAgentElapsed(elapsedMs(agent, now))}</time>
  </>;
  const style = { "--agent-depth": depth } as CSSProperties;
  return <>
    {canOpen
      ? <button type="button" className={`agent-feed-line is-${agent.status}`} data-nested={depth > 0 || undefined} style={style} title="打开子会话" onClick={() => onOpenAgent?.(agent)}>{content}</button>
      : <div className={`agent-feed-line is-${agent.status}`} data-nested={depth > 0 || undefined} style={style}>{content}</div>}
    {agent.children.map(child => <AgentLine key={child.id} agent={child} depth={depth + 1} now={now} onOpenAgent={onOpenAgent} />)}
  </>;
}

export function AgentActivityFeed({ snapshot, onOpenAgent }: AgentActivityFeedProps) {
  const running = hasRunningAgents(snapshot);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  const roots = [...snapshot.active, ...snapshot.recent];
  if (roots.length === 0) return null;
  return <div className="agent-feed" aria-label="子 agent 活动">
    {roots.map(agent => <AgentLine key={agent.id} agent={agent} depth={0} now={now} onOpenAgent={onOpenAgent} />)}
  </div>;
}
