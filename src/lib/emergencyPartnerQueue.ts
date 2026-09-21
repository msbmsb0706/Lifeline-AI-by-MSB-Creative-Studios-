import {
  SOSPackage,
  PendingSOSItem,
  EmergencyPartnerProvider,
  PartnerAcknowledgment,
  MediaAttachmentInfo,
  SeverityLevel,
  StandardEmergencyCategory
} from '../types.ts';
import { getTestProvider } from './emergencyPartnersData.ts';

const PENDING_QUEUE_KEY = 'lifeline_pending_sos_queue';
const AUTOSEND_SETTING_KEY = 'lifeline_autosend_pending_sos';
const MAX_QUEUE_ITEMS = 5;

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
    offlineCreated: !navigator.onLine
  };
}

// Get setting: "Send pending SOS when connection returns" (Default: false)
export function getAutoSendSetting(): boolean {
  try {
    const val = localStorage.getItem(AUTOSEND_SETTING_KEY);
    return val === 'true';
  } catch {
    return false;
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

// Get all pending SOS items
export function getPendingQueue(): PendingSOSItem[] {
  try {
    const data = localStorage.getItem(PENDING_QUEUE_KEY);
    if (!data) return [];
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [];
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
  // Filter for unsent items explicitly approved by user
  const eligibleItems = items.filter((item) => {
    if (item.status === 'SENT') return false; // Already sent, prevent duplicate
    if (item.status === 'TRANSMITTING') return false; // In progress
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
    // Mark as TRANSMITTING to prevent duplicate race conditions
    item.status = 'TRANSMITTING';
    item.attempts += 1;
    item.lastAttemptTimestamp = new Date().toISOString();
    savePendingSOS(item);

    try {
      const ack = await sendSOSToPartner(item);
      item.status = 'SENT';
      item.acknowledgment = ack;
      item.errorMessage = undefined;
      savePendingSOS(item);
      successCount++;
    } catch (err: any) {
      item.status = 'FAILED';
      item.errorMessage = err.message || 'Transmission failed';
      savePendingSOS(item);
      errors.push(`SOS ${item.sosPackage.sosId}: ${err.message}`);
    }
  }

  return {
    processedCount: eligibleItems.length,
    successCount,
    errors
  };
}
