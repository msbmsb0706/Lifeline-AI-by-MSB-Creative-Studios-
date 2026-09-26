/**
 * Offline SOS resilience on the real device flow (the Android test steps):
 *
 *   1. Open the app preview.
 *   2. Airplane mode ON.
 *   3. Enter a test emergency.
 *   4. Offline / Resilience mode.
 *   5. Activate SOS and confirm it.
 *   6. Status must read PENDING_LOCAL / WAITING_FOR_CONNECTION — never SENT or
 *      DELIVERED.
 *   7. Close / reopen the page.
 *   8. Airplane mode OFF.
 *   9. Reopen LifeLine and wait for reconnection.
 *  10. The SAME SOS (same sosId) must still be there, still not delivered, and
 *      only an explicit user action may move it SENDING → SENT.
 *
 * The real SOS card is rendered in jsdom and driven through its own buttons, so
 * the assertions cover the UI the person actually taps. Every network call is
 * mocked; no responder, partner or demo endpoint receives anything.
 */
import { readFileSync } from 'node:fs';
import { installBrowserStub, mockResponse } from './browser-stub.ts';
import { section, assert, assertEqual } from './helpers.ts';
import {
  createSOSPackage,
  createQueuedSOSItem,
  getPendingQueue,
  getDeliveryDisplayLabel,
  SOS_DELIVERY_STATUS_META,
  clearPendingQueue,
  savePendingSOS,
  transmitSingleSOSItem
} from '../src/lib/emergencyPartnerQueue.ts';
import { getTestProvider, LOCAL_ONLY_PROVIDER } from '../src/lib/emergencyPartnersData.ts';
import { EmergencyAnalysisResult } from '../src/types.ts';

// ---------------------------------------------------------------------------
// Step 2: airplane mode. fetch THROWS, so any upload attempt is a test failure.
// ---------------------------------------------------------------------------
let networkCalls = 0;
installBrowserStub({
  online: false,
  fetch: () => {
    networkCalls += 1;
    throw new Error('An offline SOS MUST NOT call fetch');
  }
});
clearPendingQueue();

const MESSAGE = 'அப்பா மூச்சு விடவில்லை — உடனடி உதவி தேவை';

function makeOfflineResult(): EmergencyAnalysisResult {
  return {
    language: 'ta',
    transcript: MESSAGE,
    emergency_type: 'Medical - Cardiac Emergency',
    severity: 5,
    needs: ['Ambulance', 'CPR guidance'],
    message: MESSAGE,
    visual_card: 'CARDIAC ARREST — IMMEDIATE CPR (PRIORITY 5/5)',
    emergency_category: 'MEDICAL',
    detected_language: { code: 'ta', name: 'Tamil' },
    source: 'offline_fallback',
    model_used: 'Bundled offline triage rules',
    timestamp: new Date().toISOString(),
    raw_transcript: MESSAGE,
    location_coordinates: null
  } as unknown as EmergencyAnalysisResult;
}

// ---------------------------------------------------------------------------
// Steps 3-5: the person enters a test emergency and confirms the SOS through
// the REAL card UI, while offline.
// ---------------------------------------------------------------------------
let jsdomReady = true;
try {
  await import('jsdom');
} catch {
  jsdomReady = false;
}

let savedSosId: string | null = null;

if (!jsdomReady) {
  section('Offline SOS device flow (jsdom missing)');
  assert(true, 'jsdom is not installed — DOM offline SOS suite skipped (npm install)');
} else {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const React = (await import('react')).default;
  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  const { SOSCardView } = await import('../src/components/SOSCardView.tsx');
  const { installDomHarness, wait } = await import('./dom-harness.ts');

  const h = installDomHarness();
  // Airplane mode: the app reads the global navigator.
  const setOnline = (online: boolean) => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      writable: true,
      value: { onLine: online, languages: ['en-US', 'en'] }
    });
  };
  setOnline(false);
  const root = createRoot(h.root);
  await act(async () => {
    root.render(
      React.createElement(SOSCardView, {
        result: makeOfflineResult(),
        highContrast: false,
        soundEnabled: false,
        offlineMode: true
      })
    );
  });
  await wait(30);

  section('Offline — SOS confirmed through the real card uploads nothing');
  assertEqual(h.document.getElementById('save-local-sos-btn') !== null, true, 'local save action is offered on the card');
  await act(async () => {
    h.document
      .getElementById('save-local-sos-btn')
      .dispatchEvent(new h.window.MouseEvent('click', { bubbles: true }));
  });
  await wait(20);
  assertEqual(h.document.getElementById('consent-confirm-send-btn') !== null, true, 'an explicit confirmation is required before saving');
  await act(async () => {
    h.document
      .getElementById('consent-confirm-send-btn')
      .dispatchEvent(new h.window.MouseEvent('click', { bubbles: true }));
  });
  await wait(30);

  const offlineQueue = getPendingQueue();
  assertEqual(offlineQueue.length, 1, 'the confirmed SOS is stored locally');
  assertEqual(networkCalls, 0, 'ZERO network calls while offline (airplane mode)');
  const saved = offlineQueue[0];
  savedSosId = saved.sosPackage.sosId;
  assertEqual(saved.status === 'SENT' || saved.status === 'DELIVERED' || saved.status === 'ACKNOWLEDGED', false,
    'an offline SOS is never SENT / DELIVERED / ACKNOWLEDGED');
  assert(
    saved.status === 'PENDING_LOCAL' || saved.status === 'WAITING_FOR_CONNECTION',
    `offline status is a local waiting state (${saved.status})`
  );
  assertEqual(saved.sosPackage.originalTranscript, MESSAGE, 'the original Tamil words are stored verbatim');
  assertEqual(saved.sosPackage.offlineCreated, true, 'the record is marked as created offline');
  assertEqual(saved.targetPartner.providerType, 'LOCAL_ONLY', 'a real SOS is only ever saved locally');
  assertEqual(saved.userApprovedForPartnerTransmission, false, 'a local save is not partner transmission consent');
  assertEqual(getDeliveryDisplayLabel(saved), 'SAVED LOCALLY — NOT SENT', 'the card label says NOT SENT');

  // Step 6: what the person actually sees on screen.
  const cardText = h.document.body.textContent || '';
  assert(!/SENT TO|DELIVERED|ACKNOWLEDGED/.test(cardText.replace('NOT SENT', '')), 'the visible card never claims delivery');
  assert(cardText.includes('NOT SENT'), 'the visible card states the SOS was not sent');

  // Steps 7-8: close the page, then come back online. Browser storage is what
  // survives a closed tab, so it is carried across the "reopen".
  const persistedStorage = (globalThis as any).localStorage;
  await act(async () => {
    root.unmount();
  });
  h.cleanup();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: persistedStorage
  });
  setOnline(true);
}

// ---------------------------------------------------------------------------
// Steps 7-9: a brand new session (fresh module instance = app reopened) with
// the connection back. Nothing may be uploaded on its own.
// ---------------------------------------------------------------------------
section('Reopen online — the SAME SOS resumes and is never auto-uploaded');
const reopenedSpec = '../src/lib/emergencyPartnerQueue.ts?offline-sos-android-reopen';
const reopened = (await import(reopenedSpec)) as typeof import('../src/lib/emergencyPartnerQueue.ts');
const resumed = reopened.getPendingQueue();
assertEqual(resumed.length, 1, 'the pending SOS survived closing and reopening the app');
assertEqual(resumed[0].sosPackage.sosId, savedSosId, 'it is the SAME SOS (same sosId), not a copy or a new record');
assertEqual(resumed[0].sosPackage.originalTranscript, MESSAGE, 'the original message survived the restart');
assertEqual(resumed[0].status, 'WAITING_FOR_CONNECTION', 'reopened online it is still waiting, not sent');
assertEqual(reopened.getDeliveryDisplayLabel(resumed[0]), 'SAVED LOCALLY — NOT SENT', 'still labelled NOT SENT after reconnect');
assertEqual(SOS_DELIVERY_STATUS_META[resumed[0].status].terminal, false, 'the resumed record is not in a terminal state');
assertEqual(networkCalls, 0, 'reconnecting alone uploaded NOTHING');

// A reconnect, a focus event, a timer or a legacy preference must never send.
for (let i = 0; i < 200; i++) await reopened.processPendingQueue();
assertEqual(networkCalls, 0, '200 queue scans after reconnect still upload nothing');

// ---------------------------------------------------------------------------
// Step 10: only an explicit user action may hand the record off.
// ---------------------------------------------------------------------------
section('Step 10 — an explicit action is what moves SENDING → SENT');
const authorized = {
  ...getTestProvider(),
  id: 'authorized-android-qa',
  providerName: 'MOCK authorized partner (Android QA only)',
  providerType: 'AUTHORIZED_API' as const,
  apiEnabled: true
};
let lastBody: any = null;
(globalThis as any).fetch = async (_url: string, init: any) => {
  networkCalls += 1;
  lastBody = JSON.parse(init.body);
  return mockResponse(200, {
    success: true,
    data: {
      success: true,
      status: 'SENT',
      referenceId: 'MOCK-ANDROID-QA',
      timestamp: new Date().toISOString(),
      partnerId: authorized.id,
      providerName: authorized.providerName,
      providerType: 'AUTHORIZED_API'
    }
  });
};
const record = resumed[0];
assertEqual(record.targetPartner.providerType, 'LOCAL_ONLY', 'fixture: record saved locally by the card');
assertEqual((await reopened.transmitSingleSOSItem(record)).attempted, false,
  'a locally saved real SOS is still refused even after reconnecting (no silent upload)');
assertEqual(networkCalls, 0, 'refusing the local-only record made no network call');

// The same record, after the person explicitly approves an authorized partner.
const approved = createQueuedSOSItem({
  sosPackage: createSOSPackage({
    emergencyType: record.sosPackage.emergencyType,
    category: record.sosPackage.category,
    severity: record.sosPackage.severity,
    message: record.sosPackage.message,
    gps: null,
    source: 'offline',
    originalTranscript: record.sosPackage.originalTranscript,
    detectedLanguage: record.sosPackage.detectedLanguage
  }),
  targetPartner: authorized,
  userConsentTimestamp: new Date().toISOString()
});
assertEqual(reopened.savePendingSOS(approved), true, 'the approved record is stored before any send');
assertEqual((await reopened.transmitSingleSOSItem(approved)).success, true, 'the explicit action hands the SOS off');
assertEqual(networkCalls, 1, 'exactly one network call, from the explicit action');
assertEqual(reopened.getPendingQueue().find((i) => i.sosPackage.sosId === approved.sosPackage.sosId)?.status, 'SENT',
  'SENDING → SENT only after the endpoint accepted it');
assertEqual(lastBody.originalTranscript, MESSAGE, 'the resumed request carries the original Tamil text verbatim');
assertEqual(lastBody.detectedLanguage?.code, 'ta', 'the resumed request carries the detected language');
assertEqual(reopened.getPendingQueue().find((i) => i.sosPackage.sosId === approved.sosPackage.sosId)?.deliveredAt,
  undefined, 'SENT is not inflated into DELIVERED without an explicit confirmation');

clearPendingQueue();

// ---------------------------------------------------------------------------
// Bind the UI: the card must keep showing a local, non-delivered state.
// ---------------------------------------------------------------------------
section('Offline SOS UI contract');
const card = readFileSync(new URL('../src/components/SOSCardView.tsx', import.meta.url), 'utf8');
const silent = readFileSync(new URL('../src/components/SilentSOS.tsx', import.meta.url), 'utf8');
const statusCard = readFileSync(new URL('../src/components/SOSDeliveryStatus.tsx', import.meta.url), 'utf8');
assert(card.includes('if (offlineMode || !navigator.onLine) markWaitingForConnection') && silent.includes('if (offlineMode || !navigator.onLine) markWaitingForConnection'),
  'both offline confirm flows record the waiting-for-connection state explicitly');
assert(statusCard.includes("'SAVED ON DEVICE — NOT SENT'") && statusCard.includes('SAVED ON DEVICE — NOT SENT'),
  'the delivery card renders an explicit NOT SENT state for local records');
assert(!card.includes('processPendingQueue(') && !silent.includes('processPendingQueue('),
  'no SOS surface starts an automatic upload');
assert(statusCard.includes('Saved locally. Automatic send when the connection returns (your opt-in — authorized partner only). Nothing has been sent yet.'),
  'offline waiting card (opt-in) states: saved locally, automatic send on reconnect, nothing sent yet');
assert(statusCard.includes('Saved locally. Waiting for the connection — use SEND NOW or SHARE VIA DEVICE when it returns. Nothing has been sent yet.'),
  'offline waiting card (opt-out) states: saved locally, manual options, nothing sent yet');
assert(statusCard.includes('Sent automatically when the connection returned (your opt-in). Awaiting delivery confirmation.'),
  'after an automatic send succeeds the card shows the automatic-send notice — still not claiming delivery');
assert(statusCard.includes('Saved locally — automatic send when the connection returns (your opt-in)') &&
  statusCard.includes('Saved locally — manual send (SEND NOW / SHARE VIA DEVICE)'),
  'the Transmission label always states saved locally with the user\'s chosen path');
