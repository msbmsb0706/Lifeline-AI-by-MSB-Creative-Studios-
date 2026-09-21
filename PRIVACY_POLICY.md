# Privacy Policy for LifeLine AI

**Application Name:** LifeLine AI  
**Developer:** MSB Creative Studios  
**Effective Date:** 18 September 2026  
**Last Updated:** 21 September 2026  

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
- **One-Time GPS for Silent SOS:** Silent SOS requests the device position **once** for the active session (a single `getCurrentPosition` call). There is no continuous `watchPosition` and no movement tracking.
- **Pre-Sharing Notice:** A mandatory location privacy confirmation dialog is shown before coordinates are included or shared.
- **No Background Tracking:** LifeLine AI does **not** track user movements or collect background location data.

### 2.4 Camera, Images & SOS Video
- **User Action Only:** The camera is accessed only after an explicit, immediate user action (e.g., attaching visual hazard evidence in Silent SOS).
- **Up to Two Still Images:** The user may capture or select a maximum of two still images as emergency evidence.
- **Optional 10-Second SOS Video:** The user may tap **CAPTURE SOS VIDEO** to record an optional clip of up to 10 seconds. Recording starts only after that tap, stops automatically at 10 seconds (or sooner if cancelled), and camera tracks are released immediately afterward.
- **Evidence Only:** Photos and video are attached as evidence for the user to review and share. They are **not** sent to a vision AI model and are not analyzed by Nemotron.
- **No Continuous Surveillance:** There is no background camera access, facial recognition, or automatic scanning.

### 2.5 Privacy Contact Form
- **Usage:** If you choose to contact us through the Privacy Contact Form, we receive the name you optionally provide, the email address you provide, and your message. See **Section 9** for details.
- **Purpose Limitation:** This information is used only to respond to your request.

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

- **User-Initiated Sharing Only:** LifeLine AI does **not** automatically contact 911, government agencies, rescue services, or emergency responders without user action. All sharing (via Web Share API, SMS, or clipboard copy) requires direct, intentional review and confirmation from the user. Completing a photo or video capture does not share anything.
- **No Commercial Monetization:** We do not sell, rent, lease, or monetize your emergency information, personal details, or location data.
- **No Third-Party Advertising:** There are zero advertisement SDKs, tracking pixels, or cross-site analytics embedded within LifeLine AI.

---

## 6. Third-Party Service Providers

In Online Mode, the application communicates with the following infrastructure:
- **Nebius Token Factory / NVIDIA Nemotron:** Used exclusively by the server backend to perform natural language triage classification and multilingual emergency translation. No personal identifiers are forwarded.
- **Email Delivery (Privacy Contact Form only):** When you submit the Privacy Contact Form, the LifeLine AI server relays your message to the MSB Creative Studios privacy mailbox through a standard email (SMTP) delivery provider. Emergency transcripts, location data, photos and video are never sent through this channel.
- All communications are secured using industry-standard Transport Layer Security (TLS/HTTPS).

---

## 7. Children's Privacy

LifeLine AI is designed as a general utility emergency tool. It is not directed at or marketed specifically to children under the age of 13. We do not knowingly collect or solicit personal information from children.

---

## 8. Security & Credential Protection

- All server communication occurs over HTTPS.
- Third-party API keys (`NEBIUS_API_KEY`) remain strictly confidential on the server backend and are never bundled, transmitted, or revealed to the client browser or client code.
- The destination mailbox and email delivery credentials used by the Privacy Contact Form are stored only as server-side environment variables. They are never included in the website, the app, API responses, or the public source code repository.
- Cryptographic keys, secrets, and private configuration files are strictly excluded from public version control.

---

## 9. Contact & Privacy Requests

If you have questions, concerns, or feedback about this Privacy Policy, or wish to make a privacy request (for example, a question about data handling or a request to access or delete information), you can contact **MSB Creative Studios** through the **Privacy Contact Form**.

**How to reach the form**
- In the LifeLine AI website or app, open **Privacy & Safety** and tap **Open Privacy Contact Form** / **Contact Privacy Team**, or use the **Contact Privacy Team** link in the page footer.

**What the form collects**
- **Name** (optional)
- **Email address** (required — so that we can reply to you)
- **Message** (required)

**How the submitted information is used**
- The information you submit is used **only to respond to your request**. It is not used for marketing, profiling, or advertising, is not sold or shared with third parties for their own purposes, and is not sent to any AI model.
- Your message is transmitted over HTTPS to the LifeLine AI server, which forwards it to the MSB Creative Studios privacy team by email. No email address is published in the app or website. The privacy contact destination is configured by the operator of the LifeLine AI service and is kept private on the server.
- Because an email address is required in order to reply, submissions through the form are **not anonymous**.
- The form is protected against automated abuse (input validation and rate limiting). The server does not log the contents of your message or your email address.

**Please note**
- The Privacy Contact Form is **not** an emergency channel. In an emergency, contact your local emergency services directly (for example 911, 112, or 108).

**Repository:** https://github.com/msbmsb0706/Lifeline-AI-by-MSB-Creative-Studios-
