import { describe, expect, test } from 'bun:test'
import { ensureImageInput, parseSessionMetadata } from '../src-tauri/resources/gui-extension'

describe('relay image capability workaround', () => {
  test('preserves text input and adds image input to every model declaration', () => {
    const model: {input: ('text'|'image')[]} = { input: ['text'] }
    expect(ensureImageInput(model)).toBe(true)
    expect(model.input).toEqual(['text', 'image'])
    expect(ensureImageInput(model)).toBe(false)
  })
})

describe('agent-generated session metadata', () => {
  test('accepts compact titles and supported semantic icons', () => {
    expect(parseSessionMetadata('```json\n{"title":"修复启动竞态","icon":"bug"}\n```')).toEqual({title:'修复启动竞态',icon:'bug'})
  })

  test('uses the default icon for an unsupported model choice', () => {
    expect(parseSessionMetadata('{"title":"分析会话","icon":"made-up"}')).toEqual({title:'分析会话',icon:'chat-teardrop-text'})
  })
})
