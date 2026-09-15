import {spawn} from 'node:child_process'
import {resolve} from 'node:path'
import {mkdirSync,writeFileSync} from 'node:fs'
import assert from 'node:assert/strict'
const root=resolve(import.meta.dirname,'..'),cwd=resolve(root,'work/smoke')
mkdirSync(cwd,{recursive:true})
const child=spawn(process.execPath,[resolve(root,'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),'--mode','rpc','--offline','--no-session','--extension',resolve(root,'src-tauri/resources/gui-extension.ts')],{cwd,stdio:['pipe','pipe','pipe']})
let buffer='',sequence=0,errors='',toolState,runtimeInfo
const pending=new Map(),results=[]
child.on('exit',code=>{for(const p of pending.values())p.reject(new Error('Pi exited: '+code));pending.clear()})
child.stderr.on('data',chunk=>{errors+=chunk.toString()})
child.stdout.setEncoding('utf8')
child.stdout.on('data',chunk=>{
 buffer+=chunk
 let end
 while((end=buffer.indexOf('\n'))>=0){
  const line=buffer.slice(0,end);buffer=buffer.slice(end+1)
  if(!line.trim())continue
  const event=JSON.parse(line)
  if(event.type==='extension_ui_request'&&event.statusKey==='gui-runtime')runtimeInfo=JSON.parse(event.statusText)
  if(event.type==='extension_ui_request'&&event.statusKey==='gui-tools')toolState=JSON.parse(event.statusText)
  if(event.type==='response'&&pending.has(event.id)){const p=pending.get(event.id);pending.delete(event.id);if(event.success)p.resolve(event.data);else p.reject(new Error(event.error))}
  if(event.type==='agent_settled'&&pending.has('settled')){pending.get('settled').resolve();pending.delete('settled')}
 }
})
const req=(command)=>new Promise((resolve,reject)=>{const id=String(++sequence);pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({...command,id})+'\n')})
const deadline=setTimeout(()=>{console.error('Pi smoke test timed out');child.kill();process.exit(1)},90000)
try{
 await req({type:'prompt',message:'/gui-observe'});assert(runtimeInfo.compaction.reserveTokens>0);assert.equal(typeof runtimeInfo.systemPrompt,'string');results.push('SDK live context and compaction configuration')
 const state=await req({type:'get_state'});assert(state.model);assert.equal(typeof state.model.provider,'string');assert.equal(typeof state.model.id,'string');results.push(`state: ${state.model.provider}/${state.model.id} / ${state.thinkingLevel}`)
 const models=await req({type:'get_available_models'});assert(models.models.some(m=>m.provider===state.model.provider&&m.id===state.model.id));results.push('current model returned by Pi model catalog')
 const levels=await req({type:'get_available_thinking_levels'});assert(levels.levels.includes(state.thinkingLevel));results.push('current thinking level returned by Pi capability API')
 await req({type:'prompt',message:'/gui-tools'});assert(toolState.tools.length>0);results.push('GUI extension: tool inventory')
 await req({type:'prompt',message:'/gui-tools-set ["read"]'});assert.deepEqual(toolState.active,['read']);results.push('GUI extension: active tools update')
 const bash=await req({type:'bash',command:'printf "Pi GUI integration ok"',excludeFromContext:true});assert.equal(bash.exitCode,0);assert.equal(bash.output,'Pi GUI integration ok');results.push('real Bash execution through RPC')
 const commands=await req({type:'get_commands'});assert(commands.commands.some(c=>c.name==='gui-tree'));results.push('commands enumerated')
 if(process.argv.includes('--live')){
   const settled=new Promise((resolve,reject)=>pending.set('settled',{resolve,reject}))
   await req({type:'prompt',message:'只回复：Pi GUI 连接测试成功。不要调用工具。'})
   await settled
   const text=await req({type:'get_last_assistant_text'});assert(text.text?.includes('测试成功'));results.push('live model response: '+text.text)
 }
 const report={checkedAt:new Date().toISOString(),results}
 writeFileSync(resolve(root,'docs/pi-smoke-result.json'),JSON.stringify(report,null,2)+'\n')
 console.log(JSON.stringify(report,null,2))
}catch(error){console.error(error.message);if(errors)console.error('Pi wrote diagnostics to stderr');process.exitCode=1}
finally{clearTimeout(deadline);child.stdin.end();child.kill()}
