import {useState, type ReactNode} from 'react'
import {LazyMotion, MotionConfig, domAnimation} from 'motion/react'
import BlurFadeThemeTransition, {type ColorTheme} from './BlurFadeThemeTransition'
import {PromptProvider} from './UI'
import {TooltipProvider} from '@/components/ui/tooltip'

const themeKey='pi-gui.theme'
function initialTheme():ColorTheme {
 const saved=localStorage.getItem(themeKey)
 const theme:ColorTheme=saved==='light'||saved==='dark'?saved:window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'
 document.documentElement.dataset.theme=theme
 document.documentElement.classList.toggle('dark',theme==='dark')
 document.documentElement.style.colorScheme=theme
 return theme
}
export function Providers({children}:{children:ReactNode}){
 const [theme,setTheme]=useState<ColorTheme>(initialTheme)
 const changeTheme=(next:ColorTheme)=>{localStorage.setItem(themeKey,next);setTheme(next)}
 return <LazyMotion features={domAnimation}><MotionConfig reducedMotion="user"><TooltipProvider><BlurFadeThemeTransition theme={theme} onThemeChange={changeTheme}><PromptProvider>{children}</PromptProvider></BlurFadeThemeTransition></TooltipProvider></MotionConfig></LazyMotion>
}
