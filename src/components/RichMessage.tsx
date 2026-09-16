import { Streamdown } from '@lobehub/streamdown'
import remarkGfm from 'remark-gfm'
import {ReasoningPanel} from './ai-elements/chain-of-thought'

const remarkPlugins = [remarkGfm]

export function RichMarkdown({text, animated = false}:{text:string; animated?: boolean}){
 return <div className={`markdown-renderer ${animated ? 'is-streaming' : 'markdown-static'}`}><Streamdown content={text} remarkPlugins={remarkPlugins} granularity="char" smoothing="balanced" /></div>
}
export function Thinking({text,running=false}:{text:string;running?:boolean}){return <ReasoningPanel className="reasoning" steps={[{title:'Reasoning',body:text}]} streaming={running} restingLabel="Reasoned" />}
