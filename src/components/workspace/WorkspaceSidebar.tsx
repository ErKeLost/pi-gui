import { useState } from "react";
import { gooeyToast } from "goey-toast";
import type { Session } from "../../lib/protocol";
import type { LiveSession, Panel } from "../../lib/store";
import { useWorkspace } from "../../lib/store";
import { changeSession, report, retireSession } from "../../lib/rpc";
import { sessionGlyph } from "../../lib/session-visual";
import { ProjectPicker } from "../ProjectPicker";
import { Button, Modal } from "../UI";
import { Icon } from "../Icon";
import { WorkspaceTitlebar } from "./WorkspaceTitlebar";

const navigation: { id: Panel; label: string; icon: string }[] = [
  { id: "chat", label: "工作台", icon: "chat-circle-text" },
  { id: "commands", label: "技能与命令", icon: "puzzle-piece" },
];

type WorkspaceSidebarProps = {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  online: boolean;
  panel: Panel;
  sessions: Session[];
  listedPaths: Set<string>;
  liveSessions: LiveSession[];
  currentSessionFile?: string;
  onSessionsChanged: () => Promise<unknown>;
};

export function WorkspaceSidebar(props: WorkspaceSidebarProps) {
  const { sidebarOpen, onToggleSidebar, online, panel, sessions, listedPaths, liveSessions, currentSessionFile, onSessionsChanged } = props;
  const [deleting, setDeleting] = useState<Session | null>(null);
  async function remove() {
    if (!deleting) return;
    try {
      await retireSession(deleting.path);
      setDeleting(null);
      await onSessionsChanged();
      gooeyToast.success("会话已删除", { showTimestamp: false });
    } catch (error) {
      report(error);
    }
  }
  return <div className="sidebar-pane">
    <WorkspaceTitlebar variant="sidebar" sidebarOpen={sidebarOpen} onToggleSidebar={onToggleSidebar} />
    <aside className="sidebar">
      <ProjectPicker />
      <Button variant="outline" className="new-session" disabled={!online} onClick={() => void changeSession({ type: "new_session" }).catch(report)}><Icon name="plus" />新建会话<kbd>⌘ N</kbd></Button>
      <nav aria-label="主导航">{navigation.map(item => <Button key={item.id} className={`nav-item ${panel === item.id ? "selected" : ""}`} onClick={() => useWorkspace.getState().set({ panel: item.id })}><Icon name={item.icon} /><span>{item.label}</span>{item.id === "commands" && <Icon name="arrow-up-right" />}</Button>)}</nav>
      <div className="sidebar-section-title"><span>最近会话</span><Button title="查看所有会话" onClick={() => useWorkspace.getState().set({ panel: "settings", settingsPage: "sessions" })}><Icon name="dots-three" /></Button></div>
      <div className="recent-sessions">{sessions.map(session => {
        const working = liveSessions.some(live => live.running && live.path === session.path);
        const label = session.name || session.firstMessage || "未命名会话";
        return <div className={`recent-session-row ${session.path === currentSessionFile ? "active" : ""}${working ? " working" : ""}`} key={session.id}>
          <button type="button" className="recent-session-main" disabled={!online} aria-busy={working} onClick={() => void changeSession({ type: "switch_session", sessionPath: session.path }).catch(report)}>{working ? <span className="session-working-indicator" title="正在工作" aria-hidden /> : <Icon name={sessionGlyph(label)} className="recent-session-glyph" />}<span className="recent-session-title">{label}</span></button>
          {listedPaths.has(session.path) && <button type="button" className="recent-session-delete" title="删除会话" aria-label={`删除会话 ${label}`} disabled={!online} onClick={event => { event.stopPropagation(); setDeleting(session); }}><Icon name="trash" /></button>}
        </div>;
      })}{!sessions.length && <p>你的会话会保存在这里。</p>}</div>
      <div className="sidebar-bottom"><Button className="nav-item" onClick={() => useWorkspace.getState().set({ panel: "settings", settingsPage: "general" })}><Icon name="gear-six" />设置<kbd>⌘ ,</kbd></Button></div>
    </aside>
    <Modal open={Boolean(deleting)} title="删除会话" onCancel={() => setDeleting(null)} onOk={() => void remove()} okText="删除" cancelText="取消">删除后无法恢复：{deleting?.name || deleting?.firstMessage || "未命名会话"}</Modal>
  </div>;
}
