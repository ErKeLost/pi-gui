import { ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react'
import { ThinkingOrb } from 'thinking-orbs'
export function ChainOfThought({ children, className = '', ...props }: HTMLAttributes<HTMLDivElement>) { return <section {...props} className={`chain-of-thought ${className}`}>{children}</section> }
export function ChainOfThoughtHeader({ children, open, onClick, ...props }: HTMLAttributes<HTMLButtonElement> & { open?: boolean; onClick?: () => void }) { return <button type="button" {...props} onClick={onClick} className={`chain-of-thought-header ${props.className ?? ''}`}><span>{children}</span><ChevronDown className={open ? 'open' : ''} /></button> }
export function ChainOfThoughtContent({ children, ...props }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) { return <div {...props} className={`chain-of-thought-content ${props.className ?? ''}`}>{children}</div> }
export type ReasoningStep = { title: string; body: string }
export function ReasoningPanel({ steps, streaming, restingLabel, elapsed, className = '' }: { steps: ReasoningStep[]; streaming: boolean; restingLabel: string; elapsed?: string; className?: string }) {
 const [open, setOpen] = useState(streaming), [elapsedMs, setElapsedMs] = useState(0), started = useRef<number | null>(null)
 useEffect(() => {
   if (!streaming) { setOpen(false); started.current = null; setElapsedMs(0); return }
   setOpen(true)
   started.current ??= Date.now()
   const timer = window.setInterval(() => { if (started.current) setElapsedMs(Date.now() - started.current) }, 250)
   return () => window.clearInterval(timer)
 }, [streaming])
 const clock = elapsed ?? (elapsedMs ? `${(elapsedMs / 1000).toFixed(1)}s` : undefined)
 const visibleSteps = steps.filter(step => step.body.trim())
 return <ChainOfThought className={className}><ChainOfThoughtHeader open={open} onClick={() => setOpen(value => !value)}>{streaming ? <span className="orb-status"><ThinkingOrb state="solving" size={20} theme="dark" aria-label="Thinking" />Thinking</span> : restingLabel}{clock ? <small>{clock}</small> : null}</ChainOfThoughtHeader>{open && <ChainOfThoughtContent><ol>{visibleSteps.map(step => <li key={step.title}><i /><span><strong>{step.title}</strong><p>{step.body}</p></span></li>)}</ol></ChainOfThoughtContent>}</ChainOfThought>
}
