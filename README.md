# LifeLine AI

**BY MSB CREATIVE STUDIOS**

LifeLine AI by MSB Creative Studios is an emergency triage application for voice and text distress reports. It classifies likely emergency types and severity, produces a structured visual SOS card and dispatch alert, and lets the user review and share an emergency package.

**Operational Notice:** LifeLine AI currently has no automatic government or rescue dispatch. Sharing or transmitting an alert requires explicit user review and confirmation.

---

## System Architecture

LifeLine AI enforces a strict architectural separation between **Online AI** mode and **Offline / Resilience** mode.

```
+-----------------------------------------------------------------------------------------+
|                                    USER BROWSER / CLIENT                                |
|                                                                                         |
|   +-----------------------+     +-----------------------+     +---------------------+   |
|   | Voice / Audio Input   |     | Text Input            |     | Silent SOS Flow     |   |
|   | • Configurable ASR    |     | • 10 Languages        |     | • One-time GPS      |   |
|   | • Web Speech Fallback |     | • Script Detection    |     | • 2 Images + 10s Vid|   |
|   +-----------------------+     +-----------------------+     +---------------------+   |
|               │                             │                            │              |
+───────────────┼─────────────────────────────┼────────────────────────────┼──────────────+
                │ (Relative API Routes)       │                            │
   +────────────┴─────────────+               │                            │
   │                          ▼               ▼                            ▼
   │                +───────────────────────────────────+         +───────────────────+
   │                |      NODE / EXPRESS BACKEND       |         | BROWSER / CLIENT  |
   │                |  • Server-Side Secrets Protection |         | LOCAL STORAGE     |
   │                |  • Rate Limiting & Proxy Trust    |         | • Pending Queue   |
   │                +───────────────────────────────────+         | • User Consent    |
   │                         │                 │                  +───────────────────+
   │                         ▼                 ▼                            │
   │               +------------------+  +---------------------+            │
   │               | Nebius Factory   |  | Optional ASR Proxy  |            │
   │               | NVIDIA Nemotron  |  | NVIDIA Whisper NIM  |            │
   │               | (Online AI Mode) |  | (Configurable Only) |            │
   │               +------------------+  +---------------------+            │
   │                                                                        │
   └─────────────► [ OFFLINE / RESILIENCE MODE: ZERO CLOUD CALLS ] ◄────────┘
                   • Local Deterministic Emergency Engine
                   • 8 Standard Emergency Categories
                   • Dynamic Severity & Needs Detection
                   • Multilingual Translation Dictionary
```

- **Browser to Backend:** The browser communicates exclusively via relative API routes (`/api/*`).
- **Online AI Mode:** The backend routes structured prompts to the configured NVIDIA Nemotron model via Nebius Token Factory.
- **Offline / Resilience Mode:** Executes entirely within the local client via deterministic classification rules—zero internet access or cloud API dependencies required.
- **Credential Protection:** Secrets and API keys remain strictly on the backend and are never sent to or bundled into client code.

---

## Implemented Features & Capabilities

### 1. AI Emergency Triage (Online AI Mode)

When `NEBIUS_API_KEY` is configured on the backend, LifeLine AI operates in **Online AI** mode:

- **Nebius Token Factory:** Provides managed API routing and token processing to run state-of-the-art inference.
- **NVIDIA Nemotron:** Employs configured NVIDIA Nemotron models (such as `nvidia/nemotron-3-super-120b-a12b` or `nvidia/llama-3.1-nemotron-70b-instruct`) for structured reasoning and emergency classification.
- **Structured Extraction:** Transforms raw distress reports into typed JSON schemas containing standard emergency category, specific incident classification, numeric severity rating (1–5), essential needs and responder assets, clear civilian action steps, first-aid measures, and radio-ready responder instructions.
- **Credential Isolation:** The Nebius API key is stored server-side only and is never exposed to the frontend.

### 2. Offline / Resilience Mode

When offline, during network infrastructure disruptions, or when server API keys are unavailable, LifeLine AI operates seamlessly in **Offline / Resilience** mode (which users can also explicitly select at any time):

- **Local Deterministic Emergency Classification:** Evaluates input text through a robust deterministic keyword and regex-matching engine requiring no cloud API calls and no active internet connection.
- **8 Standard Emergency Categories:**
  1. `MEDICAL`: Acute trauma, cardiac event, stroke, respiratory crisis, severe hemorrhage, anaphylaxis, unconscious patient.
  2. `FIRE`: Structural fires, smoke entrapment, industrial blazes, wildland fire, chemical detonations.
  3. `RESCUE`: Vehicle collisions, extrication, structural collapse, flood entrapment, trench or swift water rescue.
  4. `FOOD`: Disaster starvation risk, isolated communities cut off from supply lines, infant nutrition crisis.
  5. `WATER`: Potable water failure, acute dehydration threat, contaminated municipal supplies.
  6. `SHELTER`: Displaced families, destroyed residential structures, severe hypothermia or storm refuge needs.
  7. `MISSING_PERSON`: Missing or abducted children, lost vulnerable elders, wilderness disappearances.
  8. `OTHER`: General civil hazards, toxic chemical spills, combustible gas leaks, active threats.
- **Severity Detection (Priority Levels 1–5):**
  - **Level 5 (Critical):** Immediate life threat (e.g., cardiac arrest, airway obstruction, arterial bleeding, active structure fire entrapment).
  - **Level 4 (Severe):** Major trauma, vehicle rollover extrication, toxic gas release, urgent shelter/food emergency.
  - **Level 3 (Moderate):** Urgent medical conditions or non-life-threatening incidents requiring prompt responder verification.
  - **Level 1–2 (Low/Stable):** Minor or stabilized situations.
- **Emergency Needs Detection:** Automatically identifies and maps critical responder assets, including:
  - Advanced Life Support (ALS) Paramedic Ambulance
  - Automated External Defibrillator (AED)
  - Fire Engine & Structural Suppression Units
  - Heavy Hydraulic Rescue / Extrication Equipment
  - Potable Drinking Water Supply Units
  - Emergency Rations Squad & Pediatric Formula Kits
  - Emergency Shelter Units & Thermal Survival Blankets
  - Canine (K9) Search & Scent-Tracking Squads
  - Hazardous Material (Hazmat) Specialized Units
- **Deterministic Multilingual Translation:** Translates triage classifications, priority directives, action steps, and responder instructions across all 10 supported languages without cloud APIs.

### 3. Multilingual Emergency Communication

LifeLine AI supports multilingual distress communication across **10 languages**:

- **English** (`en`)
- **Tamil** (`ta` - தமிழ்)
- **Hindi** (`hi` - हिन्दी)
- **Telugu** (`te` - తెలుగు)
- **Kannada** (`kn` - ಕನ್ನಡ)
- **Malayalam** (`ml` - മലയാളം)
- **Bengali** (`bn` - বাংলা)
- **Marathi** (`mr` - मराठी)
- **Spanish** (`es` - Español)
- **French** (`fr` - Français)

#### Language Detection
- **Script-Based Unicode Detection:** Instantaneous client-side recognition of native scripts (Tamil, Devanagari for Hindi and Marathi, Telugu, Kannada, Malayalam, Bengali).
- **Phonetic & Romanized Marker Heuristics:** Detects transliterated emergency distress markers (e.g., *kapathunga*, *madad*, *sahayam*, *bachao*, *vachva*, *kapaadi*).
- **Western Language Lexical Markers:** Identifies Spanish and French distress vocabulary, accents, and punctuation markers.

#### Transcript Preservation & Translation Aid
- **Original Transcript Preservation:** Original spoken or typed distress transcripts are preserved verbatim in their source language to maintain ground-truth context for arriving responders.
- **English Translation as an Interpretation Aid:** An English translation is generated alongside the original transcript to facilitate cross-jurisdictional triage, disaster coordination, and mutual-aid responses.

#### Speech-to-Text (ASR) Capabilities
- **Optional Multilingual ASR (NVIDIA Whisper NIM):**
  - When server-side ASR credentials are explicitly configured (`ASR_PROVIDER=nvidia_nim`, `ASR_BASE_URL`, `ASR_API_KEY`/`NVIDIA_API_KEY`, and `ASR_MODEL=openai/whisper-large-v3`), browser audio recordings are transmitted to the backend proxy (`POST /api/asr/transcribe`) for transcription with automatic multilingual detection (`language=multi`).
  - Audio is processed transiently in memory: audio buffers are **never written to disk** and are **never persisted**.
  - Nebius Token Factory does not host speech or audio endpoints; therefore, multilingual ASR connects to dedicated NVIDIA NIM infrastructure when configured.
  - *ASR Accuracy Notice:* Server-side NVIDIA Whisper ASR is an optional/configurable capability. It is active **only** when the required ASR credentials are configured on the server.
- **Browser Speech-Recognition Fallback:**
  - When server-side ASR is not configured or unavailable, the client automatically falls back to the browser's built-in Web Speech API (where supported by the user's browser).
  - Users can also type distress reports directly in any of the 10 supported languages at any time.

### 4. Silent SOS & Evidence Capture

Silent SOS provides a non-verbal emergency workflow for active threats, entrapment, or severe respiratory distress:

1. **Explicit User Activation:** Activated solely upon user selection; there is no passive monitoring or background audio capture.
2. **One-Time GPS Geolocation:** The application queries device GPS once (`navigator.geolocation.getCurrentPosition`) only upon user initiation. There is **no continuous tracking**, **no `watchPosition`**, and **no background GPS monitoring**. Geolocation errors (Permission Denied, Position Unavailable, Timeout) are diagnosed and displayed clearly.
3. **Optional Evidence Capture:**
   - **Up to 2 Still Photos:** Captured via device camera or local file selection.
   - **Optional 10-Second SOS Video:** Dedicated recording that stops automatically at 10 seconds (or upon manual stop). Camera and microphone hardware tracks are immediately closed and released upon completion.
   - **Evidence Only:** Attached media files serve strictly as visual evidence for human first responders. They are **not** analyzed by Nemotron, **not** processed by AI vision models, and **not** uploaded without explicit confirmation.
4. **User Review and Explicit Confirmation:**
   - A comprehensive summary screen presents emergency category, severity, one-time GPS coordinates, accuracy, attached evidence previews, and timestamp.
   - Alert transmission requires explicit user confirmation via the Web Share API (`navigator.share`) or clipboard export.
   - LifeLine AI **never automatically contacts** police, fire, or rescue services without user action.
5. **SOS / Emergency Information Generation:**
   - Generates an on-screen visual SOS card featuring color-coded severity badges, international priority icons, immediate action steps, first-aid directives, and responder instructions.
   - Formats a concise, standardized radio-dispatch alert ready for rapid copying or sharing.

---

## Emergency Organization Integration Framework

LifeLine AI includes an extensible, country-aware integration framework for coordination with authorized emergency, rescue, and public safety organizations.

### Three Provider Types

1. **TEST / DEMO PROVIDER**
   - Explicitly labeled: `"TEST EMERGENCY PARTNER — DEMONSTRATION ONLY"`.
   - Used for system evaluation, live demonstrations, and responder training.
   - Generates mock provider acknowledgments with unique tracking IDs (`DEMO-ACK-XXXXX`).
   - Does **not** alert actual public safety answering points.

2. **PUBLIC CONTACT PROVIDER**
   - Presents verified public emergency numbers and portals across countries (e.g., 911 in North America, 112 in the European Union and India, 108 in India, 999 in the United Kingdom, 000 in Australia).
   - Informational only: clarifies that standard public telephone networks require voice interaction and do not support automated digital API ingestion.
   - Does not upload media or location data to public telephone lines.

3. **AUTHORIZED API PROVIDER**
   - Enabled only when an emergency response agency implements a formal, documented HTTPS API interface.
   - Transmits structured SOS payloads server-to-server over encrypted HTTPS with server-side authentication.
   - Supports schema validation, provider acknowledgment logging, error handling, and retry semantics.

### Offline-First Pending Transmission Queue

- **Local Storage:** When an alert is confirmed offline, the structured SOS package is saved to client-side storage.
- **Privacy-Preserving User Consent:** Automatic transmission on reconnection defaults to `OFF`. It activates only if the user explicitly turns on *"Send pending SOS when connection returns"* and approves partner transmission.
- **User Control:** Users can inspect pending alerts, trigger manual transmission, or delete records from the queue at any time.
- **Media Upload Guardrails:** Photo and video evidence are transmitted only if the authorized provider's documented API specifications explicitly authorize media ingestion.

For integration specifications and onboarding instructions for emergency response agencies, see [EMERGENCY_ORGANIZATION_INTEGRATION.md](EMERGENCY_ORGANIZATION_INTEGRATION.md).

---

## Technical & Operational Boundaries

To maintain technical integrity and user safety, LifeLine AI enforces the following operational boundaries:

- **No Automatic Dispatch:** LifeLine AI is a triage and alert-formulation tool. It does not automatically dispatch first responders or contact government agencies.
- **No Government Endorsement:** LifeLine AI does not claim official government approval, certification, or affiliation.
- **No Continuous Tracking:** Location is polled once upon explicit user action; continuous background GPS is not supported.
- **No Automated Media Classification:** Photos and videos are attached as visual evidence for human responders and are not processed via computer vision.
- **Configurable ASR Only:** Server-side NVIDIA Whisper ASR operates only when valid server credentials are provisioned. In all other cases, browser-native speech recognition or text input is used.

---

## Privacy Contact Form

Users contact MSB Creative Studios through the in-app **Privacy Contact Form** (Privacy & Safety → **Open Privacy Contact Form**, the **Contact Privacy Team** button, or the footer link). No personal or developer email address is published in the app, the website, this README, or the Privacy Policy.

**Endpoint:** `POST /api/privacy-contact` (JSON: `name` optional, `email` required, `message` required)

The server (`server/privacyContact.ts`):

- Validates email address format and message length; rejects empty, malformed, or oversized submissions (name ≤ 100 chars, email ≤ 254 chars, message 10–4000 chars).
- Applies rate limiting (30 attempts and 5 accepted submissions per client per 15 minutes, 100 accepted submissions per hour server-wide) plus a hidden honeypot field for automated senders.
- Relays the message by SMTP to the mailbox in `PRIVACY_CONTACT_EMAIL`, with the user's address set as `Reply-To`.
- Never logs submitted names, email addresses, or messages — only a random reference ID and coarse outcome codes.
- Returns only a generic success/failure JSON response (`{ success, message | error, reference }`) and never exposes the destination address.
- Responds `503` when `PRIVACY_CONTACT_EMAIL` or SMTP settings are missing, `429` when rate-limited, and `400` for invalid input.

The destination mailbox is **never hard-coded**. It is read only from the server-side environment variable `PRIVACY_CONTACT_EMAIL`, which must be configured in hosting environment secrets. The frontend communicates exclusively via the relative URL `/api/privacy-contact`.

---

## Security & Server-Side Credential Protection

- `NEBIUS_API_KEY` and emergency partner credentials remain server-side only.
- `ASR_API_KEY` / `NVIDIA_API_KEY` remain server-side only.
- `PRIVACY_CONTACT_EMAIL` and SMTP credentials remain server-side only; they are never bundled into frontend assets, returned by API responses, or hard-coded in source files.
- `.env` is gitignored and must never be committed.
- No secrets, credentials, certificates, or mailbox addresses are tracked in this repository.

---

## Configuration & Environment Variables

Server-side settings are configured via environment variables (copy from `.env.example`). **Never commit `.env` to source control.**

| Variable | Requirement | Description |
|---|---|---|
| `PORT` | Optional | HTTP listen port for Express server (default: `3000`). |
| `NEBIUS_API_KEY` | Optional | Server-side key for Nebius Token Factory. If empty, Online AI is disabled and the system operates in Offline / Resilience mode. |
| `NEBIUS_BASE_URI` / `NEBIUS_BASE_URL` | Optional | API base URI for Nebius Token Factory (default: `https://api.studio.nebius.ai/v1`). |
| `NEBIUS_MODEL` | Optional | NVIDIA Nemotron model identifier (e.g., `nvidia/llama-3.1-nemotron-70b-instruct`). |
| `ASR_PROVIDER` | Optional | ASR provider (`nvidia_nim` or `none`). Default: `nvidia_nim`. |
| `ASR_BASE_URL` | Optional | Base URL for ASR completions (default: `https://ai.api.nvidia.com/v1`). |
| `ASR_API_KEY` / `NVIDIA_API_KEY` | Optional | Server-side key for NVIDIA NIM Whisper ASR (`nvapi-...`). If unset, server ASR is disabled and browser Web Speech fallback is used. |
| `ASR_MODEL` | Optional | Multilingual ASR model served at base URL (default: `openai/whisper-large-v3`). |
| `ASR_LANGUAGE` | Optional | Language hint (`multi` for automatic multilingual detection). |
| `AUTHORIZED_PARTNER_API_URL` | Optional | Destination HTTPS endpoint for authorized emergency partner integrations. |
| `AUTHORIZED_PARTNER_API_KEY` | Optional | Authentication key for authorized partner dispatch (server-side only). |
| `PRIVACY_CONTACT_EMAIL` | Optional | Server-side destination mailbox for Privacy Contact Form submissions. |
| `SMTP_HOST` / `SMTP_PORT` | Optional | SMTP relay configuration for Privacy Contact Form delivery. |
| `SMTP_SECURE` | Optional | `true` for port 465 (TLS); `false` for port 587 (STARTTLS). |
| `SMTP_USER` / `SMTP_PASS` | Optional | SMTP authentication credentials. |
| `PRIVACY_CONTACT_FROM` | Optional | Outgoing sender address for relayed privacy messages. |
| `TRUST_PROXY` | Optional | Express proxy trust setting (`1` in production for correct client IP rate-limiting). |

---

## Local Development & Testing

```bash
# Install dependencies
npm install

# Typecheck and production build
npm run build

# Start production server
npm run start
```

The application will be accessible at:
```
http://localhost:3000
```

*(For interactive development with live reload, run `npm run dev`.)*

---

## Privacy Policy

See **[PRIVACY_POLICY.md](PRIVACY_POLICY.md)** for complete details on privacy practices, data handling, and user controls.

---

## Legal & Branding Notice

**LifeLine AI**  
**BY MSB CREATIVE STUDIOS**

LifeLine AI and LifeLine AI branding assets are trademarks of MSB Creative Studios. All other product names, logos, and brands (including NVIDIA, Nemotron, and Nebius) are property of their respective owners.

## License

This project is licensed under the Apache License 2.0. See the [LICENSE](LICENSE) file for complete details.

### Translation/routing regression checks

```sh
npm ci
npm test
npm run lint
npm run build
npx playwright install --with-deps chromium
npm run test:integration
```

The integration suite starts the actual Express/Vite application on port 4173
and an isolated local upstream fixture on 4174. It checks the final browser
transmission values for English→Tamil, Tamil→English, English→Hindi and
Tamil→Hindi, plus failure states, routing, consent/GPS and delivery semantics.
It never contacts Nebius or a real emergency service. An existing compatible
Chromium can be supplied via `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.

Online initial analysis and “Translate SOS” now use the same server/Nebius
translation implementation. The source is `raw_transcript`, then
`original_message`/submitted original text, then legacy `message`. Analysis
preserves submitted text rather than trusting the model's rewritten transcript.
Upstream HTTP status, malformed JSON, truncation, and missing `translated_message`
are explicit translation failures, not successful offline translations. Analysis
can still succeed while the UI says **Translation unavailable — original
transmission preserved**. Offline phrasebook guidance is labelled offline.
Live linguistic quality requires separate verification against the configured
Nebius deployment; fixture tests validate the application data flow, not model
translation accuracy.
