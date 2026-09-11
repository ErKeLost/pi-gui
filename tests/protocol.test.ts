import {describe,test,expect} from 'bun:test'
import {emptyTranscript,reduceEvent,hydrate} from '../src/lib/protocol'
import { summarizeToolCalls } from '../src/lib/tool-activity'
describe('Pi 0.85.1 JSONL event projection',()=>{
 test('assembling indexed text and thinking deltas, ending with the authoritative snapshot',()=>{
  let state=reduceEvent(emptyTranscript(),{type:'message_start',message:{role:'assistant',content:[],timestamp:1}})
  for(const event of [{type:'text_start',contentIndex:0},{type:'text_delta',contentIndex:0,delta:'Hello\u2028'},{type:'thinking_start',contentIndex:1},{type:'thinking_delta',contentIndex:1,delta:'思考'},{type:'text_delta',contentIndex:0,delta:'world'}])state=reduceEvent(state,{type:'message_update',assistantMessageEvent:event})
  expect(state.messages[0].message.content).toEqual([{type:'text',text:'Hello\u2028world'},{type:'thinking',thinking:'思考'}])
  state=reduceEvent(state,{type:'message_end',message:{role:'assistant',content:[{type:'text',text:'authoritative'}],stopReason:'stop'}})
  expect(state.messages).toHaveLength(1);expect(state.messages[0].message.content).toEqual([{type:'text',text:'authoritative'}])
 })
 test('agent_end does not mark the run idle before retry/queue continuations settle',()=>{
  let state=reduceEvent(emptyTranscript(),{type:'agent_start'})
  state=reduceEvent(state,{type:'agent_end'});expect(state.running).toBe(true)
  state=reduceEvent(state,{type:'agent_settled'});expect(state.running).toBe(false)
 })
 test('thinking ends before the agent settles, retaining deltas when the end omits content',()=>{
  let state=reduceEvent(emptyTranscript(),{type:'agent_start'})
  state=reduceEvent(state,{type:'message_start',message:{role:'assistant',content:[]}})
  state=reduceEvent(state,{type:'message_update',assistantMessageEvent:{type:'thinking_delta',contentIndex:0,delta:'真实推理'}})
  state=reduceEvent(state,{type:'message_update',assistantMessageEvent:{type:'thinking_end',contentIndex:0}})
  expect(state.running).toBe(true)
  expect(state.messages[0].message.content).toEqual([{type:'thinking',thinking:'真实推理',thinkingComplete:true}])
  state=reduceEvent(state,{type:'message_update',assistantMessageEvent:{type:'thinking_start',contentIndex:1}})
  expect(Array.isArray(state.messages[0].message.content) && state.messages[0].message.content[1].thinkingComplete).toBeUndefined()
 })
 test('an authoritative message snapshot settles thinking without mutating the RPC message',()=>{
  const message={role:'assistant',content:[{type:'thinking',thinking:'Final reasoning'}]}
  let state=reduceEvent(emptyTranscript(),{type:'message_start',message:{role:'assistant',content:[]}})
  state=reduceEvent(state,{type:'message_end',message})
  expect(state.messages[0].message.content).toEqual([{type:'thinking',thinking:'Final reasoning',thinkingComplete:true}])
  expect(message.content).toEqual([{type:'thinking',thinking:'Final reasoning'}])
 })
 test('new agent turns do not reuse the previous assistant message as the active stream',()=>{
  let state=reduceEvent(emptyTranscript(),{type:'message_start',message:{role:'assistant',content:[{type:'text',text:'previous'}]}})
  expect(state.active).toBe(0)
  state=reduceEvent(state,{type:'agent_start'})
  expect(state.active).toBe(-1)
  expect(state.running).toBe(true)
 })
 test('tool partial output replaces accumulated output and final error is preserved',()=>{
  let state=reduceEvent(emptyTranscript(),{type:'tool_execution_start',toolCallId:'a',toolName:'bash',args:{command:'pwd'}})
  state=reduceEvent(state,{type:'tool_execution_update',toolCallId:'a',toolName:'bash',partialResult:'abc'})
  state=reduceEvent(state,{type:'tool_execution_update',toolCallId:'a',toolName:'bash',partialResult:'abcdef'})
  expect(state.tools.a.result).toBe('abcdef')
  state=reduceEvent(state,{type:'tool_execution_end',toolCallId:'a',result:'failed',isError:true})
  expect(state.tools.a.running).toBe(false);expect(state.tools.a.isError).toBe(true)
 })
 test('hydration attaches historical tool results without showing duplicate assistant messages',()=>{
  const state=hydrate([{role:'user',content:'test'},{role:'assistant',content:[{type:'toolCall',id:'call',name:'read'}]},{role:'toolResult',toolCallId:'call',toolName:'read',content:[{type:'text',text:'file'}]}])
  expect(state.messages).toHaveLength(2);expect(state.tools.call.result).toEqual({content:[{type:'text',text:'file'}],details:undefined})
 })
})
test('bash and compaction records normalize without exposing hidden custom messages',()=>{
 const state=hydrate([{role:'bashExecution',command:'pwd',output:'/tmp'},{role:'compactionSummary',summary:'summary'},{role:'custom',display:false,content:'hidden'}])
 expect(state.messages).toHaveLength(2)
 expect(state.messages[0].message.content).toContain('/tmp')
 expect(state.messages[1].message.content).toBe('summary')
})
test('tool activity summaries use the actual Pi tool names',()=>{
 expect(summarizeToolCalls(['read','rg','bash','edit','write'])).toBe('读取 1 次 · 搜索 1 次 · 运行 1 次 · 编辑 2 次')
})
