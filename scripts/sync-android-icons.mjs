import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const root=resolve(import.meta.dirname,'..')
const source=resolve(root,'src-tauri/icons/android')
const target=resolve(root,'src-tauri/gen/android/app/src/main/res')
const check=process.argv.includes('--check')
const stale=[
  resolve(target,'drawable/ic_launcher_background.xml'),
  resolve(target,'drawable-v24/ic_launcher_foreground.xml'),
]

function files(dir){
  return readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
    const path=join(dir,entry.name)
    return entry.isDirectory()?files(path):[path]
  })
}

if(!existsSync(target)){
  if(check)throw new Error('Android project is not initialized: '+target)
  process.exit(0)
}

const mismatches=files(source).filter(path=>{
  const destination=resolve(target,relative(source,path))
  return !existsSync(destination)||!readFileSync(path).equals(readFileSync(destination))
})
const obsolete=stale.filter(existsSync)

if(check){
  if(mismatches.length||obsolete.length){
    const changed=[...mismatches.map(path=>relative(source,path)),...obsolete.map(path=>relative(target,path))]
    throw new Error('Android launcher resources are stale:\n'+changed.map(path=>'  '+path).join('\n'))
  }
  process.exit(0)
}

for(const path of mismatches){
  const destination=resolve(target,relative(source,path))
  mkdirSync(resolve(destination,'..'),{recursive:true})
  cpSync(path,destination)
}
for(const path of obsolete)rmSync(path)

