import {dirname,join} from 'node:path'
import {realpathSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent'
// Pi official docs/extensions.md: registerCommand, getAllTools, setActiveTools,
// ExtensionCommandContext.navigateTree and setLabel. Loaded only by this GUI.
export default async function (pi: ExtensionAPI) {
  const {SettingsManager}=await import(pathToFileURL(join(dirname(realpathSync(process.argv[1])),'index.js')).href)
  pi.registerCommand('gui-observe',{description:'GUI: observe session configuration',handler:async(_args,ctx)=>{
    const settings=SettingsManager.create(ctx.cwd,undefined,{projectTrusted:ctx.isProjectTrusted()})
    ctx.ui.setStatus('gui-runtime',JSON.stringify({compaction:settings.getCompactionSettings(),retry:settings.getRetrySettings(),providerRetry:settings.getProviderRetrySettings(),transport:settings.getTransport(),thinkingBudgets:settings.getThinkingBudgets(),projectTrusted:ctx.isProjectTrusted(),contextUsage:ctx.getContextUsage(),systemPrompt:ctx.getSystemPrompt(),scopedModels:ctx.scopedModels.map(item=>({model:item.model.id,provider:item.model.provider,thinkingLevel:item.thinkingLevel})),idle:ctx.isIdle(),pending:ctx.hasPendingMessages()}))
  }})
  const publishTools = (ctx: ExtensionCommandContext) => ctx.ui.setStatus('gui-tools', JSON.stringify({
    active: pi.getActiveTools(),
    tools: pi.getAllTools().map((tool) => ({name:tool.name,description:tool.description})),
  }));
  pi.registerCommand('gui-tools', {description:'GUI: list available tools',handler:async (_args: string,ctx: ExtensionCommandContext) => publishTools(ctx)});
  pi.registerCommand('gui-tools-set', {description:'GUI: change active tools',handler:async (args: string,ctx: ExtensionCommandContext) => {
    await ctx.waitForIdle(); const names=JSON.parse(args);
    if(!Array.isArray(names)||names.some((name:unknown)=>typeof name!=='string'))throw new Error('Expected tool names');
    pi.setActiveTools(names);publishTools(ctx);
  }});
  pi.registerCommand('gui-tree', {description:'GUI: navigate a session branch',handler:async (args: string,ctx: ExtensionCommandContext) => {
    await ctx.waitForIdle();const target=JSON.parse(args);const result=await ctx.navigateTree(target.id,{summarize:target.summarize ?? false,customInstructions:target.customInstructions,replaceInstructions:target.replaceInstructions,label:target.label});
    if(result.cancelled)ctx.ui.notify('扩展取消了分支切换','warning');
    if(result.editorText)ctx.ui.setEditorText(result.editorText);
  }});
  pi.registerCommand('gui-label', {description:'GUI: label a session entry',handler:async (args: string) => {const {id,label}=JSON.parse(args);pi.setLabel(id,label||undefined);}});
}
