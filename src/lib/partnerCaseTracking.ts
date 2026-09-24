import type { PartnerCaseStatus, PendingSOSItem } from '../types.ts';

const CASE_API = '/api/emergency-partner';
const API_TIMEOUT_MS = 10_000;

/** Only a previously handoff-verified AUTHORIZED_API record has case access. */
export function canViewPartnerCase(item: PendingSOSItem): boolean {
  return item.targetPartner?.providerType === 'AUTHORIZED_API' &&
    item.acknowledgment?.providerType === 'AUTHORIZED_API' &&
    item.acknowledgment?.success === true &&
    item.userApprovedForPartnerTransmission === true &&
    item.sosPackage?.demoOnly !== true &&
    typeof item.acknowledgment.caseAccessToken === 'string' &&
    Boolean(item.acknowledgment.caseAccessToken) &&
    typeof item.acknowledgment.referenceId === 'string' &&
    Number.isFinite(Date.parse(item.acknowledgment.caseAccessExpiresAt || '')) &&
    Date.parse(item.acknowledgment.caseAccessExpiresAt!) > Date.now();
}

/** Last-known case number may be shown offline, but never a stale live ETA. */
export function isPartnerCaseCurrent(status: PartnerCaseStatus | undefined, now = Date.now()): boolean {
  if (!status) return false;
  const timestamp = Date.parse(status.updatedAt);
  return status.partnerAccepted === true && Number.isFinite(timestamp) &&
    timestamp <= now + 30_000 && timestamp >= now - 60_000;
}

export function canStartPartnerTracking(status: PartnerCaseStatus | undefined, now = Date.now()): boolean {
  return isPartnerCaseCurrent(status, now) && status!.trackingAccepted === true &&
    Boolean(status!.caseNumber && status!.assignedResponder?.id && status!.assignedResponder?.name) &&
    status!.stage !== 'CLOSED';
}

function offline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

async function callCaseApi<T>(route: string, token: string, body: object, signal?: AbortSignal): Promise<T> {
  if (offline()) throw new Error('Offline — no case or GPS request was made. Reopen and refresh manually when connected.');
  if (signal?.aborted) throw new Error('Request canceled; no new GPS request was made.');
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const response = await fetch(`${CASE_API}/${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      cache: 'no-store',
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const json: any = await response.json();
    if (!response.ok || json?.success !== true || !json?.data) {
      throw new Error(typeof json?.error === 'string' ? json.error.slice(0, 220) : `Partner case unavailable (HTTP ${response.status}).`);
    }
    return json.data as T;
  } catch (error: any) {
    if (controller.signal.aborted) throw new Error('Partner case request timed out or was canceled. No automatic retry.');
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }
}

function matchedStatus(item: PendingSOSItem, status: PartnerCaseStatus): boolean {
  return Boolean(status && status.sosId === item.sosPackage.sosId &&
    status.referenceId === item.acknowledgment?.referenceId &&
    typeof status.partnerAccepted === 'boolean' &&
    typeof status.trackingAccepted === 'boolean' &&
    Number.isFinite(Date.parse(status.updatedAt)));
}

export async function fetchPartnerCaseStatus(item: PendingSOSItem, signal?: AbortSignal): Promise<PartnerCaseStatus> {
  if (!canViewPartnerCase(item)) throw new Error('No valid authorized partner case receipt. Nothing was requested.');
  const status = await callCaseApi<PartnerCaseStatus>('case-status', item.acknowledgment!.caseAccessToken!, {}, signal);
  if (!matchedStatus(item, status)) throw new Error('Partner case status did not match this SOS. No case details can be displayed.');
  return status;
}

/** Requires a *separate* user click, followed by a fresh verified partner acceptance. */
export async function startPartnerTracking(item: PendingSOSItem, signal?: AbortSignal): Promise<{
  sessionToken: string;
  expiresAt: string;
  status: PartnerCaseStatus;
}> {
  if (!canViewPartnerCase(item)) throw new Error('No valid authorized partner case receipt. GPS sharing was not started.');
  const result = await callCaseApi<{ sessionToken: string; expiresAt: string; status: PartnerCaseStatus }>(
    'start-tracking', item.acknowledgment!.caseAccessToken!, { userConsentConfirmed: true }, signal
  );
  if (!matchedStatus(item, result.status) || !canStartPartnerTracking(result.status) ||
      typeof result.sessionToken !== 'string' || result.sessionToken.length < 30 ||
      !Number.isFinite(Date.parse(result.expiresAt)) || Date.parse(result.expiresAt) <= Date.now()) {
    throw new Error('Partner tracking approval is missing or invalid. No GPS sharing started.');
  }
  return result;
}

/** No persistence, queue, retry, or GPS upload to TEST/local/public destinations. */
export async function sendPartnerLocation(
  item: PendingSOSItem,
  sessionToken: string,
  position: { latitude: number; longitude: number; accuracyMeters: number; timestamp: number },
  signal?: AbortSignal
): Promise<string> {
  if (!canViewPartnerCase(item) || !sessionToken ||
      typeof position.latitude !== 'number' || !Number.isFinite(position.latitude) ||
      typeof position.longitude !== 'number' || !Number.isFinite(position.longitude) ||
      typeof position.accuracyMeters !== 'number' || !Number.isFinite(position.accuracyMeters) ||
      position.latitude < -90 || position.latitude > 90 || position.longitude < -180 || position.longitude > 180 ||
      position.accuracyMeters < 0 || position.accuracyMeters > 50_000 ||
      !Number.isFinite(position.timestamp) || Math.abs(Date.now() - position.timestamp) > 30_000) {
    throw new Error('Fresh GPS and a verified authorized partner case are required. No location sent.');
  }
  const result = await callCaseApi<{ accepted: boolean; at: string }>('location-update', sessionToken, position, signal);
  if (result.accepted !== true || !Number.isFinite(Date.parse(result.at))) {
    throw new Error('Partner did not confirm this GPS update. Tracking stopped.');
  }
  return result.at;
}

export async function stopPartnerTracking(sessionToken: string): Promise<boolean> {
  if (!sessionToken) return false;
  const result = await callCaseApi<{ locallyStopped: boolean; partnerNotified: boolean }>(
    'stop-tracking', sessionToken, {}
  );
  return result.locallyStopped === true && result.partnerNotified === true;
}
