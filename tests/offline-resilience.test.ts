/**
 * Offline SOS queue and typed-message persistence tests. All requests are
 * mocked; no partner service, backend or external host receives any SOS.
 */
import { readFileSync } from 'node:fs';
import { installBrowserStub, mockResponse } from './browser-stub.ts';
import { section, assert, assertEqual } from './helpers.ts';
import { getTestProvider, LOCAL_ONLY_PROVIDER } from '../src/lib/emergencyPartnersData.ts';
import { detectLanguage, translateEmergencyOffline } from '../src/lib/languages.ts';
import {
  clearPendingQueue, createQueuedSOSItem, createSOSPackage, getPendingQueue,
  markWaitingForConnection, processPendingQueue, retrySingleSOS, savePendingSOS,
  sendSOSToPartner, transmitSingleSOSItem
} from '../src/lib/emergencyPartnerQueue.ts';

section('Offline resilience — consented SOS saved locally, not transmitted without a connection');
let calls = 0;
installBrowserStub({ online: false, fetch: () => {
  calls++;
  throw new Error('An offline SOS MUST NOT call fetch');
} });
clearPendingQueue();
(globalThis as any).localStorage.setItem('lifeline_autosend_pending_sos', 'true'); // old preference must NEVER authorize a new send
const typed = 'मेरे पापा को सांस नहीं आ रही, जल्दी मदद करें';
const lang = detectLanguage(typed);
const packageFor = (message: string) => createSOSPackage({
  emergencyType: 'Medical - Cardiac Emergency', category: 'MEDICAL', severity: 5,
  message, source: 'offline', originalTranscript: message,
  detectedLanguage: { code: detectLanguage(message).code, name: detectLanguage(message).name }
});
const authorizedMock = {
  ...getTestProvider(), id: 'authorized-mock', providerName: 'MOCK authorized partner (tests only)',
  providerType: 'AUTHORIZED_API' as const, apiEnabled: true
};
const makeItem = (message: string) => createQueuedSOSItem({
  sosPackage: packageFor(message), targetPartner: authorizedMock,
  userConsentTimestamp: new Date().toISOString()
});
const makeLocalItem = (message: string) => createQueuedSOSItem({
  sosPackage: packageFor(message), targetPartner: LOCAL_ONLY_PROVIDER,
  userConsentTimestamp: new Date().toISOString()
});
const item = makeItem(typed);
assertEqual(item.sosPackage.originalTranscript, typed, 'original typed Hindi text is stored verbatim in consented SOS package');
assertEqual(lang.code, 'hi', 'typed Hindi language detected offline');
assertEqual(item.sosPackage.detectedLanguage?.code, 'hi', 'SOS package stores original language');
assertEqual(savePendingSOS(item), true, 'consented SOS written successfully to browser storage');
markWaitingForConnection(item);
assertEqual(getPendingQueue()[0]?.status, 'WAITING_FOR_CONNECTION', 'offline SOS remains pending locally');
const blocked = await processPendingQueue();
assertEqual(blocked.processedCount, 0, 'queue processing offline attempts zero uploads');
assertEqual(calls, 0, 'offline SOS made ZERO network calls');
assertEqual((await transmitSingleSOSItem(item)).attempted, false, 'direct send API also refuses when offline');
let durableReads = true;
for (let i = 0; i < 500; i++) {
  const records = getPendingQueue();
  if (records.length !== 1 || records[0].sosPackage.originalTranscript !== typed ||
      records[0].status !== 'WAITING_FOR_CONNECTION') durableReads = false;
}
assert(durableReads && calls === 0, '500 repeated offline queue reads retain original text with no network traffic');
const translation = translateEmergencyOffline(typed, 'en', 'MEDICAL', 5, 'Medical - Cardiac Emergency', 'hi');
assertEqual(translation.original_message, typed, 'offline phrasebook keeps the ORIGINAL Hindi text');
assert(translation.translated_message.includes(typed) && translation.translated_message.includes('not available offline'),
  'no fabricated free-form Hindi translation shown when offline dictionary lacks a faithful translation');

section('Offline resilience — no unsent SOS silently evicted at the former five-record limit');
clearPendingQueue();
const unsentIds: string[] = [];
for (let i = 0; i < 8; i++) {
  const next = makeItem(`offline SOS ${i} need help`);
  unsentIds.push(next.sosPackage.sosId);
  assertEqual(savePendingSOS(next), true, `unsent SOS ${i + 1} stored`);
}
assertEqual(getPendingQueue().length, 8, 'all EIGHT unsent SOS records retained (former limit was 5)');
assert(unsentIds.every((id) => getPendingQueue().some((record) => record.sosPackage.sosId === id)),
  'no prior unsent SOS was dropped when the queue grew');
for (let i = 0; i < 8; i++) {
  const finished = makeItem(`completed test ${i}`);
  finished.status = 'SENT'; // fixture for bounded completed HISTORY only, no network send
  savePendingSOS(finished);
}
assertEqual(getPendingQueue().filter((record) => record.status !== 'SENT').length, 8, 'completed-history cap never discards unsent records');
assertEqual(getPendingQueue().filter((record) => record.status === 'SENT').length, 5, 'only completed history is bounded to five');
assertEqual(calls, 0, 'history-trimming test made no network calls');

section('Offline resilience — storage failure is reported and blocks dispatch');
clearPendingQueue();
const saved = makeItem('save before storage fails');
assertEqual(savePendingSOS(saved), true, 'fixture: queued record saved');
(globalThis.navigator as any).onLine = true;
let attemptedNetwork = 0;
(globalThis as any).fetch = async () => { attemptedNetwork++; throw new Error('should not send'); };
const memory = (globalThis as any).localStorage;
const originalSet = memory.setItem.bind(memory);
const originalWarn = console.warn;
console.warn = () => undefined; // simulated quota error is expected here
memory.setItem = (key: string, value: string) => {
  if (key === 'lifeline_pending_sos_queue') throw new Error('QuotaExceededError');
  return originalSet(key, value);
};
try {
  assertEqual(savePendingSOS(makeItem('not saved due to quota')), false, 'quota error returns FALSE — UI must not claim the SOS was saved');
  const attempted = await transmitSingleSOSItem(saved);
  assertEqual(attempted.attempted, false, 'cannot persist SENDING → do not start an upload');
  assertEqual(attemptedNetwork, 0, 'storage failure did NOT cause a network request');
} finally {
  memory.setItem = originalSet;
  console.warn = originalWarn;
}

section('Delivery receipt durability — never claim SENT when storage fails after handoff');
clearPendingQueue();
const receiptFailure = makeItem('QA receipt storage failure');
assertEqual(savePendingSOS(receiptFailure), true, 'fixture saved before manual authorized attempt');
let receiptHandoffs = 0;
(globalThis as any).fetch = async () => {
  receiptHandoffs++;
  return mockResponse(200, { success: true, data: {
    success: true, status: 'SENT', referenceId: 'MOCK-RECEIPT',
    timestamp: new Date().toISOString(), partnerId: 'authorized-mock',
    providerType: 'AUTHORIZED_API'
  } });
};
console.warn = () => undefined;
memory.setItem = (key: string, value: string) => {
  if (key === 'lifeline_pending_sos_queue' && value.includes('"status":"SENT"')) throw Error('QuotaExceededError');
  return originalSet(key, value);
};
try {
  const outcome = await transmitSingleSOSItem(receiptFailure);
  assertEqual(outcome.success, false, 'UI cannot claim a durable SENT receipt');
  assert(outcome.error?.includes('Verify with the destination before any manual retry'),
    'UI warns that the endpoint may have accepted it and warns against duplicate manual retries');
  assertEqual(receiptHandoffs, 1, 'only the user-triggered request went to mocked authorized partner');
  assertEqual(getPendingQueue()[0]?.status, 'SENDING', 'last durable state remains in-flight, NOT falsely SENT');
} finally {
  memory.setItem = originalSet;
  console.warn = originalWarn;
}
const receiptRestartSpec = '../src/lib/emergencyPartnerQueue.ts?lost-receipt-recovery-qa';
const receiptRestart = await import(receiptRestartSpec) as typeof import('../src/lib/emergencyPartnerQueue.ts');
assertEqual(receiptRestart.getPendingQueue()[0]?.status, 'PENDING_LOCAL', 'restart recovers record for manual verification, not background upload');
assertEqual(receiptHandoffs, 1, 'no automatic resend after lost receipt');
clearPendingQueue();

section('Acknowledgment validation — HTTP 200 is not a successful partner receipt');
const invalidAck = makeItem('QA invalid partner acknowledgment');
assertEqual(savePendingSOS(invalidAck), true, 'invalid-ack fixture saved');
(globalThis as any).fetch = async () => mockResponse(200, { success: true, data: {
  success: false, status: 'FAILED', referenceId: 'DECLINED', providerType: 'AUTHORIZED_API'
} });
const rejected = await transmitSingleSOSItem(invalidAck);
assertEqual(rejected.success, false, 'HTTP 200 with declined acknowledgment does not claim success');
assertEqual(getPendingQueue()[0]?.status, 'FAILED', 'declined acknowledgment stays retryable, never SENT');
clearPendingQueue();

section('Manual-only policy — reconnect, legacy auto-send TRUE, explicit consent, no duplicate handoff');
clearPendingQueue();
(globalThis.navigator as any).onLine = false;
const onReconnect = makeItem(typed);
savePendingSOS(onReconnect);
markWaitingForConnection(onReconnect);
(globalThis.navigator as any).onLine = true;
let bodies: any[] = [];
let lastEndpoint = '';
(globalThis as any).fetch = async (_url: string, init: any) => {
  lastEndpoint = _url;
  bodies.push(JSON.parse(init.body));
  return mockResponse(200, {
    success: true,
    data: { success: true, status: 'SENT', referenceId: 'MOCK-AUTH-RESUME',
      timestamp: new Date().toISOString(), partnerId: 'authorized-mock', providerType: 'AUTHORIZED_API' }
  });
};
assertEqual((await processPendingQueue()).processedCount, 0, 'reconnect cannot transmit even with old auto-send TRUE in storage');
for (let i = 0; i < 500; i++) await processPendingQueue();
assertEqual(bodies.length, 0, '500 reconnect scans, legacy auto-send TRUE: ZERO upload requests');
const noConsent = makeItem('not approved');
noConsent.userApprovedForPartnerTransmission = false;
savePendingSOS(noConsent);
const resumed = await processPendingQueue({ forceManual: true });
assertEqual(resumed.successCount, 1, 'only user-approved record sent to MOCK AUTHORIZED endpoint on manual action');
assertEqual(bodies.length, 1, 'exactly one mock network call after explicit action');
assertEqual(bodies[0].originalTranscript, typed, 'reconnected request preserves the original typed text verbatim');
assertEqual(bodies[0].detectedLanguage?.code, 'hi', 'reconnected request preserves the original language');
assertEqual(bodies[0].userConsentConfirmed, true, 'reconnected request includes per-SOS consent flag');
assertEqual(getPendingQueue().find((r) => r.sosPackage.sosId === onReconnect.sosPackage.sosId)?.status,
  'SENT', 'endpoint handoff is SENT, never a fabricated responder acknowledgement');
assertEqual(getPendingQueue().find((r) => r.sosPackage.sosId === noConsent.sosPackage.sosId)?.status,
  'PENDING_LOCAL', 'unapproved record stays local even after reconnect');
await processPendingQueue();
assertEqual(bodies.length, 1, 'terminal record never re-sent on another queue scan');
assertEqual((await retrySingleSOS(onReconnect.sosPackage.sosId)).attempted, false, 'manual retry also rejects a terminal record');
assertEqual(bodies.length, 1, 'no duplicate send even with manual retry');

section('Offline resilience — network failure retains SOS for manual retry');
clearPendingQueue();
const failing = makeItem('retry on signal recovery');
savePendingSOS(failing);
(globalThis as any).fetch = async () => { throw new TypeError('network dropped'); };
const failed = await processPendingQueue({ forceManual: true });
assertEqual(failed.successCount, 0, 'failed manual request is NOT counted as delivered');
assertEqual(getPendingQueue()[0]?.status, 'FAILED', 'request failure leaves SOS stored for retry');
(globalThis as any).fetch = async (_url: string, init: any) => {
  lastEndpoint = _url;
  bodies.push(JSON.parse(init.body));
  return mockResponse(200, {
    success: true, data: { success: true, status: 'SENT', referenceId: 'MOCK-AUTH-RETRY',
      timestamp: new Date().toISOString(), partnerId: 'authorized-mock', providerType: 'AUTHORIZED_API' }
  });
};
assertEqual((await retrySingleSOS(failing.sosPackage.sosId)).success, true, 'user-confirmed retry after reconnection can hand off to mock endpoint');
assertEqual(getPendingQueue()[0]?.status, 'SENT', 'retry result persisted');

section('Offline resilience — interrupted send recovers on app restart, without background promise');
clearPendingQueue();
const interrupted = makeItem('pending across battery restart');
interrupted.status = 'SENDING';
assertEqual(savePendingSOS(interrupted), true, 'in-flight fixture persisted before restart');
(globalThis.navigator as any).onLine = false;
const offlineRestartSpec = '../src/lib/emergencyPartnerQueue.ts?offline-restart-qa';
const rebootedOffline = await import(offlineRestartSpec) as typeof import('../src/lib/emergencyPartnerQueue.ts');
assertEqual(rebootedOffline.getPendingQueue()[0]?.status, 'WAITING_FOR_CONNECTION', 'restart offline recovers abandoned SENDING into WAITING');
assertEqual(rebootedOffline.getPendingQueue()[0]?.sosPackage.originalTranscript, 'pending across battery restart', 'original typed text survives simulated restart');
const persisted = getPendingQueue()[0];
persisted.status = 'SENDING';
savePendingSOS(persisted);
(globalThis.navigator as any).onLine = true;
const onlineRestartSpec = '../src/lib/emergencyPartnerQueue.ts?online-restart-qa';
const rebootedOnline = await import(onlineRestartSpec) as typeof import('../src/lib/emergencyPartnerQueue.ts');
assertEqual(rebootedOnline.getPendingQueue()[0]?.status, 'PENDING_LOCAL', 'restart online recovers abandoned SENDING into retryable pending');
assertEqual(bodies.length, 2, 'restart recovery alone sends NOTHING; only an explicit manual action may send');
clearPendingQueue();

section('Manual-only policy — real SOS stays local, old TEST records cannot upload');
const localItem = makeLocalItem(typed);
assertEqual(localItem.userApprovedForPartnerTransmission, false, 'saving locally is NOT partner consent');
assertEqual(savePendingSOS(localItem), true, 'real SOS text saved on device');
assertEqual((await processPendingQueue({ forceManual: true })).processedCount, 0, 'even send-all cannot upload a local-only SOS');
assertEqual((await transmitSingleSOSItem(localItem)).attempted, false, 'even direct send refuses a local-only SOS');
assertEqual(getPendingQueue()[0]?.sosPackage.originalTranscript, typed, 'real original words preserved for manual share');
const legacyDemoTarget = createQueuedSOSItem({
  sosPackage: packageFor('A real SOS previously saved to TEST/DEMO'),
  targetPartner: getTestProvider(), userConsentTimestamp: new Date().toISOString()
});
savePendingSOS(legacyDemoTarget);
assertEqual((await processPendingQueue({ forceManual: true })).processedCount, 0,
  'even a prior consented TEST/DEMO real SOS is excluded from manual API dispatch');
assertEqual((await retrySingleSOS(legacyDemoTarget.sosPackage.sosId)).attempted, false,
  'direct manual retry refuses real user data targeted to TEST/DEMO');
let legacyRejected = false;
try { await sendSOSToPartner(legacyDemoTarget); } catch { legacyRejected = true; }
assert(legacyRejected && bodies.length === 2, 'low-level send also blocks real data to demo before fetch');
clearPendingQueue();

section('Manual-only policy — explicitly approved authorized API can receive metadata, never media bytes');
const manuallyApproved = makeItem('manually reviewed SOS');
manuallyApproved.targetPartner.apiBaseUrl = 'https://untrusted.example/bypass-ledger'; // persisted metadata must never bypass server
manuallyApproved.sosPackage.photos = [{ type: 'image', name: 'photo.jpg', mimeType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,PRIVATE-PHOTO' }];
manuallyApproved.sosPackage.video = { type: 'video', name: 'clip.webm', mimeType: 'video/webm', dataUrl: 'data:video/webm;base64,PRIVATE-VIDEO' };
assertEqual(savePendingSOS(manuallyApproved), true, 'manual-send fixture saved locally');
assertEqual((await processPendingQueue()).processedCount, 0, 'reconnecting by itself does not upload an approved authorized record');
assertEqual((await processPendingQueue({ forceManual: true })).successCount, 1,
  'explicit user-triggered send can hand off to the MOCK AUTHORIZED endpoint');
assertEqual(lastEndpoint, '/api/emergency-partner/dispatch', 'even a modified partner URL cannot bypass server ledger');
assert(!JSON.stringify(bodies[2]).includes('PRIVATE-PHOTO') && !JSON.stringify(bodies[2]).includes('PRIVATE-VIDEO'),
  'no old photo/video dataUrl bytes sent from queue, only file details');
assertEqual((await processPendingQueue()).processedCount, 0, 'old auto-send TRUE cannot re-enable itself after manual send');
clearPendingQueue();

// Bind the actual UI call sites to the safeguards above (without rendering DOM).
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const card = readFileSync(new URL('../src/components/SOSCardView.tsx', import.meta.url), 'utf8');
const silent = readFileSync(new URL('../src/components/SilentSOS.tsx', import.meta.url), 'utf8');
const manager = readFileSync(new URL('../src/components/EmergencyPartnersManagerModal.tsx', import.meta.url), 'utf8');
const server = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
assert(manager.includes('handleShareItem') && !manager.includes('setAutoSendSetting') && manager.includes('PER-RECORD CONSENT'),
  'queue offers deliberate manual device share and explains per-record automatic consent');
assert(server.includes("demoOnly !== true") && server.includes("providerType !== 'TEST'"),
  'server also rejects non-synthetic/unknown TEST dispatches');
assert(server.includes('photos: safePhotos') && server.includes('video: safeVideo'),
  'server never proxies legacy dataUrl media bytes to a future authorized integration');
assert(!app.includes('processPendingQueue(') && !app.includes('PENDING_SOS_RETRY_INTERVAL_MS'),
  'App has no automatic queue processor on load, reconnect, focus, or timer');
assert(app.includes("localStorage.getItem('lifeline_force_offline')"), 'offline preference survives reload / battery restart when storage is available');
assert(app.includes("localStorage.setItem('lifeline_autosend_pending_sos', 'false')"),
  'new app disables the legacy auto-send preference for any older tabs still open');
assert(card.includes('if (!savePendingSOS(pendingItem))') && silent.includes('if (!savePendingSOS(pendingItem))'),
  'both SOS confirm buttons show a failure if device storage rejects the SOS');
assert(card.includes('targetPartner: LOCAL_ONLY_PROVIDER') && silent.includes('targetPartner: LOCAL_ONLY_PROVIDER') &&
  !card.includes('processPendingQueue(') && !silent.includes('processPendingQueue('),
  'both REAL SOS save flows are local-only, online and offline (never TEST/DEMO dispatch)');
assert(silent.includes('SAVE VIDEO TO DEVICE') && silent.includes('NOT uploaded or kept in the SOS queue'),
  'recorded video is clearly marked tab-only, with an explicit save-to-device option');
