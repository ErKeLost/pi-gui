import { describe, expect, test } from 'bun:test'
import { emptyTranscript, formatTranscriptError, reduceEvent } from '../src/lib/protocol'

describe('Pi error projection', () => {
  test('keeps provider errors visible in transcript state', () => {
    const state = reduceEvent(emptyTranscript(), {
      type: 'message_end',
      message: { role: 'assistant', content: [], errorMessage: 'provider rejected image input' },
    })
    expect(state.error).toBe('provider rejected image input')
  })

  test('shows the provider error message instead of raw JSON', () => {
    expect(formatTranscriptError('403 {"type":"error","error":{"type":"permission_error","message":"Request not allowed"}}')).toBe('Request not allowed')
  })

  test('falls back to a short label when JSON has no message', () => {
    expect(formatTranscriptError('403 {"type":"error","error":{"type":"permission_error"}}')).toBe('403 · permission_error')
  })

  test('keeps plain session errors readable', () => {
    expect(formatTranscriptError('provider rejected image input')).toBe('provider rejected image input')
  })

  test('hides the previous turn error as soon as a new prompt is submitted', () => {
    const failed = reduceEvent(emptyTranscript(), {
      type: 'message_start',
      message: { role: 'assistant', content: [] },
    })
    const ended = reduceEvent(failed, {
      type: 'message_end',
      message: { role: 'assistant', content: [], errorMessage: 'old provider error' },
    })
    const next = reduceEvent(ended, { type: 'prompt_submitted' })

    expect(next.error).toBeNull()
    expect(next.messages[0].message.errorMessage).toBeUndefined()
  })
})
