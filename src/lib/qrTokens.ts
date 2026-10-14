import type { QueueToken } from '../types'

export function resolveQueueTokenFromQr(qrValue: string, tokens: QueueToken[]): QueueToken | undefined {
  const value = qrValue.trim()
  if (!value) return undefined

  try {
    const payload: unknown = JSON.parse(value)
    if (payload && typeof payload === 'object') {
      const { id, token } = payload as { id?: unknown; token?: unknown }
      const idValue = typeof id === 'string' ? id.trim() : ''
      const tokenValue = typeof token === 'string' ? token.trim() : ''
      const matchedById = idValue ? tokens.find((entry) => entry.id === idValue) : undefined

      if (matchedById && tokenValue && matchedById.token.toLowerCase() !== tokenValue.toLowerCase()) {
        return undefined
      }
      if (matchedById) return matchedById
      if (tokenValue) {
        return tokens.find((entry) => entry.token.toLowerCase() === tokenValue.toLowerCase())
      }
      return undefined
    }
  } catch {
    // Older passes may contain only the token text.
  }

  return tokens.find(
    (entry) => entry.token.toLowerCase() === value.toLowerCase() || entry.id === value
  )
}