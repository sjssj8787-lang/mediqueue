import { useEffect, useRef, useState } from 'react'
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BellRing,
  Brain,
  CalendarDays,
  CheckCircle2,
  Clock,
  Download,
  FileSpreadsheet,
  HeartPulse,
  History,
  LayoutDashboard,
  Lock,
  LogOut,
  Mic,
  MicOff,
  MessageSquareText,
  MoonStar,
  Pill,
  Play,
  Power,
  SunMedium,
  QrCode,
  RotateCcw,
  ShieldCheck,
  Trash2,
  User,
  UserRound,
  XCircle,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { Link, NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { isSupabaseConfigured, supabase } from './lib/supabase'

import type {
  AdditionalCheckInData,
  AppointmentRequest,
  ContactInquiry,
  CurrentUser,
  PatientAccount,
  PatientSection,
  QueueToken,
  StaffAccount,
} from './types'
import { formatTempCelsius } from './types'

import { AvatarPicker } from './components/AvatarPicker'
import { CheckInModal } from './components/CheckInModal'
import { AiAnalysisHub } from './components/AiAnalysisHub'
import { StaffDashboard } from './components/StaffDashboard'
import { useTheme } from './lib/theme'
import { generateClinicReport, notifyDataChanged } from './lib/aiService'
import { fetchContactInquiries, generateContactInquiryId } from './lib/contactInquiries'
import { formatLocalDate, localDateKey } from './lib/dateTime'
import { deleteStaffAccount, fetchStaffAccounts, getStaffAccountErrorMessage, mergeStaffAccounts, saveStaffAccount } from './lib/staffAccounts'

type DictationResult = {
  isFinal: boolean
  0: { transcript: string }
}

type DictationRecognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: { resultIndex: number; results: ArrayLike<DictationResult> }) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

type DictationRecognitionConstructor = new () => DictationRecognition

const defaultPatients: PatientAccount[] = [
  {
    id: 'p-1',
    name: 'Priya Mehta',
    email: 'priya@gmail.com',
    password: 'patient123',
    phone: '+91 98765 43210',
    age: '28',
    photo: '',
  },
  {
    id: 'p-2',
    name: 'Rahul Sharma',
    email: 'rahul@gmail.com',
    password: 'patient123',
    phone: '+91 98765 12345',
    age: '34',
    photo: '',
  },
]

const defaultStaff: StaffAccount[] = [
  { id: 's1', name: 'Dr. Kavita Rao', email: 'kavita@mediqueue.SK', password: 'staff123', role: 'Doctor' },
  { id: 's2', name: 'Nisha Verma', email: 'nisha@mediqueue.SK', password: 'staff123', role: 'Nurse' },
  { id: 's3', name: 'Dr. Ananya Singh', email: 'ananya@mediqueue.SK', password: 'staff123', role: 'Doctor' },
]

const demoInitialTokens: QueueToken[] = [
  {
    id: 't-101',
    token: 'A-001',
    patientId: 'p-1',
    patientName: 'Priya Mehta',
    email: 'priya@gmail.com',
    phone: '+91 98765 43210',
    age: '28',
    service: 'General Medicine',
    complaint: 'Seasonal fever and mild headache for 2 days',
    issuedAt: new Date(Date.now() - 3600000).toISOString(),
    status: 'Checked In',
    isCheckedIn: true,
    isExpired: true,
    checkedInAt: new Date(Date.now() - 1800000).toISOString(),
    checkInData: {
      checkedInAt: new Date(Date.now() - 1800000).toISOString(),
      vitals: {
        bloodPressure: '120/80',
        heartRate: '78 bpm',
        temperature: '37.3 °C',
        oxygenLevel: '98 %',
        bloodSugar: '105 mg/dL',
        weightKg: '62 kg',
      },
      triageLevel: 'Standard',
      triageScore: 25,
      aiRiskSummary: 'Vitals stable. Mild temperature elevation noted.',
      assignedDoctor: 'Dr. Kavita Rao',
      roomNumber: 'Room 101',
      chiefComplaint: 'Fever and body aches',
      notes: 'Patient advised to drink fluids.',
    },
  },
]

function readStoredList<T>(key: string): T[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(value) ? (value as T[]) : []
  } catch {
    return []
  }
}

function getStoredQueueTokensWithDailyReset(): QueueToken[] {
  const todayStr = formatLocalDate()
  const lastResetDate = localStorage.getItem('synq-last-reset-date')
  const isInitialized = localStorage.getItem('synq-queue-initialized')
  let tokens = readStoredList<QueueToken>('synq-queue')

  if (!isInitialized) {
    tokens = demoInitialTokens
    localStorage.setItem('synq-queue-initialized', 'true')
    localStorage.setItem('synq-queue', JSON.stringify(tokens))
  }

  if (lastResetDate !== todayStr) {
    // 12:00 AM Midnight Reset: Mark tokens issued before today as Expired so today starts fresh
    tokens = tokens.map((t) => {
      const tokenDate = localDateKey(t.issuedAt)
      if (tokenDate && tokenDate !== todayStr && t.status === 'Waiting') {
        return { ...t, status: 'Expired' as const, isExpired: true, expiredAt: `${tokenDate} 23:59:59` }
      }
      return t
    })
    localStorage.setItem('synq-last-reset-date', todayStr)
    localStorage.setItem('synq-queue', JSON.stringify(tokens))
  }

  return tokens
}

const isAuthCallback = new URLSearchParams(window.location.search).has('code')

function App() {
  const navigate = useNavigate()
  const [isSplashVisible, setIsSplashVisible] = useState(true)

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setIsSplashVisible(false), 1600)
    return () => window.clearTimeout(timeoutId)
  }, [])

  useEffect(() => {
    if (!isAuthCallback || !supabase) return

    const client = supabase
    let cancelled = false
    const completeSignIn = async () => {
      const {
        data: { session },
        error,
      } = await client.auth.getSession()
      if (cancelled) return
      if (error || !session) {
        navigate('/login', { replace: true })
        return
      }

      const metadata = session.user.user_metadata ?? {}
      const email = session.user.email ?? ''
      const { data: profile, error: profileError } = await client
        .from('profiles')
        .upsert(
          {
            id: session.user.id,
            name: metadata.name ?? email.split('@')[0],
            email,
            phone: metadata.phone ?? '',
            age: metadata.age ?? '',
            photo: metadata.photo ?? '',
            role: 'patient',
          },
          { onConflict: 'id' }
        )
        .select('id, name, email, phone, age, photo')
        .single()

      if (cancelled) return
      if (profileError || !profile) {
        alert('Your profile could not be loaded. Please sign in to continue.')
        navigate('/login', { replace: true })
        return
      }

      localStorage.setItem(
        'synq-current-user',
        JSON.stringify({
          role: 'patient',
          account: {
            ...profile,
            password: '',
            bloodPressure: metadata.bloodPressure ?? '',
            bodyTemperature: metadata.bodyTemperature ?? '',
            weightKg: metadata.weightKg ?? '',
            heartRate: metadata.heartRate ?? '',
            oxygenLevel: metadata.oxygenLevel ?? '',
            bloodSugar: metadata.bloodSugar ?? '',
          },
        })
      )
      navigate('/patient-dashboard', { replace: true })
    }

    void completeSignIn()
    return () => {
      cancelled = true
    }
  }, [navigate])

  if (isSplashVisible) {
    return (
      <main className="splash-screen" aria-label="Loading Queue Management System for Health Camp">
        <div className="splash-content" role="status" aria-live="polite" aria-busy="true">
          <div className="splash-logo" aria-hidden="true">
            <HeartPulse className="splash-logo-icon" />
          </div>
          <h1 className="splash-title">
            <span>Queue Management System</span>
            <span>For Health Camp</span>
          </h1>
          <div className="splash-progress" aria-hidden="true">
            <span />
          </div>
        </div>
      </main>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 antialiased">
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/security" element={<SecurityPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/patient-dashboard" element={<PatientDashboard />} />
        <Route path="/admin-dashboard" element={<AdminDashboard />} />
        <Route path="/staff-dashboard" element={<StaffPortalRoute />} />
      </Routes>
    </div>
  )
}

function StaffPortalRoute() {
  const navigate = useNavigate()
  const [queueTokens, setQueueTokens] = useState<QueueToken[]>(() => {
    return getStoredQueueTokensWithDailyReset()
  })
  const [appointments, setAppointments] = useState<AppointmentRequest[]>(() =>
    readStoredList<AppointmentRequest>('synq-appointments')
  )
  const [campStatus, setCampStatus] = useState<string>(() => localStorage.getItem('synq-camp-status') ?? 'active')

  useEffect(() => {
    const syncStoredData = () => {
      setCampStatus(localStorage.getItem('synq-camp-status') ?? 'active')
      setAppointments(readStoredList<AppointmentRequest>('synq-appointments'))
    }
    window.addEventListener('storage', syncStoredData)
    window.addEventListener('synq-data-updated', syncStoredData)
    const interval = setInterval(syncStoredData, 1000)
    return () => {
      window.removeEventListener('storage', syncStoredData)
      window.removeEventListener('synq-data-updated', syncStoredData)
      clearInterval(interval)
    }
  }, [])

  const currentUser = JSON.parse(localStorage.getItem('synq-current-user') ?? 'null') as CurrentUser | null

  if (!currentUser || (currentUser.role !== 'staff' && currentUser.role !== 'admin')) {
    return <Navigate to="/login" replace />
  }

  // Block access if Health Camp is turned OFF by Admin
  if (campStatus === 'closed') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6 text-white text-center font-sans">
        <div className="max-w-md w-full bg-slate-950 p-8 rounded-[2.5rem] border border-red-500/30 space-y-5 shadow-2xl">
          <div className="h-16 w-16 bg-red-500/20 text-red-400 rounded-2xl flex items-center justify-center mx-auto border border-red-500/30">
            <Power className="h-8 w-8 animate-pulse" />
          </div>
          <div>
            <span className="rounded-full bg-red-500/20 px-3 py-1 text-xs font-black text-red-400 uppercase tracking-wider">
              CAMP TURNED OFF BY ADMIN
            </span>
            <h2 className="mt-3 text-2xl font-black text-white">Health Camp Operations Paused</h2>
            <p className="mt-2 text-xs text-slate-400 leading-relaxed">
              The Admin has turned off the health camp operations. All staff logins and portal processing are currently disabled until the camp is restarted.
            </p>
          </div>
          <button
            onClick={() => {
              localStorage.removeItem('synq-current-user')
              navigate('/', { replace: true })
            }}
            className="w-full rounded-xl bg-red-600 py-3 text-xs font-bold text-white shadow-md hover:bg-red-700 transition"
          >
            Logout &amp; Return to Home
          </button>
        </div>
      </div>
    )
  }

  const staffAccount = currentUser.account as StaffAccount

  const handleUpdateToken = (updatedToken: QueueToken) => {
    const updatedQueue = queueTokens.map((t) => (t.id === updatedToken.id ? updatedToken : t))
    setQueueTokens(updatedQueue)
    localStorage.setItem('synq-queue', JSON.stringify(updatedQueue))
  }

  const handleUpdateAppointment = (updatedAppointment: AppointmentRequest) => {
    const updatedAppointments = appointments.map((appointment) =>
      appointment.id === updatedAppointment.id ? updatedAppointment : appointment
    )
    setAppointments(updatedAppointments)
    localStorage.setItem('synq-appointments', JSON.stringify(updatedAppointments))
    notifyDataChanged()
  }

  const handleClearAppointments = () => {
    if (!window.confirm('Clear all appointment history for the current clinic portal?')) return

    setAppointments([])
    localStorage.setItem('synq-appointments', JSON.stringify([]))
    notifyDataChanged()
  }

  const handleLogout = () => {
    localStorage.removeItem('synq-current-user')
    navigate('/', { replace: true })
  }

  return (
    <StaffDashboard
      staffAccount={staffAccount}
      queueTokens={queueTokens}
      appointments={appointments}
      onUpdateToken={handleUpdateToken}
      onUpdateAppointment={handleUpdateAppointment}
      onClearAppointments={handleClearAppointments}
      onLogout={handleLogout}
    />
  )
}

function ThemeToggle({ inverted = false }: { inverted?: boolean }) {
  const { theme, toggleTheme } = useTheme()

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-[0.65rem] font-bold uppercase tracking-[0.12em] transition ${inverted
        ? 'border-white/15 bg-white/10 text-white backdrop-blur-sm hover:bg-white/15'
        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
        }`}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
    >
      {theme === 'dark' ? <SunMedium className="h-3.5 w-3.5" /> : <MoonStar className="h-3.5 w-3.5" />}
      {theme === 'dark' ? 'Light' : 'Dark'}
    </button>
  )
}

function Navbar({ dark = false }: { dark?: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 18)
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  const navLinks = [
    { to: '/', label: 'Home' },
    { to: '/about', label: 'About Us' },
    { to: '/contact', label: 'Contact Us' },
  ]

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-300 ${dark
        ? scrolled
          ? 'bg-[#071c2a]/90 shadow-[0_12px_35px_rgba(0,0,0,0.24)] backdrop-blur-xl'
          : 'bg-[#071c2a]'
        : scrolled
          ? 'bg-white/80 shadow-[0_12px_35px_rgba(15,23,42,0.06)] backdrop-blur-xl'
          : 'bg-transparent'
        }`}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <Link to="/" className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#174e59] text-[#8fe5dc] shadow-[0_10px_20px_rgba(23,78,89,0.35)]">
            <HeartPulse className="h-5 w-5" />
          </span>
          <span className="text-2xl font-black tracking-[-0.08em] text-white">MediQueue</span>
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {navLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                `text-sm font-bold uppercase tracking-[0.14em] transition-colors ${isActive ? 'text-[#8fe5dc]' : dark ? 'text-slate-300 hover:text-white' : 'text-slate-600 hover:text-slate-900'
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <ThemeToggle inverted />
          <Link
            to="/login"
            className="rounded-full border border-white/20 bg-white/10 px-5 py-2.5 text-xs font-bold uppercase tracking-[0.14em] text-white backdrop-blur-sm transition-all hover:bg-white/20"
          >
            Sign in
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setMenuOpen(!menuOpen)}
          className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-white md:hidden"
        >
          <span className="sr-only">Open menu</span>
          <span className="text-xl">☰</span>
        </button>
      </div>

      {menuOpen && (
        <div className="border-t border-white/10 bg-[#071c2a] px-4 py-6 md:hidden">
          <div className="flex flex-col gap-4">
            {navLinks.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  `text-sm font-bold uppercase tracking-[0.14em] transition-colors ${isActive ? 'text-[#8fe5dc]' : 'text-slate-300'
                  }`
                }
              >
                {link.label}
              </NavLink>
            ))}
            <div className="mt-2 flex flex-col gap-3">
              <Link
                to="/login"
                onClick={() => setMenuOpen(false)}
                className="rounded-full border border-white/20 bg-white/10 px-5 py-2.5 text-center text-xs font-bold uppercase tracking-[0.14em] text-white"
              >
                Sign in
              </Link>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}

function Footer({ dark = false }: { dark?: boolean }) {
  return (
    <footer
      className={`border-t ${dark ? 'border-white/10 bg-[#051520] text-slate-400' : 'border-slate-200 bg-[#f4faf8] text-slate-600'
        }`}
    >
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-3 lg:px-8">
        <div>
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#174e59] text-[#8fe5dc]">
              <HeartPulse className="h-5 w-5" />
            </span>
            <span className="text-2xl font-black tracking-[-0.08em] text-white">MediQueue</span>
          </div>
          <p className="mt-4 max-w-xs text-sm leading-6 text-slate-300">Smart Queues. Better Care.</p>
        </div>

        <div>
          <h3 className="text-sm font-bold uppercase tracking-[0.18em] text-slate-400">Navigation</h3>
          <ul className="mt-4 space-y-3 text-sm text-slate-300">
            <li>
              <Link to="/">Home</Link>
            </li>
            <li>
              <Link to="/about">About Us</Link>
            </li>
            <li>
              <Link to="/contact">Contact Us</Link>
            </li>
          </ul>
        </div>

        <div>
          <h3 className="text-sm font-bold uppercase tracking-[0.18em] text-slate-400">Legal</h3>
          <ul className="mt-4 space-y-3 text-sm text-slate-300">
            <li>
              <Link to="/privacy">Privacy Policy</Link>
            </li>
            <li>
              <Link to="/security">Security</Link>
            </li>
            <li>
              <Link to="/terms">Terms &amp; Conditions</Link>
            </li>
          </ul>
        </div>

        <div>
          <h3 className="text-sm font-bold uppercase tracking-[0.18em] text-slate-400">Portals</h3>
          <ul className="mt-4 space-y-3 text-sm text-slate-300">
            <li>
              <Link to="/login">Patient Portal</Link>
            </li>
            <li>
              <Link to="/login">Staff Portal</Link>
            </li>
            <li>
              <Link to="/login">Admin Operations</Link>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-white/10 bg-black/20 px-4 py-4">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-8 text-[0.7rem] font-black uppercase tracking-[0.18em] text-white sm:text-xs">
          <Link to="/privacy" className="transition hover:text-[#8fe5dc]">Privacy</Link>
          <Link to="/security" className="transition hover:text-[#8fe5dc]">Security</Link>
          <Link to="/terms" className="transition hover:text-[#8fe5dc]">Terms</Link>
        </div>
        <div className="mt-3 text-center text-[0.68rem] text-slate-400">
          © 2026 MediQueue. All rights reserved.
        </div>
      </div>
    </footer>
  )
}

function LegalPage({
  title,
  intro,
  lastUpdated,
  effectiveDate,
  reviewedBy,
  contactEmail,
  sections,
}: {
  title: string
  intro: string
  lastUpdated: string
  effectiveDate: string
  reviewedBy: string
  contactEmail: string
  sections: Array<{ heading: string; paragraphs: string[]; checklist?: string[] }>
}) {
  return (
    <>
      <Navbar dark />
      <main className="marketing-surface bg-[#071c2a] text-white">
        <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8 lg:py-16">
          <div className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-6 shadow-[0_20px_45px_rgba(0,0,0,0.2)] md:p-8">
            <div className="mb-6 flex flex-col gap-3 border-b border-white/10 pb-5">
              <div className="text-[0.7rem] font-bold uppercase tracking-[0.2em] text-[#8fe5dc]">MediQueue policy</div>
              <h1 className="text-4xl font-black tracking-[-0.07em] text-white sm:text-5xl">{title}</h1>
              <div className="flex flex-wrap items-center gap-4 text-sm text-slate-300">
                <span>Last updated: {lastUpdated}</span>
                <span>•</span>
                <a href={`mailto:${contactEmail}`} className="text-[#8fe5dc] underline-offset-4 hover:underline">
                  {contactEmail}
                </a>
              </div>
            </div>

            <div className="mb-6 grid gap-3 rounded-[1.25rem] border border-white/10 bg-[#0c2230] p-4 text-sm text-slate-200 sm:grid-cols-3">
              <div>
                <div className="text-[0.66rem] font-bold uppercase tracking-[0.16em] text-slate-400">Effective Date</div>
                <div className="mt-1 font-semibold text-white">{effectiveDate}</div>
              </div>
              <div>
                <div className="text-[0.66rem] font-bold uppercase tracking-[0.16em] text-slate-400">Reviewed By</div>
                <div className="mt-1 font-semibold text-white">{reviewedBy}</div>
              </div>
              <div>
                <div className="text-[0.66rem] font-bold uppercase tracking-[0.16em] text-slate-400">Document Status</div>
                <div className="mt-1 font-semibold text-[#8fe5dc]">Approved</div>
              </div>
            </div>

            <div className="mb-6 flex items-center justify-between gap-4 rounded-[1rem] border border-[#8fe5dc]/30 bg-[#8fe5dc]/5 px-4 py-3 text-sm text-slate-200">
              <div>
                <div className="text-[0.66rem] font-bold uppercase tracking-[0.16em] text-[#8fe5dc]">Document Stamp</div>
                <div className="font-semibold text-white">Confidential</div>
              </div>
              <div className="rounded-full border border-[#8fe5dc] px-3 py-1 text-[0.62rem] font-black uppercase tracking-[0.18em] text-[#8fe5dc]">
                MediQueue
              </div>
            </div>

            <p className="max-w-3xl text-lg leading-8 text-slate-300">{intro}</p>

            <div className="mt-8 rounded-[1.25rem] border border-[#8fe5dc]/30 bg-[#8fe5dc]/5 p-5 text-sm leading-7 text-slate-200">
              <div className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-[#8fe5dc]">Disclaimer</div>
              This document is intended to explain how MediQueue handles information and service access. It is not a substitute for legal advice or organizational policy requirements in your region.
            </div>

            <div className="mt-10 space-y-8">
              {sections.map((section) => (
                <section key={section.heading} className="border-t border-white/10 pt-8 first:border-t-0 first:pt-0">
                  <h2 className="text-2xl font-black tracking-[-0.06em] text-white">{section.heading}</h2>
                  <div className="mt-4 space-y-4 text-base leading-7 text-slate-300">
                    {section.paragraphs.map((paragraph) => (
                      <p key={paragraph}>{paragraph}</p>
                    ))}
                  </div>

                  {section.checklist && (
                    <ul className="mt-5 space-y-3">
                      {section.checklist.map((item) => (
                        <li key={item} className="flex items-start gap-3 text-base leading-7 text-slate-200">
                          <span className="mt-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#8fe5dc] bg-[#8fe5dc]/10 text-[0.6rem] font-black text-[#8fe5dc]">
                            ✓
                          </span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ))}
            </div>

          </div>
        </div>
      </main>
      <Footer dark />
    </>
  )
}

function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro="We respect patient trust and handle personal healthcare information with care, transparency, and strict confidentiality."
      lastUpdated="September 2026"
      effectiveDate="09-10-2026"
      reviewedBy="Data Protection Review Team"
      contactEmail="privacy@mediqueue.com"
      sections={[
        {
          heading: 'Information we collect',
          paragraphs: [
            'MediQueue may collect personal information such as patient names, phone numbers, age, email addresses, service requests, queue status, and related healthcare visit details needed to manage appointments and queue flow.',
            'We also store operational information related to staff activity, camp scheduling, and service updates to improve care coordination and communication.',
          ],
          checklist: [
            'Patient contact and identity information',
            'Queue and visit tracking data',
            'Operational details needed for service coordination',
          ],
        },
        {
          heading: 'How we use information',
          paragraphs: [
            'We use this information to register patients, manage queue updates, coordinate care, send service notifications, and support patient and staff administration.',
            'Information may also be used to maintain system integrity, investigate technical issues, and improve the quality of our healthcare services.',
          ],
          checklist: [
            'Check-in and queue management',
            'Care communication and updates',
            'System reliability and operational improvement',
          ],
        },
        {
          heading: 'Data protection',
          paragraphs: [
            'We store data securely in protected systems and limit access to authorized staff or administrators only. Sensitive medical and contact information is not shared publicly or sold to third parties.',
            'Where supported by technical controls, we use encryption, access restrictions, and system monitoring to reduce the risk of unauthorized access.',
          ],
          checklist: [
            'Restricted access by role',
            'Secure storage and technical safeguards',
            'Limited sharing to authorized service needs',
          ],
        },
        {
          heading: 'Your choices',
          paragraphs: [
            'You can review, update, or request information about the personal data associated with your account where applicable. If there are any concerns about accuracy or access, contact the admin or support team responsible for the service.',
            'By using MediQueue, you agree that information may be processed as described in this policy for safe and efficient queue management.',
          ],
          checklist: [
            'Request access to your stored information',
            'Update incorrect contact or profile details',
            'Ask for support if you have privacy concerns',
          ],
        },
      ]}
    />
  )
}

function SecurityPage() {
  return (
    <LegalPage
      title="Security Standards"
      intro="Security is a core part of MediQueue. We are committed to protecting patient, staff, and operational data from unauthorized access or misuse."
      lastUpdated="September 2026"
      effectiveDate="09-10-2026"
      reviewedBy="Information Security Team"
      contactEmail="security@mediqueue.com"
      sections={[
        {
          heading: 'Access controls',
          paragraphs: [
            'Access to staff and admin accounts is restricted by authenticated user roles. Only authorized users can view or update queue data, patient records, or operational settings.',
            'User roles are separated so patients, staff, and administrators can access only the information needed for their responsibilities.',
          ],
          checklist: [
            'Role-based permissions',
            'Authenticated staff and admin access only',
            'Clear separation of patient, staff, and admin views',
          ],
        },
        {
          heading: 'System safeguards',
          paragraphs: [
            'We use secure application practices, monitoring, permission-based access, and session checks to reduce the risk of misuse, leakage, or tampering.',
            'Operational actions such as queue changes, staff updates, and health-camp settings are tracked to help maintain accountability and safety.',
          ],
          checklist: [
            'Monitoring and activity review',
            'Security checks for access sessions',
            'Operational auditability for critical actions',
          ],
        },
        {
          heading: 'User responsibilities',
          paragraphs: [
            'Users should keep their login credentials confidential and avoid sharing access details with others. All staff and administrators should follow the organization’s security procedures while using the platform.',
            'If a security issue is suspected, the responsible team should be notified immediately so the issue can be assessed and resolved quickly.',
          ],
          checklist: [
            'Protect account credentials',
            'Follow internal security procedures',
            'Report suspicious access or data concerns',
          ],
        },
        {
          heading: 'Ongoing improvement',
          paragraphs: [
            'The platform is reviewed regularly to improve reliability, protect data, and maintain compliance with healthcare operational best practices.',
            'Security measures may change over time as new risks or technology requirements are identified.',
          ],
          checklist: [
            'Regular review of security controls',
            'Operational adjustments as risks evolve',
            'Best-practice monitoring and maintenance',
          ],
        },
      ]}
    />
  )
}

function TermsPage() {
  return (
    <LegalPage
      title="Terms & Conditions"
      intro="These terms govern the use of the MediQueue platform and all related patient, staff, and admin features."
      lastUpdated="September 2026"
      effectiveDate="09-10-2026"
      reviewedBy="Operations and Legal Review"
      contactEmail="support@mediqueue.com"
      sections={[
        {
          heading: 'Acceptance of terms',
          paragraphs: [
            'By accessing or using MediQueue, you agree to these terms and conditions. If you do not agree, you should not use the platform or related services.',
            'These terms may be updated from time to time to reflect service improvements, operational needs, or legal requirements.',
          ],
          checklist: [
            'Read and agree to the platform terms',
            'Use the service only for authorized operations',
            'Review updates to continued usage requirements',
          ],
        },
        {
          heading: 'Permitted use',
          paragraphs: [
            'MediQueue is intended for healthcare queue management, patient check-in, waiting-time communication, and administrative support during health camps and care settings.',
            'Users must use the platform lawfully and must not misuse, interfere with, or attempt to bypass system controls, queue logic, or access permissions.',
          ],
          checklist: [
            'Use for healthcare queue operations',
            'Follow role-based access and permissions',
            'Avoid bypassing system controls or platform rules',
          ],
        },
        {
          heading: 'Service responsibility',
          paragraphs: [
            'MediQueue provides tools to support queue flow and communication. The platform does not replace professional medical judgment or emergency decision-making.',
            'Clinic or camp administrators remain responsible for service delivery, patient safety, staffing, and compliance with local health regulations.',
          ],
          checklist: [
            'Healthcare providers remain responsible for care decisions',
            'Admins maintain service delivery standards',
            'Platform supports operations but does not replace clinical judgment',
          ],
        },
        {
          heading: 'Liability and limitations',
          paragraphs: [
            'The platform is provided on an as-is basis to support operational efficiency. While we aim to keep the service accurate and secure, errors, delays, or interruptions may occur due to technical or organizational factors beyond our control.',
            'MediQueue is not liable for indirect, incidental, or consequential damages arising from the use or inability to use the service, except where required by applicable law.',
          ],
          checklist: [
            'Service availability may vary by circumstances',
            'Operational issues may occur without notice',
            'Limitations apply as permitted by law',
          ],
        },
      ]}
    />
  )
}

function HomePage() {
  const features = [
    {
      title: 'Fast patient intake',
      text: 'Patients can check in quickly, update details, and join the right queue without confusion.',
      icon: '01',
    },
    {
      title: 'Live queue visibility',
      text: 'Staff and patients can see wait times, current status, and next steps in real time.',
      icon: '02',
    },
    {
      title: 'Calmer care flow',
      text: 'Reduce overcrowding and improve care coordination during busy health camps and clinics.',
      icon: '03',
    },
  ]

  return (
    <>
      <Navbar dark />

      <main className="marketing-surface bg-[#071c2a] text-white overflow-x-hidden">
        <section className="mx-auto max-w-7xl px-4 pb-10 pt-12 sm:px-6 lg:px-8 lg:pb-16 lg:pt-16">
          <div className="grid items-center gap-10 lg:grid-cols-[1.2fr_0.8fr]">
            <div>
              <span className="inline-flex items-center rounded-full border border-[#8fe5dc]/30 bg-[#8fe5dc]/10 px-4 py-2 text-[0.7rem] font-bold uppercase tracking-[0.18em] text-[#8fe5dc]">
                Health camp operations made simple
              </span>

              <h1 className="mt-8 text-[clamp(2.7rem,4vw,5.2rem)] font-black leading-[0.9] tracking-[-0.08em] text-white">
                <span className="block">Smart Queues.</span>
                <span className="block text-[#8fe5dc]">Better Care.</span>
              </h1>

              <p className="mt-7 max-w-xl text-lg leading-8 text-slate-300">
                MediQueue helps clinics and community health drives run smoother by keeping patients informed,
                staff organized, and queues moving efficiently.
              </p>

              <div className="mt-10 flex flex-wrap items-center gap-6 text-sm text-slate-300">
                <div>
                  <div className="text-2xl font-black tracking-[-0.06em] text-white">2.4k+</div>
                  <div className="mt-1 text-slate-400">Patients served</div>
                </div>
                <div>
                  <div className="text-2xl font-black tracking-[-0.06em] text-white">38%</div>
                  <div className="mt-1 text-slate-400">Less waiting time</div>
                </div>
                <div>
                  <div className="text-2xl font-black tracking-[-0.06em] text-white">24/7</div>
                  <div className="mt-1 text-slate-400">Queue updates</div>
                </div>
              </div>
            </div>

            <div className="relative animate-float">
              <div className="relative overflow-hidden rounded-[2rem] border border-white/15 bg-white/[0.08] p-4 shadow-[0_30px_65px_rgba(0,0,0,0.28)] backdrop-blur-sm">
                <div className="overflow-hidden rounded-[1.5rem] bg-gradient-to-br from-[#164653] via-[#0f3043] to-[#102936] p-4">
                  <img
                    src="https://images.unsplash.com/photo-1584515933487-779824d29309?auto=format&fit=crop&w=1200&q=80"
                    alt="Healthcare team and patient care"
                    className="h-[440px] w-full rounded-[1.3rem] object-cover"
                  />
                </div>
              </div>

              <div className="absolute -bottom-5 left-6 flex items-center gap-3 rounded-2xl border border-white/15 bg-[#123445]/95 px-4 py-3 shadow-[0_18px_35px_rgba(0,0,0,0.25)] backdrop-blur-sm">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#174e59] text-[#8fe5dc]">
                  <HeartPulse className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-[0.68rem] font-bold uppercase tracking-[0.14em] text-slate-400">Live status</div>
                  <div className="text-lg font-black tracking-[-0.04em] text-white">Queue running smoothly</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-12 sm:px-6 lg:px-8">
          <div className="mb-6 text-center">
            <div className="text-[0.7rem] font-bold uppercase tracking-[0.2em] text-[#8fe5dc]">Why people choose MediQueue</div>
            <h2 className="mt-2 text-[clamp(2rem,3vw,3.5rem)] font-black tracking-[-0.07em] text-white">Built for real healthcare flow</h2>
          </div>

          <div className="grid gap-5 md:grid-cols-3">
            {features.map((card) => (
              <div
                key={card.title}
                className="flex min-h-[190px] flex-col rounded-[1.75rem] border border-white/10 bg-white/[0.06] p-6 shadow-[0_14px_30px_rgba(0,0,0,0.14)] transition-transform duration-200 hover:-translate-y-1 hover:bg-white/[0.09]"
              >
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#174e59] text-[#8fe5dc] text-sm font-black">
                  {card.icon}
                </div>
                <h3 className="text-[1.8rem] font-black leading-tight tracking-[-0.06em] text-white">{card.title}</h3>
                <p className="mt-3 text-base leading-7 text-slate-300">{card.text}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <Footer dark />
    </>
  )
}

function AboutPage() {
  return (
    <>
      <Navbar dark />
      <main className="marketing-surface bg-[#071c2a] text-white">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="grid gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
            <div>
              <div className="text-[0.75rem] font-bold uppercase tracking-[0.18em] text-[#8fe5dc]">About us</div>
              <h1 className="mt-4 text-5xl font-black leading-[0.95] tracking-[-0.08em] text-white">Built for calmer, faster care</h1>
              <p className="mt-6 text-lg leading-8 text-slate-300">
                MediQueue was created to make health camps and patient intake processes smoother, clearer, and more human.
              </p>
              <p className="mt-5 text-lg leading-8 text-slate-300">
                We combine digital queue management with patient-friendly communication so clinics can serve more people with less confusion and stress.
              </p>
            </div>

            <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.08] p-3 shadow-[0_28px_55px_rgba(0,0,0,0.28)]">
              <img
                src="https://images.unsplash.com/photo-1584982751601-97dcc096659c?auto=format&fit=crop&w=1200&q=80"
                alt="Doctor speaking with a patient"
                className="h-[430px] w-full rounded-[1.4rem] object-cover"
              />
            </div>
          </div>

          <section className="mt-16">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <div className="text-[0.75rem] font-bold uppercase tracking-[0.18em] text-[#8fe5dc]">Health camp moments</div>
                <h2 className="mt-3 text-4xl font-black tracking-[-0.07em] text-white">Care in motion</h2>
              </div>
              <p className="max-w-md text-base leading-7 text-slate-300">
                From registration to consultation, every part of a health camp works better when the flow is clear.
              </p>
            </div>

            <div className="mt-8 grid gap-5 md:grid-cols-3">
              {[
                {
                  image: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?auto=format&fit=crop&w=900&q=80',
                  alt: 'Healthcare worker preparing a patient check-up',
                  label: 'Patient check-in',
                },
                {
                  image: 'https://images.unsplash.com/photo-1538108149393-fbbd81895907?auto=format&fit=crop&w=900&q=80',
                  alt: 'Modern clinic care environment',
                  label: 'Organized care spaces',
                },
                {
                  image: 'https://images.unsplash.com/photo-1579684385127-1ef15d508118?auto=format&fit=crop&w=900&q=80',
                  alt: 'Doctor consulting with a patient',
                  label: 'Human conversations',
                },
              ].map((moment) => (
                <figure
                  key={moment.label}
                  className="overflow-hidden rounded-[1.75rem] border border-white/10 bg-white/[0.06] shadow-[0_14px_30px_rgba(0,0,0,0.14)]"
                >
                  <img
                    src={moment.image}
                    alt={moment.alt}
                    className="h-56 w-full object-cover transition-transform duration-300 hover:scale-105"
                  />
                  <figcaption className="px-5 py-4 text-lg font-bold text-white">{moment.label}</figcaption>
                </figure>
              ))}
            </div>
          </section>

          <div className="mt-16 grid gap-6 md:grid-cols-3">
            {[
              { icon: ShieldCheck, title: 'Trust', text: 'Transparent queue updates build confidence for every patient.' },
              { icon: MessageSquareText, title: 'Clarity', text: 'Clear communication keeps people informed at every step.' },
              { icon: HeartPulse, title: 'Care', text: 'A calmer experience helps care teams deliver better service.' },
            ].map(({ icon: Icon, title, text }) => (
              <div
                key={title}
                className="rounded-[2rem] border border-white/10 bg-white/[0.06] p-6 shadow-[0_14px_30px_rgba(0,0,0,0.14)]"
              >
                <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#174e59] text-[#8fe5dc]">
                  <Icon className="h-7 w-7" />
                </div>
                <h3 className="text-2xl font-black tracking-[-0.06em] text-white">{title}</h3>
                <p className="mt-3 text-base leading-7 text-slate-300">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </main>
      <Footer dark />
    </>
  )
}

function ContactPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage('')

    const trimmedName = name.trim()
    const trimmedEmail = email.trim()
    const trimmedMsg = message.trim()

    if (!trimmedName || !trimmedEmail || !trimmedMsg) {
      setErrorMessage('Please fill in all required fields (Name, Email, and Message).')
      return
    }

    if (!trimmedEmail.includes('@')) {
      setErrorMessage('Please enter a valid email address.')
      return
    }

    setIsSubmitting(true)

    const inquiryId = generateContactInquiryId()
    const createdAt = new Date().toISOString()
    const newInquiry: ContactInquiry = {
      id: inquiryId,
      name: trimmedName,
      email: trimmedEmail,
      message: trimmedMsg,
      createdAt,
      status: 'Unread',
    }

    // 1. Store in LocalStorage
    try {
      const stored = readStoredList<ContactInquiry>('synq-contact-inquiries')
      const updated = [newInquiry, ...stored]
      localStorage.setItem('synq-contact-inquiries', JSON.stringify(updated))
      notifyDataChanged()
    } catch (err) {
      console.error('Error saving inquiry locally:', err)
    }

    // 2. Store in Supabase if configured
    if (isSupabaseConfigured && supabase) {
      try {
        const { error } = await supabase.from('contact_inquiries').insert([
          {
            id: inquiryId,
            name: trimmedName,
            email: trimmedEmail,
            message: trimmedMsg,
            status: 'Unread',
          },
        ])

        if (error) {
          throw error
        }
      } catch (err) {
        console.warn('Supabase contact inquiry insert failed:', err)
      }
    }

    setIsSubmitting(false)
    setSubmitted(true)
    setName('')
    setEmail('')
    setMessage('')
  }

  return (
    <>
      <Navbar dark />
      <main className="marketing-surface bg-[#071c2a] text-white">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="grid gap-10 lg:grid-cols-[1fr_1fr]">
            <div>
              <div className="text-[0.75rem] font-bold uppercase tracking-[0.18em] text-[#8fe5dc]">Contact us</div>
              <h1 className="mt-4 text-5xl font-black leading-[0.95] tracking-[-0.08em] text-white">
                We would love to hear from you
              </h1>
              <p className="mt-6 text-lg leading-8 text-slate-300">
                Whether you are planning a health camp, managing a clinic queue, or exploring a digital solution, we are here to help.
              </p>
            </div>

            <div className="rounded-[2rem] border border-white/10 bg-[#0d2c3b] p-6 shadow-[0_28px_55px_rgba(0,0,0,0.18)] sm:p-8">
              {submitted ? (
                <div className="space-y-6 text-center py-8">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
                    <CheckCircle2 className="h-10 w-10" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-extrabold text-white">Inquiry Received &amp; Saved!</h3>
                    <p className="mt-2 text-slate-300 text-sm leading-relaxed">
                      Thank you for contacting us. Your message has been stored successfully in our system. Our clinic management team will review it shortly.
                    </p>
                  </div>
                  <button
                    onClick={() => setSubmitted(false)}
                    className="inline-flex items-center gap-2 rounded-full bg-[#54d4c8] px-6 py-3 text-sm font-bold text-[#071c2a] transition hover:bg-[#76ece2]"
                  >
                    Send Another Message
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-5">
                  {errorMessage && (
                    <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs font-semibold text-red-300">
                      {errorMessage}
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-semibold text-slate-200">Full Name</label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-[#54d4c8] focus:bg-white/10"
                      placeholder="Your name"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-200">Email</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-[#54d4c8] focus:bg-white/10"
                      placeholder="you@example.com"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-200">Message</label>
                    <textarea
                      rows={5}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-[#54d4c8] focus:bg-white/10"
                      placeholder="Tell us about your healthcare queue requirement"
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex w-full items-center justify-center gap-2 rounded-full bg-[#0b3d52] px-6 py-4 text-base font-semibold text-white shadow-[0_16px_30px_rgba(11,61,82,0.3)] transition-transform hover:-translate-y-0.5 hover:bg-[#0d4b63] disabled:opacity-50"
                  >
                    {isSubmitting ? 'Saving inquiry...' : 'Send inquiry'}
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </main>
      <Footer dark />
    </>
  )
}

function LoginPage() {
  const [selectedRole, setSelectedRole] = useState<'patient' | 'staff' | 'admin'>('patient')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const navigate = useNavigate()

  const handleRoleChange = (role: 'patient' | 'staff' | 'admin') => {
    setSelectedRole(role)
    setErrorMessage('')
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setErrorMessage('')
    setIsSubmitting(true)

    const inputEmail = email.trim().toLowerCase()
    const inputPassword = password

    try {
      if (selectedRole === 'patient') {
        if (isSupabaseConfigured && supabase) {
          const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email: inputEmail, password: inputPassword })
          if (!authError && authData.user) {
            const metadata = authData.user.user_metadata ?? {}
            const profilePayload: PatientAccount = {
              id: authData.user.id,
              name: metadata.name ?? inputEmail.split('@')[0],
              email: authData.user.email ?? inputEmail,
              phone: metadata.phone ?? '',
              age: metadata.age ?? '',
              photo: metadata.photo ?? '',
            }
            localStorage.setItem('synq-current-user', JSON.stringify({ role: 'patient', account: profilePayload }))
            navigate('/patient-dashboard')
            return
          }
        }

        // Local patient database verification (defaultPatients seed + registered synq-patients)
        const storedPatients = readStoredList<PatientAccount>('synq-patients')
        const allPatients = [...defaultPatients, ...storedPatients]
        const match = allPatients.find((p) => {
          const pEmail = p.email.trim().toLowerCase()
          if (pEmail !== inputEmail) return false
          if (p.password && p.password !== inputPassword) return false
          return true
        })

        if (match) {
          localStorage.setItem('synq-current-user', JSON.stringify({ role: 'patient', account: match }))
          navigate('/patient-dashboard')
          return
        }

        setErrorMessage('Invalid Patient Credentials! No registered patient account found with this email and password in the database. Please check your credentials or register a profile.')
        return
      }

      if (selectedRole === 'staff') {
        const campStatus = localStorage.getItem('synq-camp-status') ?? 'active'
        if (campStatus === 'closed') {
          setErrorMessage('🚫 HEALTH CAMP IS TURNED OFF! Admin has closed camp operations. Staff login is disabled until the camp is restarted.')
          return
        }

        const staffMembers = readStoredList<StaffAccount>('synq-staff')
        const allStaff = [...defaultStaff, ...staffMembers]

        const inputUsername = inputEmail.split('@')[0]
        const match = allStaff.find((s) => {
          const sEmail = s.email.trim().toLowerCase()
          const sUsername = sEmail.split('@')[0]
          const isEmailMatch = sEmail === inputEmail || sUsername === inputUsername || sEmail === `${inputUsername}@mediqueue.sk`
          const isPasswordMatch = !s.password || s.password === inputPassword
          return isEmailMatch && isPasswordMatch
        })

        if (match) {
          localStorage.setItem('synq-current-user', JSON.stringify({ role: 'staff', account: match }))
          navigate('/staff-dashboard')
          return
        }

        setErrorMessage('Invalid Staff Credentials! No staff account found in the database with matching email/username and password.')
        return
      }

      if (selectedRole === 'admin') {
        if ((inputEmail === 'admin@sk.com' || inputEmail === 'admin') && inputPassword === 'admin123') {
          localStorage.setItem(
            'synq-current-user',
            JSON.stringify({ role: 'admin', account: { name: 'Chief Operations Admin', email: 'admin@sk.com' } })
          )
          navigate('/admin-dashboard')
          return
        }

        const staffMembers = readStoredList<StaffAccount>('synq-staff')
        const allStaff = [...defaultStaff, ...staffMembers]
        const inputUsername = inputEmail.split('@')[0]
        const match = allStaff.find(
          (s) =>
            (s.email.toLowerCase() === inputEmail || s.email.toLowerCase().split('@')[0] === inputUsername) &&
            s.password === inputPassword &&
            s.role === 'Admin'
        )

        if (match) {
          localStorage.setItem('synq-current-user', JSON.stringify({ role: 'admin', account: match }))
          navigate('/admin-dashboard')
          return
        }

        setErrorMessage('Invalid Admin Credentials! Only authorized administrator accounts in the database can log in.')
        return
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-12 flex items-center justify-center">
      <div className="w-full max-w-md overflow-hidden rounded-[2.5rem] border border-slate-200 bg-white p-8 shadow-2xl text-slate-900">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#0c6b7a] text-white">
              <HeartPulse className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-black">MediQueue Portal</h1>
              <p className="text-xs text-slate-400">Sign in to your account</p>
              <Link to="/" className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-[#0c6b7a] hover:text-[#09525e]">
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to Home
              </Link>
            </div>
          </div>
          <ThemeToggle />
        </div>

        <div className="mb-6 flex rounded-full border border-slate-200 bg-slate-50 p-1.5">
          {(['patient', 'staff', 'admin'] as const).map((role) => (
            <button
              key={role}
              type="button"
              onClick={() => handleRoleChange(role)}
              className={`flex-1 rounded-full py-2.5 text-xs font-bold uppercase tracking-wider transition ${selectedRole === role ? 'bg-[#0c6b7a] text-white shadow-md' : 'text-slate-600 hover:text-slate-900'
                }`}
            >
              {role === 'patient' ? 'Patient' : role === 'staff' ? 'Staff' : 'Admin'}
            </button>
          ))}
        </div>

        {errorMessage && (
          <div className="mb-4 rounded-xl border border-red-500/40 bg-red-950/60 p-3.5 text-xs font-semibold text-red-200 flex items-start gap-2 shadow-lg">
            <XCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <div>{errorMessage}</div>
          </div>
        )}

        {selectedRole === 'staff' && (localStorage.getItem('synq-camp-status') ?? 'active') === 'closed' && (
          <div className="mb-4 rounded-xl border border-red-500/30 bg-red-950/40 p-3.5 text-xs font-medium text-red-300 space-y-1">
            <div className="font-bold text-red-400 flex items-center gap-1.5">
              <Power className="h-4 w-4" />
              HEALTH CAMP IS TURNED OFF
            </div>
            <p>Admin has closed the camp. Staff login is currently disabled.</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
              {selectedRole === 'staff' ? 'Staff Email / Username (@mediqueue.SK)' : 'Email'}
            </label>
            <input
              type={selectedRole === 'staff' ? 'text' : 'email'}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                if (errorMessage) setErrorMessage('')
              }}
              placeholder={selectedRole === 'admin' ? 'admin@sk.com' : selectedRole === 'staff' ? 'staff@mediqueue.SK' : 'name@example.com'}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none focus:border-[#0c6b7a]"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                if (errorMessage) setErrorMessage('')
              }}
              placeholder="Enter password"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none focus:border-[#0c6b7a]"
              required
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-xl bg-[#0c6b7a] py-3.5 font-bold text-white shadow-md hover:bg-[#09525e] transition disabled:opacity-50"
          >
            {isSubmitting ? 'Verifying Credentials...' : `Sign In to ${selectedRole === 'patient' ? 'Patient Portal' : selectedRole === 'staff' ? 'Staff Portal' : 'Admin Operations'}`}
          </button>

          {selectedRole === 'patient' && (
            <p className="text-center text-xs text-slate-400 pt-2">
              Don&apos;t have a patient account?{' '}
              <Link to="/signup" className="font-bold text-[#8fe5dc]">
                Register profile
              </Link>
            </p>
          )}
        </form>


      </div>
    </div>
  )
}

function SignupPage() {
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    age: '',
    photo: '',
  })
  const navigate = useNavigate()

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    if (form.password.length < 6) {
      alert('Password must be at least 6 characters.')
      return
    }

    if (isSupabaseConfigured && supabase) {
      await supabase.auth.signUp({
        email: form.email,
        password: form.password,
        options: {
          data: {
            name: form.name,
            phone: form.phone,
            age: form.age,
            photo: form.photo,
          },
        },
      })
    }

    const nextPatient: PatientAccount = {
      id: `p-${Date.now()}`,
      name: form.name,
      email: form.email,
      phone: form.phone,
      password: form.password,
      age: form.age,
      photo: form.photo,
    }

    const storedPatients = readStoredList<PatientAccount>('synq-patients')
    localStorage.setItem('synq-patients', JSON.stringify([...storedPatients, nextPatient]))
    localStorage.setItem('synq-current-user', JSON.stringify({ role: 'patient', account: nextPatient }))
    navigate('/patient-dashboard')
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-12 flex items-center justify-center">
      <div className="w-full max-w-xl rounded-[2.5rem] border border-slate-200 bg-white p-8 shadow-2xl text-slate-900">
        <div className="mb-6 flex items-center justify-between gap-3 border-b border-slate-200 pb-4">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-[#0c6b7a]">New Patient Registration</span>
            <h1 className="text-2xl font-black">Create Patient Profile</h1>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link to="/login" className="text-xs font-semibold text-slate-600 hover:text-slate-900">
              Back to login
            </Link>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <AvatarPicker currentPhoto={form.photo} onPhotoChange={(photo) => setForm({ ...form, photo })} />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">Full Name</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Enter your full name"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-[#0c6b7a]"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">Age</label>
              <input
                type="number"
                value={form.age}
                onChange={(e) => setForm({ ...form, age: e.target.value })}
                placeholder="Enter age (e.g. 28)"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-[#0c6b7a]"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="name@example.com"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-[#0c6b7a]"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">Phone Number</label>
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="+91 98765 43210"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-[#0c6b7a]"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">Password</label>
            <input
              type="password"
              minLength={6}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="Create password (min 6 characters)"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-[#0c6b7a]"
              required
            />
          </div>

          <button
            type="submit"
            className="w-full rounded-xl bg-[#0c6b7a] py-3.5 font-bold text-white shadow-md hover:bg-[#09525e] transition mt-2"
          >
            Create Profile & Open Portal
          </button>
        </form>
      </div>
    </div>
  )
}

function PatientDashboard() {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(() => {
    const saved = localStorage.getItem('synq-current-user')
    if (!saved) return null
    try {
      return JSON.parse(saved) as CurrentUser
    } catch {
      return null
    }
  })

  const patient = currentUser?.role === 'patient' ? (currentUser.account as PatientAccount) : null
  const [section, setSection] = useState<PatientSection>('dashboard')
  const [queueTokens, setQueueTokens] = useState<QueueToken[]>(() => {
    return getStoredQueueTokensWithDailyReset()
  })
  const [appointments, setAppointments] = useState<AppointmentRequest[]>(() =>
    readStoredList<AppointmentRequest>('synq-appointments')
  )
  const [generatedToken, setGeneratedToken] = useState<QueueToken | null>(null)

  // Profile Draft state - patient contact details
  const [profileDraft, setProfileDraft] = useState({
    name: patient?.name ?? '',
    email: patient?.email ?? '',
    phone: patient?.phone ?? '',
    age: patient?.age ?? '',
    photo: patient?.photo ?? '',
  })
  const [prevPatient, setPrevPatient] = useState(patient)

  if (patient !== prevPatient) {
    setPrevPatient(patient)
    if (patient) {
      setProfileDraft({
        name: patient.name ?? '',
        email: patient.email ?? '',
        phone: patient.phone ?? '',
        age: patient.age ?? '',
        photo: patient.photo ?? '',
      })
    }
  }

  const [tokenService, setTokenService] = useState('General Medicine')
  const [complaint, setComplaint] = useState('')
  const [isRecordingComplaint, setIsRecordingComplaint] = useState(false)
  const [voiceInputMessage, setVoiceInputMessage] = useState('')
  const speechRecognitionRef = useRef<DictationRecognition | null>(null)
  const registeredDoctors = readStoredList<StaffAccount>('synq-staff').filter((staff) => staff.role === 'Doctor')
  const availableDoctors = registeredDoctors.length
    ? registeredDoctors
    : defaultStaff.filter((staff) => staff.role === 'Doctor')
  const [appointmentDraft, setAppointmentDraft] = useState({
    service: 'General Medicine',
    doctor: availableDoctors[0]?.name ?? '',
    date: formatLocalDate(),
    time: '09:00',
    reason: '',
    consultationMode: 'In-person' as 'In-person' | 'Video Call' | 'Phone Call',
    consentSigned: false,
  })

  const navigate = useNavigate()

  useEffect(() => {
    return () => {
      const recognition = speechRecognitionRef.current
      if (recognition) {
        recognition.onresult = null
        recognition.onerror = null
        recognition.onend = null
        recognition.stop()
        speechRecognitionRef.current = null
      }
    }
  }, [])

  const handleToggleComplaintDictation = () => {
    if (isRecordingComplaint) {
      speechRecognitionRef.current?.stop()
      return
    }

    const speechWindow = window as Window & {
      SpeechRecognition?: DictationRecognitionConstructor
      webkitSpeechRecognition?: DictationRecognitionConstructor
    }
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition

    if (!Recognition) {
      setVoiceInputMessage('Voice input is not supported in this browser. You can type your symptoms instead.')
      return
    }

    const recognition = new Recognition()
    let hasError = false
    recognition.lang = navigator.language || 'en-US'
    recognition.continuous = true
    recognition.interimResults = false
    recognition.onresult = (event) => {
      const phrases: string[] = []
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]
        if (result?.isFinal) phrases.push(result[0].transcript.trim())
      }

      const transcript = phrases.filter(Boolean).join(' ')
      if (!transcript) return
      setComplaint((current) => [current.trim(), transcript].filter(Boolean).join(' '))
      setVoiceInputMessage('Dictation added. Review your note before generating the QR pass.')
    }
    recognition.onerror = (event) => {
      hasError = true
      setIsRecordingComplaint(false)
      setVoiceInputMessage(
        event.error === 'not-allowed'
          ? 'Microphone access was denied. Allow microphone permission in your browser and try again.'
          : event.error === 'no-speech'
            ? 'No speech was detected. Try again or type your symptoms.'
            : 'Voice input stopped unexpectedly. You can type your symptoms instead.'
      )
    }
    recognition.onend = () => {
      if (speechRecognitionRef.current === recognition) {
        speechRecognitionRef.current = null
        setIsRecordingComplaint(false)
        if (!hasError) setVoiceInputMessage('Dictation stopped. Review your note before generating the QR pass.')
      }
    }

    speechRecognitionRef.current = recognition
    setVoiceInputMessage('Listening. Describe what is happening, then stop dictation to review your note.')
    try {
      recognition.start()
      setIsRecordingComplaint(true)
    } catch {
      speechRecognitionRef.current = null
      setIsRecordingComplaint(false)
      setVoiceInputMessage('Could not start voice input. Check microphone permission or type your symptoms.')
    }
  }

  const [nowTimestamp, setNowTimestamp] = useState(() => Date.now())

  useEffect(() => {
    const syncStoredData = () => {
      setQueueTokens(getStoredQueueTokensWithDailyReset())
      setAppointments(readStoredList<AppointmentRequest>('synq-appointments'))
      setNowTimestamp(Date.now())
    }
    window.addEventListener('storage', syncStoredData)
    window.addEventListener('synq-data-updated', syncStoredData)

    const interval = setInterval(syncStoredData, 1000)

    return () => {
      window.removeEventListener('storage', syncStoredData)
      window.removeEventListener('synq-data-updated', syncStoredData)
      clearInterval(interval)
    }
  }, [])

  const patientTokens = queueTokens
    .filter((entry) => patient && (entry.patientId === patient.id || entry.email === patient.email))
    .sort((first, second) => second.issuedAt.localeCompare(first.issuedAt))

  const patientAppointments = appointments
    .filter((entry) => patient && (entry.patientId === patient.id || entry.email === patient.email))
    .sort((first, second) => second.date.localeCompare(first.date))

  const todayStr = formatLocalDate()
  // Active Token is ONLY set if user generated a token in current session or has an active waiting token generated TODAY
  const activeToken =
    (generatedToken && patientTokens.find((entry) => entry.id === generatedToken.id)) ??
    patientTokens.find((entry) => localDateKey(entry.issuedAt) === todayStr && !entry.isExpired && entry.status === 'Waiting') ??
    null

  // Queue Wait Time Calculation
  const waitingForService = queueTokens.filter(
    (t) => activeToken && t.service === activeToken.service && t.status === 'Waiting' && !t.isCheckedIn
  )
  const positionInQueue = activeToken
    ? Math.max(0, waitingForService.findIndex((t) => t.id === activeToken.id))
    : 0
  const patientsAhead = positionInQueue
  const estWaitTotalMins = (patientsAhead + 1) * 10
  const elapsedMins = activeToken
    ? Math.floor((nowTimestamp - new Date(activeToken.issuedAt).getTime()) / 60000)
    : 0
  const minsRemaining = Math.max(1, estWaitTotalMins - elapsedMins)

  // Patient Vitals & History Summary
  const latestCheckInToken = patientTokens.find((t) =>
    Object.values(t.checkInData?.vitals ?? {}).some((value) => value?.trim())
  )
  const latestVitals = latestCheckInToken?.checkInData?.vitals
  const totalVisitsCount = patientTokens.filter((t) => t.isCheckedIn || t.status === 'Completed' || t.isExpired).length

  const qrCodeRef = useRef<SVGSVGElement>(null)

  const handleDownloadPass = () => {
    if (!patient || !activeToken || !qrCodeRef.current) return

    const namespace = 'http://www.w3.org/2000/svg'
    const pass = document.createElementNS(namespace, 'svg')
    pass.setAttribute('xmlns', namespace)
    pass.setAttribute('width', '340')
    pass.setAttribute('height', '400')
    pass.setAttribute('viewBox', '0 0 340 400')

    const background = document.createElementNS(namespace, 'rect')
    background.setAttribute('width', '340')
    background.setAttribute('height', '400')
    background.setAttribute('rx', '20')
    background.setAttribute('fill', '#ffffff')
    background.setAttribute('stroke', '#dfecef')
    pass.append(background)

    const addText = (value: string, x: string, y: string, size: string, weight: string, fill = '#16333d') => {
      const text = document.createElementNS(namespace, 'text')
      text.setAttribute('x', x)
      text.setAttribute('y', y)
      text.setAttribute('text-anchor', 'middle')
      text.setAttribute('font-family', 'Arial, sans-serif')
      text.setAttribute('font-size', size)
      text.setAttribute('font-weight', weight)
      text.setAttribute('fill', fill)
      text.textContent = value
      pass.append(text)
    }

    addText('MEDIQUEUE VISIT PASS', '170', '36', '14', '700', '#0c6b7a')
    addText(activeToken.token, '170', '82', '34', '900')
    addText(activeToken.service, '170', '108', '14', '600', '#64748b')
    addText(patient.name, '170', '375', '14', '700')

    const qr = qrCodeRef.current.cloneNode(true) as SVGSVGElement
    qr.setAttribute('x', '80')
    qr.setAttribute('y', '125')
    qr.setAttribute('width', '180')
    qr.setAttribute('height', '180')
    pass.append(qr)

    const file = new Blob([new XMLSerializer().serializeToString(pass)], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(file)
    const link = document.createElement('a')
    link.href = url
    link.download = `mediqueue-pass-${activeToken.token}.svg`
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const handleGenerateToken = (event: React.FormEvent) => {
    event.preventDefault()
    if (!patient) return

    const prefixes: Record<string, string> = {
      'Eye Check-up': 'B',
      'Dental Care': 'C',
      'Blood Test': 'D',
    }
    const prefix = prefixes[tokenService] ?? 'A'
    const nextNumber =
      queueTokens
        .filter((entry) => entry.token.startsWith(`${prefix}-`))
        .reduce((highest, entry) => Math.max(highest, Number(entry.token.split('-')[1]) || 0), 0) + 1

    const nextToken: QueueToken = {
      id: `t-${Date.now()}`,
      token: `${prefix}-${String(nextNumber).padStart(3, '0')}`,
      patientId: patient.id,
      patientName: patient.name,
      email: patient.email,
      phone: patient.phone,
      age: patient.age,
      photo: patient.photo,
      service: tokenService,
      complaint: complaint.trim(),
      issuedAt: new Date().toISOString(),
      status: 'Waiting',
      isCheckedIn: false,
      isExpired: false,
    }

    const updated = [nextToken, ...queueTokens]
    setQueueTokens(updated)
    setGeneratedToken(nextToken)
    localStorage.setItem('synq-queue', JSON.stringify(updated))
    notifyDataChanged()
    setComplaint('')
    setSection('dashboard')
  }

  const handleBookAppointment = (event: React.FormEvent) => {
    event.preventDefault()
    if (!patient) return

    if (!appointmentDraft.consentSigned) {
      alert('Please confirm the digital consent form before booking this consultation.')
      return
    }

    const request: AppointmentRequest = {
      id: `a-${Date.now()}`,
      patientId: patient.id,
      patientName: patient.name,
      email: patient.email,
      phone: patient.phone,
      service: appointmentDraft.service,
      doctor: appointmentDraft.doctor,
      date: appointmentDraft.date,
      time: appointmentDraft.time,
      reason: appointmentDraft.reason.trim(),
      createdAt: new Date().toISOString(),
      status: 'Requested',
      consultationMode: appointmentDraft.consultationMode,
      consentSigned: true,
      reminderChannel: appointmentDraft.consultationMode === 'Video Call' ? 'WhatsApp' : 'SMS',
    }
    const updated = [request, ...appointments]
    setAppointments(updated)
    localStorage.setItem('synq-appointments', JSON.stringify(updated))
    notifyDataChanged()
    alert(`Appointment requested for ${appointmentDraft.consultationMode.toLowerCase()} consultation with ${appointmentDraft.doctor}. A reminder will be sent via ${request.reminderChannel}.`)
    setAppointmentDraft({
      service: 'General Medicine',
      doctor: availableDoctors[0]?.name ?? '',
      date: formatLocalDate(),
      time: '09:00',
      reason: '',
      consultationMode: 'In-person',
      consentSigned: false,
    })
    setSection('history')
  }

  const handleDeleteAppointment = (appointmentId: string) => {
    if (!window.confirm('Delete this appointment from your history?')) return

    const updated = appointments.filter((entry) => entry.id !== appointmentId)
    setAppointments(updated)
    localStorage.setItem('synq-appointments', JSON.stringify(updated))
    notifyDataChanged()
    alert('Appointment history deleted successfully.')
  }

  // SAVE PROFILE
  const handleSaveProfile = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!patient || !currentUser) return

    const updatedPatient: PatientAccount = {
      ...patient,
      name: profileDraft.name.trim(),
      email: profileDraft.email.trim(),
      phone: profileDraft.phone.trim(),
      age: profileDraft.age.trim(),
      photo: profileDraft.photo,
    }

    if (supabase) {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (session?.user.id === patient.id) {
        await supabase
          .from('profiles')
          .update({
            name: profileDraft.name.trim(),
            email: profileDraft.email.trim(),
            phone: profileDraft.phone.trim(),
            age: profileDraft.age.trim(),
            photo: profileDraft.photo,
          })
          .eq('id', patient.id)

      }
    }

    const updatedUser = { ...currentUser, account: updatedPatient }
    setCurrentUser(updatedUser)
    localStorage.setItem('synq-current-user', JSON.stringify(updatedUser))

    // Update stored patients list
    const storedPatients = readStoredList<PatientAccount>('synq-patients')
    const updatedPatientsList = storedPatients.map((p) => (p.id === patient.id ? updatedPatient : p))
    localStorage.setItem('synq-patients', JSON.stringify(updatedPatientsList))

    // Update queue tokens for this patient to sync new name, email, phone, age, photo
    const storedTokens = readStoredList<QueueToken>('synq-queue')
    const updatedTokens = storedTokens.map((t) => {
      if (t.patientId === patient.id || t.email === patient.email) {
        return {
          ...t,
          patientName: updatedPatient.name,
          email: updatedPatient.email,
          phone: updatedPatient.phone,
          age: updatedPatient.age,
          photo: updatedPatient.photo,
        }
      }
      return t
    })
    localStorage.setItem('synq-queue', JSON.stringify(updatedTokens))
    setQueueTokens(updatedTokens)
    notifyDataChanged()

    alert('Patient Profile updated successfully!')
  }

  const sections = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'medications-vitals', label: 'My Medications & Vitals', icon: Pill },
    { id: 'profile', label: 'Profile Edit', icon: UserRound },
    { id: 'ai-analysis', label: 'AI Health Analysis', icon: Brain },
    { id: 'history', label: 'History', icon: History },
    { id: 'appointment', label: 'Book Appointment', icon: CalendarDays },
  ] as const

  if (!patient) return <Navigate to="/login" replace />

  return (
    <div className="min-h-screen bg-[#edf9f6] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        {/* Header with Photo Avatar */}
        <header className="mb-5 flex flex-col gap-4 rounded-[2.5rem] border border-[#dfecef] bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-full overflow-hidden border-2 border-[#0c6b7a] bg-slate-100 flex items-center justify-center shrink-0">
              {patient.photo ? (
                <img src={patient.photo} alt={patient.name} className="h-full w-full object-cover" />
              ) : (
                <User className="h-7 w-7 text-[#0c6b7a]" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xl font-black text-slate-900">{patient.name}</span>
                <span className="rounded-full bg-[#eafaf6] px-2.5 py-0.5 text-xs font-bold text-[#0c6b7a]">
                  Age {patient.age || 'N/A'}
                </span>
              </div>
              <div className="text-xs text-slate-500">{patient.email} · {patient.phone || 'No phone added'}</div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <ThemeToggle />
            <button
              onClick={() => setSection('profile')}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition"
            >
              <UserRound className="h-4 w-4 text-[#0c6b7a]" />
              Edit Profile
            </button>
            <button
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white hover:bg-slate-800 transition"
              onClick={() => {
                localStorage.removeItem('synq-current-user')
                navigate('/', { replace: true })
              }}
            >
              <LogOut className="h-4 w-4" />
              Logout
            </button>
          </div>
        </header>

        {/* Navigation Tabs */}
        <nav className="mb-6 flex gap-2 overflow-x-auto border-b border-[#d6e6e6] pb-3">
          {sections.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setSection(id)}
              className={`inline-flex shrink-0 items-center gap-2 rounded-2xl px-5 py-3 text-xs font-bold transition-all ${section === id
                ? 'bg-[#0c6b7a] text-white shadow-md'
                : 'bg-white text-slate-700 hover:bg-[#eaf5f3]'
                }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </nav>

        {/* MAIN BODY SECTIONS */}
        <main className="animate-reveal">
          {/* DASHBOARD OVERVIEW */}
          {section === 'dashboard' && (
            <div className="space-y-6">
              {/* PATIENT SUMMARY CARDS: TOTAL VISITS & CLINICAL VITALS */}
              <div className="rounded-[2.5rem] border border-[#dfecef] bg-white p-6 shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-[#0c6b7a]">Patient Health Snapshot</span>
                    <h2 className="text-xl font-black text-slate-900">Your Clinic Visits &amp; Recorded Vitals</h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-[#0c6b7a] px-3.5 py-1 text-xs font-black text-white shadow-sm">
                      🏥 Total Visited: {totalVisitsCount} {totalVisitsCount === 1 ? 'Time' : 'Times'}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  {/* BP */}
                  <article className="rounded-2xl border border-slate-100 bg-[#f7fcfa] p-4 text-center">
                    <div className="text-[0.7rem] font-bold uppercase tracking-wider text-slate-400">Blood Pressure</div>
                    <div className="mt-1 text-lg font-black text-[#0c6b7a]">
                      {latestVitals?.bloodPressure || 'Not recorded'}
                    </div>
                    <div className="text-[0.65rem] text-slate-400">mmHg</div>
                  </article>

                  {/* TEMP */}
                  <article className="rounded-2xl border border-slate-100 bg-[#f7fcfa] p-4 text-center">
                    <div className="text-[0.7rem] font-bold uppercase tracking-wider text-slate-400">Body Temp</div>
                    <div className="mt-1 text-lg font-black text-amber-600">
                      {latestVitals?.temperature ? formatTempCelsius(latestVitals.temperature) : 'Not recorded'}
                    </div>
                    <div className="text-[0.65rem] text-slate-400">Celsius (°C)</div>
                  </article>

                  {/* WEIGHT */}
                  <article className="rounded-2xl border border-slate-100 bg-[#f7fcfa] p-4 text-center">
                    <div className="text-[0.7rem] font-bold uppercase tracking-wider text-slate-400">Weight</div>
                    <div className="mt-1 text-lg font-black text-indigo-600">
                      {latestVitals?.weightKg || 'Not recorded'}
                    </div>
                    <div className="text-[0.65rem] text-slate-400">Kilograms</div>
                  </article>

                  {/* HEART RATE */}
                  <article className="rounded-2xl border border-slate-100 bg-[#f7fcfa] p-4 text-center">
                    <div className="text-[0.7rem] font-bold uppercase tracking-wider text-slate-400">Heart Rate</div>
                    <div className="mt-1 text-lg font-black text-rose-600">
                      {latestVitals?.heartRate || 'Not recorded'}
                    </div>
                    <div className="text-[0.65rem] text-slate-400">Beats / Min</div>
                  </article>

                  {/* SPO2 */}
                  <article className="rounded-2xl border border-slate-100 bg-[#f7fcfa] p-4 text-center">
                    <div className="text-[0.7rem] font-bold uppercase tracking-wider text-slate-400">SpO2 Oxygen</div>
                    <div className="mt-1 text-lg font-black text-emerald-600">
                      {latestVitals?.oxygenLevel || 'Not recorded'}
                    </div>
                    <div className="text-[0.65rem] text-slate-400">Oxygen Level</div>
                  </article>

                  {/* BLOOD SUGAR */}
                  <article className="rounded-2xl border border-slate-100 bg-[#f7fcfa] p-4 text-center">
                    <div className="text-[0.7rem] font-bold uppercase tracking-wider text-slate-400">Blood Sugar</div>
                    <div className="mt-1 text-lg font-black text-purple-600">
                      {latestVitals?.bloodSugar || 'Not recorded'}
                    </div>
                    <div className="text-[0.65rem] text-slate-400">mg/dL</div>
                  </article>
                </div>
              </div>

              {/* Visit Pass & Generate Token Form Grid */}
              <div className="grid gap-6 lg:grid-cols-12">
                {/* LEFT: ACTIVE VISIT PASS & QR CODE (7 cols) */}
                <section className="lg:col-span-7 rounded-[2.5rem] border border-[#dfecef] bg-white p-6 shadow-sm">
                  <div className="mb-5 flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold uppercase tracking-wider text-[#0c6b7a]">Current Visit Pass</span>
                      <h2 className="text-2xl font-black text-slate-900">Your Active Clinic Token</h2>
                    </div>
                    {activeToken && (
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-bold ${activeToken.isCheckedIn || activeToken.isExpired
                          ? 'bg-red-100 text-red-800 border border-red-200'
                          : 'bg-amber-100 text-amber-800 animate-pulse'
                          }`}
                      >
                        {activeToken.isCheckedIn || activeToken.isExpired
                          ? '🔴 EXPIRED / SCANNED'
                          : `⏳ ${activeToken.status}`}
                      </span>
                    )}
                  </div>

                  {activeToken ? (
                    <div className="grid gap-6 md:grid-cols-12 items-center">
                      <div className="md:col-span-7 space-y-3">
                        <div className="text-5xl font-black tracking-tight text-slate-900">{activeToken.token}</div>
                        <div className="text-lg font-bold text-slate-800">{activeToken.service}</div>
                        <div className="text-xs text-slate-500">
                          Issued {new Date(activeToken.issuedAt).toLocaleTimeString()} on {new Date(activeToken.issuedAt).toLocaleDateString()}
                        </div>

                        {/* ESTIMATED WAIT TIME & QUEUE POSITION COUNTER */}
                        {!activeToken.isCheckedIn && !activeToken.isExpired && (
                          <div className="rounded-2xl border border-[#0c6b7a]/30 bg-[#eafaf6] p-4 space-y-2 mt-3">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 text-[#0c6b7a] font-black text-xs uppercase tracking-wider">
                                <Clock className="h-4 w-4 animate-spin" />
                                Live Queue Estimate
                              </div>
                              <span className="rounded-full bg-[#0c6b7a] px-2.5 py-0.5 text-[0.7rem] font-bold text-white">
                                Position #{patientsAhead + 1}
                              </span>
                            </div>
                            <div className="text-2xl font-black text-slate-900">
                              ~{minsRemaining} Mins Left
                            </div>
                            <p className="text-xs text-slate-600 font-medium">
                              {patientsAhead === 0
                                ? '🎉 You are next in line! Please stay near the reception counter.'
                                : `⏱️ ${patientsAhead} ${patientsAhead === 1 ? 'patient' : 'patients'} ahead of you in the ${activeToken.service} queue.`}
                            </p>
                          </div>
                        )}

                        {/* DISPLAY CHECK-IN MESSAGE & EXPIRED PASS NOTICE */}
                        {(activeToken.isCheckedIn || activeToken.isExpired) && (
                          <div className="rounded-2xl border border-red-200 bg-red-50/80 p-4 space-y-2 mt-3">
                            <div className="flex items-center gap-2 text-red-900 font-bold text-xs uppercase tracking-wider">
                              <Lock className="h-4 w-4 text-red-600" />
                              QR Pass Expired &amp; Scanned
                            </div>
                            <p className="text-xs text-red-800 leading-relaxed font-medium">
                              This token ({activeToken.token}) was scanned at reception on{' '}
                              <strong>
                                {activeToken.checkedInAt
                                  ? new Date(activeToken.checkedInAt).toLocaleTimeString()
                                  : 'earlier today'}
                              </strong>
                              . Repeated scanning is disabled to prevent duplicate queue entries.
                            </p>
                            {activeToken.checkInData && (
                              <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                                <div className="bg-white p-2 rounded-lg border border-red-100">
                                  <span className="text-slate-400">Doctor:</span>
                                  <div className="font-bold text-slate-900">{activeToken.checkInData.assignedDoctor}</div>
                                </div>
                                <div className="bg-white p-2 rounded-lg border border-red-100">
                                  <span className="text-slate-400">Room:</span>
                                  <div className="font-bold text-slate-900">{activeToken.checkInData.roomNumber}</div>
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        <div className="flex flex-wrap gap-2 pt-2">
                          <button
                            onClick={handleDownloadPass}
                            className="inline-flex items-center gap-2 rounded-xl bg-[#0c6b7a] px-4 py-2.5 text-xs font-bold text-white shadow-md hover:bg-[#09525e] transition"
                          >
                            <Download className="h-4 w-4" />
                            Download Pass
                          </button>
                          {!activeToken.isCheckedIn && !activeToken.isExpired && activeToken.status === 'Waiting' && (
                            <button
                              onClick={() => {
                                if (window.confirm(`Are you sure you want to cancel visit token ${activeToken.token}?`)) {
                                  const updated = queueTokens.map((t) =>
                                    t.id === activeToken.id ? { ...t, status: 'Cancelled' as const, isExpired: true } : t
                                  )
                                  setQueueTokens(updated)
                                  localStorage.setItem('synq-queue', JSON.stringify(updated))
                                  setGeneratedToken(null)
                                  notifyDataChanged()
                                  alert(`Visit token ${activeToken.token} cancelled successfully.`)
                                }
                              }}
                              className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-bold text-red-700 hover:bg-red-100 transition"
                            >
                              <XCircle className="h-4 w-4 text-red-600" />
                              Cancel Token
                            </button>
                          )}
                        </div>
                      </div>

                      {/* QR CODE CONTAINER WITH EXPIRED OVERLAY */}
                      <div className="md:col-span-5 justify-self-center relative rounded-2xl border border-slate-100 bg-white p-4 shadow-inner">
                        <QRCodeSVG
                          ref={qrCodeRef}
                          value={JSON.stringify({
                            id: activeToken.id,
                            token: activeToken.token,
                            patientId: activeToken.patientId,
                            service: activeToken.service,
                          })}
                          size={140}
                          level="M"
                        />
                        {(activeToken.isCheckedIn || activeToken.isExpired) && (
                          <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-[2px] rounded-2xl flex flex-col items-center justify-center p-2 text-center text-white">
                            <Lock className="h-8 w-8 text-red-400 mb-1" />
                            <span className="text-xs font-black text-red-300 uppercase tracking-wider">EXPIRED</span>
                            <span className="text-[0.65rem] text-slate-300">Scan Complete</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-8 text-center space-y-3">
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#eafaf6] text-[#0c6b7a]">
                        <QrCode className="h-6 w-6" />
                      </div>
                      <div>
                        <h3 className="text-base font-bold text-slate-900">No Active Token Generated Today</h3>
                        <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto">
                          Select your requested department on the right and click <strong>&quot;Generate Pass Token&quot;</strong> to get your queue number and QR visit pass.
                        </p>
                      </div>
                    </div>
                  )}
                </section>

                {/* RIGHT: GENERATE VISIT TOKEN FORM (5 cols) */}
                <section className="lg:col-span-5 rounded-[2.5rem] border border-[#dfecef] bg-white p-6 shadow-sm space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0c6b7a] text-white">
                      <QrCode className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-lg font-black text-slate-900">Generate Visit Token</h3>
                      <p className="text-xs text-slate-500">Pick your requested clinic service department.</p>
                    </div>
                  </div>

                  <form onSubmit={handleGenerateToken} className="space-y-4">
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                      Requested Department / Service
                      <select
                        value={tokenService}
                        onChange={(e) => setTokenService(e.target.value)}
                        className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium outline-none focus:border-[#0c6b7a]"
                      >
                        <option>General Medicine</option>
                        <option>Eye Check-up</option>
                        <option>Dental Care</option>
                        <option>Blood Test</option>
                      </select>
                    </label>

                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                      Reason for Visit / Symptoms (Optional)
                      <textarea
                        rows={3}
                        value={complaint}
                        onChange={(e) => setComplaint(e.target.value)}
                        placeholder="Briefly state symptoms..."
                        className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs outline-none focus:border-[#0c6b7a]"
                      />
                    </label>

                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={handleToggleComplaintDictation}
                        aria-pressed={isRecordingComplaint}
                        className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold transition ${isRecordingComplaint
                            ? 'bg-red-100 text-red-800 hover:bg-red-200'
                            : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                          }`}
                      >
                        {isRecordingComplaint ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                        {isRecordingComplaint ? 'Stop dictation' : 'Dictate symptoms'}
                      </button>
                      {voiceInputMessage && (
                        <p role="status" aria-live="polite" className="text-xs text-slate-500">
                          {voiceInputMessage}
                        </p>
                      )}
                    </div>

                    <button
                      disabled={isRecordingComplaint}
                      className="w-full rounded-xl bg-[#0c6b7a] py-3.5 text-xs font-bold text-white shadow-md transition hover:bg-[#09525e] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isRecordingComplaint ? 'Stop dictation to generate pass' : 'Generate Pass Token'}
                    </button>
                  </form>
                </section>
              </div>

              <section className="rounded-[2.5rem] border border-[#dfecef] bg-white p-6 shadow-sm space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-[#0c6b7a]">Your bookings</span>
                    <h2 className="text-xl font-black text-slate-900">Appointment History</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSection('appointment')}
                    className="rounded-xl bg-[#0c6b7a] px-4 py-2.5 text-xs font-bold text-white hover:bg-[#09525e]"
                  >
                    Book Appointment
                  </button>
                </div>

                {patientAppointments.length > 0 ? (
                  <div className="max-h-96 space-y-3 overflow-y-auto pr-1">
                    {patientAppointments.map((entry) => (
                      <article key={entry.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <h3 className="font-bold text-slate-900">{entry.service}</h3>
                            <p className="mt-1 text-xs text-slate-600">Doctor: {entry.doctor || 'Not selected'}</p>
                            <p className="text-xs text-slate-600">{entry.date} at {entry.time}</p>
                            <p className="mt-1 text-xs text-slate-700">Reason: {entry.reason}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${entry.status === 'Approved' || entry.status === 'Confirmed'
                                ? 'bg-emerald-100 text-emerald-800'
                                : entry.status === 'Rejected' || entry.status === 'Cancelled'
                                  ? 'bg-red-100 text-red-800'
                                  : entry.status === 'Completed'
                                    ? 'bg-slate-200 text-slate-700'
                                    : 'bg-amber-100 text-amber-800'
                              }`}>
                              {entry.status === 'Confirmed' ? 'Approved' : entry.status === 'Cancelled' ? 'Rejected' : entry.status}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleDeleteAppointment(entry.id)}
                              className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-[0.65rem] font-bold text-red-700 transition hover:bg-red-100"
                              aria-label={`Delete appointment for ${entry.service}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Delete
                            </button>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-500">
                    Your appointment history will appear here after you submit a booking request.
                  </p>
                )}
              </section>
            </div>
          )}

          {/* MY MEDICATIONS & VITALS HISTORY TAB */}
          {section === 'medications-vitals' && (
            <div className="space-y-6">
              {/* HEADER BANNER */}
              <section className="rounded-[2.5rem] border border-[#dfecef] bg-white p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0c6b7a] text-white shadow-md">
                    <Pill className="h-7 w-7" />
                  </div>
                  <div>
                    <h1 className="text-2xl font-black text-slate-900">My Prescribed Medications &amp; Vitals Record</h1>
                    <p className="text-xs text-slate-500">
                      View all prescribed medicines from attending doctors and timestamped history of BP, Heart Rate, Temp &amp; Weight readings.
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => setSection('token')}
                  className="rounded-xl bg-[#0c6b7a] px-4 py-2.5 text-xs font-bold text-white shadow hover:bg-[#09525e]"
                >
                  Generate New Token Pass
                </button>
              </section>

              {/* SECTION 1: PRESCRIBED MEDICATIONS */}
              <section className="rounded-[2.5rem] border border-[#dfecef] bg-white p-6 shadow-sm space-y-4">
                <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800">
                    <Pill className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-black text-slate-900">Prescribed Medications History</h2>
                    <p className="text-xs text-slate-500">All medicines prescribed by clinic doctors and staff.</p>
                  </div>
                </div>

                <div className="space-y-3">
                  {patientTokens.flatMap((t) => (t.prescriptions || []).map((rx) => ({ ...rx, token: t.token, date: t.issuedAt }))).length > 0 ? (
                    patientTokens
                      .flatMap((t) => (t.prescriptions || []).map((rx) => ({ ...rx, token: t.token, date: t.issuedAt })))
                      .map((rx) => (
                        <div key={rx.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-5 space-y-3 text-xs">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200/60 pb-2">
                            <div>
                              <span className="text-lg font-black text-slate-900">{rx.medicineName}</span>
                              <span className="ml-2 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
                                {rx.dosage}
                              </span>
                            </div>
                            <div className="text-xs text-slate-500">
                              Prescribed by <strong>{rx.prescribedBy || 'Attending Physician'}</strong> on {rx.prescribedAt || 'Recent Visit'}
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-slate-700 font-medium">
                            <div>Frequency: <strong className="text-emerald-800">{rx.frequency}</strong></div>
                            <div>Duration: <strong>{rx.duration}</strong></div>
                            <div>Instructions: <strong>{rx.instructions}</strong></div>
                          </div>

                          {rx.aiMedicationExplanation && (
                            <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-3 space-y-1 text-emerald-950">
                              <div className="font-bold flex items-center gap-1.5 text-[#0c6b7a]">
                                <Brain className="h-3.5 w-3.5" />
                                AI Drug Guide: {rx.aiMedicationExplanation.purpose}
                              </div>
                              <p><strong>Advice:</strong> {rx.aiMedicationExplanation.usageAdvice}</p>
                              <p className="text-emerald-900"><strong>Food &amp; Warnings:</strong> {rx.aiMedicationExplanation.dietaryWarnings}</p>
                            </div>
                          )}
                        </div>
                      ))
                  ) : (
                    <div className="rounded-2xl bg-slate-50 p-8 text-center text-xs text-slate-400 italic border border-slate-100">
                      No prescribed medications recorded yet. Check in for consultation to receive digital prescriptions.
                    </div>
                  )}
                </div>
              </section>

              {/* SECTION 2: TIMESTAMPED VITALS HISTORY LOGS (BP, HEART RATE, TEMP, WEIGHT, SPO2) */}
              <section className="rounded-[2.5rem] border border-[#dfecef] bg-white p-6 shadow-sm space-y-4">
                <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#eafaf6] text-[#0c6b7a]">
                    <Activity className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-black text-slate-900">Vitals History Log (BP, Pulse, Temp, Weight)</h2>
                    <p className="text-xs text-slate-500">Timestamped records of clinical vitals recorded during your visits.</p>
                  </div>
                </div>

                <div className="space-y-3">
                  {patientTokens.filter((t) => t.checkInData).length > 0 ? (
                    patientTokens
                      .filter((t) => t.checkInData)
                      .map((t) => (
                        <div key={t.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-5 space-y-3 text-xs">
                          <div className="flex items-center justify-between border-b border-slate-200/60 pb-2">
                            <div className="flex items-center gap-2">
                              <span className="font-black text-base text-slate-900">{t.token}</span>
                              <span className="text-slate-500">({t.service})</span>
                            </div>
                            <div className="text-[#0c6b7a] font-bold">
                              📅 Checked In: {new Date(t.checkInData?.checkedInAt || t.issuedAt).toLocaleString()}
                            </div>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                            <div className="rounded-xl bg-white p-3 border border-slate-100">
                              <span className="text-slate-400 font-semibold text-[0.7rem]">Blood Pressure (BP)</span>
                              <div className="font-black text-slate-900 text-sm mt-0.5">{t.checkInData?.vitals.bloodPressure}</div>
                            </div>
                            <div className="rounded-xl bg-white p-3 border border-slate-100">
                              <span className="text-slate-400 font-semibold text-[0.7rem]">Heart Rate (BPM)</span>
                              <div className="font-black text-slate-900 text-sm mt-0.5">{t.checkInData?.vitals.heartRate}</div>
                            </div>
                            <div className="rounded-xl bg-white p-3 border border-slate-100">
                              <span className="text-slate-400 font-semibold text-[0.7rem]">Body Temp (°C)</span>
                              <div className="font-black text-slate-900 text-sm mt-0.5">{formatTempCelsius(t.checkInData?.vitals.temperature)}</div>
                            </div>
                            <div className="rounded-xl bg-white p-3 border border-slate-100">
                              <span className="text-slate-400 font-semibold text-[0.7rem]">Weight (kg)</span>
                              <div className="font-black text-slate-900 text-sm mt-0.5">{t.checkInData?.vitals.weightKg || '68 kg'}</div>
                            </div>
                            <div className="rounded-xl bg-white p-3 border border-slate-100 col-span-2 sm:col-span-1">
                              <span className="text-slate-400 font-semibold text-[0.7rem]">SpO2 / Sugar</span>
                              <div className="font-black text-slate-900 text-sm mt-0.5">
                                {t.checkInData?.vitals.oxygenLevel} | {t.checkInData?.vitals.bloodSugar || '105 mg/dL'}
                              </div>
                            </div>
                          </div>

                          {t.checkInData?.vitalsHistory && t.checkInData.vitalsHistory.length > 0 && (
                            <div className="bg-white p-3 rounded-xl border border-slate-200/80 space-y-1.5">
                              <div className="font-bold text-slate-700 text-[0.7rem]">Updated Readings History:</div>
                              {t.checkInData.vitalsHistory.map((h) => (
                                <div key={h.id} className="flex justify-between items-center text-[0.7rem] text-slate-600 bg-slate-50 p-2 rounded-lg">
                                  <span>📅 {new Date(h.recordedAt).toLocaleString()} by {h.recordedBy}</span>
                                  <span className="font-bold text-slate-[#0c6b7a]">
                                    BP: {h.vitals.bloodPressure} | Pulse: {h.vitals.heartRate} | Temp: {formatTempCelsius(h.vitals.temperature)} | Weight: {h.vitals.weightKg || '68 kg'}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))
                  ) : (
                    <div className="rounded-2xl bg-slate-50 p-8 text-center text-xs text-slate-400 italic border border-slate-100">
                      No vitals history recorded yet. Present your pass at reception check-in to record your vitals.
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}

          {/* PROFILE EDIT TAB */}
          {section === 'profile' && (
            <div className="max-w-3xl space-y-6">
              <section className="rounded-[2.5rem] border border-[#dfecef] bg-white p-8 shadow-sm space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
                  <div className="flex items-center gap-3">
                    <UserRound className="h-6 w-6 text-[#0c6b7a]" />
                    <div>
                      <h1 className="text-2xl font-black text-slate-900">Edit Patient Profile</h1>
                      <p className="text-xs text-slate-500">Update your name, email, phone number, age, and profile photo avatar.</p>
                    </div>
                  </div>
                </div>

                <form onSubmit={handleSaveProfile} className="space-y-6">
                  {/* Photo & Avatar selector */}
                  <AvatarPicker
                    currentPhoto={profileDraft.photo}
                    onPhotoChange={(photo) => setProfileDraft({ ...profileDraft, photo })}
                  />

                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                      Full Name
                      <input
                        value={profileDraft.name}
                        onChange={(e) => setProfileDraft({ ...profileDraft, name: e.target.value })}
                        className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900 outline-none focus:border-[#0c6b7a] focus:bg-white"
                        required
                      />
                    </label>

                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                      Email Address
                      <input
                        type="email"
                        value={profileDraft.email}
                        onChange={(e) => setProfileDraft({ ...profileDraft, email: e.target.value })}
                        className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900 outline-none focus:border-[#0c6b7a] focus:bg-white"
                        required
                      />
                    </label>

                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                      Phone Number
                      <input
                        value={profileDraft.phone}
                        onChange={(e) => setProfileDraft({ ...profileDraft, phone: e.target.value })}
                        className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900 outline-none focus:border-[#0c6b7a] focus:bg-white"
                        required
                      />
                    </label>

                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                      Age
                      <input
                        type="number"
                        min="1"
                        max="120"
                        value={profileDraft.age}
                        onChange={(e) => setProfileDraft({ ...profileDraft, age: e.target.value })}
                        className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900 outline-none focus:border-[#0c6b7a] focus:bg-white"
                        required
                      />
                    </label>
                  </div>

                  <div className="pt-2 border-t border-slate-100 flex justify-end">
                    <button
                      type="submit"
                      className="rounded-xl bg-[#0c6b7a] px-8 py-3.5 text-xs font-bold text-white shadow-md hover:bg-[#09525e] transition"
                    >
                      Save Changes
                    </button>
                  </div>
                </form>
              </section>
            </div>
          )}



          {/* AI HEALTH ANALYSIS TAB */}
          {section === 'ai-analysis' && (
            <AiAnalysisHub
              patientProfile={patient}
              lastVitals={activeToken?.checkInData?.vitals}
              allTokens={queueTokens}
            />
          )}

          {/* HISTORY TAB */}
          {section === 'history' && (
            <div className="grid gap-6 lg:grid-cols-2">
              <section className="rounded-[2.5rem] border border-[#dfecef] bg-white p-6 shadow-sm">
                <h2 className="text-xl font-black text-slate-900 mb-4">Token History</h2>
                <div className="space-y-3">
                  {patientTokens.map((entry) => (
                    <article key={entry.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-lg font-black text-slate-900">{entry.token}</span>
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${entry.isCheckedIn ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'
                            }`}
                        >
                          {entry.isCheckedIn ? 'Checked In' : entry.status}
                        </span>
                      </div>
                      <div className="text-xs text-slate-600">{entry.service} · {new Date(entry.issuedAt).toLocaleString()}</div>
                      {entry.checkInData && (
                        <div className="text-xs font-semibold text-emerald-800 bg-emerald-50 p-2 rounded-lg border border-emerald-100">
                          Checked in at {new Date(entry.checkInData.checkedInAt).toLocaleTimeString()} | Room: {entry.checkInData.roomNumber}
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              </section>

              <section className="rounded-[2.5rem] border border-[#dfecef] bg-white p-6 shadow-sm">
                <h2 className="text-xl font-black text-slate-900 mb-4">Appointment Schedule</h2>
                <div className="space-y-3">
                  {patientAppointments.map((entry) => (
                    <article key={entry.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-1">
                      <div className="font-bold text-slate-900">{entry.service}</div>
                      <div className="text-xs text-slate-600">Doctor: {entry.doctor || 'Not selected'}</div>
                      <div className="text-xs text-slate-600">{entry.date} at {entry.time}</div>
                      <div className="text-[0.65rem] font-bold uppercase tracking-wider text-slate-500">
                        {entry.consultationMode || 'In-person'} · {entry.consentSigned ? 'Consent signed' : 'Consent pending'}
                      </div>
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-[0.65rem] font-bold ${entry.status === 'Approved' || entry.status === 'Confirmed'
                          ? 'bg-emerald-100 text-emerald-800'
                          : entry.status === 'Rejected' || entry.status === 'Cancelled'
                            ? 'bg-red-100 text-red-800'
                            : entry.status === 'Completed'
                              ? 'bg-slate-200 text-slate-700'
                              : 'bg-amber-100 text-amber-800'
                        }`}>
                        {entry.status === 'Confirmed' ? 'Approved' : entry.status === 'Cancelled' ? 'Rejected' : entry.status}
                      </span>
                    </article>
                  ))}
                </div>
              </section>
            </div>
          )}

          {/* BOOK APPOINTMENT TAB */}
          {section === 'appointment' && (
            <section className="max-w-2xl rounded-[2.5rem] border border-[#dfecef] bg-white p-8 shadow-sm">
              <h1 className="text-2xl font-black text-slate-900 mb-4">Request Consultation Appointment</h1>
              <form onSubmit={handleBookAppointment} className="space-y-4">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                  Service
                  <select
                    value={appointmentDraft.service}
                    onChange={(e) => setAppointmentDraft({ ...appointmentDraft, service: e.target.value })}
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium"
                  >
                    <option>General Medicine</option>
                    <option>Eye Check-up</option>
                    <option>Dental Care</option>
                    <option>Blood Test</option>
                  </select>
                </label>

                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                  Doctor
                  <select
                    value={appointmentDraft.doctor}
                    onChange={(e) => setAppointmentDraft({ ...appointmentDraft, doctor: e.target.value })}
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-900"
                    required
                  >
                    <option value="" disabled>Select a doctor</option>
                    {availableDoctors.map((doctor) => (
                      <option key={doctor.id} value={doctor.name}>{doctor.name}</option>
                    ))}
                  </select>
                </label>

                <div className="grid grid-cols-2 gap-4">
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                    Preferred Date
                    <input
                      type="date"
                      value={appointmentDraft.date}
                      onChange={(e) => setAppointmentDraft({ ...appointmentDraft, date: e.target.value })}
                      className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm"
                      required
                    />
                  </label>

                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                    Preferred Time
                    <input
                      type="time"
                      value={appointmentDraft.time}
                      onChange={(e) => setAppointmentDraft({ ...appointmentDraft, time: e.target.value })}
                      className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm"
                      required
                    />
                  </label>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                    Consultation Type
                    <select
                      value={appointmentDraft.consultationMode}
                      onChange={(e) => setAppointmentDraft({ ...appointmentDraft, consultationMode: e.target.value as 'In-person' | 'Video Call' | 'Phone Call' })}
                      className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium"
                    >
                      <option value="In-person">In-person</option>
                      <option value="Video Call">Video Call</option>
                      <option value="Phone Call">Phone Call</option>
                    </select>
                  </label>

                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                    Reminder Channel
                    <div className="mt-1.5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">
                      {appointmentDraft.consultationMode === 'Video Call' ? 'WhatsApp' : appointmentDraft.consultationMode === 'Phone Call' ? 'SMS' : 'SMS + Email'}
                    </div>
                  </label>
                </div>

                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                  Reason for Request
                  <textarea
                    rows={3}
                    value={appointmentDraft.reason}
                    onChange={(e) => setAppointmentDraft({ ...appointmentDraft, reason: e.target.value })}
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs"
                    required
                  />
                </label>

                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                  <label className="flex items-start gap-3 text-sm font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={appointmentDraft.consentSigned}
                      onChange={(e) => setAppointmentDraft({ ...appointmentDraft, consentSigned: e.target.checked })}
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-[#0c6b7a] focus:ring-[#0c6b7a]"
                    />
                    <span>
                      I agree to the digital consent and intake form. I confirm the information submitted is accurate and I consent to a scheduled consultation and reminder notifications.
                    </span>
                  </label>
                </div>

                <button className="w-full rounded-xl bg-[#0c6b7a] py-3.5 font-bold text-white shadow-md">
                  Submit Appointment Request
                </button>
              </form>
            </section>
          )}
        </main>
      </div>
    </div>
  )
}

function AdminDashboard() {
  const [queueTokens, setQueueTokens] = useState<QueueToken[]>(() => {
    return getStoredQueueTokensWithDailyReset()
  })
  const [appointments, setAppointments] = useState<AppointmentRequest[]>(() =>
    readStoredList<AppointmentRequest>('synq-appointments')
  )
  const [staffList, setStaffList] = useState<StaffAccount[]>(() => {
    const stored = readStoredList<StaffAccount>('synq-staff')
    return stored.length ? stored : defaultStaff
  })
  const [campStatus, setCampStatus] = useState<string>(() => localStorage.getItem('synq-camp-status') ?? 'active')

  const [isCheckInModalOpen, setIsCheckInModalOpen] = useState(false)
  const [scanNotification, setScanNotification] = useState('')

  const [inquiries, setInquiries] = useState<ContactInquiry[]>(() =>
    readStoredList<ContactInquiry>('synq-contact-inquiries')
  )
  const [inquiryFilter, setInquiryFilter] = useState<'All' | 'Unread' | 'Read' | 'Replied'>('All')
  const [selectedStaffFilter, setSelectedStaffFilter] = useState<string>('All')
  const [activeAdminTab, setActiveAdminTab] = useState<'overview' | 'token-history' | 'staff-history' | 'flush-queue' | 'inquiries'>('overview')
  const [tokenSearchQuery, setTokenSearchQuery] = useState('')
  const [tokenStatusFilter, setTokenStatusFilter] = useState<'All' | 'Waiting' | 'Checked In' | 'Completed' | 'Expired'>('All')
  const [adminReminder, setAdminReminder] = useState('')

  // Create Staff Form
  const [newStaffName, setNewStaffName] = useState('')
  const [newStaffEmail, setNewStaffEmail] = useState('')
  const [newStaffPassword, setNewStaffPassword] = useState('')
  const [newStaffRole, setNewStaffRole] = useState<StaffAccount['role']>('Doctor')
  const [staffCreationMessage, setStaffCreationMessage] = useState('')

  const navigate = useNavigate()
  const currentUser = JSON.parse(localStorage.getItem('synq-current-user') ?? 'null') as CurrentUser | null

  useEffect(() => {
    const syncStoredData = async () => {
      setQueueTokens(readStoredList<QueueToken>('synq-queue'))
      setAppointments(readStoredList<AppointmentRequest>('synq-appointments'))
      const storedStaff = readStoredList<StaffAccount>('synq-staff')
      let syncedStaff = storedStaff
      let syncedInquiries = readStoredList<ContactInquiry>('synq-contact-inquiries')
      setCampStatus(localStorage.getItem('synq-camp-status') ?? 'active')

      if (isSupabaseConfigured && supabase) {
        try {
          syncedStaff = mergeStaffAccounts(await fetchStaffAccounts(supabase), storedStaff)
          localStorage.setItem('synq-staff', JSON.stringify(syncedStaff))
        } catch (error) {
          console.warn('Could not load staff accounts from Supabase:', error)
        }

        try {
          const supabaseInquiries = await fetchContactInquiries(supabase)
          if (supabaseInquiries.length) {
            localStorage.setItem('synq-contact-inquiries', JSON.stringify(supabaseInquiries))
            syncedInquiries = supabaseInquiries
          }
        } catch (error) {
          console.warn('Could not load contact inquiries from Supabase:', error)
        }
      }

      setStaffList(syncedStaff)
      setInquiries(syncedInquiries)
    }
    window.addEventListener('storage', syncStoredData)
    window.addEventListener('synq-data-updated', syncStoredData)

    void syncStoredData()
    const interval = setInterval(() => {
      void syncStoredData()
    }, 1000)

    return () => {
      window.removeEventListener('storage', syncStoredData)
      window.removeEventListener('synq-data-updated', syncStoredData)
      clearInterval(interval)
    }
  }, [])

  // Update Inquiry Status (Unread, Read, Replied)
  const handleUpdateInquiryStatus = (inquiryId: string, newStatus: ContactInquiry['status']) => {
    const updated = inquiries.map((inq) => (inq.id === inquiryId ? { ...inq, status: newStatus } : inq))
    setInquiries(updated)
    localStorage.setItem('synq-contact-inquiries', JSON.stringify(updated))
    notifyDataChanged()

    if (isSupabaseConfigured && supabase) {
      supabase.from('contact_inquiries').update({ status: newStatus }).eq('id', inquiryId).then(() => { })
    }
  }

  // Delete Single Inquiry
  const handleDeleteInquiry = (inquiryId: string, name: string) => {
    if (!window.confirm(`Are you sure you want to delete inquiry from "${name}"?`)) return
    const updated = inquiries.filter((inq) => inq.id !== inquiryId)
    setInquiries(updated)
    localStorage.setItem('synq-contact-inquiries', JSON.stringify(updated))
    notifyDataChanged()

    if (isSupabaseConfigured && supabase) {
      supabase.from('contact_inquiries').delete().eq('id', inquiryId).then(() => { })
    }
  }

  // Clear All Inquiries
  const handleClearAllInquiries = () => {
    if (!window.confirm('Are you sure you want to delete ALL contact us inquiries? This cannot be undone.')) return
    setInquiries([])
    localStorage.setItem('synq-contact-inquiries', JSON.stringify([]))
    notifyDataChanged()
  }

  const handleClearAllAppointmentHistory = () => {
    if (!window.confirm('Are you sure you want to delete ALL appointment history? This cannot be undone.')) return

    setAppointments([])
    localStorage.setItem('synq-appointments', JSON.stringify([]))
    notifyDataChanged()
    alert('All appointment history cleared successfully.')
  }

  // Export Inquiries CSV
  const handleExportInquiriesCSV = () => {
    if (!inquiries.length) {
      alert('No contact inquiries to export.')
      return
    }
    const headers = ['Inquiry ID', 'Name', 'Email', 'Message', 'Status', 'Submitted At']
    const rows = inquiries.map((inq) => [
      inq.id,
      `"${inq.name}"`,
      inq.email,
      `"${inq.message.replace(/"/g, '""')}"`,
      inq.status,
      inq.createdAt,
    ])
    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `mediqueue-contact-inquiries-${formatLocalDate()}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  // Toggle Camp Active / Turned OFF
  const handleToggleCampStatus = () => {
    const nextStatus = campStatus === 'active' ? 'closed' : 'active'
    setCampStatus(nextStatus)
    localStorage.setItem('synq-camp-status', nextStatus)
    notifyDataChanged()
    alert(`Health Camp status updated to ${nextStatus === 'active' ? 'ACTIVE (Staff Login Enabled)' : 'TURNED OFF (Staff Login Disabled)'}!`)
  }

  // Delete Staff Account
  const handleDeleteStaff = async (staffId: string, staffName: string) => {
    if (!window.confirm(`Are you sure you want to delete staff account for "${staffName}"? This action cannot be undone.`)) {
      return
    }

    if (isSupabaseConfigured && supabase) {
      try {
        await deleteStaffAccount(supabase, staffId)
      } catch (error) {
        console.error('Could not delete staff account from Supabase:', error)
        alert(`Could not delete the staff account from Supabase. ${getStaffAccountErrorMessage(error)}`)
        return
      }
    }

    const updated = staffList.filter((s) => s.id !== staffId)
    setStaffList(updated)
    localStorage.setItem('synq-staff', JSON.stringify(updated))
    notifyDataChanged()
    alert(`Staff account for "${staffName}" deleted successfully!`)
  }

  if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'staff')) {
    return <Navigate to="/login" replace />
  }

  // Handle Token Check-In Success from CheckInModal
  const handleCheckInSuccess = (tokenId: string, checkInData: AdditionalCheckInData) => {
    const updated = queueTokens.map((t) => {
      if (t.id === tokenId) {
        return {
          ...t,
          status: 'Checked In' as const,
          isCheckedIn: true,
          checkedInAt: checkInData.checkedInAt,
          checkInData,
        }
      }
      return t
    })

    setQueueTokens(updated)
    localStorage.setItem('synq-queue', JSON.stringify(updated))
    notifyDataChanged()

    const targetToken = queueTokens.find((t) => t.id === tokenId)
    setScanNotification(
      `✅ CHECK-IN SUCCESSFUL: Token ${targetToken?.token || ''} marked as checked in! Additional vitals & room assignment saved.`
    )
  }

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault()

    let finalEmail = newStaffEmail.trim()
    if (!finalEmail) return

    if (!finalEmail.includes('@')) {
      finalEmail = `${finalEmail}@mediqueue.SK`
    } else {
      const username = finalEmail.split('@')[0]
      finalEmail = `${username}@mediqueue.SK`
    }

    const nextStaff: StaffAccount = {
      id: `s-${Date.now()}`,
      name: newStaffName.trim(),
      email: finalEmail,
      password: newStaffPassword,
      role: newStaffRole,
    }

    if (isSupabaseConfigured && supabase) {
      try {
        await saveStaffAccount(supabase, nextStaff)
      } catch (error) {
        console.error('Could not save staff account to Supabase:', error)
        alert(`Could not save the staff account to Supabase. ${getStaffAccountErrorMessage(error)}`)
        return
      }
    }

    const updated = [...staffList, nextStaff]
    setStaffList(updated)
    localStorage.setItem('synq-staff', JSON.stringify(updated))
    notifyDataChanged()
    setNewStaffName('')
    setNewStaffEmail('')
    setNewStaffPassword('')
    setStaffCreationMessage(`Account created for ${finalEmail}.`)
  }

  const handleLoginAsStaff = (staffMember: StaffAccount) => {
    localStorage.setItem('synq-current-user', JSON.stringify({ role: 'staff', account: staffMember }))
    navigate('/staff-dashboard')
  }

  // Export Clinic Day Log as CSV
  const handleExportClinicLogCSV = () => {
    if (!queueTokens.length) {
      alert('No clinic token records available to export.')
      return
    }

    const headers = [
      'Token ID',
      'Token Number',
      'Patient Name',
      'Email',
      'Phone',
      'Service Department',
      'Status',
      'Issued At',
      'Checked In At',
      'Checked Out At',
      'BP',
      'Heart Rate',
      'Temp',
      'Weight',
      'Assigned Doctor',
      'Room',
    ]
    const rows = queueTokens.map((t) => [
      t.id,
      t.token,
      `"${t.patientName}"`,
      t.email,
      t.phone || '',
      `"${t.service}"`,
      t.status,
      t.issuedAt,
      t.checkedInAt || '',
      t.checkedOutAt || '',
      t.checkInData?.vitals.bloodPressure || '',
      t.checkInData?.vitals.heartRate || '',
      t.checkInData?.vitals.temperature || '',
      t.checkInData?.vitals.weightKg || '',
      `"${t.checkInData?.assignedDoctor || ''}"`,
      `"${t.checkInData?.roomNumber || ''}"`,
    ])

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `mediqueue-clinic-report-${formatLocalDate()}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  // Manual Reset Daily Queue (Admin Flush)
  const handleManualQueueReset = () => {
    if (window.confirm('Are you sure you want to flush today\'s active queue? Active tokens will be marked as Expired and removed from waiting line.')) {
      const todayStr = formatLocalDate()
      const nowIso = new Date().toISOString()
      const resetTokens = queueTokens.map((t) => ({
        ...t,
        status: 'Expired' as const,
        isExpired: true,
        expiredAt: nowIso,
        isCheckedIn: false,
      }))
      setQueueTokens(resetTokens)
      localStorage.setItem('synq-queue', JSON.stringify(resetTokens))
      localStorage.setItem('synq-last-reset-date', todayStr)
      localStorage.setItem('synq-queue-initialized', 'true')
      notifyDataChanged()
      alert('Today\'s queue tokens have been flushed and reset successfully!')
    }
  }

  // Clear ALL Staff Work History Logs
  const handleClearAllStaffWorkHistory = () => {
    if (!window.confirm('Are you sure you want to remove ALL staff work history logs and clinical activity records? This action cannot be undone.')) {
      return
    }

    const updatedTokens = queueTokens.map((t) => ({
      ...t,
      status: (t.status === 'Completed' || t.status === 'In progress' ? 'Waiting' : t.status) as QueueToken['status'],
      isCheckedIn: false,
      checkedInAt: undefined,
      checkedOutAt: undefined,
      checkoutNotes: undefined,
      checkInData: undefined,
      prescriptions: [],
    }))

    setQueueTokens(updatedTokens)
    localStorage.setItem('synq-queue', JSON.stringify(updatedTokens))
    localStorage.setItem('synq-queue-initialized', 'true')
    notifyDataChanged()
    alert('✅ All staff work history records have been removed successfully!')
  }

  // Clear Work History for a specific staff member
  const handleClearStaffWorkHistoryForMember = (staffMemberName: string) => {
    if (!window.confirm(`Are you sure you want to remove all staff work history records for "${staffMemberName}"?`)) {
      return
    }

    const updatedTokens = queueTokens.map((t) => {
      const isHandledByStaff =
        t.checkInData?.assignedDoctor === staffMemberName ||
        t.checkInData?.checkedInBy === staffMemberName ||
        t.prescriptions?.some((p) => p.prescribedBy === staffMemberName)

      if (isHandledByStaff) {
        return {
          ...t,
          status: (t.status === 'Completed' || t.status === 'In progress' ? 'Waiting' : t.status) as QueueToken['status'],
          isCheckedIn: false,
          checkedInAt: undefined,
          checkedOutAt: undefined,
          checkoutNotes: undefined,
          checkInData: undefined,
          prescriptions: (t.prescriptions || []).filter((p) => p.prescribedBy !== staffMemberName),
        }
      }
      return t
    })

    setQueueTokens(updatedTokens)
    localStorage.setItem('synq-queue', JSON.stringify(updatedTokens))
    localStorage.setItem('synq-queue-initialized', 'true')
    notifyDataChanged()
    alert(`✅ Work history records for staff member "${staffMemberName}" removed successfully!`)
  }

  // Remove an individual staff work history record
  const handleRemoveSingleWorkHistoryItem = (tokenId: string, patientName: string) => {
    if (!window.confirm(`Are you sure you want to remove staff work history entry for patient "${patientName}"?`)) {
      return
    }

    const updatedTokens = queueTokens.map((t) => {
      if (t.id === tokenId) {
        return {
          ...t,
          status: 'Waiting' as const,
          isCheckedIn: false,
          checkedInAt: undefined,
          checkedOutAt: undefined,
          checkoutNotes: undefined,
          checkInData: undefined,
          prescriptions: [],
        }
      }
      return t
    })

    setQueueTokens(updatedTokens)
    localStorage.setItem('synq-queue', JSON.stringify(updatedTokens))
    localStorage.setItem('synq-queue-initialized', 'true')
    notifyDataChanged()
    alert(`✅ Staff work history record for "${patientName}" removed successfully!`)
  }

  // Completely delete a single token from history
  const handleDeleteSingleToken = (tokenId: string, tokenCode: string) => {
    if (!window.confirm(`Are you sure you want to permanently delete token ${tokenCode} from history?`)) {
      return
    }
    const updatedTokens = queueTokens.filter((t) => t.id !== tokenId)
    setQueueTokens(updatedTokens)
    localStorage.setItem('synq-queue', JSON.stringify(updatedTokens))
    localStorage.setItem('synq-queue-initialized', 'true')
    notifyDataChanged()
    alert(`✅ Visit token ${tokenCode} deleted permanently from system.`)
  }

  // Clear all token history completely
  const handleClearAllTokenHistory = () => {
    if (!window.confirm('⚠️ Are you sure you want to PERMANENTLY REMOVE ALL TOKEN HISTORY from the system? This action cannot be undone.')) {
      return
    }
    setQueueTokens([])
    localStorage.setItem('synq-queue', JSON.stringify([]))
    localStorage.setItem('synq-queue-initialized', 'true')
    notifyDataChanged()
    alert('✅ All token history records have been permanently removed.')
  }

  const clinicReport = generateClinicReport(queueTokens)
  const nextQueuePatient = [...queueTokens]
    .filter((token) => !token.isCheckedIn && token.status !== 'Expired' && token.status !== 'Completed' && token.status !== 'Cancelled')
    .sort((a, b) => new Date(a.issuedAt).getTime() - new Date(b.issuedAt).getTime())[0]

  const upcomingAppointments = appointments
    .filter((appointment) => !['Rejected', 'Cancelled', 'Completed'].includes(appointment.status))
    .slice(0, 4)

  const handleSendAppointmentReminder = (appointment: AppointmentRequest) => {
    const channel = appointment.consultationMode === 'Video Call' ? 'WhatsApp' : appointment.consultationMode === 'Phone Call' ? 'SMS' : 'SMS + Email'
    const summary = `Reminder sent via ${channel} to ${appointment.patientName} for ${appointment.service} on ${appointment.date} at ${appointment.time}.`
    setAdminReminder(summary)
    const saved = JSON.parse(localStorage.getItem('mediqueue-reminders') ?? '[]') as Array<{ message: string; createdAt: string; channel: string }>
    saved.push({ message: summary, channel, createdAt: new Date().toISOString() })
    localStorage.setItem('mediqueue-reminders', JSON.stringify(saved.slice(-10)))
  }

  const handleSendNextPatientReminder = () => {
    if (!nextQueuePatient) {
      setAdminReminder('There is no waiting patient to remind right now.')
      return
    }

    const summary = `Next patient reminder sent for ${nextQueuePatient.patientName} (${nextQueuePatient.token}). Please prepare the consultation room.`
    setAdminReminder(summary)
    localStorage.setItem('mediqueue-next-patient-reminder', summary)
  }

  return (
    <div className="min-h-screen bg-[#edf9f6] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header */}
        <header className="flex flex-col gap-4 rounded-[2.5rem] border border-[#dfecef] bg-white p-6 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-[#0c6b7a]">Operations Portal</span>
            <h1 className="text-3xl font-black text-slate-900">Admin Operations</h1>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <ThemeToggle />
            <button
              onClick={handleExportClinicLogCSV}
              className="inline-flex items-center gap-2 rounded-xl bg-[#0c6b7a] px-4 py-2.5 text-xs font-bold text-white shadow-md hover:bg-[#09525e] transition"
            >
              <FileSpreadsheet className="h-4 w-4" />
              Export CSV Report
            </button>
            <button
              onClick={() => {
                localStorage.removeItem('synq-current-user')
                navigate('/', { replace: true })
              }}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition"
            >
              Logout
            </button>
          </div>
        </header>

        {/* Sub-Page Navigation Tabs */}
        <nav className="flex flex-wrap items-center gap-2 rounded-2xl bg-white p-2 border border-[#dfecef] shadow-sm">
          <button
            onClick={() => setActiveAdminTab('overview')}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition ${activeAdminTab === 'overview'
                ? 'bg-[#0c6b7a] text-white shadow-md'
                : 'text-slate-600 hover:bg-slate-100'
              }`}
          >
            <LayoutDashboard className="h-4 w-4" />
            Overview &amp; Live Queue
          </button>

          <button
            onClick={() => setActiveAdminTab('token-history')}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition ${activeAdminTab === 'token-history'
                ? 'bg-red-600 text-white shadow-md'
                : 'text-red-700 hover:bg-red-50'
              }`}
          >
            <Trash2 className="h-4 w-4" />
            Token History Page
            {queueTokens.length > 0 && (
              <span className={`rounded-full px-2 py-0.5 text-[0.65rem] font-extrabold ${activeAdminTab === 'token-history' ? 'bg-white text-red-700' : 'bg-red-100 text-red-800'}`}>
                {queueTokens.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveAdminTab('staff-history')}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition ${activeAdminTab === 'staff-history'
                ? 'bg-amber-600 text-white shadow-md'
                : 'text-amber-700 hover:bg-amber-50'
              }`}
          >
            <RotateCcw className="h-4 w-4" />
            Staff History Page
          </button>

          <button
            onClick={() => setActiveAdminTab('flush-queue')}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition ${activeAdminTab === 'flush-queue'
                ? 'bg-slate-800 text-white shadow-md'
                : 'text-slate-700 hover:bg-slate-100'
              }`}
          >
            <Power className="h-4 w-4" />
            Flush Queue Page
          </button>

          <button
            onClick={() => setActiveAdminTab('inquiries')}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition ${activeAdminTab === 'inquiries'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-emerald-700 hover:bg-emerald-50'
              }`}
          >
            <MessageSquareText className="h-4 w-4" />
            Contact Inquiries Page
            {inquiries.filter((i) => i.status === 'Unread').length > 0 && (
              <span className="rounded-full bg-red-500 text-white px-2 py-0.5 text-[0.65rem] font-bold">
                {inquiries.filter((i) => i.status === 'Unread').length}
              </span>
            )}
          </button>
        </nav>

        {(nextQueuePatient || adminReminder) && (
          <div className="rounded-[1.75rem] border border-[#dfecef] bg-[#edfdf8] p-4 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#0c6b7a] text-white">
                  <BellRing className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-[0.7rem] font-bold uppercase tracking-[0.12em] text-[#0c6b7a]">Queue reminder</div>
                  <div className="text-sm font-black text-slate-900">
                    {nextQueuePatient ? `${nextQueuePatient.token} · ${nextQueuePatient.patientName}` : 'Priority operations update'}
                  </div>
                </div>
              </div>
              {nextQueuePatient && (
                <button
                  type="button"
                  onClick={handleSendNextPatientReminder}
                  className="rounded-xl bg-[#0c6b7a] px-3 py-2 text-[0.7rem] font-bold text-white hover:bg-[#09525e]"
                >
                  Send next-patient reminder
                </button>
              )}
            </div>
            {adminReminder && (
              <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
                {adminReminder}
              </div>
            )}
          </div>
        )}

        {/* Scan Notification Banner */}
        {scanNotification && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-xs font-bold text-emerald-900 flex items-center justify-between">
            <span>{scanNotification}</span>
            <button onClick={() => setScanNotification('')} className="text-emerald-700 underline">
              Dismiss
            </button>
          </div>
        )}

        {/* Check-in Modal */}
        <CheckInModal
          isOpen={isCheckInModalOpen}
          onClose={() => setIsCheckInModalOpen(false)}
          queueTokens={queueTokens}
          onCheckInSuccess={handleCheckInSuccess}
        />

        {/* PAGE 1: OVERVIEW & LIVE QUEUE */}
        {activeAdminTab === 'overview' && (
          <div className="space-y-6">
            {/* HEALTH CAMP START & TURN OFF CONTROL PANEL */}
            <div className="rounded-[2.5rem] border border-[#dfecef] bg-white p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div
                  className={`flex h-12 w-12 items-center justify-center rounded-2xl text-white shadow-md ${campStatus === 'active' ? 'bg-emerald-600' : 'bg-red-600'
                    }`}
                >
                  <Power className="h-6 w-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-black text-slate-900">Health Camp Operations Control</h2>
                    <span
                      className={`rounded-full px-3 py-0.5 text-xs font-black uppercase tracking-wider ${campStatus === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                        }`}
                    >
                      {campStatus === 'active' ? '🟢 CAMP ACTIVE' : '🔴 CAMP TURNED OFF'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {campStatus === 'active'
                      ? 'Camp is running. Staff accounts can log in and process patient intake & vitals.'
                      : 'Camp is turned OFF. Staff logins are currently disabled.'}
                  </p>
                </div>
              </div>

              <button
                onClick={handleToggleCampStatus}
                className={`inline-flex items-center gap-2 rounded-xl px-6 py-3 font-extrabold text-xs shadow-md transition ${campStatus === 'active'
                    ? 'bg-red-600 hover:bg-red-700 text-white'
                    : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  }`}
              >
                {campStatus === 'active' ? (
                  <>
                    <Power className="h-4 w-4" />
                    Turn OFF Health Camp (Disable Staff Login)
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4" />
                    Start Health Camp (Enable Staff Login)
                  </>
                )}
              </button>
            </div>

            {/* Executive Clinic Analytics Summary */}
            <div className="grid gap-4 sm:grid-cols-4">
              <article className="rounded-2xl border border-[#dfecef] bg-white p-5 shadow-sm">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Total Tokens Issued</div>
                <div className="mt-2 text-3xl font-black text-slate-900">{clinicReport.totalTokens}</div>
              </article>
              <article className="rounded-2xl border border-[#dfecef] bg-white p-5 shadow-sm">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Checked In Patients</div>
                <div className="mt-2 text-3xl font-black text-emerald-600">{clinicReport.checkedInCount}</div>
              </article>
              <article className="rounded-2xl border border-[#dfecef] bg-white p-5 shadow-sm">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Emergency Triage</div>
                <div className="mt-2 text-3xl font-black text-red-600">{clinicReport.emergencyCount}</div>
              </article>
              <article className="rounded-2xl border border-[#dfecef] bg-white p-5 shadow-sm">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Est. Avg Wait Time</div>
                <div className="mt-2 text-3xl font-black text-slate-900">{clinicReport.avgWaitMinutes} min</div>
              </article>
            </div>

            <div className="grid gap-6 lg:grid-cols-12">
              {/* LEFT: CHECKED-IN PATIENTS & VITALS LOG (7 cols) */}
              <section className="lg:col-span-7 space-y-6">
                <div className="rounded-[2.5rem] border border-[#dfecef] bg-white p-6 shadow-sm space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <div className="flex items-center gap-2">
                      <Activity className="h-5 w-5 text-[#0c6b7a]" />
                      <h2 className="text-xl font-black text-slate-900">Checked-In Patients &amp; Clinical Vitals Log</h2>
                    </div>
                    <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800">
                      {queueTokens.filter((t) => t.isCheckedIn).length} Checked In
                    </span>
                  </div>

                  <div className="space-y-3">
                    {queueTokens
                      .filter((t) => t.isCheckedIn)
                      .map((t) => (
                        <article key={t.id} className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <span className="text-2xl font-black text-slate-900">{t.token}</span>
                              <div>
                                <div className="font-bold text-slate-900 text-sm">{t.patientName}</div>
                                <div className="text-xs text-slate-500">{t.service}</div>
                              </div>
                            </div>
                            <span className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-bold text-white">
                              Checked In
                            </span>
                          </div>

                          {t.checkInData && (
                            <div className="grid grid-cols-2 gap-2 text-xs bg-white p-3 rounded-xl border border-emerald-100">
                              <div>
                                <span className="text-slate-400 font-semibold">Doctor &amp; Room:</span>
                                <div className="font-bold text-slate-900">
                                  {t.checkInData.assignedDoctor} ({t.checkInData.roomNumber})
                                </div>
                              </div>
                              <div>
                                <span className="text-slate-400 font-semibold">Checked In Time:</span>
                                <div className="font-bold text-slate-900">
                                  {new Date(t.checkInData.checkedInAt).toLocaleTimeString()}
                                </div>
                              </div>
                              <div>
                                <span className="text-slate-400 font-semibold">BP &amp; Pulse:</span>
                                <div className="font-bold text-slate-900">
                                  {t.checkInData.vitals.bloodPressure} | {t.checkInData.vitals.heartRate} bpm
                                </div>
                              </div>
                              <div>
                                <span className="text-slate-400 font-semibold">Temp &amp; SpO2:</span>
                                <div className="font-bold text-slate-900">
                                  {formatTempCelsius(t.checkInData.vitals.temperature)} | {t.checkInData.vitals.oxygenLevel}%
                                </div>
                              </div>
                            </div>
                          )}
                        </article>
                      ))}

                    {queueTokens.filter((t) => t.isCheckedIn).length === 0 && (
                      <p className="text-center py-6 text-xs text-slate-400">
                        No patients checked in yet today.
                      </p>
                    )}
                  </div>
                </div>

                {/* WAITING QUEUE LIST */}
                <div className="rounded-[2.5rem] border border-[#dfecef] bg-white p-6 shadow-sm space-y-4">
                  <h3 className="text-lg font-black text-slate-900">Waiting Queue (Unchecked)</h3>
                  <div className="space-y-2">
                    {queueTokens
                      .filter((t) => !t.isCheckedIn)
                      .map((t) => (
                        <div
                          key={t.id}
                          className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs"
                        >
                          <div>
                            <span className="font-black text-slate-900 text-sm">{t.token}</span> — {t.patientName} ({t.service})
                          </div>
                          <button
                            onClick={() => setIsCheckInModalOpen(true)}
                            className="rounded-lg bg-[#0c6b7a] px-3 py-1.5 font-bold text-white hover:bg-[#09525e]"
                          >
                            Check In
                          </button>
                        </div>
                      ))}
                  </div>
                </div>
              </section>

              {/* RIGHT: STAFF CREATION & CLINIC INSIGHTS (5 cols) */}
              <section className="lg:col-span-5 space-y-6">
                <div className="rounded-[2.5rem] border border-[#dfecef] bg-white p-6 shadow-sm space-y-4">
                  <h3 className="text-lg font-black text-slate-900">Create Staff Credentials</h3>
                  <form onSubmit={handleCreateStaff} className="space-y-3">
                    <div>
                      <label className="block text-[0.7rem] font-bold uppercase tracking-wider text-slate-700 mb-1">
                        Staff Full Name
                      </label>
                      <input
                        value={newStaffName}
                        onChange={(e) => setNewStaffName(e.target.value)}
                        placeholder="Enter staff full name"
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-medium outline-none focus:border-[#0c6b7a]"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-[0.7rem] font-bold uppercase tracking-wider text-slate-700 mb-1">
                        Staff Login Email (Auto domain: @mediqueue.SK)
                      </label>
                      <div className="flex rounded-xl border border-slate-200 bg-slate-50 overflow-hidden focus-within:border-[#0c6b7a]">
                        <input
                          type="text"
                          value={newStaffEmail}
                          onChange={(e) => {
                            const val = e.target.value
                            if (val.toLowerCase().includes('@mediqueue.sk')) {
                              setNewStaffEmail(val.split('@')[0])
                            } else {
                              setNewStaffEmail(val)
                            }
                          }}
                          placeholder="Enter username"
                          className="flex-1 bg-transparent px-3 py-2.5 text-xs font-semibold text-slate-900 outline-none"
                          required
                        />
                        <span className="bg-[#0c6b7a] text-white px-3.5 py-2.5 text-xs font-black flex items-center shrink-0">
                          @mediqueue.SK
                        </span>
                      </div>
                      <div className="text-[0.68rem] text-slate-500 mt-1 font-medium">
                        Final Email:{' '}
                        <strong className="text-[#0c6b7a]">
                          {newStaffEmail
                            ? newStaffEmail.includes('@')
                              ? `${newStaffEmail.split('@')[0]}@mediqueue.SK`
                              : `${newStaffEmail}@mediqueue.SK`
                            : 'username@mediqueue.SK'}
                        </strong>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[0.7rem] font-bold uppercase tracking-wider text-slate-700 mb-1">
                        Password
                      </label>
                      <input
                        type="password"
                        value={newStaffPassword}
                        onChange={(e) => setNewStaffPassword(e.target.value)}
                        placeholder="e.g. staff123"
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-medium outline-none focus:border-[#0c6b7a]"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-[0.7rem] font-bold uppercase tracking-wider text-slate-700 mb-1">
                        Staff Clinical Role
                      </label>
                      <select
                        value={newStaffRole}
                        onChange={(e) => setNewStaffRole(e.target.value as StaffAccount['role'])}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-medium outline-none"
                      >
                        <option>Doctor</option>
                        <option>Nurse</option>
                        <option>Reception</option>
                        <option>Counter Staff</option>
                      </select>
                    </div>

                    <button className="w-full rounded-xl bg-[#0c6b7a] py-3 text-xs font-bold text-white shadow-md hover:bg-[#09525e] transition">
                      Create Staff Account (@mediqueue.SK)
                    </button>
                  </form>
                  {staffCreationMessage && (
                    <div role="status" aria-live="polite" className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs font-semibold text-emerald-800">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      <span>{staffCreationMessage}</span>
                    </div>
                  )}
                </div>

                <div className="rounded-[2.5rem] border border-[#dfecef] bg-white p-6 shadow-sm space-y-3">
                  <h3 className="text-lg font-black text-slate-900">Registered Staff Accounts ({staffList.length})</h3>
                  <div className="space-y-2.5 max-h-72 overflow-y-auto">
                    {staffList.map((s) => (
                      <div key={s.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs space-y-2">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-bold text-slate-900 text-sm">{s.name}</div>
                            <div className="text-slate-500">{s.email}</div>
                          </div>
                          <span className="rounded-full bg-[#0c6b7a]/10 text-[#0c6b7a] px-2.5 py-0.5 font-bold uppercase tracking-wider text-[0.65rem]">
                            {s.role}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-1.5 text-[0.7rem] text-slate-600 border-t border-slate-200/60 pt-2">
                          <button
                            onClick={() => handleClearStaffWorkHistoryForMember(s.name)}
                            className="rounded-lg bg-amber-100 px-2 py-1 text-[0.65rem] font-bold text-amber-800 hover:bg-amber-200 transition flex items-center gap-1"
                            title="Remove work history for this staff member"
                          >
                            <RotateCcw className="h-3 w-3" />
                            Clear History
                          </button>

                          <button
                            onClick={() => handleDeleteStaff(s.id, s.name)}
                            className="rounded-lg bg-red-100 px-2 py-1 text-[0.65rem] font-bold text-red-700 hover:bg-red-200 transition flex items-center gap-1"
                          >
                            <Trash2 className="h-3 w-3" />
                            Delete Account
                          </button>

                          <button
                            onClick={() => handleLoginAsStaff(s)}
                            className="rounded-lg bg-[#0c6b7a] px-2 py-1 text-[0.65rem] font-bold text-white hover:bg-[#09525e]"
                          >
                            Open Portal
                          </button>
                        </div>
                      </div>
                    ))}

                    {staffList.length === 0 && (
                      <p className="text-xs text-slate-400 italic text-center py-4">No registered staff accounts.</p>
                    )}
                  </div>
                </div>

                <div className="rounded-[2.5rem] border border-[#dfecef] bg-white p-6 shadow-sm space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-lg font-black text-slate-900">Appointment Requests ({appointments.length})</h3>
                    <button
                      type="button"
                      onClick={handleClearAllAppointmentHistory}
                      className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[0.7rem] font-bold text-red-700 transition hover:bg-red-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Clear History
                    </button>
                  </div>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {upcomingAppointments.map((a) => (
                      <div key={a.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs space-y-2">
                        <div className="font-bold text-slate-900">{a.patientName} — {a.service}</div>
                        <div className="text-slate-700">Doctor: {a.doctor || 'Not selected'}</div>
                        <div className="text-slate-500">{a.date} at {a.time} ({a.status})</div>
                        <div className="text-[0.65rem] font-bold uppercase tracking-wider text-slate-500">
                          {a.consultationMode || 'In-person'} · {a.consentSigned ? 'Consent signed' : 'Consent pending'} · {a.reminderChannel || 'SMS'}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleSendAppointmentReminder(a)}
                          className="rounded-lg bg-[#0c6b7a] px-2.5 py-1.5 text-[0.65rem] font-bold text-white hover:bg-[#09525e]"
                        >
                          Send reminder
                        </button>
                      </div>
                    ))}
                    {upcomingAppointments.length === 0 && (
                      <p className="text-xs text-slate-400 italic">No appointment requests yet.</p>
                    )}
                  </div>
                </div>
              </section>
            </div>
          </div>
        )}

        {/* PAGE 2: TOKEN HISTORY PAGE */}
        {activeAdminTab === 'token-history' && (
          <div className="space-y-6">
            {/* Page Header Banner & Danger Action */}
            <div className="rounded-[2.5rem] border border-red-200 bg-white p-6 shadow-sm space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
                <div className="flex items-center gap-4">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-100 text-red-700 shadow-sm">
                    <Trash2 className="h-7 w-7" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-black text-slate-900">Token History Management Page</h2>
                    <p className="text-xs text-slate-500">
                      Search, inspect, and permanently remove historical token records issued by the clinic.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span className="rounded-2xl bg-slate-100 px-4 py-2 text-xs font-bold text-slate-700">
                    Total Tokens: <strong>{queueTokens.length}</strong>
                  </span>
                </div>
              </div>

              {/* Dedicated Danger Zone Box for Removing Token History */}
              <div className="rounded-3xl border border-red-300 bg-red-50/80 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-red-900 font-extrabold text-sm">
                    <Trash2 className="h-4 w-4 text-red-700" />
                    Permanently Clear All Token History
                  </div>
                  <p className="text-xs text-red-700 font-medium">
                    This operation wipes all historical patient tokens from system storage. This action cannot be undone.
                  </p>
                </div>

                <button
                  onClick={handleClearAllTokenHistory}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-300 bg-red-600 px-5 py-3 text-xs font-black text-white shadow-md hover:bg-red-700 transition shrink-0"
                  title="Permanently remove all token history records"
                >
                  <Trash2 className="h-4 w-4" />
                  Remove Token History
                </button>
              </div>

              {/* Search & Filter Controls */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
                <input
                  type="text"
                  value={tokenSearchQuery}
                  onChange={(e) => setTokenSearchQuery(e.target.value)}
                  placeholder="Search by patient name, token number, service..."
                  className="w-full sm:w-80 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-medium outline-none focus:border-red-500"
                />

                <div className="flex rounded-xl border border-slate-200 bg-slate-50 p-1 self-start sm:self-auto">
                  {(['All', 'Waiting', 'Checked In', 'Completed', 'Expired'] as const).map((st) => (
                    <button
                      key={st}
                      onClick={() => setTokenStatusFilter(st)}
                      className={`rounded-lg px-3 py-1 text-xs font-bold transition ${tokenStatusFilter === st ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                        }`}
                    >
                      {st}
                    </button>
                  ))}
                </div>
              </div>

              {/* Token Logs Grid */}
              <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
                {queueTokens
                  .filter((t) => {
                    const matchesFilter = tokenStatusFilter === 'All' ? true : t.status === tokenStatusFilter
                    const matchesSearch =
                      !tokenSearchQuery ||
                      t.patientName.toLowerCase().includes(tokenSearchQuery.toLowerCase()) ||
                      t.token.toLowerCase().includes(tokenSearchQuery.toLowerCase()) ||
                      t.service.toLowerCase().includes(tokenSearchQuery.toLowerCase())
                    return matchesFilter && matchesSearch
                  })
                  .map((t) => (
                    <div key={t.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs space-y-2">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-3">
                          <span className="text-xl font-black text-slate-900">{t.token}</span>
                          <div>
                            <div className="font-bold text-slate-900 text-sm">{t.patientName}</div>
                            <div className="text-slate-500">{t.service} · Issued: {new Date(t.issuedAt).toLocaleTimeString()}</div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className={`rounded-full px-2.5 py-0.5 font-bold text-[0.7rem] ${t.status === 'Checked In' ? 'bg-emerald-100 text-emerald-800' :
                              t.status === 'Completed' ? 'bg-blue-100 text-blue-800' :
                                t.status === 'Expired' ? 'bg-red-100 text-red-800' :
                                  'bg-slate-200 text-slate-700'
                            }`}>
                            {t.status}
                          </span>

                          <button
                            onClick={() => handleDeleteSingleToken(t.id, t.token)}
                            className="rounded-xl border border-red-200 bg-red-100/80 px-2.5 py-1 text-[0.7rem] font-bold text-red-800 hover:bg-red-200 transition flex items-center gap-1"
                          >
                            <Trash2 className="h-3.5 w-3.5 text-red-700" />
                            Delete Token
                          </button>
                        </div>
                      </div>

                      {t.checkInData && (
                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[0.68rem] bg-white p-2.5 rounded-xl border border-slate-100">
                          <div>BP: <strong>{t.checkInData.vitals.bloodPressure}</strong></div>
                          <div>Pulse: <strong>{t.checkInData.vitals.heartRate} bpm</strong></div>
                          <div>Temp: <strong>{formatTempCelsius(t.checkInData.vitals.temperature)}</strong></div>
                          <div>Doctor: <strong>{t.checkInData.assignedDoctor}</strong></div>
                          <div>Room: <strong>{t.checkInData.roomNumber}</strong></div>
                        </div>
                      )}
                    </div>
                  ))}

                {queueTokens.filter((t) => {
                  const matchesFilter = tokenStatusFilter === 'All' ? true : t.status === tokenStatusFilter
                  const matchesSearch =
                    !tokenSearchQuery ||
                    t.patientName.toLowerCase().includes(tokenSearchQuery.toLowerCase()) ||
                    t.token.toLowerCase().includes(tokenSearchQuery.toLowerCase()) ||
                    t.service.toLowerCase().includes(tokenSearchQuery.toLowerCase())
                  return matchesFilter && matchesSearch
                }).length === 0 && (
                    <p className="text-center py-12 text-xs text-slate-400 italic">No token history records matching search criteria.</p>
                  )}
              </div>
            </div>
          </div>
        )}

        {/* PAGE 3: STAFF WORK HISTORY PAGE */}
        {activeAdminTab === 'staff-history' && (
          <div className="space-y-6">
            <div className="rounded-[2.5rem] border border-amber-200 bg-white p-6 shadow-sm space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
                <div className="flex items-center gap-4">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-800 shadow-sm">
                    <RotateCcw className="h-7 w-7" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-black text-slate-900">Staff Work History Management Page</h2>
                    <p className="text-xs text-slate-500">
                      View and remove clinical work history logs, vitals recordings, and prescriptions submitted by staff.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={selectedStaffFilter}
                    onChange={(e) => setSelectedStaffFilter(e.target.value)}
                    className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-800"
                  >
                    <option value="All">All Staff Accounts</option>
                    {staffList.map((s) => (
                      <option key={s.id} value={s.name}>{s.name} ({s.role})</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Dedicated Danger Zone Box for Removing Staff Work History */}
              <div className="rounded-3xl border border-amber-300 bg-amber-50/80 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-amber-900 font-extrabold text-sm">
                    <RotateCcw className="h-4 w-4 text-amber-700" />
                    Remove Staff History Log Records
                  </div>
                  <p className="text-xs text-amber-800 font-medium">
                    This clears vitals logs, check-in timestamps, and prescriptions issued by staff. Tokens return to waiting status.
                  </p>
                </div>

                <button
                  onClick={handleClearAllStaffWorkHistory}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-300 bg-amber-600 px-5 py-3 text-xs font-black text-white shadow-md hover:bg-amber-700 transition shrink-0"
                >
                  <RotateCcw className="h-4 w-4" />
                  Remove Staff History
                </button>
              </div>

              {/* Staff History Log List */}
              <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
                {queueTokens
                  .filter((t) => t.isCheckedIn || t.checkInData || t.status === 'Completed' || (t.prescriptions && t.prescriptions.length > 0))
                  .filter((t) => {
                    if (selectedStaffFilter === 'All') return true
                    return (
                      t.checkInData?.assignedDoctor === selectedStaffFilter ||
                      t.checkInData?.checkedInBy === selectedStaffFilter ||
                      t.prescriptions?.some((p) => p.prescribedBy === selectedStaffFilter)
                    )
                  })
                  .map((t) => (
                    <div key={t.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs space-y-2">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-3">
                          <span className="text-xl font-black text-slate-900">{t.token}</span>
                          <div>
                            <div className="font-bold text-slate-900 text-sm">{t.patientName}</div>
                            <div className="text-slate-500">{t.service} · Status: <strong>{t.status}</strong></div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 font-bold text-emerald-800 text-[0.7rem]">
                            Doctor: {t.checkInData?.assignedDoctor || 'Attending Physician'}
                          </span>

                          <button
                            onClick={() => handleRemoveSingleWorkHistoryItem(t.id, t.patientName)}
                            className="rounded-xl border border-amber-200 bg-amber-100/90 px-2.5 py-1 text-[0.7rem] font-bold text-amber-900 hover:bg-amber-200 transition flex items-center gap-1"
                            title="Clear staff clinical work history for this patient"
                          >
                            <RotateCcw className="h-3.5 w-3.5 text-amber-700" />
                            Clear Work Record
                          </button>

                          <button
                            onClick={() => handleDeleteSingleToken(t.id, t.token)}
                            className="rounded-xl border border-red-200 bg-red-50 px-2.5 py-1 text-[0.7rem] font-bold text-red-700 hover:bg-red-100 transition flex items-center gap-1"
                            title="Permanently remove token from system history"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete Token
                          </button>
                        </div>
                      </div>

                      {t.checkInData && (
                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[0.68rem] bg-white p-2.5 rounded-xl border border-slate-100">
                          <div>BP: <strong>{t.checkInData.vitals.bloodPressure}</strong></div>
                          <div>Pulse: <strong>{t.checkInData.vitals.heartRate}</strong></div>
                          <div>Temp: <strong>{formatTempCelsius(t.checkInData.vitals.temperature)}</strong></div>
                          <div>Checked In By: <strong>{t.checkInData.checkedInBy || 'Staff'}</strong></div>
                          <div>Time: <strong>{new Date(t.checkInData.checkedInAt).toLocaleTimeString()}</strong></div>
                        </div>
                      )}

                      {t.prescriptions && t.prescriptions.length > 0 && (
                        <div className="text-[0.68rem] text-slate-600 bg-white p-2 rounded-xl border border-slate-100">
                          Prescribed: {t.prescriptions.map((r) => r.medicineName).join(', ')}
                        </div>
                      )}
                    </div>
                  ))}

                {queueTokens.filter((t) => t.isCheckedIn || t.checkInData || t.status === 'Completed' || (t.prescriptions && t.prescriptions.length > 0)).length === 0 && (
                  <p className="text-center py-12 text-xs text-slate-400 italic">No staff work history records found.</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* PAGE 4: FLUSH QUEUE PAGE */}
        {activeAdminTab === 'flush-queue' && (
          <div className="space-y-6">
            <div className="rounded-[2.5rem] border border-slate-300 bg-white p-6 shadow-sm space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
                <div className="flex items-center gap-4">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-800 shadow-sm">
                    <Power className="h-7 w-7 text-slate-700" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-black text-slate-900">Queue Operations &amp; Flush Page</h2>
                    <p className="text-xs text-slate-500">
                      Reset active queue numbers and flush daily shift tokens.
                    </p>
                  </div>
                </div>
              </div>

              {/* Dedicated Danger Zone Box for Flushing Queue */}
              <div className="rounded-3xl border border-slate-300 bg-slate-100/90 p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-slate-900 font-extrabold text-sm">
                    <RotateCcw className="h-4 w-4 text-slate-700" />
                    Flush Today's Active Shift Queue
                  </div>
                  <p className="text-xs text-slate-600 font-medium">
                    This marks all unhandled active tokens as Expired to clear the queue for a new operating shift.
                  </p>
                </div>

                <button
                  onClick={handleManualQueueReset}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-400 bg-slate-800 px-6 py-3.5 text-xs font-black text-white shadow-md hover:bg-slate-900 transition shrink-0"
                >
                  <RotateCcw className="h-4 w-4 text-slate-300" />
                  Flush Queue
                </button>
              </div>

              {/* Shift Diagnostics */}
              <div className="grid gap-4 sm:grid-cols-3">
                <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">Active Unchecked Tokens</div>
                  <div className="text-2xl font-black text-slate-900 mt-1">
                    {queueTokens.filter((t) => !t.isCheckedIn && t.status === 'Waiting').length}
                  </div>
                </article>

                <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">Checked In / Active</div>
                  <div className="text-2xl font-black text-emerald-600 mt-1">
                    {queueTokens.filter((t) => t.isCheckedIn).length}
                  </div>
                </article>

                <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">Flushed / Expired Tokens</div>
                  <div className="text-2xl font-black text-red-600 mt-1">
                    {queueTokens.filter((t) => t.status === 'Expired' || t.isExpired).length}
                  </div>
                </article>
              </div>

              {/* Current Active Queue Table */}
              <div className="space-y-3">
                <h3 className="text-sm font-black text-slate-900">Current Queue Status Breakdown</h3>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {queueTokens.map((t) => (
                    <div key={t.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
                      <div>
                        <span className="font-black text-slate-900 text-sm">{t.token}</span> — {t.patientName} ({t.service})
                      </div>
                      <span className={`rounded-full px-2.5 py-0.5 font-bold text-[0.68rem] ${t.status === 'Waiting' ? 'bg-amber-100 text-amber-800' :
                          t.status === 'Checked In' ? 'bg-emerald-100 text-emerald-800' :
                            t.status === 'Expired' ? 'bg-red-100 text-red-800' :
                              'bg-slate-200 text-slate-700'
                        }`}>
                        {t.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* PAGE 5: CONTACT INQUIRIES PAGE */}
        {activeAdminTab === 'inquiries' && (
          <div className="space-y-6">
            <div className="rounded-[2.5rem] border border-[#dfecef] bg-white p-6 shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-100 text-[#0c6b7a]">
                    <MessageSquareText className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-black text-slate-900">Contact Us Patient Inquiries</h2>
                      {inquiries.filter((i) => i.status === 'Unread').length > 0 && (
                        <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-black text-red-700">
                          {inquiries.filter((i) => i.status === 'Unread').length} New
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500">View and respond to messages submitted via the Contact Us page.</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex rounded-xl border border-slate-200 bg-slate-50 p-1">
                    {(['All', 'Unread', 'Read', 'Replied'] as const).map((filter) => (
                      <button
                        key={filter}
                        onClick={() => setInquiryFilter(filter)}
                        className={`rounded-lg px-3 py-1 text-xs font-bold transition ${inquiryFilter === filter ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                          }`}
                      >
                        {filter}
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={handleExportInquiriesCSV}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#0c6b7a] px-3.5 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-[#09525e] transition"
                  >
                    <FileSpreadsheet className="h-3.5 w-3.5" />
                    Export CSV
                  </button>

                  <button
                    onClick={handleClearAllInquiries}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-red-100 px-3.5 py-1.5 text-xs font-bold text-red-700 hover:bg-red-200 transition"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Clear Inquiries
                  </button>
                </div>
              </div>

              <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
                {inquiries
                  .filter((i) => (inquiryFilter === 'All' ? true : i.status === inquiryFilter))
                  .map((inq) => (
                    <div key={inq.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#0c6b7a]/10 font-bold text-[#0c6b7a]">
                            {inq.name ? inq.name.charAt(0).toUpperCase() : '?'}
                          </div>
                          <div>
                            <div className="font-bold text-slate-900 text-sm">{inq.name}</div>
                            <div className="text-slate-500 font-medium">{inq.email} · {new Date(inq.createdAt).toLocaleString()}</div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <select
                            value={inq.status}
                            onChange={(e) => handleUpdateInquiryStatus(inq.id, e.target.value as ContactInquiry['status'])}
                            className={`rounded-xl border px-3 py-1 text-xs font-bold outline-none transition ${inq.status === 'Unread'
                                ? 'border-red-200 bg-red-50 text-red-800'
                                : inq.status === 'Read'
                                  ? 'border-amber-200 bg-amber-50 text-amber-800'
                                  : 'border-emerald-200 bg-emerald-50 text-emerald-800'
                              }`}
                          >
                            <option value="Unread">Unread</option>
                            <option value="Read">Read</option>
                            <option value="Replied">Replied</option>
                          </select>

                          <button
                            onClick={() => handleDeleteInquiry(inq.id, inq.name)}
                            className="rounded-xl border border-slate-200 bg-white p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 transition"
                            title="Delete Inquiry"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      <div className="rounded-xl bg-white p-3.5 border border-slate-200/80 text-slate-800 leading-relaxed text-xs">
                        "{inq.message}"
                      </div>
                    </div>
                  ))}

                {inquiries.filter((i) => (inquiryFilter === 'All' ? true : i.status === inquiryFilter)).length === 0 && (
                  <p className="text-center py-8 text-xs text-slate-400 italic">No contact inquiries found under "{inquiryFilter}".</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
