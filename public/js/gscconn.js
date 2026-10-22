// gscconn.js - Search Console connection in the browser. Keeps only the encrypted Google token (per website, synced with
// the team like other data), picks the right property, and imports the last 90 days plus the 90 days before for comparison.
import * as store from "./store.js";
import { getSettings } from "./llm.js";
const KEY = id => `gsc-conn:${id}`;
export const get = id => store.get(KEY(id), null);
let STATUS = null;
export async function status() { if (STATUS) return STATUS; try { const r = await fetch("/api/gsc?op=status"); STATUS = r.ok ? await r.json() : { configured: false, missing: r.status === 404 }; } catch { STATUS = { configured: false }; } return STATUS; }
const hdr = () => { const t = getSettings().crawlToken; return { "content-type": "application/json", ...(t ? { "x-crawl-token": t } : {}) }; };
async function call(body) {
  const r = await fetch("/api/gsc", { method: "POST", credentials: "same-origin", headers: hdr(), body: JSON.stringify(body) }), d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d.error || `Search Console request failed (${r.status})`); e.status = r.status; throw e; } return d;
}
export async function start(siteId) {
  const t = getSettings().crawlToken, r = await fetch(`/api/gsc?op=start&site=${encodeURIComponent(siteId)}&ret=${encodeURIComponent(location.pathname)}${t ? `&ct=${encodeURIComponent(t)}` : ""}`, { credentials: "same-origin", headers: hdr() });
  const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `Couldn't start Google sign-in (${r.status})`);
  location.href = d.url;
}
// the right property for a website: an exact URL-prefix property first, then the domain property
export function pickProperty(sites, siteUrl) {
  let u; try { u = new URL(siteUrl); } catch { return sites[0] || ""; }
  const origin = u.origin + "/", host = u.hostname.replace(/^www\./, "");
  return sites.find(s => s === origin) || sites.find(s => s === `sc-domain:${host}`) || sites.find(s => s.includes(host)) || "";
}
// after Google sends us back: save the connection (the token is encrypted; only the server can use it)
export async function handleReturn(siteUrlOf) {
  const h = location.hash;
  if (h.startsWith("#gsc-error=")) { history.replaceState(null, "", location.pathname + location.search); return { error: decodeURIComponent(h.slice(11)) }; }
  if (!h.startsWith("#gsc-connected=")) return null;
  history.replaceState(null, "", location.pathname + location.search);
  let d; try { d = JSON.parse(atob(h.slice(15).replace(/-/g, "+").replace(/_/g, "/"))); } catch { return { error: "The Google connection didn't come back complete. Try again." }; }
  const id = Number(d.site); if (!id) return { error: "Couldn't tell which website this connection is for." };
  const siteUrl = await siteUrlOf(id);
  const conn = { token: d.token, sites: d.sites || [], property: pickProperty(d.sites || [], siteUrl), connected_at: d.at || Date.now(), last_refresh: 0 };
  await store.set(KEY(id), conn); return { site: id, conn };
}
export async function setProperty(id, property) { const c = await get(id); if (!c) return; c.property = property; c.last_refresh = 0; await store.set(KEY(id), c); }
export async function reloadSites(id) { const c = await get(id); if (!c) return []; const r = await call({ op: "sites", token: c.token }); c.sites = r.sites; await store.set(KEY(id), c); return r.sites; }
export async function disconnect(id) { const c = await get(id); if (c) { try { await call({ op: "revoke", token: c.token }); } catch { } } await store.del(KEY(id)); }

const iso = d => d.toISOString().slice(0, 10), DAY = 864e5;
const title = s => String(s || "").toLowerCase().replace(/^\w/, c => c.toUpperCase());
function toRows(kind, list) {
  return list.map(r => { const k = r.keys || [];
    return { kind, query: kind === "query" || kind === "query_page" ? k[0] : "", page: kind === "page" ? k[0] : kind === "query_page" ? k[1] : "",
      dim: kind === "date" ? k[0] : kind === "device" ? title(k[0]) : kind === "country" ? String(k[0] || "").toUpperCase() : "",
      clicks: r.clicks || 0, impressions: r.impressions || 0, ctr: Math.round((r.ctr || 0) * 10000) / 100, position: Math.round((r.position || 0) * 10) / 10 }; });
}
async function fetchKind(conn, kind, dims, from, to, cap = 25000) {
  const out = []; let startRow = 0;
  while (out.length < cap) {
    const r = await call({ op: "query", token: conn.token, property: conn.property, query: { startDate: from, endDate: to, dimensions: dims, rowLimit: 25000, startRow } });
    out.push(...r.rows); if (r.rows.length < 25000) break; startRow += 25000;
  }
  return toRows(kind, out.slice(0, cap));
}
// import fresh data: the last 90 days (Search Console data is final ~3 days later) and the 90 days before, for comparison
export async function refresh(id, progress = () => {}) {
  const conn = await get(id); if (!conn) throw new Error("Connect Search Console first.");
  if (!conn.property) throw new Error("Choose which Search Console property belongs to this website.");
  const end = new Date(Date.now() - 3 * DAY), start = new Date(end.getTime() - 89 * DAY), pEnd = new Date(start.getTime() - DAY), pStart = new Date(pEnd.getTime() - 89 * DAY);
  const cur = [], prev = [];
  const plan = [["date", ["date"], 1e4], ["query", ["query"], 5e4], ["page", ["page"], 5e4], ["device", ["device"], 10], ["country", ["country"], 300], ["query_page", ["query", "page"], 1e5]];
  for (const [i, [kind, dims, cap]] of plan.entries()) { progress(`Getting ${kind.replace("_", " + ")} data from Google (${i + 1}/${plan.length + 3})…`); cur.push(...await fetchKind(conn, kind, dims, iso(start), iso(end), cap)); }
  for (const [i, [kind, dims, cap]] of plan.slice(0, 3).entries()) { progress(`Getting the earlier period for comparison (${plan.length + i + 1}/${plan.length + 3})…`); prev.push(...await fetchKind(conn, kind, dims, iso(pStart), iso(pEnd), cap)); }
  conn.last_refresh = Date.now(); conn.range = { from: iso(start), to: iso(end) }; await store.set(KEY(id), conn);
  return { cur, prev, range: conn.range, prevRange: { from: iso(pStart), to: iso(pEnd) } };
}
// the last 14 days of daily data, and searches for the last 7 days and the 7 before (for the weekly check)
export async function weekData(id) {
  const conn = await get(id); if (!conn || !conn.property) return null;
  const end = new Date(Date.now() - 3 * DAY), mid = new Date(end.getTime() - 7 * DAY), start = new Date(end.getTime() - 13 * DAY);
  const q = (dims, from, to, rowLimit) => call({ op: "query", token: conn.token, property: conn.property, query: { startDate: from, endDate: to, dimensions: dims, rowLimit } }).then(r => r.rows);
  const [dates, queryNow, queryBefore] = await Promise.all([q(["date"], iso(start), iso(end), 100), q(["query"], iso(new Date(mid.getTime() + DAY)), iso(end), 1000), q(["query"], iso(start), iso(mid), 1000)]);
  return { dates, queryNow, queryBefore };
}
// URL Inspection for one page (through the site's /api/gsc function, using the encrypted connection)
export async function inspect(id, url) {
  const conn = await get(id); if (!conn || !conn.property) throw new Error("Connect Search Console and choose the property first (Performance screen).");
  const r = await call({ op: "inspect", token: conn.token, property: conn.property, url }); return r.result;
}
// one Search Console query for a date range (optionally filtered to one page), used by content decay
export async function queryRange(id, dims, from, to, { page = "", rowLimit = 5000, queryRegex = "" } = {}) {
  const conn = await get(id); if (!conn || !conn.property) throw new Error("Connect Search Console and choose the property first (Performance screen).");
  const r = await call({ op: "query", token: conn.token, property: conn.property, query: { startDate: from, endDate: to, dimensions: dims, rowLimit, ...(page ? { page } : {}), ...(queryRegex ? { queryRegex } : {}) } });
  return r.rows || [];
}

// the sitemaps Google has for this property (read-only)
export async function sitemaps(id) { const c = await get(id); if (!c || !c.property) return null; return (await call({ op: "sitemaps", token: c.token, property: c.property })).sitemaps; }
