import { m } from "motion/react";
import { setMultiAgentMode, report } from "../../lib/rpc";
import { useWorkspace } from "../../lib/store";
import { Icon } from "../Icon";

const modes = [
  { multiAgent: false, label: "标准模式", icon: "fluent-color:bot-sparkle-24" },
  { multiAgent: true, label: "协作模式", icon: "fluent-color:people-team-24" },
] as const;

export function ComposerAgentMode() {
  const enabled = useWorkspace(state => state.multiAgentEnabled);
  const online = useWorkspace(state => state.connection === "online");
  const running = useWorkspace(state => state.transcript.running);
  return <div className="composer-agent-mode" role="group" aria-label="执行模式">
    {modes.map(({ multiAgent, label, icon }) => {
      const selected = enabled === multiAgent;
      return <button key={label} type="button" className={selected ? "selected" : ""} aria-label={label} title={running ? "任务运行中不可切换" : label} aria-pressed={selected} disabled={!online || running} onClick={() => { if (!selected) void setMultiAgentMode(multiAgent).catch(report); }}>
        {selected && <m.span layoutId="composer-agent-mode-indicator" className="composer-agent-mode-indicator" transition={{ type: "spring", stiffness: 520, damping: 38 }} />}
        <span className="composer-agent-mode-content">
          <Icon name={icon} className="composer-agent-mode-icon" />
        </span>
      </button>;
    })}
  </div>;
}
