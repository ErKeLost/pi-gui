import type {HTMLAttributes} from 'react'
import { Streamdown } from '@lobehub/streamdown'
import remarkGfm from 'remark-gfm'

const remarkPlugins = [remarkGfm]

export function Message({from, className = '', children, ...props}: HTMLAttributes<HTMLDivElement> & {from: string}) {
  return <article {...props} className={`ai-message ${from === 'user' ? 'is-user' : 'is-assistant'} ${className}`}>{children}</article>
}

export function MessageContent({className = '', children, ...props}: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`ai-message-content ${className}`}>{children}</div>
}

export function MessageResponse({children, animated = false}: {children: string; animated?: boolean}) {
 return <div className={`ai-message-response ${animated ? 'is-streaming' : 'markdown-static'}`}><Streamdown content={children} remarkPlugins={remarkPlugins} granularity="char" smoothing="balanced" /></div>
}
