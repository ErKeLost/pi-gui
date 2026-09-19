import { existsSync } from 'node:fs'
import { resolve, delimiter } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
const root=resolve(import.meta.dirname,'..')
const local=resolve(root,'work/toolchain')
const env={...process.env}
const args=process.argv.slice(2)
const androidIndex=args.indexOf('android')
const androidAction=androidIndex<0?undefined:args[androidIndex+1]
if(androidIndex>=0&&['build','dev'].includes(androidAction)&&!args.includes('--target'))args.push('--target','aarch64')
const syncAndroidIcons=()=>spawnSync(process.execPath,[resolve(root,'scripts/sync-android-icons.mjs')],{cwd:root,env,stdio:'inherit'})
if(androidIndex>=0&&syncAndroidIcons().status!==0)process.exit(1)
const bundle=spawnSync(process.execPath,[resolve(root,'scripts/bundle-pi.mjs')],{cwd:root,env,stdio:'inherit'})
if(bundle.status!==0)process.exit(bundle.status??1)
if(existsSync(resolve(local,'cargo/bin/rustup'))){
  env.RUSTUP_HOME=resolve(local,'rustup')
  env.CARGO_HOME=resolve(local,'cargo')
  env.PATH=resolve(local,'cargo/bin')+delimiter+(env.PATH??'')
}
const child=spawn(resolve(root,'node_modules/.bin/tauri'),args,{cwd:root,env,stdio:'inherit'})
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal))
child.on('exit',code=>{
  if(code===0&&androidAction==='init'&&syncAndroidIcons().status!==0){process.exitCode=1;return}
  process.exitCode=code??1
})
child.on('error',error=>{console.error(error.message);process.exitCode=1})
