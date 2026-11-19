import api from './api';

const DATABASE_NAME = 'fixitnow-offline';
const DATABASE_VERSION = 2;
const REQUEST_STORE = 'requests';
const MESSAGE_STORE = 'messages';
const CACHE_STORE = 'form-cache';
const CHANGE_EVENT = 'offline-requests:change';
const MESSAGE_CHANGE_EVENT = 'offline-messages:change';
export const REQUEST_SYNC_TAG = 'fixitnow-sync-requests';
export const MESSAGE_SYNC_TAG = 'fixitnow-sync-messages';

let databasePromise;
const syncsInProgress = new Set();

function openDatabase() {
  if (!('indexedDB' in window)) {
    return Promise.reject(new Error('Offline request storage is not available in this browser.'));
  }
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(REQUEST_STORE)) {
          const store = database.createObjectStore(REQUEST_STORE, { keyPath: 'id' });
          store.createIndex('ownerId', 'ownerId');
        }
        if (!database.objectStoreNames.contains(MESSAGE_STORE)) {
          database.createObjectStore(MESSAGE_STORE, { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains(CACHE_STORE)) {
          database.createObjectStore(CACHE_STORE, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        databasePromise = null;
        reject(request.error || new Error('Could not open offline request storage.'));
      };
      request.onblocked = () => {
        databasePromise = null;
        reject(new Error('Offline request storage is blocked by another open tab.'));
      };
    });
  }
  return databasePromise;
}

function runTransaction(storeName, mode, action) {
  return openDatabase().then(
    (database) =>
      new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, mode);
        const request = action(transaction.objectStore(storeName));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Offline storage operation failed.'));
        transaction.onabort = () => reject(transaction.error || new Error('Offline storage transaction failed.'));
      })
  );
}

export async function registerBackgroundSync(tag) {
  if (!('serviceWorker' in navigator)) return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    if (!registration.sync) return false;
    await registration.sync.register(tag);
    return true;
  } catch {
    return false;
  }
}

export function cacheOfflineFormData(key, value) {
  return runTransaction(CACHE_STORE, 'readwrite', (store) =>
    store.put({ key, value, updatedAt: Date.now() })
  );
}

export async function getCachedOfflineFormData(key) {
  const cached = await runTransaction(CACHE_STORE, 'readonly', (store) => store.get(key));
  return cached?.value ?? null;
}

function notifyQueueChanged(ownerId) {
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { ownerId } }));
}

export async function getQueuedOfflineRequests(ownerId) {
  if (!ownerId) return [];
  const records = await runTransaction(REQUEST_STORE, 'readonly', (store) =>
    store.index('ownerId').getAll(ownerId)
  );
  return records.sort((left, right) => left.createdAt - right.createdAt);
}

export async function queueOfflineRequest(ownerId, entries, summary) {
  const record = {
    id: crypto.randomUUID(),
    ownerId,
    entries,
    summary,
    createdAt: Date.now(),
    lastError: null,
  };
  await runTransaction(REQUEST_STORE, 'readwrite', (store) => store.add(record));
  notifyQueueChanged(ownerId);
  registerBackgroundSync(REQUEST_SYNC_TAG);
  return record;
}

export async function syncOfflineRequests(ownerId) {
  if (!ownerId || !navigator.onLine || syncsInProgress.has(ownerId)) return 0;
  syncsInProgress.add(ownerId);
  let sent = 0;
  try {
    const records = await getQueuedOfflineRequests(ownerId);
    for (const record of records) {
      if (!navigator.onLine) break;
      const formData = new FormData();
      record.entries.forEach(([key, value]) => formData.append(key, value));
      try {
        await api.post('/requests', formData);
        await runTransaction(REQUEST_STORE, 'readwrite', (store) => store.delete(record.id));
        notifyQueueChanged(ownerId);
        sent += 1;
      } catch (error) {
        record.lastError = error?.response
          ? 'The server could not accept this request. It is still saved on this device.'
          : 'Could not connect to send this request. It is still saved on this device.';
        await runTransaction(REQUEST_STORE, 'readwrite', (store) => store.put(record));
        notifyQueueChanged(ownerId);
        break;
      }
    }
    return sent;
  } finally {
    syncsInProgress.delete(ownerId);
  }
}

export function subscribeToOfflineRequests(callback) {
  window.addEventListener(CHANGE_EVENT, callback);
  return () => window.removeEventListener(CHANGE_EVENT, callback);
}

function notifyMessagesChanged() {
  window.dispatchEvent(new CustomEvent(MESSAGE_CHANGE_EVENT));
}

export async function getQueuedOfflineMessages() {
  const records = await runTransaction(MESSAGE_STORE, 'readonly', (store) => store.getAll());
  return records.sort((left, right) => left.createdAt - right.createdAt);
}

export async function queueOfflineMessage(conversationId, body) {
  const record = {
    id: crypto.randomUUID(),
    conversationId,
    body,
    createdAt: Date.now(),
    lastError: null,
  };
  await runTransaction(MESSAGE_STORE, 'readwrite', (store) => store.add(record));
  notifyMessagesChanged();
  registerBackgroundSync(MESSAGE_SYNC_TAG);
  return record;
}

export async function syncOfflineMessages() {
  if (!navigator.onLine || syncsInProgress.has(MESSAGE_SYNC_TAG)) return 0;
  syncsInProgress.add(MESSAGE_SYNC_TAG);
  let sent = 0;
  try {
    const records = await getQueuedOfflineMessages();
    for (const record of records) {
      if (!navigator.onLine) break;
      try {
        await api.post(`/conversations/${record.conversationId}/messages`, { body: record.body });
        await runTransaction(MESSAGE_STORE, 'readwrite', (store) => store.delete(record.id));
        notifyMessagesChanged();
        sent += 1;
      } catch (error) {
        record.lastError = error?.response
          ? 'The server could not accept this message. It is still saved on this device.'
          : 'Could not connect to send this message. It is still saved on this device.';
        await runTransaction(MESSAGE_STORE, 'readwrite', (store) => store.put(record));
        notifyMessagesChanged();
        break;
      }
    }
    return sent;
  } finally {
    syncsInProgress.delete(MESSAGE_SYNC_TAG);
  }
}

export function subscribeToOfflineMessages(callback) {
  window.addEventListener(MESSAGE_CHANGE_EVENT, callback);
  return () => window.removeEventListener(MESSAGE_CHANGE_EVENT, callback);
}
