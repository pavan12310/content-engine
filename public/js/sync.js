// sync.js - team workspace: shares this browser's Content Engine data with teammates through /api/sync (Netlify Blobs).
// Changes are tracked per data item, sent compressed, and merged item by item for lists, so two people working at once
// don't erase each other's work. API keys and settings are never synced.
import * as store from "./store.js";
import { getSettings, saveSettings } from "./llm.js";

// sync bookkeeping is kept per database (per workspace)
const DIRTY = "ce-sync-dirty:" + store.dbName(), SEEN = "ce-sync-seen:" + store.dbName(), META = "ce-sync-meta:" + store.dbName();
// account mode: signed in to a workspace (set by auth.js at start-up); syncing is automatic and needs no team password
let ACCOUNT = null;
export function setAccountMode(a) { ACCOUNT = a; }
// the identification the server expects: the signed-in workspace, or the team password (null when neither is on)
export function authHeaders() { if (ACCOUNT) return { "x-workspace": ACCOUNT.workspace.id }; const s = syncSettings(); return s.enabled && s.teamKey ? { "x-team-key": s.teamKey } : null; }
const EXCLUDE = /^(genjob|chat|wbcache|qxcache|wkcache|linkmap-cache|decaymonths|ranks)[:-]/;   // writing checkpoints, personal chats and the page-history cache stay on this device   // writing checkpoints and personal chat conversations stay on this device                       // in-progress writing checkpoints stay on this device
const MAX_BATCH_CHARS = 4_000_000, MAX_ITEMS = 20;
const ls = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || "null") ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } };
const emit = detail => window.dispatchEvent(new CustomEvent("sync-status", { detail }));

export function syncSettings() {
  if (ACCOUNT) return { enabled: true, account: true, teamKey: "", name: ACCOUNT.user.name || ACCOUNT.user.email };
  const s = getSettings(); return { enabled: false, teamKey: "", name: "", ...(s.sync || {}) };
}
export function saveSyncSettings(patch) { const s = getSettings(); s.sync = { ...syncSettings(), ...patch }; saveSettings(s); }
export function syncMeta() { return ls(META, { last: 0, state: "off" }); }
function deviceId() { let m = ls(META, {}); if (!m.device) { m.device = Math.random().toString(36).slice(2, 10); lsSet(META, m); } return m.device; }
const who = () => syncSettings().name || `device ${deviceId()}`;

// ---- change tracking ----
store.onWrite(k => { if (EXCLUDE.test(k)) return; const d = ls(DIRTY, {}); d[k] = Date.now(); lsSet(DIRTY, d); if (syncSettings().enabled) schedule(4000); });

// ---- compression (gzip + base64) ----
async function gz(str) {
  const cs = new Blob([str]).stream().pipeThrough(new CompressionStream("gzip"));
  const buf = new Uint8Array(await new Response(cs).arrayBuffer()); let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(bin);
}
async function gunz(b64) {
  const bin = atob(b64), buf = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
}

// ---- merging: lists merge item by item, the newer copy of an item wins ----
const idOf = k => /^keywords:/.test(k) ? "keyword" : /^recs:/.test(k) ? "fingerprint" : /^(sites|contents:|plan:|aiq:|vis:|reviews:|gsc:|strategy:|ignored:|kb:|questions:|competitors:|briefs:|notes:|comments:)/.test(k) ? "id" : null;
const stamp = x => Number(x?.updated_at || x?.at || x?.created_at || 0);
export function mergeValues(key, local, remote) {
  if (key === "authors" && Array.isArray(local) && Array.isArray(remote)) return [...new Set([...remote, ...local])].slice(0, 20);
  const idk = idOf(key);
  if (!idk || !Array.isArray(local) || !Array.isArray(remote)) return remote;
  const keyOf = x => key.startsWith("ignored:") ? `${x.check}|${x.url}` : key.startsWith("strategy:") ? String(x.at) : x?.[idk];
  const m = new Map(remote.map(x => [keyOf(x), x]));
  const USER = ["status", "owner", "due", "notes", "done_at", "month", "edited_at"];   // fields people edit by hand
  for (const x of local) {
    const k = keyOf(x), r = m.get(k);
    if (!r) { m.set(k, x); continue; }
    const base = stamp(x) > stamp(r) ? { ...x } : { ...r };
    const human = Number(x.edited_at || 0) >= Number(r.edited_at || 0) ? x : r;   // the most recent human edit wins its fields
    if (x.edited_at || r.edited_at) for (const f of USER) { if (human[f] === undefined) delete base[f]; else base[f] = human[f]; }
    m.set(k, base);
  }
  return [...m.values()];
}

// ---- server calls ----
async function call(op, { method = "GET", query = "", body } = {}) {
  const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 30000);
  try {
    const headers = ACCOUNT ? { "x-workspace": ACCOUNT.workspace.id } : { "x-team-key": syncSettings().teamKey };
    const r = await fetch(`/api/sync?op=${op}${query}`, { method, signal: ctrl.signal, credentials: "same-origin", headers: { ...headers, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json().catch(() => ({}));
    if (r.status === 404 && !d.error) throw new Error("The team sync function isn't deployed yet. Push the latest code to GitHub so Netlify deploys it.");
    if (!r.ok) throw new Error(d.error || `Sync failed (${r.status})`);
    return d;
  } catch (e) { throw new Error(e.name === "AbortError" ? "Team sync timed out. Check your connection." : e.message); }
  finally { clearTimeout(t); }
}

// ---- one sync round: push local changes, then pull teammates' changes ----
let running = null, timer = null;
export function schedule(ms = 4000) { clearTimeout(timer); timer = setTimeout(() => syncNow().catch(() => {}), ms); }
export function syncNow() { if (!running) running = round().finally(() => { running = null; }); return running; }
async function round() {
  const cfg = syncSettings(); if (!cfg.enabled) return { skipped: true };
  emit({ state: "syncing" });
  const changed = [], conflicts = [];
  try {
    // 1. pull first: merge teammates' changes into ours, so what we push next already includes them
    const idx = await call("index"), seen = ls(SEEN, {});
    for (const it of idx.items || []) {
      if ((seen[it.key] || 0) >= it.at) continue;
      const g = await call("get", { query: `&key=${encodeURIComponent(it.key)}` });
      const localDirty = !!ls(DIRTY, {})[it.key];
      if (g.deleted) { if (!localDirty) await store.del(it.key, { silent: true }); }
      else {
        const remote = JSON.parse(await gunz(g.data)), local = await store.get(it.key);
        const merged = local && localDirty ? mergeValues(it.key, local, remote) : local && idOf(it.key) ? mergeValues(it.key, local, remote) : remote;
        await store.set(it.key, merged, { silent: true });
        if (JSON.stringify(merged) !== JSON.stringify(remote)) { const d = ls(DIRTY, {}); d[it.key] = Math.max(Date.now(), it.at + 1); lsSet(DIRTY, d); }   // our additions go back up
      }
      seen[it.key] = it.at; changed.push(it.key);
    }
    lsSet(SEEN, seen);
    // 2. push our changes (now merged); view-only roles only pull
    if (ACCOUNT && !ACCOUNT.canWrite) { lsSet(DIRTY, {}); const meta = { ...ls(META, {}), last: Date.now(), state: "ok", error: "" }; lsSet(META, meta); emit({ state: "ok", at: meta.last, changed, conflicts }); return { changed, conflicts }; }
    let dirty = ls(DIRTY, {}); let batch = [], size = 0;
    const flush = async () => {
      if (!batch.length) return;
      const res = await call("put", { method: "POST", body: { items: batch } });
      dirty = ls(DIRTY, {}); const sn = ls(SEEN, {});
      for (const r of res.results || []) {
        const sent = batch.find(b => b.key === r.key);
        if (r.ok) { sn[r.key] = r.at; if (dirty[r.key] === sent.at) delete dirty[r.key]; }
        else if (r.reason === "newer") { conflicts.push(r.key); }   // someone saved in between: keep it dirty, the next round merges
      }
      lsSet(DIRTY, dirty); lsSet(SEEN, sn); batch = []; size = 0;
    };
    for (const [key, at0] of Object.entries(dirty)) {
      if (EXCLUDE.test(key)) continue;
      const at = Math.max(at0, (ls(SEEN, {})[key] || 0) + 1);
      const v = await store.get(key);
      const data = v === null || v === undefined ? "" : await gz(JSON.stringify(v));
      if (data.length > MAX_BATCH_CHARS) { emit({ state: "warn", message: `“${key}” is too large to share (over 4 MB compressed). Read fewer pages for this website.` }); continue; }
      if (size + data.length > MAX_BATCH_CHARS || batch.length >= MAX_ITEMS) await flush();
      batch.push({ key, at, data, deleted: v === null || v === undefined, by: who() }); size += data.length;
      if (at !== at0) { const d = ls(DIRTY, {}); d[key] = at; lsSet(DIRTY, d); }
    }
    await flush();
    const meta = { ...ls(META, {}), last: Date.now(), state: "ok", error: "" }; lsSet(META, meta);
    emit({ state: "ok", at: meta.last, changed, conflicts });
    if (Object.keys(ls(DIRTY, {})).length) schedule(1500);   // merged items to send back
    return { changed, conflicts };
  } catch (e) {
    lsSet(META, { ...ls(META, {}), state: "error", error: e.message }); emit({ state: "error", message: e.message }); throw e;
  }
}
// turn on: share everything already in this browser, then pull the team's data
export async function enable({ teamKey, name }) {
  saveSyncSettings({ teamKey: teamKey.trim(), name: name.trim() });
  await call("index");   // checks the password (throws a clear error if wrong or not set up)
  const d = ls(DIRTY, {}), now = Date.now();
  for (const k of await store.allKeys()) if (!EXCLUDE.test(k) && !d[k]) d[k] = now - 1;   // existing local data joins the team copy
  lsSet(DIRTY, d); saveSyncSettings({ enabled: true });
  return syncNow();
}
export function disable() { saveSyncSettings({ enabled: false }); lsSet(META, { ...ls(META, {}), state: "off" }); emit({ state: "off" }); }
let started = false;
export function start() {
  if (started) return; started = true;
  if (ACCOUNT && !ls(META, {}).joined) {   // first time in this workspace on this browser: share anything already here
    (async () => { const d = ls(DIRTY, {}), now = Date.now(); if (ACCOUNT.canWrite) for (const k of await store.allKeys()) if (!EXCLUDE.test(k) && !d[k]) d[k] = now - 1;
      lsSet(DIRTY, d); lsSet(META, { ...ls(META, {}), joined: Date.now() }); syncNow().catch(() => {}); })();
    return startTimers();
  }
  if (syncSettings().enabled) syncNow().catch(() => {});
  startTimers();
}
function startTimers() {
  setInterval(() => { if (syncSettings().enabled && document.visibilityState === "visible") syncNow().catch(() => {}); }, 120000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && syncSettings().enabled) syncNow().catch(() => {}); });
}
