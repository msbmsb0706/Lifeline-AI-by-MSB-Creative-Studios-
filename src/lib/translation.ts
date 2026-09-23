import type { EmergencyAnalysisResult } from '../types.ts';

/** Generated message is used only for legacy records that have no original text. */
export function getOriginalTransmission(result: Partial<EmergencyAnalysisResult>): string {
  return [result.raw_transcript, result.original_message, result.message]
    .find(value => typeof value === 'string' && value.trim().length > 0) || '';
}

export function isUsableOnlineTranslation(data: any): boolean {
  return data?.source === 'nebius_nemotron' && typeof data.translated_message === 'string'
    && data.translated_message.trim().length > 0
    && !data.translated_message.includes('faithful translation not available offline');
}
