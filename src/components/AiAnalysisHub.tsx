import { useState } from 'react'
import {
  Activity,
  AlertCircle,
  BarChart3,
  Brain,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  FileText,
  HeartPulse,
  Lightbulb,
  MessageSquare,
  Pill,
  ShieldAlert,
  Sparkles,
  Stethoscope,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react'
import type { AiAnalysisResult, PatientAccount, PatientVitals, QueueToken } from '../types'
import { formatTempCelsius } from '../types'
import {
  analyzePatientSymptomsAsync,
  chatWithMediAIAsync,
  summarizeMedicalDocumentAsync,
  explainMedication,
  convertDoctorNoteToHealthPlanAsync,
  analyzeVitalsAndTriage,
  generateClinicReport,
} from '../lib/aiService'

type AiAnalysisHubProps = {
  patientProfile?: PatientAccount
  lastVitals?: PatientVitals
  allTokens?: QueueToken[]
}

type AiSubTab =
  | 'symptom-triage'
  | 'health-plan'
  | 'lab-report'
  | 'medication-explainer'
  | 'vitals-assessor'
  | 'queue-predictor'
  | 'ai-chat'

export function AiAnalysisHub({ patientProfile, lastVitals, allTokens = [] }: AiAnalysisHubProps) {
  const [activeTab, setActiveTab] = useState<AiSubTab>('symptom-triage')

  // 1. Symptom Triage State
  const [symptomsInput, setSymptomsInput] = useState('')
  const [analysisResult, setAnalysisResult] = useState<AiAnalysisResult | null>(null)
  const [loadingAnalysis, setLoadingAnalysis] = useState(false)

  // 2. Doctor Notes to Health Plan State
  const [doctorNotesInput, setDoctorNotesInput] = useState('')
  const [healthPlanResult, setHealthPlanResult] = useState<Awaited<ReturnType<typeof convertDoctorNoteToHealthPlanAsync>> | null>(null)
  const [loadingHealthPlan, setLoadingHealthPlan] = useState(false)

  // 3. Document Summary State
  const [docText, setDocText] = useState('')
  const [docSummary, setDocSummary] = useState<Awaited<ReturnType<typeof summarizeMedicalDocumentAsync>> | null>(null)
  const [loadingDoc, setLoadingDoc] = useState(false)

  // 4. Medication Explainer State
  const [medQuery, setMedQuery] = useState('')
  const [medDosage, setMedDosage] = useState('')
  const [medExplanation, setMedExplanation] = useState<ReturnType<typeof explainMedication> | null>(null)

  // 5. Vitals Assessor State
  const [bpInput, setBpInput] = useState(lastVitals?.bloodPressure || '135/88')
  const [hrInput, setHrInput] = useState(lastVitals?.heartRate || '82 bpm')
  const [tempInput, setTempInput] = useState('98.6')
  const [tempUnit, setTempUnit] = useState<'°F' | '°C'>('°F')
  const [spo2Input, setSpo2Input] = useState(lastVitals?.oxygenLevel || '96 %')
  const [vitalsResult, setVitalsResult] = useState<ReturnType<typeof analyzeVitalsAndTriage> | null>(null)

  const handleTempUnitChange = (newUnit: '°F' | '°C') => {
    if (tempUnit === newUnit) return
    const num = Number.parseFloat(tempInput.replace(/[^\d.]/g, ''))
    let convertedVal = tempInput
    if (!Number.isNaN(num)) {
      if (newUnit === '°C') {
        convertedVal = (((num - 32) * 5) / 9).toFixed(1)
      } else {
        convertedVal = ((num * 9) / 5 + 32).toFixed(1)
      }
    }
    setTempInput(convertedVal)
    setTempUnit(newUnit)
  }

  // 6. Chat Assistant State
  const [chatMessages, setChatMessages] = useState<Array<{ sender: 'user' | 'ai'; text: string; time?: string }>>([
    {
      sender: 'ai',
      text: `Hello ${patientProfile?.name || 'Valued Patient'}! I am MediAI, your health analysis & queue assistant. How can I help you today with your symptoms, doctor visits, or queue status?`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ])
  const [userChatInput, setUserChatInput] = useState('')
  const [isChatThinking, setIsChatThinking] = useState(false)

  // Speech & Copy utilities
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const [isSpeaking, setIsSpeaking] = useState<number | null>(null)

  // Handlers
  const handleRunSymptomAnalysis = async (customSymptoms?: string) => {
    const inputToUse = customSymptoms || symptomsInput
    if (!inputToUse.trim()) return

    setLoadingAnalysis(true)
    try {
      const result = await analyzePatientSymptomsAsync(inputToUse, patientProfile?.age)
      setAnalysisResult(result)
    } catch (err) {
      console.error('Symptom analysis error:', err)
    } finally {
      setLoadingAnalysis(false)
    }
  }

  const handleGenerateHealthPlan = async () => {
    if (!doctorNotesInput.trim()) return
    setLoadingHealthPlan(true)
    try {
      const result = await convertDoctorNoteToHealthPlanAsync(doctorNotesInput, {
        name: patientProfile?.name,
        age: patientProfile?.age,
      })
      setHealthPlanResult(result)
    } catch (err) {
      console.error('Health plan error:', err)
    } finally {
      setLoadingHealthPlan(false)
    }
  }

  const handleAnalyzeDocument = async () => {
    if (!docText.trim()) return
    setLoadingDoc(true)
    try {
      const summary = await summarizeMedicalDocumentAsync(docText)
      setDocSummary(summary)
    } catch (err) {
      console.error('Document analysis error:', err)
    } finally {
      setLoadingDoc(false)
    }
  }

  const handleExplainMedicine = (nameToUse?: string) => {
    const term = nameToUse || medQuery
    if (!term.trim()) return
    const res = explainMedication(term, medDosage || 'Standard Dose')
    setMedExplanation(res)
  }

  const handleAnalyzeVitals = () => {
    const vObj: PatientVitals = {
      bloodPressure: bpInput,
      heartRate: hrInput,
      temperature: tempInput.includes('°') ? tempInput : `${tempInput} ${tempUnit}`,
      oxygenLevel: spo2Input,
    }
    const res = analyzeVitalsAndTriage(vObj, patientProfile?.age, symptomsInput)
    setVitalsResult(res)
  }

  const handleSendChatMessage = async (e?: React.FormEvent, presetQuestion?: string) => {
    if (e) e.preventDefault()
    const textToSend = presetQuestion || userChatInput
    if (!textToSend.trim() || isChatThinking) return

    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const updatedMessages = [...chatMessages, { sender: 'user' as const, text: textToSend.trim(), time: timeStr }]

    setChatMessages(updatedMessages)
    if (!presetQuestion) setUserChatInput('')
    setIsChatThinking(true)

    const vitalsStr = lastVitals
      ? `BP: ${lastVitals.bloodPressure}, HR: ${lastVitals.heartRate}, Temp: ${formatTempCelsius(lastVitals.temperature)}, SpO2: ${lastVitals.oxygenLevel}`
      : 'Vitals not yet recorded today'

    try {
      const aiReplyText = await chatWithMediAIAsync(updatedMessages, {
        name: patientProfile?.name,
        age: patientProfile?.age,
        vitals: vitalsStr,
      })

      const replyTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      setChatMessages((prev) => [...prev, { sender: 'ai', text: aiReplyText, time: replyTime }])
    } catch (err) {
      console.error('Chat error:', err)
      setChatMessages((prev) => [
        ...prev,
        {
          sender: 'ai',
          text: 'I am experiencing a temporary connection issue. For immediate medical emergency, please proceed directly to emergency triage.',
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ])
    } finally {
      setIsChatThinking(false)
    }
  }

  const speakText = (text: string, index: number) => {
    if ('speechSynthesis' in window) {
      if (isSpeaking === index) {
        window.speechSynthesis.cancel()
        setIsSpeaking(null)
        return
      }
      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.rate = 1.0
      utterance.onend = () => setIsSpeaking(null)
      utterance.onerror = () => setIsSpeaking(null)
      setIsSpeaking(index)
      window.speechSynthesis.speak(utterance)
    }
  }

  const copyText = (text: string, index: number) => {
    navigator.clipboard.writeText(text)
    setCopiedIndex(index)
    setTimeout(() => setCopiedIndex(null), 2000)
  }

  // Presets
  const PRESET_SYMPTOMS = [
    'High fever, chills, and severe headache',
    'Chest tightness and breathing difficulty',
    'Blurred vision after prolonged eye strain',
    'Severe tooth pain with swollen gum',
    'Red skin rash with severe itching',
    'Joint stiffness and lower back pain',
  ]

  const PRESET_DOCTOR_NOTES = [
    'Patient presents with acute fever (38.5°C) and productive cough. Lung sound shows mild wheezing. Advised rest and antipyretics for 5 days.',
    'Diagnosed with Mild Hypertension. BP: 142/90 mmHg. Prescribed low-salt diet, exercise, and follow-up in 2 weeks.',
    'Dental examination indicates acute pulpitis in molar #19. Prescribed Amoxicillin 500mg and analgesics prior to root canal procedure.',
  ]

  const PRESET_MEDS = ['Paracetamol 500mg', 'Amoxicillin 500mg', 'Cetirizine 10mg', 'Refresh Tears Eye Drops']

  const clinicAnalytics = generateClinicReport(allTokens)

  return (
    <div className="space-y-8 animate-reveal">
      {/* Top Banner */}
      <div className="relative overflow-hidden rounded-[2.5rem] bg-gradient-to-r from-[#0c6b7a] via-[#0b525e] to-[#0d3b48] p-8 text-white shadow-xl">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-3 max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3.5 py-1 text-xs font-bold text-[#8fe5dc] uppercase tracking-wider backdrop-blur-md">
              <Sparkles className="h-3.5 w-3.5" />
              Complete AI Hospital Analysis Suite
            </div>
            <h2 className="text-3xl font-black tracking-tight text-white sm:text-4xl">AI Health & Queue Intelligence Engine</h2>
            <p className="text-sm text-slate-200 leading-relaxed">
              All AI analysis tools used in modern hospital queue systems: Symptom Triage, Doctor Note-to-Health Plan Converter, Lab Report OCR Summarizer, Prescription Safety Explainer, Vitals Anomaly Predictor, and Queue Starvation Analytics.
            </p>

          </div>

          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-3xl bg-white/10 text-white shadow-inner backdrop-blur-md">
            <Brain className="h-10 w-10 text-[#8fe5dc] animate-pulse" />
          </div>
        </div>
      </div>

      {/* SUB-NAVIGATION TAB BAR */}
      <div className="flex overflow-x-auto gap-2 rounded-2xl bg-white p-2 border border-slate-200 shadow-sm scrollbar-none">
        {[
          { id: 'symptom-triage', label: 'AI Symptom Triage', icon: Stethoscope },
          { id: 'health-plan', label: 'Doctor Notes → Health Plan', icon: FileText },
          { id: 'lab-report', label: 'Lab Report Summarizer', icon: FileText },
          { id: 'medication-explainer', label: 'Prescription & Medicine AI', icon: Pill },
          { id: 'vitals-assessor', label: 'Vitals Anomaly Predictor', icon: HeartPulse },
          { id: 'queue-predictor', label: 'Queue & Throughput Predictor', icon: BarChart3 },
          { id: 'ai-chat', label: 'MediAI Voice Assistant', icon: MessageSquare },
        ].map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as AiSubTab)}
              className={`flex items-center gap-2 shrink-0 rounded-xl px-4 py-2.5 text-xs font-bold transition ${
                isActive
                  ? 'bg-[#0c6b7a] text-white shadow-md'
                  : 'bg-slate-50 text-slate-700 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Icon className={`h-4 w-4 ${isActive ? 'text-[#8fe5dc]' : 'text-slate-500'}`} />
              <span>{tab.label}</span>
            </button>
          )
        })}
      </div>

      {/* TAB CONTENTS */}

      {/* 1. AI SYMPTOM TRIAGE */}
      {activeTab === 'symptom-triage' && (
        <div className="space-y-6">
          <div className="space-y-6">
            <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-md">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0c6b7a]/10 text-[#0c6b7a]">
                  <Stethoscope className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900">AI Clinical Triage Engine</h3>
                  <p className="text-xs text-slate-500">Analyze symptoms, assign risk scores (10-95), and route to target department.</p>
                </div>
              </div>

              <div className="space-y-4">
                <textarea
                  rows={4}
                  value={symptomsInput}
                  onChange={(e) => setSymptomsInput(e.target.value)}
                  placeholder="e.g. High fever for 2 days, severe chest pain, shortness of breath, and fatigue..."
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm outline-none transition focus:border-[#0c6b7a] focus:bg-white"
                />

                <div>
                  <span className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Quick Symptom Presets</span>
                  <div className="flex flex-wrap gap-2">
                    {PRESET_SYMPTOMS.map((preset, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          setSymptomsInput(preset)
                          handleRunSymptomAnalysis(preset)
                        }}
                        className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-[#0c6b7a] hover:bg-[#eaf5f3] transition"
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  disabled={loadingAnalysis}
                  onClick={() => handleRunSymptomAnalysis()}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#0c6b7a] px-6 py-3.5 font-bold text-white shadow-md hover:bg-[#09525e] transition disabled:opacity-50"
                >
                  <Zap className={`h-4 w-4 text-[#8fe5dc] ${loadingAnalysis ? 'animate-spin' : ''}`} />
                  {loadingAnalysis ? 'Executing AI Clinical Triage...' : 'Run AI Symptom & Risk Triage'}
                </button>
              </div>
            </section>

            {analysisResult && (
              <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-md space-y-5 animate-reveal">
                <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Target Specialty</span>
                      <span className="rounded-md bg-teal-50 px-2 py-0.5 text-[0.65rem] font-bold text-teal-700 border border-teal-100">
                        {analysisResult.source === 'openai' ? 'OpenAI live' : analysisResult.source === 'gemini' ? 'Gemini live' : 'Offline rules'}
                      </span>
                    </div>
                    <h4 className="text-xl font-black text-slate-900 mt-1">{analysisResult.recommendedDepartment}</h4>
                  </div>
                  <div
                    className={`px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-wider ${
                      analysisResult.riskLevel === 'Critical'
                        ? 'bg-red-100 text-red-700 border border-red-200'
                        : analysisResult.riskLevel === 'High'
                          ? 'bg-amber-100 text-amber-800 border border-amber-200'
                          : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                    }`}
                  >
                    Category: {analysisResult.triageCategory}
                  </div>
                </div>

                {analysisResult.source === 'offline' && (
                  <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
                    <strong>Live AI was not used.</strong>{' '}
                    {analysisResult.providerError
                      ? `Provider error: ${analysisResult.providerError} `
                      : 'No usable provider key is configured. '}
                    Showing the built-in rule-based estimate instead.
                  </div>
                )}

                <div className="rounded-xl bg-slate-50 p-3 border border-slate-100 text-xs text-slate-700 font-medium flex items-center justify-between">
                  <span><strong>AI Summary:</strong> {analysisResult.symptomSummary}</span>
                  <button
                    type="button"
                    onClick={() => speakText(analysisResult.symptomSummary, 999)}
                    className="p-1 rounded bg-white hover:bg-slate-200 text-[#0c6b7a]"
                    title="Read Aloud"
                  >
                    <Volume2 className="h-4 w-4" />
                  </button>
                </div>

                <div>
                  <div className="flex justify-between text-xs font-bold text-slate-700 mb-1">
                    <span>AI Urgency & Risk Score</span>
                    <span>{analysisResult.riskScore} / 100 ({analysisResult.riskLevel} Risk)</span>
                  </div>
                  <div className="h-3 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${
                        analysisResult.riskScore > 75
                          ? 'bg-red-500'
                          : analysisResult.riskScore > 40
                            ? 'bg-amber-500'
                            : 'bg-emerald-500'
                      }`}
                      style={{ width: `${analysisResult.riskScore}%` }}
                    />
                  </div>
                </div>

                {analysisResult.redFlags && analysisResult.redFlags.length > 0 && (
                  <div className="rounded-2xl border border-red-200 bg-red-50/60 p-4 space-y-2">
                    <div className="flex items-center gap-2 text-red-800 font-bold text-xs uppercase tracking-wider">
                      <AlertCircle className="h-4 w-4 text-red-600" />
                      Red Flag Clinical Warnings
                    </div>
                    <ul className="list-disc list-inside text-xs text-red-900 space-y-1 font-medium">
                      {analysisResult.redFlags.map((flag, i) => (
                        <li key={i}>{flag}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {analysisResult.recommendations && (
                  <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 space-y-2">
                    <div className="flex items-center gap-2 text-[#0c6b7a] font-bold text-xs uppercase tracking-wider">
                      <Lightbulb className="h-4 w-4" />
                      Recommended Actions & Precautionary Steps
                    </div>
                    <ul className="space-y-1.5 text-xs text-slate-700">
                      {analysisResult.recommendations.map((rec, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" />
                          <span>{rec}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            )}
          </div>

        </div>
      )}

      {/* 2. DOCTOR NOTES TO HEALTH PLAN */}
      {activeTab === 'health-plan' && (
        <div className="grid gap-8 lg:grid-cols-12">
          <div className="lg:col-span-7 space-y-6">
            <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-md space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700">
                  <FileText className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900">AI Doctor Note to Health Plan Generator</h3>
                  <p className="text-xs text-slate-500">Converts clinical doctor notes into a clear, actionable patient recovery plan.</p>
                </div>
              </div>

              <textarea
                rows={4}
                value={doctorNotesInput}
                onChange={(e) => setDoctorNotesInput(e.target.value)}
                placeholder="Paste physician notes, clinical observations, or discharge summary here..."
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs outline-none focus:border-indigo-600 focus:bg-white"
              />

              <div>
                <span className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Sample Doctor Notes</span>
                <div className="flex flex-col gap-2">
                  {PRESET_DOCTOR_NOTES.map((note, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setDoctorNotesInput(note)}
                      className="text-left rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-700 hover:border-indigo-500 hover:bg-indigo-50/50 transition"
                    >
                      {note}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                disabled={loadingHealthPlan}
                onClick={handleGenerateHealthPlan}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-6 py-3.5 font-bold text-white shadow-md hover:bg-indigo-700 transition disabled:opacity-50 text-xs"
              >
                <Sparkles className={`h-4 w-4 ${loadingHealthPlan ? 'animate-spin' : ''}`} />
                {loadingHealthPlan ? 'Generating Patient Health Plan...' : 'Convert Doctor Notes to AI Health Plan'}
              </button>
            </section>

            {healthPlanResult && (
              <section className="rounded-[2rem] border border-indigo-200 bg-gradient-to-b from-indigo-50/40 to-white p-6 shadow-md space-y-4 animate-reveal">
                <div className="flex items-center justify-between border-b border-indigo-100 pb-3">
                  <h4 className="text-lg font-black text-indigo-950">{healthPlanResult.title}</h4>
                  <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-bold text-indigo-800">AI Health Plan</span>
                </div>
                <p className="text-xs text-slate-700 leading-relaxed font-medium">{healthPlanResult.summary}</p>

                <div className="space-y-3 pt-2">
                  <div className="rounded-xl bg-white p-4 border border-indigo-100 space-y-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-indigo-900 flex items-center gap-1.5">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      Actionable Recovery Steps
                    </span>
                    <ul className="space-y-1 text-xs text-slate-700">
                      {healthPlanResult.actionableSteps.map((step, i) => (
                        <li key={i}>• {step}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="rounded-xl bg-white p-4 border border-indigo-100 space-y-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-indigo-900 flex items-center gap-1.5">
                      <Lightbulb className="h-4 w-4 text-amber-600" />
                      Diet & Lifestyle Guidance
                    </span>
                    <ul className="space-y-1 text-xs text-slate-700">
                      {healthPlanResult.lifestyleAdvice.map((adv, i) => (
                        <li key={i}>• {adv}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="rounded-xl bg-red-50 p-4 border border-red-200 space-y-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-red-900 flex items-center gap-1.5">
                      <ShieldAlert className="h-4 w-4 text-red-600" />
                      Warning Signs & Re-evaluation Flags
                    </span>
                    <ul className="space-y-1 text-xs text-red-900">
                      {healthPlanResult.warningFlags.map((flag, i) => (
                        <li key={i}>⚠️ {flag}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </section>
            )}
          </div>

          <div className="lg:col-span-5 space-y-6">
            <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-md space-y-3">
              <h3 className="text-base font-black text-slate-900">Why Health Plan Summaries Matter</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Medical jargon in clinical notes often causes confusion for patients. The AI Doctor Note converter translates medical terminology into step-by-step instructions for medications, rest, dietary restrictions, and emergency red flags.
              </p>
            </section>
          </div>
        </div>
      )}

      {/* 3. LAB REPORT & OCR SUMMARIZER */}
      {activeTab === 'lab-report' && (
        <div className="grid gap-8 lg:grid-cols-12">
          <div className="lg:col-span-7 space-y-6">
            <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-md space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-100 text-purple-700">
                  <FileText className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900">AI Medical Report & OCR Reader</h3>
                  <p className="text-xs text-slate-500">Parse blood test results, radiology reports, or diagnostic text.</p>
                </div>
              </div>

              <textarea
                rows={4}
                value={docText}
                onChange={(e) => setDocText(e.target.value)}
                placeholder="Paste lab report contents (e.g. Hemoglobin: 10.2 g/dL, WBC: 11,500 /mcL, Fasting Glucose: 135 mg/dL)..."
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs outline-none focus:border-purple-600 focus:bg-white"
              />

              <button
                type="button"
                disabled={loadingDoc}
                onClick={handleAnalyzeDocument}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-purple-700 px-6 py-3.5 font-bold text-white shadow-md hover:bg-purple-800 transition disabled:opacity-50 text-xs"
              >
                <Zap className={`h-4 w-4 ${loadingDoc ? 'animate-spin' : ''}`} />
                {loadingDoc ? 'Analyzing Document with AI...' : 'Summarize Medical Report'}
              </button>
            </section>

            {docSummary && (
              <section className="rounded-[2rem] border border-purple-200 bg-purple-50/40 p-6 shadow-md space-y-4 animate-reveal">
                <h4 className="font-bold text-purple-900 text-base">{docSummary.title}</h4>
                <p className="text-xs text-slate-700 leading-relaxed font-medium">{docSummary.summary}</p>
                <div className="border-t border-purple-200 pt-3 space-y-2">
                  <span className="font-bold text-purple-900 text-xs">Highlighted Key Findings:</span>
                  {docSummary.actionPoints.map((pt, i) => (
                    <div key={i} className="text-xs text-slate-700">• {pt}</div>
                  ))}
                </div>
              </section>
            )}
          </div>

          <div className="lg:col-span-5 space-y-6">
            <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-md space-y-3">
              <h3 className="text-base font-black text-slate-900">Lab & Document Scanner Features</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Extracts clinical biomarkers, identifies elevated or abnormal flags, and presents plain-English summaries so patients understand their health state before seeing their doctor.
              </p>
            </section>
          </div>
        </div>
      )}

      {/* 4. MEDICATION & SIDE-EFFECT EXPLAINER */}
      {activeTab === 'medication-explainer' && (
        <div className="grid gap-8 lg:grid-cols-12">
          <div className="lg:col-span-7 space-y-6">
            <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-md space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                  <Pill className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900">AI Medication & Side-Effect Explainer</h3>
                  <p className="text-xs text-slate-500">Analyze prescribed drug purpose, dosage advice, and food/lifestyle warnings.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">Medicine Name</label>
                  <input
                    value={medQuery}
                    onChange={(e) => setMedQuery(e.target.value)}
                    placeholder="e.g. Paracetamol, Amoxicillin, Cetirizine..."
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs outline-none focus:border-emerald-600 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">Dosage (Optional)</label>
                  <input
                    value={medDosage}
                    onChange={(e) => setMedDosage(e.target.value)}
                    placeholder="e.g. 500 mg, 1-0-1 after food"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs outline-none focus:border-emerald-600 focus:bg-white"
                  />
                </div>
              </div>

              <div>
                <span className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Quick Select Medicines</span>
                <div className="flex flex-wrap gap-2">
                  {PRESET_MEDS.map((m, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        setMedQuery(m)
                        handleExplainMedicine(m)
                      }}
                      className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-emerald-600 hover:bg-emerald-50 transition"
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={() => handleExplainMedicine()}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-6 py-3.5 font-bold text-white shadow-md hover:bg-emerald-700 transition text-xs"
              >
                <Pill className="h-4 w-4" />
                Analyze Medication &amp; Side-Effects
              </button>
            </section>

            {medExplanation && (
              <section className="rounded-[2rem] border border-emerald-200 bg-emerald-50/40 p-6 shadow-md space-y-4 animate-reveal">
                <h4 className="font-black text-emerald-950 text-lg">{medQuery || 'Medication Analysis'}</h4>
                <div className="rounded-xl bg-white p-3 border border-emerald-100 text-xs">
                  <span className="font-bold text-emerald-900 block">Primary Therapeutic Purpose:</span>
                  <p className="text-slate-700 mt-0.5">{medExplanation.purpose}</p>
                </div>
                <div className="rounded-xl bg-white p-3 border border-emerald-100 text-xs">
                  <span className="font-bold text-emerald-900 block">Dosage &amp; Timing Advice:</span>
                  <p className="text-slate-700 mt-0.5">{medExplanation.usageAdvice}</p>
                </div>
                <div className="rounded-xl bg-white p-3 border border-emerald-100 text-xs">
                  <span className="font-bold text-amber-900 block">Possible Side Effects:</span>
                  <ul className="list-disc list-inside text-slate-700 mt-1">
                    {medExplanation.possibleSideEffects.map((se, i) => (
                      <li key={i}>{se}</li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-xl bg-amber-50 p-3 border border-amber-200 text-xs text-amber-900">
                  <span className="font-bold block">Dietary &amp; Safety Warnings:</span>
                  <p className="mt-0.5">{medExplanation.dietaryWarnings}</p>
                </div>
              </section>
            )}
          </div>

          <div className="lg:col-span-5 space-y-6">
            <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-md space-y-3">
              <h3 className="text-base font-black text-slate-900">Prescription Safety Engine</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Provides automated medication explanations, preventing accidental overdose, drug-food interactions, and improper timing.
              </p>
            </section>
          </div>
        </div>
      )}

      {/* 5. VITALS INTAKE ANOMALY ASSESSOR */}
      {activeTab === 'vitals-assessor' && (
        <div className="grid gap-8 lg:grid-cols-12">
          <div className="lg:col-span-7 space-y-6">
            <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-md space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-100 text-rose-600">
                  <HeartPulse className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900">AI Vitals Intake Anomaly Assessor</h3>
                  <p className="text-xs text-slate-500">Evaluates Blood Pressure, Pulse, Body Temp, and SpO2 for risk anomalies.</p>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Blood Pressure</label>
                  <input
                    value={bpInput}
                    onChange={(e) => setBpInput(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 p-2.5 outline-none font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Heart Rate</label>
                  <input
                    value={hrInput}
                    onChange={(e) => setHrInput(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 p-2.5 outline-none font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Body Temp ({tempUnit})</label>
                  <div className="flex gap-1 items-center">
                    <input
                      value={tempInput}
                      onChange={(e) => setTempInput(e.target.value)}
                      placeholder={tempUnit === '°F' ? '98.6' : '37.0'}
                      className="w-full rounded-xl border border-slate-200 p-2.5 outline-none font-bold min-w-0"
                    />
                    <div className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-0.5 text-xs font-bold shrink-0">
                      <button
                        type="button"
                        onClick={() => handleTempUnitChange('°F')}
                        className={`px-2 py-1 rounded-lg transition ${tempUnit === '°F' ? 'bg-[#0c6b7a] text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                      >
                        °F
                      </button>
                      <button
                        type="button"
                        onClick={() => handleTempUnitChange('°C')}
                        className={`px-2 py-1 rounded-lg transition ${tempUnit === '°C' ? 'bg-[#0c6b7a] text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                      >
                        °C
                      </button>
                    </div>
                  </div>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">SpO2 Oxygen</label>
                  <input
                    value={spo2Input}
                    onChange={(e) => setSpo2Input(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 p-2.5 outline-none font-bold"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={handleAnalyzeVitals}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-6 py-3.5 font-bold text-white shadow-md hover:bg-rose-700 transition text-xs"
              >
                <Activity className="h-4 w-4" />
                Analyze Vitals &amp; Detect Anomalies
              </button>
            </section>

            {vitalsResult && (
              <section className="rounded-[2rem] border border-rose-200 bg-rose-50/40 p-6 shadow-md space-y-4 animate-reveal">
                <div className="flex items-center justify-between">
                  <h4 className="font-extrabold text-slate-900 text-base">Vitals Risk Assessment</h4>
                  <span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-black text-rose-800 uppercase">
                    Level: {vitalsResult.triageLevel} ({vitalsResult.triageScore}/100)
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="p-3 bg-white rounded-xl border border-slate-200 text-center">
                    <span className="text-slate-400 font-semibold block text-[0.68rem]">BP Status</span>
                    <strong className="text-slate-900 text-xs">{vitalsResult.vitalsAssessment.bpStatus}</strong>
                  </div>
                  <div className="p-3 bg-white rounded-xl border border-slate-200 text-center">
                    <span className="text-slate-400 font-semibold block text-[0.68rem]">Heart Rate</span>
                    <strong className="text-slate-900 text-xs">{vitalsResult.vitalsAssessment.hrStatus}</strong>
                  </div>
                  <div className="p-3 bg-white rounded-xl border border-slate-200 text-center">
                    <span className="text-slate-400 font-semibold block text-[0.68rem]">Temperature</span>
                    <strong className="text-slate-900 text-xs block">{vitalsResult.vitalsAssessment.tempStatus}</strong>
                    <span className="text-[0.68rem] text-slate-500 font-semibold block mt-0.5">{formatTempCelsius(tempInput)}</span>
                  </div>
                  <div className="p-3 bg-white rounded-xl border border-slate-200 text-center">
                    <span className="text-slate-400 font-semibold block text-[0.68rem]">SpO2 Level</span>
                    <strong className="text-slate-900 text-xs">{vitalsResult.vitalsAssessment.spo2Status}</strong>
                  </div>
                </div>

                <div className="p-3 bg-white rounded-xl border border-rose-200 text-xs text-slate-800">
                  <strong>AI Risk Summary:</strong> {vitalsResult.aiRiskSummary}
                </div>
              </section>
            )}
          </div>

          <div className="lg:col-span-5 space-y-6">
            <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-md space-y-3">
              <h3 className="text-base font-black text-slate-900">Intake Vitals Monitoring</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Monitors vital signs for sudden physiological deterioration. Automatically flags hypertension, fever spikes, or hypoxia during check-in.
              </p>
            </section>
          </div>
        </div>
      )}

      {/* 6. QUEUE & THROUGHPUT PREDICTOR */}
      {activeTab === 'queue-predictor' && (
        <div className="grid gap-8 lg:grid-cols-12">
          <div className="lg:col-span-7 space-y-6">
            <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-md space-y-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-100 text-teal-700">
                  <BarChart3 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900">AI Queue Starvation & Throughput Predictor</h3>
                  <p className="text-xs text-slate-500">Real-time operational analysis of clinic wait times and queue starvation prevention.</p>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <span className="text-slate-400 font-semibold">Total Patients</span>
                  <div className="text-xl font-black text-slate-900 mt-1">{clinicAnalytics.totalTokens}</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <span className="text-slate-400 font-semibold">Checked In</span>
                  <div className="text-xl font-black text-slate-900 mt-1">{clinicAnalytics.checkedInCount}</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <span className="text-slate-400 font-semibold">Waiting</span>
                  <div className="text-xl font-black text-slate-900 mt-1">{clinicAnalytics.waitingCount}</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <span className="text-slate-400 font-semibold">Est. Wait</span>
                  <div className="text-xl font-black text-teal-700 mt-1">{clinicAnalytics.avgWaitMinutes} min</div>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-teal-50/70 border border-teal-200 space-y-2">
                <div className="flex items-center gap-2 text-teal-900 font-bold text-xs uppercase tracking-wider">
                  <Clock className="h-4 w-4 text-teal-700" />
                  Queue Starvation Prevention System
                </div>
                <p className="text-xs text-slate-700 leading-relaxed">
                  Dynamic priority engine adds a time-weighted priority boost (+5 points every 10 minutes of waiting) to prevent lower urgency patients from starving in the queue.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-xs text-slate-700">
                <strong>Operational Summary:</strong> {clinicAnalytics.aiSummary}
              </div>
            </section>
          </div>

          <div className="lg:col-span-5 space-y-6">
            <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-md space-y-3">
              <h3 className="text-base font-black text-slate-900">Throughput Optimization</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Calculates live doctor throughput speeds and department load distributions, giving hospital administrators actionable insights to balance staff allocations.
              </p>
            </section>
          </div>
        </div>
      )}

      {/* 7. MEDIAI VOICE ASSISTANT */}
      {activeTab === 'ai-chat' && (
        <div className="grid gap-8 lg:grid-cols-12">
          <div className="lg:col-span-12">
            <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-md flex flex-col h-[600px]">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0c6b7a] text-white">
                    <MessageSquare className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <h3 className="text-base font-black text-slate-900">MediAI Voice-Enabled Health Assistant</h3>
                      <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
                    </div>
                    <p className="text-xs text-slate-500">Ask any medical question or queue assistance query</p>
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto space-y-3 pr-2 text-xs">
                {chatMessages.map((msg, index) => (
                  <div key={index} className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}>
                    <div
                      className={`group relative max-w-[80%] rounded-2xl px-4 py-3 leading-relaxed shadow-sm ${
                        msg.sender === 'user'
                          ? 'bg-[#0c6b7a] text-white rounded-br-none'
                          : 'bg-slate-100 text-slate-800 rounded-bl-none font-medium border border-slate-200/60'
                      }`}
                    >
                      <div>{msg.text}</div>
                      <div className="mt-1 flex items-center justify-between gap-3 text-[0.65rem] opacity-70">
                        <span>{msg.time}</span>
                        {msg.sender === 'ai' && (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              title="Copy response"
                              onClick={() => copyText(msg.text, index)}
                              className="hover:text-[#0c6b7a] transition p-0.5"
                            >
                              {copiedIndex === index ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                            </button>
                            <button
                              type="button"
                              title="Read out loud"
                              onClick={() => speakText(msg.text, index)}
                              className="hover:text-[#0c6b7a] transition p-0.5"
                            >
                              {isSpeaking === index ? <VolumeX className="h-3 w-3 text-rose-600" /> : <Volume2 className="h-3 w-3" />}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}

                {isChatThinking && (
                  <div className="flex justify-start">
                    <div className="rounded-2xl bg-slate-100 px-4 py-2.5 text-slate-500 text-xs rounded-bl-none inline-flex items-center gap-2">
                      <Sparkles className="h-3.5 w-3.5 text-[#0c6b7a] animate-spin" />
                      <span>MediAI is formulating an answer...</span>
                    </div>
                  </div>
                )}
              </div>

              <form onSubmit={handleSendChatMessage} className="mt-3 flex gap-2 border-t border-slate-100 pt-3">
                <input
                  value={userChatInput}
                  onChange={(e) => setUserChatInput(e.target.value)}
                  placeholder="Ask MediAI any question about your symptoms, medicines, or queue status..."
                  className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-xs outline-none focus:border-[#0c6b7a]"
                />
                <button
                  type="submit"
                  disabled={isChatThinking || !userChatInput.trim()}
                  className="rounded-xl bg-[#0c6b7a] px-6 py-3 text-xs font-bold text-white shadow-sm hover:bg-[#09525e] transition disabled:opacity-50"
                >
                  Send
                </button>
              </form>
            </section>
          </div>
        </div>
      )}
    </div>
  )
}
