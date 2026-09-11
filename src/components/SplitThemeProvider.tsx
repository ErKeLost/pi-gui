import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
export type ColorTheme = 'light' | 'dark'
export type SplitDirection = 'horizontal' | 'vertical'
export type SplitMode = 'in-to-out' | 'out-to-in'
export type ThemePreference = ColorTheme | 'system'
type SplitThemeContextValue = { theme: ColorTheme; preference: ThemePreference; setPreference: (preference: ThemePreference) => void; direction: SplitDirection; mode: SplitMode; triggerTransition: (direction?: SplitDirection, mode?: SplitMode) => void; isAnimating: boolean }
const SplitThemeContext = createContext<SplitThemeContextValue | undefined>(undefined)
export function useSplitTheme() { const value = useContext(SplitThemeContext); if (!value) throw new Error('useSplitTheme must be used within SplitThemeProvider'); return value }
type Props = { children?: ReactNode; duration?: number; easing?: string; theme?: ColorTheme; preference?: ThemePreference; onPreferenceChange?: (preference: ThemePreference) => void; onThemeChange?: (theme: ColorTheme) => void; direction?: SplitDirection; mode?: SplitMode }
type ViewTransitionDocument = Document & { startViewTransition?: (callback: () => void) => { finished?: Promise<void> } }
export default function SplitThemeProvider({ children, duration = 600, easing = 'ease-in-out', theme: themeProp, preference: preferenceProp = 'system', onPreferenceChange, onThemeChange, direction = 'horizontal', mode = 'in-to-out' }: Props) {
 const [localTheme, setLocalTheme] = useState<ColorTheme>(() => document.documentElement.classList.contains('dark') ? 'dark' : 'light')
 const [mounted, setMounted] = useState(false), [isAnimating, setIsAnimating] = useState(false)
 const [fallback, setFallback] = useState<{target:ColorTheme;direction:SplitDirection;mode:SplitMode}|null>(null)
 const controlled = themeProp !== undefined, activeTheme = themeProp ?? localTheme
 const setPreference = useCallback((next: ThemePreference) => { onPreferenceChange?.(next); if (next !== 'system' && next !== activeTheme) onThemeChange?.(next) }, [activeTheme, onPreferenceChange, onThemeChange])
 useEffect(() => { const timer=window.setTimeout(()=>setMounted(true),0); const styleId='great-ui-view-transition-styles'; let style=document.getElementById(styleId) as HTMLStyleElement|null; if(!style){style=document.createElement('style');style.id=styleId;style.textContent='::view-transition-old(root),::view-transition-new(root){animation:none!important;mix-blend-mode:normal!important;display:block!important;width:100%!important;height:100%!important;object-fit:cover!important}::view-transition-old(root){z-index:1!important}::view-transition-new(root){z-index:9999!important}';document.head.appendChild(style)} return()=>{window.clearTimeout(timer);style?.remove()} },[])
 const triggerTransition = useCallback((nextDirection=direction,nextMode=mode)=>{
  if(isAnimating)return
  const targetTheme:ColorTheme=activeTheme==='light'?'dark':'light'
  const applyTheme=()=>{if(!controlled)setLocalTheme(targetTheme);const root=document.documentElement;root.dataset.theme=targetTheme;root.classList.toggle('dark',targetTheme==='dark');root.style.colorScheme=targetTheme;onThemeChange?.(targetTheme)}
  const doc=document as ViewTransitionDocument
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){ applyTheme(); return }
  if(!doc.startViewTransition){
   setIsAnimating(true); setFallback({target:targetTheme,direction:nextDirection,mode:nextMode})
   const wait=Math.max(180,duration)
   window.setTimeout(()=>{ applyTheme(); setFallback(null); setIsAnimating(false) },wait)
   return
  }
  setIsAnimating(true);const styleId='great-ui-split-anim-style';let style=document.getElementById(styleId) as HTMLStyleElement|null;if(!style){style=document.createElement('style');style.id=styleId;document.head.appendChild(style)}
  const inset=nextDirection==='horizontal'?'inset(0 50% 0 50%)':'inset(50% 0 50% 0)';style.textContent=nextMode==='in-to-out'?`@keyframes great-ui-split-in-to-out{from{clip-path:${inset};-webkit-clip-path:${inset}}to{clip-path:inset(0);-webkit-clip-path:inset(0)}}::view-transition-old(root){opacity:1!important;z-index:1!important}::view-transition-new(root){animation:great-ui-split-in-to-out ${duration}ms ${easing} both!important;z-index:9999!important}`:`@keyframes great-ui-split-out-to-in{from{clip-path:inset(0);-webkit-clip-path:inset(0)}to{clip-path:${inset};-webkit-clip-path:${inset}}}::view-transition-old(root){animation:great-ui-split-out-to-in ${duration}ms ${easing} both!important;z-index:9999!important}::view-transition-new(root){opacity:1!important;z-index:1!important}`
  const cleanup=()=>{document.getElementById(styleId)?.remove();setIsAnimating(false)};try{const transition=doc.startViewTransition(()=>flushSync(applyTheme));transition.finished?.then(cleanup).catch(cleanup);window.setTimeout(cleanup,duration+180)}catch{cleanup();applyTheme()}
 },[activeTheme,controlled,direction,duration,easing,isAnimating,mode,onThemeChange])
 const value=useMemo(()=>({theme:activeTheme,preference:preferenceProp,setPreference,direction,mode,triggerTransition,isAnimating}),[activeTheme,preferenceProp,setPreference,direction,mode,triggerTransition,isAnimating]);if(!mounted)return null
 return <SplitThemeContext.Provider value={value}>{children}{fallback&&<div aria-hidden className={`split-theme-fallback ${fallback.direction} ${fallback.mode}`} data-target-theme={fallback.target}/>}</SplitThemeContext.Provider>
}
