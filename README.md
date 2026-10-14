<div align="center">

# 🏥 MediQueue — Smart Healthcare Queue & AI Triage System

[![React 19](https://img.shields.io/badge/React-19.2.8-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-8.3-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4.3-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)](https://supabase.com/)
[![OpenAI](https://img.shields.io/badge/OpenAI-GPT--4o--mini-412991?style=for-the-badge&logo=openai&logoColor=white)](https://openai.com/)
[![License](https://img.shields.io/badge/License-MIT-green.style=for-the-badge)](LICENSE)

<p align="center">
  <b>Transforming Outpatient Department (OPD) Intake with Dynamic QR Visit Passes, Real-Time Vitals Triage & Dual-Layer AI Clinical Intelligence.</b>
</p>

[✨ Key Features](#-key-features) •
[🏗️ Architecture](#%EF%B8%8F-system-architecture) •
[🩺 AI Triage Algorithm](#-ai-triage--vitals-scoring-algorithm) •
[⚙️ Installation & Setup](#%EF%B8%8F-installation--setup) •
[📄 Presentation & Reports](#-presentation--documentation)

---

</div>

> [!IMPORTANT]
> **MediQueue** solves outpatient waiting room congestion and delayed emergency treatment by combining dynamic mobile QR passes, reception camera intake scanning, vital signs recording, and a **fail-safe triple-tier AI triage engine** (OpenAI + Gemini + Offline Rule Engine).

---

## 🚀 Key Features

### 👤 **Patient Portal**
- 🎫 **Dynamic QR Visit Pass**: Generates digital tokens (e.g. `A-001`) with dynamic QR codes for instant counter scanning.
- 📊 **Live Position & Wait Tracker**: Real-time visual progress bar showing queue status (`Waiting` ➔ `Checked In` ➔ `In progress` ➔ `Completed`).
- 🧠 **AI Symptom Checker**: Natural language symptom analysis returning risk scores (10–95), triage level, red flags, and recommended department.
- 💬 **MediAI Assistant**: Interactive clinical chatbot providing guidance on clinic visits, symptom queries, and text-to-speech support.
- 📝 **Lab Report Summarizer**: Converts complex lab reports and prescription text into plain-English summaries and actionable points.
- 💊 **Digital Health Passport**: Access vitals history, past consultation notes, and digital prescriptions with AI dosage explanations.

### 👩‍⚕️ **Staff & Doctor Portal**
- 📷 **HTML5 QR Intake Scanner**: Reception staff scan patient QR passes in seconds via laptop/mobile camera.
- 🩺 **Guided Vitals Recording**: Input Blood Pressure, Heart Rate, Temperature, SpO2 %, Blood Sugar, Weight, and Height.
- 🚨 **Automated Emergency Flagging**: Real-time vitals scoring auto-identifies hypoxia (`SpO2 < 95%`) and hypertension (`BP ≥ 140/90`).
- 📋 **Doctor Queue Control Panel**: One-click status toggles (*Call Patient, Start Consultation, Checkout*) with complete vital history inspection.
- 💊 **AI Medication Explainer**: Auto-generates purpose, dosage timing, side effects, and dietary warnings for prescribed drugs.
- 📈 **Staff Productivity & Clinic Analytics**: Metrics tracking patients handled, emergency cases routed, average wait times, and daily report exports.

---



---

## 🩺 AI Triage & Vitals Scoring Algorithm

The built-in clinical triage scoring engine evaluates patient vitals against reference thresholds:

| Vital Sign | Normal Range | Abnormality Condition | Triage Score Impact |
| :--- | :--- | :--- | :---: |
| 🫁 **SpO2 (Oxygen Saturation)** | 95% – 100% | `< 95%` *(Hypoxia Warning)* | **+40 Points** |
| 🩸 **Blood Pressure (BP)** | `< 120/80` mmHg | `≥ 140/90` mmHg *(Hypertension)* | **+25 Points** |
| 🌡️ **Body Temperature** | 36.5°C – 37.2°C | `≥ 39.1°C` *(High Fever)* | **+20 Points** |
| 💓 **Heart Rate (Pulse)** | 60 – 100 BPM | `> 100` BPM *(Tachycardia)* | **+15 Points** |
| 👵 **Senior Care Priority** | Age < 65 yrs | Age `> 65` yrs | **+10 Points** |

### 🚦 Triage Categories:
- **🚨 EMERGENCY (Score ≥ 70)**: Immediate priority routing to Emergency & Cardiology.
- **⚠️ URGENT (Score 45 – 69)**: Priority queueing for nursing & doctor inspection.
- **🟢 STANDARD (Score 21 – 44)**: Standard OPD consultation queue.
- **🔵 LOW PRIORITY (Score ≤ 20)**: Routine follow-up / general consultation.





Developed with ❤️ for **Smart Healthcare & Emergency Triage Systems**.
