// store.js - all data lives in this browser (IndexedDB). Use Backup / Restore in Settings to move or share it.
const DB = "content-engine", OS = "kv";
let dbp;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(OS); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  return dbp;
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => { const t = d.transaction(OS, mode), s = t.objectStore(OS); const out = fn(s); t.oncomplete = () => res(out instanceof IDBRequest ? out.result : out); t.onerror = () => rej(t.error); });
}
export const get = async (k, dflt = null) => { const v = await tx("readonly", s => s.get(k)); return v === undefined ? dflt : v; };
export const set = (k, v) => tx("readwrite", s => { s.put(v, k); });
export const del = k => tx("readwrite", s => { s.delete(k); });
export const allKeys = () => tx("readonly", s => s.getAllKeys());
export async function exportAll() { const out = {}; for (const k of await allKeys()) out[k] = await get(k); return { app: "content-engine", version: 1, exported_at: new Date().toISOString(), data: out }; }
export async function importAll(obj) {
  if (!obj || obj.app !== "content-engine" || typeof obj.data !== "object") throw new Error("This isn't a Content Engine backup file.");
  for (const [k, v] of Object.entries(obj.data)) await set(k, v);
}
export async function clearAll() { for (const k of await allKeys()) await del(k); }
let seq = Date.now();
export const newId = () => ++seq;
