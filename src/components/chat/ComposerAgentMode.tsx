import { m } from "motion/react";
import { gooeyToast } from "goey-toast";
import { setComputerUseMode, setMultiAgentMode, report } from "../../lib/rpc";
import { useWorkspace } from "../../lib/store";
import { Icon } from "../Icon";

const modes = [
  { multiAgent: false, label: "标准模式", icon: "fluent-color:bot-sparkle-24" },
  { multiAgent: true, label: "协作模式", icon: "fluent-color:people-team-24" },
] as const;

export function ComposerAgentMode() {
  const enabled = useWorkspace(state => state.multiAgentEnabled);
  const computerUse = useWorkspace(state => state.computerUseEnabled);
  const online = useWorkspace(state => state.connection === "online");
  const running = useWorkspace(state => state.transcript.running);
  const desktop = useWorkspace(state => state.runtimeTarget === "desktop");
  return <div className="composer-session-modes">
    <div className="composer-agent-mode" role="group" aria-label="执行模式">
      {modes.map(({ multiAgent, label, icon }) => {
        const selected = enabled === multiAgent;
        return <button key={label} type="button" className={selected ? "selected" : ""} aria-label={label} title={running ? "任务运行中不可切换" : label} aria-pressed={selected} disabled={!online || running} onClick={() => { if (!selected) void setMultiAgentMode(multiAgent).catch(report); }}>
          {selected && <m.span layoutId="composer-agent-mode-indicator" className="composer-agent-mode-indicator" transition={{ type: "spring", stiffness: 520, damping: 38 }} />}
          <span className="composer-agent-mode-content">
            <Icon name={icon} className="composer-agent-mode-icon" />
          </span>
        </button>;
      })}
    </div>
    {desktop && <button type="button" className={`composer-computer-use${computerUse ? " selected" : ""}`} aria-label="电脑操作" title={running ? "任务运行中不可切换" : computerUse ? "电脑操作已开启，直接说要打开的网页或 App 即可" : "开启电脑操作后，用平常说话让助手点界面"} aria-pressed={computerUse} disabled={!online || running} onClick={() => void setComputerUseMode(!computerUse).then(() => gooeyToast.success(computerUse ? "电脑操作已关闭" : "电脑操作已开启，直接说要做什么即可", { showTimestamp: false })).catch(report)}>
      <Icon name="fluent-color:laptop-24" className="composer-agent-mode-icon" />
    </button>}
  </div>;
}
