/**
 * BUG 3 regression tests — SOS SENT / DELIVERED / ACKNOWLEDGED lifecycle.
 *
 * Exercises the REAL queue module (src/lib/emergencyPartnerQueue.ts) with only
 * the browser globals stubbed, proving:
 *  - E: TEST/DEMO never automatically claims DELIVERED or ACKNOWLEDGED.
 *  - F: explicit demo simulation can move SENT → DELIVERED → ACKNOWLEDGED
 *       locally, without a real network emergency dispatch.
 *  - G: authorized partner deliveryConfirmed=true → DELIVERED.
 *  - H: authorized partner responderAcknowledged=true → ACKNOWLEDGED.
 *  - I: HTTP success without those flags remains SENT.
 *  - Persistence across "refresh" (re-read from localStorage).
 *  - Consent / pending queue behavior preserved.
 */
import { installBrowserStub, mockResponse } from './browser-stub.ts';
import {
  SOS_DELIVERY_STATUS_META,
  createSOSPackage,
  createQueuedSOSItem,
  sendSOSToPartner,
  getPendingQueue,
  processPendingQueue,
  simulateDemoLifecycleAdvance,
  isDemoSimulatableItem,
  transmitSingleSOSItem,
  savePendingSOS,
  clearPendingQueue,
  markWaitingForConnection
} from '../src/lib/emergencyPartnerQueue.ts';
import { getTestProvider } from '../src/lib/emergencyPartnersData.ts';
import { EmergencyPartnerProvider, SOSDeliveryStatus } from '../src/types.ts';
import { section, assert, assertEqual } from './helpers.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_PROVIDER: EmergencyPartnerProvider = getTestProvider();

const AUTHORIZED_PROVIDER: EmergencyPartnerProvider = {
  id: 'authorized-test',
  country: 'US',
  countryName: 'United States',
  providerName: 'Authorized Test Partner',
  providerType: 'AUTHORIZED_API',
  serviceType: 'RESCUE',
  apiBaseUrl: '/api/emergency-partner/dispatch',
  apiEnabled: true,
  requiresUserConfirmation: true,
  supportsMediaUpload: false
};

function makeSOSPkg(message = 'Test distress message', demoOnly = false) {
  return createSOSPackage({
    emergencyType: 'MEDICAL',
    category: 'MEDICAL',
    severity: 3,
    message,
    gps: null,
    source: 'online',
    demoOnly
  });
}

function queueItem(partner: EmergencyPartnerProvider, message?: string) {
  return createQueuedSOSItem({
    sosPackage: makeSOSPkg(message, partner.providerType === 'TEST'),
    targetPartner: partner,
    userConsentTimestamp: new Date().toISOString()
  });
}

function installDemoFetch(referenceId: string, onCall?: () => void) {
  installBrowserStub({
    online: true,
    fetch: () => {
      onCall?.();
      return Promise.resolve(
        mockResponse(200, {
          success: true,
          data: {
            success: true,
            status: 'SENT',
            referenceId,
            timestamp: new Date().toISOString(),
            message: 'MOCK ack — DEMONSTRATION ONLY',
            partnerId: 'test-partner-demo',
            partnerName: 'TEST',
            providerType: 'TEST'
          }
        })
      );
    }
  });
}

function installAuthorizedFetch(ackBody: any) {
  installBrowserStub({
    online: true,
    fetch: () => Promise.resolve(mockResponse(200, { success: true, data: ackBody }))
  });
}

function refind(sosId: string) {
  return getPendingQueue().find((i) => i.sosPackage.sosId === sosId);
}

// ---------------------------------------------------------------------------
// E + I: TEST/DEMO ack (HTTP 200, success:true, no flags) → SENT only
// ---------------------------------------------------------------------------
section('E — TEST/DEMO acknowledgment (HTTP 200, no flags) stays SENT (never DELIVERED/ACKNOWLEDGED)');

async function demoHandoffFlow() {
  clearPendingQueue();
  installDemoFetch('DEMO-REF-1');
  const item = queueItem(TEST_PROVIDER, 'Demo handoff message');
  savePendingSOS(item);
  const result = await transmitSingleSOSItem(item);
  return { item, result, fresh: refind(item.sosPackage.sosId) };
}

const demoHandoff = await demoHandoffFlow();
assert(demoHandoff.result.success === true, 'TEST/DEMO transmission outcome marked success');
assertEqual(demoHandoff.item.status, 'SENT', 'TEST/DEMO ack (no flags) results in SENT');
assertEqual(demoHandoff.fresh?.status, 'SENT', 'SENT persists in the stored queue (refresh-safe)');
assert(!demoHandoff.item.deliveredAt, 'no deliveredAt set for TEST/DEMO auto-path');
assert(!demoHandoff.item.acknowledgedAt, 'no acknowledgedAt set for TEST/DEMO auto-path');

// ---------------------------------------------------------------------------
// E: simulator eligibility is strictly TEST-provider only
// ---------------------------------------------------------------------------
section('Simulator eligibility is strictly TEST-provider only');

clearPendingQueue();
const authItem = queueItem(AUTHORIZED_PROVIDER);
assertEqual(isDemoSimulatableItem(queueItem(TEST_PROVIDER)), true, 'TEST record is simulation-eligible');
assertEqual(isDemoSimulatableItem(authItem), false, 'AUTHORIZED_API record is NOT simulation-eligible');
assertEqual(isDemoSimulatableItem(null), false, 'null is not simulation-eligible');
assertEqual(simulateDemoLifecycleAdvance('does-not-exist', 'DELIVERED').ok, false, 'unknown SOS id rejected');

// ---------------------------------------------------------------------------
// F: explicit demo simulation SENT → DELIVERED → ACKNOWLEDGED, no network
// ---------------------------------------------------------------------------
section('F — explicit TEST/DEMO ONLY simulation SENT → DELIVERED → ACKNOWLEDGED (no network)');

// F1: strict ordering — ACKNOWLEDGED is not reachable directly from SENT.
{
  clearPendingQueue();
  installDemoFetch('DEMO-REF-START');
  const orderingItem = queueItem(TEST_PROVIDER, 'Ordering check');
  savePendingSOS(orderingItem);
  await transmitSingleSOSItem(orderingItem);
  (globalThis as any).fetch = () => {
    throw new Error('no network expected');
  };
  const skipStep = simulateDemoLifecycleAdvance(orderingItem.sosPackage.sosId, 'ACKNOWLEDGED');
  assertEqual(skipStep.ok, false, 'ACKNOWLEDGED cannot be simulated directly from SENT (strict ordering)');
  assertEqual(refind(orderingItem.sosPackage.sosId)?.status, 'SENT', 'rejected skip leaves record at SENT');
}

// F2: full explicit simulation flow SENT → DELIVERED → ACKNOWLEDGED.
clearPendingQueue();
let simFetchCalls = 0;
installDemoFetch('DEMO-REF-2', () => {
  simFetchCalls += 1;
});
const simItem = queueItem(TEST_PROVIDER, 'Simulation distress message');
savePendingSOS(simItem);
await transmitSingleSOSItem(simItem);
assertEqual(simItem.status, 'SENT', 'simulation fixture reaches SENT via TEST/DEMO dispatch');
assertEqual(simFetchCalls, 1, 'exactly one real (demo) dispatch happened before simulation');

// From here on, network use is forbidden — make fetch throw.
(globalThis as any).fetch = () => {
  simFetchCalls += 1;
  throw new Error('TEST/DEMO simulator must never call fetch');
};

// Strict ordering is re-verified on the live fixture before the valid path.
{
  const skipStep = simulateDemoLifecycleAdvance(simItem.sosPackage.sosId, 'ACKNOWLEDGED');
  assertEqual(skipStep.ok, false, 'ACKNOWLEDGED still cannot be simulated directly from SENT on the fixture');
  assertEqual(refind(simItem.sosPackage.sosId)?.status, 'SENT', 'fixture remains SENT after rejected skip');
}

const step1 = simulateDemoLifecycleAdvance(simItem.sosPackage.sosId, 'DELIVERED');
assertEqual(step1.ok, true, 'simulate DELIVERED accepted from SENT');
assertEqual(step1.status, 'DELIVERED', 'status advanced to DELIVERED');
let fresh = refind(simItem.sosPackage.sosId);
assertEqual(fresh?.status, 'DELIVERED', 'DELIVERED persisted');
assert(Boolean(fresh?.deliveredAt), 'simulated deliveredAt timestamp set');
assert(
  fresh?.statusHistory?.some((t) => t.status === 'DELIVERED' && t.simulated),
  'DELIVERED transition is stamped simulated'
);

const step2 = simulateDemoLifecycleAdvance(simItem.sosPackage.sosId, 'ACKNOWLEDGED');
assertEqual(step2.ok, true, 'simulate ACKNOWLEDGED accepted from DELIVERED');
assertEqual(step2.status, 'ACKNOWLEDGED', 'status advanced to ACKNOWLEDGED');
fresh = refind(simItem.sosPackage.sosId);
assertEqual(fresh?.status, 'ACKNOWLEDGED', 'ACKNOWLEDGED persisted');
assert(Boolean(fresh?.acknowledgedAt), 'simulated acknowledgedAt timestamp set');
assert(
  fresh?.statusHistory?.some((t) => t.status === 'ACKNOWLEDGED' && t.simulated),
  'ACKNOWLEDGED transition is stamped simulated'
);

// Cannot move backwards.
assertEqual(simulateDemoLifecycleAdvance(simItem.sosPackage.sosId, 'DELIVERED').ok, false, 'simulation cannot move backwards');

// The simulator never fabricates confirmation flags. The `acknowledgment`
// field that survives is the ORIGINAL TEST/DEMO handoff receipt (that is what
// justifies SENT), and it must still carry NO delivery/acknowledgement claims.
assertEqual(
  fresh?.acknowledgment?.deliveryConfirmed ?? false,
  false,
  'simulator never fabricates deliveryConfirmed on the handoff ack'
);
assertEqual(
  fresh?.acknowledgment?.responderAcknowledged ?? false,
  false,
  'simulator never fabricates responderAcknowledged on the handoff ack'
);
const deliveredOrAckedTransitions =
  fresh?.statusHistory?.filter((t) => t.status === 'DELIVERED' || t.status === 'ACKNOWLEDGED') || [];
assert(
  deliveredOrAckedTransitions.length > 0 &&
    deliveredOrAckedTransitions.every((t) => t.simulated === true),
  'every DELIVERED/ACKNOWLEDGED transition in the demo record is labelled simulated'
);

assertEqual(simFetchCalls, 1, 'simulation performed ZERO additional network calls (only the pre-simulation dispatch)');

// Persists across "refresh": re-read from localStorage.
const refreshed = refind(simItem.sosPackage.sosId);
assertEqual(refreshed?.status, 'ACKNOWLEDGED', 'simulated status persists across refresh');
assertEqual(
  SOS_DELIVERY_STATUS_META[refreshed?.status as SOSDeliveryStatus].terminal,
  true,
  'simulated ACKNOWLEDGED is terminal (consistent in SOSCardView + queue modal)'
);

// ---------------------------------------------------------------------------
// G: authorized partner deliveryConfirmed=true → DELIVERED
// ---------------------------------------------------------------------------
section('G — authorized partner deliveryConfirmed=true → DELIVERED');

async function authorizedFlow(kind: 'delivery' | 'ack' | 'httponly') {
  clearPendingQueue();
  const ackBody: any = {
    success: true,
    status: kind === 'ack' ? 'ACKNOWLEDGED' : kind === 'delivery' ? 'DELIVERED' : 'SENT',
    referenceId: 'AUTH-REF-' + kind,
    timestamp: new Date().toISOString(),
    message: 'Authorized partner response',
    partnerId: 'authorized-test',
    partnerName: 'Authorized Rescue Network API',
    providerType: 'AUTHORIZED_API'
  };
  if (kind === 'delivery') ackBody.deliveryConfirmed = true;
  if (kind === 'ack') ackBody.responderAcknowledged = true;

  installAuthorizedFetch(ackBody);
  const item = queueItem(AUTHORIZED_PROVIDER, `Authorized ${kind} message`);
  savePendingSOS(item);
  const result = await transmitSingleSOSItem(item);
  return { result, item, fresh: refind(item.sosPackage.sosId) };
}

const deliveryFlow = await authorizedFlow('delivery');
assert(deliveryFlow.result.success === true, 'authorized delivery transmission succeeded');
assertEqual(deliveryFlow.fresh?.status, 'DELIVERED', 'deliveryConfirmed=true → DELIVERED');
assert(Boolean(deliveryFlow.fresh?.deliveredAt), 'deliveredAt recorded');
assertEqual(deliveryFlow.fresh?.acknowledgedAt, undefined, 'deliveryConfirmed alone does NOT set acknowledgedAt');

// ---------------------------------------------------------------------------
// H: authorized partner responderAcknowledged=true → ACKNOWLEDGED
// ---------------------------------------------------------------------------
section('H — authorized partner responderAcknowledged=true → ACKNOWLEDGED');

const ackFlow = await authorizedFlow('ack');
assert(ackFlow.result.success === true, 'authorized ack transmission succeeded');
assertEqual(ackFlow.fresh?.status, 'ACKNOWLEDGED', 'responderAcknowledged=true → ACKNOWLEDGED');
assert(Boolean(ackFlow.fresh?.acknowledgedAt), 'acknowledgedAt recorded');

// ---------------------------------------------------------------------------
// I (authorized variant): HTTP success without flags remains SENT
// ---------------------------------------------------------------------------
section('I — HTTP success without confirmation flags remains SENT (authorized + demo)');

const httpOnlyFlow = await authorizedFlow('httponly');
assert(httpOnlyFlow.result.success === true, 'authorized handoff succeeded');
assertEqual(httpOnlyFlow.fresh?.status, 'SENT', 'HTTP success without flags remains SENT');
assert(
  !httpOnlyFlow.fresh?.deliveredAt && !httpOnlyFlow.fresh?.acknowledgedAt,
  'no delivery/acknowledgement inferred from HTTP success'
);

// ---------------------------------------------------------------------------
// Consent & pending queue behavior preserved
// ---------------------------------------------------------------------------
section('Consent & pending queue behavior preserved');

clearPendingQueue();
installDemoFetch('CONSENT-REF');
const noConsentItem = queueItem(TEST_PROVIDER, 'Consent check');
noConsentItem.userApprovedForPartnerTransmission = false;
savePendingSOS(noConsentItem);
const consentRes = await processPendingQueue({ forceManual: true });
const consentFresh = refind(noConsentItem.sosPackage.sosId);
assertEqual(consentRes.processedCount, 0, 'records without consent are never transmitted');
assertEqual(consentFresh?.status, 'PENDING_LOCAL', 'unapproved record stays PENDING_LOCAL');
assertEqual(consentFresh?.attempts, 0, 'no transmission attempt made without consent');

// ---------------------------------------------------------------------------
// sendSOSToPartner returns raw ack without inference
// ---------------------------------------------------------------------------
section('sendSOSToPartner returns raw ack without inference');

installDemoFetch('RAW-REF');
const rawAck = await sendSOSToPartner(queueItem(TEST_PROVIDER, 'raw ack check'));
assertEqual(rawAck.status, 'SENT', 'raw handoff status is SENT, never responder acknowledgement');
assertEqual(rawAck.deliveryConfirmed, undefined, 'no deliveryConfirmed inferred from handoff status');
assertEqual(rawAck.responderAcknowledged, undefined, 'no responderAcknowledged inferred from handoff status');

// ---------------------------------------------------------------------------
// Audit follow-up guard — simulateDemoLifecycleAdvance('DELIVERED') requires
// SENT. Strict, explicit progression only: SENT → DELIVERED → ACKNOWLEDGED.
// Never directly from PENDING_LOCAL / WAITING_FOR_CONNECTION / SENDING / FAILED.
// ---------------------------------------------------------------------------
section('Guard — DELIVERED simulation is rejected unless the record is SENT');

// PENDING_LOCAL → DELIVERED rejected (and no network touch, nothing fabricated).
{
  clearPendingQueue();
  let fetchCalls = 0;
  installBrowserStub({
    online: true,
    fetch: () => {
      fetchCalls += 1;
      return Promise.resolve(mockResponse(200, { success: true, data: {} }));
    }
  });
  const item = queueItem(TEST_PROVIDER, 'Guard probe: pending');
  savePendingSOS(item);
  const r = simulateDemoLifecycleAdvance(item.sosPackage.sosId, 'DELIVERED');
  assertEqual(r.ok, false, 'DELIVERED simulation rejected from PENDING_LOCAL');
  assertEqual(r.status, 'PENDING_LOCAL', 'PENDING_LOCAL record status unchanged');
  const fresh = refind(item.sosPackage.sosId);
  assert(!fresh?.deliveredAt, 'rejected simulation fabricates no deliveredAt');
  assert(
    !fresh?.statusHistory?.some((t) => t.status === 'DELIVERED'),
    'rejected simulation writes no DELIVERED transition'
  );
  assertEqual(fetchCalls, 0, 'rejected simulation performed ZERO network calls');
}

// FAILED → DELIVERED rejected.
{
  clearPendingQueue();
  installBrowserStub({
    online: true,
    fetch: () => Promise.resolve(mockResponse(500, { success: false, error: 'upstream unavailable' }))
  });
  const item = queueItem(TEST_PROVIDER, 'Guard probe: failed');
  savePendingSOS(item);
  const res = await transmitSingleSOSItem(item);
  assertEqual(res.success, false, 'fixture: transmission failed (record is FAILED)');
  assertEqual(refind(item.sosPackage.sosId)?.status, 'FAILED', 'fixture: record persisted as FAILED');
  const r = simulateDemoLifecycleAdvance(item.sosPackage.sosId, 'DELIVERED');
  assertEqual(r.ok, false, 'DELIVERED simulation rejected from FAILED');
  assertEqual(r.status, 'FAILED', 'FAILED record status unchanged');
}

// SENDING (genuinely in flight) → DELIVERED rejected.
{
  clearPendingQueue();
  installBrowserStub({
    online: true,
    fetch: () => new Promise(() => {}) // never resolves → record stays SENDING
  });
  const item = queueItem(TEST_PROVIDER, 'Guard probe: sending');
  savePendingSOS(item);
  const inFlight = transmitSingleSOSItem(item); // intentionally not awaited
  assertEqual(refind(item.sosPackage.sosId)?.status, 'SENDING', 'fixture: record is SENDING (in flight)');
  const r = simulateDemoLifecycleAdvance(item.sosPackage.sosId, 'DELIVERED');
  assertEqual(r.ok, false, 'DELIVERED simulation rejected while SENDING');
  assertEqual(r.status, 'SENDING', 'SENDING record status unchanged');
  void inFlight; // the dangling transmission never resolves; nothing to await
}

// WAITING_FOR_CONNECTION → DELIVERED rejected.
{
  clearPendingQueue();
  installBrowserStub({ online: true });
  const item = queueItem(TEST_PROVIDER, 'Guard probe: waiting');
  savePendingSOS(item);
  markWaitingForConnection(item, 'offline fixture — waiting for connection');
  assertEqual(refind(item.sosPackage.sosId)?.status, 'WAITING_FOR_CONNECTION', 'fixture: record is WAITING_FOR_CONNECTION');
  const r = simulateDemoLifecycleAdvance(item.sosPackage.sosId, 'DELIVERED');
  assertEqual(r.ok, false, 'DELIVERED simulation rejected from WAITING_FOR_CONNECTION');
  assertEqual(r.status, 'WAITING_FOR_CONNECTION', 'WAITING_FOR_CONNECTION record status unchanged');
}

// Positive control: the guard must NOT break the legitimate demo flow
// (real TEST handoff → SENT → simulated DELIVERED).
{
  clearPendingQueue();
  installDemoFetch('GUARD-POSITIVE-1');
  const item = queueItem(TEST_PROVIDER, 'Guard probe: sent');
  savePendingSOS(item);
  const res = await transmitSingleSOSItem(item);
  assertEqual(res.success, true, 'fixture: TEST handoff succeeded');
  assertEqual(refind(item.sosPackage.sosId)?.status, 'SENT', 'fixture: record is SENT');
  const r = simulateDemoLifecycleAdvance(item.sosPackage.sosId, 'DELIVERED');
  assertEqual(r.ok, true, 'SENT → DELIVERED simulation still accepted (guard does not break the demo flow)');
  assertEqual(r.status, 'DELIVERED', 'positive control advanced to DELIVERED');
}
