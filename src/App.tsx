import {ProjectPicker} from './components/ProjectPicker'
import {useProjects} from './lib/projects'
import {Button, Modal} from './components/UI'
import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { AnimatePresence } from 'motion/react'
import {Inspector} from './components/Inspector'
import {MetricsSync} from './lib/metrics'
import { useQuery } from '@tanstack/react-query'
import { useWorkspace, type Panel as PanelName } from './lib/store'
import { native, connect, report, changeSession, deleteSession } from './lib/rpc'
import type { Session } from './lib/protocol'
import { Icon } from './components/Icon'
import { Chat } from './components/Chat'
import { Panel, ExtensionDialog } from './components/Panels'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from './components/ui/resizable'
import { Trash2 } from 'lucide-react'
import { gooeyToast } from 'goey-toast'
import './styles/workspace-base.css'
import './App.css'
const navigation:{id:PanelName;label:string;icon:string}[]=[{id:'chat',label:'工作台',icon:'chat-circle-text'},{id:'sessions',label:'所有会话',icon:'chats'},{id:'tree',label:'会话树',icon:'tree-structure'},{id:'commands',label:'技能与命令',icon:'puzzle-piece'},{id:'pi-tools',label:'常用工具',icon:'wrench'},{id:'changes',label:'代码变更',icon:'code'},{id:'console',label:'控制台',icon:'terminal-window'}]
let started=false
export default function App(){
 const panel=useWorkspace(s=>s.panel),cwd=useWorkspace(s=>s.cwd),connection=useWorkspace(s=>s.connection),state=useWorkspace(s=>s.state),running=useWorkspace(s=>s.transcript.running),dialogs=useWorkspace(s=>s.dialogs),statuses=useWorkspace(s=>s.statuses),inspector=useWorkspace(s=>s.inspector)
 const online=connection==='online'
 const [deletingSession,setDeletingSession]=useState<Session|null>(null)
 const discovery=useQuery({queryKey:['discovery'],queryFn:()=>invoke<{pi:string;node:string;version:string;cwd:string}>('discover'),enabled:native})
 const sessions=useQuery({queryKey:['pi','sessions',cwd],queryFn:()=>invoke<Session[]>('list_sessions',{cwd}),enabled:native&&Boolean(cwd)})
 async function removeRecentSession(){
   if(!deletingSession)return
   try{
     const wasCurrent=deletingSession.path===state?.sessionFile
     await deleteSession(deletingSession.path)
     setDeletingSession(null)
     if(wasCurrent)await changeSession({type:'new_session'})
     await sessions.refetch()
     gooeyToast.success('会话已删除',{showTimestamp:false})
   }catch(error){report(error)}
 }
 useEffect(()=>{
   if(!discovery.data||started)return
   started=true;const path=localStorage.getItem('pi-gui.cwd')||discovery.data.cwd
   useProjects.getState().add([path])
   useWorkspace.getState().set({cwd:path,piVersion:discovery.data.version})
   void connect(path).catch(report)
 },[discovery.data])
 useEffect(()=>{
   if(discovery.error)useWorkspace.getState().set({error:String(discovery.error)})
 },[discovery.error])
 useEffect(()=>{
   const handler=(event:KeyboardEvent)=>{
    if(!(event.metaKey||event.ctrlKey))return
    if(event.key==='n'){event.preventDefault();if(online&&!running)void changeSession({type:'new_session'}).catch(report)}
    if(event.key===','){event.preventDefault();useWorkspace.getState().set({panel:'settings'})}
   };window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler)
 },[online,running])
 return <main className="app-shell">
   <ResizablePanelGroup
    key="workspace-layout-v4"
    id="workspace-layout"
    orientation="horizontal"
   >
   <ResizablePanel id="sidebar" defaultSize="240px" minSize="200px" maxSize="280px" groupResizeBehavior="preserve-pixel-size">
   <aside className="sidebar">
    <div className="brand"><Icon name="sparkle" className="size-5 text-foreground" /><strong>Workspace</strong></div>
    <ProjectPicker/>
    <Button className="new-session" disabled={!online||running} onClick={()=>void changeSession({type:'new_session'}).catch(report)}><Icon name="plus"/>新建会话<kbd>⌘ N</kbd></Button>
    <nav aria-label="主导航">{navigation.map(item=><Button key={item.id} className={`nav-item ${panel===item.id?'selected':''}`} onClick={()=>useWorkspace.getState().set({panel:item.id})}><Icon name={item.icon}/><span>{item.label}</span>{item.id==='commands'&&<Icon name="arrow-up-right"/>}</Button>)}</nav>
    <div className="sidebar-section-title"><span>最近会话</span><Button title="查看所有会话" onClick={()=>useWorkspace.getState().set({panel:'sessions'})}><Icon name="dots-three"/></Button></div>
    <div className="recent-sessions">{sessions.data?.slice(0,8).map(session=><div className={`recent-session-row ${session.path===state?.sessionFile?'active':''}`} key={session.id}><button type="button" className="recent-session-main" disabled={!online||running} onClick={()=>void changeSession({type:'switch_session',sessionPath:session.path}).catch(report)}><Icon name="chat-circle"/><span>{session.name||session.firstMessage||'未命名会话'}</span></button><button type="button" className="recent-session-delete" title="删除会话" aria-label={`删除会话 ${session.name||session.firstMessage||'未命名会话'}`} disabled={!online||running} onClick={(event)=>{event.stopPropagation();setDeletingSession(session)}}><Trash2/></button></div>)}{!sessions.data?.length&&<p>你的会话会保存在这里。</p>}</div>
    <div className="sidebar-bottom"><Button className={`nav-item ${panel==='settings'?'selected':''}`} onClick={()=>useWorkspace.getState().set({panel:'settings'})}><Icon name="gear-six"/>设置<kbd>⌘ ,</kbd></Button></div>
   </aside>
   </ResizablePanel>
   <ResizableHandle />
   <ResizablePanel id="workspace" minSize="420px" groupResizeBehavior="preserve-relative-size">
   <section className="workspace">
    <MetricsSync/><div className="work-content"><div className="main-content"><div className="chat-host" hidden={panel!=='chat'}><Chat key={cwd}/></div><AnimatePresence mode="wait">{panel!=='chat'&&<Panel key={panel}/>}</AnimatePresence></div></div>
    {Object.entries(statuses).flatMap(([key,value])=>!key.startsWith('gui-')&&value?[<div key={key} className="extension-status">{key}: {value}</div>]:[])}
   </section>
   </ResizablePanel>
   {inspector&&<>
    <ResizableHandle />
    <ResizablePanel id="inspector" defaultSize="300px" minSize="260px" maxSize="380px" groupResizeBehavior="preserve-pixel-size">
     <Inspector/>
    </ResizablePanel>
   </>}
   </ResizablePanelGroup>
   <Modal open={!!deletingSession} title="删除会话" onCancel={()=>setDeletingSession(null)} onOk={()=>void removeRecentSession()} okText="删除" cancelText="取消">删除后无法恢复：{deletingSession?.name||deletingSession?.firstMessage||'未命名会话'}</Modal>
   {dialogs[0]&&<ExtensionDialog key={dialogs[0].id} dialog={dialogs[0]}/>}
  </main>
}
