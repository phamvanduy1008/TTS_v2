// Simple IndexedDB cache for model files
class ModelCache {
  constructor() {
    this.dbName = 'piper-tts-cache';
    this.storeName = 'models';
    this.version = 2;
    this.db = null;
  }

  async init() {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'url' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        } else {
          const store = event.target.transaction.objectStore(this.storeName);
          if (!store.indexNames.contains('contentHash')) {
            store.createIndex('contentHash', 'contentHash', { unique: false });
          }
        }
      };
    });
  }

  async calculateContentHash(arrayBuffer) {
    try {
      const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((byte) => byte.toString(16).padStart(2, '0')).join('');
    } catch (error) {
      const view = new Uint8Array(arrayBuffer);
      const size = view.length;
      const firstBytes = Array.from(view.slice(0, Math.min(100, size))).join(',');
      const lastBytes = Array.from(view.slice(Math.max(0, size - 100), size)).join(',');
      return `${size}-${firstBytes}-${lastBytes}`;
    }
  }

  async get(url) {
    await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(url);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const result = request.result;
        if (result) {
          const maxAge = 7 * 24 * 60 * 60 * 1000;
          if (Date.now() - result.timestamp < maxAge) {
            resolve({
              data: result.data,
              contentHash: result.contentHash || null,
            });
            return;
          }

          this.delete(url);
        }

        resolve(null);
      };
    });
  }

  async set(url, data, contentHash) {
    await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.put({
        url,
        data,
        contentHash: contentHash || null,
        timestamp: Date.now(),
      });

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async delete(url) {
    await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.delete(url);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async clear() {
    await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.clear();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }
}

const sharedModelCache = new ModelCache();

export async function cachedFetch(url) {
  const cached = await sharedModelCache.get(url);
  if (cached) {
    return new Response(cached.data);
  }

  const response = await fetch(url, { cache: 'force-cache' });
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data = await response.arrayBuffer();
  const contentHash = await sharedModelCache.calculateContentHash(data);
  await sharedModelCache.set(url, data, contentHash);

  return new Response(data, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export default ModelCache;
