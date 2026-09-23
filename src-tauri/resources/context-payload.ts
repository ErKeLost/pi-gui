const TOOL_BLOCK_TYPES = new Set([
  'function_call',
  'function_call_output',
  'tool_call',
  'tool_result',
  'tool_use',
])

const TOOL_FIELDS = new Set([
  'functionCall',
  'functionResponse',
  'function_call',
  'function_response',
  'toolCalls',
  'tool_calls',
  'toolUse',
  'tool_use',
  'tools',
])

function serializedChars(value: unknown) {
  try { return JSON.stringify(value)?.length ?? 0 } catch { return 0 }
}

/** Count the serialized provider payload attributable to tool schemas, calls, and results. */
export function providerToolChars(payload: unknown): number {
  if (Array.isArray(payload)) return payload.reduce((total, item) => total + providerToolChars(item), 0)
  if (!payload || typeof payload !== 'object') return 0
  const record = payload as Record<string, unknown>
  if (record.role === 'tool' || record.role === 'function') return serializedChars(record)
  if (typeof record.type === 'string' && TOOL_BLOCK_TYPES.has(record.type)) return serializedChars(record)
  return Object.entries(record).reduce((total, [key, value]) => {
    return total + (TOOL_FIELDS.has(key) ? serializedChars(value) : providerToolChars(value))
  }, 0)
}
