import { describe, expect, test } from 'bun:test'
import { shouldSubmitComposer } from '../src/lib/composer'

const enter = {key:'Enter',shiftKey:false,isComposing:false,keyCode:13}

describe('composer Enter handling', () => {
  test('submits an ordinary Enter key', () => {
    expect(shouldSubmitComposer(enter, false)).toBe(true)
  })

  test('does not submit while a Chinese IME is selecting text', () => {
    expect(shouldSubmitComposer({...enter,isComposing:true}, false)).toBe(false)
    expect(shouldSubmitComposer({...enter,keyCode:229}, false)).toBe(false)
    expect(shouldSubmitComposer(enter, true)).toBe(false)
  })

  test('keeps Shift Enter available for a new line', () => {
    expect(shouldSubmitComposer({...enter,shiftKey:true}, false)).toBe(false)
  })
})
