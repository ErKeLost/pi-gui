import { existsSync } from 'node:fs'
import { resolve, delimiter } from 'node:path'
import { spawn } from 'node:child_process'
const root=resolve(import.meta.dirname,'..')
const local=resolve(root,'work/toolchain')
const env={...process.env}
if(existsSync(resolve(local,'cargo/bin/rustup'))){
  env.RUSTUP_HOME=resolve(local,'rustup')
  env.CARGO_HOME=resolve(local,'cargo')
  env.PATH=resolve(local,'cargo/bin')+delimiter+(env.PATH??'')
}
const child=spawn(resolve(root,'node_modules/.bin/tauri'),process.argv.slice(2),{cwd:root,env,stdio:'inherit'})
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal))
child.on('exit',code=>{process.exitCode=code??1})
child.on('error',error=>{console.error(error.message);process.exitCode=1})
