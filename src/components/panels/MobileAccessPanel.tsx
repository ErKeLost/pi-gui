import { useWorkspace } from "../../lib/store";
import { Icon } from "../Icon";
import { MobileAccessSettings } from "./GeneralSettingsPanel";

/** Standalone entry point for the desktop-to-phone connection controls. */
export function MobileAccessPanel() {
  const desktop = useWorkspace(state => state.runtimeTarget === "desktop");
  return <div className="mobile-access-panel">
    <div className="panel-heading">
      <div>
        <h1><Icon name="device-mobile" />移动端</h1>
        <p>{desktop ? "开启电脑 Host，把当前 Pi 工作区安全地连接到手机。" : "查看当前手机与电脑的连接状态。"}</p>
      </div>
    </div>
    <section className="mobile-access-surface" aria-label="手机连接">
      <MobileAccessSettings />
    </section>
  </div>;
}

export default MobileAccessPanel;
