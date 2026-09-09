import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'

export type ColorTheme = 'light' | 'dark'

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => {
    ready: Promise<void>
    finished?: Promise<void>
  }
}
type TransitionWindow = Window & {__viewTransitionStyleCount?: number}
type BlurFadeThemeContext = {
  theme: ColorTheme
  triggerTransition: (customDuration?: number, customBlur?: number) => void
  isAnimating: boolean
}

const ThemeTransitionContext = createContext<BlurFadeThemeContext | undefined>(undefined)

export function useBlurFadeThemeTransition() {
  const context = useContext(ThemeTransitionContext)
  if (!context) throw new Error('useBlurFadeThemeTransition must be used within BlurFadeThemeTransition')
  return context
}

type BlurFadeThemeTransitionProps = {
  children?: ReactNode
  duration?: number
  maxBlur?: number
  easing?: string
  onTransition?: () => void
  theme?: ColorTheme
  onThemeChange?: (theme: ColorTheme) => void
}

/** Adapted from Great UI's MIT-licensed Blur Fade Theme Transition. */
export default function BlurFadeThemeTransition({
  children,
  duration = 500,
  maxBlur = 16,
  easing = 'ease-in-out',
  onTransition,
  theme: themeProp,
  onThemeChange,
}: BlurFadeThemeTransitionProps) {
  const [localTheme, setLocalTheme] = useState<ColorTheme>(() =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  )
  const [isAnimating, setIsAnimating] = useState(false)
  const controlled = themeProp !== undefined
  const activeTheme = controlled ? themeProp : localTheme

  useEffect(() => {
    const styleId = 'great-ui-view-transition-styles'
    let style = document.getElementById(styleId) as HTMLStyleElement | null
    if (!style) {
      style = document.createElement('style')
      style.id = styleId
      style.textContent = `
        ::view-transition-old(root), ::view-transition-new(root) {
          animation: none !important;
          mix-blend-mode: normal !important;
          display: block !important;
          width: 100% !important;
          height: 100% !important;
          object-fit: cover !important;
        }
        ::view-transition-image-pair(root) { isolation: auto !important; }
        ::view-transition-old(root) { z-index: 1 !important; }
        ::view-transition-new(root) { z-index: 9999 !important; }
      `
      document.head.appendChild(style)
    }
    const transitionWindow = window as TransitionWindow
    transitionWindow.__viewTransitionStyleCount = (transitionWindow.__viewTransitionStyleCount ?? 0) + 1
    return () => {
      transitionWindow.__viewTransitionStyleCount = Math.max(0, (transitionWindow.__viewTransitionStyleCount ?? 1) - 1)
      if (transitionWindow.__viewTransitionStyleCount === 0) document.getElementById(styleId)?.remove()
    }
  }, [])

  const triggerTransition = useCallback((customDuration?: number, customBlur?: number) => {
    window.getSelection()?.removeAllRanges()
    if (isAnimating) return

    const activeDuration = customDuration ?? duration
    const activeBlur = customBlur ?? maxBlur
    const targetTheme = activeTheme === 'light' ? 'dark' : 'light'
    const applyTheme = () => {
      if (!controlled) setLocalTheme(targetTheme)
      document.documentElement.dataset.theme = targetTheme
      document.documentElement.classList.toggle('dark', targetTheme === 'dark')
      document.documentElement.style.colorScheme = targetTheme
      onThemeChange?.(targetTheme)
    }
    const transitionDocument = document as ViewTransitionDocument

    if (!transitionDocument.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      applyTheme()
      onTransition?.()
      return
    }

    setIsAnimating(true)
    const animationStyleId = 'great-ui-blur-anim-style'
    let animationStyle = document.getElementById(animationStyleId) as HTMLStyleElement | null
    if (!animationStyle) {
      animationStyle = document.createElement('style')
      animationStyle.id = animationStyleId
      document.head.appendChild(animationStyle)
    }
    animationStyle.textContent = `
      @keyframes great-ui-blur-old {
        from { filter: blur(0); opacity: 1; }
        to { filter: blur(${activeBlur}px); opacity: 0; }
      }
      @keyframes great-ui-blur-new {
        from { filter: blur(${activeBlur}px); opacity: 0; }
        to { filter: blur(0); opacity: 1; }
      }
      ::view-transition-old(root) {
        animation: great-ui-blur-old ${activeDuration}ms ${easing} both !important;
      }
      ::view-transition-new(root) {
        animation: great-ui-blur-new ${activeDuration}ms ${easing} both !important;
      }
    `
    const cleanup = () => {
      document.getElementById(animationStyleId)?.remove()
      setIsAnimating(false)
    }

    try {
      const transition = transitionDocument.startViewTransition(() => {
        flushSync(() => {
          applyTheme()
          onTransition?.()
        })
      })
      if (transition.finished) transition.finished.then(cleanup).catch(cleanup)
      else window.setTimeout(cleanup, activeDuration)
    } catch {
      cleanup()
      applyTheme()
      onTransition?.()
    }
  }, [activeTheme, controlled, duration, easing, isAnimating, maxBlur, onThemeChange, onTransition])

  const contextValue = useMemo(() => ({theme: activeTheme, triggerTransition, isAnimating}), [activeTheme, isAnimating, triggerTransition])
  return (
    <ThemeTransitionContext.Provider value={contextValue}>
      {children}
    </ThemeTransitionContext.Provider>
  )
}
