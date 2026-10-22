// bing.js - Bing Webmaster Tools data (free API key; Bing powers ChatGPT search and Copilot too).
// Fetches through /api/bing, keeps one snapshot per website (shared with the team), and compares with Google data.
import * as store from "./store.js";
import { getSettings } from "./llm.js";
const KEY = id => `bing:${id}`;
export const get = id => store.get(KEY(id), null);
const key = () => (getSettings().bingKey || "").trim();
export const configured = () => !!key();
// Bing dates look like "/Date(1696204800000)/" or "/Date(1696204800000-0700)/"
export const bingDate = s => { const m = String(s || "").match(/\/Date\((-?\d+)/); return m ? new Date(+m[1]).toISOString().slice(0, 10) : String(s || "").slice(0, 10); };
async function call(op, site_url) {
  const tok = getSettings().crawlToken;
  let r; try { r = await fetch("/api/bing", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", ...(tok ? { "x-crawl-token": tok } : {}) }, body: JSON.stringify({ key: key(), op, site_url }) }); }
  catch { throw new Error("Couldn't reach the Bing function. Check your connection."); }
  const d = await r.json().catch(() => ({}));
  if (r.status === 404 && !d.error) throw new Error("The Bing function isn't deployed yet. Push the latest code to GitHub.");
  if (!r.ok) throw new Error(d.error || `Bing request failed (${r.status})`); return d.data;
}
export async function sites() { return ((await call("GetUserSites")) || []).map(s => ({ url: s.Url || s.url, verified: s.IsVerified !== false })); }
export function pickSite(list, siteUrl) {
  let u; try { u = new URL(siteUrl); } catch { return list[0]?.url || ""; }
  const host = u.hostname.replace(/^www\./, "");
  return (list.find(s => s.url.replace(/\/$/, "") === u.origin) || list.find(s => { try { return new URL(s.url).hostname.replace(/^www\./, "") === host; } catch { return false; } }) || {}).url || "";
}
// daily: traffic, searches and pages; crawl stats, crawl errors and the submission allowance change slowly, so at most every 3 days
const HIST = id => `bing-hist:${id}`;
export const history = async id => (await store.get(HIST(id), null)) || {};
export async function refresh(id, bingSite, progress = () => {}, { full = false } = {}) {
  if (!configured()) throw new Error("Add your free Bing Webmaster API key in Settings first.");
  const prev = await get(id), slow = full || !prev || prev.site !== bingSite || Date.now() - (prev.slow_at || 0) > 3 * 864e5;
  progress(slow ? "Getting traffic, searches and crawl data from Bing…" : "Getting traffic and searches from Bing…");
  const [traffic, queries, pages, crawl, issues, quota] = await Promise.all([
    call("GetRankAndTrafficStats", bingSite), call("GetQueryStats", bingSite), call("GetPageStats", bingSite),
    slow ? call("GetCrawlStats", bingSite).catch(() => null) : null, slow ? call("GetCrawlIssues", bingSite).catch(() => null) : null, slow ? call("GetUrlSubmissionQuota", bingSite).catch(() => null) : null]);
  const sumBy = (list, keyF) => { const m = new Map(); for (const x of list || []) { const k = keyF(x); const o = m.get(k) || { clicks: 0, impressions: 0, pos: 0, n: 0 }; o.clicks += x.Clicks || 0; o.impressions += x.Impressions || 0; if (x.AvgImpressionPosition > 0) { o.pos += x.AvgImpressionPosition; o.n++; } m.set(k, o); } return m; };
  const q = [...sumBy(queries, x => x.Query).entries()].map(([k, v]) => ({ query: k, clicks: v.clicks, impressions: v.impressions, position: v.n ? Math.round(10 * v.pos / v.n) / 10 : null })).sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
  const pg = [...sumBy(pages, x => x.Query).entries()].map(([k, v]) => ({ page: k, clicks: v.clicks, impressions: v.impressions })).sort((a, b) => b.clicks - a.clicks);
  const daily = (traffic || []).map(x => ({ date: bingDate(x.Date), clicks: x.Clicks || 0, impressions: x.Impressions || 0 })).sort((a, b) => a.date.localeCompare(b.date));
  const lastCrawl = crawl ? (crawl || []).map(x => ({ date: bingDate(x.Date), crawled: x.CrawledPages || 0, errors: x.CrawlErrors || 0, in_index: x.InIndex || 0, c4xx: x.Code4xx || 0, c5xx: x.Code5xx || 0, robots: x.BlockedByRobotsTxt || 0 })).sort((a, b) => a.date.localeCompare(b.date)).pop() || null : prev?.crawl || null;
  // keep a long history: every day Bing reports is added (up to 2 years)
  const hist = await history(id); for (const d of daily) hist[d.date] = { c: d.clicks, i: d.impressions };
  const cutoff = new Date(Date.now() - 730 * 864e5).toISOString().slice(0, 10); for (const k of Object.keys(hist)) if (k < cutoff) delete hist[k];
  await store.set(HIST(id), hist);
  const snap = { at: Date.now(), site: bingSite, daily, queries: q.slice(0, 200), pages: pg.slice(0, 100), crawl: lastCrawl,
    issues: issues ? issues.slice(0, 100).map(x => ({ url: x.Url, http: x.HttpCode || null, inlinks: x.InLinks || 0 })) : prev?.issues || [],
    quota: quota ? { daily: quota.DailyQuota ?? null, monthly: quota.MonthlyQuota ?? null } : prev?.quota || null,
    slow_at: slow ? Date.now() : prev?.slow_at || 0, history_days: Object.keys(hist).length, requests: slow ? 6 : 3 };
  await store.set(KEY(id), snap); return snap;
}
// monthly totals from the stored history (last 12 months)
export function months(hist) {
  const m = new Map(); for (const [d, v] of Object.entries(hist || {})) { const k = d.slice(0, 7); const o = m.get(k) || { month: k, clicks: 0, impressions: 0, days: 0 }; o.clicks += v.c; o.impressions += v.i; o.days++; m.set(k, o); }
  return [...m.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-12);
}
// pages much stronger on one search engine than the other (share of each engine's clicks, so site size doesn't matter)
export function versusGoogle(bingPages, googleRows) {
  const norm = u => String(u || "").replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "").toLowerCase();
  const g = new Map(); for (const r of googleRows || []) if (r.kind === "page" && r.page) g.set(norm(r.page), (g.get(norm(r.page)) || 0) + (r.clicks || 0));
  const b = new Map(); for (const p of bingPages || []) b.set(norm(p.page), (b.get(norm(p.page)) || 0) + p.clicks);
  const tg = [...g.values()].reduce((a, x) => a + x, 0), tb = [...b.values()].reduce((a, x) => a + x, 0);
  if (!tg || !tb) return { bing_strong: [], google_strong: [], ready: false };
  const rows = [...new Set([...g.keys(), ...b.keys()])].map(k => ({ page: k, google: g.get(k) || 0, bing: b.get(k) || 0, sg: (g.get(k) || 0) / tg, sb: (b.get(k) || 0) / tb }));
  const ratio = (x, y) => (x + 0.002) / (y + 0.002);
  return { ready: true,
    bing_strong: rows.filter(r => r.bing >= 5 && ratio(r.sb, r.sg) >= 3).sort((a, c) => c.sb - a.sb).slice(0, 10),
    google_strong: rows.filter(r => r.google >= 20 && ratio(r.sg, r.sb) >= 3).sort((a, c) => c.sg - a.sg).slice(0, 10) };
}
// the last 28 days against the 28 before (Bing's daily data)
export function period(daily) {
  if (!daily || daily.length < 14) return null;
  const last = daily.slice(-28), prev = daily.slice(-56, -28), sum = (a, k) => a.reduce((t, x) => t + x[k], 0), pct = (a, b) => b ? Math.round(100 * (a - b) / b) : null;
  return { from: last[0].date, to: last[last.length - 1].date, clicks: sum(last, "clicks"), impressions: sum(last, "impressions"),
    clicks_change: prev.length >= 14 ? pct(sum(last, "clicks"), sum(prev, "clicks")) : null, impressions_change: prev.length >= 14 ? pct(sum(last, "impressions"), sum(prev, "impressions")) : null };
}
// searches where Bing sends visitors but Google sends none (Google rows from the latest Search Console data)
export function bingOnly(bingQueries, googleRows) {
  const g = new Map(); for (const r of googleRows || []) if (r.kind === "query" && r.query) g.set(r.query.toLowerCase(), (g.get(r.query.toLowerCase()) || 0) + (r.clicks || 0));
  if (!g.size) return [];
  return bingQueries.filter(q => q.clicks >= 2 && !(g.get(q.query.toLowerCase()) > 0)).slice(0, 15);
}
