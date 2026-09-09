import type {HTMLAttributes} from 'react'
import { Streamdown } from '@lobehub/streamdown'

export function Message({from, className = '', children, ...props}: HTMLAttributes<HTMLDivElement> & {from: string}) {
  return <article {...props} className={`ai-message ${from === 'user' ? 'is-user' : 'is-assistant'} ${className}`}>{children}</article>
}

export function MessageContent({className = '', children, ...props}: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`ai-message-content ${className}`}>{children}</div>
}

export function MessageResponse({children, animated = false}: {children: string; animated?: boolean}) {
 return <div className={`ai-message-response ${animated ? 'is-streaming' : ''}`}><Streamdown content={children} granularity="char" smoothing="balanced" /></div>
}
