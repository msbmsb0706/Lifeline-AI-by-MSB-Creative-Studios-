import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import { classifyEmergencyOffline } from './src/lib/offlineClassifier.ts';
import {
  detectLanguage,
  standardizeCategory,
  getLanguageByCodeOrName,
  SUPPORTED_LANGUAGES,
  STANDARDIZED_CATEGORIES
} from './src/lib/languages.ts';
import { NemotronEmergencyResponse, SeverityLevel, StandardEmergencyCategory, DetectedLanguage } from './src/types.ts';
import { createPrivacyContactRouter, getPrivacyContactConfigStatus } from './server/privacyContact.ts';
import { getEmergencyPartnerConfig } from './server/partnerConfig.ts';
import { looksLikeGeneratedDispatch } from './src/lib/translationSafety.ts';
import {
  resolveEmergencyTranslation,
  translateForOnlineAnalysis
} from './server/translation.ts';

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const NEBIUS_BASE_URI = (process.env.NEBIUS_BASE_URI || process.env.NEBIUS_BASE_URL || 'https://api.tokenfactory.us-central1.nebius.com/v1').replace(/\/+$/, '');
const NEBIUS_MODEL = process.env.NEBIUS_MODEL || 'nvidia/nemotron-3-super-120b-a12b';

/**
 * Multilingual voice ASR (speech-to-text) configuration — SERVER-SIDE ONLY.
 *
 * Verified landscape (2026-09):
 * - Nebius Token Factory exposes NO speech/audio endpoints (LLM chat/completions,
 *   embeddings, rerank, image generation only). ASR therefore cannot ride the
 *   existing Nebius infrastructure.
 * - NVIDIA's multilingual ASR option is the `openai/whisper-large-v3` NIM
 *   (batch, auto language detection via `language=multi`, OpenAI-style multipart
 *   POST {base}/v1/audio/transcriptions). NVIDIA-hosted access requires an
 *   NVIDIA_API_KEY (nvapi-...) from build.nvidia.com; self-hosted NIM containers
 *   use the same request shape at their own base URL. NVIDIA Riva offers
 *   streaming ASR over gRPC but requires separate credentials/infrastructure.
 *
 * The endpoint below is disabled unless ASR_PROVIDER !== 'none' AND an API key
 * AND a base URL are configured. The client falls back to the existing browser
 * Web Speech API voice path when ASR is not configured. No credentials are ever
 * exposed to the frontend and no audio is persisted on the server.
 */
const ASR_PROVIDER = (process.env.ASR_PROVIDER || 'nvidia_nim').trim();
const ASR_BASE_URL = (process.env.ASR_BASE_URL || 'https://ai.api.nvidia.com/v1').replace(/\/+$/, '');
const ASR_API_KEY = (process.env.ASR_API_KEY || process.env.NVIDIA_API_KEY || '').trim();
const ASR_MODEL = (process.env.ASR_MODEL || 'openai/whisper-large-v3').trim();
// 'multi' enables provider-side automatic language detection (NVIDIA NIM Whisper).
// Set an ISO code to pin a language, or '' to omit the field entirely.
const ASR_LANGUAGE = process.env.ASR_LANGUAGE !== undefined ? process.env.ASR_LANGUAGE.trim() : 'multi';
const ASR_CONFIGURED = ASR_PROVIDER !== 'none' && Boolean(ASR_API_KEY) && Boolean(ASR_BASE_URL);

/**
 * Express "trust proxy" setting. Behind a hosting proxy (Render, Cloud Run, etc.)
 * the client address used for rate limiting must come from X-Forwarded-For,
 * otherwise every visitor would share the proxy's IP. Defaults to one trusted
 * hop in production and none in development; override with TRUST_PROXY
 * ("true", "false", a hop count, or a comma-separated list of proxy IPs/subnets).
 */
function resolveTrustProxy(): boolean | number | string {
  const raw = (process.env.TRUST_PROXY || '').trim();
  if (!raw) return process.env.NODE_ENV === 'production' ? 1 : false;
  if (raw.toLowerCase() === 'true') return true;
  if (raw.toLowerCase() === 'false') return false;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
}

/**
 * Combine the ASR provider's reported language with LifeLine's deterministic
 * script-based detection. Unicode-script detection is authoritative for Indic
 * scripts; the ASR-reported language is used otherwise. Unknown ASR labels fall
 * back to script detection rather than being silently mapped to English.
 */
function normalizeAsrLanguage(rawLanguage: unknown, transcript: string): DetectedLanguage {
  const scriptDetected = detectLanguage(transcript);

  if (scriptDetected.code !== 'en') {
    return { ...scriptDetected, source: 'script' };
  }

  if (typeof rawLanguage === 'string' && rawLanguage.trim()) {
    const clean = rawLanguage.trim().toLowerCase();
    const explicit = SUPPORTED_LANGUAGES.find(
      (l) => l.code.toLowerCase() === clean || l.name.toLowerCase() === clean || l.nativeName.toLowerCase() === clean
    );
    if (explicit) {
      return { code: explicit.code, name: explicit.name, confidence: 0.9, source: 'asr' };
    }
  }

  return { ...scriptDetected, source: 'script' };
}

/** Best-effort file extension for a browser audio MIME type (cosmetic only). */
function audioExtensionFromMime(mimeType: string): string {
  if (mimeType.includes('webm')) return 'webm';
  if (mimeType.includes('mp4') || mimeType.includes('aac') || mimeType.includes('m4a')) return 'm4a';
  if (mimeType.includes('ogg') || mimeType.includes('opus')) return 'ogg';
  if (mimeType.includes('wav')) return 'wav';
  if (mimeType.includes('mpeg')) return 'mp3';
  return 'webm';
}

async function startServer() {
  const app = express();

  app.set('trust proxy', resolveTrustProxy());
  // /api/transcribe-speech carries transient base64-encoded speech audio and
  // needs the larger JSON body limit; every other endpoint keeps the original
  // 1 MB limit. (express.json skips requests already parsed by a prior parser.)
  app.use('/api/transcribe-speech', express.json({ limit: '14mb' }));
  app.use(express.json({ limit: '1mb' }));

  console.log('[Nebius Diagnostics] LifeLine AI Backend Initialized');
  console.log('[Nebius Diagnostics] NEBIUS_BASE_URI:', NEBIUS_BASE_URI);
  console.log('[Nebius Diagnostics] NEBIUS_MODEL:', NEBIUS_MODEL);
  console.log('[Nebius Diagnostics] NEBIUS_API_KEY configured:', Boolean(process.env.NEBIUS_API_KEY));
  console.log('[ASR Diagnostics] Provider:', ASR_PROVIDER, '| Model:', ASR_MODEL, '| Base URL:', ASR_BASE_URL);
  console.log('[ASR Diagnostics] Multilingual voice ASR configured:', ASR_CONFIGURED);

  // Privacy Contact Form — destination mailbox and SMTP credentials are server-side only.
  // Only booleans are logged; the address itself is never printed or exposed.
  const privacyContactStatus = getPrivacyContactConfigStatus();
  console.log('[Privacy Contact] PRIVACY_CONTACT_EMAIL configured:', privacyContactStatus.destinationConfigured);
  console.log('[Privacy Contact] SMTP delivery configured:', privacyContactStatus.smtpConfigured);
  app.use('/api/privacy-contact', createPrivacyContactRouter());

  // System status endpoint - NEVER reveals keys
  app.get('/api/status', (req, res) => {
    const isConfigured = Boolean(process.env.NEBIUS_API_KEY && process.env.NEBIUS_API_KEY.trim() !== '');
    res.json({
      nebius_configured: isConfigured,
      base_uri: NEBIUS_BASE_URI,
      model: NEBIUS_MODEL,
      status: isConfigured ? 'online' : 'offline_ready',
      server_time: new Date().toISOString(),
      supported_languages: SUPPORTED_LANGUAGES.map(l => l.code),
      standardized_categories: STANDARDIZED_CATEGORIES.map(c => c.id),
      // Multilingual voice ASR availability. Only booleans/model names — never keys.
      asr: {
        configured: ASR_CONFIGURED,
        provider: ASR_PROVIDER,
        model: ASR_MODEL
      }
    });
  });

  // ============================================================================
  // Multilingual voice ASR (speech-to-text) — transient server-side proxy.
  //
  // Audio arrives as base64 in a JSON body, is held only in memory for the
  // duration of the upstream ASR call, and is NEVER written to disk or logged.
  // When no ASR provider is configured this endpoint returns a structured
  // error and the client automatically falls back to the existing browser
  // Web Speech API voice path. Results are never fabricated.
  // ============================================================================
  app.post('/api/transcribe-speech', async (req, res) => {
    const startTime = Date.now();
    const { audioBase64, mimeType, durationMs } = req.body || {};

    if (!ASR_CONFIGURED) {
      res.status(400).json({
        success: false,
        code: 'ASR_NOT_CONFIGURED',
        error: 'Multilingual voice ASR is not configured on this server. Set ASR_PROVIDER / ASR_BASE_URL / ASR_API_KEY / ASR_MODEL (server-side only — see .env.example). Browser voice fallback remains available.'
      });
      return;
    }

    if (!audioBase64 || typeof audioBase64 !== 'string' || audioBase64.length === 0) {
      res.status(400).json({ success: false, code: 'ASR_INVALID_AUDIO', error: 'Audio payload is required for transcription.' });
      return;
    }

    if (typeof durationMs === 'number' && durationMs > 90_000) {
      res.status(413).json({ success: false, code: 'ASR_TOO_LONG', error: 'Recording exceeds the 90-second limit for emergency voice capture.' });
      return;
    }

    const audioBuffer = Buffer.from(audioBase64, 'base64');
    if (audioBuffer.length === 0) {
      res.status(400).json({ success: false, code: 'ASR_INVALID_AUDIO', error: 'Audio payload could not be decoded.' });
      return;
    }
    if (audioBuffer.length > 10 * 1024 * 1024) {
      res.status(413).json({ success: false, code: 'ASR_TOO_LARGE', error: 'Audio payload exceeds the 10 MB limit.' });
      return;
    }

    const audioMime = typeof mimeType === 'string' && /^audio\//.test(mimeType) ? mimeType : 'audio/webm';

    try {
      // OpenAI-compatible multipart request shape (NVIDIA NIM / self-hosted NIM compatible).
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(audioBuffer)], { type: audioMime }), `speech.${audioExtensionFromMime(audioMime)}`);
      if (ASR_MODEL) form.append('model', ASR_MODEL);
      if (ASR_LANGUAGE) form.append('language', ASR_LANGUAGE);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20_000);

      console.log(`[ASR Request] Transcribing ${(audioBuffer.length / 1024).toFixed(1)} KB ${audioMime} via ${ASR_PROVIDER} (${ASR_MODEL})`);

      const asrResponse = await fetch(`${ASR_BASE_URL}/audio/transcriptions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ASR_API_KEY}`,
          'Accept': 'application/json'
        },
        body: form,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!asrResponse.ok) {
        const errBody = await asrResponse.text();
        console.error('[ASR Response] Upstream error:', asrResponse.status, errBody.slice(0, 300));
        res.status(502).json({
          success: false,
          code: 'ASR_UPSTREAM_ERROR',
          error: `Speech recognition provider returned HTTP ${asrResponse.status}. Your transcript was not changed — tap the microphone to retry, use browser voice, or type the emergency.`
        });
        return;
      }

      const rawJson: any = await asrResponse.json();
      const transcript = typeof rawJson?.text === 'string' ? rawJson.text.trim() : '';

      if (!transcript) {
        res.status(502).json({
          success: false,
          code: 'ASR_EMPTY_RESULT',
          error: 'No speech was recognized in the recording. Tap the microphone and try again, or type the emergency.'
        });
        return;
      }

      const detectedLanguage = normalizeAsrLanguage(rawJson?.language, transcript);
      const latencyMs = Date.now() - startTime;
      console.log(`[ASR Response] OK in ${latencyMs}ms — detected ${detectedLanguage.name} (${detectedLanguage.code}), ${transcript.length} chars`);

      res.json({
        success: true,
        data: {
          transcript,
          detected_language: detectedLanguage,
          asr_provider: ASR_PROVIDER,
          asr_model: ASR_MODEL,
          duration_ms: typeof durationMs === 'number' ? Math.round(durationMs) : null,
          latency_ms: latencyMs
        }
      });
    } catch (err: any) {
      const aborted = err?.name === 'AbortError';
      console.error('[ASR Request] Failed:', err?.message || err);
      res.status(502).json({
        success: false,
        code: aborted ? 'ASR_TIMEOUT' : 'ASR_REQUEST_FAILED',
        error: aborted
          ? 'Speech recognition timed out. Tap the microphone to retry, use browser voice, or type the emergency.'
          : `Speech recognition request failed: ${err?.message || 'network error'}. Your transcript was not changed — you can retry or type the emergency.`
      });
    }
  });

  // ============================================================================
  // English translation of an original-language emergency transcript.
  // Uses the existing Nebius Token Factory / NVIDIA Nemotron chat integration.
  // On failure this returns success:false — the client keeps the original
  // transcript and never displays a fabricated English translation.
  // ============================================================================
  app.post('/api/translate-to-english', async (req, res) => {
    const startTime = Date.now();
    const { text, sourceLanguage } = req.body || {};

    if (!text || typeof text !== 'string' || !text.trim()) {
      res.status(400).json({ success: false, code: 'TRANSLATION_INVALID_INPUT', error: 'Transcript text is required for translation.' });
      return;
    }

    const sourceText = text.trim().slice(0, 5000);
    const apiKey = process.env.NEBIUS_API_KEY ? process.env.NEBIUS_API_KEY.trim() : '';

    if (!apiKey) {
      res.status(400).json({
        success: false,
        code: 'TRANSLATION_UNAVAILABLE',
        error: 'Nebius Token Factory is not configured (NEBIUS_API_KEY missing). The original transcript is preserved and triage can proceed in the original language.'
      });
      return;
    }

    try {
      const systemPrompt = `You are LifeLine AI's emergency speech translation engine.
Translate the spoken emergency transcript into clear, literal English.
RULES:
1. Preserve urgency, symptoms, locations, numbers, names, and instructions exactly.
2. Do NOT answer, advise, summarize, or add any information that is not in the transcript.
3. The transcript may contain speech recognition artifacts; translate the intended spoken meaning.
4. Output ONLY valid JSON: {"english_translation": string}. No markdown fences, no preamble.`;

      const userPrompt = `DETECTED SOURCE LANGUAGE: ${typeof sourceLanguage === 'string' && sourceLanguage.trim() ? sourceLanguage.trim() : 'auto-detect'}\nTRANSCRIPT:\n"${sourceText}"`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12_000);

      const nebiusResponse = await fetch(`${NEBIUS_BASE_URI}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: NEBIUS_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.1,
          response_format: { type: 'json_object' },
          max_tokens: 800
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!nebiusResponse.ok) {
        const errText = await nebiusResponse.text();
        console.error('[Translate-to-EN] Nebius error:', nebiusResponse.status, errText.slice(0, 300));
        res.status(502).json({
          success: false,
          code: 'TRANSLATION_FAILED',
          error: `Nebius Token Factory returned HTTP ${nebiusResponse.status} while translating. The original transcript is preserved and triage can proceed in the original language.`
        });
        return;
      }

      const rawJson = await nebiusResponse.json();
      const assistantText = rawJson?.choices?.[0]?.message?.content;
      if (!assistantText) {
        throw new Error('Empty translation response from Nebius Token Factory');
      }

      const cleaned = assistantText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const parsed = JSON.parse(cleaned);
      const englishTranslation = typeof parsed?.english_translation === 'string' ? parsed.english_translation.trim() : '';

      if (!englishTranslation) {
        res.status(502).json({
          success: false,
          code: 'TRANSLATION_FAILED',
          error: 'The translation engine returned no usable English text. The original transcript is preserved and triage can proceed in the original language.'
        });
        return;
      }

      res.json({
        success: true,
        data: {
          english_translation: englishTranslation,
          source_language: typeof sourceLanguage === 'string' ? sourceLanguage : null,
          original_message: sourceText,
          model_used: NEBIUS_MODEL,
          source: 'nebius_nemotron',
          latency_ms: Date.now() - startTime
        }
      });
    } catch (err: any) {
      console.error('[Translate-to-EN] Failed:', err?.message || err);
      res.status(502).json({
        success: false,
        code: err?.name === 'AbortError' ? 'TRANSLATION_TIMEOUT' : 'TRANSLATION_FAILED',
        error: `English translation failed: ${err?.message || 'network error'}. The original transcript is preserved and triage can proceed in the original language.`
      });
    }
  });

  // Dedicated Test Nebius Connection endpoint (Requirement 12)
  app.post('/api/test-nebius', async (req, res) => {
    const startTime = Date.now();
    const testTranscript = "This is a test emergency. A person needs medical assistance.";
    const apiKey = process.env.NEBIUS_API_KEY ? process.env.NEBIUS_API_KEY.trim() : '';

    console.log('[Nebius Diagnostics] /api/test-nebius called');
    console.log('[Nebius Diagnostics] Sending test request to:', `${NEBIUS_BASE_URI}/chat/completions`);
    console.log('[Nebius Diagnostics] Target Model:', NEBIUS_MODEL);

    if (!apiKey) {
      res.status(400).json({
        success: false,
        test_message: testTranscript,
        endpoint: `${NEBIUS_BASE_URI}/chat/completions`,
        model: NEBIUS_MODEL,
        status_code: 400,
        error: 'NEBIUS_API_KEY is not configured in server environment.',
        latency_ms: Date.now() - startTime
      });
      return;
    }

    try {
      const authHeader = apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      const nebiusResponse = await fetch(`${NEBIUS_BASE_URI}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader
        },
        body: JSON.stringify({
          model: NEBIUS_MODEL,
          messages: [
            {
              role: 'system',
              content: 'You are LifeLine AI. Analyze the emergency distress transcript and return ONLY valid JSON with schema: {"language": "English", "transcript": "the transcript", "emergency_type": "MEDICAL", "severity": 3, "needs": ["Medical personnel"], "message": "Emergency dispatch message", "visual_card": "MEDICAL EMERGENCY"}'
            },
            { role: 'user', content: testTranscript }
          ],
          temperature: 0.1,
          response_format: { type: 'json_object' },
          max_tokens: 800
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      const latencyMs = Date.now() - startTime;
      console.log('[Nebius Diagnostics] Test response status:', nebiusResponse.status, nebiusResponse.statusText);

      if (!nebiusResponse.ok) {
        const errBody = await nebiusResponse.text();
        console.log('[Nebius Diagnostics] Test error body:', errBody.slice(0, 300));
        res.status(nebiusResponse.status).json({
          success: false,
          test_message: testTranscript,
          endpoint: `${NEBIUS_BASE_URI}/chat/completions`,
          model: NEBIUS_MODEL,
          status_code: nebiusResponse.status,
          status_text: nebiusResponse.statusText,
          error: `Nebius Token Factory returned HTTP ${nebiusResponse.status}: ${errBody.slice(0, 300)}`,
          latency_ms: latencyMs,
          timestamp: new Date().toISOString()
        });
        return;
      }

      const rawJson = await nebiusResponse.json();
      const content = rawJson?.choices?.[0]?.message?.content;
      let parsed = null;
      try {
        parsed = JSON.parse(content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim());
      } catch {
        parsed = { raw_content: content };
      }

      res.json({
        success: true,
        test_message: testTranscript,
        endpoint: `${NEBIUS_BASE_URI}/chat/completions`,
        model: NEBIUS_MODEL,
        status_code: 200,
        status_text: 'OK',
        data: parsed,
        raw_completion: rawJson,
        latency_ms: latencyMs,
        timestamp: new Date().toISOString()
      });
    } catch (err: any) {
      const latencyMs = Date.now() - startTime;
      console.log('[Nebius Diagnostics] Test request exception:', err.message);
      res.status(502).json({
        success: false,
        test_message: testTranscript,
        endpoint: `${NEBIUS_BASE_URI}/chat/completions`,
        model: NEBIUS_MODEL,
        status_code: 502,
        error: `Failed to connect to Nebius Token Factory: ${err.message}`,
        latency_ms: latencyMs,
        timestamp: new Date().toISOString()
      });
    }
  });

  // Emergency analysis endpoint
  app.post('/api/analyze-emergency', async (req, res) => {
    const startTime = Date.now();
    const { text, location, offlineModeForce, language, targetLanguage } = req.body || {};

    // Optional bilingual voice context from /api/transcribe-speech + /api/translate-to-english.
    // The original transcript is the authoritative record of user speech; the English
    // translation (when present) is an aid for interoperability only.
    const rawVoiceCapture = (req.body || {}).voiceCapture || null;
    const voiceOriginalTranscript =
      rawVoiceCapture && typeof rawVoiceCapture.originalTranscript === 'string'
        ? rawVoiceCapture.originalTranscript.trim().slice(0, 5000)
        : '';
    const voiceEnglishTranslation =
      rawVoiceCapture && typeof rawVoiceCapture.englishTranslation === 'string'
        ? rawVoiceCapture.englishTranslation.trim().slice(0, 5000)
        : '';
    const voiceDetectedLanguage =
      rawVoiceCapture &&
      rawVoiceCapture.detectedLanguage &&
      typeof rawVoiceCapture.detectedLanguage.code === 'string' &&
      typeof rawVoiceCapture.detectedLanguage.name === 'string'
        ? {
            code: rawVoiceCapture.detectedLanguage.code,
            name: rawVoiceCapture.detectedLanguage.name,
            confidence: typeof rawVoiceCapture.detectedLanguage.confidence === 'number' ? rawVoiceCapture.detectedLanguage.confidence : undefined,
            source: typeof rawVoiceCapture.detectedLanguage.source === 'string' ? rawVoiceCapture.detectedLanguage.source : undefined
          }
        : null;
    // Explicit field whitelist — client-provided capture data is NEVER spread
    // into the result. Only the documented bilingual metadata fields are kept;
    // any unexpected client fields are ignored.
    const sanitizedVoiceCapture =
      rawVoiceCapture && voiceOriginalTranscript
        ? {
            asrProvider:
              typeof rawVoiceCapture.asrProvider === 'string' && rawVoiceCapture.asrProvider.trim()
                ? rawVoiceCapture.asrProvider.trim().slice(0, 100)
                : 'unknown',
            asrModel:
              typeof rawVoiceCapture.asrModel === 'string' && rawVoiceCapture.asrModel.trim()
                ? rawVoiceCapture.asrModel.trim().slice(0, 200)
                : 'unknown',
            detectedLanguage: voiceDetectedLanguage || detectLanguage(voiceOriginalTranscript),
            originalTranscript: voiceOriginalTranscript,
            ...(voiceEnglishTranslation ? { englishTranslation: voiceEnglishTranslation } : {}),
            durationMs:
              typeof rawVoiceCapture.durationMs === 'number' && Number.isFinite(rawVoiceCapture.durationMs)
                ? Math.max(0, Math.round(rawVoiceCapture.durationMs))
                : undefined,
            timestamp:
              typeof rawVoiceCapture.timestamp === 'string' && rawVoiceCapture.timestamp.trim()
                ? rawVoiceCapture.timestamp.trim().slice(0, 40)
                : new Date().toISOString()
          }
        : null;
    const hasVoiceContext = Boolean(sanitizedVoiceCapture);

    if (!text || typeof text !== 'string' || text.trim() === '') {
      res.status(400).json({ error: 'Emergency transcript or text is required.' });
      return;
    }

    const trimmedText = text.trim();
    const locationString = typeof location === 'string' ? location : (location ? JSON.stringify(location) : '');
    const detectedSourceLang = voiceDetectedLanguage || detectLanguage(trimmedText);
    const preferredLang = language || detectedSourceLang.name;

    console.log(`[LifeLine API] /api/analyze-emergency called with text: "${trimmedText.slice(0, 50)}..." (len: ${trimmedText.length}, offlineModeForce: ${Boolean(offlineModeForce)})`);

    const apiKey = process.env.NEBIUS_API_KEY ? process.env.NEBIUS_API_KEY.trim() : '';

    // If user explicitly requests offline mode
    if (offlineModeForce === true) {
      const offlineResult = classifyEmergencyOffline(trimmedText, locationString, preferredLang, targetLanguage);
      const latencyMs = Date.now() - startTime;

      res.json({
        success: true,
        data: {
          ...offlineResult,
          source: 'offline_fallback',
          model_used: 'LifeLine Deterministic Offline Triage Engine',
          timestamp: new Date().toISOString(),
          offline_notice: 'Manual offline triage mode active.',
          latency_ms: latencyMs,
        raw_transcript: trimmedText,
        location_coordinates: req.body.coordinates || null,
        detected_language: detectedSourceLang,
        voice_capture: sanitizedVoiceCapture || undefined,
        nebius_connected: false
      }
      });
      return;
    }

    // Online Mode: Verify NEBIUS_API_KEY is present
    if (!apiKey) {
      res.status(400).json({
        success: false,
        error: 'NEBIUS_API_KEY environment variable is not configured. Nebius Token Factory operates online only. Switch to Offline Mode or provide NEBIUS_API_KEY.'
      });
      return;
    }

    // Call Nebius Token Factory backend with Nemotron model
    try {
      const systemPrompt = `You are LifeLine AI, an emergency response triage intelligence engine powered by NVIDIA Nemotron via Nebius Token Factory.
Analyze the provided emergency distress transcript and return a structured JSON object matching this schema EXACTLY:
{
  "language": "detected or spoken language (e.g. English, Tamil, Hindi, Spanish)",
  "transcript": "the emergency transcript provided",
  "emergency_type": "MEDICAL|FIRE|RESCUE|FOOD|WATER|SHELTER|MISSING_PERSON|OTHER",
  "severity": 1,
  "needs": ["list of emergency resources, responder units, or medical equipment required"],
  "message": "standard high-clarity emergency dispatch radio transmission report",
  "visual_card": "high-impact headline and immediate life-saving directive for the on-screen emergency visual card"
}

CONSTRAINTS:
1. "emergency_type" MUST be strictly one of: "MEDICAL", "FIRE", "RESCUE", "FOOD", "WATER", "SHELTER", "MISSING_PERSON", "OTHER".
2. "severity" MUST be an integer from 1 to 5 (1=Minor, 2=Moderate, 3=Urgent, 4=Severe, 5=Critical).
3. "needs" MUST be an array of strings.
4. Output ONLY valid, parseable JSON matching the schema. No markdown fences (\`\`\`json) and no preamble.
5. When an ORIGINAL TRANSCRIPT and an ENGLISH TRANSLATION are provided, the original transcript is the AUTHORITATIVE record of the user's speech; the English translation is a machine-generated aid only. If they appear to conflict, prioritize the original transcript. Write "message" and "visual_card" in English for responder interoperability.`;

      const voiceContextBlock = hasVoiceContext
        ? `\nDETECTED LANGUAGE: ${detectedSourceLang.name} (${detectedSourceLang.code})\nORIGINAL TRANSCRIPT (AUTHORITATIVE USER SPEECH — ${detectedSourceLang.name}):\n"${voiceOriginalTranscript}"${
            voiceEnglishTranslation
              ? `\nENGLISH TRANSLATION (MACHINE-GENERATED AID ONLY):\n"${voiceEnglishTranslation}"`
              : `\nENGLISH TRANSLATION: unavailable — rely on the original transcript${locationString ? ' and reported location' : ''}.`
          }`
        : '';

      const userMessageContent = `EMERGENCY DISTRESS TRANSCRIPT:\n"${trimmedText}"${voiceContextBlock}${locationString ? `\nREPORTED LOCATION: ${locationString}` : ''}\nLanguage hint: ${preferredLang}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000); // 12-second timeout

      const authHeader = apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`;

      console.log(`[Nebius Request] Sending prompt to ${NEBIUS_BASE_URI}/chat/completions (Model: ${NEBIUS_MODEL})`);

      const nebiusResponse = await fetch(`${NEBIUS_BASE_URI}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader
        },
        body: JSON.stringify({
          model: NEBIUS_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessageContent }
          ],
          temperature: 0.1,
          response_format: { type: 'json_object' },
          max_tokens: 1200
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      console.log(`[Nebius Response] Status: ${nebiusResponse.status} ${nebiusResponse.statusText} (${Date.now() - startTime}ms)`);

      if (!nebiusResponse.ok) {
        const errBody = await nebiusResponse.text();
        console.error('Nebius API error status:', nebiusResponse.status, errBody);
        res.status(nebiusResponse.status || 502).json({
          success: false,
          error: `Nebius Token Factory returned HTTP ${nebiusResponse.status}: ${errBody.slice(0, 300) || 'API call failed'}`
        });
        return;
      }

      const rawJson = await nebiusResponse.json();
      const assistantText = rawJson?.choices?.[0]?.message?.content;

      if (!assistantText) {
        throw new Error('Empty completion content from Nebius Token Factory');
      }

      // Parse JSON, cleaning markdown fence if present
      let parsedNemotron: any;
      try {
        const cleaned = assistantText
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/\s*```$/i, '')
          .trim();
        parsedNemotron = JSON.parse(cleaned);
      } catch (parseErr) {
        console.error('JSON parse error from Nemotron response:', parseErr, assistantText);
        throw new Error('Malformed JSON output from Nemotron model');
      }

      // Validate core fields & sanitize
      const validTypes = ['MEDICAL', 'FIRE', 'RESCUE', 'FOOD', 'WATER', 'SHELTER', 'MISSING_PERSON', 'OTHER'];
      let emergencyType = String(parsedNemotron.emergency_type || '').toUpperCase().trim();
      if (!validTypes.includes(emergencyType)) {
        emergencyType = standardizeCategory(emergencyType || trimmedText);
      }

      const severityNum = Number(parsedNemotron.severity);
      const validatedSeverity: SeverityLevel = (
        severityNum >= 1 && severityNum <= 5
          ? Math.round(severityNum)
          : 3
      ) as SeverityLevel;

      const validatedNeeds = Array.isArray(parsedNemotron.needs) && parsedNemotron.needs.length > 0
        ? parsedNemotron.needs.map((n: any) => String(n).trim()).filter(Boolean)
        : ['Emergency Response Team'];

      const validatedMessage = typeof parsedNemotron.message === 'string' && parsedNemotron.message.trim()
        ? parsedNemotron.message.trim()
        : trimmedText;

      const visualCardText = typeof parsedNemotron.visual_card === 'string' && parsedNemotron.visual_card.trim()
        ? parsedNemotron.visual_card.trim()
        : `${emergencyType} EMERGENCY (PRIORITY ${validatedSeverity}/5)`;

      const validatedLang = typeof parsedNemotron.language === 'string' && parsedNemotron.language.trim()
        ? parsedNemotron.language.trim()
        : detectedSourceLang.name;

      const validatedTranscript = typeof parsedNemotron.transcript === 'string' && parsedNemotron.transcript.trim()
        ? parsedNemotron.transcript.trim()
        : trimmedText;

      const latencyMs = Date.now() - startTime;

      const resultData: any = {
        // Exact schema fields. When voice context is present, the ASR-detected
        // language is more reliable than the model's own language guess.
        language: hasVoiceContext ? detectedSourceLang.name : validatedLang,
        transcript: validatedTranscript,
        emergency_type: emergencyType,
        severity: validatedSeverity,
        needs: validatedNeeds,
        message: validatedMessage,
        visual_card: {
          headline: visualCardText,
          badge_color: validatedSeverity >= 4 ? 'RED' : validatedSeverity === 3 ? 'ORANGE' : 'YELLOW',
          action_steps: [
            visualCardText,
            'Ensure immediate personal safety and protect vital signs',
            'Keep communication lines open for incoming responders'
          ],
          priority_symbol: emergencyType === 'MEDICAL' ? 'HEART_PULSE' : emergencyType === 'FIRE' ? 'FLAME' : 'SHIELD_ALERT',
          instructions_for_responders: `Emergency Category: ${emergencyType} (Priority ${validatedSeverity}/5). Immediate direct on-scene access required.`,
          first_aid_actions: [
            'Assess airway, breathing, and circulation',
            'Do not move injured patient unless in immediate secondary danger'
          ]
        },
        raw_visual_card: visualCardText,
        visual_card_text: visualCardText,
        emergency_category: emergencyType as StandardEmergencyCategory,
        source: 'nebius_nemotron',
        model_used: NEBIUS_MODEL,
        timestamp: new Date().toISOString(),
        latency_ms: latencyMs,
        // The user's submitted original text — never the model-returned echo.
        raw_transcript: trimmedText,
        location_coordinates: req.body.coordinates || null,
        detected_language: detectedSourceLang,
        voice_capture: sanitizedVoiceCapture || undefined,
        nebius_connected: true
      };

      // If a target language is passed during initial analysis and differs from source, provide translation.
      // Per the multilingual data contract, `translated_message` must be a
      // faithful translation of the USER'S ORIGINAL TEXT (the transcript), never
      // the generated dispatch message.
      //
      // Online analysis succeeded → the SHARED ONLINE translation implementation
      // is used. The offline engine is NOT used merely because analysis already
      // succeeded online, and an online translation failure is reported as an
      // explicit translation error state (never a silent offline substitution).
      if (targetLanguage) {
        const targetLangObj = getLanguageByCodeOrName(targetLanguage);
        if (targetLangObj.code !== detectedSourceLang.code) {
          const initialTranslation = await translateForOnlineAnalysis(
            {
              // ONLY the user's original transmission is the translation source.
              sourceText: trimmedText,
              targetLanguage: targetLangObj.code,
              sourceLanguage: detectedSourceLang.code,
              // Structured emergency fields travel separately (locked triage +
              // separate responder/dispatch content) — they are NEVER the source.
              currentSOS: {
                emergency_category: emergencyType as StandardEmergencyCategory,
                emergency_type: emergencyType,
                severity: validatedSeverity,
                needs: validatedNeeds,
                visual_card: resultData.visual_card
              },
              location: locationString
            },
            { apiKey, baseUri: NEBIUS_BASE_URI, model: NEBIUS_MODEL }
          );

          if (initialTranslation.status === 'ok') {
            resultData.translation = initialTranslation.translation;
            resultData.translation_status = 'ok';
            resultData.translation_error = null;
          } else {
            // Successful analysis is preserved; only translation is unavailable.
            resultData.translation = undefined;
            resultData.translation_status = 'error';
            resultData.translation_error = initialTranslation.error;
            console.warn(
              '[Translation] Initial online translation unavailable:',
              initialTranslation.error.code,
              initialTranslation.error.error
            );
          }
        }
      }

      res.json({
        success: true,
        data: resultData
      });
    } catch (err: any) {
      console.error('Nebius Token Factory request failed:', err?.message || err);
      // Safety rule: Do not use Gemini as a silent fallback!
      // Do not fabricate a successful Nebius response!
      res.status(502).json({
        success: false,
        error: `Nebius Token Factory request failed: ${err?.message || 'Connection timeout or network failure'}`
      });
    }
  });

  // Dedicated multilingual translation endpoint
  app.post('/api/translate-emergency', async (req, res) => {
    const startTime = Date.now();
    const {
      text,
      targetLanguage,
      sourceLanguage,
      currentSOS,
      offlineModeForce,
      location
    } = req.body || {};

    if (!targetLanguage) {
      res.status(400).json({
        success: false,
        code: 'TRANSLATION_INVALID_INPUT',
        error: 'Target language is required for translation.'
      });
      return;
    }

    // Translation source contract (PR #16): the user's original transmission
    // ONLY — raw_transcript -> original_message -> legacy transcript. NEVER the
    // generated dispatch message (`message`), responder instructions, action
    // steps, required units, AI summaries, or structured directives.
    const providedText = typeof text === 'string' ? text.trim() : '';
    const fallbackSource =
      (typeof currentSOS?.raw_transcript === 'string' && currentSOS.raw_transcript.trim()) ||
      (typeof currentSOS?.original_message === 'string' && currentSOS.original_message.trim()) ||
      (typeof currentSOS?.translation?.original_message === 'string' && currentSOS.translation.original_message.trim()) ||
      (typeof currentSOS?.transcript === 'string' && currentSOS.transcript.trim()) ||
      '';
    const sourceText = providedText || fallbackSource;

    if (!sourceText.trim()) {
      res.status(400).json({
        success: false,
        code: 'TRANSLATION_INVALID_INPUT',
        error: 'No message content provided to translate.'
      });
      return;
    }

    // Deterministic guard (PR #16): generated dispatch/triage boilerplate is
    // never accepted as the user's transmission to translate.
    if (looksLikeGeneratedDispatch(sourceText)) {
      res.status(400).json({
        success: false,
        code: 'TRANSLATION_INVALID_SOURCE',
        error: 'Translation unavailable \u2014 the provided text failed safety validation. The original transmission is preserved.'
      });
      return;
    }

    const apiKey = process.env.NEBIUS_API_KEY ? process.env.NEBIUS_API_KEY.trim() : '';

    // OFFLINE / RESILIENCE mode and ONLINE translation are distinct paths.
    // Offline mode is only used when it is explicitly requested — a failed or
    // unconfigured ONLINE translation is reported as an explicit error state,
    // never converted into a successful offline translation.
    const outcome = await resolveEmergencyTranslation(
      {
        text: sourceText,
        targetLanguage,
        sourceLanguage,
        currentSOS,
        offlineModeForce: offlineModeForce === true,
        location
      },
      { apiKey, baseUri: NEBIUS_BASE_URI, model: NEBIUS_MODEL }
    );

    if (outcome.kind === 'error') {
      // Explicit translation-error contract — every online failure keeps the
      // original transmission and returns a real error status/code:
      //   TRANSLATION_INVALID_INPUT / TRANSLATION_INVALID_SOURCE      -> 400
      //   TRANSLATION_NOT_CONFIGURED                                  -> 503
      //   TRANSLATION_UPSTREAM_HTTP / TRANSLATION_TIMEOUT /
      //   TRANSLATION_INVALID_RESPONSE / TRANSLATION_TRUNCATED /
      //   TRANSLATION_EMPTY_RESPONSE / TRANSLATION_INVALID_JSON /
      //   TRANSLATION_MISSING_MESSAGE /
      //   TRANSLATION_TARGET_LANGUAGE_MISMATCH /
      //   TRANSLATION_ORIGINAL_MESSAGE_MISMATCH /
      //   TRANSLATION_VALIDATION_FAILED                               -> 502/504
      console.warn('[Translation] online translation unavailable:', outcome.code, outcome.error);
      res.status(outcome.status).json({
        success: false,
        code: outcome.code,
        error: outcome.error,
        ...(typeof outcome.upstream_status === 'number' ? { upstream_status: outcome.upstream_status } : {})
      });
      return;
    }

    res.json({
      success: true,
      data: {
        ...outcome.data,
        ...(outcome.data.source === 'offline_fallback'
          ? { offline_notice: 'Manual offline translation active (bundled emergency phrasebook).' }
          : {}),
        latency_ms: Date.now() - startTime
      }
    });
  });

  // Emergency partner API configuration lookup (public status metadata ONLY —
  // endpoint URLs, API keys, and any other credentials are never included).
  // 200 CONFIGURED / NOT_CONFIGURED on success; 503 when the lookup itself
  // fails (unavailable — never reported as "not configured").
  app.get('/api/emergency-partner/config', (req, res) => {
    try {
      if ((process.env.EMERGENCY_PARTNER_CONFIG_ERROR || '').trim() === 'unavailable') {
        res.status(503).json({
          success: false,
          code: 'PARTNER_CONFIG_UNAVAILABLE',
          error: 'Emergency API configuration unavailable.'
        });
        return;
      }
      const country = typeof req.query.country === 'string' ? req.query.country : 'GLOBAL';
      res.json({ success: true, data: getEmergencyPartnerConfig(country, process.env) });
    } catch {
      res.status(503).json({
        success: false,
        code: 'PARTNER_CONFIG_UNAVAILABLE',
        error: 'Emergency API configuration unavailable.'
      });
    }
  });

  // Dedicated Emergency Partner Dispatch Endpoint
  app.post('/api/emergency-partner/dispatch', async (req, res) => {
    const startTime = Date.now();
    const {
      sosId,
      timestamp,
      emergencyType,
      severity,
      message,
      gps,
      photos,
      video,
      partnerId,
      providerType,
      demoOnly,
      userConsentConfirmed,
      detectedLanguage,
      originalTranscript,
      englishTranslation
    } = req.body || {};

    if (userConsentConfirmed !== true) {
      res.status(403).json({
        success: false,
        error: 'Explicit user review and consent is required prior to emergency partner transmission.'
      });
      return;
    }

    if (!sosId || !emergencyType || !message) {
      res.status(400).json({
        success: false,
        error: 'Missing required SOS payload fields (sosId, emergencyType, message).'
      });
      return;
    }

    console.log(`[Emergency Partner Dispatch] Partner: ${partnerId || 'unknown'} (${providerType}) for SOS: ${sosId}`);

    // 1. PUBLIC CONTACT PROVIDER: Public contacts have no API capability
    if (providerType === 'PUBLIC_CONTACT') {
      res.status(400).json({
        success: false,
        error: 'PUBLIC CONTACT ONLY — Emergency telephone numbers do not support digital API dispatches. Call official number directly.'
      });
      return;
    }

    // 2. AUTHORIZED API PROVIDER
    if (providerType === 'AUTHORIZED_API') {
      const partnerApiUrl = process.env.AUTHORIZED_PARTNER_API_URL;
      const partnerApiKey = process.env.AUTHORIZED_PARTNER_API_KEY;

      if (!partnerApiUrl || !partnerApiKey || getEmergencyPartnerConfig('GLOBAL', process.env).status !== 'CONFIGURED') {
        res.status(400).json({
          success: false,
          error: 'AUTHORIZED API DISPATCH — A valid authorized HTTPS endpoint and server credentials are not configured.'
        });
        return;
      }

      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      try {
        const controller = new AbortController();
        timeoutId = setTimeout(() => controller.abort(), 10000);

        // Old clients may still send dataUrl fields: strip all media contents
        // before proxying. This integration currently supports metadata ONLY.
        const mediaMetadata = (raw: any) => ({
          type: raw?.type === 'video' ? 'video' : 'image',
          name: typeof raw?.name === 'string' ? raw.name.slice(0, 180) : '',
          mimeType: typeof raw?.mimeType === 'string' ? raw.mimeType.slice(0, 100) : '',
          ...(Number.isFinite(raw?.sizeBytes) ? { sizeBytes: raw.sizeBytes } : {})
        });
        const safePhotos = Array.isArray(photos) ? photos.slice(0, 2).map(mediaMetadata) : [];
        const safeVideo = video && typeof video === 'object' ? mediaMetadata(video) : null;

        const response = await fetch(partnerApiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': partnerApiKey.startsWith('Bearer ') ? partnerApiKey : `Bearer ${partnerApiKey}`
          },
          body: JSON.stringify({
            sosId,
            timestamp: timestamp || new Date().toISOString(),
            emergencyType,
            severity,
            message,
            gps,
            photos: safePhotos,
            video: safeVideo,
            // Bilingual voice context: original-language transcript is authoritative,
            // English translation (when present) is an interoperability aid.
            detectedLanguage: typeof detectedLanguage === 'object' && detectedLanguage ? detectedLanguage : null,
            originalTranscript: typeof originalTranscript === 'string' ? originalTranscript : null,
            englishTranslation: typeof englishTranslation === 'string' ? englishTranslation : null,
            source: 'LifeLine AI Framework'
          }),
          signal: controller.signal
        });

        // Keep the deadline active through response.text()/json(), not just
        // headers; a stalled partner body must not hang a manual SOS attempt.
        if (!response.ok) {
          const errText = await response.text();
          res.status(response.status).json({
            success: false,
            error: `Authorized partner API returned HTTP ${response.status}: ${errText.slice(0, 200)}`
          });
          return;
        }

        const partnerJson = await response.json();
        if (typeof partnerJson?.referenceId !== 'string' || !partnerJson.referenceId.trim()) {
          res.status(502).json({
            success: false,
            error: 'Authorized partner did not return a verifiable reference ID. Handoff unconfirmed; verify before retrying.'
          });
          return;
        }
        res.json({
          success: true,
          data: {
            success: true,
            status: 'ACKNOWLEDGED',
            referenceId: partnerJson.referenceId,
            timestamp: new Date().toISOString(),
            message: partnerJson.message || 'SOS package acknowledged by authorized partner API.',
            partnerId: partnerId || 'authorized-partner',
            partnerName: 'Authorized Rescue Network API',
            providerType: 'AUTHORIZED_API',
            // Forward ONLY explicit confirmations returned by the real configured
            // partner. HTTP 200 / successful processing alone NEVER becomes a
            // delivery or responder acknowledgment, neither value is ever inferred
            // from the other, and the TEST / DEMO path never sets them.
            ...(partnerJson?.deliveryConfirmed === true ? { deliveryConfirmed: true as boolean } : {}),
            ...(partnerJson?.responderAcknowledged === true ? { responderAcknowledged: true as boolean } : {}),
            ...(partnerJson?.deliveredAt ? { deliveredAt: String(partnerJson.deliveredAt) } : {})
          }
        });
        return;
      } catch (err: any) {
        res.status(502).json({
          success: false,
          error: `Failed to dispatch to authorized partner API: ${err.message}`
        });
        return;
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    }

    // 3. TEST / DEMO PROVIDER. Never accept real user text, coordinates or
    // evidence here (including old queued TEST records). Only the fixed
    // synthetic directory example is allowed; no partner receives it.
    const syntheticGps = !gps || (gps.latitude === 37.7749 && gps.longitude === -122.4194);
    const syntheticPhotos = !photos || (Array.isArray(photos) && photos.length <= 1 &&
      photos.every((photo: any) => photo?.name === 'test-evidence-1.jpg' && !photo.dataUrl));
    const syntheticVideo = !video || (video.name === 'test-sos-video-10s.webm' && !video.dataUrl);
    if (providerType !== 'TEST' || demoOnly !== true || partnerId !== 'test-partner-demo' ||
        emergencyType !== 'MEDICAL EMERGENCY (DEMO)' ||
        message !== 'TEST / DEMO SOS transmission — Simulated distress alert for system validation.' ||
        originalTranscript || englishTranslation || detectedLanguage ||
        !syntheticGps || !syntheticPhotos || !syntheticVideo) {
      res.status(403).json({
        success: false,
        error: 'TEST endpoint accepts synthetic partner-directory examples ONLY. Real SOS records stay local for manual sharing.'
      });
      return;
    }
    const mockReferenceId = `DEMO-ACK-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;

    console.log(`[Emergency Partner Dispatch] TEST DEMO Acknowledgment generated: ${mockReferenceId} in ${Date.now() - startTime}ms`);

    // NOTE: The TEST / DEMO acknowledgment intentionally does NOT include
    // `deliveryConfirmed` or `responderAcknowledged`. Those lifecycle states
    // are reserved for real configured receiving integrations and can never
    // be fabricated by this demonstration endpoint.
    res.json({
      success: true,
      data: {
        success: true,
        status: 'ACKNOWLEDGED',
        referenceId: mockReferenceId,
        timestamp: new Date().toISOString(),
        message: 'TEST / DEMO — Mock SOS package successfully received by local demonstration endpoint. NO REAL EMERGENCY SERVICE RECEIVED THIS ALERT.',
        partnerId: partnerId || 'test-partner-demo',
        partnerName: 'TEST EMERGENCY PARTNER — DEMONSTRATION ONLY',
        providerType: 'TEST'
      }
    });
  });

  // Serve official logo directly with cache headers
  const logoPath = path.join(process.cwd(), 'public', 'file_00000000f3ec8211ba741b84f232a029.png');
  app.get(['/file_00000000f3ec8211ba741b84f232a029.png', '/logo.png', '/assets/logo.png', '/assets/file_00000000f3ec8211ba741b84f232a029.png'], (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(logoPath);
  });

  // Vite middleware in dev; static file serving in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    // The offline worker has a per-build revision. Do not let HTTP caches pin
    // an older worker after a new release; the worker's own app assets are cached.
    app.get('/sw.js', (_req, res, next) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      next();
    });
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[LifeLine AI by MSB Creative Studios] Running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
