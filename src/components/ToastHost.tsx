import { useEffect, useRef } from 'react'
import { GooeyToaster, gooeyToast } from 'goey-toast'
import { useWorkspace } from '../lib/store'
import type { ColorTheme } from './SplitThemeProvider'

/** Bridges protocol-level notifications into the single app-wide toast surface. */
export function ToastHost({ theme }: { theme: ColorTheme }) {
  const error = useWorkspace(state => state.error)
  const transcriptError = useWorkspace(state => state.transcript.error)
  const notices = useWorkspace(state => state.notices)
  const lastError = useRef<string | null>(null)
  const lastTranscriptError = useRef<string | null>(null)

  useEffect(() => {
    if (error && error !== lastError.current) {
      lastError.current = error
      gooeyToast.error(error, { description: '操作未完成', duration: 6000, showTimestamp: false })
      useWorkspace.getState().set({ error: null })
    } else if (!error) {
      lastError.current = null
    }
  }, [error])

  useEffect(() => {
    if (transcriptError && transcriptError !== lastTranscriptError.current) {
      lastTranscriptError.current = transcriptError
      gooeyToast.error(transcriptError, { description: '会话异常', duration: 6000, showTimestamp: false })
      useWorkspace.getState().set({ transcript: { ...useWorkspace.getState().transcript, error: null } })
    } else if (!transcriptError) {
      lastTranscriptError.current = null
    }
  }, [transcriptError])

  useEffect(() => {
    if (!notices.length) return
    notices.forEach(notice => gooeyToast.info(notice, { showTimestamp: false }))
    useWorkspace.getState().set({ notices: [] })
  }, [notices])

  return <GooeyToaster position="bottom-right" theme={theme} preset="smooth" closeButton="top-right" showTimestamp={false} visibleToasts={4} offset="24px" />
}
