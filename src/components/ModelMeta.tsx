import { ModelIcon } from '@lobehub/icons'

export function ModelLogo({ modelId, size = 18 }: { modelId: string; size?: number }) {
  return <span className="model-logo" aria-hidden="true"><ModelIcon model={modelId} type="color" size={size} /></span>
}

export function ModelModalities({ values, className = '' }: { values?: string[]; className?: string }) {
  if (!values) return <span className={`model-modalities model-modalities-empty ${className}`}>接口未返回</span>
  if (values.length === 0) return <span className={`model-modalities model-modalities-empty ${className}`}>接口返回空数组</span>
  return <span className={`model-modalities ${className}`}>{values.map(value => <span className="model-modality" key={value}>{value}</span>)}</span>
}
