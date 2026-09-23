import { test, expect } from '@playwright/test';

const english = 'I will be stuck in my home. Come to help.';
const tamil = 'நான் என் வீட்டில் சிக்கிக் கொண்டிருக்கிறேன். உதவிக்கு வாருங்கள்.';
const hindi = 'मैं अपने घर में फँसा हुआ हूँ। मदद के लिए आइए।';
const control = 'http://127.0.0.1:4174';
const pairs = [
  { name: 'English → Tamil', text: english, target: 'ta', expected: tamil },
  { name: 'Tamil → English', text: tamil, target: 'en', expected: english },
  { name: 'English → Hindi', text: english, target: 'hi', expected: hindi },
  { name: 'Tamil → Hindi', text: tamil, target: 'hi', expected: hindi },
];
test.beforeEach(async ({ request }) => { await request.post(`${control}/control`, { data: {} }); });

async function openApp(page: any) {
  await page.goto('/');
  await expect(page.locator('#lifeline-splash-screen')).toHaveCount(0);
  await page.locator('#toggle-sound-btn').click();
}
async function analyze(page: any, text = english, target = 'ta') {
  await page.locator('#emergency-transcript-input').fill(text);
  await page.locator('#target-emergency-language-select').selectOption(target);
  await page.locator('#submit-emergency-analysis-btn').click();
  await expect(page.locator('#submit-emergency-analysis-btn')).toBeEnabled();
  await expect(page.locator('#visual-sos-card')).toBeVisible();
}
for (const pair of pairs) {
  test(`${pair.name}: actual analysis route → final browser translation, then explicit translation`, async ({ page, request }) => {
    await openApp(page);
    const resultPromise = page.waitForResponse('**/api/analyze-emergency');
    await analyze(page, pair.text, pair.target);
    const result = (await (await resultPromise).json()).data;
    expect(result.raw_transcript).toBe(pair.text);
    expect(result.original_message).toBe(pair.text);
    expect(result.transcript).toBe('MODEL REWROTE THE TRANSCRIPT');
    expect(result.translation.original_message).toBe(pair.text);
    expect(result.translation.translated_message).toBe(pair.expected);
    expect(result.translation.translated_instructions_for_responders).toBe('STRUCTURED DIRECTIVE');
    expect(result.translation.translated_action_steps).toEqual(['STRUCTURED ACTION']);
    expect(result.translation.translated_first_aid_actions).toEqual(['STRUCTURED FIRST AID']);
    expect(result.translation.translated_needs).toEqual(['STRUCTURED NEEDS']);
    await expect(page.locator('#translated-transmission')).toHaveText(pair.expected);
    await expect(page.locator('#generated-radio-transmission')).toHaveText(result.message);
    await expect(page.locator('#dispatch-transmission-container')).toContainText(pair.text);
    await expect(page.locator('#radio-location')).toHaveText('Location: Not attached');
    await expect(page.locator('#sos-card-nebius-connected-badge')).toBeVisible();
    await page.locator('#sos-target-lang-select').selectOption(pair.target);
    const requestPromise = page.waitForRequest('**/api/translate-emergency');
    await page.locator('#translate-sos-btn').click();
    expect((await requestPromise).postDataJSON().text).toBe(pair.text);
    await expect(page.locator('#translate-sos-btn')).toBeEnabled();
    await expect(page.locator('#translated-transmission')).toHaveText(pair.expected);
    const upstream = (await (await request.get(`${control}/calls`)).json()).calls;
    expect(upstream.length).toBe(3); // analysis + initial translation + explicit translation
    expect(upstream[1].messages[1].content).toContain(`ORIGINAL TRANSMISSION (translate word-for-word): "${pair.text}"`);
    expect(upstream[1].messages[1].content).not.toContain(result.message);
  });
}

test('initial online translation failure preserves successful analysis and shows failure, not offline success', async ({ page, request }) => {
  await request.post(`${control}/control`, { data: { mode: 'http' } });
  await openApp(page);
  await analyze(page);
  await expect(page.locator('#translation-unavailable')).toContainText('Translation unavailable — original transmission preserved');
  await expect(page.locator('#translation-unavailable')).toContainText('HTTP 429');
  await expect(page.locator('#translated-transmission')).toHaveCount(0);
  await expect(page.locator('#dispatch-transmission-container')).toContainText(english);
  await expect(page.locator('#sos-card-nebius-connected-badge')).toBeVisible();
  await expect(page.locator('#visual-sos-card')).not.toContainText('faithful translation not available offline');
});

test('explicit translation failure clears stale translation; retry recovers', async ({ page, request }) => {
  await openApp(page); await analyze(page);
  await expect(page.locator('#translated-transmission')).toHaveText(tamil);
  await request.post(`${control}/control`, { data: { mode: 'missing' } });
  await page.locator('#translate-sos-btn').click();
  await expect(page.locator('#translation-unavailable')).toContainText('HTTP 502');
  await expect(page.locator('#translated-transmission')).toHaveCount(0);
  await expect(page.locator('#dispatch-transmission-container')).toContainText(english);
  await request.post(`${control}/control`, { data: { mode: 'fenced' } });
  await page.locator('#translate-sos-btn').click();
  await expect(page.locator('#translated-transmission')).toHaveText(tamil);
  await expect(page.locator('#translation-unavailable')).toHaveCount(0);
});

test('client rejects a success envelope with missing translated_message', async ({ page }) => {
  await openApp(page); await analyze(page);
  await page.route('**/api/translate-emergency', route => route.fulfill({ json: { success: true, data: { source: 'nebius_nemotron', target_language: 'ta' } } }));
  await page.locator('#translate-sos-btn').click();
  await expect(page.locator('#translation-unavailable')).toBeVisible();
  await expect(page.locator('#translated-transmission')).toHaveCount(0);
});

for (const [mode, code] of [
  ['http', 'TRANSLATION_UPSTREAM_HTTP'], ['empty', 'TRANSLATION_EMPTY_RESPONSE'],
  ['invalid-json', 'TRANSLATION_INVALID_JSON'], ['missing', 'TRANSLATION_MISSING_MESSAGE'],
  ['wrong-type', 'TRANSLATION_MISSING_MESSAGE'], ['blank', 'TRANSLATION_MISSING_MESSAGE'],
  ['truncated', 'TRANSLATION_TRUNCATED'],
]) test(`translation API reports ${mode}, not success/offline substitute`, async ({ request }) => {
  await request.post(`${control}/control`, { data: { mode } });
  const res = await request.post('/api/translate-emergency', { data: { text: english, targetLanguage: 'ta' } });
  expect(res.status()).toBe(502);
  const body = await res.json();
  expect(body.success).toBe(false); expect(body.code).toBe(code); expect(body.data).toBeUndefined();
  if (mode === 'http') expect(body.upstream_status).toBe(429);
});

test('server source precedence raw → original → explicit text → legacy', async ({ request }) => {
  for (const currentSOS of [
    { raw_transcript: english, original_message: 'not original', message: 'generated' },
    { original_message: english, message: 'generated' },
    { message: 'generated' },
    { message: english },
  ]) {
    const data = { currentSOS, targetLanguage: 'ta', ...(currentSOS.message === english ? {} : { text: english }) };
    const res = await request.post('/api/translate-emergency', { data });
    expect(res.ok()).toBe(true); expect((await res.json()).data.original_message).toBe(english);
  }
});

test('country selection is shared; phone reference is not an API or automatic dispatch', async ({ page }) => {
  await openApp(page); await analyze(page);
  await expect(page.locator('#emergency-number-reference')).toHaveText('Emergency number not configured');
  await page.getByLabel('Emergency country').selectOption('US');
  await expect(page.locator('#emergency-number-reference')).toContainText('911');
  await expect(page.locator('#emergency-api-status')).toContainText('not configured');
  await page.getByLabel('Emergency country').selectOption('IN');
  await expect(page.locator('#emergency-number-reference')).toContainText('112');
  await expect(page.locator('#emergency-api-status')).toContainText('configured — connectivity / delivery not verified');
  await page.getByLabel('Dispatch destination').selectOption('authorized-partner-sample');
  await expect(page.locator('#radio-routing-context')).toContainText('LOCAL TEST FIXTURE — NOT AN EMERGENCY SERVICE');
  await page.locator('#open-emergency-partners-btn').click();
  await expect(page.getByText('India Emergency Response Support System (112)', { exact: true })).toBeVisible();
  await expect(page.locator('#visual-sos-card')).not.toContainText('(911 / EMS)');
});

test('GPS requested only after attachment + consent; radio retains accuracy/timestamp', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).geoCalls = 0;
    navigator.geolocation.getCurrentPosition = (success) => {
      (window as any).geoCalls++;
      success({ coords: { latitude: 12.345678, longitude: 76.543210, accuracy: 9 }, timestamp: 1700000000000 } as GeolocationPosition);
    };
    navigator.geolocation.watchPosition = () => { throw new Error('Continuous tracking is prohibited'); };
  });
  await openApp(page); await analyze(page);
  expect(await page.evaluate(() => (window as any).geoCalls)).toBe(0);
  await page.locator('#attach-gps-location-btn').click();
  expect(await page.evaluate(() => (window as any).geoCalls)).toBe(0);
  await page.locator('#cancel-location-permission-btn').click();
  expect(await page.evaluate(() => (window as any).geoCalls)).toBe(0);
  await page.locator('#attach-gps-location-btn').click();
  await page.locator('#confirm-location-permission-btn').click();
  expect(await page.evaluate(() => (window as any).geoCalls)).toBe(1);
  const reqPromise = page.waitForRequest('**/api/analyze-emergency');
  await analyze(page);
  const coords = (await reqPromise).postDataJSON().coordinates;
  expect(coords).toEqual({ latitude: 12.345678, longitude: 76.543210, accuracyMeters: 9, timestamp: 1700000000000 });
  await expect(page.locator('#radio-location')).toContainText('Lat: 12.345678');
  await expect(page.locator('#radio-location')).toContainText('Accuracy: 9 m');
  await expect(page.locator('#radio-location')).toContainText('2023-11-14T22:13:20.000Z');
});

test('offline translation is explicitly labelled and uses no translation API', async ({ page, request }) => {
  await openApp(page);
  await page.locator('#toggle-offline-mode-btn').click();
  await analyze(page);
  await expect(page.locator('#dispatch-transmission-container')).toContainText('Offline translation unavailable — original transmission preserved');
  await expect(page.locator('#translated-transmission')).toHaveText(english);
  expect((await (await request.get(`${control}/calls`)).json()).calls).toHaveLength(0);
});

const sos = { sosId: 'fixture-sos', emergencyType: 'RESCUE', severity: 3, message: english, gps: { latitude: 12, longitude: 76, accuracyMeters: 8, timestamp: 1700000000000 }, userConsentConfirmed: true };
test('dispatch enforces consent and provider identity; TEST never confirms real delivery/ack', async ({ request }) => {
  const data = { ...sos, partnerId: 'test-partner-demo', providerType: 'TEST' };
  for (const consent of [false, 'true']) {
    expect((await request.post('/api/emergency-partner/dispatch', { data: { ...data, userConsentConfirmed: consent } })).status()).toBe(403);
  }
  expect((await request.post('/api/emergency-partner/dispatch', { data: { ...data, providerType: 'AUTHORIZED_API' } })).status()).toBe(400);
  const res = await request.post('/api/emergency-partner/dispatch', { data });
  const body = (await res.json()).data;
  expect(body.deliveryConfirmed).toBeUndefined(); expect(body.responderAcknowledged).toBeUndefined();
  expect(body.message).toContain('NO REAL EMERGENCY SERVICE RECEIVED');
  expect((await (await request.get(`${control}/calls`)).json()).partnerPayload).toBeNull();
});

test('authorized API uses configured endpoint/name and whitelist, passes only explicit confirmations', async ({ request }) => {
  const configText = await (await request.get('/api/emergency-partner/config')).text();
  expect(configText).not.toContain('4174'); expect(configText).not.toContain('fixture-private-key');
  expect(JSON.parse(configText).provider.apiStatus).toBe('CONFIGURED_NOT_VERIFIED');
  for (const confirmations of [{}, { deliveryConfirmed: true }, { responderAcknowledged: true }, { deliveryConfirmed: 'true', responderAcknowledged: 1 }]) {
    await request.post(`${control}/control`, { data: { confirmations } });
    const res = await request.post('/api/emergency-partner/dispatch', { data: {
      ...sos, partnerId: 'authorized-partner-sample', providerType: 'AUTHORIZED_API', endpoint: 'https://not-used.invalid', photos: ['not permitted'], secret: 'never forward'
    } });
    expect(res.ok()).toBe(true);
    const body = (await res.json()).data;
    expect(body.partnerName).toBe('LOCAL TEST FIXTURE — NOT AN EMERGENCY SERVICE');
    expect(body.deliveryConfirmed === true).toBe(confirmations.deliveryConfirmed === true);
    expect(body.responderAcknowledged === true).toBe(confirmations.responderAcknowledged === true);
    const received = (await (await request.get(`${control}/calls`)).json()).partnerPayload;
    expect(received.gps).toEqual(sos.gps);
    expect(received.photos).toBeUndefined(); expect(received.secret).toBeUndefined(); expect(received.endpoint).toBeUndefined();
  }
});

for (const [provider, confirmations, heading] of [
  ['TEST', {}, 'SENT'],
  ['AUTHORIZED_API', { deliveryConfirmed: true }, 'DELIVERED'],
  ['AUTHORIZED_API', { responderAcknowledged: true }, 'RESPONDER ACKNOWLEDGED'],
] as const) test(`${provider}: consent → actual local dispatch → ${heading} UI`, async ({ page, request }) => {
  await request.post(`${control}/control`, { data: { confirmations } });
  await openApp(page); await analyze(page);
  if (provider === 'AUTHORIZED_API') {
    await page.getByLabel('Emergency country').selectOption('IN');
    await page.getByLabel('Dispatch destination').selectOption('authorized-partner-sample');
  }
  await page.locator('#partner-demo-dispatch-btn').click();
  expect((await (await request.get(`${control}/calls`)).json()).partnerPayload).toBeNull();
  const sentPromise = page.waitForRequest('**/api/emergency-partner/dispatch');
  await page.locator('#consent-confirm-send-btn').click();
  const sent = (await sentPromise).postDataJSON();
  expect(sent.userConsentConfirmed).toBe(true);
  expect(sent.providerType).toBe(provider);
  expect(sent.gps).toBeNull();
  expect(sent.message).toContain('GENERATED DISPATCH REPORT');
  await expect(page.locator('#sos-delivery-status')).toContainText(heading);
  if (provider === 'TEST') {
    await expect(page.locator('#radio-routing-context')).toContainText('TEST / DEMO');
    await expect(page.locator('#sos-delivery-status')).not.toContainText('RESPONDER ACKNOWLEDGED');
  }
});
