import { useState } from 'react'
import { Check, ChevronRight } from 'lucide-react'
import { ThinkingOrb } from 'thinking-orbs'
import { Button } from '../UI'
export function ToolCall({ label, activeLabel, query, request, result, usage, running, open: controlledOpen, onOpenChange, className = '' }: { label: string; activeLabel: string; query: string; request: string; result: string; usage?: { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number; cost?: { total?: number } }; running: boolean; open?: boolean; onOpenChange?: (open: boolean) => void; className?: string }) {
 const [localOpen, setLocalOpen] = useState(false); const open = controlledOpen ?? localOpen; const setOpen = (value: boolean) => { setLocalOpen(value); onOpenChange?.(value) }
 return <div className={`ai-tool-call ${className}`}><Button className="ai-tool-trigger" onClick={() => setOpen(!open)}><ChevronRight className={open ? 'open' : ''}/>{running ? <span className="orb-status"><ThinkingOrb state="working" size={20} theme="dark" aria-label={activeLabel} />{activeLabel}</span> : <span>{label}</span>}<code>{query}</code>{!running && <Check/>}</Button>{open && <div className="ai-tool-panel"><div><small>请求</small><pre>{request}</pre></div><div><small>结果</small><pre>{result}</pre></div>{usage && <div className="tool-usage"><small>工具关联用量</small><span>{usage.totalTokens.toLocaleString()} tokens</span>{usage.cost?.total != null && <span>${usage.cost.total.toFixed(4)}</span>}</div>}</div>}</div>
}
