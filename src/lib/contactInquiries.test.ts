import { describe, expect, it } from 'vitest'
import { generateContactInquiryId, normalizeContactInquiry } from './contactInquiries'

describe('contact inquiry helpers', () => {
  it('creates a UUID-like inquiry id', () => {
    const id = generateContactInquiryId()

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })

  it('normalizes database rows to ContactInquiry shape', () => {
    const inquiry = normalizeContactInquiry({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Alice',
      email: 'alice@example.com',
      message: 'Need help',
      created_at: '2026-10-10T00:00:00.000Z',
      status: 'Unread',
    })

    expect(inquiry).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Alice',
      email: 'alice@example.com',
      message: 'Need help',
      createdAt: '2026-10-10T00:00:00.000Z',
      status: 'Unread',
    })
  })
})
