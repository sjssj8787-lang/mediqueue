import { describe, expect, it } from 'vitest'
import { formatLocalDate, formatLocalDateTime, localDateKey } from './dateTime'

describe('local date and time formatting', () => {
  it('formats dates using local calendar fields', () => {
    expect(formatLocalDate(new Date(2026, 9, 14, 8, 5))).toBe('2026-10-14')
  })

  it('formats values for datetime-local inputs without a timezone shift', () => {
    expect(formatLocalDateTime(new Date(2026, 9, 14, 8, 5))).toBe('2026-10-14T08:05')
  })

  it('converts stored timestamps to their local calendar date', () => {
    const localDate = new Date(2026, 9, 14, 0, 30)
    expect(localDateKey(localDate.toISOString())).toBe(formatLocalDate(localDate))
  })

  it('returns an empty date key for invalid timestamps', () => {
    expect(localDateKey('not-a-date')).toBe('')
  })
})