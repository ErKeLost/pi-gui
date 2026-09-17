import { AnimatePresence } from "motion/react";
import type { Session } from "../../lib/protocol";
import type { LiveSession, Panel as PanelName } from "../../lib/store";
import { useWorkspace } from "../../lib/store";
import { MetricsSync } from "../../lib/metrics";
import { Chat } from "../Chat";
import { Inspector } from "../Inspector";
import { Panel } from "../Panels";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../ui/resizable";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
import { WorkspaceTitlebar } from "./WorkspaceTitlebar";

type WorkspaceLayoutProps = {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  online: boolean;
  panel: PanelName;
  title: string;
  rawTitle: string;
  sessions: Session[];
  listedPaths: Set<string>;
  liveSessions: LiveSession[];
  currentSessionFile?: string;
  onSessionsChanged: () => Promise<unknown>;
};

export function WorkspaceLayout(props: WorkspaceLayoutProps) {
  const { sidebarOpen, onToggleSidebar, online, panel, title, rawTitle, sessions, listedPaths, liveSessions, currentSessionFile, onSessionsChanged } = props;
  const cwd = useWorkspace(state => state.cwd);
  const connectionId = useWorkspace(state => state.connectionId);
  const inspector = useWorkspace(state => state.inspector);
  const statuses = useWorkspace(state => state.statuses);
  return <ResizablePanelGroup key="workspace-layout-v4" id="workspace-layout" orientation="horizontal">
    {sidebarOpen && <>
      <ResizablePanel id="sidebar" defaultSize="240px" minSize="200px" maxSize="280px" groupResizeBehavior="preserve-pixel-size">
        <WorkspaceSidebar {...{ sidebarOpen, onToggleSidebar, online, panel, sessions, listedPaths, liveSessions, currentSessionFile, onSessionsChanged }} />
      </ResizablePanel>
      <ResizableHandle />
    </>}
    <ResizablePanel id="workspace" minSize="420px" groupResizeBehavior="preserve-relative-size">
      <section className="workspace">
        <WorkspaceTitlebar variant="workspace" sidebarOpen={sidebarOpen} onToggleSidebar={onToggleSidebar} title={title} rawTitle={rawTitle} showMenu={panel === "chat"} />
        <MetricsSync />
        <div className="work-content"><div className="main-content"><div className="chat-host" hidden={panel !== "chat"}><Chat key={connectionId || cwd} /></div><AnimatePresence mode="wait">{panel !== "chat" && <Panel key={panel} />}</AnimatePresence></div></div>
        {Object.entries(statuses).flatMap(([key, value]) => !key.startsWith("gui-") && value ? [<div key={key} className="extension-status">{key}: {value}</div>] : [])}
      </section>
    </ResizablePanel>
    {inspector && <>
      <ResizableHandle />
      <ResizablePanel id="inspector" defaultSize="300px" minSize="260px" maxSize="380px" groupResizeBehavior="preserve-pixel-size">
        <section className="inspector-pane"><WorkspaceTitlebar variant="inspector" sidebarOpen={sidebarOpen} onToggleSidebar={onToggleSidebar} /><Inspector /></section>
      </ResizablePanel>
    </>}
  </ResizablePanelGroup>;
}
