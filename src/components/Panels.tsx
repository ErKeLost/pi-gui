import {m} from 'motion/react'
import {getChange} from '../lib/changes'
const CodeChange=lazy(()=>import('./CodeChange').then(module=>({default:module.CodeChange})))
import {Button,Select,Input,TextArea,Switch,Modal,usePrompt,Skeleton} from './UI'
import { useEffect, useState,lazy,Suspense,useMemo } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useQuery } from '@tanstack/react-query'
import type { RpcCommand, SessionTreeNode } from '@earendil-works/pi-coding-agent'
import { useWorkspace, type SettingsPage } from '../lib/store'
import { request, report, refresh, changeSession, connect, disconnect, native, loadMessages, answerDialog, deleteSession, getProjectTrustMode, setProjectTrustMode, type ProjectTrustMode } from '../lib/rpc'
import type { Session, UiRequest } from '../lib/protocol'
import { Icon } from './Icon'
import { ProviderSettings } from './ProviderSettings'
import { useTheme } from 'next-themes'
import { ModeToggle } from './mode-toggle'
import { open } from '@tauri-apps/plugin-dialog'
import { gooeyToast } from 'goey-toast'
import {commandSourceLabel,getCommandVisual} from '../lib/command-visual'
const format=(value:unknown)=>typeof value==='string'?value:JSON.stringify(value,null,2)
async function applySetting(command:RpcCommand){await request(command);await refresh();gooeyToast.success('设置已更新',{showTimestamp:false})}
export function Panel(){
 const panel=useWorkspace(s=>s.panel)
 return <m.section className={`panel-view ${panel==='settings'?'settings-panel-view':''}`} initial={{opacity:0,y:7}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-5}} transition={{duration:0.16}}>{panel==='sessions'?<Sessions/>:panel==='tree'?<Tree/>:panel==='commands'?<Commands/>:panel==='settings'?<Settings/>:panel==='changes'?<Changes/>:panel==='pi-tools'?<PiTools/>:<Console/>}</m.section>
}
export function Sessions(){
 const cwd=useWorkspace(s=>s.cwd),online=useWorkspace(s=>s.connection==='online'),running=useWorkspace(s=>s.transcript.running),currentSession=useWorkspace(s=>s.state?.sessionFile)
 const sessions=useQuery({queryKey:['pi','sessions',cwd],queryFn:()=>invoke<Session[]>('list_sessions',{cwd}),enabled:native&&Boolean(cwd)})
 const [search,setSearch]=useState(''),[deleting,setDeleting]=useState<Session|null>(null)
 async function remove(){if(!deleting)return;try{const path=deleting.path;await deleteSession(path);setDeleting(null);await sessions.refetch();if(path===currentSession)await changeSession({type:'new_session'});gooeyToast.success('会话已删除',{showTimestamp:false})}catch(error){report(error)}}
 const visibleSessions=sessions.data?.flatMap(s=>`${s.name} ${s.firstMessage}`.toLowerCase().includes(search.toLowerCase())?[s]:[])??[]
 return <><div className="panel-heading"><div><h1>会话</h1><p>保存在本机的项目对话。</p></div><Button className="primary" disabled={!online||running} onClick={()=>void changeSession({type:'new_session'}).catch(report)}><Icon name="plus"/>新会话</Button></div><Input className="search-input" placeholder="搜索会话" value={search} onChange={e=>setSearch(e.target.value)}/>{sessions.isLoading&&<Skeleton active paragraph={{rows:4}}/>}{sessions.error&&<p className="error-inline">{String(sessions.error)}</p>}<div className="session-rows">{visibleSessions.map(s=><div className="session-row" key={s.id}><Button disabled={!online||running} onClick={()=>void changeSession({type:'switch_session',sessionPath:s.path}).catch(report)}><Icon name="chats"/><span><strong>{s.name||s.firstMessage||'未命名会话'}</strong><small>{s.messageCount} 条消息 · {new Date(s.modified).toLocaleString('zh-CN')}</small></span><Icon name="arrow-up-right"/></Button><Button title="删除会话" disabled={!online||running} onClick={()=>setDeleting(s)}><Icon name="trash"/></Button></div>)}</div>{sessions.data?.length===0&&<div className="empty-panel"><Icon name="chats"/><h3>还没有保存的会话</h3><p>发送第一条消息后，Pi 会自动保存。</p></div>}<Modal open={!!deleting} title="删除会话" onCancel={()=>setDeleting(null)} onOk={()=>void remove()} okText="删除" cancelText="取消">删除后无法恢复：{deleting?.name||deleting?.firstMessage||'未命名会话'}</Modal></>
}
function TreeNode({node,leafId,depth=0,disabled}:{node:SessionTreeNode;leafId:string|null;depth?:number;disabled:boolean}){
 const ask=usePrompt()
 const entry=node.entry
 const text=entry.type==='message'?('content' in entry.message ? (typeof entry.message.content==='string'?entry.message.content:JSON.stringify(entry.message.content)) : JSON.stringify(entry.message)).slice(0,150):entry.type
 async function navigate(summarize=false){await request({type:'prompt',message:`/gui-tree ${JSON.stringify({id:entry.id,summarize})}`},60000);await loadMessages()}
 async function label(){const value=await ask({title:'为这个节点命名',initial:node.label??''});if(value===null)return;await request({type:'prompt',message:`/gui-label ${JSON.stringify({id:entry.id,label:value})}`});await refresh();gooeyToast.success('节点名称已更新',{showTimestamp:false})}
 return <div className="tree-node" style={{paddingLeft:depth?18:0}}><div className={`tree-entry ${entry.id===leafId?'current':''}`}><Icon name="git-commit"/><div><small>{entry.type==='message'?entry.message.role:entry.type}{entry.id===leafId?' · 当前分支':''}</small><p>{node.label||text}</p></div><Button title="从这里继续" disabled={disabled} onClick={()=>void navigate().catch(report)}><Icon name="arrow-bend-up-right"/></Button><Button title="从这里继续并总结" disabled={disabled} onClick={()=>void navigate(true).catch(report)}><Icon name="sparkle"/></Button><Button title="标签" disabled={disabled} onClick={()=>void label().catch(report)}><Icon name="bookmark-simple"/></Button>{entry.type==='message'&&entry.message.role==='user'&&<Button title="从这里创建分叉会话" disabled={disabled} onClick={()=>void changeSession({type:'fork',entryId:entry.id}).catch(report)}><Icon name="git-fork"/></Button>}</div>{node.children.map(child=><TreeNode key={child.entry.id} node={child} leafId={leafId} depth={depth+1} disabled={disabled}/>)}</div>
}
function Tree(){
 const online=useWorkspace(s=>s.connection==='online'),running=useWorkspace(s=>s.transcript.running)
 const tree=useQuery({queryKey:['pi','tree',useWorkspace(s=>s.cwd)],queryFn:()=>request<{tree:SessionTreeNode[];leafId:string|null}>({type:'get_tree'}),enabled:online})
 return <><div className="panel-heading"><div><h1>会话树</h1><p>查看历史节点、切换分支，或从一条消息重新开始。</p></div><Button className="secondary" disabled={!online||running} onClick={()=>void changeSession({type:'clone'}).catch(report)}><Icon name="copy"/>克隆当前分支</Button></div>{tree.error&&<p className="error-inline">{String(tree.error)}</p>}{tree.isLoading&&<Skeleton active paragraph={{rows:5}}/>}{tree.data?.tree.map(node=><TreeNode key={node.entry.id} node={node} leafId={tree.data!.leafId} disabled={!online||running}/>)}{!tree.data?.tree.length&&<div className="empty-panel"><Icon name="tree-structure"/><p>消息与分支会出现在这里。</p></div>}</>
}
function Commands(){
 const online=useWorkspace(s=>s.connection==='online')
 const data=useQuery({queryKey:['pi','commands',useWorkspace(s=>s.cwd)],queryFn:()=>request<{commands:{name:string;description?:string;source:string;sourceInfo?:{path?:string;origin?:string}}[]}>({type:'get_commands'}),enabled:online})
 const [search,setSearch]=useState('')
 const visibleCommands=data.data?.commands.flatMap(c=>!c.name.startsWith('gui-')&&`${c.name} ${c.description} ${c.sourceInfo?.path??''} ${c.sourceInfo?.origin??''}`.toLowerCase().includes(search.toLowerCase())?[c]:[])??[]
 const hasCommands=data.data?.commands.some(c=>!c.name.startsWith('gui-'))
 return <><div className="panel-heading"><div><h1>技能与命令</h1><p>Pi 当前加载的技能、提示模板和扩展命令。</p></div></div><Input className="search-input" placeholder="查找命令或技能" value={search} onChange={e=>setSearch(e.target.value)}/>{data.isLoading&&<Skeleton active paragraph={{rows:5}}/>}{data.error&&<p className="error-inline">{String(data.error)}</p>}<div className="command-list">{visibleCommands.map(command=>{const visual=getCommandVisual(command.name,command.source),location=command.sourceInfo?.path||command.sourceInfo?.origin;return <Button className="command-row" key={command.name} onClick={()=>useWorkspace.getState().set({draft:`/${command.name} `,panel:'chat'})}><span className={`command-icon command-icon-${visual.tone}`}><Icon name={visual.icon}/></span><span className="command-copy"><span className="command-title"><strong>/{command.name}</strong><span className={`command-source command-source-${command.source}`}>{commandSourceLabel(command.source)}</span></span><span className="command-description">{command.description||'没有提供说明'}</span>{location&&<span className="command-location" title={location}>{location}</span>}</span><Icon className="command-arrow" name="arrow-right"/></Button>})}</div>{data.data&&!hasCommands&&<div className="empty-panel"><Icon name="puzzle-piece"/><h3>还没有加载扩展或技能</h3><p>在 Pi 中安装后重新连接，就能从这里使用。</p></div>}</>
}
function PiTools(){
 const cwd=useWorkspace(s=>s.cwd), online=useWorkspace(s=>s.connection==='online'), running=useWorkspace(s=>s.transcript.running), ask=usePrompt(), [packageName,setPackageName]=useState('')
 async function command(message:string){try{await request({type:'prompt',message},60000,cwd);await refresh(cwd)}catch(error){report(error)}}
 async function terminalCommand(message:string){if(!native){report('该 Pi 功能需要桌面应用');return}try{await invoke('open_pi_terminal',{cwd,session:null,command:message});gooeyToast.info('已在终端打开 Pi 命令',{description:message,showTimestamp:false})}catch(error){report(error)}}
 async function importSession(){if(!native){report('会话导入需要桌面应用');return}const selected=await open({multiple:false,title:'导入 Pi 会话',filters:[{name:'Pi 会话',extensions:['jsonl']}]});if(typeof selected!=='string')return;await command(`/import ${JSON.stringify(selected)}`);await loadMessages(cwd);gooeyToast.success('会话已导入',{showTimestamp:false})}
 async function rename(){const name=await ask({title:'会话名称',initial:useWorkspace.getState().state?.sessionName??''});if(name===null)return;try{await request({type:'set_session_name',name},30000,cwd);await refresh(cwd);gooeyToast.success('会话名称已更新',{showTimestamp:false})}catch(error){report(error)}}
 async function copyLast(){try{const result=await request<{text:string|null}>({type:'get_last_assistant_text'},30000,cwd);if(result.text){await navigator.clipboard.writeText(result.text);gooeyToast.success('已复制最后一条助手消息',{showTimestamp:false})}else{gooeyToast.info('没有可复制的助手消息',{showTimestamp:false})}}catch(error){report(error)}}
 async function packageCommand(action:'install'|'update'|'remove'){if(!native){report('Pi Package 管理需要桌面应用');return}if(!packageName.trim()&&action!=='update'){report('请输入 Pi Package 名称');return}const quote=(value:string)=>`'${value.replaceAll("'", "'\\''")}'`;const cli=action==='install'?`pi install ${quote(packageName.trim())}`:action==='remove'?`pi remove ${quote(packageName.trim())}`:'pi update --extensions';try{await invoke('open_pi_terminal',{cwd,session:null,command:cli});setPackageName('')}catch(error){report(error)}}
 return <><div className="panel-heading"><div><h1>常用工具</h1><p>终端常用能力直接集成在桌面界面。</p></div></div>
  <section className="settings-section"><h2>会话操作</h2><div className="tool-action-grid"><Button disabled={!online||running} onClick={()=>void importSession().catch(report)}><Icon name="download"/>导入 JSONL</Button><Button disabled={!online} onClick={()=>void terminalCommand('/share').catch(report)}><Icon name="share-network"/>分享会话</Button><Button disabled={!online} onClick={()=>void rename().catch(report)}><Icon name="pencil-simple"/>重命名</Button><Button disabled={!online} onClick={()=>void copyLast().catch(report)}><Icon name="copy"/>复制最后回复</Button></div></section>
  <section className="settings-section"><h2>模型范围与资源</h2><div className="tool-action-grid"><Button disabled={!online||running} onClick={()=>void terminalCommand('/scoped-models').catch(report)}><Icon name="funnel"/>Scoped Models</Button><Button disabled={!online} onClick={()=>void command('/reload').then(()=>gooeyToast.success('资源已刷新',{showTimestamp:false})).catch(report)}><Icon name="arrows-clockwise"/>重新加载资源</Button><Button disabled={!online} onClick={()=>void terminalCommand('/hotkeys').catch(report)}><Icon name="keyboard"/>快捷键</Button><Button disabled={!online} onClick={()=>void terminalCommand('/changelog').catch(report)}><Icon name="list"/>变更记录</Button></div></section>
  <section className="settings-section"><h2>Pi Package</h2><div className="input-row"><Input value={packageName} onChange={event=>setPackageName(event.target.value)} placeholder="npm:包名 或 git:仓库" aria-label="Pi Package 名称"/><Button disabled={!online||running} onClick={()=>void packageCommand('install').catch(report)}>安装</Button></div><div className="tool-action-grid"><Button disabled={!online||running} onClick={()=>void packageCommand('update').catch(report)}>更新全部</Button><Button disabled={!online||running||!packageName.trim()} onClick={()=>void packageCommand('remove').catch(report)}>移除</Button></div></section>
  <section className="settings-section"><h2>资源来源</h2><p>技能与命令面板会显示 Pi 返回的 source 信息；扩展的状态、Widget、通知和交互请求会实时同步到当前项目。</p><Button disabled={!online} onClick={()=>void command('/reload').then(()=>gooeyToast.success('技能、模板与扩展已刷新',{showTimestamp:false})).catch(report)}><Icon name="arrows-clockwise"/>刷新技能、模板与扩展</Button></section>
 </>
}
const settingsGroups: { label: string; items: { id: SettingsPage; label: string; icon: string }[] }[] = [
 {label:'个人',items:[{id:'general',label:'常规',icon:'gear-six'},{id:'providers',label:'Provider 与模型',icon:'database'}]},
 {label:'会话',items:[{id:'sessions',label:'所有会话',icon:'chats'},{id:'tree',label:'会话树',icon:'tree-structure'}]},
 {label:'高级',items:[{id:'pi-tools',label:'常用工具',icon:'wrench'},{id:'changes',label:'代码变更',icon:'code'},{id:'console',label:'控制台',icon:'terminal-window'}]},
]

function Settings(){
 const page=useWorkspace(s=>s.settingsPage),[search,setSearch]=useState('')
 const query=search.trim().toLowerCase()
 const visibleGroups=settingsGroups.map(group=>({...group,items:group.items.filter(item=>item.label.toLowerCase().includes(query))})).filter(group=>group.items.length)
 const content=page==='general'?<GeneralSettings/>:page==='providers'?<><div className="panel-heading"><div><h1>Provider 与模型</h1><p>管理端点、凭据和 Pi 可用的模型目录。</p></div></div><ProviderSettings/></>:page==='sessions'?<Sessions/>:page==='tree'?<Tree/>:page==='pi-tools'?<PiTools/>:page==='changes'?<Changes/>:<Console/>
 return <div className="settings-workspace">
  <aside className="settings-sidebar">
   <Button className="settings-back" onClick={()=>useWorkspace.getState().set({panel:'chat'})}><Icon name="arrow-left"/><span>返回应用</span></Button>
   <label className="settings-search"><Icon name="magnifying-glass"/><Input aria-label="搜索设置" placeholder="搜索设置…" value={search} onChange={event=>setSearch(event.target.value)}/></label>
   <nav aria-label="设置分类">{visibleGroups.map(group=><section key={group.label}><h2>{group.label}</h2>{group.items.map(item=><Button key={item.id} className={`settings-nav-item ${page===item.id?'selected':''}`} aria-current={page===item.id?'page':undefined} onClick={()=>useWorkspace.getState().set({settingsPage:item.id})}><Icon name={item.icon}/><span>{item.label}</span></Button>)}</section>)}{!visibleGroups.length&&<p className="settings-search-empty">没有匹配的设置</p>}</nav>
  </aside>
  <main className="settings-main"><div key={page} className={`settings-content settings-${page}-page`}>{content}</div></main>
 </div>
}

function GeneralSettings(){
 const ask=usePrompt()
 async function manualCompact(){const instructions=await ask({title:'压缩说明（可以留空）',multiline:true});if(instructions!==null)await request({type:'compact',customInstructions:instructions},180000).then(()=>loadMessages(cwd))}
 const cwd=useWorkspace(s=>s.cwd),status=useWorkspace(s=>s.connection),state=useWorkspace(s=>s.state),running=useWorkspace(s=>s.transcript.running),toolStatus=useWorkspace(s=>s.statuses['gui-tools'])
 const [path,setPath]=useState(cwd),[busy,setBusy]=useState(false),[trustMode,setTrustMode]=useState<ProjectTrustMode>('ask'),[trustBusy,setTrustBusy]=useState(false)
 useEffect(()=>{if(status==='online')void request<{commands:{name:string}[]}>({type:'get_commands'}).then(data=>{if(data.commands.some(c=>c.name==='gui-tools'))return request({type:'prompt',message:'/gui-tools'})}).catch(report)},[status])
 useEffect(()=>{if(native)void getProjectTrustMode().then(setTrustMode).catch(report)},[])
 let tools:{tools:{name:string;description:string}[];active:string[]}={tools:[],active:[]};try{if(toolStatus)tools=JSON.parse(toolStatus)}catch{/* Older extension output remains in diagnostics. */}
 const stats=useQuery({queryKey:['pi','stats',useWorkspace(s=>s.cwd)],queryFn:()=>request<{tokens:{total:number};cost:number;contextUsage?:{percent:number|null;contextWindow:number}}>({type:'get_session_stats'}),enabled:status==='online'})
 const activeTools=new Set(tools.active)
 const {theme, setTheme, resolvedTheme}=useTheme()
 const themePreference=theme??'system'
 const themeLabel=themePreference==='system'?'跟随系统':resolvedTheme==='dark'?'深色主题':'浅色主题'
 async function reconnect(){setBusy(true);try{await connect(path);gooeyToast.success('项目已连接',{description:path,showTimestamp:false})}catch(e){report(e)}finally{setBusy(false)}}
 async function changeTrustMode(mode:ProjectTrustMode){setTrustBusy(true);try{await setProjectTrustMode(mode);setTrustMode(mode);if(status==='online'){await disconnect();await connect(cwd)}gooeyToast.success('项目权限已更新',{showTimestamp:false})}catch(e){report(e)}finally{setTrustBusy(false)}}
 return <><div className="panel-heading"><div><h1>常规</h1><p>连接、外观与当前会话的运行方式。</p></div></div>
  <section className="settings-section theme-settings"><h2>主题</h2><div className="setting-row"><div><strong>{themeLabel}</strong><p>默认跟随系统设置，也可以在这里固定使用浅色或深色。</p></div><div className="theme-settings-controls"><Select aria-label="主题" value={themePreference} onChange={event=>setTheme(event.target.value)}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></Select><ModeToggle/></div></div></section>
  <section className="settings-section"><h2>项目目录</h2><div className="input-row"><Input value={path} onChange={e=>setPath(e.target.value)} aria-label="工作目录"/><Button className="primary" disabled={busy||running||!native} onClick={()=>void reconnect()}>{busy?'连接中…':'连接此目录'}</Button></div><p className="field-note">Pi 以此目录为工作区，沿用你现有的模型与凭据配置。</p><Button className="secondary" disabled={status!=='online'} onClick={()=>void disconnect().catch(report)}>断开连接</Button></section>
  <section className="settings-section"><h2>项目权限</h2><div className="setting-row"><div><strong>项目资源信任</strong><p>Pi 没有内置沙箱或逐工具授权弹窗，工具会继承当前用户权限。此设置只控制是否加载项目本地的设置、扩展、技能和主题。</p></div><Select aria-label="项目资源信任" disabled={trustBusy||!native} value={trustMode} onChange={event=>void changeTrustMode(event.target.value as ProjectTrustMode)}><option value="always">完全访问项目资源</option><option value="ask">每次询问</option><option value="never">禁止项目资源</option></Select></div><p className="field-note">切换后会重启当前 Pi 连接；“完全访问”不等于绕过 macOS 文件权限。</p></section>
  <section className="settings-section"><h2>上下文</h2><div className="setting-row"><div><strong>自动压缩</strong><p>接近上下文容量时，让 Pi 整理较早的内容。</p></div><Switch aria-label="自动压缩" checked={state?.autoCompactionEnabled??false} disabled={status!=='online'||running} onChange={checked=>void applySetting({type:'set_auto_compaction',enabled:checked}).catch(report)}/></div><div className="setting-row"><div><strong>立即压缩</strong><p>可以补充这次摘要需要保留的重点。</p></div><Button className="secondary" disabled={status!=='online'||running} onClick={()=>void manualCompact().catch(report)}>压缩</Button></div><div className="stat-strip"><div><span>累计 tokens</span><strong>{stats.data?.tokens.total.toLocaleString()??'—'}</strong></div><div><span>上下文占用</span><strong>{stats.data?.contextUsage?.percent==null?'—':`${stats.data.contextUsage.percent.toFixed(1)}%`}</strong></div><div><span>Pi 报告费用</span><strong>{stats.data?`$${stats.data.cost.toFixed(4)}`:'—'}</strong></div></div><p className="field-note">自定义模型未配置价格时，Pi 的费用统计不代表服务商实际账单。</p></section>
  <section className="settings-section"><h2>消息队列</h2>{(['steering','followUp']as const).map(kind=><div className="setting-row" key={kind}><div><strong>{kind==='steering'?'引导消息':'跟进消息'}</strong><p>{kind==='steering'?'当前工具调用完成后交给模型。':'本轮任务全部结束后交给模型。'}</p></div><Select disabled={status!=='online'} value={kind==='steering'?state?.steeringMode:state?.followUpMode} onChange={e=>void applySetting({type:kind==='steering'?'set_steering_mode':'set_follow_up_mode',mode:e.target.value as 'all'|'one-at-a-time'}).catch(report)}><option value="one-at-a-time">每次一条</option><option value="all">全部送入</option></Select></div>)}</section>
  <section className="settings-section"><h2>可用工具</h2>{tools.tools.map(tool=><label className="setting-row" key={tool.name}><div><strong>{tool.name}</strong><p>{tool.description}</p></div><Switch aria-label={tool.name} checked={activeTools.has(tool.name)} disabled={running} onChange={checked=>{const next=checked?[...tools.active,tool.name]:tools.active.filter(name=>name!==tool.name);void request({type:'prompt',message:`/gui-tools-set ${JSON.stringify(next)}`}).catch(report)}}/></label>)}{!tools.tools.length&&<p>连接 Pi 后读取工具列表。</p>}</section>
  <section className="settings-section"><h2>原生终端环境</h2><p>账户登录、包安装、终端主题及交互可在独立终端中使用。</p><Button className="secondary" disabled={!native||!cwd} onClick={()=>void invoke('open_pi_terminal',{cwd,session:null}).catch(report)}><Icon name="terminal-window"/>打开终端</Button><p className="field-note">完整能力与参数边界见文档说明。</p></section>
 </>
}
// All documented RPC operations stay reachable, including uncommon administrative commands.
const samples:Record<RpcCommand['type'],Record<string,unknown>>={prompt:{message:''},steer:{message:''},follow_up:{message:''},abort:{},clear_queue:{},new_session:{},get_state:{},get_messages:{},set_model:{provider:'',modelId:''},cycle_model:{},get_available_models:{},set_thinking_level:{level:'high'},cycle_thinking_level:{},get_available_thinking_levels:{},set_steering_mode:{mode:'one-at-a-time'},set_follow_up_mode:{mode:'one-at-a-time'},compact:{customInstructions:''},set_auto_compaction:{enabled:true},set_auto_retry:{enabled:true},abort_retry:{},bash:{command:'pwd',excludeFromContext:true},abort_bash:{},get_session_stats:{},export_html:{},switch_session:{sessionPath:''},fork:{entryId:''},clone:{},get_fork_messages:{},get_entries:{},get_tree:{},get_last_assistant_text:{},set_session_name:{name:''},get_commands:{}}
function Console(){
 const online=useWorkspace(s=>s.connection==='online'),[kind,setKind]=useState<RpcCommand['type']>('get_state'),[body,setBody]=useState('{}'),[result,setResult]=useState(''),[busy,setBusy]=useState(false)
 async function run(){setBusy(true);try{const args=JSON.parse(body);if(typeof args!=='object'||Array.isArray(args)||args===null)throw new Error('参数必须为 JSON 对象');const data=await request({...args,type:kind}as RpcCommand,180000);setResult(format(data??'完成'));if(['new_session','switch_session','fork','clone'].includes(kind))await loadMessages();else await refresh()}catch(error){setResult(String(error));report(error)}finally{setBusy(false)}}
 return <><div className="panel-heading"><div><h1>控制台</h1><p>调用已注册的 RPC 服务与底层命令。</p></div><span className="badge">{Object.keys(samples).length} 个命令</span></div><div className="console-controls"><Select aria-label="RPC 命令" value={kind} onChange={e=>{const value=e.target.value as RpcCommand['type'];setKind(value);setBody(JSON.stringify(samples[value],null,2))}}>{Object.keys(samples).map(name=><option key={name}>{name}</option>)}</Select><Button className="primary" disabled={!online||busy} onClick={()=>void run()}>{busy?'等待结果…':'执行'}</Button><Button className="secondary" disabled={!online} onClick={()=>void request({type:'abort_bash'}).catch(report)}>停止 Bash</Button><Button className="secondary" disabled={!online} onClick={()=>void request({type:'abort_retry'}).catch(report)}>停止重试</Button></div><label className="console-label">参数 JSON<TextArea className="code-input" value={body} onChange={e=>setBody(e.target.value)} spellCheck={false}/></label><section className="console-label" aria-label="返回结果">返回结果<pre className="console-result">{result||'执行后显示 Pi 返回的数据。'}</pre></section></>
}
export function ExtensionDialog({dialog}:{dialog:UiRequest}){
 const [value,setValue]=useState(dialog.method==='editor'?dialog.prefill??'':''),[pending,setPending]=useState(false)
 async function answer(data:{value?:string;confirmed?:boolean;cancelled?:boolean}){setPending(true);try{await answerDialog(dialog,data)}catch(e){report(e)}finally{setPending(false)}}
 if(!['confirm','select','input','editor'].includes(dialog.method))return null
 const title='title'in dialog?dialog.title:'Pi 扩展'
 return <Modal open title={title} onCancel={()=>{if(!pending)void answer({cancelled:true})}} footer={<div className="dialog-actions"><Button disabled={pending} onClick={()=>void answer({cancelled:true})}>取消</Button>{dialog.method==='confirm'?<><Button disabled={pending} onClick={()=>void answer({confirmed:false})}>否</Button><Button className="primary" disabled={pending} onClick={()=>void answer({confirmed:true})}>确认</Button></>:dialog.method!=='select'&&<Button className="primary" disabled={pending} onClick={()=>void answer({value})}>提交</Button>}</div>}>{dialog.method==='confirm'&&<p>{dialog.message}</p>}{dialog.method==='select'&&<div className="dialog-options">{dialog.options.map(option=><Button key={option} disabled={pending} onClick={()=>void answer({value:option})}>{option}</Button>)}</div>}{(dialog.method==='input'||dialog.method==='editor')&&<TextArea autoFocus value={value} onChange={e=>setValue(e.target.value)} rows={dialog.method==='editor'?6:2} placeholder={dialog.method==='input'?dialog.placeholder:''}/>}</Modal>
}
function Changes(){
 const transcript=useWorkspace(s=>s.transcript)
 const changes=useMemo(()=>transcript.messages.flatMap(item=>Array.isArray(item.message.content)?item.message.content.flatMap(part=>{if(part.type!=='toolCall')return [];const tool=transcript.tools[part.id??''];const change=getChange(part.name??'',part.arguments,tool?.result);return change?[{id:part.id,change}]:[]}):[]),[transcript.messages,transcript.tools])
 return <><div className="panel-heading"><div><h1>代码变更</h1><p>Pi 工具返回的真实补丁与写入内容。</p></div></div>{!changes.length&&<div className="empty-panel"><Icon name="code"/><h3>当前会话尚无文件变更</h3><p>edit 的完整 patch 会显示在这里；write 展示写入内容。</p></div>}<Suspense fallback={<Skeleton active/>}>{changes.map(item=>item.change&&<CodeChange key={item.id} change={item.change}/>)}</Suspense></>
}
