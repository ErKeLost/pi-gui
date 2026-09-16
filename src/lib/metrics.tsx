import {useEffect} from 'react'
import {useQuery} from '@tanstack/react-query'
import type {RpcResponse,RpcSessionState} from '@earendil-works/pi-coding-agent'
import {request} from './rpc'
import {useWorkspace} from './store'
import {usePageVisible} from './page-visibility'
export type Stats=Extract<RpcResponse,{command:'get_session_stats';success:true}>['data']
export type RuntimeInfo={compaction:{enabled:boolean;reserveTokens:number;keepRecentTokens:number};retry:{enabled:boolean;maxRetries:number;baseDelayMs:number};providerRetry:Record<string,unknown>;transport:string;projectTrusted:boolean;systemPrompt:string;thinkingBudgets?:Record<string,number>;idle:boolean;pending:boolean;scopedModels:unknown[]}
export function useMetrics(){
 const cwd=useWorkspace(s=>s.cwd)
 const visible=usePageVisible()
 const online=useWorkspace(s=>s.connection==='online'),sessionId=useWorkspace(s=>s.state?.sessionId),runtimeText=useWorkspace(s=>s.statuses['gui-runtime'])
 const stats=useQuery({queryKey:['pi','live-stats',cwd,sessionId],queryFn:()=>request<Stats>({type:'get_session_stats'},30000,cwd),enabled:online&&visible,refetchInterval:2000})
 let runtime:RuntimeInfo|null=null;try{if(runtimeText)runtime=JSON.parse(runtimeText)}catch{/* Keep absent metrics absent. */}
 return {stats:stats.data,runtime,error:stats.error,updatedAt:stats.dataUpdatedAt,online}
}
export function MetricsSync(){
 const cwd=useWorkspace(s=>s.cwd)
 const visible=usePageVisible()
 const online=useWorkspace(s=>s.connection==='online')
 const state=useQuery({queryKey:['pi','live-state',cwd],queryFn:()=>request<RpcSessionState>({type:'get_state'},30000,cwd),enabled:online&&visible,refetchInterval:2000})
 const capabilities=useQuery({queryKey:['pi','capabilities',cwd],queryFn:()=>request<{commands:{name:string}[]}>({type:'get_commands'},30000,cwd),enabled:online})
 const observation=useQuery({queryKey:['pi','runtime-snapshot',cwd],queryFn:async()=>{await request({type:'prompt',message:'/gui-observe'},30000,cwd);return true},enabled:online&&visible&&!!capabilities.data?.commands.some(c=>c.name==='gui-observe'),refetchInterval:5000})
 useEffect(()=>{
  if(!state.data||!online||useWorkspace.getState().cwd!==cwd)return
  const current=useWorkspace.getState()
  useWorkspace.getState().set({
   state:state.data,
   transcript:{
    ...current.transcript,
    running:state.data.isStreaming,
    compacting:state.data.isCompacting,
    phase:state.data.isCompacting?'正在压缩上下文':state.data.isStreaming?current.transcript.phase:'就绪',
   },
  })
 },[state.data,online,cwd])
 return observation.error?<span className="runtime-error">SDK 状态读取失败：{String(observation.error)}</span>:null
}
