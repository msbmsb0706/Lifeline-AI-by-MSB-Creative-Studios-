import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { createDispatchIdempotency } from '../server/dispatchIdempotency.ts';
import { testDatabase } from './dispatch-ledger-fixture.ts';
import { assert, assertEqual, section } from './helpers.ts';

const dir = mkdtempSync(join(tmpdir(), 'lifeline-ledger-test-'));
let engine = new PGlite(dir);
let database = testDatabase(engine);
const destination = 'https://partner.example/sos';
const payload = { sosId: 'SOS-LL-LEDGER-1', message: 'synthetic test data', timestamp: '2026-09-25T00:00:00Z' };
let posts = 0;
const send = async () => { posts++; await new Promise(resolve => setTimeout(resolve, 15)); return { referenceId: 'PARTNER-1' }; };
try {
  section('Durable shared ledger: two independent app instances, accepted replay and restart');
  const firstServer = createDispatchIdempotency(database);
  const secondServer = createDispatchIdempotency(database);
  const [a, b] = await Promise.all([
    firstServer.dispatchOnce(payload.sosId, destination, payload, send),
    secondServer.dispatchOnce(payload.sosId, destination, payload, send)
  ]);
  assertEqual(posts, 1, 'two server instances sharing one ledger issue only ONE partner POST');
  assert([a.kind, b.kind].includes('CONFIRMED_SUCCESS'), 'one instance receives durable partner receipt');
  assert([a.kind, b.kind].every(k => k === 'CONFIRMED_SUCCESS' || k === 'UNKNOWN'), 'racing request cannot create second handoff');
  const replay = await secondServer.dispatchOnce(payload.sosId, destination, payload, send);
  assertEqual(replay.kind, 'CONFIRMED_SUCCESS', 'accepted receipt replayed from ledger');
  assertEqual(posts, 1, 'replay makes no second partner request');
  await engine.close();
  engine = new PGlite(dir);
  database = testDatabase(engine);
  const restarted = createDispatchIdempotency(database);
  const again = await restarted.dispatchOnce(payload.sosId, destination, payload, send);
  assertEqual(again.kind, 'CONFIRMED_SUCCESS', 'confirmed receipt survives server and database process restart');
  assertEqual(posts, 1, 'cross-restart replay makes no partner request');
  assertEqual((await restarted.dispatchOnce(payload.sosId, destination, { ...payload, message: 'changed' }, send)).kind,
    'CONFIRMED_FAILURE', 'changed payload rejected after restart');
  assertEqual((await restarted.dispatchOnce(payload.sosId, 'https://different.example/sos', payload, send)).kind,
    'CONFIRMED_FAILURE', 'same SOS ID cannot silently redirect to another destination');
  assertEqual(posts, 1, 'conflicts cannot create a second emergency record');

  section('UNKNOWN: partner received request, lost reply, timeout or 5xx — never auto-POST again');
  for (const [id, reason] of [['SOS-LL-LOST', 'lost partner response'],
    ['SOS-LL-TIMEOUT', 'timeout'], ['SOS-LL-FIVE', 'HTTP 503']] as const) {
    const data = { ...payload, sosId: id };
    const attempt = await createDispatchIdempotency(database).dispatchOnce(id, destination, data, async () => { posts++; throw Error(reason); });
    assertEqual(attempt.kind, 'UNKNOWN', `${reason} is unconfirmed, not a confirmed rejection or success`);
    await engine.close(); engine = new PGlite(dir); database = testDatabase(engine);
    const newInstance = createDispatchIdempotency(database);
    const before = posts;
    assertEqual((await newInstance.dispatchOnce(id, destination, data, send)).kind, 'UNKNOWN',
      `${reason} remains blocked after server restart`);
    assertEqual(posts, before, `${reason} causes NO second partner POST`);
    assertEqual((await newInstance.dispatchOnce(id, destination, { ...data, message: 'changed' }, send)).kind,
      'CONFIRMED_FAILURE', `${reason} cannot be retried with changed payload`);
  }

  section('Ledger unavailable and receipt persistence failure fail closed');
  const beforeUnavailable = posts;
  assertEqual((await createDispatchIdempotency(null).dispatchOnce('SOS-LL-DBDOWN', destination, payload, send)).kind,
    'CONFIRMED_FAILURE', 'no database means confirmed no partner request');
  assertEqual(posts, beforeUnavailable, 'ledger outage never calls partner');
  const failingDatabase = {
    query: async (sql: string, args?: unknown[]) => {
      if (sql.startsWith('UPDATE') && sql.includes('CONFIRMED_SUCCESS')) throw Error('Database write lost');
      return database.query(sql, args);
    }
  };
  const lostId = 'SOS-LL-RECEIPT-WRITE';
  const lostPayload = { ...payload, sosId: lostId };
  const lost = await createDispatchIdempotency(failingDatabase).dispatchOnce(lostId, destination, lostPayload, send);
  assertEqual(lost.kind, 'UNKNOWN', 'partner accepted but failed receipt persistence is not SENT');
  await engine.close(); engine = new PGlite(dir); database = testDatabase(engine);
  const beforeRetry = posts;
  assertEqual((await createDispatchIdempotency(database).dispatchOnce(lostId, destination, lostPayload, send)).kind,
    'UNKNOWN', 'receipt-write failure leaves durable UNKNOWN/RESERVED after restart');
  assertEqual(posts, beforeRetry, 'lost receipt cannot lead to another partner request');
  const rows = await database.query('SELECT * FROM lifeline_dispatch_ledger WHERE sos_id = $1', [lostId]);
  assert(!JSON.stringify(rows.rows).includes(payload.message), 'ledger never stores emergency message text');
} finally {
  await engine.close();
  rmSync(dir, { recursive: true, force: true });
}
