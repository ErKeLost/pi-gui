import {useState} from 'react'
import {Popover,PopoverContent,PopoverTrigger} from '@/components/ui/popover'
import {open} from '@tauri-apps/plugin-dialog'
import {useProjects,type Project} from '../lib/projects'
import {useWorkspace} from '../lib/store'
import {connect,disconnect,native,report} from '../lib/rpc'
import {Button,Input,Modal} from './UI'
import {Icon} from './Icon'
import {gooeyToast} from 'goey-toast'
export function ProjectPicker({compact=false}:{compact?:boolean}){
 const {projects,add,remove}=useProjects(),cwd=useWorkspace(s=>s.cwd),[visible,setVisible]=useState(false),[search,setSearch]=useState(''),[busy,setBusy]=useState(false),[deleting,setDeleting]=useState<Project|null>(null)
 const name=projects.find(p=>p.path===cwd)?.name||cwd.split('/').filter(Boolean).at(-1)||'选择项目'
 async function choose(path:string){setVisible(false);setBusy(true);try{await connect(path)}catch(e){report(e)}finally{setBusy(false)}}
 async function addProjects(){if(!native){report('请在桌面应用中选择文件夹');return}const selected=await open({directory:true,multiple:true,title:'添加项目',defaultPath:cwd||undefined});if(!selected)return;const paths=Array.isArray(selected)?selected:[selected];add(paths);await choose(paths[0].replace(/\/+$/,'')||'/')}
 async function removeWorkspace(){
  if(!deleting)return
  const target=deleting
  const fallback=projects.find(project=>project.path!==target.path)
  setBusy(true)
  try{
   if(target.path===cwd){
    await disconnect()
    if(fallback)await connect(fallback.path)
    else {localStorage.removeItem('pi-gui.cwd');useWorkspace.getState().set({cwd:'',panel:'chat'})}
   }
   remove(target.path)
   setDeleting(null)
   gooeyToast.success('已从列表移除工作区',{description:'磁盘上的项目文件未被删除',showTimestamp:false})
  }catch(error){report(error)}finally{setBusy(false)}
 }
 const visibleProjects=projects.flatMap(p=>`${p.name} ${p.path}`.toLowerCase().includes(search.toLowerCase())?[p]:[])
 return <><Popover open={visible} onOpenChange={setVisible}><PopoverTrigger render={<Button className={compact?'project-chip':'project-switch'} disabled={busy}/> }><Icon name="folder-simple"/><span>{name}</span><Icon name="caret-up-down"/></PopoverTrigger><PopoverContent align="start" className="project-menu"><div className="project-menu-heading"><span>工作区</span><small>{projects.length} 个项目</small></div><label className="project-search"><Icon name="magnifying-glass"/><Input autoFocus aria-label="搜索项目" placeholder="搜索项目" value={search} onChange={e=>setSearch(e.target.value)}/></label><div className="project-options">{visibleProjects.map(p=><div key={p.path} className={`project-option ${p.path===cwd?'selected':''}`}><Button aria-current={p.path===cwd?'true':undefined} className="project-option-main" disabled={busy} onClick={()=>void choose(p.path)}><Icon name="folder-simple"/><span className="project-option-copy"><strong>{p.name}</strong><small title={p.path}>{p.path}</small></span>{p.path===cwd&&<span className="project-option-active">当前</span>}</Button><Button className="project-option-remove" aria-label={`从列表移除 ${p.name}`} disabled={busy} onClick={()=>{setDeleting(p);setVisible(false)}}><Icon name="trash"/></Button></div>)}</div>{visibleProjects.length===0&&<p className="project-empty">没有匹配的项目</p>}<Button className="add-project" onClick={()=>void addProjects().catch(report)}><Icon name="plus"/><span>添加项目</span></Button></PopoverContent></Popover><Modal open={!!deleting} title="移除工作区" onCancel={()=>setDeleting(null)} onOk={()=>void removeWorkspace()} okText="从列表移除" cancelText="取消" destructive><div className="remove-workspace-copy"><strong>{deleting?.name}</strong><code>{deleting?.path}</code><p>只会从工作区列表移除，不会删除磁盘上的项目文件。</p>{deleting?.path===cwd&&<p>{projects.length>1?'这是当前工作区，移除后会自动切换到另一个工作区。':'这是当前工作区，移除后会回到空的工作区状态。'}</p>}</div></Modal></>
}
