import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PatientVitals } from '../types'
import { analyzePatientSymptomsAsync, analyzeVitalsAndTriage, getTriageRiskRating } from './aiService'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const normalVitals: PatientVitals = {
  bloodPressure: '120/80',
  heartRate: '75 bpm',
  temperature: '37.0 °C',
  oxygenLevel: '98 %',
}

describe('AI triage risk rating', () => {
  it('flags red-flag symptoms as emergency and converts the score to a 10-point rating', () => {
    const triage = analyzeVitalsAndTriage(normalVitals, '35', 'Severe chest pain and difficulty breathing')

    expect(triage.triageLevel).toBe('Emergency')
    expect(getTriageRiskRating(triage.triageScore)).toEqual({
      scoreOutOfTen: '8.8',
      band: 'emergency',
      label: 'Serious - immediate review',
    })
  })

  it('keeps normal vitals and a routine complaint in the green screening band', () => {
    const triage = analyzeVitalsAndTriage(normalVitals, '35', 'Routine health check')

    expect(triage.triageLevel).toBe('Low Priority')
    expect(getTriageRiskRating(triage.triageScore).band).toBe('normal')
  })
})

describe('live AI provider fallback', () => {
  it('labels an OpenAI authentication failure as offline and preserves the reason', async () => {
    vi.stubEnv('VITE_GEMINI_API_KEY', '')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'Invalid API key' } }),
    }))

    const result = await analyzePatientSymptomsAsync('Routine checkup', '35', 'test-key')

    expect(result.source).toBe('offline')
    expect(result.providerError).toBe('Invalid API key')
  })
})
