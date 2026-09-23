import { detectLanguage, standardizeCategory, translateEmergencyOffline, getLanguageByCodeOrName } from '../src/lib/languages.ts';
import { getOriginalTransmission, isUsableOnlineTranslation } from '../src/lib/translation.ts';
import type { SeverityLevel, StandardEmergencyCategory, TranslatedSOS } from '../src/types.ts';

export class TranslationError extends Error {
  constructor(public code: string, message: string, public status = 502, public upstreamStatus?: number) { super(message); }
}

export function translationFailure(error: unknown) {
  const e = error instanceof TranslationError ? error : new TranslationError('TRANSLATION_REQUEST_FAILED', 'Translation request failed or timed out.');
  return { code: e.code, error: e.message, ...(e.upstreamStatus ? { upstream_status: e.upstreamStatus } : {}) };
}

// Shared by initial analysis and the explicit translation endpoint. Online failures
// must never be disguised as successful offline translations.
export async function translateEmergency(input: any, config: { apiKey: string; baseUri: string; model: string }): Promise<TranslatedSOS> {
  const { text, targetLanguage, sourceLanguage, currentSOS, offlineModeForce, location } = input;
  if (typeof targetLanguage !== 'string' || !targetLanguage.trim()) throw new TranslationError('TRANSLATION_INVALID_INPUT', 'Target language is required.', 400);
  const sourceText = getOriginalTransmission({ ...currentSOS, original_message: currentSOS?.original_message || text });
  if (!sourceText.trim()) throw new TranslationError('TRANSLATION_INVALID_INPUT', 'Original transmission is required.', 400);
  const targetLangObj = getLanguageByCodeOrName(targetLanguage);
  const detectedSource = sourceLanguage ? getLanguageByCodeOrName(sourceLanguage) : detectLanguage(sourceText);
  const lockedCategory: StandardEmergencyCategory = currentSOS?.emergency_category || standardizeCategory(currentSOS?.emergency_type || sourceText);
  const lockedSeverity = (typeof currentSOS?.severity === 'number' && currentSOS.severity >= 1 && currentSOS.severity <= 5 ? currentSOS.severity : 3) as SeverityLevel;
  const lockedType = currentSOS?.emergency_type || `${lockedCategory} Emergency`;
  if (offlineModeForce === true) return {
    ...translateEmergencyOffline(sourceText, targetLangObj.code, lockedCategory, lockedSeverity, lockedType, detectedSource.code, location),
    source: 'offline_fallback', model_used: 'Bundled emergency phrasebook'
  };
  if (!config.apiKey) throw new TranslationError('TRANSLATION_NOT_CONFIGURED', 'Online translation is not configured.', 503);
  const systemPrompt = `You are LifeLine AI's specialized emergency multilingual translation engine developed by MSB Creative Studios.
Translate the original user transmission and the separate structured responder fields into the target language: ${targetLangObj.name} (${targetLangObj.nativeName}).

CRITICAL SAFETY & MEDICAL INVARIANTS:
1. NEVER alter or change the emergency type ("${lockedType}"), the standardized emergency category ("${lockedCategory}"), or the severity level (${lockedSeverity}). These are locked life-critical triage parameters.
2. Preserve the emergency meaning, high-urgency tone, and specific assistance required.
3. Translate with high linguistic accuracy and natural phrasing into ${targetLangObj.name} (using its native script: ${targetLangObj.script || targetLangObj.name}).
4. "translated_message" MUST be a FAITHFUL, LITERAL translation of ONLY the user's original transmission, word-for-word where possible. It must NEVER add, summarize, reformat, or regenerate dispatch/triage content (no added headlines, priorities, categories, responder directives, or instructions). If the original is a single plain sentence of distress, "translated_message" is exactly that sentence translated.
5. The structured responder/dispatch fields (translated_headline, translated_action_steps, translated_instructions_for_responders, translated_first_aid_actions, translated_needs) are translated SEPARATELY from the provided structured content — do not fold them into translated_message.
6. Output STRICTLY a valid JSON object matching this schema:
{
  "detected_source_language": {
    "code": "${detectedSource.code}",
    "name": "${detectedSource.name}"
  },
  "target_language": "${targetLangObj.code}",
  "target_language_name": "${targetLangObj.name}",
  "original_message": string (exact original message),
  "translated_message": string (faithful translation of the original message ONLY),
  "translated_headline": string (urgent headline in ${targetLangObj.name}),
  "translated_action_steps": string[] (provided action steps in ${targetLangObj.name}),
  "translated_instructions_for_responders": string (on-arrival directive in ${targetLangObj.name}),
  "translated_first_aid_actions": string[] (provided first aid protocols in ${targetLangObj.name}),
  "translated_needs": string[] (translated list of needed units/equipment in ${targetLangObj.name})
}
Translate only the provided structured content; do not invent additional medical advice or instructions.
Do NOT include markdown fences (\`\`\`json). Output pure JSON only.`;

  const userPrompt = `Translate the user's ORIGINAL TRANSMISSION into ${targetLangObj.name} (${targetLangObj.nativeName}) — output this faithful translation in the "translated_message" JSON field. Do not paraphrase, summarize, or regenerate it as a dispatch report.
ORIGINAL TRANSMISSION (translate word-for-word): "${sourceText}"

Separately, translate these structured responder/dispatch fields into ${targetLangObj.name} for their own JSON keys:
ORIGINAL HEADLINE: "${currentSOS?.visual_card?.headline || lockedType}"
RESPONDER INSTRUCTION: "${currentSOS?.visual_card?.instructions_for_responders || 'Assess scene safety and vitals.'}"
ACTION STEPS: ${JSON.stringify(currentSOS?.visual_card?.action_steps || [])}
FIRST AID: ${JSON.stringify(currentSOS?.visual_card?.first_aid_actions || [])}
REQUIRED UNITS: ${JSON.stringify(currentSOS?.needs || [])}
Source Language: ${detectedSource.name}`;

  const response = await fetch(`${config.baseUri}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: config.apiKey.startsWith('Bearer ') ? config.apiKey : `Bearer ${config.apiKey}` },
    body: JSON.stringify({ model: config.model, messages: [
      { role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }
    ], temperature: 0.1, response_format: { type: 'json_object' }, max_tokens: 2400 }),
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new TranslationError('TRANSLATION_UPSTREAM_HTTP', `Translation provider returned HTTP ${response.status}.`, 502, response.status);
  const raw = await response.json().catch(() => null);
  const choice = raw?.choices?.[0];
  const content = choice?.message?.content;
  if (choice?.finish_reason === 'length') throw new TranslationError('TRANSLATION_TRUNCATED', 'Translation response was truncated.');
  if (typeof content !== 'string' || !content.trim()) throw new TranslationError('TRANSLATION_EMPTY_RESPONSE', 'Translation provider returned no text.');
  let parsed: any;
  try { parsed = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')); }
  catch { throw new TranslationError('TRANSLATION_INVALID_JSON', 'Translation provider returned invalid JSON.'); }
  if (!isUsableOnlineTranslation({ ...parsed, source: 'nebius_nemotron' })) throw new TranslationError('TRANSLATION_MISSING_MESSAGE', 'Translation provider returned no usable translated_message.');
  const strings = (value: unknown): string[] | undefined => Array.isArray(value) && value.every(v => typeof v === 'string') ? value : undefined;
  const string = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined;
  return {
    original_message: sourceText, translated_message: parsed.translated_message.trim(),
    translated_headline: string(parsed.translated_headline),
    translated_action_steps: strings(parsed.translated_action_steps),
    translated_instructions_for_responders: string(parsed.translated_instructions_for_responders),
    translated_first_aid_actions: strings(parsed.translated_first_aid_actions),
    translated_needs: strings(parsed.translated_needs),
    target_language: targetLangObj.code, target_language_name: targetLangObj.name,
    detected_source_language: detectedSource, category: lockedCategory, severity: lockedSeverity,
    emergency_type: lockedType, timestamp: new Date().toISOString(), source: 'nebius_nemotron', model_used: config.model
  };
}
