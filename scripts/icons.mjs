import {readFileSync,writeFileSync} from 'node:fs'
const load=(path)=>JSON.parse(readFileSync(new URL(path,import.meta.url)))
const write=(path,collection,names)=>{
 for(const name of names)if(!collection.icons[name])throw new Error('Missing official icon: '+name)
 writeFileSync(new URL(path,import.meta.url),JSON.stringify({prefix:collection.prefix,width:collection.width,height:collection.height,icons:Object.fromEntries(names.map(name=>[name,collection.icons[name]]))})+'\n')
}
const phosphor=load('../node_modules/@iconify-json/ph/icons.json')
const phosphorNames=['code','user','brain','terminal-window','caret-down','copy','folder-open','magnifying-glass','arrow-up-right','arrow-down','paperclip','command','x','stop-fill','arrow-up','plus','chats','git-commit','arrow-bend-up-right','bookmark-simple','git-fork','tree-structure','sparkle','puzzle-piece','text-align-left','arrow-right','chat-circle-dots','chat-circle-text','sidebar-simple','folder-simple','caret-up-down','dots-three','chat-circle','gear-six','desktop','export','browser','warning-circle','info','sun','moon','palette','microphone','lightbulb','list','trash','translate','youtube-logo-fill','github-logo','x-logo','figma-logo','discord-logo','slack-logo','linkedin-logo','reddit-logo','file-magnifying-glass','globe','article','chart-bar','video-camera','image-square','film-strip','music-notes','cloud-sun','bug','database','list-checks','calendar-blank','rocket-launch','magic-wand','book-open','robot','chat-teardrop-text','cube','note-pencil','stack','compass','package','leaf']
write('../src/icons.generated.json',phosphor,phosphorNames)
const catppuccin=load('../node_modules/@iconify-json/catppuccin/icons.json')
const fileNames=['file','typescript','typescript-react','javascript','javascript-react','json','markdown','markdown-mdx','html','css','sass','vue','rust','go','python','bash','bun','bun-lock','yaml','toml','image','pdf','npm','env','docker','astro','svelte','xml','graphql','svg','database','config','lock','c','cpp','java','kotlin','swift','php','ruby','perl','lua','vim']
write('../src/file-icons.generated.json',catppuccin,fileNames)
const vscode=load('../node_modules/@iconify-json/vscode-icons/icons.json')
const skillIconNames=['file-type-audio','file-type-excel2','file-type-html','file-type-image','file-type-markdown','file-type-pdf2','file-type-powerpoint2','file-type-python','file-type-svg','file-type-typescript','file-type-video','file-type-word2','folder-type-github']
write('../src/skill-icons.generated.json',vscode,skillIconNames)
