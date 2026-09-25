import { createHash } from 'node:crypto';
import { Pool } from 'pg';

/** A shared PostgreSQL database is required: a process-local cache or local file
 * cannot arbitrate across instances or survive a crash. No message, GPS, media,
 * credential or partner URL is stored here: only digests and a minimal receipt.
 */
export const LEDGER_SCHEMA = `CREATE TABLE IF NOT EXISTS lifeline_dispatch_ledger (
  sos_id TEXT PRIMARY KEY,
  destination_digest TEXT NOT NULL,
  payload_digest TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('RESERVED', 'UNKNOWN', 'CONFIRMED_SUCCESS')),
  receipt JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`;

export type PartnerReceipt = {
  referenceId: string;
  deliveryConfirmed?: boolean;
  responderAcknowledged?: boolean;
  deliveredAt?: string;
};

export type DispatchOutcome =
  | { kind: 'CONFIRMED_SUCCESS'; receipt: PartnerReceipt; replayed: boolean }
  | { kind: 'CONFIRMED_FAILURE'; reason: 'LEDGER_UNAVAILABLE' | 'SOS_ID_CONFLICT' }
  | { kind: 'UNKNOWN' };

export interface DispatchDatabase {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

/** Reserve BEFORE any outbound fetch. All ambiguous outcomes remain blocked;
 * even an HTTP 5xx may follow a partner-side commit. A ledger cannot decide
 * whether a timed-out partner accepted a request, so UNKNOWN never re-posts.
 * If write-ahead or receipt persistence fails, fail closed. The database must
 * use durable storage shared by every app instance; no fallback is allowed.
 */
export function createDispatchIdempotency(db: DispatchDatabase | null) {
  let initialized = false;
  const ensureSchema = async () => {
    if (!db) throw new Error('Ledger unavailable');
    if (!initialized) { await db.query(LEDGER_SCHEMA); initialized = true; }
  };
  const available = async (): Promise<boolean> => {
    try { await ensureSchema(); await db!.query('SELECT 1'); return true; }
    catch { return false; }
  };
  const dispatchOnce = async (
    sosId: string, destination: string, payload: unknown, send: () => Promise<PartnerReceipt>
  ): Promise<DispatchOutcome> => {
    const destinationDigest = digest(destination);
    const payloadDigest = digest(JSON.stringify(payload));
    try {
      await ensureSchema();
      const inserted = await db!.query(
        `INSERT INTO lifeline_dispatch_ledger (sos_id, destination_digest, payload_digest, state)
         VALUES ($1, $2, $3, 'RESERVED') ON CONFLICT (sos_id) DO NOTHING RETURNING sos_id`,
        [sosId, destinationDigest, payloadDigest]
      );
      if (!inserted.rowCount) {
        const existing = await db!.query(
          'SELECT destination_digest, payload_digest, state, receipt FROM lifeline_dispatch_ledger WHERE sos_id = $1',
          [sosId]
        );
        const row = existing.rows[0];
        if (!row) return { kind: 'CONFIRMED_FAILURE', reason: 'LEDGER_UNAVAILABLE' };
        if (row.destination_digest !== destinationDigest || row.payload_digest !== payloadDigest)
          return { kind: 'CONFIRMED_FAILURE', reason: 'SOS_ID_CONFLICT' };
        if (row.state === 'CONFIRMED_SUCCESS' && row.receipt?.referenceId)
          return { kind: 'CONFIRMED_SUCCESS', receipt: row.receipt as PartnerReceipt, replayed: true };
        return { kind: 'UNKNOWN' }; // RESERVED also covers a concurrent in-flight request.
      }
    } catch {
      // A reservation failure may itself have committed. In either case NO POST.
      return { kind: 'CONFIRMED_FAILURE', reason: 'LEDGER_UNAVAILABLE' };
    }

    try {
      const result = await send();
      if (!result || typeof result.referenceId !== 'string' || !result.referenceId.trim())
        throw new Error('No verifiable partner receipt');
      // Persist only verified facts. Do not store arbitrary upstream responses.
      const receipt: PartnerReceipt = {
        referenceId: result.referenceId,
        ...(result.deliveryConfirmed === true ? { deliveryConfirmed: true,
          ...(result.deliveredAt ? { deliveredAt: String(result.deliveredAt) } : {}) } : {}),
        ...(result.responderAcknowledged === true ? { responderAcknowledged: true } : {})
      };
      const saved = await db!.query(
        `UPDATE lifeline_dispatch_ledger SET state = 'CONFIRMED_SUCCESS', receipt = $2::jsonb
         WHERE sos_id = $1 AND state = 'RESERVED' AND destination_digest = $3 AND payload_digest = $4 RETURNING sos_id`,
        [sosId, JSON.stringify(receipt), destinationDigest, payloadDigest]
      );
      if (saved.rowCount !== 1) throw new Error('Receipt was not persisted');
      return { kind: 'CONFIRMED_SUCCESS', receipt, replayed: false };
    } catch {
      // An HTTP 4xx/5xx, timeout, parse failure or receipt-write failure is
      // UNKNOWN once the outbound attempt starts. Do not resend this ID.
      try {
        await db!.query("UPDATE lifeline_dispatch_ledger SET state = 'UNKNOWN' WHERE sos_id = $1 AND state = 'RESERVED'", [sosId]);
      } catch { /* RESERVED remains fail-closed on the next read. */ }
      return { kind: 'UNKNOWN' };
    }
  };
  return { available, dispatchOnce };
}

export function createConfiguredDispatchLedger(env: NodeJS.ProcessEnv) {
  const url = env.DISPATCH_LEDGER_DATABASE_URL;
  return createDispatchIdempotency(url ? new Pool({ connectionString: url, connectionTimeoutMillis: 3000, max: 4 }) : null);
}
