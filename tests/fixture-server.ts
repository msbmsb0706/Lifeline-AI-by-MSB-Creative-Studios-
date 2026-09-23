/** Test-only upstream: the browser and API tests still exercise the actual Express routes.
 * No live provider, credentials, or real emergency organization are used. */
import express from 'express';
const stub = express();
stub.use(express.json());
let mode = 'ok';
let confirmations: Record<string, unknown> = {};
let calls: any[] = [];
let partnerPayload: any = null;
export const english = 'I will be stuck in my home. Come to help.';
export const tamil = 'நான் என் வீட்டில் சிக்கிக் கொண்டிருக்கிறேன். உதவிக்கு வாருங்கள்.';
const hindi = 'मैं अपने घर में फँसा हुआ हूँ। मदद के लिए आइए।';
stub.post('/control', (req, res) => {
  mode = req.body.mode || 'ok'; confirmations = req.body.confirmations || {}; calls = []; partnerPayload = null;
  res.json({ ok: true });
});
stub.get('/calls', (_req, res) => res.json({ calls, partnerPayload }));
stub.post('/partner', (req, res) => { partnerPayload = req.body; res.json({ referenceId: 'fixture-only', ...confirmations }); });
stub.post('/v1/chat/completions', (req, res) => {
  calls.push(req.body);
  if (req.headers.authorization !== 'Bearer fixture-key') { res.status(401).json({ error: 'Invalid authorization header' }); return; }
  const prompt = req.body.messages[1].content;
  const translation = req.body.messages[0].content.includes('multilingual translation engine');
  let content: any;
  if (translation) {
    if (mode === 'http') { res.status(429).json({ error: 'fixture rate limit' }); return; }
    if (mode === 'empty') { res.json({ choices: [] }); return; }
    const target = prompt.match(/into (Tamil|English|Hindi)/)?.[1];
    content = {
      translated_message: target === 'Tamil' ? tamil : target === 'Hindi' ? hindi : english,
      translated_headline: 'STRUCTURED HEADLINE', translated_action_steps: ['STRUCTURED ACTION'],
      translated_instructions_for_responders: 'STRUCTURED DIRECTIVE', translated_first_aid_actions: ['STRUCTURED FIRST AID'], translated_needs: ['STRUCTURED NEEDS']
    };
    if (mode === 'missing') delete content.translated_message;
    if (mode === 'wrong-type') content.translated_message = { text: 'invalid' };
    if (mode === 'blank') content.translated_message = '  ';
  } else content = {
    language: prompt.includes(tamil) ? 'Tamil' : 'English', transcript: 'MODEL REWROTE THE TRANSCRIPT',
    emergency_type: 'RESCUE', severity: 3, needs: ['Rescue team'],
    message: 'GENERATED DISPATCH REPORT — rescue requested', visual_card: 'GENERATED RESCUE HEADLINE'
  };
  res.json({ choices: [{ finish_reason: translation && mode === 'truncated' ? 'length' : 'stop', message: {
    content: translation && mode === 'invalid-json' ? 'not JSON' : translation && mode === 'fenced' ? '```json\n' + JSON.stringify(content) + '\n```' : JSON.stringify(content)
  } }] });
});
await new Promise<void>(resolve => stub.listen(4174, '127.0.0.1', resolve));
Object.assign(process.env, {
  PORT: '4173', NEBIUS_BASE_URI: 'http://127.0.0.1:4174/v1', NEBIUS_API_KEY: 'Bearer fixture-key',
  AUTHORIZED_PARTNER_API_URL: 'http://127.0.0.1:4174/partner', AUTHORIZED_PARTNER_API_KEY: 'fixture-private-key',
  AUTHORIZED_PARTNER_NAME: 'LOCAL TEST FIXTURE — NOT AN EMERGENCY SERVICE', AUTHORIZED_PARTNER_COUNTRY: 'IN',
  AUTHORIZED_PARTNER_ALLOWED_FIELDS: 'sosId,timestamp,emergencyType,severity,message,gps,source',
});
await import('../server.ts');
