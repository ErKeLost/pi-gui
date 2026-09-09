import {useState} from 'react'
import {Popover,PopoverContent,PopoverTrigger} from '@/components/ui/popover'
import {open} from '@tauri-apps/plugin-dialog'
import {useProjects} from '../lib/projects'
import {useWorkspace} from '../lib/store'
import {connect,native,report} from '../lib/rpc'
import {Button,Input} from './UI'
import {Icon} from './Icon'
export function ProjectPicker({compact=false}:{compact?:boolean}){
 const {projects,add}=useProjects(),cwd=useWorkspace(s=>s.cwd),[visible,setVisible]=useState(false),[search,setSearch]=useState(''),[busy,setBusy]=useState(false)
 const name=projects.find(p=>p.path===cwd)?.name||cwd.split('/').filter(Boolean).at(-1)||'选择项目'
 async function choose(path:string){setVisible(false);setBusy(true);try{await connect(path)}catch(e){report(e)}finally{setBusy(false)}}
 async function addProjects(){if(!native){report('请在桌面应用中选择文件夹');return}const selected=await open({directory:true,multiple:true,title:'添加项目',defaultPath:cwd||undefined});if(!selected)return;const paths=Array.isArray(selected)?selected:[selected];add(paths);await choose(paths[0].replace(/\/+$/,'')||'/')}
 const visibleProjects=projects.flatMap(p=>`${p.name} ${p.path}`.toLowerCase().includes(search.toLowerCase())?[p]:[])
 return <Popover open={visible} onOpenChange={setVisible}><PopoverTrigger render={<Button className={compact?'project-chip':'project-switch'} disabled={busy}/> }><Icon name="folder-simple"/><span>{name}</span><Icon name="caret-up-down"/></PopoverTrigger><PopoverContent align="start" className="project-menu"><Input autoFocus placeholder="搜索项目" value={search} onChange={e=>setSearch(e.target.value)}/><div className="project-options">{visibleProjects.map(p=><Button key={p.path} title={p.path} className={p.path===cwd?'selected':''} disabled={busy} onClick={()=>void choose(p.path)}><Icon name="folder-simple"/><span>{p.name}</span></Button>)}</div><Button className="add-project" onClick={()=>void addProjects().catch(report)}><Icon name="plus"/>添加项目</Button></PopoverContent></Popover>
}
