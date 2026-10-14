import { useEffect, useRef, useState } from 'react'
import {
  Activity,
  AlertCircle,
  BellRing,
  Brain,
  Calendar,
  Camera,
  CheckCircle2,
  Download,
  Edit3,
  FileText,
  History,
  LayoutDashboard,
  LogOut,
  MessageSquareText,
  MoonStar,
  Pill,
  Plus,
  QrCode,
  RotateCcw,
  Scale,
  ScanLine,
  Search,
  Sparkles,
  SunMedium,
  Stethoscope,
  Trash2,
  Upload,
  User,
  Video,
  X,
} from 'lucide-react'
import type { AiAnalysisResult, AppointmentRequest, QueueToken, StaffAccount, PrescriptionItem, PatientVitals, AdditionalCheckInData, VitalsRecord } from '../types'
import { formatTempCelsius } from '../types'
import { explainMedication, generateStaffAnalytics, analyzePatientSymptomsAsync, analyzeVitalsAndTriage, getTriageRiskRating, getActiveAiProviderInfo, notifyDataChanged } from '../lib/aiService'
import { buildQueueCsv, calculateQueueInsights, getQueuePosition } from '../lib/queueInsights'
import type { Html5Qrcode as Html5QrcodeScanner } from 'html5-qrcode'
import { resolveQueueTokenFromQr } from '../lib/qrTokens'
import { useTheme } from '../lib/theme'

type StaffDashboardProps = {
  staffAccount: StaffAccount
  queueTokens: QueueToken[]
  appointments: AppointmentRequest[]
  onUpdateToken: (updatedToken: QueueToken) => void
  onUpdateAppointment: (updatedAppointment: AppointmentRequest) => void
  onClearAppointments: () => void
  onLogout: () => void
}

type StaffTab = 'dashboard' | 'scan' | 'appointments' | 'history' | 'ai-analytics'

type DraftMedItem = {
  id: string
  medicineName: string
  dosage: string
  frequency: string
  duration: string
  instructions: string
}

function PortalThemeToggle() {
  const { theme, toggleTheme } = useTheme()

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[0.7rem] font-bold text-slate-700 transition hover:bg-slate-100"
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
    >
      {theme === 'dark' ? <SunMedium className="h-3.5 w-3.5" /> : <MoonStar className="h-3.5 w-3.5" />}
      {theme === 'dark' ? 'Light' : 'Dark'}
    </button>
  )
}

export function StaffDashboard({ staffAccount, queueTokens, appointments, onUpdateToken, onUpdateAppointment, onClearAppointments, onLogout }: StaffDashboardProps) {
  const [activeTab, setActiveTab] = useState<StaffTab>('dashboard')
  const aiProviderInfo = getActiveAiProviderInfo()
  const [selectedToken, setSelectedToken] = useState<QueueToken | null>(queueTokens[0] || null)
  const [filterStatus, setFilterStatus] = useState<string>('All')
  const [searchQuery, setSearchQuery] = useState('')

  // Standalone Patient Page Overlay State (When non-null, displays dedicated patient page modal)
  const [standalonePatientToken, setStandalonePatientToken] = useState<QueueToken | null>(null)
  const [visitReasonScreening, setVisitReasonScreening] = useState<{
    tokenId: string
    reason: string
    status: 'missing' | 'loading' | 'complete'
    analysis?: AiAnalysisResult
  } | null>(null)
  const [visitReasonDraft, setVisitReasonDraft] = useState('')

  // Exit prompt state: "Ask Checkout Patient on closing patient page"
  const [checkoutAskToken, setCheckoutAskToken] = useState<QueueToken | null>(null)

  // QR Upload & Camera Scanner state
  const [tokenInput, setTokenInput] = useState('')
  const [isQrDragging, setIsQrDragging] = useState(false)
  const [scanMessage, setScanMessage] = useState<{
    type: 'success' | 'error' | 'already-used'
    text: string
    token?: QueueToken
    analysis?: AiAnalysisResult
    isAnalyzing?: boolean
  } | null>(null)
  const [pendingQueueArrival, setPendingQueueArrival] = useState<{
    token: QueueToken
    position: number
  } | null>(null)
  const qrFileInputRef = useRef<HTMLInputElement>(null)

  // Camera video stream state
  const [cameraActive, setCameraActive] = useState(false)
  const scannerRef = useRef<Html5QrcodeScanner | null>(null)

  // Edit Vitals Form state (BP, Heart Rate, Temp, Weight, Date)
  const [isEditingVitals, setIsEditingVitals] = useState(false)
  const [editBP, setEditBP] = useState('120/80')
  const [editHeartRate, setEditHeartRate] = useState('75 bpm')
  const [editTemp, setEditTemp] = useState('98.6')
  const [editTempUnit, setEditTempUnit] = useState<'°F' | '°C'>('°F')
  const [editWeight, setEditWeight] = useState('68 kg')
  const [editOxygen, setEditOxygen] = useState('98 %')
  const [editBloodSugar, setEditBloodSugar] = useState('105 mg/dL')
  const [editRecordDate, setEditRecordDate] = useState(new Date().toISOString().slice(0, 16))

  const handleEditTempUnitChange = (newUnit: '°F' | '°C') => {
    if (editTempUnit === newUnit) return
    const num = Number.parseFloat(editTemp.replace(/[^\d.]/g, ''))
    let convertedVal = editTemp
    if (!Number.isNaN(num)) {
      if (newUnit === '°C') {
        convertedVal = (((num - 32) * 5) / 9).toFixed(1)
      } else {
        convertedVal = ((num * 9) / 5 + 32).toFixed(1)
      }
    }
    setEditTemp(convertedVal)
    setEditTempUnit(newUnit)
  }

  // Multi-Medication Builder State (Option to add MORE medications)
  const [draftMeds, setDraftMeds] = useState<DraftMedItem[]>([
    {
      id: `draft-1`,
      medicineName: 'Paracetamol 500mg',
      dosage: '500 mg',
      frequency: '1-0-1 (Morning & Evening)',
      duration: '5 days',
      instructions: 'Take after food with water',
    },
  ])
  const [aiExplanationsMap, setAiExplanationsMap] = useState<
    Record<string, PrescriptionItem['aiMedicationExplanation']>
  >({})

  // Patient Checkout Modal & Alert State
  const [checkoutModalToken, setCheckoutModalToken] = useState<QueueToken | null>(null)
  const [checkoutNotesInput, setCheckoutNotesInput] = useState('')
  const [checkoutSuccessAlert, setCheckoutSuccessAlert] = useState('')

  const handleConfirmCheckout = (e: React.FormEvent) => {
    e.preventDefault()
    if (!checkoutModalToken) return

    const nowIso = new Date().toISOString()
    const updatedToken: QueueToken = {
      ...checkoutModalToken,
      status: 'Completed',
      checkedOutAt: nowIso,
      checkoutNotes: checkoutNotesInput.trim(),
    }

    onUpdateToken(updatedToken)
    notifyDataChanged()

    if (selectedToken?.id === checkoutModalToken.id) {
      setSelectedToken(updatedToken)
    }
    if (standalonePatientToken?.id === checkoutModalToken.id) {
      setStandalonePatientToken(null) // Close standalone patient page after checkout
    }

    setCheckoutSuccessAlert(
      `✅ Patient ${checkoutModalToken.patientName} (${checkoutModalToken.token}) checked out successfully! Token QR code is now completed & disabled.`
    )
    setCheckoutModalToken(null)
    setCheckoutNotesInput('')
  }

  // Handle closing standalone patient page -> Ask checkout patient
  const handleCloseStandalonePatientPage = () => {
    if (!standalonePatientToken) return

    // If patient is already completed, close directly without prompt
    if (standalonePatientToken.status === 'Completed' || standalonePatientToken.checkedOutAt) {
      setStandalonePatientToken(null)
      return
    }

    // Prompt staff: "Do you want to checkout patient?"
    setCheckoutAskToken(standalonePatientToken)
  }

  // Elevate Patient to Emergency Priority Fast-Track
  const handleElevateEmergency = () => {
    const targetToken = standalonePatientToken || selectedToken
    if (!targetToken) return

    const currentCheckIn = targetToken.checkInData
    const updatedCheckIn = currentCheckIn
      ? {
        ...currentCheckIn,
        triageLevel: 'Emergency' as const,
        triageScore: 95,
        aiRiskSummary: `Emergency priority assigned by ${staffAccount.name}. Please seek immediate staff assistance.`,
      }
      : {
        checkedInAt: new Date().toISOString(),
        checkedInBy: 'Doctor Fast-Track',
        vitals: { bloodPressure: '', heartRate: '', temperature: '', oxygenLevel: '' },
        triageLevel: 'Emergency' as const,
        triageScore: 95,
        aiRiskSummary: `Emergency priority assigned by ${staffAccount.name}. Please seek immediate staff assistance.`,
        assignedDoctor: staffAccount.name,
        roomNumber: 'ER Room 1',
        chiefComplaint: targetToken.complaint || 'Emergency Fast-Track',
      }

    const updatedToken: QueueToken = {
      ...targetToken,
      checkInData: updatedCheckIn,
    }
    onUpdateToken(updatedToken)
    notifyDataChanged()
    setSelectedToken(updatedToken)
    if (standalonePatientToken?.id === updatedToken.id) {
      setStandalonePatientToken(updatedToken)
    }
    alert(`🚨 Patient ${targetToken.patientName} (${targetToken.token}) elevated to Emergency Priority Fast-Track!`)
  }

  // Add Preset Medicine Template Row
  const handleAddPresetMedicineRow = (preset: { medicineName: string; dosage: string; frequency: string; duration: string; instructions: string }) => {
    const nextItem: DraftMedItem = {
      id: `draft-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      ...preset,
    }
    setDraftMeds([...draftMeds, nextItem])
  }

  const nextWaitingPatient = [...queueTokens]
    .filter((token) => !token.isCheckedIn && token.status !== 'Expired' && token.status !== 'Completed' && token.status !== 'Cancelled')
    .sort((a, b) => new Date(a.issuedAt).getTime() - new Date(b.issuedAt).getTime())[0]

  const [nextPatientReminder, setNextPatientReminder] = useState('')

  const handleSendNextPatientReminder = () => {
    if (!nextWaitingPatient) {
      setNextPatientReminder('No waiting patient needs a reminder right now.')
      return
    }

    const summary = `Next patient reminder sent for ${nextWaitingPatient.patientName} (${nextWaitingPatient.token}). Please prepare the consultation area.`
    setNextPatientReminder(summary)
    localStorage.setItem('mediqueue-next-patient-reminder', summary)
  }

  // Clean up camera scanner on unmount.
  useEffect(() => {
    return () => {
      const scanner = scannerRef.current
      if (!scanner) return
      if (scanner.isScanning) {
        void scanner.stop().then(() => scanner.clear()).catch(() => undefined)
      } else {
        scanner.clear()
      }
    }
  }, [])

  // Start QR camera decoding.
  const handleStartCamera = async () => {
    try {
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode')
      const scanner = new Html5Qrcode('staff-qr-reader', {
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
        verbose: false,
      })
      scannerRef.current = scanner
      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: (viewfinderWidth, viewfinderHeight) => {
            const edge = Math.floor(Math.min(240, viewfinderWidth * 0.8, viewfinderHeight * 0.8))
            return { width: edge, height: edge }
          },
        },
        (decodedText) => { void processVerifyToken(decodedText) },
        () => undefined
      )
      setCameraActive(true)
    } catch (error) {
      const scanner = scannerRef.current
      scannerRef.current = null
      try {
        scanner?.clear()
      } catch {
        // The scanner may still be releasing the camera after a failed start.
      }
      setCameraActive(false)
      setScanMessage({
        type: 'error',
        text: error instanceof Error ? `Camera could not start: ${error.message}` : 'Camera could not start. Check browser permission or use QR image upload.',
      })
    }
  }

  const handleStopCamera = async () => {
    const scanner = scannerRef.current
    scannerRef.current = null
    if (scanner) {
      try {
        if (scanner.isScanning) await scanner.stop()
        scanner.clear()
      } catch {
        // The camera may already have stopped after a successful scan.
      }
    }
    setCameraActive(false)
  }

  // Open Edit Vitals Form
  const handleOpenEditVitals = (tokenObj?: QueueToken) => {
    const target = tokenObj || standalonePatientToken || selectedToken
    if (!target) return

    const v = target.checkInData?.vitals
    setEditBP(v?.bloodPressure || '120/80')
    setEditHeartRate(v?.heartRate || '75 bpm')
    const rawT = v?.temperature || '98.6 °F'
    const isC = (rawT.includes('°C') || rawT.endsWith('C')) && (Number.parseFloat(rawT) <= 50)
    setEditTemp(rawT.replace(/[^\d.]/g, '') || (isC ? '37.0' : '98.6'))
    setEditTempUnit(isC ? '°C' : '°F')
    setEditWeight(v?.weightKg || '68 kg')
    setEditOxygen(v?.oxygenLevel || '98 %')
    setEditBloodSugar(v?.bloodSugar || '105 mg/dL')
    setEditRecordDate(new Date().toISOString().slice(0, 16))
    setIsEditingVitals(true)
  }

  // Save Vitals Update to Selected Patient Record (With Date/Time stamp)
  const handleSaveVitalsUpdate = (e: React.FormEvent) => {
    e.preventDefault()
    const target = standalonePatientToken || selectedToken
    if (!target) return

    const recordedISO = editRecordDate ? new Date(editRecordDate).toISOString() : new Date().toISOString()
    const formattedTemp = editTemp.includes('°') ? editTemp.trim() : `${editTemp.trim()} ${editTempUnit}`
    const updatedVitals: PatientVitals = {
      bloodPressure: editBP.trim(),
      heartRate: editHeartRate.trim(),
      temperature: formattedTemp,
      weightKg: editWeight.trim(),
      oxygenLevel: editOxygen.trim(),
      bloodSugar: editBloodSugar.trim(),
    }

    const aiAnalysis = analyzeVitalsAndTriage(updatedVitals, target.age, target.complaint)

    const existingCheckIn = target.checkInData
    const previousHistory = existingCheckIn?.vitalsHistory || []

    const newHistoryRecord: VitalsRecord = {
      id: `vrec-${Date.now()}`,
      recordedAt: recordedISO,
      recordedBy: staffAccount.name,
      vitals: updatedVitals,
    }

    const updatedCheckInData: AdditionalCheckInData = {
      checkedInAt: existingCheckIn?.checkedInAt || recordedISO,
      checkedInBy: existingCheckIn?.checkedInBy || staffAccount.name,
      vitals: updatedVitals,
      triageLevel: aiAnalysis.triageLevel,
      triageScore: aiAnalysis.triageScore,
      aiRiskSummary: aiAnalysis.aiRiskSummary,
      assignedDoctor: existingCheckIn?.assignedDoctor || staffAccount.name,
      roomNumber: existingCheckIn?.roomNumber || staffAccount.roomNumber || 'OPD Counter 1',
      chiefComplaint: target.complaint || 'General OPD Consultation',
      notes: existingCheckIn?.notes || '',
      vitalsHistory: [newHistoryRecord, ...previousHistory],
    }

    const updatedToken: QueueToken = {
      ...target,
      checkInData: updatedCheckInData,
    }

    onUpdateToken(updatedToken)
    notifyDataChanged()
    setSelectedToken(updatedToken)
    if (standalonePatientToken?.id === updatedToken.id) {
      setStandalonePatientToken(updatedToken)
    }
    setIsEditingVitals(false)

    alert(`Vitals updated (BP: ${updatedVitals.bloodPressure}, Pulse: ${updatedVitals.heartRate}, Temp: ${updatedVitals.temperature}, Weight: ${updatedVitals.weightKg}) and stored with date/time: ${new Date(recordedISO).toLocaleString()}!`)
  }

  // Track last scanned token to prevent rapid repeat scan loops
  const [lastScannedCode, setLastScannedCode] = useState<string>('')

  // Verification helper for Token QR / manual entry
  const processVerifyToken = async (rawInput: string, approvedQueuePosition?: number) => {
    const query = rawInput.trim()
    if (!query) return

    const matchedToken = resolveQueueTokenFromQr(query, queueTokens)

    if (!matchedToken) {
      setScanMessage({
        type: 'error',
        text: `No matching token found for "${query}". Please check the token code.`,
      })
      return
    }

    // CHECK IF TOKEN IS ALREADY COMPLETED / CHECKED OUT -> THERE IS NO USE OF THAT TOKEN QR CODE
    if (matchedToken.status === 'Completed' || matchedToken.checkedOutAt) {
      const checkOutTimeStr = matchedToken.checkedOutAt
        ? new Date(matchedToken.checkedOutAt).toLocaleTimeString()
        : 'earlier today'
      setScanMessage({
        type: 'already-used',
        text: `⛔ TOKEN EXPIRED & COMPLETED: QR Pass ${matchedToken.token} for ${matchedToken.patientName} was ALREADY scanned & checked out at ${checkOutTimeStr}. This QR code token is now invalid and has NO further use.`,
        token: matchedToken,
      })
      setSelectedToken(matchedToken)
      return
    }

    const queuePosition = getQueuePosition(matchedToken, queueTokens)
    if (queuePosition && queuePosition > 1 && approvedQueuePosition === undefined) {
      await handleStopCamera()
      setPendingQueueArrival({ token: matchedToken, position: queuePosition })
      setScanMessage({
        type: 'error',
        text: `${matchedToken.patientName} is currently #${queuePosition} in the ${matchedToken.service} queue. Approve check-in without changing FIFO order?`,
      })
      return
    }
    setPendingQueueArrival(null)

    // Prevent repeated scan loops for the same token in current session
    if (lastScannedCode === matchedToken.token && matchedToken.isCheckedIn && standalonePatientToken?.id === matchedToken.id) {
      return
    }
    setLastScannedCode(matchedToken.token)

    const genericReasons = [
      'general opd consultation request',
      'general opd consultation',
      'general consultation',
      'general consultation intake',
      'emergency fast-track',
    ]
    const patientReason = [matchedToken.complaint, matchedToken.checkInData?.chiefComplaint]
      .map((reason) => reason?.trim() || '')
      .find((reason) => reason && !genericReasons.includes(reason.toLowerCase())) || ''
    let updatedToken = matchedToken
    if (!matchedToken.isCheckedIn || matchedToken.status === 'Waiting') {
      const emptyVitals: PatientVitals = {
        bloodPressure: '',
        heartRate: '',
        temperature: '',
        oxygenLevel: '',
      }
      updatedToken = {
        ...matchedToken,
        status: 'Checked In',
        isCheckedIn: true,
        checkedInAt: new Date().toISOString(),
        checkInData: matchedToken.checkInData || {
          checkedInAt: new Date().toISOString(),
          checkedInBy: staffAccount.name,
          vitals: emptyVitals,
          triageLevel: 'Standard',
          triageScore: 20,
          aiRiskSummary: 'Visit reason screening in progress.',
          assignedDoctor: staffAccount.name,
          roomNumber: staffAccount.roomNumber || 'OPD Counter 1',
          chiefComplaint: patientReason,
          vitalsHistory: [
            {
              id: `vrec-init-${Date.now()}`,
              recordedAt: new Date().toISOString(),
              recordedBy: staffAccount.name,
              vitals: emptyVitals,
            },
          ],
        },
      }

      onUpdateToken(updatedToken)
      notifyDataChanged()
    }

    setSelectedToken(updatedToken)
    setScanMessage({
      type: 'success',
      text: `QR pass verified for ${updatedToken.patientName} (${updatedToken.token}) at queue position #${queuePosition ?? approvedQueuePosition ?? 1}. Screening the stated visit reason...`,
      token: updatedToken,
      isAnalyzing: true,
    })
    setVisitReasonScreening({
      tokenId: updatedToken.id,
      reason: patientReason,
      status: patientReason ? 'loading' : 'missing',
    })
    setStandalonePatientToken(updatedToken)
    await handleStopCamera()

    if (!patientReason) {
      setVisitReasonDraft('')
      setVisitReasonScreening({ tokenId: updatedToken.id, reason: '', status: 'missing' })
      setScanMessage({
        type: 'success',
        text: `${updatedToken.patientName} checked in. A visit reason is needed before AI can assess urgency.`,
        token: updatedToken,
      })
      return
    }

    const reasonAnalysis = await analyzePatientSymptomsAsync(patientReason, updatedToken.age)
    const checkInData: AdditionalCheckInData = updatedToken.checkInData ?? {
      checkedInAt: updatedToken.checkedInAt || new Date().toISOString(),
      checkedInBy: staffAccount.name,
      vitals: { bloodPressure: '', heartRate: '', temperature: '', oxygenLevel: '' },
      triageLevel: 'Standard',
      triageScore: 20,
      aiRiskSummary: 'Visit reason screening in progress.',
      assignedDoctor: staffAccount.name,
      roomNumber: staffAccount.roomNumber || 'OPD Counter 1',
      chiefComplaint: patientReason,
    }
    const triagedToken: QueueToken = {
      ...updatedToken,
      checkInData: {
        ...checkInData,
        triageLevel: reasonAnalysis.triageCategory,
        triageScore: reasonAnalysis.riskScore,
        aiRiskSummary: `Visit-reason screening: ${reasonAnalysis.symptomSummary}. ${reasonAnalysis.suggestedAction}`,
      },
    }

    onUpdateToken(triagedToken)
    notifyDataChanged()
    setSelectedToken(triagedToken)
    setVisitReasonScreening({
      tokenId: triagedToken.id,
      reason: patientReason,
      status: 'complete',
      analysis: reasonAnalysis,
    })
    setScanMessage({
      type: 'success',
      text: `Pass verified for ${triagedToken.patientName} (${triagedToken.token}). Visit reason: "${patientReason}"`,
      token: triagedToken,
      analysis: reasonAnalysis,
    })

    setStandalonePatientToken(triagedToken)
  }

  const handleAnalyzeVisitReason = async () => {
    const targetToken = standalonePatientToken
    const reason = visitReasonDraft.trim()
    if (!targetToken || !reason) return

    setVisitReasonScreening({ tokenId: targetToken.id, reason, status: 'loading' })
    const analysis = await analyzePatientSymptomsAsync(reason, targetToken.age)
    const checkInData: AdditionalCheckInData = targetToken.checkInData ?? {
      checkedInAt: targetToken.checkedInAt || new Date().toISOString(),
      checkedInBy: staffAccount.name,
      vitals: { bloodPressure: '', heartRate: '', temperature: '', oxygenLevel: '' },
      triageLevel: 'Standard',
      triageScore: 20,
      aiRiskSummary: '',
      assignedDoctor: staffAccount.name,
      roomNumber: staffAccount.roomNumber || 'OPD Counter 1',
      chiefComplaint: reason,
    }
    const updatedToken: QueueToken = {
      ...targetToken,
      complaint: reason,
      checkInData: {
        ...checkInData,
        chiefComplaint: reason,
        triageLevel: analysis.triageCategory,
        triageScore: analysis.riskScore,
        aiRiskSummary: `Visit-reason screening: ${analysis.symptomSummary}. ${analysis.suggestedAction}`,
      },
    }

    onUpdateToken(updatedToken)
    notifyDataChanged()
    setSelectedToken(updatedToken)
    setStandalonePatientToken(updatedToken)
    setVisitReasonScreening({ tokenId: updatedToken.id, reason, status: 'complete', analysis })
    setScanMessage({
      type: 'success',
      text: `AI screening completed for ${updatedToken.patientName} (${updatedToken.token}).`,
      token: updatedToken,
      analysis,
    })
  }

  const handleQrFileSelection = async (file?: File) => {
    if (!file) return

    setScanMessage(null)
    setPendingQueueArrival(null)
    await handleStopCamera()
    let scanner: Html5QrcodeScanner | null = null
    try {
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode')
      scanner = new Html5Qrcode('staff-qr-reader', {
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
        verbose: false,
      })
      const decodedText = await scanner.scanFile(file, false)
      processVerifyToken(decodedText)
    } catch {
      setScanMessage({
        type: 'error',
        text: 'Could not read a QR code from that image. Use a clear, uncropped QR image or enter the visit token manually.',
      })
    } finally {
      scanner?.clear()
    }
  }

  // Handle QR Image File Upload
  const handleQrFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (e.target) e.target.value = ''
    handleQrFileSelection(file)
  }

  const handleQrDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsQrDragging(false)
    const file = event.dataTransfer.files?.[0]
    handleQrFileSelection(file)
  }

  // Multi-Medication Builder Controls
  const handleAddMoreMedicineRow = () => {
    setDraftMeds([
      ...draftMeds,
      {
        id: `draft-${Date.now()}-${Math.random()}`,
        medicineName: '',
        dosage: '500 mg',
        frequency: '1-0-1 (Morning & Evening)',
        duration: '5 days',
        instructions: 'Take after food with water',
      },
    ])
  }

  const handleRemoveMedicineRow = (id: string) => {
    if (draftMeds.length <= 1) {
      alert('At least one medicine row is required.')
      return
    }
    setDraftMeds(draftMeds.filter((m) => m.id !== id))
  }

  const handleUpdateMedicineRow = (id: string, field: keyof DraftMedItem, value: string) => {
    setDraftMeds(draftMeds.map((m) => (m.id === id ? { ...m, [field]: value } : m)))
  }

  // Generate AI Explanations for All Draft Medicines
  const handleExplainAllDraftMeds = () => {
    const newMap: Record<string, PrescriptionItem['aiMedicationExplanation']> = {}
    draftMeds.forEach((m) => {
      if (m.medicineName.trim()) {
        newMap[m.id] = explainMedication(m.medicineName, m.dosage)
      }
    })
    setAiExplanationsMap(newMap)
  }

  // Save ALL Draft Medications to Patient Record
  const handleSaveAllPrescriptions = (e: React.FormEvent) => {
    e.preventDefault()
    const target = standalonePatientToken || selectedToken
    if (!target) return

    const validMeds = draftMeds.filter((m) => m.medicineName.trim().length > 0)
    if (validMeds.length === 0) {
      alert('Please enter at least one valid medicine name.')
      return
    }

    const existingRxList = target.prescriptions || []

    const newPrescriptionItems: PrescriptionItem[] = validMeds.map((m, idx) => ({
      id: `rx-${Date.now()}-${idx}`,
      medicineName: m.medicineName.trim(),
      dosage: m.dosage.trim() || 'Standard Dose',
      frequency: m.frequency,
      duration: m.duration.trim() || '5 days',
      instructions: m.instructions.trim() || 'Take after meals with water',
      prescribedAt: new Date().toISOString(),
      prescribedBy: staffAccount.name,
      aiMedicationExplanation: aiExplanationsMap[m.id] || explainMedication(m.medicineName, m.dosage),
    }))

    const updatedToken: QueueToken = {
      ...target,
      prescriptions: [...newPrescriptionItems, ...existingRxList],
    }

    onUpdateToken(updatedToken)
    notifyDataChanged()
    setSelectedToken(updatedToken)
    if (standalonePatientToken?.id === updatedToken.id) {
      setStandalonePatientToken(updatedToken)
    }

    // Reset Form
    setDraftMeds([
      {
        id: `draft-1`,
        medicineName: 'Paracetamol 500mg',
        dosage: '500 mg',
        frequency: '1-0-1 (Morning & Evening)',
        duration: '5 days',
        instructions: 'Take after food with water',
      },
    ])
    setAiExplanationsMap({})

    alert(`Successfully saved ${newPrescriptionItems.length} medication(s) to ${target.patientName}'s profile!`)
  }

  // Filter Tokens for Dashboard Queue List
  const filteredTokens = queueTokens.filter((t) => {
    const matchesStatus = filterStatus === 'All' || t.status === filterStatus
    const matchesSearch =
      t.token.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.patientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.service.toLowerCase().includes(searchQuery.toLowerCase())
    return matchesStatus && matchesSearch
  })

  // Staff Work History Patients (Patients handled today by this staff)
  const handledStaffPatients = queueTokens.filter(
    (t) =>
      t.isCheckedIn ||
      t.checkInData?.checkedInBy === staffAccount.name ||
      t.checkInData?.assignedDoctor === staffAccount.name ||
      t.prescriptions?.some((p) => p.prescribedBy === staffAccount.name)
  )

  // Clear Single Token Record Handled By This Staff Account
  const handleClearSingleStaffTokenRecord = (tokenId: string, patientName: string) => {
    if (
      !window.confirm(
        `Are you sure you want to remove token record for patient "${patientName}" from your staff work history?`
      )
    ) {
      return
    }

    const updatedQueue = queueTokens.map((t) => {
      if (t.id === tokenId) {
        return {
          ...t,
          status: (t.status === 'Completed' || t.status === 'In progress' ? 'Waiting' : t.status) as QueueToken['status'],
          isCheckedIn: false,
          checkedInAt: undefined,
          checkedOutAt: undefined,
          checkoutNotes: undefined,
          checkInData: undefined,
          prescriptions: (t.prescriptions || []).filter((p) => p.prescribedBy !== staffAccount.name),
        }
      }
      return t
    })

    localStorage.setItem('synq-queue', JSON.stringify(updatedQueue))
    notifyDataChanged()
    alert(`✅ Staff history record for "${patientName}" cleared!`)
  }

  // AI Staff Analytics Data
  const analyticsData = generateStaffAnalytics(staffAccount, queueTokens)
  const queueInsights = calculateQueueInsights(queueTokens)

  const handleExportQueueCsv = () => {
    const csv = buildQueueCsv(queueTokens)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'mediqueue-queue-report.csv'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="min-h-screen bg-[#edf9f6] px-4 py-6 sm:px-6 lg:px-8 font-sans">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* TOP HEADER & STAFF PROFILE */}
        <header className="flex flex-col gap-4 rounded-[2.5rem] border border-[#dfecef] bg-white p-6 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0c6b7a] text-white shadow-md">
              <Stethoscope className="h-7 w-7" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-black text-slate-900">{staffAccount.name}</span>
                <span className="rounded-full bg-[#eafaf6] px-3 py-1 text-xs font-bold uppercase tracking-wider text-[#0c6b7a]">
                  {staffAccount.role}
                </span>
              </div>
              <p className="text-xs text-slate-500">{staffAccount.email}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <PortalThemeToggle />
            <button
              onClick={() => setActiveTab('scan')}
              className="inline-flex items-center gap-2 rounded-xl bg-[#0c6b7a] px-4 py-3 font-bold text-white shadow-md hover:bg-[#09525e] transition text-xs"
            >
              <Camera className="h-4 w-4" />
              Front Camera Scanner
            </button>
            <button
              onClick={onLogout}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              <LogOut className="h-4 w-4" />
              Logout
            </button>
          </div>
        </header>

        {/* SUB-PAGES NAVIGATION TABS BAR */}
        <nav className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#dfecef] bg-white p-2 shadow-sm">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition ${activeTab === 'dashboard'
                ? 'bg-[#0c6b7a] text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100'
              }`}
          >
            <LayoutDashboard className="h-4 w-4" />
            Queue Dashboard
          </button>

          <button
            onClick={() => setActiveTab('scan')}
            className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition ${activeTab === 'scan'
                ? 'bg-[#0c6b7a] text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100'
              }`}
          >
            <ScanLine className="h-4 w-4" />
            Camera Scan &amp; Upload QR
          </button>

          <button
            onClick={() => setActiveTab('appointments')}
            className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition ${activeTab === 'appointments'
                ? 'bg-[#0c6b7a] text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100'
              }`}
          >
            <Calendar className="h-4 w-4" />
            Appointments ({appointments.filter((appointment) => appointment.status === 'Requested' && (staffAccount.role !== 'Doctor' || appointment.doctor === staffAccount.name)).length})
          </button>

          <button
            onClick={() => setActiveTab('history')}
            className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition ${activeTab === 'history'
                ? 'bg-[#0c6b7a] text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100'
              }`}
          >
            <History className="h-4 w-4" />
            Staff History ({handledStaffPatients.length})
          </button>

          <button
            onClick={() => setActiveTab('ai-analytics')}
            className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition ${activeTab === 'ai-analytics'
                ? 'bg-[#0c6b7a] text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100'
              }`}
          >
            <Brain className="h-4 w-4 text-amber-300" />
            AI Staff Statistics
          </button>
        </nav>

        {/* PAGE 1: QUEUE DASHBOARD OVERVIEW */}
        {activeTab === 'dashboard' && (
          <div className="grid gap-6 lg:grid-cols-12">
            {/* Left Queue List (4 cols) */}
            <div className="lg:col-span-4 space-y-4">
              <div className="rounded-[2.5rem] border border-[#dfecef] bg-white p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-black text-slate-900 text-lg">Today&apos;s OPD Queue</h3>
                  <span className="rounded-full bg-[#eafaf6] px-2.5 py-0.5 text-xs font-bold text-[#0c6b7a]">
                    {queueTokens.length} Patients
                  </span>
                </div>

                {/* Search Bar */}
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search token or patient..."
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-xs outline-none focus:border-[#0c6b7a]"
                  />
                </div>

                {/* Status Filter Buttons */}
                <div className="flex flex-wrap gap-1.5 text-[0.7rem] font-bold">
                  {['All', 'Waiting', 'Checked In', 'In progress', 'Completed'].map((status) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => setFilterStatus(status)}
                      className={`rounded-lg px-2.5 py-1 transition ${filterStatus === status
                          ? 'bg-[#0c6b7a] text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                    >
                      {status}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[0.65rem] font-semibold text-slate-500" aria-label="AI triage legend">
                  <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-600" />Emergency</span>
                  <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" />Urgent</span>
                  <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-600" />Standard / Low Priority</span>
                  <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-slate-400" />Pending</span>
                </div>

                {/* Token Cards List */}
                <div className="space-y-2.5 max-h-[500px] overflow-y-auto pr-1">
                  {filteredTokens.map((t) => {
                    const isScreeningPending = !t.checkInData || t.checkInData.aiRiskSummary.includes('Visit reason screening in progress')
                    const triageLevel = t.checkInData?.triageLevel
                    const triageMarker = isScreeningPending
                      ? { label: 'AI screening pending', color: 'bg-slate-400' }
                      : triageLevel === 'Emergency'
                        ? { label: 'Emergency', color: 'bg-red-600' }
                        : triageLevel === 'Urgent'
                          ? { label: 'Urgent', color: 'bg-amber-500' }
                          : { label: triageLevel ?? 'AI screening pending', color: 'bg-emerald-600' }

                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          setSelectedToken(t)
                          setStandalonePatientToken(t)
                        }}
                        className={`w-full text-left rounded-2xl p-3.5 border transition ${selectedToken?.id === t.id
                            ? 'border-[#0c6b7a] bg-[#eaf5f3] ring-2 ring-[#0c6b7a]/20'
                            : 'border-slate-100 bg-slate-50 hover:bg-slate-100'
                          }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-black text-slate-900 text-lg">{t.token}</span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[0.65rem] font-bold ${t.isCheckedIn
                                ? 'bg-emerald-100 text-emerald-800'
                                : t.status === 'Waiting'
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-blue-100 text-blue-800'
                              }`}
                          >
                            {t.isCheckedIn ? 'Checked In' : t.status}
                          </span>
                        </div>

                        <div className="mt-1 font-bold text-xs text-slate-800">{t.patientName}</div>
                        <div className="text-[0.7rem] text-slate-500">{t.service}</div>
                        <div className="mt-1 inline-flex items-center gap-1.5 text-[0.68rem] font-semibold text-slate-600" aria-label={`AI triage: ${triageMarker.label}`}>
                          <span className={`h-2.5 w-2.5 rounded-full ${triageMarker.color}`} />
                          <span>AI triage: {triageMarker.label}{!isScreeningPending && t.checkInData?.triageScore !== undefined ? ` · Risk ${t.checkInData.triageScore}/100` : ''}</span>
                        </div>
                        {(t.complaint || t.checkInData?.chiefComplaint) && (
                          <div className="text-[0.68rem] font-semibold text-[#0c6b7a] mt-1 truncate">
                            💬 Reason: &quot;{t.complaint || t.checkInData?.chiefComplaint}&quot;
                          </div>
                        )}
                      </button>
                    )
                  })}

                  {filteredTokens.length === 0 && (
                    <p className="text-center py-8 text-xs text-slate-400 italic">No matching tokens in queue.</p>
                  )}
                </div>
              </div>
            </div>

            {/* Right Overview Metrics & Quick Actions (8 cols) */}
            <div className="lg:col-span-8 space-y-6">
              {nextWaitingPatient && (
                <div className="rounded-[1.75rem] border border-[#dfecef] bg-[#edfdf8] p-4 shadow-sm">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#0c6b7a] text-white">
                        <BellRing className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="text-[0.7rem] font-bold uppercase tracking-[0.12em] text-[#0c6b7a]">Next patient reminder</div>
                        <div className="text-lg font-black text-slate-900">{nextWaitingPatient.token} · {nextWaitingPatient.patientName}</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleSendNextPatientReminder}
                      className="rounded-xl bg-[#0c6b7a] px-3 py-2 text-[0.7rem] font-bold text-white hover:bg-[#09525e]"
                    >
                      Send reminder
                    </button>
                  </div>
                  {nextPatientReminder && (
                    <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
                      {nextPatientReminder}
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-1">
                  <span className="text-xs font-bold text-slate-400">Total Registered</span>
                  <div className="text-3xl font-black text-slate-900">{queueTokens.length}</div>
                </div>
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5 shadow-sm space-y-1">
                  <span className="text-xs font-bold text-emerald-800">Checked In</span>
                  <div className="text-3xl font-black text-emerald-900">
                    {queueTokens.filter((t) => t.isCheckedIn).length}
                  </div>
                </div>
                <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5 shadow-sm space-y-1">
                  <span className="text-xs font-bold text-amber-800">Waiting Room</span>
                  <div className="text-3xl font-black text-amber-900">
                    {queueTokens.filter((t) => t.status === 'Waiting').length}
                  </div>
                </div>
                <div className="rounded-2xl border border-blue-200 bg-blue-50/70 p-5 shadow-sm space-y-1">
                  <span className="text-xs font-bold text-blue-800">Handled Today</span>
                  <div className="text-3xl font-black text-blue-900">{handledStaffPatients.length}</div>
                </div>
              </div>

              <div className="rounded-[2rem] border border-[#dfecef] bg-white p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-black text-slate-900">Queue Intelligence</h3>
                    <p className="text-xs text-slate-500">Live operational insight for the current queue</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleExportQueueCsv}
                    className="inline-flex items-center gap-2 rounded-xl bg-[#0c6b7a] px-3 py-2 text-[0.7rem] font-bold text-white shadow-sm hover:bg-[#09525e]"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Export CSV
                  </button>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-[0.68rem] font-bold uppercase tracking-wider text-slate-400">Avg wait</div>
                    <div className="mt-2 text-2xl font-black text-slate-900">{queueInsights.avgWaitMinutes}m</div>
                  </div>
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
                    <div className="text-[0.68rem] font-bold uppercase tracking-wider text-amber-700">Urgent flags</div>
                    <div className="mt-2 text-2xl font-black text-amber-900">{queueInsights.emergencyFlags}</div>
                  </div>
                  <div className="rounded-2xl border border-blue-200 bg-blue-50 p-3">
                    <div className="text-[0.68rem] font-bold uppercase tracking-wider text-blue-700">Next patient</div>
                    <div className="mt-2 text-lg font-black text-blue-900">{queueInsights.nextToken}</div>
                  </div>
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
                    <div className="text-[0.68rem] font-bold uppercase tracking-wider text-emerald-700">Busiest service</div>
                    <div className="mt-2 text-lg font-black text-emerald-900">{queueInsights.busiestService}</div>
                  </div>
                </div>

                <div className="rounded-2xl border border-dashed border-[#0c6b7a]/30 bg-[#eaf5f3] p-3 text-xs font-semibold text-[#0c6b7a]">
                  {queueInsights.recommendedAction}
                </div>
              </div>

              {/* Quick Action Navigation Banners */}
              <div className="grid gap-4 sm:grid-cols-3">
                <button
                  onClick={() => setActiveTab('scan')}
                  className="group rounded-3xl border border-[#0c6b7a]/20 bg-gradient-to-br from-[#0c6b7a] to-[#09525e] p-6 text-left text-white shadow-md hover:shadow-lg transition"
                >
                  <Camera className="h-8 w-8 mb-3 text-emerald-300 group-hover:scale-110 transition" />
                  <h4 className="font-bold text-lg">Scan Patient QR</h4>
                  <p className="text-xs text-emerald-100 mt-1">Open front camera video stream or upload pass image.</p>
                </button>

                <button
                  onClick={() => {
                    const firstToken = queueTokens[0]
                    if (firstToken) {
                      setSelectedToken(firstToken)
                      setStandalonePatientToken(firstToken)
                    }
                  }}
                  className="group rounded-3xl border border-slate-200 bg-white p-6 text-left shadow-sm hover:border-[#0c6b7a] transition"
                >
                  <FileText className="h-8 w-8 mb-3 text-[#0c6b7a] group-hover:scale-110 transition" />
                  <h4 className="font-bold text-lg text-slate-900">Open Patient Page</h4>
                  <p className="text-xs text-slate-500 mt-1">Inspect vitals, history &amp; add multiple prescriptions.</p>
                </button>

                <button
                  onClick={() => setActiveTab('ai-analytics')}
                  className="group rounded-3xl border border-amber-200 bg-amber-50/60 p-6 text-left shadow-sm hover:border-amber-400 transition"
                >
                  <Brain className="h-8 w-8 mb-3 text-amber-600 group-hover:scale-110 transition" />
                  <h4 className="font-bold text-lg text-slate-900">AI Staff Statistics</h4>
                  <p className="text-xs text-slate-600 mt-1">View workload score, triage speed &amp; performance report.</p>
                </button>
              </div>

              {/* Recent Patient Activity Preview */}
              <div className="rounded-[2.5rem] border border-[#dfecef] bg-white p-6 shadow-sm space-y-4">
                <h3 className="text-lg font-black text-slate-900">Recent Checked-In Patients</h3>
                <div className="space-y-3">
                  {queueTokens
                    .filter((t) => t.isCheckedIn)
                    .slice(0, 4)
                    .map((t) => (
                      <div
                        key={t.id}
                        className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 p-4 text-xs"
                      >
                        <div className="flex items-center gap-3">
                          <span className="font-black text-lg text-slate-900">{t.token}</span>
                          <div>
                            <div className="font-bold text-slate-800 text-sm">{t.patientName}</div>
                            <div className="text-slate-500">
                              BP: {t.checkInData?.vitals.bloodPressure || '120/80'} · Pulse: {t.checkInData?.vitals.heartRate || '75 bpm'}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              setSelectedToken(t)
                              setStandalonePatientToken(t)
                            }}
                            className="rounded-xl bg-[#0c6b7a] px-3 py-2 font-bold text-white hover:bg-[#09525e]"
                          >
                            Open Patient Page
                          </button>

                          {t.status !== 'Completed' ? (
                            <button
                              onClick={() => {
                                setCheckoutModalToken(t)
                                setCheckoutNotesInput(t.checkoutNotes || '')
                              }}
                              className="rounded-xl bg-emerald-600 px-3 py-2 font-bold text-white hover:bg-emerald-700 transition flex items-center gap-1"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Checkout
                            </button>
                          ) : (
                            <span className="rounded-xl bg-emerald-100 text-emerald-800 px-3 py-1.5 font-bold text-[0.7rem]">
                              Checked Out
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* PAGE 2: CAMERA SCAN & UPLOAD QR CODE */}
        {activeTab === 'scan' && (
          <section className="mx-auto max-w-3xl rounded-[2.5rem] border border-[#dfecef] bg-white p-8 shadow-sm space-y-6">
            <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0c6b7a] text-white">
                <QrCode className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-2xl font-black text-slate-900">Scan QR Code with Camera or Upload</h2>
                <p className="text-xs text-slate-500">
                  Verify patient visit pass tokens using live video feed, image files, or code entry.
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-bold text-slate-800">
                <span className={`h-2.5 w-2.5 rounded-full ${aiProviderInfo.provider === 'offline' ? 'bg-amber-500' : 'bg-emerald-600'}`} />
                Current AI provider: {aiProviderInfo.label}
              </div>
            </div>

            {/* LIVE FRONT CAMERA STREAM BOX */}
            <div className="rounded-3xl border border-slate-200 bg-slate-900 p-4 text-white space-y-4 shadow-inner">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-400">
                  <Video className="h-4 w-4 animate-pulse" />
                  QR Camera Scanner
                </div>

                {!cameraActive ? (
                  <button
                    onClick={handleStartCamera}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow hover:bg-emerald-700 transition"
                  >
                    <Camera className="h-4 w-4" />
                    Start QR Scanner
                  </button>
                ) : (
                  <button
                    onClick={handleStopCamera}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-4 py-2 text-xs font-bold text-white shadow hover:bg-red-700 transition"
                  >
                    Stop Scanner
                  </button>
                )}
              </div>

              {/* Video Element Container */}
              <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-slate-950 flex items-center justify-center border border-slate-800">
                <div id="staff-qr-reader" className="h-full w-full" />

                {!cameraActive && (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center space-y-2 p-6 text-center">
                    <Camera className="mx-auto h-12 w-12 text-slate-600" />
                    <p className="text-xs text-slate-400">QR camera scanner is currently turned off.</p>
                    <button
                      onClick={handleStartCamera}
                      className="rounded-xl bg-[#0c6b7a] px-5 py-2 text-xs font-bold text-white"
                    >
                      Start QR Scanner
                    </button>
                  </div>
                )}

                {/* Scanning Laser Animation Overlay */}
                {cameraActive && (
                  <div className="absolute inset-0 border-2 border-emerald-500/50 rounded-2xl pointer-events-none flex items-center justify-center">
                    <div className="w-64 h-64 border-2 border-dashed border-emerald-400 rounded-3xl relative">
                      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-emerald-400 to-transparent animate-pulse" />
                    </div>
                  </div>
                )}
              </div>

              {/* Camera Action Controls */}
              {cameraActive && <p className="pt-2 text-center text-xs text-slate-300">Point the camera at the patient&apos;s QR pass; scanning starts automatically.</p>}
            </div>

            {/* UPLOAD QR IMAGE FILE */}
            <div
              onDragOver={(event) => {
                event.preventDefault()
                setIsQrDragging(true)
              }}
              onDragEnter={(event) => {
                event.preventDefault()
                setIsQrDragging(true)
              }}
              onDragLeave={(event) => {
                event.preventDefault()
                setIsQrDragging(false)
              }}
              onDrop={handleQrDrop}
              className={`rounded-3xl border-2 border-dashed p-6 text-center space-y-3 transition ${
                isQrDragging ? 'border-[#0c6b7a] bg-[#dff9f5] scale-[1.01]' : 'border-[#0c6b7a]/30 bg-[#eaf5f3]/40'
              }`}
            >
              <Upload className="mx-auto h-10 w-10 text-[#0c6b7a]" />
              <div>
                <h4 className="font-bold text-slate-900 text-sm">Upload or Drop Patient QR Pass Image</h4>
                <p className="text-xs text-slate-500">Drag and drop SVG or PNG QR files from a patient’s phone, or select from your device.</p>
              </div>
              <button
                type="button"
                onClick={() => qrFileInputRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-xl bg-[#0c6b7a] px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-[#09525e]"
              >
                Select QR Image File
              </button>
              <input
                ref={qrFileInputRef}
                type="file"
                accept="image/*,.svg"
                className="hidden"
                onChange={handleQrFileUpload}
              />
            </div>

            {/* MANUAL TOKEN CODE VERIFICATION */}
            <div className="space-y-3 border-t border-slate-100 pt-4">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                Or Enter Visit Token Number Directly
              </label>
              <div className="flex gap-2">
                <input
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="e.g. A-001 or B-002"
                  className="flex-1 rounded-xl border border-slate-200 px-4 py-3 font-black uppercase text-slate-900 text-base outline-none focus:border-[#0c6b7a]"
                />
                <button
                  onClick={() => processVerifyToken(tokenInput)}
                  className="rounded-xl bg-slate-900 px-6 py-3 font-bold text-white text-xs hover:bg-slate-800"
                >
                  Verify Code
                </button>
              </div>
            </div>

            {/* SCAN STATUS NOTIFICATION */}
            {scanMessage && scanMessage.type !== 'success' && (
              <div
                className={`rounded-2xl p-4 text-xs font-medium space-y-2 ${scanMessage.type === 'already-used'
                    ? 'bg-red-50 border border-red-200 text-red-900'
                    : 'bg-amber-50 border border-amber-200 text-amber-900'
                  }`}
              >
                <div className="font-bold flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {scanMessage.type === 'already-used' ? (
                      <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                    )}
                    <span>{scanMessage.type === 'already-used' ? 'QR TOKEN COMPLETED / NO FURTHER USE' : 'Token Status Notification'}</span>
                  </div>

                </div>
                <p className="leading-relaxed">{scanMessage.text}</p>
                {pendingQueueArrival && (
                  <div className="space-y-3 rounded-xl border border-amber-300 bg-white p-3 text-slate-900">
                    <div className="flex items-center gap-2 font-black text-amber-950">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 text-lg">
                        {pendingQueueArrival.position}
                      </span>
                      Queue position #{pendingQueueArrival.position}
                    </div>
                    <p className="text-slate-800">
                      Allow check-in now? Their place stays #{pendingQueueArrival.position}; this will not let them skip patients ahead.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => { void processVerifyToken(pendingQueueArrival.token.id, pendingQueueArrival.position) }}
                        className="rounded-lg bg-emerald-700 px-4 py-2 font-bold text-white hover:bg-emerald-800"
                      >
                        Allow Check-in
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPendingQueueArrival(null)
                          setScanMessage({ type: 'error', text: 'Check-in was not allowed. The queue remains unchanged.' })
                        }}
                        className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-bold text-slate-800 hover:bg-slate-100"
                      >
                        Don&apos;t Allow
                      </button>
                    </div>
                  </div>
                )}
                {scanMessage.isAnalyzing && (
                  <div className="flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sky-900">
                    <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-sky-500" />
                    Analyzing the stated visit reason with AI...
                  </div>
                )}
                {scanMessage.analysis && (() => {
                  const category = scanMessage.analysis.triageCategory
                  const urgency = category === 'Emergency'
                    ? { label: 'EMERGENCY', style: 'border-red-300 bg-red-50 text-red-900', light: 'bg-red-600' }
                    : category === 'Urgent'
                      ? { label: 'URGENT', style: 'border-amber-300 bg-amber-50 text-amber-950', light: 'bg-amber-500' }
                      : { label: 'NORMAL', style: 'border-emerald-300 bg-emerald-50 text-emerald-950', light: 'bg-emerald-600' }

                  return (
                    <div className={`space-y-1.5 rounded-xl border p-3 ${urgency.style}`} role="status" aria-live="polite">
                      <div className="flex items-center gap-2 font-black">
                        <span className={`h-3 w-3 rounded-full ${urgency.light}`} />
                        {urgency.label} · {category} · Risk {scanMessage.analysis.riskScore}/100
                      </div>
                      <p>{scanMessage.analysis.symptomSummary}</p>
                      <p className="font-semibold">{scanMessage.analysis.suggestedAction}</p>
                      <p className="text-[0.68rem] font-semibold">
                        Provider: {scanMessage.analysis.source === 'openai' ? 'OpenAI live' : scanMessage.analysis.source === 'gemini' ? 'Gemini live' : 'Offline rules'}
                      </p>
                      {scanMessage.analysis.providerError && (
                        <p className="font-semibold">Live AI error: {scanMessage.analysis.providerError}</p>
                      )}
                      <p className="text-[0.68rem]">AI screening from stated reason only; staff must confirm urgency.</p>
                    </div>
                  )
                })()}
              </div>
            )}
          </section>
        )}

        {activeTab === 'appointments' && (
          <section className="rounded-[2.5rem] border border-[#dfecef] bg-white p-6 shadow-sm space-y-5">
            <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0c6b7a] text-white">
                  <Calendar className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-2xl font-black text-slate-900">Appointment Requests</h2>
                  <p className="text-xs text-slate-500">Review requests assigned to {staffAccount.role === 'Doctor' ? staffAccount.name : 'the clinic'}.</p>
                </div>
              </div>

              <button
                type="button"
                onClick={onClearAppointments}
                className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[0.7rem] font-bold text-red-700 transition hover:bg-red-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear Appointment History
              </button>
            </div>

            <div className="space-y-3">
              {appointments
                .filter((appointment) => staffAccount.role !== 'Doctor' || appointment.doctor === staffAccount.name)
                .sort((first, second) => first.date.localeCompare(second.date) || first.time.localeCompare(second.time))
                .map((appointment) => (
                  <article key={appointment.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                      <div className="space-y-1 text-sm">
                        <h3 className="font-black text-slate-900">{appointment.patientName} · {appointment.service}</h3>
                        <p className="text-slate-700">Doctor: {appointment.doctor || 'Not assigned'}</p>
                        <p className="text-slate-600">{appointment.date} at {appointment.time}</p>
                        <p className="text-slate-700">Reason: {appointment.reason}</p>
                        <span className={`mt-1 inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${appointment.status === 'Approved' || appointment.status === 'Confirmed'
                            ? 'bg-emerald-100 text-emerald-800'
                            : appointment.status === 'Rejected' || appointment.status === 'Cancelled'
                              ? 'bg-red-100 text-red-800'
                              : appointment.status === 'Completed'
                                ? 'bg-slate-200 text-slate-700'
                                : 'bg-amber-100 text-amber-800'
                          }`}>
                          {appointment.status === 'Confirmed' ? 'Approved' : appointment.status === 'Cancelled' ? 'Rejected' : appointment.status}
                        </span>
                      </div>
                      {appointment.status === 'Requested' && (
                        <div className="flex shrink-0 gap-2">
                          <button
                            type="button"
                            onClick={() => onUpdateAppointment({ ...appointment, status: 'Approved' })}
                            className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-800"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => onUpdateAppointment({ ...appointment, status: 'Rejected' })}
                            className="rounded-lg border border-red-300 bg-white px-4 py-2 text-xs font-bold text-red-800 hover:bg-red-50"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </div>
                  </article>
                ))}
              {appointments.filter((appointment) => staffAccount.role !== 'Doctor' || appointment.doctor === staffAccount.name).length === 0 && (
                <p className="rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-500">No appointment requests assigned to this portal yet.</p>
              )}
            </div>
          </section>
        )}

        {/* PAGE 3: STAFF WORK HISTORY (PATIENTS HANDLED TODAY) */}
        {activeTab === 'history' && (
          <section className="rounded-[2.5rem] border border-[#dfecef] bg-white p-6 shadow-sm space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0c6b7a] text-white">
                  <History className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-2xl font-black text-slate-900">Staff Work History</h2>
                  <p className="text-xs text-slate-500">
                    Patients handled today by {staffAccount.name} ({handledStaffPatients.length} total)
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-[#eafaf6] px-4 py-2 text-xs font-black text-[#0c6b7a]">
                  Today&apos;s Total: {handledStaffPatients.length} Handled
                </div>

              </div>
            </div>

            <div className="space-y-3">
              {handledStaffPatients.map((p) => (
                <div
                  key={p.id}
                  className="rounded-2xl border border-slate-200 bg-slate-50 p-5 space-y-3 text-xs hover:border-[#0c6b7a] transition"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200/60 pb-2">
                    <div className="flex items-center gap-3">
                      <span className="text-xl font-black text-slate-900">{p.token}</span>
                      <div>
                        <div className="font-bold text-slate-900 text-sm">{p.patientName}</div>
                        <div className="text-slate-500">{p.service} · Age: {p.age || '30'}</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800">
                        {p.isCheckedIn ? 'Checked In' : p.status}
                      </span>
                      <button
                        onClick={() => {
                          setSelectedToken(p)
                          setStandalonePatientToken(p)
                        }}
                        className="rounded-xl bg-[#0c6b7a] px-3.5 py-1.5 font-bold text-white text-xs hover:bg-[#09525e]"
                      >
                        Inspect Patient Record
                      </button>
                      <button
                        onClick={() => handleClearSingleStaffTokenRecord(p.id, p.patientName)}
                        className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-800 hover:bg-amber-100 transition flex items-center gap-1"
                        title="Remove from my staff work history"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Clear Record
                      </button>
                    </div>
                  </div>

                  {p.checkInData && (
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[0.7rem] text-slate-700 bg-white p-3 rounded-xl border border-slate-100">
                      <div>BP: <strong>{p.checkInData.vitals.bloodPressure}</strong></div>
                      <div>Pulse: <strong>{p.checkInData.vitals.heartRate}</strong></div>
                      <div>Temp: <strong>{formatTempCelsius(p.checkInData.vitals.temperature)}</strong></div>
                      <div>Weight: <strong>{p.checkInData.vitals.weightKg || '68 kg'}</strong></div>
                      <div>Check-in Time: <strong>{new Date(p.checkInData.checkedInAt).toLocaleTimeString()}</strong></div>
                    </div>
                  )}

                  {p.prescriptions && p.prescriptions.length > 0 && (
                    <div className="bg-emerald-50/60 p-3 rounded-xl border border-emerald-100 text-emerald-950 space-y-1">
                      <div className="font-bold">Prescribed Medications ({p.prescriptions.length}):</div>
                      <div className="flex flex-wrap gap-2 pt-1">
                        {p.prescriptions.map((rx) => (
                          <span
                            key={rx.id}
                            className="rounded-lg bg-white border border-emerald-200 px-2.5 py-1 text-[0.68rem] font-semibold"
                          >
                            {rx.medicineName} ({rx.dosage}) · {rx.frequency}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {handledStaffPatients.length === 0 && (
                <p className="text-center py-12 text-xs text-slate-400 italic">
                  No patients handled yet today under this staff account.
                </p>
              )}
            </div>
          </section>
        )}

        {/* PAGE 4: AI STAFF STATISTICS & WORKLOAD ANALYTICS */}
        {activeTab === 'ai-analytics' && (
          <section className="rounded-[2.5rem] border border-[#dfecef] bg-white p-8 shadow-sm space-y-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500 text-white shadow-md">
                  <Brain className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-2xl font-black text-slate-900">AI Staff Performance &amp; Analytics</h2>
                  <p className="text-xs text-slate-500">
                    Clinical workload analytics for {staffAccount.name} ({staffAccount.role})
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-500">Efficiency Index:</span>
                <span className="rounded-full bg-emerald-100 px-3.5 py-1 text-sm font-black text-emerald-800">
                  {analyticsData.productivityScore}%
                </span>
              </div>
            </div>

            {/* Metrics Dashboard Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 space-y-1">
                <span className="text-xs font-bold text-slate-400">Handled Today</span>
                <div className="text-3xl font-black text-slate-900">{analyticsData.handledTodayCount}</div>
                <div className="text-[0.68rem] text-slate-500">Patients processed</div>
              </div>

              <div className="rounded-2xl border border-red-200 bg-red-50/60 p-5 space-y-1">
                <span className="text-xs font-bold text-red-800">Emergency Cases</span>
                <div className="text-3xl font-black text-red-900">{analyticsData.emergencyHandled}</div>
                <div className="text-[0.68rem] text-red-700">Triage score &gt; 70</div>
              </div>

              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5 space-y-1">
                <span className="text-xs font-bold text-emerald-800">Rx Issued</span>
                <div className="text-3xl font-black text-emerald-900">{analyticsData.totalPrescriptionsIssued}</div>
                <div className="text-[0.68rem] text-emerald-700">Total medications</div>
              </div>

              <div className="rounded-2xl border border-blue-200 bg-blue-50/60 p-5 space-y-1">
                <span className="text-xs font-bold text-blue-800">Avg Triage Score</span>
                <div className="text-3xl font-black text-blue-900">{analyticsData.avgTriageScore}</div>
                <div className="text-[0.68rem] text-blue-700">Baseline severity</div>
              </div>
            </div>

            {/* AI CLINICAL WORKLOAD SUMMARY REPORT */}
            <div className="rounded-3xl border border-amber-200 bg-amber-50/60 p-6 space-y-3">
              <div className="flex items-center gap-2 font-black text-amber-950 text-base">
                <Sparkles className="h-5 w-5 text-amber-600" />
                AI Workload &amp; Performance Summary
              </div>
              <p className="text-xs text-slate-700 leading-relaxed font-medium">
                {analyticsData.aiAssessment}
              </p>
              <div className="pt-2 text-[0.7rem] text-amber-800 font-bold flex items-center justify-between border-t border-amber-200/50">
                <span>⚡ Turnaround Average: ~4.5 mins / patient</span>
                <span>Doctor Staff Efficiency: High</span>
              </div>
            </div>
          </section>
        )}

        {/* STANDALONE PATIENT PAGE OVERLAY (OPENED AFTER SCANNING QR TOKEN OR CLICKING PATIENT) */}
        {standalonePatientToken && (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/70 p-3 sm:p-6 backdrop-blur-md animate-reveal">
            <div className="mx-auto max-w-5xl rounded-[2.5rem] border border-slate-200 bg-white p-6 sm:p-8 shadow-2xl space-y-6">
              {/* TOP HEADER BAR WITH CLOSE BUTTON */}
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-100 pb-5">
                <div className="flex min-w-0 items-center gap-4">
                  <div className="h-16 w-16 rounded-full border-2 border-[#0c6b7a] bg-slate-100 flex items-center justify-center overflow-hidden shrink-0">
                    {standalonePatientToken.photo ? (
                      <img src={standalonePatientToken.photo} alt={standalonePatientToken.patientName} className="h-full w-full object-cover" />
                    ) : (
                      <User className="h-8 w-8 text-[#0c6b7a]" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="break-words text-2xl font-black leading-tight text-slate-900">{standalonePatientToken.patientName}</h2>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="shrink-0 whitespace-nowrap text-xs font-bold text-slate-500">Age: {standalonePatientToken.age || '28'}</span>
                      <span className="inline-flex min-h-7 min-w-[4.5rem] shrink-0 items-center justify-center whitespace-nowrap rounded-full bg-emerald-100 px-3 py-1 font-mono text-xs font-black tracking-wide text-emerald-800">
                        {standalonePatientToken.token}
                      </span>
                    </div>
                    <div className="mt-1 break-words text-xs text-slate-500">
                      {standalonePatientToken.email} · {standalonePatientToken.phone || '+91 98765 43210'}
                    </div>
                    <div className="mt-1 text-xs font-bold text-[#0c6b7a]">
                      Department: <span className="text-slate-900 font-black">{standalonePatientToken.service}</span>
                    </div>
                    {getQueuePosition(standalonePatientToken, queueTokens) !== null && (
                      <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-black text-amber-950">
                        Queue position #{getQueuePosition(standalonePatientToken, queueTokens)}
                        <span className="font-medium">FIFO place held</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex w-full flex-wrap items-center justify-start gap-2 sm:justify-end lg:w-auto">
                  {standalonePatientToken.status !== 'Completed' ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setCheckoutModalToken(standalonePatientToken)
                          setCheckoutNotesInput(standalonePatientToken.checkoutNotes || '')
                        }}
                        className="inline-flex items-center gap-2 whitespace-nowrap rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white shadow-md hover:bg-emerald-700 transition"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        Checkout Patient
                      </button>
                      <button
                        type="button"
                        onClick={handleElevateEmergency}
                        className="inline-flex items-center gap-2 whitespace-nowrap rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-black text-red-700 hover:bg-red-100 transition"
                      >
                        <AlertCircle className="h-4 w-4 text-red-600" />
                        Elevate to Emergency
                      </button>
                    </>
                  ) : (
                    <span className="rounded-xl bg-emerald-100 text-emerald-800 px-4 py-2 font-bold text-xs">
                      Checked Out
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={handleCloseStandalonePatientPage}
                    className="inline-flex items-center gap-2 whitespace-nowrap rounded-xl bg-slate-900 px-5 py-2.5 text-xs font-extrabold text-white shadow-md hover:bg-slate-800 transition"
                  >
                    <X className="h-4 w-4" />
                    Close Patient Page
                  </button>
                </div>
              </div>

              {/* Checkout Alert Banner inside Standalone Patient Page */}
              {checkoutSuccessAlert && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-xs font-bold text-emerald-900 flex items-center justify-between">
                  <span>{checkoutSuccessAlert}</span>
                  <button onClick={() => setCheckoutSuccessAlert('')} className="text-emerald-700 underline">
                    Dismiss
                  </button>
                </div>
              )}

              {/* PATIENT STATED REASON / CHIEF COMPLAINT HIGHLIGHT CARD */}
              <div
                className="rounded-2xl border-2 border-teal-700 p-5 text-xs space-y-1.5 shadow-sm"
                style={{ backgroundColor: '#f8fafc', color: '#111827' }}
              >
                <div className="flex items-center gap-2 font-black uppercase tracking-wider text-[0.75rem]" style={{ color: '#0f766e' }}>
                  <MessageSquareText className="h-4 w-4 shrink-0" />
                  Patient&apos;s Stated Reason for Visit / Chief Complaint:
                </div>
                <p className="pl-6 text-sm font-extrabold leading-relaxed sm:text-base" style={{ color: '#111827' }}>
                  {visitReasonScreening?.tokenId === standalonePatientToken.id
                    ? visitReasonScreening.reason || 'No visit reason provided yet.'
                    : standalonePatientToken.complaint || standalonePatientToken.checkInData?.chiefComplaint || 'No visit reason provided.'}
                </p>
              </div>

              {(() => {
                const screening = visitReasonScreening?.tokenId === standalonePatientToken.id
                  ? visitReasonScreening
                  : null
                const analysis = screening?.analysis
                const savedCheckIn = standalonePatientToken.checkInData
                const missingReason = screening?.status === 'missing'
                const assessmentPending = screening?.status === 'loading'
                const noScoreYet = missingReason || assessmentPending
                const triageLevel = noScoreYet ? undefined : analysis?.triageCategory ?? savedCheckIn?.triageLevel
                const triageScore = noScoreYet ? undefined : analysis?.riskScore ?? savedCheckIn?.triageScore
                const rating = triageScore === undefined ? null : getTriageRiskRating(triageScore)
                const urgencyBand = noScoreYet
                  ? 'unknown'
                  : triageLevel === 'Emergency'
                  ? 'emergency'
                  : triageLevel === 'Urgent'
                    ? 'urgent'
                    : 'normal'
                const styles = urgencyBand === 'unknown'
                  ? { container: 'border-slate-300 bg-slate-50 text-slate-900', bar: 'bg-slate-400', light: 'bg-slate-400', label: 'INSUFFICIENT INFORMATION' }
                  : urgencyBand === 'emergency'
                  ? { container: 'border-red-300 bg-red-50 text-red-950', bar: 'bg-red-600', light: 'bg-red-600', label: 'EMERGENCY' }
                  : urgencyBand === 'urgent'
                    ? { container: 'border-amber-300 bg-amber-50 text-amber-950', bar: 'bg-amber-500', light: 'bg-amber-500', label: 'URGENT' }
                    : { container: 'border-emerald-300 bg-emerald-50 text-emerald-950', bar: 'bg-emerald-600', light: 'bg-emerald-600', label: 'NORMAL' }

                return (
                  <section className={`rounded-2xl border p-4 ${styles.container}`} aria-label="AI screening risk rating" style={{ color: '#111827' }}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="flex items-center gap-2 text-xs font-black uppercase tracking-wide">
                          <span className={`h-3 w-3 rounded-full ${styles.light}`} />
                          {screening?.status === 'loading' ? 'Analyzing visit reason' : `AI visit-reason assessment · ${styles.label}`}
                        </h3>
                        {analysis && (
                          <p className="mt-1 text-[0.68rem] font-semibold">
                            Provider: {analysis.source === 'openai' ? 'OpenAI live' : analysis.source === 'gemini' ? 'Gemini live' : 'Offline rules'}
                          </p>
                        )}
                        {rating && triageLevel && (
                          <p className="mt-1 text-xs font-semibold">{rating.label} · {triageLevel} triage</p>
                        )}
                      </div>
                      {rating && <p className="shrink-0 text-2xl font-black">{rating.scoreOutOfTen}<span className="text-sm">/10</span></p>}
                    </div>
                    {screening?.status === 'missing' ? (
                      <form
                        className="mt-3 space-y-3"
                        onSubmit={(event) => {
                          event.preventDefault()
                          void handleAnalyzeVisitReason()
                        }}
                      >
                        <p className="text-sm font-semibold">
                          No visit reason was provided. AI cannot safely label this patient Emergency or Normal without symptoms; ask what brought them in and enter it here.
                        </p>
                        <textarea
                          value={visitReasonDraft}
                          onChange={(event) => setVisitReasonDraft(event.target.value)}
                          rows={3}
                          placeholder="Enter the patient’s stated symptoms or reason for visit"
                          className="w-full rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-900 outline-none focus:border-[#0c6b7a]"
                          required
                        />
                        <button
                          type="submit"
                          disabled={!visitReasonDraft.trim()}
                          className="rounded-xl bg-[#0c6b7a] px-4 py-2.5 text-xs font-bold text-white hover:bg-[#09525e] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Analyze Visit Reason with AI
                        </button>
                      </form>
                    ) : screening?.status === 'loading' ? (
                      <p className="mt-3 text-sm font-semibold">Analyzing the patient&apos;s stated reason. This may take a few seconds.</p>
                    ) : analysis ? (
                      <div className="mt-3 space-y-3 text-sm">
                        {analysis.providerError && (
                          <p className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs font-semibold text-amber-950">
                            Live AI request failed: {analysis.providerError}. Showing the offline rule-based estimate.
                          </p>
                        )}
                        <p><strong>Assessment:</strong> {analysis.symptomSummary}</p>
                        <p><strong>Recommended department:</strong> {analysis.recommendedDepartment}</p>
                        {analysis.redFlags?.length > 0 && (
                          <div>
                            <strong>Red flags:</strong>
                            <ul className="mt-1 list-inside list-disc">
                              {analysis.redFlags.map((flag, index) => <li key={`${flag}-${index}`}>{flag}</li>)}
                            </ul>
                          </div>
                        )}
                        {analysis.recommendations?.length > 0 && (
                          <div>
                            <strong>Recommendations:</strong>
                            <ul className="mt-1 list-inside list-disc">
                              {analysis.recommendations.map((recommendation, index) => <li key={`${recommendation}-${index}`}>{recommendation}</li>)}
                            </ul>
                          </div>
                        )}
                        <p><strong>Next step:</strong> {analysis.suggestedAction}</p>
                      </div>
                    ) : savedCheckIn ? (
                      <p className="mt-3 text-sm">{savedCheckIn.aiRiskSummary}</p>
                    ) : (
                      <p className="mt-3 text-sm">No visit-reason analysis is available for this patient.</p>
                    )}
                    {rating && (
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/80">
                        <div className={`h-full ${styles.bar}`} style={{ width: `${Number(rating.scoreOutOfTen) * 10}%` }} />
                      </div>
                    )}
                    <p className="mt-3 text-[0.7rem]">AI screening is advisory only. Staff must assess the patient and confirm urgency.</p>
                  </section>
                )
              })()}

              {/* PATIENT VITALS & INTAKE HISTORY CARD */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#0c6b7a]">
                    <Activity className="h-4 w-4" />
                    Recorded Vitals (BP, Heart Rate, Temp, Weight)
                  </div>

                  <div className="flex items-center gap-2">
                    {standalonePatientToken.checkInData && (
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-bold ${standalonePatientToken.checkInData.triageLevel === 'Emergency'
                            ? 'bg-red-100 text-red-800'
                            : standalonePatientToken.checkInData.triageLevel === 'Urgent'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                      >
                        Triage: {standalonePatientToken.checkInData.triageLevel}
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={() => handleOpenEditVitals(standalonePatientToken)}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-[#0c6b7a] px-3.5 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-[#09525e] transition"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                      Edit Vitals &amp; Date
                    </button>
                  </div>
                </div>

                {/* EDIT VITALS FORM SLIDE/DRAWER */}
                {isEditingVitals && (
                  <form
                    onSubmit={handleSaveVitalsUpdate}
                    className="rounded-2xl border-2 border-[#0c6b7a]/40 bg-[#f4faf9] p-5 space-y-4 text-xs animate-reveal"
                  >
                    <div className="flex items-center justify-between border-b border-slate-200/80 pb-2">
                      <h4 className="font-black text-slate-900 text-sm flex items-center gap-2">
                        <Edit3 className="h-4 w-4 text-[#0c6b7a]" />
                        Edit Clinical Vitals &amp; Timestamp for {standalonePatientToken.patientName}
                      </h4>
                      <button
                        type="button"
                        onClick={() => setIsEditingVitals(false)}
                        className="p-1 hover:bg-slate-200 rounded-full text-slate-500"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-[0.7rem] font-bold uppercase tracking-wider text-slate-700 mb-1">
                          Blood Pressure (BP)
                        </label>
                        <input
                          value={editBP}
                          onChange={(e) => setEditBP(e.target.value)}
                          placeholder="e.g. 120/80"
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-bold text-slate-900"
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-[0.7rem] font-bold uppercase tracking-wider text-slate-700 mb-1">
                          Heart Rate (BPM)
                        </label>
                        <input
                          value={editHeartRate}
                          onChange={(e) => setEditHeartRate(e.target.value)}
                          placeholder="e.g. 75 bpm"
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-bold text-slate-900"
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-[0.7rem] font-bold uppercase tracking-wider text-slate-700 mb-1">
                          Body Temp ({editTempUnit})
                        </label>
                        <div className="flex gap-1 items-center">
                          <input
                            value={editTemp}
                            onChange={(e) => setEditTemp(e.target.value)}
                            placeholder={editTempUnit === '°F' ? '98.6' : '37.0'}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-bold text-slate-900 min-w-0"
                            required
                          />
                          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-xs font-bold shrink-0">
                            <button
                              type="button"
                              onClick={() => handleEditTempUnitChange('°F')}
                              className={`px-2 py-1 rounded-md transition ${editTempUnit === '°F' ? 'bg-[#0c6b7a] text-white shadow-sm' : 'text-slate-600'}`}
                            >
                              °F
                            </button>
                            <button
                              type="button"
                              onClick={() => handleEditTempUnitChange('°C')}
                              className={`px-2 py-1 rounded-md transition ${editTempUnit === '°C' ? 'bg-[#0c6b7a] text-white shadow-sm' : 'text-slate-600'}`}
                            >
                              °C
                            </button>
                          </div>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[0.7rem] font-bold uppercase tracking-wider text-slate-700 mb-1 flex items-center gap-1">
                          <Scale className="h-3 w-3 text-slate-500" />
                          Weight (kg)
                        </label>
                        <input
                          value={editWeight}
                          onChange={(e) => setEditWeight(e.target.value)}
                          placeholder="e.g. 68 kg"
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-bold text-slate-900"
                        />
                      </div>

                      <div>
                        <label className="block text-[0.7rem] font-bold uppercase tracking-wider text-slate-700 mb-1">
                          SpO2 Oxygen (%)
                        </label>
                        <input
                          value={editOxygen}
                          onChange={(e) => setEditOxygen(e.target.value)}
                          placeholder="e.g. 98 %"
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-bold text-slate-900"
                        />
                      </div>

                      <div>
                        <label className="block text-[0.7rem] font-bold uppercase tracking-wider text-slate-700 mb-1">
                          Blood Sugar (mg/dL)
                        </label>
                        <input
                          value={editBloodSugar}
                          onChange={(e) => setEditBloodSugar(e.target.value)}
                          placeholder="e.g. 105 mg/dL"
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-bold text-slate-900"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[0.7rem] font-bold uppercase tracking-wider text-slate-700 mb-1 flex items-center gap-1">
                        <Calendar className="h-3 w-3 text-[#0c6b7a]" />
                        Recorded Date &amp; Time Stamp
                      </label>
                      <input
                        type="datetime-local"
                        value={editRecordDate}
                        onChange={(e) => setEditRecordDate(e.target.value)}
                        className="w-full sm:w-1/2 rounded-xl border border-slate-200 bg-white px-3 py-2 font-semibold text-slate-900 text-xs"
                        required
                      />
                    </div>

                    <div className="flex justify-end gap-2 pt-2 border-t border-slate-200/80">
                      <button
                        type="button"
                        onClick={() => setIsEditingVitals(false)}
                        className="rounded-xl border border-slate-200 bg-white px-4 py-2 font-bold text-slate-700 hover:bg-slate-100"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="rounded-xl bg-[#0c6b7a] px-5 py-2 font-bold text-white shadow hover:bg-[#09525e]"
                      >
                        Save Vitals &amp; Store with Date
                      </button>
                    </div>
                  </form>
                )}

                {/* CURRENT VITALS DISPLAY CARDS */}
                {standalonePatientToken.checkInData ? (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 text-xs">
                      <div className="rounded-xl bg-slate-50 p-3 border border-slate-100">
                        <span className="text-slate-400 font-semibold">Blood Pressure</span>
                        <div className="font-black text-slate-900 text-sm mt-0.5">
                          {standalonePatientToken.checkInData.vitals.bloodPressure}
                        </div>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3 border border-slate-100">
                        <span className="text-slate-400 font-semibold">Heart Rate</span>
                        <div className="font-black text-slate-900 text-sm mt-0.5">
                          {standalonePatientToken.checkInData.vitals.heartRate}
                        </div>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3 border border-slate-100">
                        <span className="text-slate-400 font-semibold">Body Temp</span>
                        <div className="font-black text-slate-900 text-sm mt-0.5">
                          {formatTempCelsius(standalonePatientToken.checkInData.vitals.temperature)}
                        </div>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3 border border-slate-100">
                        <span className="text-slate-400 font-semibold">Body Weight</span>
                        <div className="font-black text-slate-900 text-sm mt-0.5">
                          {standalonePatientToken.checkInData.vitals.weightKg || '68 kg'}
                        </div>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3 border border-slate-100">
                        <span className="text-slate-400 font-semibold">SpO2 Oxygen</span>
                        <div className="font-black text-slate-900 text-sm mt-0.5">
                          {standalonePatientToken.checkInData.vitals.oxygenLevel}
                        </div>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3 border border-slate-100">
                        <span className="text-slate-400 font-semibold">Blood Sugar</span>
                        <div className="font-black text-slate-900 text-sm mt-0.5">
                          {standalonePatientToken.checkInData.vitals.bloodSugar || '105 mg/dL'}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl bg-emerald-50/70 p-4 border border-emerald-200 text-xs text-emerald-900 space-y-1">
                      <div className="font-bold text-emerald-950">AI Triage Risk Summary:</div>
                      <p>{standalonePatientToken.checkInData.aiRiskSummary}</p>
                      <div className="text-[0.7rem] text-emerald-800 pt-1 border-t border-emerald-200/50 mt-1 flex justify-between">
                        <span>Doctor: {standalonePatientToken.checkInData.assignedDoctor}</span>
                        <span>Room: {standalonePatientToken.checkInData.roomNumber}</span>
                        <span>Checked In At: {new Date(standalonePatientToken.checkInData.checkedInAt).toLocaleTimeString()}</span>
                      </div>
                    </div>

                    {/* STORED VITALS HISTORY LOG WITH DATES */}
                    {standalonePatientToken.checkInData.vitalsHistory && standalonePatientToken.checkInData.vitalsHistory.length > 0 && (
                      <div className="space-y-2 border-t border-slate-100 pt-3">
                        <h4 className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                          <Calendar className="h-3.5 w-3.5 text-[#0c6b7a]" />
                          Stored Vitals Log History ({standalonePatientToken.checkInData.vitalsHistory.length} Recorded Readings)
                        </h4>

                        <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                          {standalonePatientToken.checkInData.vitalsHistory.map((rec) => (
                            <div
                              key={rec.id}
                              className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs space-y-1"
                            >
                              <div className="flex justify-between items-center text-[0.7rem] font-bold text-[#0c6b7a]">
                                <span>Recorded by: {rec.recordedBy}</span>
                                <span>📅 {new Date(rec.recordedAt).toLocaleString()}</span>
                              </div>

                              <div className="flex flex-wrap gap-x-4 gap-y-1 text-slate-800 font-semibold text-[0.75rem]">
                                <span>BP: <strong>{rec.vitals.bloodPressure}</strong></span>
                                <span>Pulse: <strong>{rec.vitals.heartRate}</strong></span>
                                <span>Temp: <strong>{formatTempCelsius(rec.vitals.temperature)}</strong></span>
                                <span>Weight: <strong>{rec.vitals.weightKg || '68 kg'}</strong></span>
                                <span>SpO2: <strong>{rec.vitals.oxygenLevel}</strong></span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="rounded-2xl bg-amber-50 p-4 border border-amber-200 text-xs text-amber-900 flex justify-between items-center">
                    <span>⚠️ Patient has not completed intake check-in yet. Click &quot;Edit Vitals &amp; Date&quot; above to record vitals manually.</span>
                    <button
                      onClick={() => handleOpenEditVitals(standalonePatientToken)}
                      className="rounded-xl bg-[#0c6b7a] px-3 py-1.5 text-xs font-bold text-white"
                    >
                      Record Vitals Now
                    </button>
                  </div>
                )}
              </div>

              {/* MULTI-MEDICATION PRESCRIPTION BUILDER */}
              <div className="rounded-[2.5rem] border border-[#dfecef] bg-white p-6 shadow-sm space-y-6">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                      <Pill className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-lg font-black text-slate-900">Prescribe Medications</h3>
                      <p className="text-xs text-slate-500">
                        Add single or multiple medicines for {standalonePatientToken.patientName}.
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleAddMoreMedicineRow}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-100 px-3.5 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-200 transition"
                  >
                    <Plus className="h-4 w-4" />
                    Add More Medication
                  </button>
                </div>

                {/* QUICK PRESCRIPTION PRESETS BAR */}
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 space-y-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-900 block">
                    ⚡ Quick Prescription Presets (One-Click Auto Add)
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        handleAddPresetMedicineRow({
                          medicineName: 'Paracetamol 500mg',
                          dosage: '500 mg',
                          frequency: '1-0-1 (Morning & Evening)',
                          duration: '3 days',
                          instructions: 'Take after meals for fever/pain',
                        })
                      }
                      className="rounded-xl border border-emerald-300 bg-white px-3 py-1.5 text-xs font-bold text-emerald-800 shadow-sm hover:bg-emerald-100 transition"
                    >
                      + Paracetamol 500mg
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleAddPresetMedicineRow({
                          medicineName: 'Amoxicillin 500mg',
                          dosage: '500 mg',
                          frequency: '1-0-1 (Morning & Evening)',
                          duration: '5 days',
                          instructions: 'Complete full course of antibiotics',
                        })
                      }
                      className="rounded-xl border border-emerald-300 bg-white px-3 py-1.5 text-xs font-bold text-emerald-800 shadow-sm hover:bg-emerald-100 transition"
                    >
                      + Amoxicillin 500mg
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleAddPresetMedicineRow({
                          medicineName: 'Cetirizine 10mg',
                          dosage: '10 mg',
                          frequency: '0-0-1 (Night)',
                          duration: '5 days',
                          instructions: 'Take at night before sleep',
                        })
                      }
                      className="rounded-xl border border-emerald-300 bg-white px-3 py-1.5 text-xs font-bold text-emerald-800 shadow-sm hover:bg-emerald-100 transition"
                    >
                      + Cetirizine 10mg
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleAddPresetMedicineRow({
                          medicineName: 'Gelusil Antacid Syrup',
                          dosage: '10 ml',
                          frequency: '1-1-1 (3 times daily)',
                          duration: '4 days',
                          instructions: 'Take before meals for acidity relief',
                        })
                      }
                      className="rounded-xl border border-emerald-300 bg-white px-3 py-1.5 text-xs font-bold text-emerald-800 shadow-sm hover:bg-emerald-100 transition"
                    >
                      + Gelusil Antacid
                    </button>
                  </div>
                </div>

                <form onSubmit={handleSaveAllPrescriptions} className="space-y-6">
                  {/* Dynamic List of Medication Form Rows */}
                  <div className="space-y-4">
                    {draftMeds.map((item, index) => (
                      <div
                        key={item.id}
                        className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3 relative group"
                      >
                        <div className="flex items-center justify-between border-b border-slate-200/60 pb-2">
                          <span className="text-xs font-extrabold uppercase tracking-wider text-[#0c6b7a]">
                            Medicine #{index + 1}
                          </span>
                          {draftMeds.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveMedicineRow(item.id)}
                              className="text-red-500 hover:text-red-700 text-xs flex items-center gap-1 font-bold"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Remove
                            </button>
                          )}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                          <div className="sm:col-span-2">
                            <label className="block text-[0.7rem] font-bold uppercase tracking-wider text-slate-700 mb-1">
                              Medicine Name
                            </label>
                            <input
                              value={item.medicineName}
                              onChange={(e) => handleUpdateMedicineRow(item.id, 'medicineName', e.target.value)}
                              placeholder="e.g. Amoxicillin or Paracetamol 500mg"
                              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold outline-none focus:border-[#0c6b7a]"
                              required
                            />
                          </div>

                          <div>
                            <label className="block text-[0.7rem] font-bold uppercase tracking-wider text-slate-700 mb-1">
                              Dosage
                            </label>
                            <input
                              value={item.dosage}
                              onChange={(e) => handleUpdateMedicineRow(item.id, 'dosage', e.target.value)}
                              placeholder="500 mg"
                              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium outline-none"
                            />
                          </div>

                          <div>
                            <label className="block text-[0.7rem] font-bold uppercase tracking-wider text-slate-700 mb-1">
                              Duration
                            </label>
                            <input
                              value={item.duration}
                              onChange={(e) => handleUpdateMedicineRow(item.id, 'duration', e.target.value)}
                              placeholder="5 days"
                              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium outline-none"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[0.7rem] font-bold uppercase tracking-wider text-slate-700 mb-1">
                              Frequency
                            </label>
                            <select
                              value={item.frequency}
                              onChange={(e) => handleUpdateMedicineRow(item.id, 'frequency', e.target.value)}
                              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium"
                            >
                              <option>1-0-1 (Morning &amp; Evening)</option>
                              <option>1-1-1 (Morning, Afternoon, Evening)</option>
                              <option>1-0-0 (Morning Only)</option>
                              <option>0-0-1 (Bedtime Only)</option>
                              <option>As needed for pain/fever</option>
                            </select>
                          </div>

                          <div>
                            <label className="block text-[0.7rem] font-bold uppercase tracking-wider text-slate-700 mb-1">
                              Instructions
                            </label>
                            <input
                              value={item.instructions}
                              onChange={(e) => handleUpdateMedicineRow(item.id, 'instructions', e.target.value)}
                              placeholder="e.g. Take after food with warm water"
                              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium outline-none"
                            />
                          </div>
                        </div>

                        {/* Individual AI Explanation snippet if generated */}
                        {aiExplanationsMap[item.id] && (
                          <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-3 text-xs space-y-1 text-emerald-950">
                            <div className="font-bold flex items-center gap-1.5 text-emerald-900">
                              <Brain className="h-3.5 w-3.5 text-emerald-700" />
                              AI Drug Guide ({item.medicineName}):
                            </div>
                            <p><strong>Purpose:</strong> {aiExplanationsMap[item.id]?.purpose}</p>
                            <p><strong>Advice:</strong> {aiExplanationsMap[item.id]?.usageAdvice}</p>
                            <p><strong>Warnings:</strong> {aiExplanationsMap[item.id]?.dietaryWarnings}</p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Action Bar: Add More, AI Explain, Save Prescriptions */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                    <button
                      type="button"
                      onClick={handleAddMoreMedicineRow}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-100 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-200 transition"
                    >
                      <Plus className="h-4 w-4" />
                      Option to Add More Medication
                    </button>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleExplainAllDraftMeds}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-xs font-bold text-emerald-800 hover:bg-emerald-100 transition"
                      >
                        <Sparkles className="h-4 w-4 text-emerald-600" />
                        AI Explain All Medications
                      </button>

                      <button
                        type="submit"
                        className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-6 py-2.5 text-xs font-bold text-white shadow-md hover:bg-emerald-800 transition"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        Save Prescriptions to Patient Profile
                      </button>
                    </div>
                  </div>
                </form>

                {/* PREVIOUSLY PRESCRIBED MEDICATIONS LIST */}
                <div className="space-y-3 border-t border-slate-100 pt-4">
                  <h4 className="font-bold text-slate-900 text-sm">
                    All Given Medications for {standalonePatientToken.patientName} ({standalonePatientToken.prescriptions?.length || 0})
                  </h4>

                  <div className="space-y-2">
                    {standalonePatientToken.prescriptions?.map((rx) => (
                      <div key={rx.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs space-y-1">
                        <div className="flex justify-between font-bold text-slate-900">
                          <span>{rx.medicineName} ({rx.dosage})</span>
                          <span className="text-emerald-700">{rx.frequency}</span>
                        </div>
                        <div className="text-slate-600">
                          Duration: {rx.duration} · {rx.instructions} · Prescribed by: {rx.prescribedBy || staffAccount.name}
                        </div>
                        {rx.aiMedicationExplanation && (
                          <div className="text-[0.68rem] text-slate-500 italic mt-1 bg-white p-2 rounded-lg border border-slate-100">
                            💡 AI Note: {rx.aiMedicationExplanation.purpose}. {rx.aiMedicationExplanation.dietaryWarnings}
                          </div>
                        )}
                      </div>
                    ))}

                    {(!standalonePatientToken.prescriptions || standalonePatientToken.prescriptions.length === 0) && (
                      <p className="text-xs text-slate-400 italic">No medications given yet for this visit token.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ASK CHECKOUT PATIENT CONFIRMATION DIALOG (PROMPTED WHEN CLOSING STANDALONE PATIENT PAGE) */}
        {checkoutAskToken && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/80 p-4 backdrop-blur-md animate-reveal">
            <div className="w-full max-w-md rounded-[2.5rem] border border-emerald-200 bg-white p-6 shadow-2xl space-y-5 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                <CheckCircle2 className="h-8 w-8" />
              </div>

              <div className="space-y-2">
                <span className="rounded-full bg-emerald-100 px-3.5 py-1 text-xs font-black text-emerald-900 uppercase tracking-wider">
                  CHECKOUT PATIENT PROMPT
                </span>
                <h3 className="text-xl font-black text-slate-900">
                  Do you want to checkout {checkoutAskToken.patientName}?
                </h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Token <strong>{checkoutAskToken.token}</strong> · Service: {checkoutAskToken.service}
                  <br />
                  Completing patient checkout will mark this visit done and expire the QR pass so there will be no further use of that token QR code.
                </p>
              </div>

              <div className="flex flex-col gap-2.5 pt-2">
                <button
                  onClick={() => {
                    const tokenToCheckout = checkoutAskToken
                    setCheckoutAskToken(null)
                    setCheckoutModalToken(tokenToCheckout)
                    setCheckoutNotesInput(tokenToCheckout.checkoutNotes || '')
                  }}
                  className="w-full rounded-xl bg-emerald-600 py-3 text-xs font-black text-white shadow-md hover:bg-emerald-700 transition flex items-center justify-center gap-2"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Yes, Checkout Patient Now
                </button>

                <button
                  onClick={() => {
                    setCheckoutAskToken(null)
                    setStandalonePatientToken(null)
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-slate-100 py-3 text-xs font-bold text-slate-700 hover:bg-slate-200 transition"
                >
                  No, Keep Patient Checked In &amp; Close View
                </button>

                <button
                  onClick={() => setCheckoutAskToken(null)}
                  className="w-full text-xs font-semibold text-slate-400 hover:text-slate-600 py-1"
                >
                  Cancel (Return to Patient View)
                </button>
              </div>
            </div>
          </div>
        )}

        {/* CHECKOUT PATIENT DISCHARGE NOTES MODAL */}
        {checkoutModalToken && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm animate-reveal">
            <div className="w-full max-w-lg overflow-hidden rounded-[2.5rem] border border-slate-200 bg-white shadow-2xl">
              {/* Modal Header */}
              <div className="flex items-center justify-between border-b border-slate-100 bg-emerald-700 px-6 py-5 text-white">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-white">
                    <CheckCircle2 className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="text-xl font-black tracking-tight">Patient Checkout &amp; Discharge</h3>
                    <p className="text-xs text-emerald-100">Discharge patient &amp; complete clinic visit record</p>
                  </div>
                </div>
                <button
                  onClick={() => setCheckoutModalToken(null)}
                  className="rounded-full p-2 text-white/80 hover:bg-white/10 hover:text-white"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form onSubmit={handleConfirmCheckout} className="p-6 space-y-5">
                {/* Patient & Token Info Summary */}
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-2 text-xs">
                  <div className="flex items-center justify-between border-b border-slate-200/80 pb-2">
                    <div>
                      <span className="text-lg font-black text-slate-900">{checkoutModalToken.patientName}</span>
                      <span className="ml-2 text-slate-500">(Age: {checkoutModalToken.age || 'N/A'})</span>
                    </div>
                    <span className="rounded-full bg-emerald-100 px-3 py-1 font-black text-emerald-900 text-sm">
                      {checkoutModalToken.token}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1 font-medium text-slate-700">
                    <div>Department: <strong>{checkoutModalToken.service}</strong></div>
                    <div>Doctor: <strong>{checkoutModalToken.checkInData?.assignedDoctor || staffAccount.name}</strong></div>
                    <div>Room: <strong>{checkoutModalToken.checkInData?.roomNumber || 'Room 101'}</strong></div>
                    <div>Prescriptions: <strong>{checkoutModalToken.prescriptions?.length || 0} Medicine(s)</strong></div>
                  </div>
                </div>

                {/* Recorded Vitals Summary */}
                {checkoutModalToken.checkInData?.vitals && (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 space-y-1.5 text-xs text-emerald-950">
                    <div className="font-bold flex items-center gap-1.5 text-emerald-900">
                      <Activity className="h-4 w-4 text-emerald-600" />
                      Final Recorded Vitals:
                    </div>
                    <div className="grid grid-cols-3 gap-2 font-semibold">
                      <div>BP: {checkoutModalToken.checkInData.vitals.bloodPressure}</div>
                      <div>Pulse: {checkoutModalToken.checkInData.vitals.heartRate}</div>
                      <div>Temp: {formatTempCelsius(checkoutModalToken.checkInData.vitals.temperature)}</div>
                      <div>Weight: {checkoutModalToken.checkInData.vitals.weightKg || '68 kg'}</div>
                      <div>SpO2: {checkoutModalToken.checkInData.vitals.oxygenLevel}%</div>
                      <div>Sugar: {checkoutModalToken.checkInData.vitals.bloodSugar || '110'}</div>
                    </div>
                  </div>
                )}

                {/* Checkout Notes / Doctor Discharge Advice */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                    Discharge Summary / Doctor Checkout Notes (Optional)
                  </label>
                  <textarea
                    rows={3}
                    value={checkoutNotesInput}
                    onChange={(e) => setCheckoutNotesInput(e.target.value)}
                    placeholder="Add final doctor advice, follow-up instructions, or rest advice..."
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs outline-none focus:border-emerald-600 focus:bg-white"
                  />
                </div>

                {/* Action Buttons */}
                <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
                  <button
                    type="button"
                    onClick={() => setCheckoutModalToken(null)}
                    className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-2.5 text-xs font-black text-white shadow-md hover:bg-emerald-700 transition"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Confirm &amp; Checkout Patient
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
