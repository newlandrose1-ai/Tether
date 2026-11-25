import type { PipelineSharedState } from '../types/pipeline';

const DB_NAME = 'zip-upgrader-optin-db';
const DB_VERSION = 1;
const STORE_NAME = 'session';
const SESSION_KEY = 'active-session';

function hasIndexedDb(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

function openSessionDb(): Promise<IDBDatabase | null> {
  if (!hasIndexedDb()) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function sanitizeStateForPersistence(state: PipelineSharedState): PipelineSharedState {
  // Never store in-flight spinner/progress flags or duplicate originalBufferCopy
  return {
    ...state,
    keepSessionOptIn: true,
    sessionHydrated: true,
    ingestStatus: state.ingestStatus === 'ingesting' ? 'idle' : state.ingestStatus,
    ingestProgress: null,
    isApplying: false,
    isVerifying: false,
    verifyProgress: null,
    ingest: state.ingest
      ? {
          ...state.ingest,
          originalBufferCopy: new ArrayBuffer(0),
        }
      : null,
  };
}

/**
 * Persists session ONLY when the user has explicitly opted in via keepSessionOptIn.
 * Never touches localStorage or disk by default.
 */
export async function saveOptInSession(state: PipelineSharedState): Promise<void> {
  if (!state.keepSessionOptIn) return;
  const db = await openSessionDb();
  if (!db) return;

  const sanitized = sanitizeStateForPersistence(state);
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(sanitized, SESSION_KEY);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
      tx.onabort = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

export async function loadOptInSession(): Promise<PipelineSharedState | null> {
  const db = await openSessionDb();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(SESSION_KEY);
      req.onsuccess = () => {
        const value = req.result as PipelineSharedState | undefined;
        db.close();
        if (!value || !value.keepSessionOptIn || !value.ingest) {
          resolve(null);
          return;
        }
        resolve({
          ...value,
          keepSessionOptIn: true,
          sessionHydrated: true,
          ingestProgress: null,
          isApplying: false,
          isVerifying: false,
          verifyProgress: null,
        });
      };
      req.onerror = () => {
        db.close();
        resolve(null);
      };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

export async function clearOptInSession(): Promise<void> {
  const db = await openSessionDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(SESSION_KEY);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
      tx.onabort = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}
