# LifeLine AI

**By MSB Creative Studios**

LifeLine AI is an emergency triage, voice transcription, and offline-resilience assistance application designed to operate reliably during critical situations, network outages, and connectivity disruptions.

---

## 🌟 Key Features

- **Emergency Voice & Text Triage**: Instant analysis of emergency situations, dispatch needs, required rescue/medical units, and severity classification.
- **Resilience / Offline Fallback Mode**: Fully deterministic local rule-based triage classifier and offline multilingual phrasebook that function with zero internet connectivity and zero external cloud calls.
- **Online Cloud AI Integration**: When online, the server connects to NVIDIA Nemotron models hosted on Nebius Token Factory for natural language understanding and multi-lingual triage extraction.
- **Silent SOS Mode**: Stealth emergency alert triggering with visual confirmation and zero audio feedback for high-risk situations.
- **Privacy & Safety First**: Explicit opt-in location sharing, local audio processing via browser Web Speech API, zero third-party telemetry or ad tracking, and strictly opt-in history retention.

---

## 🛡️ Architecture & Security

```
[ User Browser / Client ]
           │
           │ (HTTPS / Relative API endpoints)
           ▼
[ LifeLine AI Backend (Node/Express) ]
           │
           ├─ [ Offline / Local Mode ] ──▶ Local Deterministic Rule Classifier
           │
           └─ [ Online Mode ] ──────────▶ Nebius Token Factory (NVIDIA Nemotron)
                                           (Server-side NEBIUS_API_KEY only)
```

- **Zero Client-Side Credentials**: API keys (`NEBIUS_API_KEY`) reside exclusively in server-side environment variables and are never transmitted to or bundled within the frontend.
- **No Keystores or Secrets in Git**: Secret tokens, credentials, and `.env` files are ignored via `.gitignore`.
- **Privacy by Design**: Voice audio is converted to text locally via client browser APIs; only the transcript text needed for classification is sent to the backend endpoint.

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- npm 9+

### Installation

```bash
git clone https://github.com/msbmsb0706/Lifeline-AI-by-MSB-Creative-Studios-.git
cd Lifeline-AI-by-MSB-Creative-Studios-
npm install
```

### Configuration

Copy `.env.example` to `.env` and set your optional server credentials:

```bash
cp .env.example .env
```

| Variable | Description | Default / Example |
|---|---|---|
| `PORT` | Web server listening port | `3000` |
| `NEBIUS_API_KEY` | Server-side Nebius Token Factory API key | `""` (If blank, runs in Offline Resilience mode) |
| `NEBIUS_BASE_URI` | Nebius API endpoint base URL | `https://api.tokenfactory.us-central1.nebius.com/v1` |
| `NEBIUS_MODEL` | Nemotron model identifier | `nvidia/nemotron-3-super-120b-a12b` |

### Running the App

```bash
# Development mode
npm run dev

# Production build and run
npm run build
npm start
```

---

## 📄 Privacy Policy

See our official [Privacy Policy](PRIVACY_POLICY.md) for full details on data handling, permissions, and security commitments.

---

## ⚖️ License

Developed by **MSB Creative Studios**. All rights reserved.
