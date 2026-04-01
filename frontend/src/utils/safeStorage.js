/**
 * safeStorage — localStorage wrapper with fallbacks for Safari private browsing (#485)
 *
 * Tries localStorage first, falls back to sessionStorage, then in-memory Map.
 * Safari private mode throws QuotaExceededError on localStorage.setItem(),
 * breaking session token persistence. This utility ensures storage always works.
 */

const memoryStore = new Map();

/**
 * Test if a storage backend is usable by attempting a write/read/delete cycle.
 * @param {Storage} storage
 * @returns {boolean}
 */
function isStorageAvailable(storage) {
  try {
    const testKey = '__safeStorage_test__';
    storage.setItem(testKey, '1');
    storage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

/** Cached availability flags (evaluated lazily on first use). */
let _localAvailable = null;
let _sessionAvailable = null;

function localAvailable() {
  if (_localAvailable === null) {
    _localAvailable = typeof localStorage !== 'undefined' && isStorageAvailable(localStorage);
  }
  return _localAvailable;
}

function sessionAvailable() {
  if (_sessionAvailable === null) {
    _sessionAvailable = typeof sessionStorage !== 'undefined' && isStorageAvailable(sessionStorage);
  }
  return _sessionAvailable;
}

export const safeStorage = {
  getItem(key) {
    try {
      if (localAvailable()) {
        const val = localStorage.getItem(key);
        if (val !== null) return val;
      }
    } catch { /* fall through */ }

    try {
      if (sessionAvailable()) {
        const val = sessionStorage.getItem(key);
        if (val !== null) return val;
      }
    } catch { /* fall through */ }

    return memoryStore.get(key) ?? null;
  },

  setItem(key, value) {
    // `stored` tracks whether any persistent store succeeded.
    // If localStorage throws (e.g., Safari private QuotaExceededError),
    // we fall through to sessionStorage. Memory fallback is only used
    // when BOTH persistent stores fail, preventing redundant writes.
    let stored = false;

    try {
      if (localAvailable()) {
        localStorage.setItem(key, value);
        stored = true;
      }
    } catch { /* fall through */ }

    // Always mirror to sessionStorage when available (fallback for reconnect)
    try {
      if (sessionAvailable()) {
        sessionStorage.setItem(key, value);
        if (!stored) stored = true;
      }
    } catch { /* fall through */ }

    if (!stored) {
      memoryStore.set(key, value);
    }

    return stored;
  },

  removeItem(key) {
    try {
      if (localAvailable()) localStorage.removeItem(key);
    } catch { /* ignore */ }

    try {
      if (sessionAvailable()) sessionStorage.removeItem(key);
    } catch { /* ignore */ }

    memoryStore.delete(key);
  },
};

export default safeStorage;
