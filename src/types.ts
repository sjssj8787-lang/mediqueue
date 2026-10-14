export type PatientAccount = {
  id: string
  name: string
  email: string
  phone: string
  password?: string
  age: string
  photo?: string
  medicalNotes?: string
  allergies?: string
  emergencyContact?: string
  bloodPressure?: string
  bodyTemperature?: string
  weightKg?: string
  heartRate?: string
  oxygenLevel?: string
  bloodSugar?: string
}

export type StaffAccount = {
  id: string
  name: string
  email: string
  password?: string
  role: 'Doctor' | 'Nurse' | 'Reception' | 'Counter Staff' | 'Admin'
  department?: string
  roomNumber?: string
}

export type PatientVitals = {
  bloodPressure: string // e.g., "120/80"
  heartRate: string // e.g., "75 bpm"
  temperature: string // e.g., "37.0 °C"
  oxygenLevel: string // e.g., "98 %"
  bloodSugar?: string // e.g., "110 mg/dL"
  weightKg?: string // e.g., "68"
  heightCm?: string // e.g., "172"
}

export function formatTempCelsius(rawTemp?: string): string {
  if (!rawTemp) return '37.0 °C (98.6 °F)'
  const str = rawTemp.trim()
  const num = Number.parseFloat(str.replace(/[^\d.]/g, ''))
  if (Number.isNaN(num)) return str

  // If number > 50, it was supplied in Fahrenheit (e.g., 98, 98.2, 98.6, 102)
  if (num > 50) {
    const celsius = ((num - 32) * 5) / 9
    return `${celsius.toFixed(1)} °C (${num.toFixed(1)} °F)`
  }

  // If number <= 50, it was supplied in Celsius (e.g., 37.0, 38.2)
  const fahrenheit = (num * 9) / 5 + 32
  return `${num.toFixed(1)} °C (${fahrenheit.toFixed(1)} °F)`
}

export type PrescriptionItem = {
  id: string
  medicineName: string
  dosage: string // e.g., "500 mg"
  frequency: string // e.g., "1-0-1 (Morning & Evening)"
  duration: string // e.g., "5 days"
  instructions: string // e.g., "Take after food with water"
  prescribedBy?: string
  prescribedAt?: string
  aiMedicationExplanation?: {
    purpose: string
    usageAdvice: string
    possibleSideEffects: string[]
    dietaryWarnings: string
  }
}

export type VitalsRecord = {
  id: string
  recordedAt: string
  recordedBy: string
  vitals: PatientVitals
}

export type AdditionalCheckInData = {
  checkedInAt: string
  checkedInBy?: string
  vitals: PatientVitals
  triageLevel: 'Emergency' | 'Urgent' | 'Standard' | 'Low Priority'
  triageScore: number // 1 to 100
  aiRiskSummary: string
  assignedDoctor: string
  roomNumber: string
  chiefComplaint: string
  notes?: string
  prescriptions?: PrescriptionItem[]
  vitalsHistory?: VitalsRecord[]
}

export type QueueToken = {
  id: string
  token: string
  patientId: string
  patientName: string
  email: string
  phone?: string
  age?: string
  photo?: string
  service: string // Service requested for visit pass (General Medicine, Eye Check-up, Dental, etc.)
  complaint: string
  issuedAt: string
  status: 'Waiting' | 'Checked In' | 'In progress' | 'Completed' | 'Cancelled' | 'Expired'
  isCheckedIn: boolean
  isExpired?: boolean
  expiredAt?: string
  checkedInAt?: string
  checkedOutAt?: string
  checkoutNotes?: string
  checkInData?: AdditionalCheckInData
  prescriptions?: PrescriptionItem[]
}

export type AppointmentRequest = {
  id: string
  patientId: string
  patientName: string
  email: string
  phone?: string
  service: string
  doctor?: string
  date: string
  time: string
  reason: string
  createdAt: string
  status: 'Requested' | 'Approved' | 'Rejected' | 'Confirmed' | 'Cancelled' | 'Completed'
  consultationMode?: 'In-person' | 'Video Call' | 'Phone Call'
  consentSigned?: boolean
  reminderChannel?: 'SMS' | 'WhatsApp' | 'Email'
}

export type CurrentUser = {
  role: 'patient' | 'staff' | 'admin'
  account: PatientAccount | StaffAccount | { name: string; email: string }
}

export type PatientSection = 'dashboard' | 'profile' | 'token' | 'history' | 'appointment' | 'ai-analysis' | 'medications-vitals'

export type AiAnalysisResult = {
  symptomSummary: string
  riskScore: number // 0 - 100
  riskLevel: 'Low' | 'Moderate' | 'High' | 'Critical'
  triageCategory: 'Emergency' | 'Urgent' | 'Standard' | 'Low Priority'
  recommendedDepartment: string
  redFlags: string[]
  recommendations: string[]
  suggestedAction: string
  source?: 'openai' | 'gemini' | 'offline'
  providerError?: string
  vitalsAssessment?: {
    bpStatus: 'Normal' | 'Elevated' | 'High' | 'Low'
    hrStatus: 'Normal' | 'Tachycardia' | 'Bradycardia'
    tempStatus: 'Normal' | 'Fever' | 'High Fever' | 'Hypothermia'
    spo2Status: 'Normal' | 'Low (Hypoxia Warning)'
  }
}

export type ContactInquiry = {
  id: string
  name: string
  email: string
  message: string
  createdAt: string
  status: 'Unread' | 'Read' | 'Replied'
}

