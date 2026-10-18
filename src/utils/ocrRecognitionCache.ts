import type { LocalOcrProfile, LocalOcrRecognition } from '../../lib/localOcrEngine';
import { OCR_PIPELINE_VERSIONS, recognitionCacheKey, validCachedRecognitions, type OcrCacheRecord } from '../../lib/ocrAutonomy';

const DB_NAME = 'moetracker-ocr-cache';
const STORE = 'recognitions';
const MAX_RECORDS = 20_000;
const memory = new Map<string, OcrCacheRecord>();

const open = () => new Promise<IDBDatabase>((resolve, reject) => {
  if (!globalThis.indexedDB) return reject(new Error('IndexedDB is unavailable.'));
  const request = indexedDB.open(DB_NAME, 1);
  request.onupgradeneeded = () => {
    const db = request.result; const store = db.createObjectStore(STORE, { keyPath: 'key' }); store.createIndex('lastUsedAt', 'lastUsedAt');
  };
  request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
});

const transaction = async <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason?: any) => void) => void) => {
  const db = await open();
  try { return await new Promise<T>((resolve, reject) => run(db.transaction(STORE, mode).objectStore(STORE), resolve, reject)); }
  finally { db.close(); }
};

export async function getCachedRecognitions(imageSha256: string, profile: LocalOcrProfile): Promise<LocalOcrRecognition[] | null> {
  const key = recognitionCacheKey(imageSha256, profile);
  let record = memory.get(key) || null;
  if (!record) record = await transaction<OcrCacheRecord | null>('readonly', (store, resolve, reject) => {
    const request = store.get(key); request.onsuccess = () => resolve(request.result || null); request.onerror = () => reject(request.error);
  }).catch(() => null);
  if (!validCachedRecognitions(record, imageSha256, profile)) return null;
  record.lastUsedAt = new Date().toISOString(); memory.set(key, record);
  void transaction<void>('readwrite', (store, resolve, reject) => { const request = store.put(record!); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); }).catch(() => {});
  return structuredClone(record.recognitions);
}

export async function putCachedRecognitions(imageSha256: string, profile: LocalOcrProfile, recognitions: LocalOcrRecognition[]) {
  const now = new Date().toISOString(); const key = recognitionCacheKey(imageSha256, profile);
  const record: OcrCacheRecord = { schemaVersion: 1, key, imageSha256: imageSha256.toLowerCase(), profile: { id: profile.id, version: profile.version, width: profile.dimensions.width, height: profile.dimensions.height }, recognitionVersion: OCR_PIPELINE_VERSIONS.recognition, recognitions: structuredClone(recognitions), createdAt: now, lastUsedAt: now };
  memory.set(key, record);
  await transaction<void>('readwrite', (store, resolve, reject) => { const request = store.put(record); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); }).catch(() => {});
  if (memory.size > 500) for (const old of [...memory.keys()].slice(0, memory.size - 500)) memory.delete(old);
  void pruneOcrRecognitionCache();
}

export async function pruneOcrRecognitionCache(maxRecords = MAX_RECORDS) {
  return transaction<void>('readwrite', (store, resolve, reject) => {
    const count = store.count(); count.onerror = () => reject(count.error); count.onsuccess = () => {
      let remaining = Math.max(0, count.result - maxRecords); if (!remaining) return resolve();
      const cursor = store.index('lastUsedAt').openCursor(); cursor.onerror = () => reject(cursor.error); cursor.onsuccess = () => {
        const item = cursor.result; if (!item || remaining <= 0) return resolve(); item.delete(); remaining -= 1; item.continue();
      };
    };
  }).catch(() => {});
}

export async function sha256Base64(base64: string) {
  const binary = atob(base64); const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
}
