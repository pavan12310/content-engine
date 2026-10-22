// ga4.js - Google Analytics 4 in the browser: the connection per website (encrypted Google token, synced with the team), the chosen
// property, a landing-page report (sessions, engaged sessions, key events = conversions, revenue), and opportunities when combined with
// Search Console: pages that convert well but get few Google clicks (promote) and pages with lots of traffic but few conversions (improve).
import * as store from "./store.js";
import { getSettings } from "./llm.js";
const KEY = id => `ga4-conn:${id}`, DATA = id => `ga4:${id}`;
export const get = id => store.get(KEY(id), null);
export const report = id => store.get(DATA(id), null);
const hdr = () => { const t = getSettings().crawlToken; return { "content-type": "application/json", ...(t ? { "x-crawl-token": t } : {}) }; };
async function call(body) {
  const r = await fetch("/api/gsc", { method: "POST", credentials: "same-origin", headers: hdr(), body: JSON.stringify(body) }), d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d.error || `Google Analytics request failed (${r.status})`); e.status = r.status; throw e; } return d;
}
export async function start(siteId) {
  const t = getSettings().crawlToken, r = await fetch(`/api/gsc?op=start&product=ga4&site=${encodeURIComponent(siteId)}&ret=${encodeURIComponent(location.pathname)}${t ? `&ct=${encodeURIComponent(t)}` : ""}`, { credentials: "same-origin", headers: hdr() });
  const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `Couldn't start Google sign-in (${r.status})`);
  location.href = d.url;
}
// the property whose name or account matches the website's address best
export function pickProperty(props, siteUrl) {
  let host = ""; try { host = new URL(siteUrl).hostname.replace(/^www\./, "").toLowerCase(); } catch { }
  const base = host.split(".")[0];
  return (props.find(p => (p.name || "").toLowerCase().includes(host)) || props.find(p => base && `${p.name} ${p.account}`.toLowerCase().includes(base)) || (props.length === 1 ? props[0] : null))?.id || "";
}
export async function handleReturn(siteUrlOf) {
  const h = location.hash;
  if (!h.startsWith("#ga4-connected=")) return null;
  history.replaceState(null, "", location.pathname + location.search);
  let d; try { d = JSON.parse(atob(h.slice(15).replace(/-/g, "+").replace(/_/g, "/"))); } catch { return { error: "The Google Analytics connection didn't come back complete. Try again." }; }
  const id = Number(d.site); if (!id) return { error: "Couldn't tell which website this connection is for." };
  const conn = { token: d.token, properties: d.properties || [], property: pickProperty(d.properties || [], await siteUrlOf(id)), connected_at: d.at || Date.now() };
  await store.set(KEY(id), conn); return { site: id, conn };
}
export async function setProperty(id, property) { const c = await get(id); if (!c) return; c.property = property; await store.set(KEY(id), c); await store.del(DATA(id)); }
export async function disconnect(id) { const c = await get(id); if (c) { try { await call({ op: "revoke", token: c.token }); } catch { } } await store.del(KEY(id)); await store.del(DATA(id)); }
// the key events this property records, so one can be chosen (e.g. only "purchase" or "sign_up")
export async function events(id) { const c = await get(id); if (!c || !c.property) return []; const r = await call({ op: "ga4events", token: c.token, property: c.property }); c.events = r.events; await store.set(KEY(id), c); return r.events; }
export async function setEvent(id, ev) { const c = await get(id); if (!c) return; c.event = ev || ""; await store.set(KEY(id), c); }
export const sumRows = rows => rows.reduce((t, x) => ({ sessions: t.sessions + x.sessions, engaged: t.engaged + (x.engaged || 0), conversions: t.conversions + x.conversions, revenue: t.revenue + (x.revenue || 0) }), { sessions: 0, engaged: 0, conversions: 0, revenue: 0 });
export async function refresh(id, { days = 28, organic = true } = {}) {
  const c = await get(id); if (!c || !c.property) throw new Error("Connect Google Analytics and choose the property first.");
  const r = await call({ op: "ga4report", token: c.token, property: c.property, days, organic, event: c.event || "" });
  const rows = r.rows.filter(x => x.sessions || x.prev.sessions).sort((a, b) => b.sessions - a.sessions).slice(0, 1000);
  const snap = { at: Date.now(), days, organic, event: r.event || "", property: c.property, rows, totals: sumRows(rows), prev_totals: sumRows(rows.map(x => ({ ...x.prev, engaged: 0 }))), ai: r.ai || [], conv_metric: r.conv_metric, currency: r.currency };
  await store.set(DATA(id), snap); return snap;
}
export const change = (now, before) => before ? Math.round(100 * (now - before) / before) : null;
const pathOf = u => { try { const x = new URL(u); return (x.pathname.replace(/\/$/, "") || "/"); } catch { return (String(u || "").split("?")[0].replace(/\/$/, "") || "/"); } };
// pages ranked by conversions, joined with Google clicks; plus the two kinds of opportunity
export function analyse(snap, gscRows = []) {
  if (!snap) return null;
  const clicks = new Map(); for (const r of gscRows) if (r.kind === "page" && r.page) clicks.set(pathOf(r.page), (clicks.get(pathOf(r.page)) || 0) + (r.clicks || 0));
  const by = new Map(); for (const r of snap.rows) { const k = pathOf(r.path); const o = by.get(k) || { path: k, sessions: 0, engaged: 0, conversions: 0, revenue: 0, prev_sessions: 0, prev_conversions: 0 }; o.sessions += r.sessions; o.engaged += r.engaged; o.conversions += r.conversions; o.revenue += r.revenue; o.prev_sessions += r.prev?.sessions || 0; o.prev_conversions += r.prev?.conversions || 0; by.set(k, o); }
  const pages = [...by.values()].map(p => ({ ...p, rate: p.sessions ? p.conversions / p.sessions : 0, engagement: p.sessions ? p.engaged / p.sessions : 0, google_clicks: clicks.get(p.path) ?? null }));
  const avg = snap.totals.sessions ? snap.totals.conversions / snap.totals.sessions : 0;
  const sessSorted = pages.map(p => p.sessions).sort((a, b) => a - b), q = f => sessSorted[Math.floor(f * (sessSorted.length - 1))] || 0;
  const promote = avg ? pages.filter(p => p.conversions >= 3 && p.rate >= avg * 1.5 && p.sessions <= q(0.5)).sort((a, b) => b.rate - a.rate).slice(0, 10) : [];
  const improve = avg ? pages.filter(p => p.sessions >= Math.max(q(0.75), 50) && p.rate <= avg * 0.5).sort((a, b) => b.sessions - a.sessions).slice(0, 10) : [];
  // the biggest changes in conversions against the previous period (pages with enough data either way)
  const moved = pages.filter(p => Math.max(p.conversions, p.prev_conversions) >= 5).map(p => ({ ...p, delta: p.conversions - p.prev_conversions })).filter(p => Math.abs(p.delta) >= Math.max(3, 0.25 * Math.max(p.conversions, p.prev_conversions)));
  return { pages: pages.sort((a, b) => b.conversions - a.conversions || b.sessions - a.sessions), avg_rate: avg, promote, improve,
    fell: moved.filter(p => p.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 6), rose: moved.filter(p => p.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 6) };
}

// a page's own figures (for My pages)
export function pageStats(snap, url) { if (!snap || !url) return null; const k = pathOf(url); const rows = snap.rows.filter(r => pathOf(r.path) === k); if (!rows.length) return null; const t = sumRows(rows); return { ...t, prev_conversions: rows.reduce((a, r) => a + (r.prev?.conversions || 0), 0), days: snap.days }; }
