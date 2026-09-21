import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import { classifyEmergencyOffline } from './src/lib/offlineClassifier.ts';
import {
  detectLanguage,
  standardizeCategory,
  translateEmergencyOffline,
  getLanguageByCodeOrName,
  SUPPORTED_LANGUAGES,
  STANDARDIZED_CATEGORIES
} from './src/lib/languages.ts';
import { NemotronEmergencyResponse, SeverityLevel, StandardEmergencyCategory } from './src/types.ts';
import { createPrivacyContactRouter, getPrivacyContactConfigStatus } from './server/privacyContact.ts';

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const NEBIUS_BASE_URI = (process.env.NEBIUS_BASE_URI || process.env.NEBIUS_BASE_URL || 'https://api.tokenfactory.us-central1.nebius.com/v1').replace(/\/+$/, '');
const NEBIUS_MODEL = process.env.NEBIUS_MODEL || 'nvidia/nemotron-3-super-120b-a12b';

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

async function startServer() {
  const app = express();

  app.set('trust proxy', resolveTrustProxy());
  app.use(express.json({ limit: '1mb' }));

  console.log('[Nebius Diagnostics] LifeLine AI Backend Initialized');
  console.log('[Nebius Diagnostics] NEBIUS_BASE_URI:', NEBIUS_BASE_URI);
  console.log('[Nebius Diagnostics] NEBIUS_MODEL:', NEBIUS_MODEL);
  console.log('[Nebius Diagnostics] NEBIUS_API_KEY configured:', Boolean(process.env.NEBIUS_API_KEY));

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
      standardized_categories: STANDARDIZED_CATEGORIES.map(c => c.id)
    });
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

    if (!text || typeof text !== 'string' || text.trim() === '') {
      res.status(400).json({ error: 'Emergency transcript or text is required.' });
      return;
    }

    const trimmedText = text.trim();
    const locationString = typeof location === 'string' ? location : (location ? JSON.stringify(location) : '');
    const detectedSourceLang = detectLanguage(trimmedText);
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
4. Output ONLY valid, parseable JSON matching the schema. No markdown fences (\`\`\`json) and no preamble.`;

      const userMessageContent = `EMERGENCY DISTRESS TRANSCRIPT:\n"${trimmedText}"${locationString ? `\nREPORTED LOCATION: ${locationString}` : ''}\nLanguage hint: ${preferredLang}`;

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
        // Exact schema fields
        language: validatedLang,
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
        raw_transcript: validatedTranscript,
        location_coordinates: req.body.coordinates || null,
        detected_language: detectedSourceLang,
        nebius_connected: true
      };

      // If a target language is passed during initial analysis and differs from source, provide translation
      if (targetLanguage) {
        const targetLangObj = getLanguageByCodeOrName(targetLanguage);
        if (targetLangObj.code !== detectedSourceLang.code) {
          const offlineTrans = translateEmergencyOffline(
            resultData.message,
            targetLangObj.code,
            emergencyType as StandardEmergencyCategory,
            validatedSeverity,
            emergencyType,
            detectedSourceLang.code,
            locationString
          );
          resultData.translation = {
            ...offlineTrans,
            source: 'offline_fallback',
            model_used: 'LifeLine AI Multilingual Translation'
          };
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
      res.status(400).json({ error: 'Target language is required for translation.' });
      return;
    }

    const targetLangObj = getLanguageByCodeOrName(targetLanguage);
    const sourceText = text || currentSOS?.message || '';

    if (!sourceText.trim()) {
      res.status(400).json({ error: 'No message content provided to translate.' });
      return;
    }

    // Auto-detect source language
    const detectedSource = sourceLanguage
      ? getLanguageByCodeOrName(sourceLanguage)
      : detectLanguage(sourceText);

    // CRITICAL SAFETY INVARIANT:
    // Never change the emergency category, emergency type, or severity level because of translation!
    const lockedCategory: StandardEmergencyCategory = currentSOS?.emergency_category
      ? currentSOS.emergency_category
      : standardizeCategory(currentSOS?.emergency_type || sourceText);

    const lockedSeverity: SeverityLevel = (
      typeof currentSOS?.severity === 'number' && currentSOS.severity >= 1 && currentSOS.severity <= 5
        ? currentSOS.severity
        : 3
    ) as SeverityLevel;

    const lockedType: string = currentSOS?.emergency_type || `${lockedCategory} Emergency`;

    const apiKey = process.env.NEBIUS_API_KEY ? process.env.NEBIUS_API_KEY.trim() : '';
    const shouldRunOffline = offlineModeForce === true || !apiKey;

    // Fast deterministic offline translation if offline mode forced or API key missing
    if (shouldRunOffline) {
      const translated = translateEmergencyOffline(
        sourceText,
        targetLangObj.code,
        lockedCategory,
        lockedSeverity,
        lockedType,
        detectedSource.code,
        typeof location === 'string' ? location : undefined
      );

      res.json({
        success: true,
        data: {
          ...translated,
          source: 'offline_fallback',
          model_used: 'LifeLine AI Deterministic Multilingual Translation Engine',
          offline_notice: offlineModeForce
            ? 'Manual offline translation active.'
            : 'Nebius API key not configured. Offline translation engine used.',
          latency_ms: Date.now() - startTime
        }
      });
      return;
    }

    // Call Nebius Token Factory API using Nemotron for natural contextual emergency translation
    try {
      const systemPrompt = `You are LifeLine AI's specialized emergency multilingual translation engine developed by MSB Creative Studios.
Translate the emergency distress report and radio dispatch message into the target language: ${targetLangObj.name} (${targetLangObj.nativeName}).

CRITICAL SAFETY & MEDICAL INVARIANTS:
1. NEVER alter or change the emergency type ("${lockedType}"), the standardized emergency category ("${lockedCategory}"), or the severity level (${lockedSeverity}). These are locked life-critical triage parameters.
2. Preserve the emergency meaning, high-urgency tone, and specific assistance required.
3. Translate with high linguistic accuracy and natural phrasing into ${targetLangObj.name} (using its native script: ${targetLangObj.script || targetLangObj.name}).
4. Output STRICTLY a valid JSON object matching this schema:
{
  "detected_source_language": {
    "code": "${detectedSource.code}",
    "name": "${detectedSource.name}"
  },
  "target_language": "${targetLangObj.code}",
  "target_language_name": "${targetLangObj.name}",
  "original_message": string (exact original message),
  "translated_message": string (the complete emergency dispatch message translated into ${targetLangObj.name}),
  "translated_headline": string (urgent headline in ${targetLangObj.name}),
  "translated_action_steps": string[] (3-4 immediate survival steps in ${targetLangObj.name}),
  "translated_instructions_for_responders": string (on-arrival directive in ${targetLangObj.name}),
  "translated_first_aid_actions": string[] (2-3 first aid protocols in ${targetLangObj.name}),
  "translated_needs": string[] (translated list of needed units/equipment in ${targetLangObj.name})
}
Do NOT include markdown fences (\`\`\`json). Output pure JSON only.`;

      const userPrompt = `Translate this emergency dispatch transmission to ${targetLangObj.name} (${targetLangObj.nativeName}):
ORIGINAL TRANSMISSION: "${sourceText}"
ORIGINAL HEADLINE: "${currentSOS?.visual_card?.headline || lockedType}"
RESPONDER INSTRUCTION: "${currentSOS?.visual_card?.instructions_for_responders || 'Assess scene safety and vitals.'}"
ACTION STEPS: ${JSON.stringify(currentSOS?.visual_card?.action_steps || [])}
FIRST AID: ${JSON.stringify(currentSOS?.visual_card?.first_aid_actions || [])}
REQUIRED UNITS: ${JSON.stringify(currentSOS?.needs || [])}
Source Language: ${detectedSource.name}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      const nebiusResponse = await fetch(`${NEBIUS_BASE_URI}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: NEBIUS_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.1,
          response_format: { type: 'json_object' },
          max_tokens: 1400
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!nebiusResponse.ok) {
        const errText = await nebiusResponse.text();
        console.error('Nebius translation failed with status:', nebiusResponse.status, errText);
        throw new Error(`Nebius translation returned status ${nebiusResponse.status}`);
      }

      const rawJson = await nebiusResponse.json();
      const assistantText = rawJson?.choices?.[0]?.message?.content;

      if (!assistantText) {
        throw new Error('Empty translation response from Nebius Token Factory');
      }

      const cleaned = assistantText
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      const parsedTrans = JSON.parse(cleaned);

      res.json({
        success: true,
        data: {
          detected_source_language: parsedTrans.detected_source_language || detectedSource,
          target_language: targetLangObj.code,
          target_language_name: targetLangObj.name,
          original_message: sourceText,
          translated_message: parsedTrans.translated_message || sourceText,
          translated_headline: parsedTrans.translated_headline,
          translated_action_steps: Array.isArray(parsedTrans.translated_action_steps) ? parsedTrans.translated_action_steps : undefined,
          translated_instructions_for_responders: parsedTrans.translated_instructions_for_responders,
          translated_first_aid_actions: Array.isArray(parsedTrans.translated_first_aid_actions) ? parsedTrans.translated_first_aid_actions : undefined,
          translated_needs: Array.isArray(parsedTrans.translated_needs) ? parsedTrans.translated_needs : undefined,
          // STRICT PRESERVATION of emergency type and severity
          category: lockedCategory,
          severity: lockedSeverity,
          emergency_type: lockedType,
          timestamp: new Date().toISOString(),
          model_used: NEBIUS_MODEL,
          source: 'nebius_nemotron',
          latency_ms: Date.now() - startTime
        }
      });
    } catch (err: any) {
      console.warn('Nemotron translation online call failed. Using deterministic translation fallback:', err?.message || err);

      const fallbackTrans = translateEmergencyOffline(
        sourceText,
        targetLangObj.code,
        lockedCategory,
        lockedSeverity,
        lockedType,
        detectedSource.code,
        typeof location === 'string' ? location : undefined
      );

      res.json({
        success: true,
        data: {
          ...fallbackTrans,
          source: 'offline_fallback',
          model_used: 'LifeLine AI Deterministic Multilingual Translation Engine',
          offline_notice: `Nebius Token Factory unavailable (${err?.message || 'timeout'}). Offline deterministic translation provided.`,
          latency_ms: Date.now() - startTime
        }
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
      userConsentConfirmed
    } = req.body || {};

    if (!userConsentConfirmed) {
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

      if (!partnerApiUrl || !partnerApiKey) {
        res.status(400).json({
          success: false,
          error: 'AUTHORIZED API DISPATCH — No authorized provider API endpoint or credentials are configured in server environment.'
        });
        return;
      }

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

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
            photos,
            video,
            source: 'LifeLine AI Framework'
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errText = await response.text();
          res.status(response.status).json({
            success: false,
            error: `Authorized partner API returned HTTP ${response.status}: ${errText.slice(0, 200)}`
          });
          return;
        }

        const partnerJson = await response.json();
        res.json({
          success: true,
          data: {
            success: true,
            status: 'ACKNOWLEDGED',
            referenceId: partnerJson.referenceId || `AUTH-ACK-${Date.now().toString(36).toUpperCase()}`,
            timestamp: new Date().toISOString(),
            message: partnerJson.message || 'SOS package acknowledged by authorized partner API.',
            partnerId: partnerId || 'authorized-partner',
            partnerName: 'Authorized Rescue Network API',
            providerType: 'AUTHORIZED_API'
          }
        });
        return;
      } catch (err: any) {
        res.status(502).json({
          success: false,
          error: `Failed to dispatch to authorized partner API: ${err.message}`
        });
        return;
      }
    }

    // 3. TEST / DEMO PROVIDER
    // Local mock emergency partner endpoint for demonstration
    const mockReferenceId = `DEMO-ACK-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;

    console.log(`[Emergency Partner Dispatch] TEST DEMO Acknowledgment generated: ${mockReferenceId} in ${Date.now() - startTime}ms`);

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
