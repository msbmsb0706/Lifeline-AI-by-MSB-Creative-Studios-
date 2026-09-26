import { section, assert, assertEqual } from './helpers.ts';
import { installBrowserStub, mockResponse } from './browser-stub.ts';
import { LOCAL_ONLY_PROVIDER, getTestProvider } from '../src/lib/emergencyPartnersData.ts';
import { createQueuedSOSItem, createSOSPackage, getPendingQueue, markWaitingForConnection,
  savePendingSOS, normalizePendingSOSItem, retrySingleSOS } from '../src/lib/emergencyPartnerQueue.ts';
import { recoverAutomaticSOS, startAutomaticSOSRecovery } from '../src/lib/automaticSOSRecovery.ts';
import { getEmergencyPartnerConfig } from '../server/partnerConfig.ts';

section('PR25: explicit opt-in, legacy normalization and transport-neutral reachability');
let requests: string[] = [];
let dispatches: any[] = [];
let backend = true;
let configured = true;
let partnerStatus = 200;
const response = (url: string, init?: any) => {
  requests.push(url);
  if (url === '/api/status') return Promise.resolve(backend
    ? mockResponse(200, { status: 'offline_ready', server_time: new Date().toISOString() })
    : mockResponse(503, {}));
  if (url.startsWith('/api/emergency-partner/config')) return Promise.resolve(mockResponse(200, {
    success: true, data: { status: configured ? 'CONFIGURED' : 'NOT_CONFIGURED', automaticRecoverySupported: configured }
  }));
  if (url === '/api/emergency-partner/dispatch') {
    dispatches.push(JSON.parse(init.body));
    return Promise.resolve(mockResponse(partnerStatus, partnerStatus === 200 ? {
      success: true, data: { success: true, referenceId: 'PARTNER-1', providerType: 'AUTHORIZED_API',
        timestamp: new Date().toISOString() }
    } : { success: false }));
  }
  throw Error('Unexpected destination');
};
installBrowserStub({ online: false, fetch: response });
const make = (automaticRecovery?: boolean) => createQueuedSOSItem({
  sosPackage: createSOSPackage({ emergencyType: 'MEDICAL', severity: 4, message: 'Private SOS',
    photos: [{ type: 'image', name: 'photo.jpg', mimeType: 'image/jpeg', sizeBytes: 20 }] }),
  targetPartner: LOCAL_ONLY_PROVIDER, userConsentTimestamp: new Date().toISOString(), automaticRecovery
});
let off = make(false);
savePendingSOS(off); markWaitingForConnection(off);
let on = make(true);
savePendingSOS(on); markWaitingForConnection(on);
assertEqual(getPendingQueue().find(i => i.sosPackage.sosId === off.sosPackage.sosId)?.automaticRecovery, false, 'offline save defaults to manual');
assertEqual(getPendingQueue().find(i => i.sosPackage.sosId === on.sosPackage.sosId)?.automaticRecovery, true, 'offline opt-in saved on record');
const legacy = { ...make(), automaticRecovery: undefined, status: 'WAITING_FOR_CONNECTION' as const };
savePendingSOS(legacy);
assertEqual(normalizePendingSOSItem(legacy).automaticRecovery, false, 'missing field is never consent');
await recoverAutomaticSOS();
assertEqual(requests.length, 0, 'offline never probes or sends');

// All browser online signals are treated identically: no Wi-Fi/mobile/satellite checks.
(globalThis as any).navigator.onLine = true;
backend = false;
await recoverAutomaticSOS();
assertEqual(dispatches.length, 0, 'browser online with unreachable backend never dispatches');
backend = true; configured = false;
await recoverAutomaticSOS();
assertEqual(dispatches.length, 0, 'reachable backend without authorized destination never sends to demo');
assertEqual(getPendingQueue().find(i => i.sosPackage.sosId === on.sosPackage.sosId)?.errorMessage,
  'CONNECTION AVAILABLE — NO AUTHORIZED DESTINATION', 'no destination surfaced without discarding SOS');
configured = true;
await recoverAutomaticSOS();
assertEqual(dispatches.length, 1, 'generic verified Internet transport sends only opted-in SOS to authorized API');
assertEqual(dispatches[0].sosId, on.sosPackage.sosId, 'existing SOS ID is used for dispatch');
assertEqual(dispatches[0].gps, null, 'saved GPS is excluded without separate consent');
assert(!JSON.stringify(dispatches[0]).includes('dataUrl'), 'no media bytes in partner queue');
assertEqual(getPendingQueue().find(i => i.sosPackage.sosId === on.sosPackage.sosId)?.status, 'SENT',
  'receipt becomes SENT, never fabricated DELIVERED or ACKNOWLEDGED');
assertEqual(getPendingQueue().find(i => i.sosPackage.sosId === on.sosPackage.sosId)?.automaticRecovery, true,
  'the automatic-send opt-in survives the send so the card can state it was automatic');
assertEqual(getPendingQueue().find(i => i.sosPackage.sosId === off.sosPackage.sosId)?.status, 'WAITING_FOR_CONNECTION',
  'opt-out stays waiting after backend recovery');
assertEqual(getPendingQueue().find(i => i.sosPackage.sosId === legacy.sosPackage.sosId)?.status, 'WAITING_FOR_CONNECTION',
  'legacy stays waiting after backend recovery');
await recoverAutomaticSOS();
assertEqual(dispatches.length, 1, 'terminal SOS ID not resubmitted');

section('PR25: temporary failure, bounded backoff, permanent failure and manual retry');
partnerStatus = 503;
const temp = make(true); savePendingSOS(temp); markWaitingForConnection(temp);
await recoverAutomaticSOS();
const failed = getPendingQueue().find(i => i.sosPackage.sosId === temp.sosPackage.sosId)!;
assertEqual(failed.status, 'WAITING_FOR_CONNECTION', '5xx returns to waiting, not stuck sending');
assert((failed.nextRecoveryAt || 0) > Date.now(), 'temporary failure has persisted bounded retry delay');
const count = dispatches.length;
await recoverAutomaticSOS();
assertEqual(dispatches.length, count, 'no rapid retry before backoff expires');
failed.nextRecoveryAt = 0; savePendingSOS(failed); partnerStatus = 200;
await recoverAutomaticSOS();
assertEqual(getPendingQueue().find(i => i.sosPackage.sosId === temp.sosPackage.sosId)?.status, 'SENT', 'retry after delay succeeds');
partnerStatus = 401;
const permanent = make(true); savePendingSOS(permanent); markWaitingForConnection(permanent);
await recoverAutomaticSOS();
assertEqual(getPendingQueue().find(i => i.sosPackage.sosId === permanent.sosPackage.sosId)?.recoveryBlocked, true,
  '4xx blocks unattended retries but preserves record');
partnerStatus = 200;
const before = dispatches.length;
await recoverAutomaticSOS();
assertEqual(dispatches.length, before, 'permanent error is not retried automatically');
assertEqual((await retrySingleSOS(permanent.sosPackage.sosId)).success, true,
  'manual SEND NOW still works on reviewed authorized record');

section('PR25: session restore and foreground signals');
const restart = make(true); restart.status = 'SENDING'; savePendingSOS(restart);
const manualRestart = make(false); manualRestart.status = 'SENDING'; savePendingSOS(manualRestart);
// Session recovery is once per module instance; a fresh import simulates re-opening.
// @ts-ignore: query string intentionally creates a fresh module instance for restart simulation
const fresh = await import('../src/lib/emergencyPartnerQueue.ts?pr25-restart');
assertEqual(fresh.getPendingQueue().find(i => i.sosPackage.sosId === restart.sosPackage.sosId)?.status, 'PENDING_LOCAL',
  'interrupted SENDING is restored to retryable pending');
await recoverAutomaticSOS();
assertEqual(getPendingQueue().find(i => i.sosPackage.sosId === restart.sosPackage.sosId)?.status, 'SENT',
  'opt-in record recovers on app restart');
assertEqual(getPendingQueue().find(i => i.sosPackage.sosId === manualRestart.sosPackage.sosId)?.status, 'PENDING_LOCAL',
  'opt-out restart does not send');
const handlers = new Map<string, () => void>();
const doc = { hidden: false, addEventListener: (name: string, cb: () => void) => handlers.set(name, cb),
  removeEventListener: (name: string) => handlers.delete(name) };
(globalThis as any).document = doc;
(globalThis as any).window = { addEventListener: (_name: string, _cb: () => void) => {},
  removeEventListener: (_name: string, _cb: () => void) => {} };
const foreground = make(true); savePendingSOS(foreground); markWaitingForConnection(foreground);
backend = false;
const stop = startAutomaticSOSRecovery(() => false);
await new Promise(resolve => setTimeout(resolve, 20));
assertEqual(getPendingQueue().find(i => i.sosPackage.sosId === foreground.sosPackage.sosId)?.status,
  'WAITING_FOR_CONNECTION', 'startup does not send when backend unreachable');
backend = true; handlers.get('visibilitychange')?.();
await new Promise(resolve => setTimeout(resolve, 20));
assertEqual(getPendingQueue().find(i => i.sosPackage.sosId === foreground.sosPackage.sosId)?.status, 'SENT',
  'visibility/foreground event rechecks and recovers');
stop();

section('Fail-closed capability: environment flag is NOT proof of partner idempotency');
assertEqual(getEmergencyPartnerConfig('GLOBAL', { AUTHORIZED_PARTNER_API_URL: 'https://partner.example/sos',
  AUTHORIZED_PARTNER_API_KEY: 'dummy' }).automaticRecoverySupported, false,
  'unverified partner does not enable unattended dispatch');
assertEqual(getEmergencyPartnerConfig('GLOBAL', { AUTHORIZED_PARTNER_API_URL: 'https://partner.example/sos',
  AUTHORIZED_PARTNER_API_KEY: 'dummy', AUTHORIZED_PARTNER_IDEMPOTENCY_SUPPORTED: 'true' }).automaticRecoverySupported, false,
  'a self-declared environment flag still cannot enable unattended dispatch');
assertEqual(getTestProvider().providerType, 'TEST', 'demo remains a separate synthetic destination');

section('PR25: synthetic safety and consent UI wiring');
const realTest = make(true);
realTest.targetPartner = getTestProvider();
savePendingSOS(realTest); markWaitingForConnection(realTest);
const countBeforeTest = dispatches.length;
await recoverAutomaticSOS();
assertEqual(dispatches.length, countBeforeTest, 'real SOS with TEST destination never auto-dispatches');
const { readFileSync } = await import('node:fs');
const serverSource = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const modalSource = readFileSync(new URL('../src/components/PartnerConsentModal.tsx', import.meta.url), 'utf8');
assert(serverSource.includes("'Idempotency-Key': sosId") && serverSource.includes('automaticRecoverySupported !== true'),
  'authorized route forwards SOS ID and refuses auto delivery without partner idempotency contract');
assert(modalSource.includes('checked={automaticRecovery}') && modalSource.includes('SAVE LOCALLY + AUTOMATIC RECOVERY'),
  'final local confirmation has explicit unchecked opt-in and distinct save actions');

section('PR25: interrupted in-flight request and online/foreground event triggers');
// Recreate a reachable backend and hold the partner response until connectivity drops.
let releasePartner: (() => void) | undefined;
let startedPartner: (() => void) | undefined;
const partnerStarted = new Promise<void>(resolve => { startedPartner = resolve; });
(globalThis as any).fetch = (url: string, init?: any) => url === '/api/emergency-partner/dispatch'
  ? new Promise((_resolve, reject) => { releasePartner = () => reject(new Error('Network disappeared')); startedPartner?.(); })
  : response(url, init);
const interrupted = make(true);
savePendingSOS(interrupted); markWaitingForConnection(interrupted);
const pending = recoverAutomaticSOS();
await partnerStarted;
assertEqual(getPendingQueue().find(i => i.sosPackage.sosId === interrupted.sosPackage.sosId)?.status,
  'SENDING', 'verified backend moves record to SENDING only while a request is in flight');
(globalThis as any).navigator.onLine = false;
releasePartner?.();
await pending;
assertEqual(getPendingQueue().find(i => i.sosPackage.sosId === interrupted.sosPackage.sosId)?.status,
  'WAITING_FOR_CONNECTION', 'network loss during send safely returns to waiting');
(globalThis as any).navigator.onLine = true;
(globalThis as any).fetch = response;
const hooks = new Map<string, () => void>();
(globalThis as any).window = { addEventListener: (name: string, cb: () => void) => hooks.set(name, cb),
  removeEventListener: (name: string) => hooks.delete(name) };
const another = make(true); savePendingSOS(another); markWaitingForConnection(another);
const unsubscribe = startAutomaticSOSRecovery(() => true);
hooks.get('online')?.();
await new Promise(resolve => setTimeout(resolve, 20));
assertEqual(getPendingQueue().find(i => i.sosPackage.sosId === another.sosPackage.sosId)?.status,
  'WAITING_FOR_CONNECTION', 'user-forced offline mode pauses recovery despite browser online');
unsubscribe();
const runOnline = startAutomaticSOSRecovery(() => false);
await new Promise(resolve => setTimeout(resolve, 20));
assertEqual(getPendingQueue().find(i => i.sosPackage.sosId === another.sosPackage.sosId)?.status,
  'SENT', 'startup after unpausing sends opted-in record');
runOnline(); // dispose scheduler

section('Fail-closed browser restart: interrupted SENDING becomes UNCONFIRMED, never re-POSTed to partner');
installBrowserStub({ online: true, fetch: async (url) => {
  if (url === '/api/status') return mockResponse(200, { status: 'offline_ready', server_time: new Date().toISOString() });
  if (url.startsWith('/api/emergency-partner/config')) return mockResponse(200,
    { success: true, data: { status: 'CONFIGURED', automaticRecoverySupported: true } });
  if (url === '/api/emergency-partner/dispatch') {
    backendAttempts++;
    return mockResponse(409, { success: false, code: 'HANDOFF_UNCONFIRMED' });
  }
  throw Error('No external partner calls permitted');
} });
let backendAttempts = 0;
const crashed = make(true);
crashed.status = 'SENDING';
savePendingSOS(crashed);
// @ts-ignore: new import simulates a fresh browser session
const afterCrash = await import('../src/lib/emergencyPartnerQueue.ts?unknown-restart');
assertEqual(afterCrash.getPendingQueue()[0].status, 'PENDING_LOCAL', 'abandoned browser SENDING restored for server check');
await recoverAutomaticSOS();
const uncertainSaved = getPendingQueue()[0];
assertEqual(uncertainSaved.status, 'UNCONFIRMED', 'server unknown result persisted as unconfirmed, never SENT');
assertEqual(uncertainSaved.handoffUnconfirmed, true, 'unconfirmed flag survives browser storage');
assertEqual(backendAttempts, 1, 'browser asked backend once, partner was never POSTed again');
await recoverAutomaticSOS();
assertEqual(backendAttempts, 1, 'unconfirmed record is excluded from automatic recovery');
assertEqual((await retrySingleSOS(crashed.sosPackage.sosId)).attempted, false,
  'manual API retry is also refused; device sharing remains separate');
// @ts-ignore: new import simulates a further app restart
const afterSecondCrash = await import('../src/lib/emergencyPartnerQueue.ts?unknown-still-local');
assertEqual(afterSecondCrash.getPendingQueue()[0].status, 'UNCONFIRMED',
  'unconfirmed state persists across an additional browser restart');
