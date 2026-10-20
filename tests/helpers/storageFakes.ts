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

/** In-memory Firestore covering the calls lib/store.ts makes. */
export function createFirestoreFake() {
  const collections = new Map<string, Map<string, any>>();
  const store = (name: string) => { if (!collections.has(name)) collections.set(name, new Map()); return collections.get(name)!; };
  const snapshotOf = (name: string, id: string) => {
    const data = store(name).get(id);
    return { id, exists: data !== undefined, data: () => (data === undefined ? undefined : structuredClone(data)), ref: docRef(name, id) };
  };
  const docRef = (name: string, id: string): any => ({
    id, __collection: name,
    get: async () => snapshotOf(name, id),
    set: async (value: any, options?: { merge?: boolean }) => { store(name).set(id, options?.merge ? { ...(store(name).get(id) || {}), ...structuredClone(value) } : structuredClone(value)); },
    delete: async () => { store(name).delete(id); },
  });
  const query = (name: string, field?: string, value?: unknown) => ({
    get: async () => {
      const docs = [...store(name).entries()].filter(([, data]) => field === undefined || data?.[field] === value).map(([id]) => snapshotOf(name, id));
      return { docs, empty: docs.length === 0, size: docs.length, forEach: (callback: (doc: any) => void) => docs.forEach(callback) };
    },
  });
  const firestore = {
    collections,
    collection: (name: string) => ({
      doc: (id: string) => docRef(name, id),
      where: (field: string, _op: '==', value: unknown) => query(name, field, value),
      get: query(name).get,
    }),
    batch: () => {
      const operations: Array<() => void> = [];
      return {
        create: (ref: any, value: any) => operations.push(() => { if (store(ref.__collection).has(ref.id)) throw new Error('ALREADY_EXISTS'); store(ref.__collection).set(ref.id, structuredClone(value)); }),
        set: (ref: any, value: any) => operations.push(() => store(ref.__collection).set(ref.id, structuredClone(value))),
        delete: (ref: any) => operations.push(() => store(ref.__collection).delete(ref.id)),
        commit: async () => { operations.forEach(operation => operation()); },
      };
    },
    runTransaction: async (operation: (transaction: any) => Promise<any>) => operation({
      get: (ref: any) => ref.get(),
      set: (ref: any, value: any) => { store(ref.__collection).set(ref.id, structuredClone(value)); },
    }),
  };
  return firestore;
}
