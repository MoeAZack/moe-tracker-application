import type { OcrCorrectionSample, OcrSessionOutcome } from '../../lib/ocrLearning';
import { buildLocalCorrectionModel, learnedAliasesFromCorrections, ocrHealthSummary, rosterWithLearnedAliases } from '../../lib/ocrLearning';

const DB_NAME = 'moetracker-ocr-learning';
const DB_VERSION = 1;
const MAX_CORRECTIONS = 50_000;
const MAX_OUTCOMES = 10_000;
const ENABLED_KEY = 'moetracker-ocr-learning-enabled';
const memoryCorrections = new Map<string, OcrCorrectionSample>();
const memoryOutcomes = new Map<string, OcrSessionOutcome>();
function learningEnabled() { try { return globalThis.localStorage?.getItem(ENABLED_KEY) !== 'false'; } catch { return true; } }

function openDb() {
  return new Promise<IDBDatabase | null>((resolve) => {
    if (!globalThis.indexedDB) return resolve(null);
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('corrections')) db.createObjectStore('corrections', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('outcomes')) db.createObjectStore('outcomes', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function putMany(storeName: 'corrections' | 'outcomes', rows: Array<OcrCorrectionSample | OcrSessionOutcome>) {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const transaction = db.transaction(storeName, 'readwrite'); const store = transaction.objectStore(storeName);
    for (const row of rows) store.put(structuredClone(row));
    transaction.oncomplete = () => resolve(); transaction.onerror = () => resolve(); transaction.onabort = () => resolve();
  });
  db.close();
}

async function readAll<T>(storeName: 'corrections' | 'outcomes', fallback: Map<string, T>) {
  const db = await openDb();
  if (!db) return [...fallback.values()];
  const rows = await new Promise<T[]>((resolve) => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result as T[]); request.onerror = () => resolve([]);
  });
  db.close(); return rows;
}

async function prune(storeName: 'corrections' | 'outcomes', limit: number) {
  const db = await openDb(); if (!db) return;
  const rows = await new Promise<any[]>((resolve) => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result || []); request.onerror = () => resolve([]);
  });
  const excess = rows.sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt))).slice(limit);
  if (excess.length) await new Promise<void>((resolve) => {
    const transaction = db.transaction(storeName, 'readwrite'); const store = transaction.objectStore(storeName);
    for (const row of excess) store.delete(row.id);
    transaction.oncomplete = () => resolve(); transaction.onerror = () => resolve(); transaction.onabort = () => resolve();
  });
  db.close();
}

export async function recordOcrCorrections(samples: OcrCorrectionSample[]) {
  if (!learningEnabled()) return;
  for (const sample of samples) memoryCorrections.set(sample.id, structuredClone(sample));
  if (samples.length) { await putMany('corrections', samples); void prune('corrections', MAX_CORRECTIONS); }
}

export async function recordOcrSessionOutcome(outcome: OcrSessionOutcome) {
  memoryOutcomes.set(outcome.id, structuredClone(outcome)); await putMany('outcomes', [outcome]); void prune('outcomes', MAX_OUTCOMES);
}

export async function getOcrLearningState(roster: readonly { id: string; displayName: string }[]) {
  const [corrections, outcomes] = await Promise.all([
    readAll<OcrCorrectionSample>('corrections', memoryCorrections), readAll<OcrSessionOutcome>('outcomes', memoryOutcomes),
  ]);
  const enabled = learningEnabled(); const activeCorrections = enabled ? corrections : [];
  const aliases = learnedAliasesFromCorrections(activeCorrections, roster);
  return { enabled, corrections, outcomes, aliases, model: buildLocalCorrectionModel(activeCorrections), health: ocrHealthSummary(outcomes, corrections, aliases) };
}

/** Roster for an OCR extraction with every learned alias attached; learning failures fall back to the plain roster. */
export async function learnedExtractionRoster<T extends { id?: string; displayName: string; aliases?: string[] }>(roster: readonly T[]) {
  try {
    const { aliases } = await getOcrLearningState(roster.filter((player): player is T & { id: string } => !!player.id));
    return rosterWithLearnedAliases(roster, aliases);
  } catch { return rosterWithLearnedAliases(roster, []); }
}

export function setOcrLearningEnabled(enabled: boolean) { try { globalThis.localStorage?.setItem(ENABLED_KEY, String(enabled)); } catch { /* browser storage unavailable */ } }

export async function resetOcrLearning() {
  memoryCorrections.clear(); memoryOutcomes.clear(); const db = await openDb(); if (!db) return;
  await new Promise<void>(resolve => { const transaction = db.transaction(['corrections', 'outcomes'], 'readwrite'); transaction.objectStore('corrections').clear(); transaction.objectStore('outcomes').clear(); transaction.oncomplete = () => resolve(); transaction.onerror = () => resolve(); transaction.onabort = () => resolve(); }); db.close();
}

export function downloadOcrLearningDataset(state: Awaited<ReturnType<typeof getOcrLearningState>>) {
  const blob = new Blob([JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), ...state }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
  anchor.href = url; anchor.download = `moetracker-ocr-learning-${new Date().toISOString().slice(0, 10)}.json`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
