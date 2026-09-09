import type { RpcSessionState, RpcExtensionUIRequest } from '@earendil-works/pi-coding-agent'
export type { RpcSessionState, RpcCommand, RpcExtensionUIRequest } from '@earendil-works/pi-coding-agent'
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }
export type Part = { type: string; text?: string; thinking?: string; data?: string; mimeType?: string; id?: string; name?: string; arguments?: Record<string, Json>; argsText?: string }
export type PiMessage = { role: string; content?: string | Part[]; command?: string; output?: string; summary?: string; display?: boolean; timestamp?: number; toolCallId?: string; toolName?: string; isError?: boolean; details?: unknown; usage?: ToolUsage; errorMessage?: string; stopReason?: string; exitCode?: number; cancelled?: boolean; truncated?: boolean; fullOutputPath?: string }
export type DisplayMessage = { id: string; message: PiMessage }
export type ToolUsage = { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number; cost?: { total?: number } }
export type Tool = { name: string; args?: Record<string, Json>; result?: unknown; running: boolean; isError?: boolean; usage?: ToolUsage }
export type Event = { type: string; message?: PiMessage; toolCallId?: string; toolName?: string; args?: Record<string, Json>; result?: unknown; partialResult?: unknown; isError?: boolean; details?: unknown; errorMessage?: string; assistantMessageEvent?: { type: string; contentIndex: number; delta?: string; content?: string; id?: string; toolName?: string; toolCall?: Part }; steering?: string[]; followUp?: string[]; [key: string]: unknown }
export type Transcript = { messages: DisplayMessage[]; active: number; running: boolean; compacting: boolean; phase: string; tools: Record<string, Tool>; error: string | null; queue: { steering: string[]; followUp: string[] }; bash: { id?: string; command?: string; output: string; running: boolean } | null }
export const emptyTranscript = (): Transcript => ({ messages: [], active: -1, running: false, compacting: false, phase: '就绪', tools: {}, error: null, queue: { steering: [], followUp: [] }, bash: null })
export function normalizeMessage(message: PiMessage): PiMessage {
  if(message.content !== undefined)return message
  if(message.role==='bashExecution')return {...message,content:`Bash: ${message.command ?? ''}\n\n${message.output ?? ''}`}
  return {...message,content:message.summary ?? ''}
}
export function hydrate(messages: PiMessage[]): Transcript {
  const state = emptyTranscript()
  for (const raw of messages) {
    if(raw.role==='custom' && raw.display===false)continue
    const message=normalizeMessage(raw)
    if (message.role === 'toolResult' && message.toolCallId) state.tools[message.toolCallId] = {name: message.toolName ?? 'tool', result: {content:message.content,details:message.details}, running: false, isError: message.isError, usage: message.usage as ToolUsage|undefined}
    else state.messages.push({ id: `history-${state.messages.length}-${message.timestamp ?? 0}`, message })
  }
  return state
}
// Pi 0.85.1 RPC intentionally has delta-only updates. The end snapshot is authoritative.
export function reduceEvent(previous: Transcript, event: Event): Transcript {
  const state = { ...previous }
  switch (event.type) {
    case 'bash_execution_update': return { ...state, bash: { id: typeof event.id === 'string' ? event.id : undefined, command: typeof event.command === 'string' ? event.command : state.bash?.command, output: `${state.bash?.output ?? ''}${String(event.delta ?? '')}`, running: true } }
    case 'agent_start': return { ...state, active: -1, running: true, phase: '正在思考', error: null }
    case 'agent_settled': return { ...state, running: false, phase: '就绪', bash: state.bash ? { ...state.bash, running: false } : null }
    case 'agent_end': return state
    case 'compaction_start': return { ...state, compacting: true, phase: '正在压缩上下文' }
    case 'compaction_end': return { ...state, compacting: false, phase: state.running ? '正在运行' : '就绪' }
    case 'auto_retry_start': return { ...state, running: true, phase: '正在重试' }
    case 'extension_error': return { ...state, error: String(event.error ?? event.errorMessage ?? '扩展执行失败') }
    case 'queue_update': return { ...state, queue: { steering: event.steering ?? [], followUp: event.followUp ?? [] } }
    case 'message_start': {
      if (!event.message || event.message.role === 'toolResult' || (event.message.role==='custom'&&event.message.display===false)) return state
      state.messages = [...state.messages, {id: `live-${state.messages.length}-${event.message.timestamp ?? 0}`, message: normalizeMessage(event.message)}]
      if (event.message.role === 'assistant') state.active = state.messages.length - 1
      return state
    }
    case 'message_update': {
      const delta = event.assistantMessageEvent
      const original = state.messages[state.active]
      if (!delta || !original || original.message.role !== 'assistant') return state
      const content = Array.isArray(original.message.content) ? [...original.message.content] : []
      const index = delta.contentIndex
      let part = { ...content[index] }
      switch(delta.type) {
        case 'text_start': part = {type:'text', text:''}; break
        case 'text_delta': part = { ...part, type:'text', text:(part.text ?? '')+(delta.delta ?? '') }; break
        case 'text_end': if (delta.content !== undefined) part = {...part, type:'text', text:delta.content}; break
        case 'thinking_start': part = {type:'thinking', thinking:''}; break
        case 'thinking_delta': part = { ...part, type:'thinking', thinking:(part.thinking ?? '')+(delta.delta ?? '') }; break
        case 'thinking_end': if (delta.content !== undefined) part = {...part,type:'thinking',thinking:delta.content}; break
        case 'toolcall_start': part = {type:'toolCall', id:delta.id, name:delta.toolName,argsText:''}; break
        case 'toolcall_delta': part = {...part,argsText:(part.argsText ?? '')+(delta.delta ?? '')}; break
        case 'toolcall_end': if(delta.toolCall) part = delta.toolCall; break
      }
      content[index] = part
      state.messages = [...state.messages]
      state.messages[state.active] = {...original,message:{...original.message,content}}
      return state
    }
    case 'message_end': {
      if (!event.message || (event.message.role==='custom'&&event.message.display===false)) return state
      const message = normalizeMessage(event.message)
      if (message.role === 'toolResult' && message.toolCallId) return { ...state, tools: {...state.tools,[message.toolCallId]:{...state.tools[message.toolCallId],name:message.toolName ?? 'tool',running:false,result:{content:message.content,details:message.details},isError:message.isError,usage:message.usage as ToolUsage|undefined}} }
      const index = message.role === 'assistant' ? state.active : state.messages.length - 1
      if(index >= 0) {
        state.messages = [...state.messages]; state.messages[index] = {...state.messages[index],message}
      }
      if(message.errorMessage) state.error=message.errorMessage
      return state
    }
    case 'tool_execution_start':
    case 'tool_execution_update':
    case 'tool_execution_end': {
      if (!event.toolCallId) return state
      const tool = state.tools[event.toolCallId]
      return { ...state, phase: event.type === 'tool_execution_end' ? '正在运行' : `执行 ${event.toolName}`, tools: {...state.tools,[event.toolCallId]:{...tool,name:event.toolName ?? tool?.name ?? 'tool',args:event.args ?? tool?.args,result:event.result ?? event.partialResult ?? tool?.result,running:event.type !== 'tool_execution_end',isError:event.isError}} }
    }
    default: return state
  }
}
export type Model = NonNullable<RpcSessionState['model']>
export type Session = { path:string; id:string; cwd:string; name?:string; modified:string; messageCount:number; firstMessage:string }
export type UiRequest = RpcExtensionUIRequest
