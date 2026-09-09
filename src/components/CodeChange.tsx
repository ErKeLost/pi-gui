import {Component,useMemo,useState,type ReactNode} from 'react'
import {PatchDiff,MultiFileDiff,File} from '@pierre/diffs/react'
import type {Change} from '../lib/changes'
import {Button} from './UI'
class DiffBoundary extends Component<{children:ReactNode;fallback:string},{failed:boolean}>{
 state={failed:false};static getDerivedStateFromError(){return {failed:true}}
 render(){return this.state.failed?<pre className="diff-fallback">{this.props.fallback}</pre>:this.props.children}
}
export function CodeChange({change}:{change:Change}){
 const [style,setStyle]=useState<'unified'|'split'>('unified')
 const options=useMemo(()=>({diffStyle:style,theme:'pierre-dark' as const,overflow:'scroll' as const}),[style])
 const oldFile=useMemo(()=>({name:change.name,contents:change.kind==='snippet'?change.before:''}),[change])
 const newFile=useMemo(()=>({name:change.name,contents:change.kind==='snippet'?change.after:change.kind==='file'?change.contents:''}),[change])
 const fallback=change.kind==='patch'?change.patch:change.kind==='snippet'?change.after:change.contents
 return <div className="code-change"><div className="diff-toolbar"><span>{change.kind==='snippet'?'替换片段（不是完整文件）':change.kind==='file'?'写入内容':change.name}</span>{change.kind!=='file'&&<Button onClick={()=>setStyle(s=>s==='split'?'unified':'split')}>{style==='split'?'切换统一视图':'切换并排视图'}</Button>}</div><DiffBoundary fallback={fallback}>{change.kind==='patch'?<PatchDiff patch={change.patch} options={options}/>:change.kind==='snippet'?<MultiFileDiff oldFile={oldFile} newFile={newFile} options={options}/>:<File file={newFile} options={{theme:'pierre-dark',overflow:'scroll'}}/>}</DiffBoundary></div>
}
