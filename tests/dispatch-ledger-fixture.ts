import { PGlite } from '@electric-sql/pglite';
import type { DispatchDatabase } from '../server/dispatchIdempotency.ts';

/** Embedded PostgreSQL semantics for tests; pass a filesystem directory for
 * restart tests. Production ALWAYS uses a shared external PostgreSQL server. */
export function testDatabase(engine: PGlite): DispatchDatabase {
  return {
    query: async (sql, params) => {
      const result = await engine.query(sql, params as any[]);
      return { rows: result.rows, rowCount: result.affectedRows };
    }
  };
}
