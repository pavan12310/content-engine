// wayback.js - page history from the Internet Archive (through /api/wayback): the list of distinct archived versions,
// reading a version with the same page reader used for live pages, comparing two versions, and recovering old text.
import { getSettings } from "./llm.js";
import * as store from "./store.js";
import { extract, mainContent } from "./crawler.js";
import { htmlToMarkdown } from "./md.js";
async function call(body) {
  const tok = getSettings().crawlToken;
  let r; try { r = await fetch("/api/wayback", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", ...(tok ? { "x-crawl-token": tok } : {}) }, body: JSON.stringify(body) }); }
  catch { throw new Error("Couldn't reach the page history function. Check your connection."); }
  const d = await r.json().catch(() => ({}));
  if (r.status === 404 && !d.error) throw new Error("The page history function isn't deployed yet. Push the latest code to GitHub.");
  if (!r.ok) throw new Error(d.error || `Page history request failed (${r.status})`); return d;
}
export const tsDate = ts => `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
// archived versions never change: each one read is kept in this browser (not synced; the 60 most recent kept), lists for 24 hours
const CACHE = new Map(), CINDEX = "wbcache-index";
async function cacheGet(k) { if (CACHE.has(k)) return CACHE.get(k); const v = await store.get(`wbcache:${k}`, null); if (v) CACHE.set(k, v); return v; }
async function cachePut(k, v) {
  CACHE.set(k, v); await store.set(`wbcache:${k}`, v);
  const idx = ((await store.get(CINDEX, [])) || []).filter(x => x !== k); idx.push(k);
  while (idx.length > 60) { const old = idx.shift(); CACHE.delete(old); await store.del(`wbcache:${old}`); }
  await store.set(CINDEX, idx);
}
export async function history(url) {
  const k = `h|${url}`, c = await cacheGet(k); if (c && Date.now() - c.at < 864e5) return { ...c.data, cached: true };
  const d = await call({ op: "history", url }); await cachePut(k, { at: Date.now(), data: d }); return d;
}
// one archived version, read like a live page: facts, headings, the main text as Markdown, and its sentences
export async function version(url, timestamp) {
  const k = `${url}|${timestamp}`, cached = await cacheGet(k); if (cached) return cached;
  const d = await call({ op: "snapshot", url, timestamp });
  const host = new URL(url).host, facts = extract(url, d.html, host);
  const doc = new DOMParser().parseFromString(d.html, "text/html"), main = mainContent(doc);
  const markdown = htmlToMarkdown(main.innerHTML || "").trim();
  const text = (main.textContent || "").replace(/\s+/g, " ").trim();
  const v = { url, timestamp, date: tsDate(timestamp), archive_url: d.archive_url, title: facts.title || "", meta_description: facts.meta_description || "", h1: facts.h1 || [], h2: facts.h2 || [],
    word_count: facts.word_count || 0, links: (facts.internal_links || []).length, markdown, sentences: text.split(/(?<=[.!?。！？])\s+/).map(s => s.trim()).filter(s => s.split(" ").length >= 6) };
  v.markdown = v.markdown.slice(0, 60000); v.sentences = v.sentences.slice(0, 400);
  await cachePut(k, v); return v;
}
// what changed between an older and a newer version
export function compare(older, newer) {
  const setOf = a => new Set(a.map(x => x.toLowerCase().replace(/\s+/g, " ").trim()));
  const h2o = setOf(older.h2), h2n = setOf(newer.h2), so = setOf(older.sentences), sn = setOf(newer.sentences);
  return {
    title: older.title !== newer.title ? { before: older.title, after: newer.title } : null,
    meta: older.meta_description !== newer.meta_description ? { before: older.meta_description, after: newer.meta_description } : null,
    h1: (older.h1[0] || "") !== (newer.h1[0] || "") ? { before: older.h1[0] || "", after: newer.h1[0] || "" } : null,
    words: { before: older.word_count, after: newer.word_count, change: older.word_count ? Math.round(100 * (newer.word_count - older.word_count) / older.word_count) : null },
    links: { before: older.links, after: newer.links },
    headings_added: newer.h2.filter(h => !h2o.has(h.toLowerCase().replace(/\s+/g, " ").trim())),
    headings_removed: older.h2.filter(h => !h2n.has(h.toLowerCase().replace(/\s+/g, " ").trim())),
    sentences_added: newer.sentences.filter(s => !so.has(s.toLowerCase().replace(/\s+/g, " ").trim())).slice(0, 12),
    sentences_removed: older.sentences.filter(s => !sn.has(s.toLowerCase().replace(/\s+/g, " ").trim())).slice(0, 12),
  };
}

// the versions either side of a traffic drop: the last one before the month the drop began, and the first one from that month on
export function aroundDrop(versions, dropMonthStart) {
  const d = String(dropMonthStart || "").replace(/-/g, "").slice(0, 8); if (!d) return null;
  const asc = [...versions].filter(v => !v.status || v.status < 400).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const before = [...asc].reverse().find(v => v.timestamp.slice(0, 8) < d), after = asc.find(v => v.timestamp.slice(0, 8) >= d) || asc[asc.length - 1];
  return before && after && before.timestamp !== after.timestamp ? { before, after } : null;
}
// up to n versions spread evenly over the history (always including the newest), for the title and heading timeline
export function spread(versions, n = 12) {
  const asc = [...versions].filter(v => !v.status || v.status < 400).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  if (asc.length <= n) return asc;
  const out = []; for (let i = 0; i < n; i++) out.push(asc[Math.round(i * (asc.length - 1) / (n - 1))]);
  return [...new Map(out.map(v => [v.timestamp, v])).values()];
}
export async function timeline(url, versions, { n = 12, progress = () => {} } = {}) {
  const pick = spread(versions, n), rows = []; let i = 0, done = 0;
  const worker = async () => { while (i < pick.length) { const v = pick[i++]; try { const x = await version(url, v.timestamp); rows.push({ timestamp: v.timestamp, date: x.date, title: x.title, h1: x.h1[0] || "", words: x.word_count, sections: x.h2.length }); } catch { } progress(`Read ${++done} of ${pick.length} versions…`); } };
  await Promise.all([worker(), worker()]);
  rows.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  rows.forEach((r, k) => { const p = rows[k - 1]; r.changed = p ? { title: p.title !== r.title, h1: p.h1 !== r.h1, words: p.words ? Math.abs(r.words - p.words) / p.words >= 0.2 : false, sections: p.sections !== r.sections } : {}; });
  return rows;
}
