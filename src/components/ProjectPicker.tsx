import {useState} from 'react'
import {FolderClosed} from 'lucide-react'
import {Popover,PopoverContent,PopoverTrigger} from '@/components/ui/popover'
import {open} from '@tauri-apps/plugin-dialog'
import {useProjects,type Project} from '../lib/projects'
import {useWorkspace} from '../lib/store'
import {connect,desktopRuntime,forgetProject,report} from '../lib/rpc'
import {Button,Input,Modal} from './UI'
import {Icon} from './Icon'
import {gooeyToast} from 'goey-toast'
import {ContextMenu,ContextMenuContent,ContextMenuItem,ContextMenuSeparator,ContextMenuTrigger} from './ui/context-menu'

function HomeProjectOption({selected,busy,homeDir,onChoose}:{selected:boolean;busy:boolean;homeDir:string;onChoose:()=>void}){
 return <ContextMenu>
  <ContextMenuTrigger render={<div/>}><Button className={`project-home-option ${selected?'selected':''}`} aria-current={selected?'true':undefined} disabled={busy||!homeDir} onClick={onChoose}><Icon name="desktop"/><span className="project-option-copy"><strong>不在目录中工作</strong><small title={homeDir}>{homeDir||'用户主目录'}</small></span>{selected&&<span className="project-option-active">当前</span>}</Button></ContextMenuTrigger>
  <ContextMenuContent className="w-44"><ContextMenuItem disabled={busy||!homeDir} onClick={onChoose}><Icon name="desktop"/>切换到主目录</ContextMenuItem><ContextMenuItem disabled={!homeDir} onClick={()=>void navigator.clipboard.writeText(homeDir)}><Icon name="copy"/>复制路径</ContextMenuItem></ContextMenuContent>
 </ContextMenu>
}

function ProjectOption({project,selected,busy,onChoose,onDelete}:{project:Project;selected:boolean;busy:boolean;onChoose:()=>void;onDelete:()=>void}){
 return <ContextMenu>
  <ContextMenuTrigger render={<div className={`project-option ${selected?'selected':''}`}/>}>
   <Button aria-current={selected?'true':undefined} className="project-option-main" disabled={busy} onClick={onChoose}><Icon name="folder-simple"/><span className="project-option-copy"><strong>{project.name}</strong><small title={project.path}>{project.path}</small></span>{selected&&<span className="project-option-active">当前</span>}</Button>
   <Button className="project-option-remove" aria-label={`从列表移除 ${project.name}`} disabled={busy} onClick={onDelete}><Icon name="trash"/></Button>
  </ContextMenuTrigger>
  <ContextMenuContent className="w-44"><ContextMenuItem disabled={busy} onClick={onChoose}><Icon name="folder-simple"/>切换到项目</ContextMenuItem><ContextMenuItem onClick={()=>void navigator.clipboard.writeText(project.path)}><Icon name="copy"/>复制路径</ContextMenuItem><ContextMenuSeparator/><ContextMenuItem variant="destructive" disabled={busy} onClick={onDelete}><Icon name="trash"/>从列表移除</ContextMenuItem></ContextMenuContent>
 </ContextMenu>
}
export function ProjectPicker({compact=false}:{compact?:boolean}){
 const {projects,add,remove}=useProjects(),cwd=useWorkspace(s=>s.cwd),homeDir=useWorkspace(s=>s.homeDir),workspaceMode=useWorkspace(s=>s.workspaceMode),[visible,setVisible]=useState(false),[search,setSearch]=useState(''),[busy,setBusy]=useState(false),[deleting,setDeleting]=useState<Project|null>(null)
 const name=workspaceMode==='home'?'不在目录中工作':projects.find(p=>p.path===cwd)?.name||cwd.split('/').filter(Boolean).at(-1)||'选择项目'
 async function choose(path:string){setVisible(false);setBusy(true);try{await connect(path,'project')}catch(e){report(e)}finally{setBusy(false)}}
 async function chooseHome(){if(!homeDir)return;setVisible(false);setBusy(true);try{await connect(homeDir,'home')}catch(e){report(e)}finally{setBusy(false)}}
 async function addProjects(){if(!desktopRuntime()){report('请在电脑端选择文件夹');return}const selected=await open({directory:true,multiple:true,title:'添加项目',defaultPath:cwd||undefined});if(!selected)return;const paths=Array.isArray(selected)?selected:[selected];add(paths);await choose(paths[0].replace(/\/+$/,'')||'/')}
 async function removeWorkspace(){
  if(!deleting)return
  const target=deleting
  const fallback=projects.find(project=>project.path!==target.path)
  setBusy(true)
  try{
   await forgetProject(target.path)
   if(target.path===cwd){
    if(fallback)await connect(fallback.path,'project')
    else {localStorage.removeItem('pi-gui.cwd');useWorkspace.getState().set({cwd:'',panel:'chat'})}
   }
   remove(target.path)
   setDeleting(null)
   gooeyToast.success('已从列表移除工作区',{description:'磁盘上的项目文件未被删除',showTimestamp:false})
  }catch(error){report(error)}finally{setBusy(false)}
 }
 const visibleProjects=projects.flatMap(p=>`${p.name} ${p.path}`.toLowerCase().includes(search.toLowerCase())?[p]:[])
 return <>
  <Popover open={visible} onOpenChange={setVisible}>
   <PopoverTrigger render={<Button className={compact?'project-chip':'project-switch'} disabled={busy}/> }><FolderClosed className="project-picker-folder" strokeWidth={1.7} aria-hidden="true"/><span>{name}</span><Icon name="caret-up-down"/></PopoverTrigger>
   <PopoverContent align="start" className="project-menu">
    <div className="project-menu-heading"><span>工作区</span><small>{projects.length} 个项目</small></div>
    <HomeProjectOption selected={workspaceMode==='home'} busy={busy} homeDir={homeDir} onChoose={()=>void chooseHome()}/>
    <label className="project-search"><Icon name="magnifying-glass"/><Input autoFocus aria-label="搜索项目" placeholder="搜索项目" value={search} onChange={e=>setSearch(e.target.value)}/></label>
    <div className="project-options">{visibleProjects.map(project=><ProjectOption key={project.path} project={project} selected={workspaceMode==='project'&&project.path===cwd} busy={busy} onChoose={()=>void choose(project.path)} onDelete={()=>{setDeleting(project);setVisible(false)}}/>)}</div>
    {visibleProjects.length===0&&<p className="project-empty">没有匹配的项目</p>}
    <Button className="add-project" disabled={!desktopRuntime()} onClick={()=>void addProjects().catch(report)}><Icon name="plus"/><span>添加项目</span></Button>
   </PopoverContent>
  </Popover>
  <Modal open={!!deleting} title="移除工作区" onCancel={()=>setDeleting(null)} onOk={()=>void removeWorkspace()} okText="从列表移除" cancelText="取消" destructive><div className="remove-workspace-copy"><strong>{deleting?.name}</strong><code>{deleting?.path}</code><p>只会从工作区列表移除，不会删除磁盘上的项目文件。</p>{workspaceMode==='project'&&deleting?.path===cwd&&<p>{projects.length>1?'这是当前工作区，移除后会自动切换到另一个工作区。':'这是当前工作区，移除后会回到空的工作区状态。'}</p>}</div></Modal>
 </>
}
