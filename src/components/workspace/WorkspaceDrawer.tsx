import { Dialog } from "@base-ui/react/dialog";
import type { ReactNode } from "react";
import type { LiveSession, Panel } from "../../lib/store";
import { Icon } from "../Icon";
import { Inspector } from "../Inspector";
import { Button } from "../ui/button";
import { WorkspaceSidebar } from "./WorkspaceSidebar";

type WorkspaceDrawerProps = {
  children: ReactNode;
  open: boolean;
  onClose: () => void;
  side: "left" | "right";
  title: string;
};

function WorkspaceDrawer({ children, open, onClose, side, title }: WorkspaceDrawerProps) {
  return <Dialog.Root open={open} onOpenChange={next => { if (!next) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Backdrop className="workspace-drawer-backdrop" />
      <Dialog.Popup className={`workspace-drawer workspace-drawer-${side}`}>
        <header className="workspace-drawer-header">
          <Dialog.Title className="workspace-drawer-title">{title}</Dialog.Title>
          <Dialog.Close render={<Button variant="ghost" size="icon" className="workspace-drawer-close" aria-label={`关闭${title}`} />}><Icon name="x" /></Dialog.Close>
        </header>
        <div className="workspace-drawer-body">{children}</div>
      </Dialog.Popup>
    </Dialog.Portal>
  </Dialog.Root>;
}

type WorkspaceNavigationDrawerProps = {
  open: boolean;
  onClose: () => void;
  online: boolean;
  panel: Panel;
  liveSessions: LiveSession[];
  currentSessionFile?: string;
};

export function WorkspaceNavigationDrawer(props: WorkspaceNavigationDrawerProps) {
  const { open, onClose, ...sidebarProps } = props;
  return <WorkspaceDrawer open={open} onClose={onClose} side="left" title="工作区">
    <WorkspaceSidebar {...sidebarProps} sidebarOpen={open} onToggleSidebar={onClose} onNavigate={onClose} hideTitlebar />
  </WorkspaceDrawer>;
}

export function WorkspaceInspectorDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <WorkspaceDrawer open={open} onClose={onClose} side="right" title="运行详情">
    <Inspector />
  </WorkspaceDrawer>;
}
