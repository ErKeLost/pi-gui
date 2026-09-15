export type ComposerKeyEvent = {
  key: string
  shiftKey: boolean
  isComposing: boolean
  keyCode: number
}

export function shouldSubmitComposer(event: ComposerKeyEvent, composing: boolean) {
  return event.key === 'Enter' && !event.shiftKey && !composing && !event.isComposing && event.keyCode !== 229
}
