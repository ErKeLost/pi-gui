import { forwardRef, useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react'
import { Button } from '../UI'
import { Icon } from '../Icon'
export const Conversation = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(({ className = '', children, ...props }, ref) => <div {...props} ref={ref} role="log" className={`ai-conversation ${className}`}>{children}</div>); Conversation.displayName='Conversation'
export function ConversationContent({ className = '', children, ...props }: HTMLAttributes<HTMLDivElement>) { return <div {...props} className={`ai-conversation-content ${className}`}>{children}</div> }
export function ConversationEmptyState({ title = '开始对话', description = '', icon, children, ...props }: HTMLAttributes<HTMLDivElement> & { title?: string; description?: string; icon?: ReactNode }) { return <div {...props} className={`ai-conversation-empty ${props.className ?? ''}`}>{children ?? <><div>{icon}</div><strong>{title}</strong>{description && <p>{description}</p>}</>}</div> }
export function ConversationScrollButton({ onClick }: { onClick?: () => void }) { return <Button className="conversation-scroll-button" title="滚动到底部" onClick={onClick}><Icon name="arrow-down"/></Button> }
export function useConversationScroll() {
 const ref = useRef<HTMLDivElement>(null), atBottomRef = useRef(true), heightRef = useRef(0), [atBottom, setAtBottom] = useState(true)
 useEffect(() => {
  const element = ref.current
  if (!element) return
  let frame = 0
  const update = (follow = false) => {
   cancelAnimationFrame(frame)
   frame = requestAnimationFrame(() => {
    const { scrollHeight, clientHeight } = element
    const wasAtBottom = atBottomRef.current
    if (follow && wasAtBottom && scrollHeight > heightRef.current) element.scrollTop = scrollHeight
    heightRef.current = element.scrollHeight
    const currentAtBottom = element.scrollHeight - element.scrollTop - clientHeight <= 24
    atBottomRef.current = currentAtBottom
    setAtBottom(currentAtBottom)
   })
  }
  const onScroll = () => update()
  const resizeObserver = new ResizeObserver(() => update(true))
  const mutationObserver = new MutationObserver(() => update(true))
  heightRef.current = element.scrollHeight
  update()
  element.addEventListener('scroll', onScroll, { passive: true })
  resizeObserver.observe(element)
  mutationObserver.observe(element, { childList: true, subtree: true })
  return () => { cancelAnimationFrame(frame); element.removeEventListener('scroll', onScroll); resizeObserver.disconnect(); mutationObserver.disconnect() }
 }, [])
 const scrollToBottom = () => { const element = ref.current; if (!element) return; element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' }); atBottomRef.current = true; setAtBottom(true) }
 return { ref, atBottom, scrollToBottom }
}
