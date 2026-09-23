import {dirname,join} from 'node:path'
import {realpathSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import type { ExtensionAPI, ExtensionCommandContext, ToolInfo } from '@earendil-works/pi-coding-agent'
import {registerSubagentTools,SUBAGENT_TOOL_NAMES} from './subagents/index.ts'
import {registerWorkspace} from './workspace.ts'
import {COMPUTER_USE_TOOL_NAMES,registerComputerUseMode} from './computer-use/mode.ts'
import {providerToolChars} from './context-payload.ts'
// Pi official docs/extensions.md: registerCommand, getAllTools, setActiveTools,
// ExtensionCommandContext.navigateTree and setLabel. Loaded only by this GUI.
export const SESSION_META_TYPE='pi-gui-session-meta'
export const SESSION_ICONS=['code','bug','palette','magnifying-glass','book-open','terminal-window','globe','image-square','film-strip','music-notes','database','translate','list-checks','calendar-blank','rocket-launch','lightbulb','chats','chat-teardrop-text'] as const
const COMPUTER_USE_TOOLS=new Set<string>(COMPUTER_USE_TOOL_NAMES)
type SessionIcon=(typeof SESSION_ICONS)[number]
export function parseSessionMetadata(raw:string):{title:string;icon:SessionIcon}|null{
  const match=raw.match(/\{[\s\S]*\}/)
  if(!match)return null
  try{
    const value=JSON.parse(match[0]) as {title?:unknown;icon?:unknown}
    const title=typeof value.title==='string'?Array.from(value.title.replace(/\s+/g,' ').trim()).slice(0,24).join(''):''
    if(!title)return null
    const icon=typeof value.icon==='string'&&SESSION_ICONS.includes(value.icon as SessionIcon)?value.icon as SessionIcon:'chat-teardrop-text'
    return {title,icon}
  }catch{return null}
}
export function applyGuiToolSelection(requested:string[],active:string[]):string[]{
  return [...new Set([...requested.filter(name=>!COMPUTER_USE_TOOLS.has(name)),...active.filter(name=>COMPUTER_USE_TOOLS.has(name))])]
}
function toolChars(tool: ToolInfo) {
  return JSON.stringify({ name: tool.name, description: tool.description, parameters: tool.parameters }).length
}
function contextBreakdown(pi: ExtensionAPI, providerChars: number | undefined) {
  const active = new Set(pi.getActiveTools())
  return {
    toolChars: providerChars ?? pi.getAllTools().filter(tool => active.has(tool.name)).reduce((total, tool) => total + toolChars(tool), 0),
  }
}
function sessionText(ctx:ExtensionCommandContext){
  return ctx.sessionManager.getEntries().flatMap(entry=>{
    if(entry.type!=='message'||!['user','assistant'].includes(entry.message.role))return []
    const content=typeof entry.message.content==='string'?entry.message.content:entry.message.content.flatMap(part=>'text'in part&&typeof part.text==='string'?[part.text]:[]).join(' ')
    const text=content.replace(/\s+/g,' ').trim()
    return text?[`${entry.message.role}: ${text}`]:[]
  }).join('\n').slice(-6000)
}
export default async function (pi: ExtensionAPI) {
  let latestProviderToolChars: number | undefined
  registerSubagentTools(pi)
  registerWorkspace(pi)
  pi.on('before_provider_request',event=>{latestProviderToolChars=providerToolChars(event.payload)})
  const {SettingsManager}=await import(pathToFileURL(join(dirname(realpathSync(process.argv[1])),'index.js')).href)
  pi.registerCommand('gui-observe',{description:'GUI: observe session configuration',handler:async(_args,ctx)=>{
    const settings=SettingsManager.create(ctx.cwd,undefined,{projectTrusted:ctx.isProjectTrusted()})
    ctx.ui.setStatus('gui-runtime',JSON.stringify({compaction:settings.getCompactionSettings(),retry:settings.getRetrySettings(),providerRetry:settings.getProviderRetrySettings(),transport:settings.getTransport(),thinkingBudgets:settings.getThinkingBudgets(),projectTrusted:ctx.isProjectTrusted(),contextUsage:ctx.getContextUsage(),systemPrompt:ctx.getSystemPrompt(),breakdown:contextBreakdown(pi,latestProviderToolChars),scopedModels:ctx.scopedModels.map(item=>({model:item.model.id,provider:item.model.provider,thinkingLevel:item.thinkingLevel})),idle:ctx.isIdle(),pending:ctx.hasPendingMessages()}))
  }})
  const publishTools = (ctx: ExtensionCommandContext) => ctx.ui.setStatus('gui-tools', JSON.stringify({
    active: pi.getActiveTools(),
    tools: pi.getAllTools().filter(tool=>!COMPUTER_USE_TOOLS.has(tool.name)).map((tool) => ({name:tool.name,description:tool.description})),
  }));
  registerComputerUseMode(pi, publishTools)
  pi.registerCommand('gui-tools', {description:'GUI: list available tools',handler:async (_args: string,ctx: ExtensionCommandContext) => publishTools(ctx)});
  pi.registerCommand('gui-tools-set', {description:'GUI: change active tools',handler:async (args: string,ctx: ExtensionCommandContext) => {
    await ctx.waitForIdle(); const names=JSON.parse(args);
    if(!Array.isArray(names)||names.some((name:unknown)=>typeof name!=='string'))throw new Error('Expected tool names');
    pi.setActiveTools(applyGuiToolSelection(names,pi.getActiveTools()));publishTools(ctx);
  }});
  pi.registerCommand('gui-agent-mode',{description:'GUI: enable or disable dynamic child agents',handler:async(args:string,ctx:ExtensionCommandContext)=>{
    const value=JSON.parse(args||'{}') as {enabled?:unknown};if(typeof value.enabled!=='boolean')throw new Error('Expected enabled boolean')
    const collaboration=new Set<string>(SUBAGENT_TOOL_NAMES),active=new Set(pi.getActiveTools())
    for(const name of collaboration){if(value.enabled)active.add(name);else active.delete(name)}
    pi.setActiveTools([...active]);ctx.ui.setStatus('gui-agent-mode',value.enabled?'enabled':'disabled');publishTools(ctx)
  }})
  pi.registerCommand('gui-tree', {description:'GUI: navigate a session branch',handler:async (args: string,ctx: ExtensionCommandContext) => {
    await ctx.waitForIdle();const target=JSON.parse(args);const result=await ctx.navigateTree(target.id,{summarize:target.summarize ?? false,customInstructions:target.customInstructions,replaceInstructions:target.replaceInstructions,label:target.label});
    if(result.cancelled)ctx.ui.notify('扩展取消了分支切换','warning');
    if(result.editorText)ctx.ui.setEditorText(result.editorText);
  }});
  pi.registerCommand('gui-label', {description:'GUI: label a session entry',handler:async (args: string,ctx: ExtensionCommandContext) => {const {id,label}=JSON.parse(args);ctx.setLabel(id,label||undefined);}});
  pi.registerCommand('gui-session-meta',{description:'GUI: generate durable session title and icon',handler:async(_args:string,ctx:ExtensionCommandContext)=>{
    try{
      const existing=ctx.sessionManager.getEntries().find(entry=>entry.type==='custom'&&entry.customType===SESSION_META_TYPE)
      if(existing||!ctx.model)return
      const conversation=sessionText(ctx)
      if(!conversation)return
      const icons=SESSION_ICONS.join(', ')
      const response=await ctx.modelRegistry.complete(ctx.model,{systemPrompt:`Create compact metadata for a coding-agent conversation. Return JSON only: {"title":"...","icon":"..."}. The title must be specific, in the conversation language, and at most 24 characters. Choose exactly one icon from: ${icons}.`,messages:[{role:'user',content:[{type:'text',text:conversation}],timestamp:Date.now()}]},{maxTokens:100,cacheRetention:'none'})
      const text=response.content.flatMap(part=>part.type==='text'?[part.text]:[]).join('')
      const meta=parseSessionMetadata(text)
      if(!meta)return
      const title=ctx.sessionManager.getSessionName()||meta.title
      pi.setSessionName(title)
      pi.appendEntry(SESSION_META_TYPE,{version:1,title,icon:meta.icon})
    }catch{/* Session replacement or provider failures fall back to the default icon. */}
  }})
}
