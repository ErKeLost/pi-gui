import type { ProviderModel } from './rpc'

const providerAliases: Record<string, string> = {
  'x-ai': 'xai',
  'z-ai': 'zhipu',
  moonshotai: 'moonshot',
  'meta-llama': 'meta',
  mistralai: 'mistral',
  'together-ai': 'togetherai',
}

export function modelLabel(id: string, fallback?: string) {
  const last = id.split('/').filter(Boolean).at(-1)
  return last || fallback || '未命名模型'
}

export function modelDisplayName(model: ProviderModel) {
  return model.display_name ?? model.name ?? modelLabel(model.id)
}

export function modelProviderKey(id: string) {
  const prefix = id.split('/').filter(Boolean)[0]?.toLowerCase() ?? ''
  return providerAliases[prefix] ?? prefix.replace(/[^a-z0-9]/g, '')
}

export function modelModalities(model: ProviderModel, direction: 'input' | 'output') {
  const value = direction === 'input'
    ? model.architecture?.input_modalities ?? model.input_modalities
    : model.architecture?.output_modalities ?? model.output_modalities
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  if (Array.isArray(model.capability_tags)) {
    const tags = model.capability_tags.filter((item): item is string => typeof item === 'string')
    const modalities = new Set<string>()
    if (direction === 'input' && (tags.includes('vision') || tags.includes('image') || tags.includes('image_input'))) modalities.add('image')
    if (tags.includes('chat') || tags.includes('text') || tags.includes('completion')) modalities.add('text')
    if (direction === 'output' && tags.includes('image_generation')) modalities.add('image')
    return modalities.size ? [...modalities] : undefined
  }
  return undefined
}

export function formatContextLength(value: unknown) {
  if (value === undefined || value === null || value === '') return '接口未返回'
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : String(value)
}
