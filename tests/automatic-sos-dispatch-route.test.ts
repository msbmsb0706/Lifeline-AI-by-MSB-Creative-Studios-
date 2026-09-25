import { createServer, request as httpRequest } from 'node:http';
import { section, assert, assertEqual } from './helpers.ts';

section('PR25: actual Express authorized-dispatch route integration (mock HTTPS partner)');
// Reserve a local app port. Partner fetch is stubbed; no external SOS leaves tests.
const probe = createServer();
await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = (probe.address() as { port: number }).port;
await new Promise<void>(resolve => probe.close(() => resolve()));
const previous = { ...process.env };
process.env.PORT = String(port);
process.env.NODE_ENV = 'production';
process.env.AUTHORIZED_PARTNER_API_URL = 'https://partner.example/sos';
process.env.AUTHORIZED_PARTNER_API_KEY = 'test-only-key';
process.env.AUTHORIZED_PARTNER_IDEMPOTENCY_SUPPORTED = 'true';
let partnerCalls = 0;
let forwardedKey = '';
let forwardedBody: any = null;
(globalThis as any).fetch = async (url: string, init?: any) => {
  if (url !== 'https://partner.example/sos') throw Error('unexpected external URL');
  partnerCalls++;
  forwardedKey = init.headers['Idempotency-Key'];
  forwardedBody = JSON.parse(init.body);
  return { ok: true, status: 200, json: async () => ({ referenceId: 'PARTNER-CASE-1' }) };
};
await import('../server.ts');
const request = (body: unknown): Promise<{ status: number; json: any }> => new Promise((resolve, reject) => {
  const req = httpRequest({ hostname: '127.0.0.1', port, method: 'POST',
    path: '/api/emergency-partner/dispatch', headers: { 'Content-Type': 'application/json' } }, res => {
    let data = ''; res.on('data', chunk => { data += chunk; });
    res.on('end', () => resolve({ status: res.statusCode || 0, json: JSON.parse(data) }));
  });
  req.on('error', reject);
  req.end(JSON.stringify(body));
});
// App startup may take a short tick. This is an HTTP integration test, not a
// live network check; the fixture never receives real user data.
const payload = {
  sosId: 'SOS-LL-ROUTE-25', timestamp: '2026-01-01T00:00:00Z', emergencyType: 'MEDICAL',
  severity: 4, message: 'Synthetic route fixture', partnerId: 'authorized-test',
  providerType: 'AUTHORIZED_API', userConsentConfirmed: true, automaticRecovery: true,
  gps: null, photos: [{ name: 'sample.jpg', type: 'image', dataUrl: 'DO_NOT_FORWARD' }]
};
let receipt: { status: number; json: any } | undefined;
for (let i = 0; i < 50; i++) {
  try { receipt = await request(payload); break; }
  catch { await new Promise(resolve => setTimeout(resolve, 40)); }
}
assertEqual(receipt?.status, 200, 'configured authorized API accepts opted-in route submission');
assertEqual(receipt?.json?.data?.providerType, 'AUTHORIZED_API', 'real authorized receipt, not synthetic demo');
assertEqual(forwardedKey, payload.sosId, 'server forwards stable SOS ID as partner Idempotency-Key');
assertEqual(forwardedBody.sosId, payload.sosId, 'same ID forwarded in payload');
assert(!JSON.stringify(forwardedBody).includes('DO_NOT_FORWARD'), 'offline media bytes not forwarded');
assertEqual(receipt?.json?.data?.deliveryConfirmed, undefined, 'no fabricated delivery confirmation');
assertEqual(receipt?.json?.data?.responderAcknowledged, undefined, 'no fabricated responder acknowledgement');
const duplicate = await request(payload);
assertEqual(duplicate.status, 200, 'repeated SOS ID receives cached accepted response');
assertEqual(partnerCalls, 1, 'duplicate request creates no second partner call');
assertEqual((await request({ ...payload, message: 'changed payload' })).status, 409,
  'same ID with changed content is refused');
assertEqual(partnerCalls, 1, 'conflict never contacts partner');
assertEqual((await request({ ...payload, providerType: 'TEST', demoOnly: false })).status, 403,
  'real SOS cannot reach synthetic TEST destination');
assertEqual(partnerCalls, 1, 'TEST rejection never contacts partner');
assertEqual((await request({ ...payload, sosId: 'SOS-LL-NOCONSENT-25', userConsentConfirmed: false })).status, 403,
  'missing explicit consent blocked server-side');
assertEqual(partnerCalls, 1, 'no-consent request never contacts partner');
assert(!JSON.stringify(receipt).includes('test-only-key'), 'server response never exposes credential');
process.env.AUTHORIZED_PARTNER_IDEMPOTENCY_SUPPORTED = 'false';
assertEqual((await request({ ...payload, sosId: 'SOS-LL-NOCONTRACT-25' })).status, 403,
  'server refuses automatic delivery if partner idempotency contract is disabled');
assertEqual(partnerCalls, 1, 'no partner request without idempotency guarantee');
// Restore environment for any downstream test runner usage.
process.env = previous;
