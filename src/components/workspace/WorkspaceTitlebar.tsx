import { FolderClosed, LoaderCircle, WifiOff } from "lucide-react";
import { Button } from "../UI";
import { Icon } from "../Icon";
import { useWorkspace } from "../../lib/store";
import { useWindowDrag } from "../../hooks/use-window-drag";
import { ComposerContext } from "../chat/ComposerContext";

function Navigation({ sidebarOpen, onToggleSidebar }: { sidebarOpen: boolean; onToggleSidebar: () => void }) {
  return <div className="titlebar-navigation">
    <Button className="titlebar-button" title={sidebarOpen ? "收起侧栏" : "展开侧栏"} onClick={onToggleSidebar}><Icon name="sidebar-simple" /></Button>
    <Button className="titlebar-button" title="后退" disabled><Icon name="arrow-left" /></Button>
    <Button className="titlebar-button" title="前进" disabled><Icon name="arrow-right" /></Button>
  </div>;
}

type WorkspaceTitlebarProps = {
  variant: "sidebar" | "workspace" | "inspector" | "full";
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  title?: string;
  rawTitle?: string;
  showMenu?: boolean;
};

export function WorkspaceTitlebar({ variant, sidebarOpen, onToggleSidebar, title, rawTitle, showMenu }: WorkspaceTitlebarProps) {
  const dragRef = useWindowDrag();
  const runtimeTarget = useWorkspace(state => state.runtimeTarget);
  const connection = useWorkspace(state => state.connection);
  const showNavigation = variant === "sidebar" || variant === "full" || (variant === "workspace" && !sidebarOpen);
  const showContent = variant === "workspace" || variant === "full";
  const className = variant === "workspace" && !sidebarOpen
    ? "app-header app-header-workspace app-header-workspace-full"
    : `app-header app-header-${variant}`;
  return <header ref={dragRef} className={className} data-tauri-drag-region aria-hidden={variant === "inspector" || undefined}>
    {showNavigation && <Navigation sidebarOpen={sidebarOpen} onToggleSidebar={onToggleSidebar} />}
    {showNavigation && showContent && <span className="titlebar-divider" aria-hidden />}
    {showContent && <>
      <FolderClosed className="app-header-folder" strokeWidth={1.7} aria-hidden="true" />
      <strong className="app-header-title" title={rawTitle || title}>{title}</strong>
      {runtimeTarget === "mobile" && connection !== "online" && <span className="titlebar-remote-status" aria-live="polite">{connection === "connecting" ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <WifiOff aria-hidden="true" />}{connection === "connecting" ? "正在重连电脑" : "电脑已断开"}</span>}
      {runtimeTarget === "mobile" && showContent && <div className="app-header-context"><ComposerContext placement="header" /></div>}
      {showMenu && <Button className="titlebar-button app-header-more" title="会话管理" onClick={() => useWorkspace.getState().set({ panel: "settings", settingsPage: "sessions" })}><Icon name="dots-three" /></Button>}
    </>}
  </header>;
}
