import { Icon as Iconify, addCollection } from '@iconify/react'
import icons from '../icons.generated.json'
// Bundle a single official icon family; rendering makes no network requests.
addCollection(icons)
export function Icon({name,className}:{name:string;className?:string}){return <Iconify icon={`ph:${name}`} className={className} aria-hidden />}
