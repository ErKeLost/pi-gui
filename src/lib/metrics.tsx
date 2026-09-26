import {useEffect} from 'react'
import {useQuery} from '@tanstack/react-query'
import type {RpcSessionState} from '@earendil-works/pi-coding-agent'
import {requestWithRecovery} from './rpc'
import {useWorkspace} from './store'
import {usePageVisible} from './page-visibility'
export function MetricsSync(){
 const cwd=useWorkspace(s=>s.cwd),connectionId=useWorkspace(s=>s.connectionId)
 const visible=usePageVisible()
 const online=useWorkspace(s=>s.connection==='online')
 const target=connectionId||cwd
 const state=useQuery({queryKey:['pi','live-state',target],queryFn:()=>requestWithRecovery<RpcSessionState>({type:'get_state'},30000,target),enabled:online&&visible&&Boolean(target),refetchInterval:2000})
 const capabilities=useQuery({queryKey:['pi','capabilities',target],queryFn:()=>requestWithRecovery<{commands:{name:string}[]}>({type:'get_commands'},30000,target),enabled:online&&Boolean(target)})
 const observation=useQuery({queryKey:['pi','runtime-snapshot',target],queryFn:async()=>{await requestWithRecovery({type:'prompt',message:'/gui-observe'},30000,target);return true},enabled:online&&visible&&Boolean(target)&&!!capabilities.data?.commands.some(c=>c.name==='gui-observe'),refetchInterval:5000})
 useEffect(()=>{
  if(!state.data||!online||useWorkspace.getState().connectionId!==connectionId)return
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
 },[state.data,online,connectionId])
 return observation.error?<span className="runtime-error">SDK 状态读取失败：{String(observation.error)}</span>:null
}
