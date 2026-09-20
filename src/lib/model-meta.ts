import type { ProviderModel } from './rpc'
import { modelMappings } from '@lobehub/icons'

const familyLabels:Record<string,string>={'Z.ai':'GLM',ChatGLM:'GLM','GLM-V':'GLM',MoonshotAI:'Kimi',Anthropic:'Claude'}
const familyCache=new Map<string,string>()

export function modelLabel(id: string, fallback?: string) {
  const last = id.split('/').filter(Boolean).at(-1)
  return last || fallback || '未命名模型'
}

export function modelDisplayName(model: ProviderModel) {
  return model.name ?? modelLabel(model.id)
}

export function modelFamily(id:string){
 const cached=familyCache.get(id);if(cached)return cached
 const normalized=id.toLowerCase()
 const match=modelMappings.find(item=>item.keywords.some(keyword=>normalized.search(keyword.toLowerCase())>=0))
 const raw=(match?.Icon as {title?:string}|undefined)?.title
 const family=raw?familyLabels[raw]??raw:'其他'
 familyCache.set(id,family);return family
}

export function modelModalities(model: ProviderModel, direction: 'input' | 'output') {
  return direction === 'input' ? model.input_modalities : model.output_modalities
}

export function formatContextLength(value: unknown) {
  if (value === undefined || value === null || value === '') return '接口未返回'
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : String(value)
}
