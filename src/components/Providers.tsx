import {useEffect, useState, type ReactNode} from 'react'
import {LazyMotion, MotionConfig, domAnimation} from 'motion/react'
import SplitThemeProvider, {type ColorTheme, type ThemePreference} from './SplitThemeProvider'
import {PromptProvider} from './UI'
import {TooltipProvider} from '@/components/ui/tooltip'
import { ToastHost } from './ToastHost'
import { UpdateChecker } from './UpdateChecker'

const themeKey='pi-gui.theme'
function readPreference():ThemePreference {
 const saved=localStorage.getItem(themeKey)
 return saved==='light'||saved==='dark'?saved:'system'
}
function resolveTheme(preference:ThemePreference):ColorTheme {
 const theme:ColorTheme=preference==='light'||preference==='dark'?preference:window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'
 document.documentElement.dataset.theme=theme
 document.documentElement.classList.toggle('dark',theme==='dark')
 document.documentElement.style.colorScheme=theme
 return theme
}
export function Providers({children}:{children:ReactNode}){
 const [preference,setPreferenceState]=useState<ThemePreference>(readPreference)
 const [theme,setTheme]=useState<ColorTheme>(()=>resolveTheme(readPreference()))
 const changeTheme=(next:ColorTheme)=>{localStorage.setItem(themeKey,next);setPreferenceState(next);setTheme(next)}
 const setPreference=(next:ThemePreference)=>{localStorage.setItem(themeKey,next);setPreferenceState(next);setTheme(resolveTheme(next))}
 useEffect(()=>{
  if(preference!=='system') return
  const media=window.matchMedia('(prefers-color-scheme: light)')
  const sync=()=>{const next:ColorTheme=media.matches?'light':'dark';document.documentElement.dataset.theme=next;document.documentElement.classList.toggle('dark',next==='dark');document.documentElement.style.colorScheme=next;setTheme(next)}
  media.addEventListener?.('change',sync)
  return()=>media.removeEventListener?.('change',sync)
 },[preference])
 return <LazyMotion features={domAnimation}><MotionConfig reducedMotion="user"><TooltipProvider><SplitThemeProvider direction="horizontal" mode="in-to-out" theme={theme} preference={preference} onPreferenceChange={setPreference} onThemeChange={changeTheme}><PromptProvider><UpdateChecker/><ToastHost theme={theme}/>{children}</PromptProvider></SplitThemeProvider></TooltipProvider></MotionConfig></LazyMotion>
}
