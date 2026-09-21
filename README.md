# LifeLine AI

**BY MSB CREATIVE STUDIOS**

LifeLine AI by MSB Creative Studios is an emergency triage application for voice and text distress reports. It classifies likely emergency type and severity, produces a locally generated SOS card, and lets the user review and share an alert package. LifeLine AI currently has no automatic government or rescue dispatch.

---

## Overview

LifeLine AI helps a user describe an emergency by speaking or typing, then returns a structured triage result. When the server is configured for online analysis, the Node/Express backend sends the transcript to the configured NVIDIA Nemotron model through Nebius Token Factory. When the key is missing or the user chooses Resilience mode, classification stays on local deterministic rules and does not call cloud AI.

The product is designed for explicit user control: microphone, GPS, camera, and sharing are activated by the user. Location is requested once for the active Silent SOS session. Up to two still images and an optional 10-second SOS video may be attached as evidence. Photo and video evidence are not sent to a vision AI model.

---

## Features

### Emergency voice and text triage

- Voice input uses the browser Web Speech API on the device; raw audio is not stored by LifeLine AI.
- Text or transcript is classified into emergency type, severity, needs, and a dispatch-style message.
- Results appear as an on-screen SOS card the user can copy, translate (when available), or share after confirmation.

### Online analysis (Nebius Token Factory / NVIDIA Nemotron)

When `NEBIUS_API_KEY` is set on the server, the backend calls the configured NVIDIA Nemotron model through Nebius Token Factory. The API key stays on the server and is not exposed to the browser.

### Offline / Resilience mode

When the user enables offline mode, or the API key is not configured, LifeLine AI uses local deterministic triage rules. No cloud AI request is made.

### Silent SOS

Silent SOS is a user-activated alert flow:

1. The user opens Silent SOS and selects an emergency type (optional message).
2. The app requests **current device GPS once** (`getCurrentPosition`). There is **no background GPS tracking** and **no `watchPosition`**. GPS is device geolocation, not inferred from video.
3. The user may capture or select **up to two images** as emergency evidence. There is **no continuous camera**.
4. The user may tap **CAPTURE SOS VIDEO** to record an optional **10-second** clip. Recording starts only after that tap and stops automatically at 10 seconds (or sooner if the user stops or cancels). Camera tracks are released immediately afterward.
5. Photo and video files are **evidence only**. They are **not** sent to a vision AI model and are **not** analyzed by Nemotron.
6. A review screen shows emergency type, severity, location or GPS-unavailable reason, timestamp, optional message, selected images, and video if present.
7. Sharing happens only after explicit confirmation (`navigator.share` with files when the browser supports file sharing, otherwise clipboard/text). If files cannot be attached, the UI states that photo/video attachments could not be included.
8. LifeLine AI **never automatically contacts** government or rescue services. Completing video capture does not share anything.

GPS errors are shown separately: permission denied, position unavailable, timeout, or geolocation unsupported.

Motion sensors, when present, are an optional session signal only. Sensor data is not proof of an emergency.

---

## Emergency Partner Integration Framework

LifeLine AI includes a country-aware Emergency Partner integration framework supporting three distinct provider types:

### Provider Types

1. **TEST / DEMO PROVIDER**
   - Labeled clearly: `"TEST EMERGENCY PARTNER — DEMONSTRATION ONLY"`.
   - Used exclusively for system demonstrations.
   - Simulates receiving an SOS package and returns a mock acknowledgment with a reference ID (`DEMO-ACK-XXXXX`).
   - Does NOT send alerts to any real government, police, fire, or rescue organization.

2. **PUBLIC CONTACT PROVIDER**
   - Displays officially published emergency contact numbers and websites (e.g., 911 in US, 112 in EU/India, 108 in India, 999 in UK, 000 in Australia).
   - Only populates contacts from verified official government sources.
   - Clearly states that no digital API exists for automated dispatch.
   - Does NOT automatically upload GPS, photos, or video to public telephone lines or websites unless explicitly supported by documented submission methods.

3. **AUTHORIZED API PROVIDER**
   - Used only when an organization has provided an actual, documented API interface.
   - Sends the structured SOS package over secure HTTPS to the authorized endpoint.
   - Credentials remain server-side and are never exposed in browser or client code.
   - Supports request validation, authentication, provider acknowledgment, error handling, and safe retries.

### Offline-First & Pending Transmission Queue

- **Offline SOS Generation**: Device GPS can be acquired offline if location hardware is available. Offline emergency classification, photo evidence (up to 2 images), and 10-second video recording continue to function without internet.
- **Local Storage**: When offline, an SOS package (containing SOS ID, timestamp, emergency type, severity, message, GPS coordinates/accuracy, photo/video evidence metadata, and source status) is saved locally only after explicit user review and confirmation.
- **Connectivity & Consent**: Cloud or API transmission cannot occur without an active communication path. Before any automatic transmission when connectivity returns, a privacy-preserving user setting ("Send pending SOS when connection returns") is provided.
- **Privacy Default**: Automatic transmission on connection return defaults to `OFF`. If enabled and the user explicitly approved partner transmission, the queue detects network connectivity, transmits to the authorized/test endpoint, prevents duplicate submissions, and marks the SOS as `SENT` only after receiving a valid provider acknowledgment.
- **Media Upload Limits**: Photos and video are only transmitted to a real provider if its documented API interface explicitly supports media uploads.
- **User Review & Control**: Mandatory explicit consent modal is shown prior to any transmission. Users can view, manually transmit, or delete any unsent pending SOS from the queue at any time.

---

## Architecture

```
Browser  →  Node/Express backend  →  NVIDIA Nemotron (Nebius Token Factory)
                 │
                 ├─ Emergency Partner API Endpoint (/api/emergency-partner/dispatch)
                 │     ├─ TEST Provider (Mock Acknowledgment & Reference ID)
                 │     ├─ AUTHORIZED API Provider (Server-Side HTTPS Authentication)
                 │     └─ PUBLIC CONTACT Provider (Direct Phone/Website Info Only)
                 │
                 └─ Offline / Resilience mode: local deterministic rules (no cloud AI)
```

- Browser talks to the LifeLine backend over relative API routes.
- Online analysis uses the server-side Nebius Token Factory configuration.
- Emergency partner dispatch occurs via server-side endpoints with full payload validation and secret protection.
- Offline mode remains local and does not call cloud AI services.

---

## Environment variables

Configure these in a local `.env` file (copy from `.env.example`). **`.env` is local only and must never be committed.**

| Variable | Purpose |
|---|---|
| `PORT` | HTTP listen port (default `3000`) |
| `NEBIUS_API_KEY` | Server-side Nebius Token Factory key. If empty, online analysis is unavailable. |
| `NEBIUS_BASE_URI` | Nebius Token Factory API base URI |
| `NEBIUS_MODEL` | Configured NVIDIA Nemotron model identifier |
| `AUTHORIZED_PARTNER_API_URL` | Optional server-side HTTPS URL for authorized partner API dispatch |
| `AUTHORIZED_PARTNER_API_KEY` | Optional server-side API key for authorized partner API dispatch |

No API keys, secrets, credentials, or `.env` files are committed to Git.

---

## Local development

**Development / testing only.** `http://localhost:3000` is not a production URL.

```bash
npm install
npm run build
npm run start
```

Then open:

```
http://localhost:3000
```

(`npm run start` serves the production build. For live reload during development, `npm run dev` is also available.)

---

## Production

Do not treat localhost as a public deployment.

---

## Privacy

See **[PRIVACY_POLICY.md](PRIVACY_POLICY.md)**.

Implemented controls include:

- Microphone only when the user starts voice input; no background listening.
- One-time GPS for Silent SOS; no movement tracking.
- Camera only for user-selected still evidence (maximum two images); no continuous camera.
- Images are not sent to a vision model.
- Sharing and partner transmission require explicit review and confirmation.
- No automatic contact of government or rescue services without authorized API integration.
- History is opt-in local storage only; default is no retention.
- No advertising SDKs or third-party telemetry.

---

## Security

- `NEBIUS_API_KEY` and partner API credentials remain server-side only.
- `.env` is gitignored and must never be committed.
- No secrets, credentials, keystores, or certificates are tracked in this repository.

---

## Branding

**LifeLine AI**  
**BY MSB CREATIVE STUDIOS**

Developed by MSB Creative Studios. All rights reserved.
