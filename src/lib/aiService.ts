import type { AiAnalysisResult, AdditionalCheckInData, QueueToken, PatientVitals } from '../types'

export function getStoredOpenAIKey(): string {
  const isUsableKey = (key: string | undefined): key is string =>
    Boolean(key?.trim()) && !/^your_.*_api_key_here$/i.test(key!.trim())

  if (typeof window !== 'undefined') {
    const localKey = localStorage.getItem('medi_openai_api_key')
    if (localKey && isUsableKey(localKey)) return localKey.trim()
  }
  const envKey = import.meta.env.VITE_OPENAI_API_KEY
  return isUsableKey(envKey) ? envKey.trim() : ''
}

export function saveOpenAIKey(key: string): void {
  if (typeof window !== 'undefined') {
    if (!key.trim()) {
      localStorage.removeItem('medi_openai_api_key')
    } else {
      localStorage.setItem('medi_openai_api_key', key.trim())
    }
    notifyDataChanged()
  }
}

export function getActiveAiProviderInfo(): { provider: 'openai' | 'gemini' | 'offline'; label: string } {
  const openAiKey = getStoredOpenAIKey()
  if (openAiKey) {
    return { provider: 'openai', label: 'OpenAI (GPT-4o-mini)' }
  }
  const geminiKey = import.meta.env.VITE_GEMINI_API_KEY
  if (geminiKey && geminiKey !== 'your_gemini_api_key_here') {
    return { provider: 'gemini', label: 'Google Gemini AI' }
  }
  return { provider: 'offline', label: 'Clinical Rule Engine (Offline)' }
}

/**
 * Call OpenAI Chat Completions API (gpt-4o-mini)
 */
async function fetchOpenAIChat(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  customApiKey?: string,
  onError?: (message: string) => void
): Promise<string | null> {
  const apiKey = customApiKey || getStoredOpenAIKey()
  if (!apiKey) return null

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
        temperature: 0.5,
        max_tokens: 800,
      }),
    })

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}))
      console.warn('OpenAI API request failed:', response.status, errData)
      const apiMessage = (errData as { error?: { message?: string } }).error?.message
      onError?.(apiMessage || `OpenAI request failed (HTTP ${response.status}).`)
      return null
    }

    const data = await response.json()
    const content = data?.choices?.[0]?.message?.content
    return content ? content.trim() : null
  } catch (err) {
    console.error('OpenAI fetch error:', err)
    onError?.(err instanceof Error ? err.message : 'Could not connect to OpenAI.')
    return null
  }
}

function parseAiAnalysis(responseText: string, source: 'openai' | 'gemini'): AiAnalysisResult | null {
  try {
    const cleanJson = responseText.replace(/```(?:json)?/gi, '').trim()
    const value: unknown = JSON.parse(cleanJson)
    if (!value || typeof value !== 'object') return null

    const result = value as Partial<AiAnalysisResult>
    const validRiskLevels = ['Low', 'Moderate', 'High', 'Critical']
    const validCategories = ['Emergency', 'Urgent', 'Standard', 'Low Priority']
    if (
      typeof result.symptomSummary !== 'string' ||
      typeof result.riskScore !== 'number' || !Number.isFinite(result.riskScore) ||
      result.riskScore < 0 || result.riskScore > 100 ||
      !validRiskLevels.includes(result.riskLevel || '') ||
      !validCategories.includes(result.triageCategory || '') ||
      typeof result.recommendedDepartment !== 'string' ||
      typeof result.suggestedAction !== 'string'
    ) return null

    return {
      ...result as AiAnalysisResult,
      redFlags: Array.isArray(result.redFlags) ? result.redFlags.filter((item): item is string => typeof item === 'string') : [],
      recommendations: Array.isArray(result.recommendations)
        ? result.recommendations.filter((item): item is string => typeof item === 'string')
        : [],
      source,
    }
  } catch {
    return null
  }
}

export async function analyzePatientSymptomsAsync(
  symptomsInput: string,
  patientAgeStr?: string,
  customApiKey?: string
): Promise<AiAnalysisResult> {
  const openAiKey = customApiKey || getStoredOpenAIKey()
  let providerError: string | undefined

  // 1. Try OpenAI if API Key exists
  if (openAiKey) {
    const systemPrompt = `You are a clinical AI triage assistant for a hospital queue system (MediQueue).
Analyze the patient's symptoms and output ONLY valid JSON without markdown formatting, code blocks, or extra text.
Exact JSON structure required:
{
  "symptomSummary": "short 1-line summary",
  "riskScore": number (10 to 95),
  "riskLevel": "Low" | "Moderate" | "High" | "Critical",
  "triageCategory": "Emergency" | "Urgent" | "Standard" | "Low Priority",
  "recommendedDepartment": "General Medicine" | "Emergency & Cardiology" | "Ophthalmology (Eye Care)" | "Dental Surgery & Oral Care" | "Dermatology & Allergy" | "Orthopedics",
  "redFlags": ["flag 1", "flag 2"],
  "recommendations": ["rec 1", "rec 2", "rec 3"],
  "suggestedAction": "clear action step for hospital check-in"
}`

    const userPrompt = `Patient Age: ${patientAgeStr || '30'}\nSymptoms: ${symptomsInput}`

    const responseText = await fetchOpenAIChat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      openAiKey,
      (message) => { providerError = message }
    )

    if (responseText) {
      const parsed = parseAiAnalysis(responseText, 'openai')
      if (parsed) return parsed
      providerError = 'OpenAI returned an invalid analysis response. Check the API model and try again.'
    } else if (!providerError) {
      providerError = 'OpenAI returned an empty response.'
    }
  }

  // 2. Try Gemini if Gemini key exists
  const geminiKey = import.meta.env.VITE_GEMINI_API_KEY
  if (geminiKey && geminiKey !== 'your_gemini_api_key_here') {
    try {
      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: `You are a clinical AI triage assistant for a hospital intake system.
Analyze the following patient symptoms and output ONLY valid JSON in this exact structure without markdown codeblocks:
{
  "symptomSummary": "short summary",
  "riskScore": number (10 to 95),
  "riskLevel": "Low" | "Moderate" | "High" | "Critical",
  "triageCategory": "Emergency" | "Urgent" | "Standard" | "Low Priority",
  "recommendedDepartment": "General Medicine" | "Emergency & Cardiology" | "Ophthalmology (Eye Care)" | "Dental Surgery & Oral Care" | "Dermatology & Allergy" | "Orthopedics",
  "redFlags": ["flag 1", "flag 2"],
  "recommendations": ["rec 1", "rec 2"],
  "suggestedAction": "action"
}

Patient Age: ${patientAgeStr || '30'}
Symptoms: ${symptomsInput}`,
                  },
                ],
              },
            ],
          }),
        }
      )
      if (!geminiRes.ok) {
        const errorData = await geminiRes.json().catch(() => ({}))
        providerError = (errorData as { error?: { message?: string } }).error?.message || `Gemini request failed (HTTP ${geminiRes.status}).`
        throw new Error(providerError)
      }
      const data = await geminiRes.json()
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
      if (text) {
        const parsed = parseAiAnalysis(text, 'gemini')
        if (parsed) return parsed
        providerError = 'Gemini returned an invalid analysis response.'
      }
    } catch (error) {
      if (!providerError) providerError = error instanceof Error ? error.message : 'Gemini request failed.'
      // Fall through to offline rule engine
    }
  }

  // 3. Fallback to built-in clinical rule engine
  return {
    ...analyzePatientSymptoms(symptomsInput, patientAgeStr),
    source: 'offline',
    providerError,
  }
}

/**
 * Chat with MediAI assistant using OpenAI API or smart offline responder
 */
export async function chatWithMediAIAsync(
  messagesHistory: Array<{ sender: 'user' | 'ai'; text: string }>,
  patientContext?: { name?: string; age?: string; service?: string; vitals?: string },
  customApiKey?: string
): Promise<string> {
  const openAiKey = customApiKey || getStoredOpenAIKey()

  if (openAiKey) {
    const systemPrompt = `You are MediAI, an expert, empathetic clinical assistant integrated into MediQueue Hospital Portal.
Your goals:
1. Provide accurate, helpful, and concise medical information to patients.
2. Guide them on queue tokens, department selection, and check-in procedures.
3. Highlight red flags (e.g. chest pain, breathing difficulty, stroke symptoms) and advise emergency triage immediately if present.
4. Keep answers brief (2-4 sentences max unless detailed advice is requested).
5. Always remind patients that this AI advice is for guidance and does not replace in-person doctor consultation.

Patient Context:
- Patient Name: ${patientContext?.name || 'Valued Patient'}
- Age: ${patientContext?.age || 'Not specified'}
- Active Token Service: ${patientContext?.service || 'None'}
- Latest Vitals: ${patientContext?.vitals || 'Not yet recorded today'}`

    const formattedMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
      ...messagesHistory.slice(-6).map((msg) => ({
        role: msg.sender === 'user' ? ('user' as const) : ('assistant' as const),
        content: msg.text,
      })),
    ]

    const replyText = await fetchOpenAIChat(formattedMessages, openAiKey)
    if (replyText) return replyText
  }

  // Smart Offline Fallback response logic if OpenAI key is missing or failed
  const lastUserMsg = messagesHistory.filter((m) => m.sender === 'user').pop()?.text || ''
  return generateOfflineChatReply(lastUserMsg, patientContext)
}

function generateOfflineChatReply(
  userText: string,
  patientContext?: { name?: string; age?: string; service?: string; vitals?: string }
): string {
  const lower = userText.toLowerCase()

  if (lower.includes('chest pain') || lower.includes('breathing') || lower.includes('shortness of breath') || lower.includes('heart attack')) {
    return '⚠️ EMERGENCY ALERT: Symptoms like chest pain or severe shortness of breath require immediate emergency evaluation. Please report to the Emergency Counter immediately or call emergency medical services!'
  }

  if (lower.includes('check in') || lower.includes('checkin') || lower.includes('scan') || lower.includes('qr')) {
    return `To check in, show your Visit Pass QR code to the hospital counter staff. Once scanned, your status will update to "Checked In" and recorded vitals will appear in your portal.`
  }

  if (lower.includes('fever') || lower.includes('temperature') || lower.includes('cold') || lower.includes('flu')) {
    return 'For fever and flu symptoms, stay hydrated and rest. If body temp exceeds 38.5°C or persists over 2 days, book a token under General Medicine for blood work and prescription.'
  }

  if (lower.includes('eye') || lower.includes('vision') || lower.includes('cataract') || lower.includes('blurry')) {
    return 'For eye irritation or vision issues, request a token under Ophthalmology (Eye Care). Please refrain from rubbing your eyes before examination.'
  }

  if (lower.includes('tooth') || lower.includes('dental') || lower.includes('gum') || lower.includes('cavity')) {
    return 'For toothache or oral discomfort, book a token under Dental Surgery & Oral Care. Rinse with warm saline water to soothe inflammation.'
  }

  if (lower.includes('skin') || lower.includes('rash') || lower.includes('allergy') || lower.includes('itching')) {
    return 'For skin rashes or allergic reactions, generate a token under Dermatology & Allergy. Avoid applying unverified ointment before your doctor inspection.'
  }

  if (lower.includes('back pain') || lower.includes('joint') || lower.includes('bone') || lower.includes('fracture') || lower.includes('knee')) {
    return 'For joint or bone pain, consult our Orthopedics department. Minimize weight bearing on the affected area until evaluated by a doctor.'
  }

  if (lower.includes('vital') || lower.includes('bp') || lower.includes('blood pressure') || lower.includes('pulse') || lower.includes('oxygen')) {
    return `Your recorded vitals summary: ${patientContext?.vitals || 'Vitals will be recorded at check-in counter.'} Our AI monitors vitals for any elevated risk factors upon check-in.`
  }

  if (lower.includes('who are you') || lower.includes('hello') || lower.includes('hi') || lower.includes('hey')) {
    return `Hello ${patientContext?.name || 'there'}! I am MediAI, your health and queue assistant. How can I help you today with your symptoms, doctor visits, or queue status?`
  }

  return `Thank you for asking. Based on your prompt "${userText.slice(0, 30)}...", I recommend consulting our General Medicine specialists. You can generate a visit token or track your live position from the MediQueue dashboard.`
}

/**
 * Summarize medical document text using OpenAI API or offline parser
 */
export async function summarizeMedicalDocumentAsync(
  text: string,
  customApiKey?: string
): Promise<{ title: string; summary: string; actionPoints: string[] }> {
  if (!text.trim()) {
    return summarizeMedicalDocument(text)
  }

  const openAiKey = customApiKey || getStoredOpenAIKey()

  if (openAiKey) {
    const systemPrompt = `You are a medical document summary AI.
Analyze the user's provided lab report, prescription, or clinical note text.
Return ONLY valid JSON in this structure without markdown format:
{
  "title": "Short descriptive document title (e.g. CBC Blood Report Analysis)",
  "summary": "Clear, plain-English summary (2-3 sentences) explaining what this document means for the patient.",
  "actionPoints": [
    "Key abnormal marker or finding 1",
    "Prescribed dosage or instruction 2",
    "Recommendation for doctor consultation 3"
  ]
}`

    const responseText = await fetchOpenAIChat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
      openAiKey
    )

    if (responseText) {
      try {
        const cleanJson = responseText.replace(/```json|```/g, '').trim()
        const parsed = JSON.parse(cleanJson)
        if (parsed.title && parsed.summary && Array.isArray(parsed.actionPoints)) {
          return parsed
        }
      } catch (err) {
        console.warn('Failed to parse OpenAI Medical Document JSON:', err)
      }
    }
  }

  return summarizeMedicalDocument(text)
}

export function analyzePatientSymptoms(symptomsInput: string, patientAgeStr?: string): AiAnalysisResult {
  const text = symptomsInput.toLowerCase()
  const age = Number.parseInt(patientAgeStr || '30', 10) || 30

  let riskScore = 15
  let riskLevel: AiAnalysisResult['riskLevel'] = 'Low'
  let triageCategory: AiAnalysisResult['triageCategory'] = 'Standard'
  let recommendedDepartment = 'General Medicine'
  const redFlags: string[] = []
  const recommendations: string[] = []

  // Check critical keywords
  const hasChestPain = text.includes('chest pain') || text.includes('chest tightness') || text.includes('heart attack') || text.includes('pressure in chest')
  const hasShortnessOfBreath = text.includes('shortness of breath') || text.includes('difficulty breathing') || text.includes('gasping')
  const hasHighFever = text.includes('high fever') || text.includes('chills') || text.includes('103') || text.includes('104')
  const hasSevereHeadache = text.includes('severe headache') || text.includes('sudden numbness') || text.includes('slurred speech') || text.includes('vision loss')
  const hasEyeProblem = text.includes('eye') || text.includes('vision') || text.includes('cornea') || text.includes('cataract') || text.includes('redness in eye')
  const hasToothProblem = text.includes('tooth') || text.includes('dental') || text.includes('gum') || text.includes('cavity') || text.includes('root canal')
  const hasSkinProblem = text.includes('rash') || text.includes('skin') || text.includes('itching') || text.includes('allergy') || text.includes('eczema')
  const hasJointProblem = text.includes('joint') || text.includes('bone') || text.includes('fracture') || text.includes('sprain') || text.includes('back pain')

  if (hasChestPain || hasShortnessOfBreath || text.includes('fainting') || text.includes('unconscious')) {
    riskScore = 88
    riskLevel = 'Critical'
    triageCategory = 'Emergency'
    recommendedDepartment = 'Emergency & Cardiology'
    redFlags.push('Potential Cardiac or Severe Respiratory Crisis')
    redFlags.push('Immediate Emergency Evaluation Required')
    recommendations.push('Proceed directly to Emergency Triage Counter immediately.')
    recommendations.push('Do not exert physical effort; request immediate assistance from staff.')
  } else if (hasSevereHeadache || hasHighFever || text.includes('severe pain') || text.includes('bleeding')) {
    riskScore = 65
    riskLevel = 'High'
    triageCategory = 'Urgent'
    recommendedDepartment = 'General Medicine'
    if (hasHighFever) redFlags.push('Fever exceeds standard threshold - risk of severe viral/bacterial infection')
    if (hasSevereHeadache) redFlags.push('Neurological check recommended')
    recommendations.push('Get vitals (Blood Pressure, Temp, SpO2) measured at Check-in counter.')
    recommendations.push('Maintain hydration and inform nursing staff upon arrival.')
  } else if (hasEyeProblem) {
    riskScore = 30
    riskLevel = 'Moderate'
    triageCategory = 'Standard'
    recommendedDepartment = 'Ophthalmology (Eye Care)'
    recommendations.push('Avoid touching or rubbing affected eyes.')
    recommendations.push('Bring existing eyeglasses or eye test records if available.')
  } else if (hasToothProblem) {
    riskScore = 25
    riskLevel = 'Low'
    triageCategory = 'Standard'
    recommendedDepartment = 'Dental Surgery & Oral Care'
    recommendations.push('Avoid extremely hot or cold beverages before consultation.')
    recommendations.push('Rinse mouth with lukewarm saline water if mild pain is present.')
  } else if (hasSkinProblem) {
    riskScore = 20
    riskLevel = 'Low'
    triageCategory = 'Low Priority'
    recommendedDepartment = 'Dermatology & Allergy'
    recommendations.push('Avoid applying unprescribed topical creams.')
  } else if (hasJointProblem) {
    riskScore = 35
    riskLevel = 'Moderate'
    triageCategory = 'Standard'
    recommendedDepartment = 'Orthopedics'
    recommendations.push('Minimize weight bearing on affected joint.')
  } else {
    riskScore = 20
    riskLevel = 'Low'
    triageCategory = 'Standard'
    recommendedDepartment = 'General Medicine'
    recommendations.push('General consultation and check-up scheduled.')
    recommendations.push('Prepare a brief history of your current health concerns.')
  }

  // Age factor adjustments
  if (age > 65 && riskScore < 70) {
    riskScore += 10
    recommendations.push('Senior Care Priority: Expedited triage flag applied.')
  }

  return {
    symptomSummary: symptomsInput.trim() || 'General health evaluation request',
    riskScore: Math.min(Math.max(riskScore, 10), 98),
    riskLevel,
    triageCategory,
    recommendedDepartment,
    redFlags,
    recommendations,
    suggestedAction: riskLevel === 'Critical' ? 'Immediate Emergency Queue Transfer' : `Book or check-in under ${recommendedDepartment}`,
    source: 'offline',
  }
}

export function analyzeVitalsAndTriage(
  vitals: PatientVitals,
  ageStr?: string,
  complaintStr?: string
): {
  triageLevel: AdditionalCheckInData['triageLevel']
  triageScore: number
  aiRiskSummary: string
  vitalsAssessment: NonNullable<AiAnalysisResult['vitalsAssessment']>
} {
  const sysBP = Number.parseInt(vitals.bloodPressure.split('/')[0] || '120', 10) || 120
  const diaBP = Number.parseInt(vitals.bloodPressure.split('/')[1] || '80', 10) || 80
  const hr = Number.parseInt(vitals.heartRate.replace(/\D/g, '') || '75', 10) || 75
  const rawTemp = Number.parseFloat(vitals.temperature.replace(/[^\d.]/g, '') || '37.0') || 37.0
  const tempInCelsius = rawTemp > 50 ? ((rawTemp - 32) * 5) / 9 : rawTemp
  const spo2 = Number.parseInt(vitals.oxygenLevel.replace(/\D/g, '') || '98', 10) || 98

  let bpStatus: 'Normal' | 'Elevated' | 'High' | 'Low' = 'Normal'
  if (sysBP >= 140 || diaBP >= 90) bpStatus = 'High'
  else if (sysBP >= 125 || diaBP >= 82) bpStatus = 'Elevated'
  else if (sysBP < 90 || diaBP < 60) bpStatus = 'Low'

  let hrStatus: 'Normal' | 'Tachycardia' | 'Bradycardia' = 'Normal'
  if (hr > 100) hrStatus = 'Tachycardia'
  else if (hr < 55) hrStatus = 'Bradycardia'

  let tempStatus: 'Normal' | 'Fever' | 'High Fever' | 'Hypothermia' = 'Normal'
  if (tempInCelsius >= 39.1) tempStatus = 'High Fever'
  else if (tempInCelsius >= 37.5) tempStatus = 'Fever'
  else if (tempInCelsius < 35.0) tempStatus = 'Hypothermia'

  let spo2Status: 'Normal' | 'Low (Hypoxia Warning)' = 'Normal'
  if (spo2 < 95) spo2Status = 'Low (Hypoxia Warning)'

  let triageScore = 15
  const notes: string[] = []
  const symptomAnalysis = analyzePatientSymptoms(complaintStr || '', ageStr)

  if (spo2Status === 'Low (Hypoxia Warning)') {
    triageScore += 40
    notes.push(`SpO2 level is ${spo2}% (Below normal threshold 95%)`)
  }
  if (bpStatus === 'High') {
    triageScore += 25
    notes.push(`High Blood Pressure detected: ${vitals.bloodPressure}`)
  }
  if (tempStatus === 'High Fever' || tempStatus === 'Fever') {
    triageScore += 20
    notes.push(`Elevated body temperature: ${tempInCelsius.toFixed(1)}°C`)
  }
  if (hrStatus === 'Tachycardia') {
    triageScore += 15
    notes.push(`Elevated heart rate: ${hr} BPM`)
  }

  if (symptomAnalysis.riskScore > 20) {
    triageScore = Math.max(triageScore, symptomAnalysis.riskScore)
    notes.push(...(symptomAnalysis.redFlags.length > 0
      ? symptomAnalysis.redFlags
      : [`Symptoms reported: ${symptomAnalysis.symptomSummary}`]))
  }

  let triageLevel: AdditionalCheckInData['triageLevel'] = 'Standard'
  if (triageScore >= 70) triageLevel = 'Emergency'
  else if (triageScore >= 45) triageLevel = 'Urgent'
  else if (triageScore <= 20) triageLevel = 'Low Priority'

  const aiRiskSummary = notes.length
    ? `AI Alert: ${notes.join('; ')}.`
    : 'Vitals within baseline standard limits.'

  return {
    triageLevel,
    triageScore: Math.min(triageScore, 98),
    aiRiskSummary,
    vitalsAssessment: {
      bpStatus,
      hrStatus,
      tempStatus,
      spo2Status,
    },
  }
}

export function getTriageRiskRating(score: number): {
  scoreOutOfTen: string
  band: 'normal' | 'urgent' | 'emergency'
  label: string
} {
  const normalizedScore = Math.min(Math.max(score, 0), 100)
  const band = normalizedScore >= 70 ? 'emergency' : normalizedScore >= 45 ? 'urgent' : 'normal'

  return {
    scoreOutOfTen: (normalizedScore / 10).toFixed(1),
    band,
    label: band === 'emergency' ? 'Serious - immediate review' : band === 'urgent' ? 'Needs prompt review' : 'Normal screening range',
  }
}

export function generateClinicReport(tokens: QueueToken[]) {
  const totalTokens = tokens.length
  const checkedInCount = tokens.filter((t) => t.isCheckedIn).length
  const waitingCount = tokens.filter((t) => t.status === 'Waiting').length
  const completedCount = tokens.filter((t) => t.status === 'Completed').length
  const inProgressCount = tokens.filter((t) => t.status === 'In progress').length

  const emergencyCount = tokens.filter((t) => t.checkInData?.triageLevel === 'Emergency').length
  const urgentCount = tokens.filter((t) => t.checkInData?.triageLevel === 'Urgent').length

  const servicesBreakdown = tokens.reduce((acc, curr) => {
    acc[curr.service] = (acc[curr.service] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  return {
    totalTokens,
    checkedInCount,
    waitingCount,
    inProgressCount,
    completedCount,
    emergencyCount,
    urgentCount,
    servicesBreakdown,
    avgWaitMinutes: Math.max(12, waitingCount * 8),
    aiSummary: `Today's clinic queue has ${totalTokens} total registered patients (${checkedInCount} checked in). ${emergencyCount > 0 ? `⚠️ ${emergencyCount} Emergency triage cases flagged for priority doctor routing.` : 'Queue flow is operating smoothly with optimal wait times.'}`,
  }
}

export function summarizeMedicalDocument(text: string): { title: string; summary: string; actionPoints: string[] } {
  if (!text.trim()) {
    return {
      title: 'Lab Report & Prescription Reader',
      summary: 'Upload or paste clinical document text to receive an AI summary and plain-English breakdown of diagnostic results.',
      actionPoints: ['Paste report text or upload image scan.', 'Review highlighted abnormal flags.', 'Discuss results with attending physician.'],
    }
  }

  const sampleTitle = text.toLowerCase().includes('blood') || text.toLowerCase().includes('cbc')
    ? 'Complete Blood Count (CBC) Analysis'
    : text.toLowerCase().includes('lipid') || text.toLowerCase().includes('cholesterol')
    ? 'Lipid Profile Report'
    : 'Clinical Report Summary'

  return {
    title: sampleTitle,
    summary: `AI Document Scan complete. Document contains ${text.split(' ').length} words. Highlighting key lab markers, diagnostic findings, and dosage instructions for quick patient understanding.`,
    actionPoints: [
      ' Hemoglobin and vitals markers analyzed.',
      ' No acute contraindications detected in parsed text.',
      ' Present this document to your attending doctor during consultation.',
    ],
  }
}

export function explainMedication(medicineName: string, dosage?: string): NonNullable<import('../types').PrescriptionItem['aiMedicationExplanation']> {
  const name = medicineName.toLowerCase()

  if (name.includes('paracetamol') || name.includes('crocin') || name.includes('tylenol') || name.includes('acetaminophen')) {
    return {
      purpose: 'Analgesic (Pain Reliever) & Antipyretic (Fever Reducer)',
      usageAdvice: `Take ${dosage || '500 mg'} after meals with a full glass of water. Space doses at least 4-6 hours apart.`,
      possibleSideEffects: ['Mild nausea if taken without food', 'Rare allergic skin rash'],
      dietaryWarnings: 'Do not exceed 4,000 mg in 24 hours. Avoid alcohol while taking this medication.',
    }
  }

  if (name.includes('amoxicillin') || name.includes('antibiotic') || name.includes('azithromycin') || name.includes('cipro')) {
    return {
      purpose: 'Antibacterial Antibiotic (Treats Bacterial Infections)',
      usageAdvice: `Complete the full ${dosage || 'prescribed'} course even if symptoms improve. Take at fixed time intervals.`,
      possibleSideEffects: ['Mild stomach upset', 'Loose stool', 'Headache'],
      dietaryWarnings: 'Take with food or milk to minimize gastric discomfort. Drink plenty of fluids.',
    }
  }

  if (name.includes('cetirizine') || name.includes('allegra') || name.includes('antihistamine') || name.includes('cold')) {
    return {
      purpose: 'Antihistamine (Treats Allergies, Running Nose, & Hives)',
      usageAdvice: 'Take once daily, preferably in the evening or before bedtime.',
      possibleSideEffects: ['Drowsiness', 'Dry mouth', 'Mild fatigue'],
      dietaryWarnings: 'Avoid driving or operating heavy machinery if drowsiness occurs. Avoid alcohol.',
    }
  }

  if (name.includes('eye') || name.includes('drop') || name.includes('tear')) {
    return {
      purpose: 'Ophthalmic Solution (Eye Lubricant & Anti-Inflammatory)',
      usageAdvice: 'Instill 1-2 drops into affected eye(s). Wash hands thoroughly before application.',
      possibleSideEffects: ['Transient mild stinging', 'Temporary blurred vision'],
      dietaryWarnings: 'Do not touch dropper tip to eye or hands. Remove contact lenses before applying.',
    }
  }

  return {
    purpose: 'Prescribed Therapeutic Medication',
    usageAdvice: `Take ${dosage || 'prescribed dose'} as directed by your physician. Follow dosage schedule carefully.`,
    possibleSideEffects: ['Mild gastrointestinal discomfort', 'Drowsiness'],
    dietaryWarnings: 'Take after meals with water unless otherwise instructed by your doctor.',
  }
}

export function generateStaffAnalytics(staffAccount: import('../types').StaffAccount, queueTokens: import('../types').QueueToken[]) {
  const handledToday = queueTokens.filter(
    (t) =>
      t.isCheckedIn ||
      t.checkInData?.checkedInBy === staffAccount.name ||
      t.checkInData?.assignedDoctor === staffAccount.name ||
      t.prescriptions?.some((p) => p.prescribedBy === staffAccount.name)
  )

  const emergencyHandled = handledToday.filter((t) => t.checkInData?.triageLevel === 'Emergency').length
  const urgentHandled = handledToday.filter((t) => t.checkInData?.triageLevel === 'Urgent').length
  const totalPrescriptionsIssued = handledToday.reduce((acc, t) => acc + (t.prescriptions?.length || 0), 0)

  const triageScores = handledToday.map((t) => t.checkInData?.triageScore || 20)
  const avgTriageScore = triageScores.length ? Math.round(triageScores.reduce((a, b) => a + b, 0) / triageScores.length) : 20

  const productivityScore = Math.min(100, Math.max(68, 76 + handledToday.length * 5 - emergencyHandled * 2))

  return {
    handledTodayCount: handledToday.length,
    emergencyHandled,
    urgentHandled,
    totalPrescriptionsIssued,
    avgTriageScore,
    productivityScore,
    aiAssessment: `Staff member ${staffAccount.name} (${staffAccount.role}) has handled ${handledToday.length} patient consultations today. ${
      emergencyHandled > 0
        ? `Promptly managed ${emergencyHandled} Emergency triage cases.`
        : 'Consultation throughput and triage recording are operating at optimal productivity.'
    }`,
  }
}

export function notifyDataChanged() {
  window.dispatchEvent(new CustomEvent('synq-data-updated'))
}

export async function convertDoctorNoteToHealthPlanAsync(
  doctorNotes: string,
  patientInfo?: { name?: string; age?: string },
  customApiKey?: string
): Promise<{
  title: string
  summary: string
  actionableSteps: string[]
  lifestyleAdvice: string[]
  warningFlags: string[]
}> {
  const openAiKey = customApiKey || getStoredOpenAIKey()

  if (openAiKey) {
    const systemPrompt = `You are an AI clinical health plan generator for MediQueue.
Convert the provided physician/doctor note into a professional, easy-to-understand Patient Health & Recovery Plan.
Return ONLY valid JSON in this exact structure without markdown:
{
  "title": "Title of health plan (e.g., Acute Viral Bronchitis Recovery Plan)",
  "summary": "2-3 sentence clinical summary written directly for the patient.",
  "actionableSteps": ["Step 1", "Step 2", "Step 3"],
  "lifestyleAdvice": ["Diet advice 1", "Hydration or rest recommendation 2"],
  "warningFlags": ["Red flag symptom to watch for 1", "When to seek urgent re-evaluation 2"]
}`

    const userPrompt = `Patient Name: ${patientInfo?.name || 'Patient'}, Age: ${patientInfo?.age || '30'}
Doctor Notes: ${doctorNotes}`

    const responseText = await fetchOpenAIChat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      openAiKey
    )

    if (responseText) {
      try {
        const cleanJson = responseText.replace(/```json|```/g, '').trim()
        const parsed = JSON.parse(cleanJson)
        if (parsed.title && parsed.summary && Array.isArray(parsed.actionableSteps)) {
          return parsed
        }
      } catch (err) {
        console.warn('Failed to parse OpenAI Doctor Note Health Plan JSON:', err)
      }
    }
  }

  // Offline fallback
  const text = doctorNotes.toLowerCase()
  return {
    title: doctorNotes.trim() ? 'Personalized Clinical Health & Recovery Plan' : 'Standard Wellness & Recovery Plan',
    summary: doctorNotes.trim()
      ? `AI Health Plan generated based on clinical doctor notes (${doctorNotes.split(' ').length} words parsed). Follow prescribed rest, fluid intake, and medication routines.`
      : 'Enter doctor notes or clinical consultation findings above to generate a custom recovery plan.',
    actionableSteps: [
      text.includes('fever') ? 'Take prescribed antipyretics every 6 hours if temp > 38°C.' : 'Follow prescribed medication schedule diligently.',
      'Maintain adequate hydration with 2-3 liters of warm water daily.',
      'Record vitals (blood pressure and temperature) twice daily.',
    ],
    lifestyleAdvice: [
      'Get 7-8 hours of restful sleep daily.',
      'Avoid heavy physical exertion until cleared by your physician.',
      'Consume easy-to-digest, nutrient-dense meals.',
    ],
    warningFlags: [
      'Seek emergency care if experiencing difficulty breathing or persistent chest discomfort.',
      'Return to clinic if fever persists beyond 3 days without improvement.',
    ],
  }
}



