import { describe, expect, test } from 'bun:test'
import { ensureImageInput } from '../src-tauri/resources/gui-extension'

describe('relay image capability workaround', () => {
  test('preserves text input and adds image input to every model declaration', () => {
    const model: {input: ('text'|'image')[]} = { input: ['text'] }
    expect(ensureImageInput(model)).toBe(true)
    expect(model.input).toEqual(['text', 'image'])
    expect(ensureImageInput(model)).toBe(false)
  })
})
