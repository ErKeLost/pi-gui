import {emptyTelemetry,observe} from './telemetry'
import {Channel,invoke,isTauri} from '@tauri-apps/api/core'
import {QueryClient} from '@tanstack/react-query'
import type {RpcCommand,RpcResponse} from '@earendil-works/pi-coding-agent'
import {useWorkspace,type Workspace} from './store'
import {emptyTranscript,hydrate,reduceEvent,type Event,type PiMessage,type RpcSessionState,type UiRequest} from './protocol'
export const queryClient=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false,staleTime:15000}}})
export const native=isTauri()
export type ProviderModel={
  id:string
  name?:string
  object?:string
  created?:number
  owned_by?:string
  context_length?:number
  max_output_tokens?:number
  max_tokens?:number
  input_modalities?:string[]
  output_modalities?:string[]
  architecture?:{modality?:string;input_modalities?:string[];output_modalities?:string[];tokenizer?:string;instruct_type?:string|null}
  reasoning?:boolean|{mandatory?:boolean;default_enabled?:boolean;supported_efforts?:string[];default_effort?:string}
  pricing?:Record<string,string|number>
  supported_parameters?:string[]
  supported_endpoint_types?:string[]
  [key:string]:unknown
}
export type ProviderProfile={id:string;name?:string;baseUrl?:string;api?:string;authHeader?:boolean;hasApiKey:boolean;modelCount:number}
type Snapshot=Pick<Workspace,'transcript'|'telemetry'|'state'|'connection'|'error'|'draft'|'dialogs'|'notices'|'statuses'|'widgets'>
type Pending={project:string;resolve:(value:unknown)=>void;reject:(error:Error)=>void;timeout:ReturnType<typeof setTimeout>}
const pending=new Map<string,Pending>(),snapshots=new Map<string,Snapshot>(),connections=new Map<string,symbol>(),eventQueues=new Map<string,Event[]>(),flushTimers=new Map<string,ReturnType<typeof setTimeout>>()
const fresh=():Snapshot=>({transcript:emptyTranscript(),telemetry:emptyTelemetry(),state:null,connection:'offline',error:null,draft:'',dialogs:[],notices:[],statuses:{},widgets:{}})
function snapshot():Snapshot{const s=useWorkspace.getState();return {transcript:s.transcript,telemetry:s.telemetry,state:s.state,connection:s.connection,error:s.error,draft:s.draft,dialogs:s.dialogs,notices:s.notices,statuses:s.statuses,widgets:s.widgets}}
function current(project:string):Snapshot{return useWorkspace.getState().cwd===project?snapshot():snapshots.get(project)??fresh()}
function patch(project:string,value:Partial<Snapshot>){const next={...current(project),...value};snapshots.set(project,next);if(useWorkspace.getState().cwd===project)useWorkspace.getState().set(value)}
function failPending(project:string,message:string){for(const [id,p]of pending){if(p.project!==project)continue;clearTimeout(p.timeout);p.reject(new Error(message));pending.delete(id)}}
function applyEvent(event:Event,project:string){
 if(event.type==='response'){
  const response=event as unknown as RpcResponse;if(!response.id)return;const p=pending.get(response.id);if(!p||p.project!==project)return
  clearTimeout(p.timeout);pending.delete(response.id);if(response.success)p.resolve('data'in response?response.data:undefined);else p.reject(new Error(response.error));return
 }
 const s=current(project)
 if(event.type==='extension_ui_request'){
  const request=event as unknown as UiRequest
  if(['select','confirm','input','editor'].includes(request.method))patch(project,{dialogs:[...s.dialogs,request]})
  else if(request.method==='notify')patch(project,{notices:[...s.notices,request.message].slice(-5)})
  else if(request.method==='set_editor_text')patch(project,{draft:request.text})
  else if(request.method==='setStatus')patch(project,{statuses:{...s.statuses,[request.statusKey]:request.statusText??''}})
  else if(request.method==='setWidget')patch(project,{widgets:{...s.widgets,[request.widgetKey]:request.widgetLines??[]}})
  else if(request.method==='setTitle'&&useWorkspace.getState().cwd===project)document.title=request.title
  return
 }
 patch(project,{transcript:reduceEvent(s.transcript,event),telemetry:observe(s.telemetry,event)})
 if(['compaction_end','message_end','agent_settled'].includes(event.type))void queryClient.invalidateQueries({queryKey:['pi','live-stats',project]})
 if(event.type==='agent_settled')void refresh(project).catch(error=>patch(project,{error:String(error)}))
}
const burstEvents=new Set(['message_update','tool_execution_update'])
function flushEvents(project:string){
 const timer=flushTimers.get(project);if(timer)clearTimeout(timer);flushTimers.delete(project)
 const queue=eventQueues.get(project);if(!queue?.length)return;eventQueues.delete(project);for(const event of queue)applyEvent(event,project)
}
function clearEvents(project:string){const timer=flushTimers.get(project);if(timer)clearTimeout(timer);flushTimers.delete(project);eventQueues.delete(project)}
function dispatch(event:Event,project:string){
 if(!burstEvents.has(event.type)){flushEvents(project);applyEvent(event,project);return}
 const queue=eventQueues.get(project)??[];queue.push(event);eventQueues.set(project,queue)
 if(!flushTimers.has(project))flushTimers.set(project,setTimeout(()=>flushEvents(project),32))
}
export function request<T=unknown>(command:RpcCommand,timeoutMs=30000,project=useWorkspace.getState().cwd):Promise<T>{
 const id=crypto.randomUUID()
 return new Promise<T>((resolve,reject)=>{
  const timeout=setTimeout(()=>{pending.delete(id);reject(new Error(`Pi ${command.type} 响应超时`))},timeoutMs)
  pending.set(id,{project,resolve:value=>resolve(value as T),reject,timeout})
  void invoke('pi_send',{project,command:{...command,id}}).catch(error=>{clearTimeout(timeout);pending.delete(id);reject(new Error(String(error)))})
 })
}
export function report(error:unknown){useWorkspace.getState().set({error:String(error instanceof Error?error.message:error)})}
export async function refresh(project=useWorkspace.getState().cwd){const state=await request<RpcSessionState>({type:'get_state'},30000,project);patch(project,{state});if(state.sessionFile){let files:Record<string,string>={};try{files=JSON.parse(localStorage.getItem('pi-gui.sessionFiles')??'{}')}catch{};files[project]=state.sessionFile;localStorage.setItem('pi-gui.sessionFiles',JSON.stringify(files))}await queryClient.invalidateQueries({queryKey:['pi','live-stats',project]})}
export async function listProviderModels(provider:string):Promise<{data:ProviderModel[]}> { if(!native) throw new Error('远端模型目录需要桌面应用'); return invoke<{data:ProviderModel[]}>('list_provider_models',{provider}) }
export async function listProjectFiles(project=useWorkspace.getState().cwd):Promise<string[]> { if(!native) throw new Error('文件索引需要桌面应用'); return invoke<string[]>('list_project_files',{cwd:project}) }
export async function listProviderProfiles():Promise<ProviderProfile[]> { if(!native) throw new Error('Provider 配置需要桌面应用'); return invoke<ProviderProfile[]>('list_provider_profiles') }
export async function probeProviderModels(provider:string,baseUrl:string,api:string,apiKey?:string,authHeader=true):Promise<{data:ProviderModel[]}> { if(!native) throw new Error('远端模型目录需要桌面应用'); return invoke<{data:ProviderModel[]}>('probe_provider_models',{provider,baseUrl,api,apiKey:apiKey||null,authHeader}) }
export async function saveProvider(input:{provider:string;name?:string;baseUrl:string;api:string;apiKey?:string;authHeader:boolean}):Promise<{id:string;hasApiKey:boolean}> { if(!native) throw new Error('Provider 配置需要桌面应用'); return invoke<{id:string;hasApiKey:boolean}>('save_provider',{provider:input.provider,name:input.name||null,baseUrl:input.baseUrl,api:input.api,apiKey:input.apiKey||null,authHeader:input.authHeader}) }
export async function deleteSession(sessionPath:string):Promise<void> { if(!native) throw new Error('删除会话需要桌面应用'); return invoke<void>('delete_session',{sessionPath}) }
export async function syncProviderModels(provider:string):Promise<{provider:string;count:number;previous:number}> { if(!native) throw new Error('同步模型需要桌面应用'); return invoke<{provider:string;count:number;previous:number}>('sync_provider_models',{provider}) }
export async function loadMessages(project=useWorkspace.getState().cwd){const data=await request<{messages:PiMessage[]}>({type:'get_messages'},30000,project);patch(project,{transcript:hydrate(data.messages)});await refresh(project)}
export async function connect(cwd:string){
 if(!native)throw new Error('请在桌面应用中选择项目')
 const previous=useWorkspace.getState();if(previous.cwd)snapshots.set(previous.cwd,snapshot())
 const saved=snapshots.get(cwd)??fresh();useWorkspace.getState().set({...saved,cwd})
 localStorage.setItem('pi-gui.cwd',cwd)
 if(connections.has(cwd)&&saved.connection==='online'){await refresh(cwd);return}
 const token=Symbol(cwd);connections.set(cwd,token);patch(cwd,{connection:'connecting',error:null})
 const onEvent=new Channel<{kind:string;payload?:Event;message?:string;code?:number}>()
 onEvent.onmessage=event=>{
  if(connections.get(cwd)!==token)return
  if(event.kind==='rpc'&&event.payload)dispatch(event.payload,cwd)
  if(event.kind==='exit'){flushEvents(cwd);clearEvents(cwd);connections.delete(cwd);patch(cwd,{connection:'offline',error:`Pi 进程已退出（${event.code??'signal'}）`});failPending(cwd,'Pi 进程已退出')}
  if(event.kind==='protocol_error')patch(cwd,{error:event.message})
 }
 try{
  await invoke('pi_connect',{cwd,onEvent})
  const state=await request<RpcSessionState>({type:'get_state'},45000,cwd)
  if(connections.get(cwd)!==token)return
  patch(cwd,{connection:'online',state})
  let previousFile:string|undefined;try{previousFile=JSON.parse(localStorage.getItem('pi-gui.sessionFiles')??'{}')[cwd]}catch{}
  if(previousFile&&previousFile!==state.sessionFile){try{await request({type:'switch_session',sessionPath:previousFile},45000,cwd)}catch{patch(cwd,{notices:['上次会话无法读取，已打开新会话']})}}
  await loadMessages(cwd)
 }catch(error){connections.delete(cwd);failPending(cwd,'连接失败');await invoke('pi_disconnect',{project:cwd}).catch(()=>{});patch(cwd,{connection:'offline'});throw error}
}
export async function disconnect(){const project=useWorkspace.getState().cwd,s=current(project);if(s.transcript.running){await request({type:'clear_queue'},30000,project);await request({type:'abort'},60000,project)}clearEvents(project);connections.delete(project);failPending(project,'项目已断开');await invoke('pi_disconnect',{project});patch(project,{connection:'offline',state:null,transcript:{...s.transcript,running:false}})}
export async function stop(){const project=useWorkspace.getState().cwd,cleared=await request<{steering:string[];followUp:string[]}>({type:'clear_queue'},30000,project);await request({type:'abort'},60000,project);patch(project,{draft:[current(project).draft,...cleared.steering,...cleared.followUp].filter(Boolean).join('\n')});await refresh(project)}
export async function changeSession(command:RpcCommand){const project=useWorkspace.getState().cwd,result=await request<{cancelled?:boolean;text?:string}>(command,60000,project);if(result?.cancelled)throw new Error('扩展取消了会话切换');patch(project,{error:null,telemetry:emptyTelemetry(),draft:result?.text??'',dialogs:[],statuses:{},widgets:{}});if(useWorkspace.getState().cwd===project)useWorkspace.getState().set({panel:'chat'});await loadMessages(project);await queryClient.invalidateQueries({queryKey:['pi','sessions',project]})}
export async function answerDialog(request:UiRequest,answer:{value?:string;confirmed?:boolean;cancelled?:boolean}){const project=useWorkspace.getState().cwd;await invoke('pi_send',{project,command:{type:'extension_ui_response',id:request.id,...answer}});patch(project,{dialogs:current(project).dialogs.filter(item=>item.id!==request.id)})}
