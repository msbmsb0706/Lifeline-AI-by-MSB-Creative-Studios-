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
// Bound only completed history. Never silently discard an unsent/failed SOS
// when more than five have been confirmed offline (or after a device restart).
const MAX_COMPLETED_QUEUE_ITEMS = 5;

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
    label: 'WAITING FOR CONNECTION',
    detail: 'Saved locally. Nothing has been sent yet.',
    terminal: false
  },
  UNCONFIRMED: {
    label: 'HANDOFF UNCONFIRMED',
    detail: 'The partner may have received this SOS. No automatic or manual API resend is permitted. Your SOS remains saved locally; use Share via device or verify directly.',
    terminal: false
  },
  SENDING: {
    label: 'SENDING SOS...',
    detail: 'Transmitting to the configured emergency partner endpoint…',
    terminal: false
  },
  SENT: {
    label: 'SOS SENT',
    detail: 'Awaiting delivery confirmation.',
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

// ---------------------------------------------------------------------------
// TEST / DEMO ONLY simulated-status display labels (PR #16).
//
// A simulated DELIVERED / ACKNOWLEDGED must NEVER appear to be a real
// emergency-service acknowledgement. These labels are the single source of
// truth for every surface that renders a simulated final state (SOS delivery
// card, queue manager). Real AUTHORIZED_API confirmations keep the
// SOS_DELIVERY_STATUS_META labels unchanged.
// ---------------------------------------------------------------------------

/** Display label for a SIMULATED delivery (never a real receipt). */
export const SIMULATED_DELIVERED_LABEL = 'SIMULATED — DELIVERED';

/** Display label for a SIMULATED responder acknowledgement (never real). */
export const SIMULATED_ACKNOWLEDGED_LABEL = 'SIMULATED — RESPONDER ACKNOWLEDGED';

/** Explanatory text for a simulated delivery line. */
export const SIMULATED_DELIVERY_EXPLANATION =
  'Simulation only — no real emergency organization received this SOS.';

/** Explanatory text for a simulated acknowledgement line. */
export const SIMULATED_ACK_EXPLANATION =
  'Simulation only — no real emergency organization acknowledged this SOS.';

/**
 * True when the item's CURRENT final status (DELIVERED / ACKNOWLEDGED) was
 * produced by the local TEST / DEMO ONLY simulator — i.e. the matching
 * transition in the persisted status history carries `simulated: true`.
 * Real AUTHORIZED_API confirmations (no simulated flag) return false, so
 * their display behavior is completely unchanged. Because the flag lives in
 * the persisted history, the simulated label survives refresh.
 */
export function isSimulatedFinalStatus(item: PendingSOSItem | null | undefined): boolean {
  if (!item || (item.status !== 'DELIVERED' && item.status !== 'ACKNOWLEDGED')) {
    return false;
  }
  return Boolean(item.statusHistory?.some((t) => t.status === item.status && t.simulated === true));
}

/**
 * Display label for an item's status: simulated finals render the explicit
 * SIMULATED label; every other state renders the standard lifecycle label.
 */
export function getDeliveryDisplayLabel(item: PendingSOSItem): string {
  if (item.targetPartner.providerType === 'LOCAL_ONLY') return 'SAVED LOCALLY — NOT SENT';
  if (isSimulatedFinalStatus(item)) {
    return item.status === 'DELIVERED' ? SIMULATED_DELIVERED_LABEL : SIMULATED_ACKNOWLEDGED_LABEL;
  }
  if (item.targetPartner.providerType === 'TEST' && item.status === 'SENT') {
    return 'SENT TO TEST/DEMO ONLY — NO RESPONDER';
  }
  return SOS_DELIVERY_STATUS_META[item.status]?.label || item.status;
}

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
  /** Original typed message (or transcript), preserved verbatim through the offline queue. */
  originalTranscript?: string;
  /** Detected language for typed messages; voice capture takes precedence when present. */
  detectedLanguage?: { code: string; name: string } | null;
  /** Optional bilingual voice context from multilingual voice ASR. */
  voiceCapture?: { detectedLanguage?: { code: string; name: string } | null; originalTranscript?: string; englishTranslation?: string } | null;
  /** Synthetic directory example, never set for real user emergencies. */
  demoOnly?: boolean;
  /** Faithful translation of the original transmission, when one exists. */
  translation?: { targetLanguage: string; targetLanguageName: string; translatedMessage: string } | null;
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
    ...(params.demoOnly ? { demoOnly: true } : {}),
    detectedLanguage: params.voiceCapture?.detectedLanguage || params.detectedLanguage || null,
    originalTranscript: params.voiceCapture?.originalTranscript || params.originalTranscript || null,
    englishTranslation: params.voiceCapture?.englishTranslation || null,
    translation: params.translation || null
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
  recordTransitionFlagged(item, status, detail, false);
}

/**
 * Low-level transition recorder with an explicit `simulated` flag. TEST / DEMO
 * simulation transitions are always recorded with `simulated: true` so they can
 * never be mistaken for real emergency-service acknowledgements, even in the
 * persisted timeline.
 */
function recordTransitionFlagged(
  item: PendingSOSItem,
  status: SOSDeliveryStatus,
  detail: string | undefined,
  simulated: boolean
): void {
  item.status = status;
  const history = item.statusHistory || [];
  const last = history[history.length - 1];
  // Collapse identical consecutive statuses (e.g. repeated FAILED retries keep
  // one entry per transition — only skip if nothing changed).
  if (!last || last.status !== status || detail !== undefined) {
    history.push({
      status,
      timestamp: new Date().toISOString(),
      ...(detail !== undefined ? { detail } : {}),
      ...(simulated ? { simulated: true } : {})
    });
  }
  item.statusHistory = history;
}

/** Timestamp of the first transition into a given status, if it occurred. */
export function getStatusTimestamp(item: PendingSOSItem, status: SOSDeliveryStatus): string | undefined {
  return item.statusHistory?.find((t) => t.status === status)?.timestamp;
}

/**
 * Create a queued SOS item from an explicit user confirmation.
 * LOCAL_ONLY confirmation permits storage, not partner upload; partner records
 * require their own transmission approval. The confirmation time is retained.
 */
export function createQueuedSOSItem(params: {
  sosPackage: SOSPackage;
  targetPartner: EmergencyPartnerProvider;
  userConsentTimestamp: string;
  automaticRecovery?: boolean;
}): PendingSOSItem {
  const item: PendingSOSItem = {
    sosPackage: params.sosPackage,
    targetPartner: params.targetPartner,
    // A local save is not consent to ANY partner transmission.
    userApprovedForPartnerTransmission: params.targetPartner.providerType !== 'LOCAL_ONLY',
    gpsApprovedForPartnerTransmission: false,
    automaticRecovery: params.automaticRecovery === true,
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
 * Interrupted transmissions (persisted SENDING / legacy TRANSMITTING) are
 * recovered once per session by applySessionStartRecovery() before this runs;
 * the TRANSMITTING mapping here remains as a backstop for older records.
 * A *live* in-session SENDING record must never be demoted here — it is
 * genuinely transmitting and is protected by the per-SOS in-flight guard.
 */
export function normalizePendingSOSItem(raw: any): PendingSOSItem {
  const item: PendingSOSItem = {
    ...raw,
    automaticRecovery: raw?.automaticRecovery === true,
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

// The legacy lifeline_autosend_pending_sos preference is deliberately ignored.
// Even an old stored "true" cannot authorize a background/reconnect upload;
// manual sharing requires a fresh, user-initiated action for each send.

// ==========================================
// Session-start recovery (interrupted transmissions)
// ==========================================

// A transmission that was in flight when the app was closed/refreshed/crashed
// persists as SENDING (or legacy TRANSMITTING). Nothing is actually transmitting
// in a new session, so those records must be recovered ONCE per session into the
// existing retryable pending lifecycle — otherwise they would stay stuck forever
// (the processor deliberately never re-picks SENDING while it is genuinely in
// flight, and the in-flight set is empty in a fresh session).
let sessionRecoveryApplied = false;

function applySessionStartRecovery(): void {
  if (sessionRecoveryApplied) return;
  sessionRecoveryApplied = true;
  try {
    const data = localStorage.getItem(PENDING_QUEUE_KEY);
    if (!data) return;
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) return;

    const onlineNow = navigator.onLine;
    let changed = false;
    const recovered = parsed.map((raw: any) => {
      const status = raw?.status;
      // SENDING = PR #12 interrupted transmission; TRANSMITTING = legacy record.
      if (status !== 'SENDING' && status !== 'TRANSMITTING') return raw;
      changed = true;
      const history = Array.isArray(raw.statusHistory) ? [...raw.statusHistory] : [];
      const at = new Date().toISOString();
      history.push({
        status: 'PENDING_LOCAL',
        timestamp: at,
        detail:
          status === 'SENDING'
            ? 'Recovered after app restart during transmission — ready to retry.'
            : 'Recovered from interrupted transmission (legacy record).'
      });
      // Starting offline: do not transmit; reflect the existing
      // WAITING_FOR_CONNECTION state until a supported connection returns.
      if (!onlineNow) {
        history.push({
          status: 'WAITING_FOR_CONNECTION',
          timestamp: at,
          detail: 'Device offline after restart — waiting for connection.'
        });
      }
      return {
        ...raw,
        // All original fields preserved (sosId, message, timestamp, consent, GPS,
        // photo/video metadata, recipient, attempts, prior history).
        status: onlineNow ? 'PENDING_LOCAL' : 'WAITING_FOR_CONNECTION',
        statusHistory: history
      };
    });

    if (changed) {
      localStorage.setItem(PENDING_QUEUE_KEY, JSON.stringify(recovered));
      console.info(
        '[LifeLine AI] Recovered interrupted SOS transmission record(s) into the retryable pending lifecycle.'
      );
    }
  } catch {
    // Recovery must never break queue reads.
  }
}

// Get all pending SOS items (normalized to the current lifecycle model).
// The first read of every application session also recovers any record left in
// SENDING/TRANSMITTING by an interrupted previous session (see above).
export function getPendingQueue(): PendingSOSItem[] {
  applySessionStartRecovery();
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
export function savePendingSOS(item: PendingSOSItem): boolean {
  try {
    const current = getPendingQueue();
    const existingIndex = current.findIndex((i) => i.sosPackage.sosId === item.sosPackage.sosId);
    const updated = [...current];
    if (existingIndex >= 0) updated[existingIndex] = item;
    else updated.unshift(item);

    // Keep every untransmitted record, even if there are more than five. Drop
    // old completed history only. If storage is full, setItem throws and the
    // caller can display a real failure instead of claiming the SOS was saved.
    let completedKept = 0;
    const retained = updated.filter((entry) => {
      if (!SOS_DELIVERY_STATUS_META[entry.status]?.terminal) return true;
      return ++completedKept <= MAX_COMPLETED_QUEUE_ITEMS;
    });
    localStorage.setItem(PENDING_QUEUE_KEY, JSON.stringify(retained));
    notifyQueueListeners();
    return true;
  } catch (err) {
    console.warn('Failed to save pending SOS to localStorage');
    return false;
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
    console.warn('Failed to delete pending SOS');
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

export class HandoffUnconfirmedError extends Error {
  constructor() { super('Handoff unconfirmed. The partner may have received this SOS. No API retry is safe; share via device or verify directly.'); }
}

export class DispatchError extends Error {
  constructor(public readonly httpStatus: number, message: string) { super(message); }
}

// Transmit single SOS package to configured partner endpoint
export async function sendSOSToPartner(
  item: PendingSOSItem
): Promise<PartnerAcknowledgment> {
  const { sosPackage, targetPartner } = item;

  // Never upload locally saved user SOS data to the demonstration endpoint.
  // Only the synthetic sample generated in the partner directory can use TEST.
  if (targetPartner.providerType === 'LOCAL_ONLY') {
    throw new Error('LOCAL ONLY — this SOS stays on the device. Use manual device sharing; no API dispatch is configured.');
  }
  if (targetPartner.providerType === 'TEST' && sosPackage.demoOnly !== true) {
    throw new Error('REAL SOS NOT SENT TO DEMO — share manually or choose a configured authorized partner.');
  }
  if (targetPartner.providerType !== 'TEST' && targetPartner.providerType !== 'AUTHORIZED_API' && targetPartner.providerType !== 'PUBLIC_CONTACT') {
    throw new Error('Unknown emergency partner type — no network request made.');
  }
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

  // Only metadata is in this queue. Never include legacy dataUrl/bytes, even
  // when a provider advertises media upload support: no recording survives here.
  const includeMedia = Boolean(targetPartner.supportsMediaUpload);
  const photosToSend = includeMedia
    ? (sosPackage.photos || []).map(({ type, name, mimeType, sizeBytes }) => ({ type, name, mimeType, sizeBytes }))
    : [];
  const videoToSend = includeMedia && sosPackage.video
    ? (({ type, name, mimeType, sizeBytes }) => ({ type, name, mimeType, sizeBytes }))(sosPackage.video)
    : null;

  // Every partner handoff goes through the server. Real authorized requests
  // require its durable ledger; TEST remains synthetic. Never trust a URL
  // supplied in browser-persisted provider metadata.
  const endpoint = '/api/emergency-partner/dispatch';

  const payload = {
    sosId: sosPackage.sosId,
    timestamp: sosPackage.timestamp,
    emergencyType: sosPackage.emergencyType,
    category: sosPackage.category,
    severity: sosPackage.severity,
    message: sosPackage.message,
    // A saved one-time location is NOT permission to send it to a partner.
    // Old queued records lack this flag and therefore send no GPS.
    gps: targetPartner.providerType === 'AUTHORIZED_API' && item.gpsApprovedForPartnerTransmission === true
      ? sosPackage.gps : null,
    gpsConsentConfirmed: targetPartner.providerType === 'AUTHORIZED_API' &&
      item.gpsApprovedForPartnerTransmission === true && Boolean(sosPackage.gps),
    photos: photosToSend,
    video: videoToSend,
    source: sosPackage.source,
    // Bilingual voice context: original transcript is authoritative user speech.
    detectedLanguage: sosPackage.detectedLanguage || null,
    originalTranscript: sosPackage.originalTranscript || null,
    englishTranslation: sosPackage.englishTranslation || null,
    partnerId: targetPartner.id,
    providerType: targetPartner.providerType,
    demoOnly: targetPartner.providerType === 'TEST' && sosPackage.demoOnly === true,
    userConsentConfirmed: item.userApprovedForPartnerTransmission,
    automaticRecovery: item.automaticRecovery === true
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

    // Keep the timeout active while reading the body too: a server can send
    // headers promptly and then stall indefinitely on its acknowledgment.
    if (!response.ok) {
      // Only recognize our own structured error code, never expose arbitrary upstream text.
      const body = await response.json().catch(() => null);
      if (body?.code === 'HANDOFF_UNCONFIRMED') throw new HandoffUnconfirmedError();
      throw new DispatchError(response.status, `Partner endpoint returned HTTP ${response.status}.`);
    }

    const json = await response.json();

    // An HTTP 200 alone is NOT success: the endpoint must explicitly accept
    // the SOS with a success acknowledgment payload.
    if (!json.success || !json.data) {
      throw new Error(json.error || 'Partner response did not return an acknowledgment.');
    }

    const ack: PartnerAcknowledgment = json.data;
    if (ack.success !== true || typeof ack.referenceId !== 'string' || !ack.referenceId.trim() ||
        ack.providerType !== targetPartner.providerType) {
      throw new Error('Partner response did not verify acceptance for this destination. Delivery is unconfirmed.');
    }
    clearTimeout(timeoutId);
    return ack;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err instanceof DispatchError || err instanceof HandoffUnconfirmedError) throw err;
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
  if (!navigator.onLine) {
    return { attempted: false, success: false, error: 'Device is offline. No transmission attempted.' };
  }
  if (['SENT', 'DELIVERED', 'ACKNOWLEDGED', 'SENDING', 'UNCONFIRMED'].includes(item.status)) {
    return { attempted: false, success: false, error: 'SOS already sent or in progress.' };
  }
  if (item.targetPartner.providerType === 'LOCAL_ONLY' ||
      (item.targetPartner.providerType === 'TEST' && item.sosPackage.demoOnly !== true)) {
    return { attempted: false, success: false, error: 'Stored locally: real SOS records cannot be uploaded to TEST/DEMO. Share manually.' };
  }
  if (!item.userApprovedForPartnerTransmission) {
    return { attempted: false, success: false, error: 'User consent for this SOS is required.' };
  }
  if (inFlightSOSIds.has(item.sosPackage.sosId)) {
    return { attempted: false, success: false, error: 'Transmission already in progress for this SOS.' };
  }

  inFlightSOSIds.add(item.sosPackage.sosId);
  try {
    recordTransition(item, 'SENDING');
    item.attempts += 1;
    item.lastAttemptTimestamp = new Date().toISOString();
    if (!savePendingSOS(item)) {
      // Never send a record whose in-flight state cannot be persisted: on
      // restart it could be lost or sent twice without an audit trail.
      return { attempted: false, success: false, error: 'Cannot save SOS locally (storage full or unavailable). No network request was made.' };
    }

    try {
      const ack = await sendSOSToPartner(item);
      item.acknowledgment = ack;
      item.errorMessage = undefined;
      if (item.targetPartner.providerType === 'AUTHORIZED_API' && ack.responderAcknowledged === true) {
        // Only real configured integrations may set this flag.
        item.acknowledgedAt = ack.timestamp || new Date().toISOString();
        recordTransition(item, 'ACKNOWLEDGED');
      } else if (item.targetPartner.providerType === 'AUTHORIZED_API' && ack.deliveryConfirmed === true) {
        // Only real configured integrations may set this flag.
        item.deliveredAt = ack.timestamp || new Date().toISOString();
        recordTransition(item, 'DELIVERED');
      } else {
        recordTransition(item, 'SENT');
      }
      if (!savePendingSOS(item)) {
        // The endpoint may have accepted the SOS, but the receipt is not durable.
        // Never claim a confirmed local SENT status or auto-retry on restart.
        return { attempted: true, success: false,
          error: 'Endpoint may have accepted this SOS, but the device could not save its receipt. Verify with the destination before any manual retry; delivery is not confirmed here.' };
      }
      return { attempted: true, success: true };
    } catch (err: any) {
      const message = err?.message || 'Transmission failed';
      if (err instanceof HandoffUnconfirmedError) {
        item.handoffUnconfirmed = true;
        item.recoveryBlocked = true;
        recordTransition(item, 'UNCONFIRMED', message);
      } else if (item.automaticRecovery === true) {
        // 4xx is not transient. 5xx, timeout and connectivity loss use bounded backoff.
        item.recoveryBlocked = err instanceof DispatchError && err.httpStatus >= 400 && err.httpStatus < 500;
        item.nextRecoveryAt = Date.now() + Math.min(300000, 5000 * 2 ** Math.min(item.attempts - 1, 6));
        recordTransition(item, 'WAITING_FOR_CONNECTION', message);
      } else recordTransition(item, 'FAILED', message);
      item.errorMessage = message;
      if (!savePendingSOS(item)) {
        return { attempted: true, success: false,
          error: `${message} The device also could not save the failure state. Verify before retrying.` };
      }
      return { attempted: true, success: false, error: message };
    }
  } finally {
    inFlightSOSIds.delete(item.sosPackage.sosId);
  }
}

// ★★★ TEST / DEMO ONLY — LOCAL LIFECYCLE SIMULATOR ★★★ //
// A clearly-labelled demonstration mechanism for the delivery lifecycle.
//
// It ONLY touches the locally stored TEST / DEMO record (providerType ===
// 'TEST'). It never performs a fetch, never sends a real emergency alert, and
// never produces a PartnerAcknowledgment of any kind. The transitions it writes
// are stamped `simulated: true` in the status history so nothing it produces
// can be mistaken for a real emergency-service acknowledgement.
//
// All progression is explicit: every step needs its own user action. Nothing —
// and in particular neither DELIVERED nor ACKNOWLEDGED — is ever fabricated
// automatically. Real AUTHORIZED_API records are never eligible for simulation.

export type DemoLifecycleStep = 'DELIVERED' | 'ACKNOWLEDGED';

/** True when a PendingSOSItem is a TEST provider record eligible for local simulation. */
export function isDemoSimulatableItem(item: PendingSOSItem | null | undefined): boolean {
  return Boolean(item && item.targetPartner?.providerType === 'TEST');
}

/**
 * Simulate the next lifecycle step for a stored TEST / DEMO record:
 *   SENT → DELIVERED → ACKNOWLEDGED
 *
 * - Requires an explicit, already-sent (SENT or later) TEST provider record.
 * - Writes the transition locally with `simulated: true`, never via network.
 * - The `deliveredAt` / `acknowledgedAt` timestamps are set (clearly labelled
 *   as simulated in the history), but NO PartnerAcknowledgment is produced.
 */
export function simulateDemoLifecycleAdvance(
  sosId: string,
  step: DemoLifecycleStep
): {
  ok: boolean;
  status?: SOSDeliveryStatus;
  error?: string;
} {
  const item = getPendingQueue().find((i) => i.sosPackage.sosId === sosId);
  if (!item) {
    return { ok: false, error: 'SOS record not found in local queue.' };
  }
  if (!isDemoSimulatableItem(item)) {
    return {
      ok: false,
      error: 'Lifecycle simulation is available ONLY for local TEST / DEMO records.'
    };
  }

  const simulatedStamp = '"TEST / DEMO ONLY" simulation (no real emergency service).';

  if (step === 'DELIVERED') {
    if (item.status === 'ACKNOWLEDGED') {
      return { ok: false, status: item.status, error: 'Already ACKNOWLEDGED — the demonstration lifecycle cannot move backwards.' };
    }
    // Defense-in-depth: strict, explicit progression only. DELIVERED can be
    // simulated exclusively from an already-handed-off (SENT) record — never
    // directly from PENDING_LOCAL / WAITING_FOR_CONNECTION / SENDING / FAILED.
    if (item.status !== 'SENT') {
      return {
        ok: false,
        status: item.status,
        error:
          'Before simulating delivery, the demonstration record must first be SENT to the partner endpoint (SENT → DELIVERED → ACKNOWLEDGED).'
      };
    }
    item.deliveredAt = new Date().toISOString();
    recordTransitionFlagged(item, 'DELIVERED', `${simulatedStamp} deliveryConfirmed simulated locally.`, true);
    savePendingSOS(item);
    return { ok: true, status: 'DELIVERED' };
  }

  // step === 'ACKNOWLEDGED'
  if (item.status === 'PENDING_LOCAL' || item.status === 'WAITING_FOR_CONNECTION' || item.status === 'SENDING' || item.status === 'FAILED') {
    return {
      ok: false,
      status: item.status,
      error: 'Before simulating acknowledgment, the demonstration record must first be SENT and then DELIVERED.'
    };
  }
  if (item.status !== 'DELIVERED') {
    // Strictly ordered, explicit progression: SENT → (simulate DELIVERED) →
    // (simulate ACKNOWLEDGED). Every advance is a separate user action.
    return {
      ok: false,
      status: item.status,
      error: 'The demonstration lifecycle advances one explicit step at a time (SENT → DELIVERED → ACKNOWLEDGED).'
    };
  }
  item.acknowledgedAt = new Date().toISOString();
  recordTransitionFlagged(item, 'ACKNOWLEDGED', `${simulatedStamp} responderAcknowledged simulated locally.`, true);
  savePendingSOS(item);
  return { ok: true, status: 'ACKNOWLEDGED' };
}

/**
 * Manually retry one previously consented partner record (explicit action).
 * Local-only and legacy real-user TEST records are never API destinations.
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
  if (item.status === 'UNCONFIRMED' || item.handoffUnconfirmed === true) {
    return { attempted: false, success: false, error: 'Handoff unconfirmed. Do not retry the partner API; use Share via device or verify directly.' };
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
  // Defense in depth: a reconnect, old preference, timer, or accidental caller
  // must never upload anything. Only a user-triggered handler passes forceManual.
  if (options?.forceManual !== true) {
    return { processedCount: 0, successCount: 0, errors: [] };
  }

  if (!navigator.onLine) {
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
      item.status === 'SENDING' ||
      item.status === 'UNCONFIRMED' || item.handoffUnconfirmed === true
    ) {
      return false;
    }
    if (!item.userApprovedForPartnerTransmission) return false;
    if (item.targetPartner.providerType === 'LOCAL_ONLY') return false;
    if (item.targetPartner.providerType === 'TEST' && item.sosPackage.demoOnly !== true) return false;
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
