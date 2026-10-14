import { describe, expect, it } from 'vitest'
import type { QueueToken } from '../types'
import { buildQueueCsv, calculateQueueInsights, getQueuePosition } from './queueInsights'

const sampleTokens: QueueToken[] = [
  {
    id: 't-1',
    token: 'A-001',
    patientId: 'p-1',
    patientName: 'Ayesha',
    email: 'a@demo.com',
    age: '28',
    service: 'General Medicine',
    complaint: 'Fever',
    issuedAt: '2026-10-06T07:30:00.000Z',
    status: 'Waiting',
    isCheckedIn: false,
  },
  {
    id: 't-2',
    token: 'A-002',
    patientId: 'p-2',
    patientName: 'Sameer',
    email: 's@demo.com',
    age: '35',
    service: 'Dental',
    complaint: 'Tooth pain',
    issuedAt: '2026-10-06T07:55:00.000Z',
    status: 'Checked In',
    isCheckedIn: true,
    checkedInAt: '2026-10-06T08:10:00.000Z',
    checkInData: {
      checkedInAt: '2026-10-06T08:10:00.000Z',
      vitals: {
        bloodPressure: '140/90',
        heartRate: '90 bpm',
        temperature: '38.2 °C',
        oxygenLevel: '96 %',
      },
      triageLevel: 'Urgent',
      triageScore: 75,
      aiRiskSummary: 'Needs prompt review',
      assignedDoctor: 'Dr. Rao',
      roomNumber: 'Room 2',
      chiefComplaint: 'Tooth pain',
    },
  },
  {
    id: 't-3',
    token: 'A-003',
    patientId: 'p-3',
    patientName: 'Naina',
    email: 'n@demo.com',
    age: '44',
    service: 'General Medicine',
    complaint: 'High BP',
    issuedAt: '2026-10-06T08:00:00.000Z',
    status: 'In progress',
    isCheckedIn: true,
    checkedInAt: '2026-10-06T08:15:00.000Z',
    checkInData: {
      checkedInAt: '2026-10-06T08:15:00.000Z',
      vitals: {
        bloodPressure: '160/95',
        heartRate: '102 bpm',
        temperature: '37.4 °C',
        oxygenLevel: '94 %',
      },
      triageLevel: 'Emergency',
      triageScore: 92,
      aiRiskSummary: 'Needs emergency review',
      assignedDoctor: 'Dr. Rao',
      roomNumber: 'Room 1',
      chiefComplaint: 'High BP',
    },
  },
]

describe('calculateQueueInsights', () => {
  it('summarizes current queue status and measured wait durations accurately', () => {
    const referenceTime = new Date('2026-10-06T09:00:00.000Z').getTime()
    const result = calculateQueueInsights(sampleTokens, referenceTime)

    expect(result.totalPatients).toBe(3)
    expect(result.waitingNow).toBe(1)
    expect(result.checkedIn).toBe(2)
    expect(result.emergencyFlags).toBe(2)
    expect(result.nextToken).toBe('A-001')
    expect(result.busiestService).toBe('General Medicine')
    expect(result.avgWaitMinutes).toBe(40)
  })

  it('excludes completed patients from current check-in and next-patient counts', () => {
    const tokens: QueueToken[] = [
      { ...sampleTokens[0], status: 'Completed', isCheckedIn: true },
      { ...sampleTokens[1], status: 'Waiting', isCheckedIn: false },
    ]

    const result = calculateQueueInsights(tokens, new Date('2026-10-06T09:00:00.000Z').getTime())

    expect(result.waitingNow).toBe(1)
    expect(result.checkedIn).toBe(0)
    expect(result.nextToken).toBe('A-002')
  })
})

describe('getQueuePosition', () => {
  it('keeps checked-in patients in FIFO order until they are completed', () => {
    const serviceQueue = sampleTokens.map((token) => ({ ...token, service: 'General Medicine' }))

    expect(getQueuePosition(serviceQueue[2], serviceQueue)).toBe(3)
    expect(getQueuePosition(serviceQueue[2], [
      { ...serviceQueue[0], status: 'Completed' as const },
      serviceQueue[1],
      serviceQueue[2],
    ])).toBe(2)
  })

  it('returns null for completed, cancelled, or expired tokens', () => {
    expect(getQueuePosition({ ...sampleTokens[0], status: 'Completed' }, sampleTokens)).toBeNull()
    expect(getQueuePosition({ ...sampleTokens[0], status: 'Cancelled' }, sampleTokens)).toBeNull()
    expect(getQueuePosition({ ...sampleTokens[0], status: 'Expired' }, sampleTokens)).toBeNull()
  })
})

describe('buildQueueCsv', () => {
  it('exports a CSV file with the main queue fields', () => {
    const csv = buildQueueCsv(sampleTokens)

    expect(csv).toContain('token,patientName,service,status,triageLevel')
    expect(csv).toContain('A-001')
    expect(csv).toContain('General Medicine')
  })

  it('escapes quotes, commas, and line breaks in patient-provided fields', () => {
    const token = {
      ...sampleTokens[0],
      patientName: 'Mehta, Priya',
      complaint: 'Fever, "mild"\nheadache',
    }

    const csv = buildQueueCsv([token])

    expect(csv).toContain('"Mehta, Priya"')
    expect(csv).toContain('"Fever, ""mild""\nheadache"')
  })
})
