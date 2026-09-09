import { ProviderIcon } from '@lobehub/icons'
import { modelProviderKey } from '../lib/model-meta'

export function ModelLogo({ modelId, size = 18 }: { modelId: string; size?: number }) {
  return <ProviderIcon provider={modelProviderKey(modelId)} type="mono" forceMono size={size} />
}

export function ModelModalities({ values, className = '' }: { values?: string[]; className?: string }) {
  if (!values) return <span className={`model-modalities model-modalities-empty ${className}`}>接口未返回</span>
  if (values.length === 0) return <span className={`model-modalities model-modalities-empty ${className}`}>接口返回空数组</span>
  return <span className={`model-modalities ${className}`}>{values.map(value => <span className="model-modality" key={value}>{value}</span>)}</span>
}
