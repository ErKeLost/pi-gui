import { describe, expect, test } from 'bun:test'
import { applyGuiToolSelection, parseSessionMetadata } from '../src-tauri/resources/gui-extension'

describe('agent-generated session metadata', () => {
  test('accepts compact titles and supported semantic icons', () => {
    expect(parseSessionMetadata('```json\n{"title":"修复启动竞态","icon":"bug"}\n```')).toEqual({title:'修复启动竞态',icon:'bug'})
  })

  test('uses the default icon for an unsupported model choice', () => {
    expect(parseSessionMetadata('{"title":"分析会话","icon":"made-up"}')).toEqual({title:'分析会话',icon:'chat-teardrop-text'})
  })
})

describe('generic tool selection', () => {
  test('cannot enable or disable computer-use tools outside the dedicated mode switch', () => {
    expect(applyGuiToolSelection(['read', 'gui_task'], ['bash'])).toEqual(['read'])
    expect(applyGuiToolSelection(['read'], ['bash', 'gui_task'])).toEqual(['read', 'gui_task'])
  })
})
