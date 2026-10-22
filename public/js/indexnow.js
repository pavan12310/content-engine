// indexnow.js - instant indexing for IndexNow search engines (Bing, Yandex, Seznam, Naver…; Google doesn't take part).
// One key per website (shared with the team), a check that the key file is live, submissions through /api/indexnow, and a log.
import * as store from "./store.js";
import { getSettings } from "./llm.js";
const KEY = id => `indexnow:${id}`;
export const get = async id => (await store.get(KEY(id), null)) || { key: "", key_location: "", verified: null, log: [] };
async function save(id, v) { await store.set(KEY(id), v); return v; }
export function newKey() { const b = new Uint8Array(16); crypto.getRandomValues(b); return [...b].map(x => x.toString(16).padStart(2, "0")).join(""); }
export async function ensureKey(id) { const v = await get(id); if (!v.key) { v.key = newKey(); v.verified = null; await save(id, v); } return v; }
export async function setKeyLocation(id, loc) { const v = await get(id); v.key_location = loc || ""; v.verified = null; return save(id, v); }
async function relay(body) {
  const tok = getSettings().crawlToken;
  let r; try { r = await fetch("/api/indexnow", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", ...(tok ? { "x-crawl-token": tok } : {}) }, body: JSON.stringify(body) }); }
  catch { throw new Error("Couldn't reach the IndexNow function. Check your connection."); }
  const d = await r.json().catch(() => ({}));
  if (r.status === 404 && !d.error) throw new Error("The IndexNow function isn't deployed yet. Push the latest code to GitHub.");
  if (!r.ok) throw new Error(d.error || `IndexNow request failed (${r.status})`);
  return d;
}
export async function verify(id, siteUrl) {
  const v = await ensureKey(id), r = await relay({ op: "verify", site_url: siteUrl, key: v.key, key_location: v.key_location || undefined });
  v.verified = { ok: r.ok, at: Date.now(), message: r.message, url: r.url }; await save(id, v); return v.verified;
}
export async function submit(id, siteUrl, urls) {
  const v = await get(id); if (!v.key) throw new Error("Create the IndexNow key first (Websites → Instant indexing).");
  const r = await relay({ op: "submit", site_url: siteUrl, key: v.key, key_location: v.key_location || undefined, urls });
  v.log = [{ at: Date.now(), count: r.submitted, status: r.status, accepted: r.accepted, message: r.message, urls: urls.slice(0, 5) }, ...(v.log || [])].slice(0, 50);
  if (r.accepted) { v.sent = { ...(v.sent || {}) }; for (const u of urls) v.sent[u] = { at: Date.now(), version: v.sent[u]?.version ?? null }; v.pending = (v.pending || []).filter(p => !urls.includes(p.url)); }
  await save(id, v); return r;
}

// ---- pending list, duplicate skipping and automatic sending ----
// sent: { url: { at, version } } — a page sent in the last 24 hours isn't sent again unless its version (content) changed
const DAY = 864e5;
export async function setAuto(id, on) { const v = await get(id); v.auto = !!on; await save(id, v); return v; }
// add pages to the pending list (reason shown to the user; version = something that changes when the content changes)
export async function queue(id, siteUrl, items) {
  const v = await get(id); if (!v.key) return v;
  let host = ""; try { host = new URL(siteUrl).hostname.replace(/^www\./, ""); } catch { }
  const pend = new Map((v.pending || []).map(p => [p.url, p]));
  for (const it of items) { let h = ""; try { h = new URL(it.url).hostname.replace(/^www\./, ""); } catch { continue; } if (host && h !== host) continue;
    const s = (v.sent || {})[it.url]; if (s && Date.now() - s.at < DAY && (it.version == null || String(s.version) === String(it.version))) continue;
    pend.set(it.url, { url: it.url, reason: it.reason || "", version: it.version ?? null, at: Date.now() }); }
  v.pending = [...pend.values()].slice(-500); await save(id, v);
  if (v.auto && v.verified?.ok && v.pending.length) { clearTimeout(AUTO[id]); AUTO[id] = setTimeout(() => sendPending(id, siteUrl).catch(() => {}), 1500); }   // short wait, so several changes go in one request
  return v;
}
const AUTO = {};
// send every pending page in one request; pages sent in the last 24 hours with the same content are skipped
export async function sendPending(id, siteUrl, { force = false } = {}) {
  const v = await get(id), sent = v.sent || {}, items = v.pending || [];
  const fresh = p => !force && sent[p.url] && Date.now() - sent[p.url].at < DAY && (p.version == null || String(sent[p.url].version) === String(p.version));
  const go = items.filter(p => !fresh(p)), skip = items.length - go.length;
  if (!go.length) { v.pending = []; await save(id, v); return { submitted: 0, skipped: skip, message: skip ? "Everything pending was already sent in the last 24 hours." : "Nothing pending." }; }
  const r = await submit(id, siteUrl, go.map(p => p.url));
  const after = await get(id);
  if (r.accepted) { after.sent = { ...(after.sent || {}) }; for (const p of go) after.sent[p.url] = { at: Date.now(), version: p.version }; after.pending = (after.pending || []).filter(p => !go.some(g => g.url === p.url));
    for (const [u, s] of Object.entries(after.sent)) if (Date.now() - s.at > 30 * DAY) delete after.sent[u]; }
  await save(id, after); return { ...r, skipped: skip };
}
