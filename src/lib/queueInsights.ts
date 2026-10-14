import type { QueueToken } from '../types'

export type QueueInsightSummary = {
  totalPatients: number
  waitingNow: number
  checkedIn: number
  emergencyFlags: number
  avgWaitMinutes: number
  nextToken: string
  busiestService: string
  completionRate: number
  recommendedAction: string
}

export function getQueuePosition(token: QueueToken, tokens: QueueToken[]): number | null {
  if (
    token.isExpired ||
    token.status === 'Completed' ||
    token.status === 'Cancelled' ||
    token.status === 'Expired'
  ) return null

  const activeServiceQueue = tokens
    .filter((entry) =>
      entry.service === token.service &&
      !entry.isExpired &&
      entry.status !== 'Completed' &&
      entry.status !== 'Cancelled' &&
      entry.status !== 'Expired'
    )
    .sort((first, second) => new Date(first.issuedAt).getTime() - new Date(second.issuedAt).getTime())

  const index = activeServiceQueue.findIndex((entry) => entry.id === token.id)
  return index < 0 ? null : index + 1
}

export function calculateQueueInsights(tokens: QueueToken[], referenceTime = Date.now()): QueueInsightSummary {
  const totalPatients = tokens.length
  const waitingNow = tokens.filter((token) => token.status === 'Waiting' && !token.isCheckedIn && !token.isExpired).length
  const checkedIn = tokens.filter((token) => token.status === 'Checked In' || token.status === 'In progress').length
  const emergencyFlags = tokens.filter((token) => {
    const triageLevel = token.checkInData?.triageLevel
    const triageScore = token.checkInData?.triageScore ?? 0
    return triageLevel === 'Emergency' || triageLevel === 'Urgent' || triageScore >= 70
  }).length

  const waitMinutes = tokens.flatMap((token) => {
    if (token.status === 'Cancelled' || token.status === 'Expired' || token.isExpired) return []

    const issuedAt = new Date(token.issuedAt).getTime()
    const checkedInAt = token.checkedInAt ?? token.checkInData?.checkedInAt
    const waitEndedAt = token.status === 'Waiting' && !token.isCheckedIn
      ? referenceTime
      : checkedInAt
        ? new Date(checkedInAt).getTime()
        : Number.NaN

    if (!Number.isFinite(issuedAt) || !Number.isFinite(waitEndedAt) || waitEndedAt < issuedAt) return []
    return [Math.round((waitEndedAt - issuedAt) / 60000)]
  })

  const avgWaitMinutes = waitMinutes.length > 0
    ? Math.round(waitMinutes.reduce((sum, minutes) => sum + minutes, 0) / waitMinutes.length)
    : 0

  const nextToken = [...tokens]
    .sort((a, b) => new Date(a.issuedAt).getTime() - new Date(b.issuedAt).getTime())
    .find((token) => token.status === 'Waiting' && !token.isCheckedIn && !token.isExpired)?.token ?? 'None'

  const serviceCounts = tokens.reduce<Record<string, number>>((result, token) => {
    const service = token.service || 'General Care'
    result[service] = (result[service] ?? 0) + 1
    return result
  }, {})

  const busiestService = Object.entries(serviceCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'No active service'

  const completionRate = totalPatients > 0
    ? Math.round((tokens.filter((token) => token.status === 'Completed').length / totalPatients) * 100)
    : 0

  const recommendedAction = emergencyFlags > 0
    ? 'Escalate emergency and urgent triage before standard queue entries.'
    : waitingNow > 0
      ? 'Keep the waiting line moving with faster room assignment and registration.'
      : 'Queue is stable. Monitor patient arrivals and appointment flow.'

  return {
    totalPatients,
    waitingNow,
    checkedIn,
    emergencyFlags,
    avgWaitMinutes,
    nextToken,
    busiestService,
    completionRate,
    recommendedAction,
  }
}

function escapeCsvValue(value: string | number | undefined): string {
  const raw = String(value ?? '')
  return /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw
}

export function buildQueueCsv(tokens: QueueToken[]): string {
  const header = ['token', 'patientName', 'service', 'status', 'triageLevel', 'triageScore', 'issuedAt', 'complaint']

  const rows = tokens.map((token) => [
    token.token,
    token.patientName,
    token.service,
    token.status,
    token.checkInData?.triageLevel ?? 'N/A',
    token.checkInData?.triageScore ?? 0,
    token.issuedAt,
    token.complaint,
  ])

  return [header, ...rows]
    .map((row) => row.map((cell) => escapeCsvValue(cell)).join(','))
    .join('\n')
}
