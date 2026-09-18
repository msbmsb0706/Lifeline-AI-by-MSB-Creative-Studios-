# Privacy Policy for LifeLine AI

**Application Name:** LifeLine AI  
**Developer:** MSB Creative Studios  
**Effective Date:** 18 September 2026  

---

## 1. Overview & Commitment

MSB Creative Studios built **LifeLine AI** as an emergency assistance, triage classification, and resilience application. We understand that during critical emergencies, personal privacy and data security are paramount. 

LifeLine AI is engineered with a strict **privacy-first, zero-retention default** architecture. This Privacy Policy outlines what information is processed, when and why permissions are requested, how data is handled across Online and Offline modes, and your rights.

---

## 2. Permissions & Data Collection

LifeLine AI accesses hardware features only when explicitly activated by the user for emergency assistance purposes:

### 2.1 Microphone & Audio
- **Usage:** Used solely when the user taps the Emergency Voice Button or Voice input trigger.
- **Local Speech Processing:** LifeLine AI utilizes client-side speech recognition (the browser's native Web Speech API). Audio streams are processed locally in real time on the device to produce text transcripts.
- **No Audio Storage:** Raw audio recordings or voice clips are **never recorded to disk, retained, or transmitted** to any remote storage servers.
- **Continuous Listening:** The application does **not** listen in the background. Microphone access terminates immediately when the user stops speaking or closes the session.

### 2.2 Emergency Text & Triage Information
- **Usage:** User-entered or speech-transcribed emergency text (e.g., situation details, symptoms, hazards) is analyzed to extract actionable triage assessments, required emergency units (EMS, Fire, Police), and dispatch scripts.
- **Transmission:** 
  - **Online Mode:** When connected to the internet and configured with the backend service, the transcript text is sent via HTTPS to the LifeLine AI server and forwarded to the backend AI inference engine (NVIDIA Nemotron via Nebius Token Factory) solely to generate the structured emergency response JSON.
  - **Offline Resilience Mode:** No network calls are made. The text is classified entirely locally on your device or container using deterministic local pattern-matching algorithms.

### 2.3 Location Data
- **Explicit Activation Only:** Location data (GPS coordinates) is requested **only** when the user chooses to include location in an emergency report or activates location sharing.
- **Pre-Sharing Notice:** A mandatory location privacy confirmation dialog is shown before coordinates are included or shared.
- **No Background Tracking:** LifeLine AI does **not** track user movements or collect background location data.

### 2.4 Camera & Images
- **Usage:** Camera or image upload features (if accessed) occur only with explicit, immediate user action (e.g., attaching visual hazard evidence).
- **No Continuous Surveillance:** There is no background camera access, facial recognition, or automatic scanning.

---

## 3. Online Mode vs. Offline Resilience Mode

| Feature | Online AI Mode | Offline Resilience Mode |
|---|---|---|
| **AI Inference** | Backend-hosted NVIDIA Nemotron via Nebius Token Factory | Local deterministic rule classifier |
| **Data Transmission** | Emergency text transcript sent via encrypted HTTPS | **Zero** external network requests |
| **Cloud Storage** | None (ephemeral request/response processing) | None |
| **API Keys** | Secured server-side only; never exposed to client | No API key required |

---

## 4. Data Storage & Retention

- **Ephemeral by Default:** LifeLine AI operates on a **zero-retention default**. Emergency reports, transcripts, and triage outputs vanish from memory when the application is reloaded or the browser tab is closed.
- **Opt-In Local History:** If you explicitly choose to turn on the "Local History Storage" toggle, emergency cards are saved **only to your device's browser `localStorage`**. They are never synchronized to any cloud database.
- **Data Deletion:** You can delete all locally stored records at any moment using the "Clear All Records" button in the Privacy & Safety panel.

---

## 5. Emergency Sharing & Third-Party Disclosure

- **User-Initiated Sharing Only:** LifeLine AI does **not** automatically contact 911, government agencies, or emergency responders without user action. All sharing (via Web Share API, SMS, or clipboard copy) requires direct, intentional confirmation from the user.
- **No Commercial Monetization:** We do not sell, rent, lease, or monetize your emergency information, personal details, or location data.
- **No Third-Party Advertising:** There are zero advertisement SDKs, tracking pixels, or cross-site analytics embedded within LifeLine AI.

---

## 6. Third-Party Service Providers

In Online Mode, the application communicates with the following infrastructure:
- **Nebius Token Factory / NVIDIA Nemotron:** Used exclusively by the server backend to perform natural language triage classification and multilingual emergency translation. No personal identifiers are forwarded.
- All communications are secured using industry-standard Transport Layer Security (TLS/HTTPS).

---

## 7. Children's Privacy

LifeLine AI is designed as a general utility emergency tool. It is not directed at or marketed specifically to children under the age of 13. We do not knowingly collect or solicit personal information from children.

---

## 8. Security & Credential Protection

- All server communication occurs over HTTPS.
- Third-party API keys (`NEBIUS_API_KEY`) remain strictly confidential on the server backend and are never bundled, transmitted, or revealed to the client browser or client code.
- Cryptographic keys, secrets, and private configuration files are strictly excluded from public version control.

---

## 9. Contact & Inquiries

If you have questions, concerns, or feedback regarding this Privacy Policy or data safety practices, please contact:

**MSB Creative Studios**  
- **Email:** privacy@msbcreativestudios.com  
- **Developer Inquiries:** msbmsb0706@gmail.com  
- **Repository:** https://github.com/msbmsb0706/Lifeline-AI-by-MSB-Creative-Studios-
