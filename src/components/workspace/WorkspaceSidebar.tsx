import { useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { gooeyToast } from "goey-toast";
import type { Session } from "../../lib/protocol";
import type { LiveSession, Panel } from "../../lib/store";
import { useWorkspace } from "../../lib/store";
import { mergeProjects, useProjects, type Project } from "../../lib/projects";
import { changeSession, connect, desktopRuntime, forgetProject, queryClient, report, retireSession } from "../../lib/rpc";
import { mergeProjectSessions, useProjectSessionGroups } from "../../hooks/use-project-sessions";
import { sessionGlyph } from "../../lib/session-visual";
import { Button, Modal } from "../UI";
import { Icon } from "../Icon";
import { DeleteSessionDialog } from "../DeleteSessionDialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "../ui/context-menu";
import { WorkspaceTitlebar } from "./WorkspaceTitlebar";

const navigation: { id: Panel; label: string; icon: string }[] = [
  { id: "chat", label: "工作台", icon: "chat-circle-text" },
  { id: "commands", label: "技能与命令", icon: "puzzle-piece" },
  { id: "mobile-access", label: "移动端", icon: "plugs-connected" },
];

export type WorkspaceSidebarProps = {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  online: boolean;
  panel: Panel;
  liveSessions: LiveSession[];
  currentSessionFile?: string;
  hideTitlebar?: boolean;
  onNavigate?: () => void;
};

type SessionTarget = { session: Session; projectPath: string };

export function WorkspaceSidebar({ sidebarOpen, onToggleSidebar, online, panel, liveSessions, currentSessionFile, hideTitlebar = false, onNavigate }: WorkspaceSidebarProps) {
  const cwd = useWorkspace(state => state.cwd);
  const workspaceMode = useWorkspace(state => state.workspaceMode);
  const homeDir = useWorkspace(state => state.homeDir);
  const { projects, add, remove } = useProjects();
  const visibleProjects = useMemo(() => mergeProjects(projects, cwd && workspaceMode === "project" ? [cwd] : []), [cwd, projects, workspaceMode]);
  const sessionGroups = useProjectSessionGroups(visibleProjects.map(project => project.path));
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [busyProject, setBusyProject] = useState("");
  const [deletingSession, setDeletingSession] = useState<SessionTarget | null>(null);
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);

  async function chooseProject(path: string) {
    setBusyProject(path);
    setCollapsed(current => { const next = new Set(current); next.delete(path); return next; });
    try { await connect(path, "project"); onNavigate?.(); }
    catch (error) { report(error); }
    finally { setBusyProject(""); }
  }

  async function addProjects() {
    if (!desktopRuntime()) { report("请在电脑端选择文件夹"); return; }
    const selected = await open({ directory: true, multiple: true, title: "添加项目", defaultPath: cwd || undefined });
    if (!selected) return;
    const paths = (Array.isArray(selected) ? selected : [selected]).map(path => path.replace(/\/+$/, "") || "/");
    add(paths);
    setCollapsed(current => { const next = new Set(current); for (const path of paths) next.delete(path); return next; });
    await chooseProject(paths[0]);
  }

  async function openSession(projectPath: string, session: Session) {
    setBusyProject(projectPath);
    try {
      if (cwd !== projectPath || workspaceMode !== "project" || !online) await connect(projectPath, "project");
      await changeSession({ type: "switch_session", sessionPath: session.path });
      onNavigate?.();
    } catch (error) { report(error); }
    finally { setBusyProject(""); }
  }

  async function deleteSelectedSession() {
    if (!deletingSession) return;
    const target = deletingSession;
    try {
      await retireSession(target.session.path);
      setDeletingSession(null);
      await queryClient.invalidateQueries({ queryKey: ["pi", "sessions", target.projectPath] });
      gooeyToast.success("会话已删除", { showTimestamp: false });
    } catch (error) { report(error); }
  }

  async function removeSelectedProject() {
    if (!deletingProject) return;
    const target = deletingProject;
    const fallback = projects.find(project => project.path !== target.path);
    setBusyProject(target.path);
    try {
      await forgetProject(target.path);
      remove(target.path);
      setDeletingProject(null);
      if (target.path === cwd) {
        if (fallback) await connect(fallback.path, "project");
        else if (homeDir) await connect(homeDir, "home");
      }
      gooeyToast.success("已移除项目", { description: "磁盘文件不会被删除", showTimestamp: false });
    } catch (error) { report(error); }
    finally { setBusyProject(""); }
  }

  function setProjectExpanded(path: string, open: boolean) {
    setCollapsed(current => {
      const next = new Set(current);
      if (open) next.delete(path); else next.add(path);
      return next;
    });
  }

  return <div className="sidebar-pane">
    {!hideTitlebar && <WorkspaceTitlebar variant="sidebar" sidebarOpen={sidebarOpen} onToggleSidebar={onToggleSidebar} />}
    <aside className="sidebar">
      <Button variant="outline" className="new-session" disabled={!online} onClick={() => { onNavigate?.(); void changeSession({ type: "new_session" }).catch(report); }}><Icon name="plus" />新建会话<kbd>⌘ N</kbd></Button>
      <nav aria-label="主导航">{navigation.map(item => <Button key={item.id} className={`nav-item ${panel === item.id ? "selected" : ""}`} onClick={() => { useWorkspace.getState().set({ panel: item.id }); onNavigate?.(); }}><Icon name={item.icon} /><span>{item.label}</span>{item.id === "commands" && <Icon name="arrow-up-right" />}</Button>)}</nav>

      <div className="sidebar-library">
        <div className="sidebar-section-title sidebar-projects-title"><span><Icon name="folder-simple" />项目</span><Button title="添加项目" disabled={!desktopRuntime()} onClick={() => void addProjects().catch(report)}><Icon name="plus" /></Button></div>
        <div className="sidebar-project-groups">
          {visibleProjects.map((project, index) => {
            const group = sessionGroups[index];
            const merged = mergeProjectSessions(project.path, group?.query.data ?? [], liveSessions);
            const isActiveProject = workspaceMode === "project" && project.path === cwd;
            const isExpanded = !collapsed.has(project.path);
            return <Collapsible open={isExpanded} onOpenChange={open => setProjectExpanded(project.path, open)} className={`sidebar-project-group${isActiveProject ? " active" : ""}`} key={project.path}>
              <ContextMenu>
                <ContextMenuTrigger render={<div className="sidebar-project-row" />}>
                  <CollapsibleTrigger render={<button type="button" className="sidebar-project-main" disabled={busyProject === project.path} aria-current={isActiveProject ? "true" : undefined} onClick={event => { if (!isActiveProject) { event.preventDefault(); void chooseProject(project.path); } }} />}>
                    <Icon name={isExpanded ? "folder-open" : "folder-simple"} /><span title={project.path}>{project.name}</span>{busyProject === project.path && <i className="session-working-indicator" aria-hidden />}
                  </CollapsibleTrigger>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-52"><ContextMenuItem onClick={() => void chooseProject(project.path)}><Icon name="folder-simple" />打开项目</ContextMenuItem><ContextMenuItem onClick={() => void navigator.clipboard.writeText(project.path)}><Icon name="copy" />复制路径</ContextMenuItem><ContextMenuSeparator /><ContextMenuItem variant="destructive" onClick={() => setDeletingProject(project)}><Icon name="trash" />移除项目</ContextMenuItem></ContextMenuContent>
              </ContextMenu>
              <CollapsibleContent className="sidebar-project-panel"><div className="sidebar-project-sessions">
                {merged.sessions.map(session => {
                  const working = liveSessions.some(live => live.cwd === project.path && live.running && live.path === session.path);
                  const label = session.name || session.firstMessage || "未命名会话";
                  const active = isActiveProject && session.path === currentSessionFile;
                  return <ContextMenu key={session.id}>
                    <ContextMenuTrigger render={<div className={`recent-session-row ${active ? "active" : ""}${working ? " working" : ""}`} />}>
                      <button type="button" className="recent-session-main" aria-busy={working} onClick={() => void openSession(project.path, session)}>{working ? <span className="session-working-indicator" title="正在工作" aria-hidden /> : <Icon name={sessionGlyph(session.icon)} className="recent-session-glyph" />}<span className="recent-session-title">{label}</span></button>
                      {merged.listedPaths.has(session.path) && <button type="button" className="recent-session-delete" title="删除会话" aria-label={`删除会话 ${label}`} onClick={event => { event.stopPropagation(); setDeletingSession({ session, projectPath: project.path }); }}><Icon name="trash" /></button>}
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-52"><ContextMenuItem onClick={() => void openSession(project.path, session)}><Icon name="chats" />打开会话</ContextMenuItem><ContextMenuItem onClick={() => void navigator.clipboard.writeText(label)}><Icon name="copy" />复制标题</ContextMenuItem>{merged.listedPaths.has(session.path) && <><ContextMenuSeparator /><ContextMenuItem variant="destructive" onClick={() => setDeletingSession({ session, projectPath: project.path })}><Icon name="trash" />删除会话</ContextMenuItem></>}</ContextMenuContent>
                  </ContextMenu>;
                })}
                {!group?.query.isLoading && !merged.sessions.length && <p>暂无会话</p>}
              </div></CollapsibleContent>
            </Collapsible>;
          })}
          {!visibleProjects.length && <div className="sidebar-project-empty"><span>添加项目后，会话会按目录显示。</span></div>}
        </div>
      </div>

      <div className="sidebar-bottom">
        <Button className="nav-item" onClick={() => { useWorkspace.getState().set({ panel: "settings", settingsPage: "general" }); onNavigate?.(); }}><Icon name="gear-six" />设置<kbd>⌘ ,</kbd></Button>
      </div>
    </aside>
    <DeleteSessionDialog open={Boolean(deletingSession)} sessionName={deletingSession?.session.name || deletingSession?.session.firstMessage || "未命名会话"} onCancel={() => setDeletingSession(null)} onConfirm={() => void deleteSelectedSession()} />
    <Modal open={Boolean(deletingProject)} title="移除项目" onCancel={() => setDeletingProject(null)} onOk={() => void removeSelectedProject()} okText="移除" cancelText="取消" destructive><div className="remove-workspace-copy"><strong>{deletingProject?.name}</strong><code>{deletingProject?.path}</code><p>只会从侧栏移除，不会删除磁盘文件。</p></div></Modal>
  </div>;
}
