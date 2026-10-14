import { describe, expect, it } from 'vitest'
import type { QueueToken } from '../types'
import { resolveQueueTokenFromQr } from './qrTokens'

const token: QueueToken = {
  id: 'patient-123',
  token: 'A-001',
  patientId: 'patient-123',
  patientName: 'Demo Patient',
  email: 'demo@example.com',
  service: 'General Medicine',
  complaint: 'Routine check',
  issuedAt: '2026-10-08T08:00:00.000Z',
  status: 'Waiting',
  isCheckedIn: false,
}

describe('resolveQueueTokenFromQr', () => {
  it('matches the current JSON QR payload by ID and token', () => {
    expect(resolveQueueTokenFromQr(JSON.stringify({ id: token.id, token: token.token }), [token])).toBe(token)
  })

  it('matches older plain-text tokens without case sensitivity', () => {
    expect(resolveQueueTokenFromQr('a-001', [token])).toBe(token)
  })

  it('rejects payloads whose patient ID and token disagree', () => {
    expect(resolveQueueTokenFromQr(JSON.stringify({ id: token.id, token: 'B-002' }), [token])).toBeUndefined()
  })
})