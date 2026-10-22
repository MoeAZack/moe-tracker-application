import { DatabaseSync } from 'node:sqlite';

/** Minimal Cloudflare D1 binding over node:sqlite, enough for lib/store.ts. */
export function createD1Fake() {
  const db = new DatabaseSync(':memory:');
  const calls = { batch: 0, run: 0, statements: 0 };
  const prepare = (sql: string) => {
    let params: any[] = [];
    const statement = {
      bind: (...values: any[]) => { params = values; return statement; },
      run: async () => { calls.run += 1; calls.statements += 1; const info = db.prepare(sql).run(...params); return { meta: { changes: Number(info.changes) } }; },
      first: async () => db.prepare(sql).get(...params) ?? null,
      all: async () => ({ results: db.prepare(sql).all(...params) }),
      execute: () => { calls.statements += 1; db.prepare(sql).run(...params); },
    };
    return statement;
  };
  return {
    calls, sqlite: db,
    prepare,
    exec: async (sql: string) => { db.exec(sql); },
    batch: async (statements: Array<ReturnType<typeof prepare>>) => {
      calls.batch += 1;
      db.exec('BEGIN');
      try { for (const statement of statements) statement.execute(); db.exec('COMMIT'); }
      catch (error) { db.exec('ROLLBACK'); throw error; }
      return statements.map(() => ({ success: true }));
    },
  };
}
