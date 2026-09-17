import { useEffect, useMemo, useState } from 'react'
import {MetricsSync} from './lib/metrics'
import { useWorkspace } from './lib/store'
import { compactTitle } from './lib/session-visual'
import { Panel, ExtensionDialog } from './components/Panels'
import { WorkspaceTitlebar } from './components/workspace/WorkspaceTitlebar'
import { WorkspaceLayout } from './components/workspace/WorkspaceLayout'
import { mergeProjectSessions, useProjectSessions } from './hooks/use-project-sessions'
import { useWorkspaceBootstrap, useWorkspaceShortcuts } from './hooks/use-workspace-shell'
import './styles/workspace-base.css'
import './App.css'
export default function App(){
 const panel=useWorkspace(s=>s.panel)
 const cwd=useWorkspace(s=>s.cwd)
 const connection=useWorkspace(s=>s.connection)
 const state=useWorkspace(s=>s.state)
 const dialogs=useWorkspace(s=>s.dialogs)
 const liveSessions=useWorkspace(s=>s.liveSessions)
 const online=connection==='online'
 const [sidebarOpen,setSidebarOpen]=useState(()=>localStorage.getItem('pi-gui.sidebarOpen')!=='false')
 useWorkspaceBootstrap()
 useWorkspaceShortcuts(online,setSidebarOpen)
 const sessions=useProjectSessions(cwd)
 useEffect(()=>{localStorage.setItem('pi-gui.sidebarOpen',String(sidebarOpen))},[sidebarOpen])
 const merged=useMemo(()=>mergeProjectSessions(cwd,sessions.data??[],liveSessions),[cwd,sessions.data,liveSessions])
 const recentSessions=merged.sessions.slice(0,8)
 const currentSession=recentSessions.find(session=>session.path===state?.sessionFile)
 const rawHeaderTitle=panel==='chat'?(currentSession?.name||currentSession?.firstMessage||''):panel==='settings'?'设置':panel==='commands'?'技能与命令':'Orbit'
 const headerTitle=panel==='chat'?compactTitle(rawHeaderTitle):rawHeaderTitle
 const toggleSidebar=()=>setSidebarOpen(value=>!value)
 return <main className={`app-shell ${sidebarOpen?'':'sidebar-collapsed'}`}>
   {panel==='settings'?<>
    <WorkspaceTitlebar variant="full" sidebarOpen={sidebarOpen} onToggleSidebar={toggleSidebar} title={headerTitle} rawTitle={rawHeaderTitle}/>
    <section className="settings-root"><MetricsSync/><Panel/></section>
   </>:<WorkspaceLayout sidebarOpen={sidebarOpen} onToggleSidebar={toggleSidebar} online={online} panel={panel} title={headerTitle} rawTitle={rawHeaderTitle} sessions={recentSessions} listedPaths={merged.listedPaths} liveSessions={liveSessions} currentSessionFile={state?.sessionFile} onSessionsChanged={sessions.refetch}/>}
   {dialogs[0]&&<ExtensionDialog key={dialogs[0].id} dialog={dialogs[0]}/>}
  </main>
}
