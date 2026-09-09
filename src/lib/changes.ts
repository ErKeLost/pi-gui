export type Change={kind:'patch';patch:string;name:string}|{kind:'snippet';before:string;after:string;name:string}|{kind:'file';contents:string;name:string}
function object(value:unknown):Record<string,unknown>{return value!==null&&typeof value==='object'?value as Record<string,unknown>:{}}
export function getChange(toolName:string,args:unknown,result:unknown):Change|null{
 const input=object(args),details=object(object(result).details)
 const name=typeof input.path==='string'?input.path:'修改文件'
 // Pi edit's details.patch is a complete unified patch. Its details.diff is NOT.
 if(typeof details.patch==='string'&&details.patch.trim())return {kind:'patch',patch:details.patch,name}
 if(toolName==='edit'&&typeof input.oldText==='string'&&typeof input.newText==='string')return {kind:'snippet',before:input.oldText,after:input.newText,name}
 if(toolName==='write'&&typeof input.content==='string')return {kind:'file',contents:input.content,name}
 return null
}
