import {
  SOSPackage,
  PendingSOSItem,
  EmergencyPartnerProvider,
  PartnerAcknowledgment,
  MediaAttachmentInfo,
  SeverityLevel,
  StandardEmergencyCategory,
  SOSDeliveryStatus,
  SOSStatusTransition
} from '../types.ts';
import { getTestProvider } from './emergencyPartnersData.ts';

const PENDING_QUEUE_KEY = 'lifeline_pending_sos_queue';
const AUTOSEND_SETTING_KEY = 'lifeline_autosend_pending_sos';
const MAX_QUEUE_ITEMS = 5;

/**
 * Typed delivery lifecycle metadata. Single source of truth for status labels —
 * UI components must render from this map instead of scattering status strings.
 *
 * Trust rules enforced across the app:
 * - SENT is only reached after the configured endpoint actually accepts the handoff.
 * - DELIVERED / ACKNOWLEDGED are only reached when the acknowledgment payload
 *   explicitly carries deliveryConfirmed / responderAcknowledged from a real
 *   configured receiving integration (never from the TEST / DEMO endpoint).
 */
export const SOS_DELIVERY_STATUS_META: Record<
  SOSDeliveryStatus,
  { label: string; detail: string; terminal: boolean }
> = {
  PENDING_LOCAL: {
    label: 'PENDING LOCAL',
    detail: 'SOS confirmed and stored locally on this device.',
    terminal: false
  },
  WAITING_FOR_CONNECTION: {
    label: 'PENDING LOCAL',
    detail: 'Waiting for connection. The SOS will transmit automatically when connectivity returns.',
    terminal: false
  },
  SENDING: {
    label: 'SENDING',
    detail: 'Transmitting to the configured emergency partner endpoint…',
    terminal: false
  },
  SENT: {
    label: 'SENT',
    detail: 'SOS handed off to the configured destination endpoint.',
    terminal: true
  },
  DELIVERED: {
    label: 'DELIVERED',
    detail: 'Receiving system explicitly confirmed delivery.',
    terminal: true
  },
  ACKNOWLEDGED: {
    label: 'RESPONDER ACKNOWLEDGED',
    detail: 'A human/configured organization explicitly acknowledged this SOS.',
    terminal: true
  },
  FAILED: {
    label: 'DELIVERY FAILED',
    detail: 'Last transmission attempt failed. The SOS remains safely stored locally and retryable.',
    terminal: false
  }
};

// Generate unique SOS ID
export function generateSOSId(): string {
  const prefix = 'SOS-LL';
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  const time = Date.now().toString(36).toUpperCase();
  return `${prefix}-${time}-${rand}`;
}

// Build SOS Package
export function createSOSPackage(params: {
  emergencyType: string;
  category?: StandardEmergencyCategory;
  severity: SeverityLevel;
  message: string;
  gps?: { latitude: number; longitude: number; accuracyMeters?: number } | null;
  photos?: MediaAttachmentInfo[];
  video?: MediaAttachmentInfo | null;
  source?: 'online' | 'offline';
  /** Optional bilingual voice context from multilingual voice ASR. */
  voiceCapture?: { detectedLanguage?: { code: string; name: string } | null; originalTranscript?: string; englishTranslation?: string } | null;
}): SOSPackage {
  return {
    sosId: generateSOSId(),
    timestamp: new Date().toISOString(),
    emergencyType: params.emergencyType,
    category: params.category,
    severity: params.severity,
    message: params.message,
    gps: params.gps || null,
    photos: params.photos || [],
    video: params.video || null,
    source: params.source || (navigator.onLine ? 'online' : 'offline'),
    offlineCreated: !navigator.onLine,
    detectedLanguage: params.voiceCapture?.detectedLanguage || null,
    originalTranscript: params.voiceCapture?.originalTranscript || null,
    englishTranslation: params.voiceCapture?.englishTranslation || null
  };
}

// ==========================================
// Queue change subscription (lightweight pub/sub so UI can reflect
// lifecycle changes without polling). The queue itself remains the
// existing localStorage-backed implementation.
// ==========================================
const queueListeners = new Set<() => void>();

export function subscribeToQueue(listener: () => void): () => void {
  queueListeners.add(listener);
  return () => {
    queueListeners.delete(listener);
  };
}

function notifyQueueListeners(): void {
  queueListeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // A broken listener must never break queue persistence.
    }
  });
}

// ==========================================
// Lifecycle transition helpers
// ==========================================

/** Append a timestamped lifecycle transition to the item's status history. */
function recordTransition(item: PendingSOSItem, status: SOSDeliveryStatus, detail?: string): void {
  item.status = status;
  const history = item.statusHistory || [];
  const last = history[history.length - 1];
  // Collapse identical consecutive statuses (e.g. repeated FAILED retries keep
  // one entry per transition — only skip if nothing changed).
  if (!last || last.status !== status || detail !== undefined) {
    history.push({ status, timestamp: new Date().toISOString(), ...(detail !== undefined ? { detail } : {}) });
  }
  item.statusHistory = history;
}

/** Timestamp of the first transition into a given status, if it occurred. */
export function getStatusTimestamp(item: PendingSOSItem, status: SOSDeliveryStatus): string | undefined {
  return item.statusHistory?.find((t) => t.status === status)?.timestamp;
}

/**
 * Create a queued SOS item from an explicit user consent action.
 * The consent timestamp is preserved as the lifecycle `confirmedAt`.
 */
export function createQueuedSOSItem(params: {
  sosPackage: SOSPackage;
  targetPartner: EmergencyPartnerProvider;
  userConsentTimestamp: string;
}): PendingSOSItem {
  const item: PendingSOSItem = {
    sosPackage: params.sosPackage,
    targetPartner: params.targetPartner,
    userApprovedForPartnerTransmission: true,
    userConsentTimestamp: params.userConsentTimestamp,
    status: 'PENDING_LOCAL',
    statusHistory: [
      {
        status: 'PENDING_LOCAL',
        timestamp: new Date().toISOString(),
        detail: `SOS confirmed by user${!navigator.onLine ? ' while offline' : ''}; stored locally.`
      }
    ],
    attempts: 0
  };
  return item;
}

/**
 * Mark a locally-pending SOS as explicitly waiting for connectivity.
 * Called when the device is offline at/after confirmation time.
 * The local SOS record remains intact — nothing is transmitted.
 */
export function markWaitingForConnection(item: PendingSOSItem, reason?: string): PendingSOSItem {
  if (item.status === 'PENDING_LOCAL') {
    recordTransition(item, 'WAITING_FOR_CONNECTION', reason || 'Device offline — waiting for connection.');
    savePendingSOS(item);
  }
  return item;
}

/**
 * Normalize a persisted queue item to the current typed lifecycle.
 * Migrates the legacy 'TRANSMITTING' value: an interrupted in-flight
 * transmission is returned to the retryable pool so it can never become a
 * permanently stuck record (the per-SOS in-flight guard still prevents
 * concurrent double-sends within a session).
 */
export function normalizePendingSOSItem(raw: any): PendingSOSItem {
  const item: PendingSOSItem = {
    ...raw,
    status:
      raw?.status === 'TRANSMITTING' ? 'PENDING_LOCAL' : (raw?.status as SOSDeliveryStatus) || 'PENDING_LOCAL',
    attempts: typeof raw?.attempts === 'number' ? raw.attempts : 0
  };
  if (!Array.isArray(item.statusHistory) || item.statusHistory.length === 0) {
    // Seed a minimal history for pre-lifecycle records so timestamps stay meaningful.
    const history: SOSStatusTransition[] = [
      { status: 'PENDING_LOCAL', timestamp: item.userConsentTimestamp || item.sosPackage?.timestamp || new Date().toISOString() }
    ];
    if (item.status === 'SENT' || item.status === 'DELIVERED' || item.status === 'ACKNOWLEDGED') {
      history.push({ status: item.status, timestamp: item.acknowledgment?.timestamp || item.lastAttemptTimestamp || new Date().toISOString() });
    } else if (item.status === 'FAILED') {
      history.push({ status: 'FAILED', timestamp: item.lastAttemptTimestamp || new Date().toISOString(), detail: item.errorMessage });
    } else if (raw?.status === 'TRANSMITTING') {
      history.push({
        status: 'PENDING_LOCAL',
        timestamp: new Date().toISOString(),
        detail: 'Recovered from interrupted transmission (legacy record).'
      });
    }
    item.statusHistory = history;
  }
  return item;
}

// Get setting: "Send pending SOS when connection returns".
// Default: ON. An SOS is only queued after the user explicitly confirmed
// transmission in the consent modal, so resuming that already-approved
// transmission when connectivity returns is the expected emergency behavior.
// Users can still switch this OFF to require a manual retry instead.
export function getAutoSendSetting(): boolean {
  try {
    const val = localStorage.getItem(AUTOSEND_SETTING_KEY);
    if (val === 'false') return false;
    return true;
  } catch {
    return true;
  }
}

// Set setting: "Send pending SOS when connection returns"
export function setAutoSendSetting(enabled: boolean): void {
  try {
    localStorage.setItem(AUTOSEND_SETTING_KEY, enabled ? 'true' : 'false');
  } catch {
    // ignore
  }
}

// Get all pending SOS items (normalized to the current lifecycle model)
export function getPendingQueue(): PendingSOSItem[] {
  try {
    const data = localStorage.getItem(PENDING_QUEUE_KEY);
    if (!data) return [];
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizePendingSOSItem);
  } catch {
    return [];
  }
}

// Save or update a pending SOS item
export function savePendingSOS(item: PendingSOSItem): void {
  try {
    const current = getPendingQueue();
    const existingIndex = current.findIndex((i) => i.sosPackage.sosId === item.sosPackage.sosId);
    let updated: PendingSOSItem[];
    if (existingIndex >= 0) {
      updated = [...current];
      updated[existingIndex] = item;
    } else {
      updated = [item, ...current].slice(0, MAX_QUEUE_ITEMS);
    }
    localStorage.setItem(PENDING_QUEUE_KEY, JSON.stringify(updated));
    notifyQueueListeners();
  } catch (err) {
    console.warn('Failed to save pending SOS to localStorage:', err);
  }
}

// Delete a pending SOS item from queue
export function deletePendingSOS(sosId: string): void {
  try {
    const current = getPendingQueue();
    const updated = current.filter((i) => i.sosPackage.sosId !== sosId);
    localStorage.setItem(PENDING_QUEUE_KEY, JSON.stringify(updated));
    notifyQueueListeners();
  } catch (err) {
    console.warn('Failed to delete pending SOS:', err);
  }
}

// Clear all pending SOS items
export function clearPendingQueue(): void {
  try {
    localStorage.removeItem(PENDING_QUEUE_KEY);
  } catch {
    // ignore
  }
  notifyQueueListeners();
}

// Transmit single SOS package to configured partner endpoint
export async function sendSOSToPartner(
  item: PendingSOSItem
): Promise<PartnerAcknowledgment> {
  const { sosPackage, targetPartner } = item;

  // Prevent sending to public contact or disabled API
  if (targetPartner.providerType === 'PUBLIC_CONTACT') {
    throw new Error(
      'PUBLIC CONTACT ONLY — Emergency numbers cannot receive automated API dispatches. Call directly.'
    );
  }

  if (targetPartner.providerType === 'AUTHORIZED_API' && !targetPartner.apiEnabled) {
    throw new Error(
      'AUTHORIZED API DISPATCH — Selected partner API endpoint is currently disabled or not configured with valid server credentials.'
    );
  }

  // Filter media upload if provider does NOT explicitly support media
  const includeMedia = Boolean(targetPartner.supportsMediaUpload);
  const photosToSend = includeMedia ? sosPackage.photos : [];
  const videoToSend = includeMedia ? sosPackage.video : null;

  const endpoint = targetPartner.apiBaseUrl || '/api/emergency-partner/dispatch';

  const payload = {
    sosId: sosPackage.sosId,
    timestamp: sosPackage.timestamp,
    emergencyType: sosPackage.emergencyType,
    category: sosPackage.category,
    severity: sosPackage.severity,
    message: sosPackage.message,
    gps: sosPackage.gps,
    photos: photosToSend,
    video: videoToSend,
    source: sosPackage.source,
    // Bilingual voice context: original transcript is authoritative user speech.
    detectedLanguage: sosPackage.detectedLanguage || null,
    originalTranscript: sosPackage.originalTranscript || null,
    englishTranslation: sosPackage.englishTranslation || null,
    partnerId: targetPartner.id,
    providerType: targetPartner.providerType,
    userConsentConfirmed: item.userApprovedForPartnerTransmission
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text().catch(() => 'Server error');
      throw new Error(`Partner endpoint returned HTTP ${response.status}: ${errText.slice(0, 200)}`);
    }

    const json = await response.json();

    // An HTTP 200 alone is NOT success: the endpoint must explicitly accept
    // the SOS with a success acknowledgment payload.
    if (!json.success || !json.data) {
      throw new Error(json.error || 'Partner response did not return an acknowledgment.');
    }

    const ack: PartnerAcknowledgment = json.data;
    return ack;
  } catch (err: any) {
    clearTimeout(timeoutId);
    throw new Error(
      err.name === 'AbortError'
        ? 'Transmission timeout connecting to Emergency Partner endpoint.'
        : err.message || 'Transmission failed.'
    );
  }
}

// ==========================================
// Per-SOS transmission engine
// ==========================================

// SOS ids with an in-flight transmission in this session. Prevents duplicate
// concurrent sends when several triggers overlap (reconnect event + manual
// retry + confirm handler). Persisted terminal states (SENT/DELIVERED/
// ACKNOWLEDGED) prevent cross-session duplicate sends.
const inFlightSOSIds = new Set<string>();

/** True while a transmission attempt for this SOS is in progress in this session. */
export function isSOSInFlight(sosId: string): boolean {
  return inFlightSOSIds.has(sosId);
}

/**
 * Run one lifecycle attempt for a single SOS record:
 * PENDING_LOCAL / WAITING_FOR_CONNECTION / FAILED → SENDING → SENT|DELIVERED|ACKNOWLEDGED|FAILED
 *
 * The record is never removed on failure — it stays stored locally and
 * retryable. DELIVERED / ACKNOWLEDGED are only set when the partner
 * acknowledgment payload explicitly carries the corresponding confirmation
 * (see PartnerAcknowledgment) — they are never fabricated.
 */
export async function transmitSingleSOSItem(
  item: PendingSOSItem
): Promise<{ attempted: boolean; success: boolean; error?: string }> {
  if (inFlightSOSIds.has(item.sosPackage.sosId)) {
    return { attempted: false, success: false, error: 'Transmission already in progress for this SOS.' };
  }

  inFlightSOSIds.add(item.sosPackage.sosId);
  try {
    recordTransition(item, 'SENDING');
    item.attempts += 1;
    item.lastAttemptTimestamp = new Date().toISOString();
    savePendingSOS(item);

    try {
      const ack = await sendSOSToPartner(item);
      item.acknowledgment = ack;
      item.errorMessage = undefined;
      if (ack.responderAcknowledged === true) {
        // Only real configured integrations may set this flag.
        item.acknowledgedAt = ack.timestamp || new Date().toISOString();
        recordTransition(item, 'ACKNOWLEDGED');
      } else if (ack.deliveryConfirmed === true) {
        // Only real configured integrations may set this flag.
        item.deliveredAt = ack.timestamp || new Date().toISOString();
        recordTransition(item, 'DELIVERED');
      } else {
        recordTransition(item, 'SENT');
      }
      savePendingSOS(item);
      return { attempted: true, success: true };
    } catch (err: any) {
      const message = err?.message || 'Transmission failed';
      recordTransition(item, 'FAILED', message);
      item.errorMessage = message;
      savePendingSOS(item);
      return { attempted: true, success: false, error: message };
    }
  } finally {
    inFlightSOSIds.delete(item.sosPackage.sosId);
  }
}

/**
 * Manually retry one SOS record (explicit user action — bypasses the
 * auto-send setting but never the per-record consent requirement).
 */
export async function retrySingleSOS(sosId: string): Promise<{ attempted: boolean; success: boolean; error?: string }> {
  if (!navigator.onLine) {
    return { attempted: false, success: false, error: 'Device is offline. Transmission deferred until connection returns.' };
  }
  const item = getPendingQueue().find((i) => i.sosPackage.sosId === sosId);
  if (!item) {
    return { attempted: false, success: false, error: 'SOS record not found in local queue.' };
  }
  if (!item.userApprovedForPartnerTransmission) {
    return { attempted: false, success: false, error: 'Explicit user consent for transmission is required.' };
  }
  if (item.status === 'SENT' || item.status === 'DELIVERED' || item.status === 'ACKNOWLEDGED') {
    return { attempted: false, success: true }; // Already handed off — never duplicate-send.
  }
  return transmitSingleSOSItem(item);
}

// Process pending queue (called when online or manually triggered)
export async function processPendingQueue(options?: {
  forceManual?: boolean;
}): Promise<{ processedCount: number; successCount: number; errors: string[] }> {
  const autoSend = getAutoSendSetting();
  const isOnline = navigator.onLine;

  if (!isOnline) {
    return {
      processedCount: 0,
      successCount: 0,
      errors: ['Device is currently offline. Transmission deferred until connection returns.']
    };
  }

  const items = getPendingQueue();
  // Filter for not-yet-sent items explicitly approved by the user.
  // Eligible lifecycle states: PENDING_LOCAL, WAITING_FOR_CONNECTION, FAILED (retry).
  // SENT / DELIVERED / ACKNOWLEDGED are terminal (duplicate protection);
  // SENDING is in progress (concurrent-send protection).
  const eligibleItems = items.filter((item) => {
    if (
      item.status === 'SENT' ||
      item.status === 'DELIVERED' ||
      item.status === 'ACKNOWLEDGED' ||
      item.status === 'SENDING'
    ) {
      return false;
    }
    if (!item.userApprovedForPartnerTransmission) return false; // Privacy constraint: user must approve

    // If autoSend setting is OFF, only process if forceManual was triggered by user action
    if (!autoSend && !options?.forceManual) return false;

    return true;
  });

  if (eligibleItems.length === 0) {
    return { processedCount: 0, successCount: 0, errors: [] };
  }

  let successCount = 0;
  const errors: string[] = [];

  for (const item of eligibleItems) {
    const result = await transmitSingleSOSItem(item);
    if (result.success) {
      successCount++;
    } else if (result.error) {
      errors.push(`SOS ${item.sosPackage.sosId}: ${result.error}`);
    }
  }

  return {
    processedCount: eligibleItems.length,
    successCount,
    errors
  };
}
