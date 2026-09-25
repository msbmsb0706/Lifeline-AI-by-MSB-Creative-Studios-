import { createHash } from 'node:crypto';

/** Process-local concurrent request coalescing and receipt cache. Across restarts
 * the authorized partner MUST honor the forwarded Idempotency-Key (deployment
 * opt-in is required for unattended recovery); a local cache alone is not enough.
 */
export function createDispatchIdempotency() {
  const seen = new Map<string, { fingerprint: string; result?: Promise<unknown> }>();
  return async function dispatchOnce<T>(sosId: string, payload: unknown, send: () => Promise<T>): Promise<T> {
    const fingerprint = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const previous = seen.get(sosId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new Error('SOS_ID_CONFLICT');
      if (previous.result) return previous.result as Promise<T>;
    }
    // One pending send per SOS ID, including while upstream is still running.
    const promise = Promise.resolve().then(send);
    seen.set(sosId, { fingerprint, result: promise });
    try { return await promise; }
    catch (err) {
      // Unknown upstream outcome: retry with the SAME idempotency key. The
      // partner must deduplicate, including when its first response was lost.
      if (seen.get(sosId)?.result === promise) seen.set(sosId, { fingerprint });
      throw err;
    }
  };
}
