import { createServer, request as httpRequest, type Server } from 'node:http';
import { PGlite } from '@electric-sql/pglite';
import { createDispatchIdempotency } from '../server/dispatchIdempotency.ts';
import { testDatabase } from './dispatch-ledger-fixture.ts';
import { section, assert, assertEqual } from './helpers.ts';

section('Actual Express dispatch route: durable ledger and truthful raw statuses');
const probe = createServer();
await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
const defaultPort = (probe.address() as { port: number }).port;
await new Promise<void>(resolve => probe.close(() => resolve()));
const previous = { ...process.env };
process.env.PORT = String(defaultPort);
process.env.NODE_ENV = 'production';
process.env.AUTHORIZED_PARTNER_API_URL = 'https://partner.example/sos';
process.env.AUTHORIZED_PARTNER_API_KEY = 'test-only-key';
process.env.AUTHORIZED_PARTNER_IDEMPOTENCY_SUPPORTED = 'true'; // MUST NOT enable automatic send.
let partnerCalls = 0;
let forwardedKey = '';
let forwardedBody: any;
let partnerReply: any = { referenceId: 'PARTNER-CASE-1' };
let failure = false;
(globalThis as any).fetch = async (url: string, init?: any) => {
  if (url !== 'https://partner.example/sos') throw Error('unexpected external URL');
  partnerCalls++;
  forwardedKey = init.headers['Idempotency-Key'];
  forwardedBody = JSON.parse(init.body);
  return { ok: !failure, status: failure ? 503 : 200, json: async () => partnerReply };
};
const { createApp } = await import('../server.ts');
const engine = new PGlite();
const sharedDb = testDatabase(engine);
const app = await createApp(createDispatchIdempotency(sharedDb));
const server: Server = await new Promise(resolve => {
  const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
});
const port = (server.address() as { port: number }).port;
const request = (body: unknown, destinationPort = port): Promise<{ status: number; json: any }> => new Promise((resolve, reject) => {
  const req = httpRequest({ hostname: '127.0.0.1', port: destinationPort, method: 'POST',
    path: '/api/emergency-partner/dispatch', headers: { 'Content-Type': 'application/json' } }, res => {
    let data = ''; res.on('data', chunk => { data += chunk; });
    res.on('end', () => resolve({ status: res.statusCode || 0, json: JSON.parse(data) }));
  });
  req.on('error', reject);
  req.end(JSON.stringify(body));
});
const payload = {
  sosId: 'SOS-LL-ROUTE-25', timestamp: '2026-01-01T00:00:00Z', emergencyType: 'MEDICAL',
  severity: 4, message: 'Synthetic route fixture', partnerId: 'authorized-test',
  providerType: 'AUTHORIZED_API', userConsentConfirmed: true, automaticRecovery: false,
  gps: null, photos: [{ name: 'sample.jpg', type: 'image', dataUrl: 'DO_NOT_FORWARD' }]
};
try {
  // The default server has no database: fail closed even for a manual real API handoff.
  let unavailable: { status: number; json: any } | undefined;
  for (let i = 0; i < 50; i++) {
    try { unavailable = await request(payload, defaultPort); break; }
    catch { await new Promise(resolve => setTimeout(resolve, 40)); }
  }
  assertEqual(unavailable?.status, 503, 'no shared ledger: confirmed failure before partner POST');
  assertEqual(partnerCalls, 0, 'ledger unavailable NEVER contacts partner');
  const config = (destinationPort: number): Promise<{ status: number; json: any }> => new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port: destinationPort,
      path: '/api/emergency-partner/config?country=GLOBAL' }, res => {
      let data = ''; res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode || 0, json: JSON.parse(data) }));
    });
    req.on('error', reject); req.end();
  });
  assertEqual((await config(defaultPort)).status, 503, 'directory does not advertise an authorized API when ledger is down');
  assertEqual((await config(port)).json.data.automaticRecoverySupported, false,
    'even with healthy shared ledger and self-declared flag, no verified partner contract is advertised');
  assertEqual((await request({ ...payload, automaticRecovery: true })).status, 403,
    'self-declared idempotency flag cannot enable unattended dispatch');

  const receipt = await request(payload);
  assertEqual(receipt.status, 200, 'durable ledger permits reviewed manual authorized handoff');
  assertEqual(receipt.json?.data?.status, 'SENT', 'reference ID alone means SENT, NOT responder ACK');
  assertEqual(forwardedKey, payload.sosId, 'server forwards SOS ID as Idempotency-Key');
  assertEqual(forwardedBody.sosId, payload.sosId, 'same ID in partner payload');
  assert(!JSON.stringify(forwardedBody).includes('DO_NOT_FORWARD'), 'media bytes are excluded');
  assertEqual(receipt.json.data.deliveryConfirmed, undefined, 'reference alone does not imply delivery');
  assertEqual(receipt.json.data.responderAcknowledged, undefined, 'reference alone does not imply responder ACK');
  const duplicate = await request(payload);
  assertEqual(duplicate.json.data.status, 'SENT', 'confirmed receipt replay preserves honest status');
  assertEqual(partnerCalls, 1, 'duplicate ID does not repeat partner request');
  assertEqual((await request({ ...payload, message: 'changed' })).status, 409, 'same ID with changed content rejected');
  // A second Express app has its own ledger object but shares the same DB.
  const otherApp = await createApp(createDispatchIdempotency(sharedDb));
  const otherServer: Server = await new Promise(resolve => {
    const listening = otherApp.listen(0, '127.0.0.1', () => resolve(listening));
  });
  try {
    const otherPort = (otherServer.address() as { port: number }).port;
    const beforeRace = partnerCalls;
    const racePayload = { ...payload, sosId: 'SOS-LL-TWO-SERVERS' };
    const [raceA, raceB] = await Promise.all([request(racePayload), request(racePayload, otherPort)]);
    assertEqual(partnerCalls, beforeRace + 1, 'two Express server instances issue exactly ONE partner POST');
    assert([raceA.json.code, raceB.json.code].some(code => code === 'HANDOFF_UNCONFIRMED') ||
      (raceA.status === 200 && raceB.status === 200), 'racing request gets in-flight UNKNOWN or confirmed replay');
    assertEqual((await request(racePayload, otherPort)).json.data.status, 'SENT',
      'another server instance replays the shared confirmed receipt');
    assertEqual(partnerCalls, beforeRace + 1, 'cross-instance replay never POSTs a second time');
  } finally {
    await new Promise<void>(resolve => otherServer.close(() => resolve()));
  }

  partnerReply = { referenceId: 'PARTNER-2', deliveredAt: '2026-09-25T00:00:00Z' };
  const noFlag = await request({ ...payload, sosId: 'SOS-LL-NO-FLAG' });
  assertEqual(noFlag.json.data.status, 'SENT', 'deliveredAt without deliveryConfirmed is still SENT');
  assertEqual(noFlag.json.data.deliveredAt, undefined, 'unconfirmed deliveredAt is not forwarded');
  partnerReply = { referenceId: 'PARTNER-3', deliveryConfirmed: true, deliveredAt: '2026-09-25T00:00:00Z' };
  const delivered = await request({ ...payload, sosId: 'SOS-LL-DELIVERY' });
  assertEqual(delivered.json.data.status, 'DELIVERED', 'explicit partner delivery confirmation yields DELIVERED');
  assertEqual(delivered.json.data.deliveredAt, '2026-09-25T00:00:00Z', 'verified deliveredAt forwarded');
  partnerReply = { referenceId: 'PARTNER-4', responderAcknowledged: true };
  const acknowledged = await request({ ...payload, sosId: 'SOS-LL-RESPONDER' });
  assertEqual(acknowledged.json.data.status, 'ACKNOWLEDGED', 'explicit responder acknowledgement yields ACKNOWLEDGED');
  assertEqual(acknowledged.json.data.deliveryConfirmed, undefined, 'responder acknowledgement does not fabricate delivery flag');

  const synthetic = await request({ ...payload, providerType: 'TEST', demoOnly: true,
    partnerId: 'test-partner-demo', sosId: 'SOS-LL-SYNTHETIC',
    emergencyType: 'MEDICAL EMERGENCY (DEMO)',
    message: 'TEST / DEMO SOS transmission — Simulated distress alert for system validation.', photos: [] });
  assertEqual(synthetic.json.data.status, 'SENT', 'synthetic TEST handoff says SENT only');
  assertEqual(synthetic.json.data.providerType, 'TEST', 'synthetic result remains explicitly TEST/DEMO');
  assertEqual((await request({ ...payload, providerType: 'TEST', demoOnly: false })).status, 403,
    'real SOS cannot use TEST');

  failure = true;
  const uncertainId = 'SOS-LL-ROUTE-UNKNOWN';
  const unknown = await request({ ...payload, sosId: uncertainId });
  assertEqual(unknown.json.code, 'HANDOFF_UNCONFIRMED', 'partner 5xx is UNKNOWN, not known failure');
  const count = partnerCalls;
  assertEqual((await request({ ...payload, sosId: uncertainId })).json.code, 'HANDOFF_UNCONFIRMED',
    'unknown handoff refuses even a manual API retry');
  assertEqual(partnerCalls, count, 'unknown result never causes a second partner POST');
  assertEqual((await request({ ...payload, userConsentConfirmed: false, sosId: 'SOS-LL-NOCONSENT' })).status, 403,
    'no consent still blocks dispatch');
  assert(!JSON.stringify(receipt).includes('test-only-key'), 'credentials never appear in API receipt');
} finally {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await engine.close();
  process.env = previous;
}
