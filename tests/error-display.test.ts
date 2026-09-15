import { describe, expect, test } from 'bun:test'
import { emptyTranscript, reduceEvent } from '../src/lib/protocol'

describe('Pi error projection', () => {
  test('keeps provider errors visible in transcript state', () => {
    const state = reduceEvent(emptyTranscript(), {
      type: 'message_end',
      message: { role: 'assistant', content: [], errorMessage: 'provider rejected image input' },
    })
    expect(state.error).toBe('provider rejected image input')
  })
})
