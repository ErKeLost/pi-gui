import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'
import { Button } from '../UI'
import { Icon } from '../Icon'
export const Conversation = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(({ className = '', children, ...props }, ref) => <div {...props} ref={ref} role="log" className={`ai-conversation ${className}`}>{children}</div>); Conversation.displayName='Conversation'
export function ConversationContent({ className = '', children, ...props }: HTMLAttributes<HTMLDivElement>) { return <div {...props} className={`ai-conversation-content ${className}`}>{children}</div> }
export function ConversationEmptyState({ title = '开始对话', description = '', icon, children, ...props }: HTMLAttributes<HTMLDivElement> & { title?: string; description?: string; icon?: ReactNode }) { return <div {...props} className={`ai-conversation-empty ${props.className ?? ''}`}>{children ?? <><div>{icon}</div><strong>{title}</strong>{description && <p>{description}</p>}</>}</div> }
export function ConversationScrollButton({ onClick }: { onClick?: () => void }) { return <Button className="conversation-scroll-button" title="滚动到底部" onClick={onClick}><Icon name="arrow-down"/></Button> }
