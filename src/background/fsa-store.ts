/**
 * FSA 根目录句柄的 IndexedDB 持久化。
 * 同一扩展 origin 下，Service Worker 与 Offscreen Document 共享此库。
 */

const DB_NAME = 'wysiwyg-clipper';
const STORE = 'handles';
const KEY = 'root';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDB();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

/** 读取持久化的根目录句柄 */
export async function getRootHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const h = await withStore<FileSystemDirectoryHandle | undefined>('readonly', (s) => s.get(KEY));
    return h ?? null;
  } catch {
    return null;
  }
}

/** 保存根目录句柄（options 页授权时调用） */
export async function setRootHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  await withStore('readwrite', (s) => s.put(handle, KEY));
}

/** 清除句柄（解除授权） */
export async function clearRootHandle(): Promise<void> {
  await withStore('readwrite', (s) => s.delete(KEY));
}
