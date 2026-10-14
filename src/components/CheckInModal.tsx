import { useState } from 'react'
import { AlertTriangle, Activity, CheckCircle2, QrCode, ScanLine, ShieldAlert, X } from 'lucide-react'
import type { QueueToken, AdditionalCheckInData, PatientVitals } from '../types'
import { analyzeVitalsAndTriage, getTriageRiskRating } from '../lib/aiService'

type CheckInModalProps = {
  isOpen: boolean
  onClose: () => void
  queueTokens: QueueToken[]
  onCheckInSuccess: (tokenId: string, checkInData: AdditionalCheckInData) => void
}

export function CheckInModal({ isOpen, onClose, queueTokens, onCheckInSuccess }: CheckInModalProps) {
  const [tokenInput, setTokenInput] = useState('')
  const [activeToken, setActiveToken] = useState<QueueToken | null>(null)
  const [checkInState, setCheckInState] = useState<'scan' | 'vitals' | 'error' | 'already-used'>('scan')
  const [errorMessage, setErrorMessage] = useState('')

  // Form state for Additional Data
  const [tempValue, setTempValue] = useState('98.6')
  const [tempUnit, setTempUnit] = useState<'°F' | '°C'>('°F')
  const [vitals, setVitals] = useState<PatientVitals>({
    bloodPressure: '120/80',
    heartRate: '75',
    temperature: '98.6 °F',
    oxygenLevel: '98',
    bloodSugar: '110',
    weightKg: '68',
  })
  const [assignedDoctor, setAssignedDoctor] = useState('Dr. Kavita Rao')
  const [roomNumber, setRoomNumber] = useState('Room 102')
  const [notes, setNotes] = useState('')

  const handleTempUnitChange = (newUnit: '°F' | '°C') => {
    if (tempUnit === newUnit) return
    const num = Number.parseFloat(tempValue.replace(/[^\d.]/g, ''))
    let convertedVal = tempValue
    if (!Number.isNaN(num)) {
      if (newUnit === '°C') {
        convertedVal = (((num - 32) * 5) / 9).toFixed(1)
      } else {
        convertedVal = ((num * 9) / 5 + 32).toFixed(1)
      }
    }
    setTempValue(convertedVal)
    setTempUnit(newUnit)
    setVitals((prev) => ({ ...prev, temperature: `${convertedVal} ${newUnit}` }))
  }

  if (!isOpen) return null

  const handleVerifyToken = (tokenToVerify?: string) => {
    const query = (tokenToVerify || tokenInput).trim()
    if (!query) return

    // Try finding matching token by ID or token string (e.g. A-001)
    let matchedToken = queueTokens.find(
      (t) => t.token.toLowerCase() === query.toLowerCase() || t.id === query
    )

    // Handle JSON object QR payload
    try {
      const parsed = JSON.parse(query) as { id?: string; token?: string }
      if (parsed.id || parsed.token) {
        matchedToken = queueTokens.find(
          (t) => (parsed.id && t.id === parsed.id) || (parsed.token && t.token.toLowerCase() === parsed.token.toLowerCase())
        )
      }
    } catch {
      // Not JSON, string search used above
    }

    if (!matchedToken) {
      setErrorMessage(`No token matching "${query}" was found in today's queue system.`)
      setCheckInState('error')
      return
    }

    // CHECK IF ALREADY USED / CHECKED IN / EXPIRED
    if (matchedToken.isCheckedIn || matchedToken.isExpired || matchedToken.status !== 'Waiting') {
      setActiveToken(matchedToken)
      setErrorMessage(
        `This QR Pass Token (${matchedToken.token}) has ALREADY been scanned and checked in on ${
          matchedToken.checkedInAt ? new Date(matchedToken.checkedInAt).toLocaleTimeString() : 'earlier today'
        }. Repeated scanning is disabled and this QR code is EXPIRED!`
      )
      setCheckInState('already-used')
      return
    }

    // Valid new token! Proceed to vitals and additional check-in data
    setActiveToken(matchedToken)
    setErrorMessage('')
    setCheckInState('vitals')
  }

  const handleFinalizeCheckIn = (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeToken) return

    // AI Evaluation of Vitals & Triage
    const aiAnalysis = analyzeVitalsAndTriage(vitals, activeToken.age, activeToken.complaint)

    const checkInData: AdditionalCheckInData = {
      checkedInAt: new Date().toISOString(),
      checkedInBy: 'Reception Staff',
      vitals,
      triageLevel: aiAnalysis.triageLevel,
      triageScore: aiAnalysis.triageScore,
      aiRiskSummary: aiAnalysis.aiRiskSummary,
      assignedDoctor,
      roomNumber,
      chiefComplaint: activeToken.complaint || 'General Consultation Intake',
      notes: notes.trim(),
    }

    onCheckInSuccess(activeToken.id, checkInData)
    setCheckInState('scan')
    setActiveToken(null)
    setTokenInput('')
    onClose()
  }

  const currentTriage = activeToken
    ? analyzeVitalsAndTriage(vitals, activeToken.age, activeToken.complaint)
    : null
  const riskRating = currentTriage ? getTriageRiskRating(currentTriage.triageScore) : null
  const riskStyles = riskRating?.band === 'emergency'
    ? { container: 'border-red-200 bg-red-50 text-red-900', bar: 'bg-red-600' }
    : riskRating?.band === 'urgent'
      ? { container: 'border-amber-200 bg-amber-50 text-amber-900', bar: 'bg-amber-500' }
      : { container: 'border-emerald-200 bg-emerald-50 text-emerald-900', bar: 'bg-emerald-600' }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm animate-reveal">
      <div className="w-full max-w-2xl overflow-hidden rounded-[2.5rem] border border-slate-200 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 bg-[#0c6b7a] px-6 py-5 text-white">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-white">
              <ScanLine className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-xl font-black tracking-tight">Patient Check-in Verification</h3>
              <p className="text-xs text-[#b8f0ea]">Scan QR code or enter visit token number</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-white/80 hover:bg-white/10 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6">
          {/* STEP 1: SCAN / ENTER TOKEN */}
          {checkInState === 'scan' && (
            <div className="space-y-6">
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-5 text-center">
                <QrCode className="mx-auto h-12 w-12 text-[#0c6b7a]" />
                <h4 className="mt-3 text-lg font-bold text-slate-900">Enter Token Number</h4>
                <p className="mt-1 text-xs text-slate-500">
                  Verify the patient&apos;s visit pass before allowing intake into the clinic.
                </p>

                <div className="mt-4 flex gap-2">
                  <input
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    placeholder="e.g. A-001 or B-002"
                    className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-lg font-bold tracking-wider text-slate-900 uppercase outline-none focus:border-[#0c6b7a]"
                  />
                  <button
                    onClick={() => handleVerifyToken()}
                    className="rounded-xl bg-[#0c6b7a] px-6 py-3 font-bold text-white shadow-md hover:bg-[#09525e] transition"
                  >
                    Verify
                  </button>
                </div>
              </div>

              <div>
                <span className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Available Waiting Tokens</span>
                <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto">
                  {queueTokens.filter(t => !t.isCheckedIn).map(token => (
                    <button
                      key={token.id}
                      onClick={() => handleVerifyToken(token.token)}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-800 shadow-sm hover:border-[#0c6b7a] hover:bg-[#eaf5f3]"
                    >
                      <span className="h-2 w-2 rounded-full bg-emerald-500" />
                      {token.token} ({token.patientName})
                    </button>
                  ))}
                  {queueTokens.filter(t => !t.isCheckedIn).length === 0 && (
                    <p className="text-xs text-slate-400 italic">No waiting tokens right now.</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ERROR: TOKEN NOT FOUND */}
          {checkInState === 'error' && (
            <div className="space-y-5 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 text-amber-600">
                <AlertTriangle className="h-8 w-8" />
              </div>
              <div>
                <h4 className="text-xl font-black text-slate-900">Token Not Found</h4>
                <p className="mt-2 text-sm text-slate-600">{errorMessage}</p>
              </div>
              <button
                onClick={() => setCheckInState('scan')}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white"
              >
                Try Again
              </button>
            </div>
          )}

          {/* ERROR: ALREADY USED TOKEN (CANNOT BE USED AGAIN) */}
          {checkInState === 'already-used' && (
            <div className="space-y-5 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-100 text-red-600">
                <ShieldAlert className="h-8 w-8" />
              </div>
              <div className="rounded-2xl border border-red-200 bg-red-50/70 p-5">
                <span className="inline-block rounded-full bg-red-600 px-3 py-1 text-xs font-black text-white uppercase tracking-wider">
                  TOKEN ALREADY USED
                </span>
                <h4 className="mt-3 text-xl font-black text-red-950">Check-in Rejected</h4>
                <p className="mt-2 text-sm font-medium leading-relaxed text-red-800">{errorMessage}</p>
                {activeToken?.checkInData && (
                  <div className="mt-4 border-t border-red-200 pt-3 text-left text-xs text-red-900">
                    <p className="font-bold">Previous Check-in Details:</p>
                    <p>• Room: {activeToken.checkInData.roomNumber} ({activeToken.checkInData.assignedDoctor})</p>
                    <p>• Vitals: BP {activeToken.checkInData.vitals.bloodPressure}, HR {activeToken.checkInData.vitals.heartRate} bpm, SpO2 {activeToken.checkInData.vitals.oxygenLevel}%</p>
                  </div>
                )}
              </div>
              <button
                onClick={() => setCheckInState('scan')}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white"
              >
                Back to Scan
              </button>
            </div>
          )}

          {/* STEP 2: FILL ADDITIONAL DATA AFTER CHECK-IN */}
          {checkInState === 'vitals' && activeToken && (
            <form onSubmit={handleFinalizeCheckIn} className="space-y-5">
              <div className="flex items-center justify-between rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-6 w-6 text-emerald-600" />
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider text-emerald-800">Check-in Verified</div>
                    <div className="text-lg font-black text-emerald-950">{activeToken.token} — {activeToken.patientName}</div>
                  </div>
                </div>
                <span className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-bold text-white">Valid Token</span>
              </div>

              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-[#0c6b7a]" />
                  <h4 className="text-sm font-bold text-slate-900">Record Patient Intake Vitals & Additional Data</h4>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <label className="block text-xs font-semibold text-slate-700">
                    Blood Pressure (mmHg)
                    <input
                      value={vitals.bloodPressure}
                      onChange={(e) => setVitals({ ...vitals, bloodPressure: e.target.value })}
                      placeholder="120/80"
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium"
                      required
                    />
                  </label>
                  <label className="block text-xs font-semibold text-slate-700">
                    Heart Rate (BPM)
                    <input
                      value={vitals.heartRate}
                      onChange={(e) => setVitals({ ...vitals, heartRate: e.target.value })}
                      placeholder="75"
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium"
                      required
                    />
                  </label>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Body Temp ({tempUnit})
                    </label>
                    <div className="flex gap-1 items-center">
                      <input
                        value={tempValue}
                        onChange={(e) => {
                          setTempValue(e.target.value)
                          setVitals({ ...vitals, temperature: `${e.target.value} ${tempUnit}` })
                        }}
                        placeholder={tempUnit === '°F' ? '98.6' : '37.0'}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium min-w-0"
                        required
                      />
                      <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-xs font-bold shrink-0">
                        <button
                          type="button"
                          onClick={() => handleTempUnitChange('°F')}
                          className={`px-2 py-1 rounded-md transition ${tempUnit === '°F' ? 'bg-[#0c6b7a] text-white shadow-sm' : 'text-slate-600'}`}
                        >
                          °F
                        </button>
                        <button
                          type="button"
                          onClick={() => handleTempUnitChange('°C')}
                          className={`px-2 py-1 rounded-md transition ${tempUnit === '°C' ? 'bg-[#0c6b7a] text-white shadow-sm' : 'text-slate-600'}`}
                        >
                          °C
                        </button>
                      </div>
                    </div>
                  </div>
                  <label className="block text-xs font-semibold text-slate-700">
                    SpO2 Oxygen (%)
                    <input
                      value={vitals.oxygenLevel}
                      onChange={(e) => setVitals({ ...vitals, oxygenLevel: e.target.value })}
                      placeholder="98"
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium"
                      required
                    />
                  </label>
                  <label className="block text-xs font-semibold text-slate-700">
                    Weight (kg)
                    <input
                      value={vitals.weightKg || ''}
                      onChange={(e) => setVitals({ ...vitals, weightKg: e.target.value })}
                      placeholder="68"
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium"
                    />
                  </label>
                  <label className="block text-xs font-semibold text-slate-700">
                    Blood Sugar (mg/dL)
                    <input
                      value={vitals.bloodSugar || ''}
                      onChange={(e) => setVitals({ ...vitals, bloodSugar: e.target.value })}
                      placeholder="110"
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium"
                    />
                  </label>
                </div>

                {currentTriage && riskRating && (
                  <div className={`rounded-xl border p-4 ${riskStyles.container}`} role="status" aria-live="polite">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-black uppercase tracking-wide">AI screening risk</p>
                        <p className="mt-1 text-xs font-semibold">{riskRating.label}</p>
                      </div>
                      <p className="shrink-0 text-2xl font-black">{riskRating.scoreOutOfTen}<span className="text-sm">/10</span></p>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/80">
                      <div className={`h-full ${riskStyles.bar}`} style={{ width: `${Number(riskRating.scoreOutOfTen) * 10}%` }} />
                    </div>
                    <p className="mt-2 text-[0.7rem]">Screening estimate only; staff should assess the patient and confirm urgency.</p>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block text-xs font-semibold text-slate-700">
                    Assigned Doctor
                    <select
                      value={assignedDoctor}
                      onChange={(e) => setAssignedDoctor(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium"
                    >
                      <option>Dr. Kavita Rao (General Medicine)</option>
                      <option>Dr. Ananya Singh (Ophthalmology)</option>
                      <option>Dr. Arjun Mehrotra (Dental Care)</option>
                      <option>Dr. Rajesh Varma (Orthopedics)</option>
                    </select>
                  </label>

                  <label className="block text-xs font-semibold text-slate-700">
                    Assigned Room / Counter
                    <input
                      value={roomNumber}
                      onChange={(e) => setRoomNumber(e.target.value)}
                      placeholder="Room 102"
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium"
                      required
                    />
                  </label>
                </div>

                <label className="block text-xs font-semibold text-slate-700">
                  Clinical Intake Notes & Symptoms
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Add any specific observations or allergy warnings..."
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium"
                  />
                </label>
              </div>

              <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setCheckInState('scan')}
                  className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Back
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 rounded-xl bg-[#0c6b7a] px-6 py-2.5 text-xs font-bold text-white shadow-md hover:bg-[#09525e]"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Confirm Check-in & Mark Token Used
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
