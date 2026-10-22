// store.js - all data lives in this browser (IndexedDB). Use Backup / Restore in Settings to move or share it.
// Robustness: in-memory cache (fast repeated reads), cross-tab invalidation, friendly "storage full" errors,
// and a request for persistent storage so the browser doesn't clear data when disk space runs low.
// each workspace has its own database in this browser, so one client's data never mixes with another's.
// The name is chosen before the app starts (set by sign-in / workspace switching, then the page reloads).
export const DEFAULT_DB = "content-engine";
const DB = (() => { try { return localStorage.getItem("ce-db") || DEFAULT_DB; } catch { return DEFAULT_DB; } })(), OS = "kv";
export const dbName = () => DB;
let dbp;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(OS);
    r.onsuccess = () => { const d = r.result; d.onversionchange = () => { d.close(); dbp = null; }; res(d); };
    r.onerror = () => rej(new Error("This browser blocked local storage (private mode or strict settings). Data can't be saved."));
    r.onblocked = () => rej(new Error("Close other tabs of this app and reload."));
  });
  return dbp;
}
export class StorageFullError extends Error {}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    let t; try { t = d.transaction(OS, mode); } catch (e) { dbp = null; return rej(e); }
    const s = t.objectStore(OS); const out = fn(s);
    t.oncomplete = () => res(out instanceof IDBRequest ? out.result : out);
    const fail = () => { const e = t.error || out?.error;
      rej(e && e.name === "QuotaExceededError" ? new StorageFullError("Browser storage is full. Download a backup, then delete websites you no longer need (Websites → Remove), or clear old Google data.") : e); };
    t.onerror = fail; t.onabort = fail;
  });
}
// ---- cache + cross-tab sync ----
const cache = new Map();
const bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("content-engine-store:" + DB) : null;
if (bc) bc.onmessage = e => { if (e.data && e.data.key) cache.delete(e.data.key); else cache.clear(); };
export const get = async (k, dflt = null) => {
  if (cache.has(k)) return cache.get(k) ?? dflt;
  const v = await tx("readonly", s => s.get(k));
  cache.set(k, v === undefined ? null : v); return v === undefined || v === null ? dflt : v;
};
// write listeners (team sync uses these); { silent: true } writes come from sync itself and aren't re-sent
const listeners = new Set();
export const onWrite = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const notify = (k, kind) => { for (const fn of listeners) { try { fn(k, kind); } catch { } } };
export const set = async (k, v, { silent = false } = {}) => { await tx("readwrite", s => { s.put(v, k); }); cache.set(k, v); bc && bc.postMessage({ key: k }); askPersist(); if (!silent) notify(k, "set"); };
export const del = async (k, { silent = false } = {}) => { await tx("readwrite", s => { s.delete(k); }); cache.delete(k); bc && bc.postMessage({ key: k }); if (!silent) notify(k, "del"); };
export const allKeys = () => tx("readonly", s => s.getAllKeys());
export async function exportAll() { const out = {}; for (const k of await allKeys()) out[k] = await get(k); return { app: "content-engine", version: 1, exported_at: new Date().toISOString(), data: out }; }
export async function importAll(obj) {
  if (!obj || obj.app !== "content-engine" || typeof obj.data !== "object") throw new Error("This isn't a Content Engine backup file.");
  for (const [k, v] of Object.entries(obj.data)) await set(k, v);
}
export async function clearAll() { for (const k of await allKeys()) await del(k); cache.clear(); bc && bc.postMessage({}); }
// ---- persistent storage + usage ----
let asked = false;
async function askPersist() {
  if (asked || typeof navigator === "undefined" || !navigator.storage || !navigator.storage.persist) return; asked = true;
  try { if (!(await navigator.storage.persisted())) await navigator.storage.persist(); } catch { /* not supported */ }
}
export async function storageInfo() {
  const out = { persisted: null, usage: null, quota: null };
  try { if (navigator.storage?.persisted) out.persisted = await navigator.storage.persisted(); if (navigator.storage?.estimate) Object.assign(out, await navigator.storage.estimate()); } catch { }
  return out;
}
let seq = Date.now() * 100 + Math.floor(Math.random() * 100);   // unique across tabs, still a safe integer
export const newId = () => ++seq;

// copy everything from another database in this browser (used to bring earlier, pre-account data into a workspace)
export async function copyFrom(otherName) {
  if (otherName === DB) return 0;
  const other = await new Promise((res, rej) => { const r = indexedDB.open(otherName, 1); r.onupgradeneeded = () => r.result.createObjectStore(OS); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const entries = await new Promise((res, rej) => { const t = other.transaction(OS, "readonly"), st = t.objectStore(OS), keys = st.getAllKeys(), vals = st.getAll();
    t.oncomplete = () => res(keys.result.map((k, i) => [k, vals.result[i]])); t.onerror = () => rej(t.error); });
  other.close();
  let n = 0; for (const [k, v] of entries) if (!String(k).startsWith("genjob:")) { await set(k, v); n++; }
  return n;
}
export async function countIn(otherName) {
  try { const other = await new Promise((res, rej) => { const r = indexedDB.open(otherName, 1); r.onupgradeneeded = () => r.result.createObjectStore(OS); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const n = await new Promise(res => { const t = other.transaction(OS, "readonly"), c = t.objectStore(OS).count(); t.oncomplete = () => res(c.result); t.onerror = () => res(0); });
    other.close(); return n; } catch { return 0; }
}
