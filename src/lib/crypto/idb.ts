'use client';

import { openDB, type IDBPDatabase } from 'idb';
import { encryptObject, decryptObject } from './encryption';
import type { EncryptedPayload } from '@/types';

// ============================================================
// Typed IndexedDB Wrapper with Transparent Encryption
// All sensitive data is encrypted before write
// and decrypted after read using the in-memory DEK.
// ============================================================

const DB_NAME = 'soul-upload';
const DB_VERSION = 2;

export const STORES = {
  accounts: 'accounts',
  providers: 'providers',
  entities: 'entities',
  chatSessions: 'chat_sessions',
  drafts: 'drafts',
  userProfiles: 'user_profiles',
} as const;

type StoreName = typeof STORES[keyof typeof STORES];

let dbInstance: IDBPDatabase | null = null;

/**
 * Get or create the IndexedDB instance.
 */
async function getDB(): Promise<IDBPDatabase> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Accounts store — keyed by id
      if (!db.objectStoreNames.contains(STORES.accounts)) {
        db.createObjectStore(STORES.accounts, { keyPath: 'id' });
      }
      // Providers store
      if (!db.objectStoreNames.contains(STORES.providers)) {
        db.createObjectStore(STORES.providers, { keyPath: 'id' });
      }
      // Entities store
      if (!db.objectStoreNames.contains(STORES.entities)) {
        db.createObjectStore(STORES.entities, { keyPath: 'id' });
      }
      // Chat sessions
      if (!db.objectStoreNames.contains(STORES.chatSessions)) {
        const store = db.createObjectStore(STORES.chatSessions, { keyPath: 'id' });
        store.createIndex('entityId', 'entityId', { unique: false });
      }
      // Questionnaire drafts
      if (!db.objectStoreNames.contains(STORES.drafts)) {
        db.createObjectStore(STORES.drafts, { keyPath: 'id' });
      }
      // User profiles (SU-ITER-043)
      if (!db.objectStoreNames.contains(STORES.userProfiles)) {
        db.createObjectStore(STORES.userProfiles, { keyPath: 'id' });
      }
    },
  });

  return dbInstance;
}

// --- Encrypted CRUD Operations ---

/**
 * Save an object to IndexedDB, encrypting with the DEK.
 * The `id` field is stored as plaintext key; all other data is encrypted.
 *
 * `indexFields` — optional record of fields to store **unencrypted** alongside
 * `id` + `payload` so that IndexedDB indexes can query them. Only use for
 * non-sensitive values required for index lookups (e.g. `entityId` on
 * `chat_sessions`).
 */
export async function putEncrypted<T extends { id: string }>(
  store: StoreName,
  data: T,
  key: CryptoKey,
  indexFields?: Record<string, string>
): Promise<void> {
  const db = await getDB();
  const encrypted = await encryptObject(data, key);
  await db.put(store, { id: data.id, payload: encrypted, ...indexFields });
}

/**
 * Read and decrypt a single object by ID.
 */
export async function getDecrypted<T>(
  store: StoreName,
  id: string,
  key: CryptoKey
): Promise<T | undefined> {
  const db = await getDB();
  const record = await db.get(store, id);
  if (!record?.payload) return undefined;
  return decryptObject<T>(record.payload as EncryptedPayload, key);
}

/**
 * Read and decrypt all objects in a store.
 */
export async function getAllDecrypted<T>(
  store: StoreName,
  key: CryptoKey
): Promise<T[]> {
  const db = await getDB();
  const records = await db.getAll(store);
  const results: T[] = [];
  for (const record of records) {
    if (record?.payload) {
      try {
        const decrypted = await decryptObject<T>(record.payload as EncryptedPayload, key);
        results.push(decrypted);
      } catch {
        // Skip corrupted records
      }
    }
  }
  return results;
}

/**
 * Delete a record by ID.
 */
export async function deleteRecord(store: StoreName, id: string): Promise<void> {
  const db = await getDB();
  await db.delete(store, id);
}

/**
 * Get all records from an index (e.g., chat sessions by entityId).
 */
export async function getByIndex<T>(
  store: StoreName,
  indexName: string,
  indexValue: string,
  key: CryptoKey
): Promise<T[]> {
  const db = await getDB();
  const records = await db.getAllFromIndex(store, indexName, indexValue);
  const results: T[] = [];
  for (const record of records) {
    if (record?.payload) {
      try {
        const decrypted = await decryptObject<T>(record.payload as EncryptedPayload, key);
        results.push(decrypted);
      } catch {
        // Skip corrupted records
      }
    }
  }
  return results;
}

// --- Unencrypted operations (for accounts — hash is already protection) ---

/**
 * Save an account record WITHOUT encryption.
 * Account data (hash, salt, lock status) doesn't need DEK encryption
 * because the hash IS the protection and the DEK hasn't been derived yet during login.
 */
export async function putAccount<T extends { id: string }>(
  data: T
): Promise<void> {
  const db = await getDB();
  await db.put(STORES.accounts, data);
}

/**
 * Get an account record without decryption.
 */
export async function getAccount<T>(id: string): Promise<T | undefined> {
  const db = await getDB();
  return db.get(STORES.accounts, id) as Promise<T | undefined>;
}

/**
 * Get all accounts (unencrypted).
 */
export async function getAllAccounts<T>(): Promise<T[]> {
  const db = await getDB();
  return db.getAll(STORES.accounts) as Promise<T[]>;
}

/**
 * Close the database connection (for cleanup/testing).
 */
export function closeDB(): void {
  dbInstance?.close();
  dbInstance = null;
}
