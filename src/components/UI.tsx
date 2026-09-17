import { Children, isValidElement, useMemo, useState, type ComponentProps, type ReactNode } from 'react'
import { Button as ShadcnButton } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select as SelectRoot, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch as ShadcnSwitch } from '@/components/ui/switch'
import { Skeleton as ShadcnSkeleton } from '@/components/ui/skeleton'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tooltip as ShadcnTooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { PromptContext, type PromptOptions } from '@/lib/prompt'

type ButtonProps = Omit<ComponentProps<typeof ShadcnButton>, 'className'> & { className?: string; title?: string; type?: 'button' | 'submit' | 'reset' }
export function Button({ type = 'button', title, className = '', variant, size, ...props }: ButtonProps) {
  const inferredVariant = variant ?? (className.includes('secondary') ? 'secondary' : className.includes('primary') ? 'default' : 'ghost')
  const element = <ShadcnButton {...props} type={type} variant={inferredVariant} size={size ?? (className.includes('icon-button') ? 'icon' : 'default')} aria-label={props['aria-label'] ?? title} className={className} />
  return title ? <Tooltip><TooltipTrigger render={element} /><TooltipContent>{title}</TooltipContent></Tooltip> : element
}

export function Select({ children, onChange, value, disabled, 'aria-label': ariaLabel, className }: { children: ReactNode; onChange?: (event: { target: { value: string } }) => void; value?: string; disabled?: boolean; 'aria-label'?: string; className?: string }) {
  const options = Children.toArray(children).reduce<{value:string;label:ReactNode}[]>((result, child) => { if (isValidElement<ComponentProps<'option'>>(child)) result.push({ value: String(child.props.value ?? child.props.children ?? ''), label: child.props.children }); return result }, [])
  return <SelectRoot value={value ?? ''} onValueChange={next => onChange?.({ target: { value: String(next) } })} disabled={disabled}>
    <SelectTrigger aria-label={ariaLabel} className={cn('h-7', className)}><SelectValue /></SelectTrigger>
    <SelectContent>{options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
  </SelectRoot>
}

export function Switch({ checked, onChange, disabled, 'aria-label': ariaLabel }: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; 'aria-label'?: string }) {
  return <ShadcnSwitch checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={ariaLabel} size="sm" />
}

export { Input, Textarea as TextArea }
export function Skeleton({ paragraph, className = '', active: _active, ...props }: ComponentProps<'div'> & { active?: boolean; paragraph?: { rows?: number } }) {
  if (paragraph) { const rowIds=Array.from({ length: paragraph.rows ?? 3 }, (_, index) => `skeleton-row-${index}`); return <div className={cn('skeleton-stack', className)} {...props}>{rowIds.map(id => <ShadcnSkeleton key={id} className="h-7 w-full" />)}</div> }
  return <ShadcnSkeleton className={className} {...props} />
}

export function Disclosure({ title, children, className = '', defaultOpen = false }: { title: ReactNode; children: ReactNode; className?: string; defaultOpen?: boolean }) {
  return <Collapsible defaultOpen={defaultOpen} className={className}><CollapsibleTrigger className="disclosure-title">{title}</CollapsibleTrigger><CollapsibleContent>{children}</CollapsibleContent></Collapsible>
}

export function PromptProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<(PromptOptions & { resolve: (value: string | null) => void }) | null>(null)
  const [value, setValue] = useState('')
  const close = (next: string | null) => { request?.resolve(next); setRequest(null) }
  const prompt = useMemo(() => (options: PromptOptions) => new Promise<string | null>(resolve => { setValue(options.initial ?? ''); setRequest({ ...options, resolve }) }), [])
  return <PromptContext.Provider value={prompt}>
    {children}
    <Dialog open={!!request} onOpenChange={open => { if (!open) close(null) }}>
      <DialogContent><DialogHeader><DialogTitle>{request?.title}</DialogTitle></DialogHeader>
        {request?.multiline ? <Textarea autoFocus value={value} onChange={event => setValue(event.target.value)} rows={5} /> : <Input autoFocus value={value} onChange={event => setValue(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') close(value) }} />}
        <DialogFooter><Button variant="outline" onClick={() => close(null)}>取消</Button><Button onClick={() => close(value)}>确认</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </PromptContext.Provider>
}

export function Modal({ open, title, children, onCancel, onOk, footer, okText = '确认', cancelText = '取消', destructive = false }: { open: boolean; title?: ReactNode; children?: ReactNode; onCancel?: () => void; onOk?: () => void; footer?: ReactNode; okText?: string; cancelText?: string; destructive?: boolean }) {
  return <Dialog open={open} onOpenChange={next => { if (!next) onCancel?.() }}><DialogContent><DialogHeader>{title && <DialogTitle>{title}</DialogTitle>}</DialogHeader><div className="modal-body">{children}</div>{footer ?? <DialogFooter><Button variant="outline" onClick={onCancel}>{cancelText}</Button><Button variant={destructive?'destructive':'default'} onClick={onOk}>{okText}</Button></DialogFooter>}</DialogContent></Dialog>
}

export function Tooltip({ children }: { children: ReactNode }) {
  return <ShadcnTooltip>{children}</ShadcnTooltip>
}
export { TooltipContent, TooltipTrigger }
