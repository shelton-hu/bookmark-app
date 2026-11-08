// Keep versioned source files on disk, separately from the eight decoded textures.
const DB = 'bookmark-summon-assets';
const STORE = 'artwork';
let connection: Promise<IDBDatabase | null> | undefined;
const transfers = new Map<string, Promise<Blob>>();
const versioned = (url: string) => /^\/spirits\/[a-z]+-restored-v[1-9]\d*\.png$/.test(url);

function database(): Promise<IDBDatabase | null> {
  if (connection) return connection;
  connection = new Promise(resolve => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      let settled = false;
      const finish = (db: IDBDatabase | null) => {
        if (settled) { db?.close(); return; }
        settled = true; clearTimeout(deadline); resolve(db);
      };
      const deadline = setTimeout(() => finish(null), 2000);
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => { request.result.createObjectStore(STORE); };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); connection = undefined; };
        finish(db);
      };
      request.onerror = request.onblocked = () => finish(null);
    } catch { resolve(null); }
  });
  return connection;
}

function read(db: IDBDatabase, url: string): Promise<Blob | null> {
  return new Promise(resolve => {
    try {
      const request = db.transaction(STORE).objectStore(STORE).get(url);
      request.onsuccess = () => resolve(request.result instanceof Blob && request.result.size > 0 && request.result.type === 'image/png' ? request.result : null);
      request.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

function write(db: IDBDatabase, apply: (store: IDBObjectStore) => void): Promise<void> {
  return new Promise(resolve => {
    try {
      const transaction = db.transaction(STORE, 'readwrite');
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () => resolve(); // Storage denial/quota falls back to HTTP caching.
      apply(transaction.objectStore(STORE));
    } catch { resolve(); }
  });
}

export async function removeSummonAssets(urls: string[]): Promise<void> {
  if (!urls.length) return;
  const db = await database();
  if (db) await write(db, store => { urls.forEach(url => store.delete(url)); });
}

export async function pruneSummonAssets(active: string[]): Promise<void> {
  const db = await database();
  if (!db) return;
  const keys = await new Promise<IDBValidKey[]>(resolve => {
    try {
      const request = db.transaction(STORE).objectStore(STORE).getAllKeys();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve([]);
    } catch { resolve([]); }
  });
  const obsolete = keys.filter(key => typeof key === 'string' && !active.includes(key)) as string[];
  await removeSummonAssets(obsolete);
}

/** Share one in-flight transfer between prefetching and the card's decoder. */
export async function downloadSummonAsset(url: string, signal?: AbortSignal): Promise<Blob> {
  const db = versioned(url) ? await database() : null;
  if (db) {
    const cached = await read(db, url);
    if (cached) return cached;
  }
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  let pending = transfers.get(url);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(url, { cache: versioned(url) ? 'force-cache' : 'default', signal });
      if (!response.ok) throw new Error(`Artwork HTTP ${response.status}`);
      const blob = await response.blob();
      if (versioned(url) && (blob.type !== 'image/png' || !blob.size)) throw new Error('Invalid artwork');
      if (db) await write(db, store => store.put(blob, url));
      return blob;
    })();
    transfers.set(url, pending);
    const clear = () => { if (transfers.get(url) === pending) transfers.delete(url); };
    void pending.then(clear, clear);
  }
  return pending;
}

export async function summonImageSource(url: string, signal?: AbortSignal): Promise<{ url: string; release: () => void }> {
  // Older/blocked browsers can still use an ordinary image and the HTTP cache.
  if (!versioned(url) || !await database()) return { url, release() {} };
  const blob = await downloadSummonAsset(url, signal);
  const source = URL.createObjectURL(blob);
  return { url: source, release: () => URL.revokeObjectURL(source) };
}
