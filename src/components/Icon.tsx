import { Icon as Iconify, addCollection } from '@iconify/react'
import icons from '../icons.generated.json'
import fileIcons from '../file-icons.generated.json'
import skillIcons from '../skill-icons.generated.json'
// Bundle a single official icon family; rendering makes no network requests.
addCollection(icons)
addCollection(fileIcons)
addCollection(skillIcons)

export function Icon({ name, className }: { name: string; className?: string }) {
  const iconName = name.includes(':') ? name : `ph:${name}`
  return <Iconify icon={iconName} className={className} aria-hidden />
}
const byExtension:Record<string,string>={ts:'typescript',mts:'typescript',cts:'typescript',js:'javascript',mjs:'javascript',cjs:'javascript',tsx:'typescript-react',jsx:'javascript-react',json:'json',jsonc:'json',md:'markdown',mdx:'markdown-mdx',html:'html',htm:'html',css:'css',less:'css',scss:'sass',sass:'sass',vue:'vue',rs:'rust',go:'go',py:'python',sh:'bash',bash:'bash',zsh:'bash',fish:'bash',yml:'yaml',yaml:'yaml',toml:'toml',png:'image',jpg:'image',jpeg:'image',gif:'image',webp:'image',svg:'svg',pdf:'pdf',astro:'astro',svelte:'svelte',xml:'xml',graphql:'graphql',gql:'graphql',sql:'database',c:'c',h:'c',cpp:'cpp',cc:'cpp',java:'java',kt:'kotlin',swift:'swift',php:'php',rb:'ruby',pl:'perl',lua:'lua',vim:'vim'}
function fileType(path:string){const file=path.trim().split(/[\\/]/).at(-1)?.toLowerCase()??'';if(file==='package.json')return 'npm';if(file==='bun.lock')return 'bun-lock';if(file==='.env'||file.startsWith('.env.'))return 'env';if(file==='dockerfile'||file.endsWith('.dockerfile'))return 'docker';if(file.endsWith('.config')||file.endsWith('.conf'))return 'config';if(file.endsWith('.lock'))return 'lock';return byExtension[file.split('.').at(-1)??'']??'file'}
export function FileIcon({path,className}:{path:string;className?:string}){return <Iconify icon={`catppuccin:${fileType(path)}`} className={className} aria-hidden />}
