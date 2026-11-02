/* Badge Studio — local library (IndexedDB): projects, prepared files,
   device thumbnails and paired badges. No servers, everything stays in the browser. */
(function (root) {
  'use strict';
  const BS = root.BS || (root.BS = {});
  const STORES = { projects: { keyPath: 'id' }, devices: { keyPath: 'id' }, thumbs: { keyPath: 'name' }, materials: { keyPath: 'id' } };
  let dbPromise;
  function open() {
    if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
      if (!root.indexedDB) { reject(new Error('Este navegador no permite guardar la colección. Descargá tu proyecto.')); return; }
      const req = root.indexedDB.open('badge-studio', 2);
      req.onupgradeneeded = () => { const db = req.result; for (const [name, opts] of Object.entries(STORES)) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, opts); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new Error('No se pudo abrir la colección local.'));
    });
    return dbPromise;
  }
  async function call(store, method, value) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, method === 'getAll' || method === 'get' ? 'readonly' : 'readwrite'), os = tx.objectStore(store);
      const req = value === undefined ? os[method]() : os[method](value);
      let result; req.onsuccess = () => { result = req.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(new Error('No se pudo guardar o leer la colección. Descargá tu proyecto como copia.'));
    });
  }
  const api = (store) => ({ all: () => call(store, 'getAll'), get: (k) => call(store, 'get', k), put: (v) => call(store, 'put', v), remove: (k) => call(store, 'delete', k), clear: () => call(store, 'clear') });
  BS.db = { projects: api('projects'), devices: api('devices'), thumbs: api('thumbs'), materials: api('materials'), open };
})(typeof window !== 'undefined' ? window : globalThis);
