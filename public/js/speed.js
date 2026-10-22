// speed.js - page speed and Core Web Vitals from Google's free PageSpeed Insights API, called straight from the browser
// (each test runs 10-30 s on Google's side, longer than a free Netlify function may run). A free Google API key raises the
// limit to about 25,000 tests a day; without one Google's shared quota is small.
// Two kinds of data per page: real visitors (Chrome UX Report, last 28 days) and a lab test with specific fixes.
import * as store from "./store.js";
import { getSettings } from "./llm.js";

const KEY = id => `speed:${id}`;
const API = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
// Google's official Core Web Vitals thresholds: good up to the first number, poor above the second
export const THRESHOLDS = { lcp: [2500, 4000], inp: [200, 500], cls: [0.1, 0.25], fcp: [1800, 3000], ttfb: [800, 1800] };
export const rate = (metric, v) => v == null || !THRESHOLDS[metric] ? null : v <= THRESHOLDS[metric][0] ? "good" : v <= THRESHOLDS[metric][1] ? "needs_work" : "poor";
export const get = id => store.get(KEY(id), null);
const clean = t => String(t || "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/`/g, "").trim();

function errorText(status, d) {
  const msg = d?.error?.message || "";
  if (status === 429) return "Google's free limit for speed tests was reached. Add a free Google API key in Settings (about 25,000 tests a day), or try again in a few minutes.";
  if (status === 403 || /API key not valid|has not been used|disabled/i.test(msg)) return "Google rejected the API key, or the PageSpeed Insights API isn't enabled for it (see “Free Google tools” in Settings).";
  if (/NO_FCP|FAILED_DOCUMENT_REQUEST|ERRORED_DOCUMENT_REQUEST|DNS_FAILURE|NOT_HTML|NO_NAVSTART|PAGE_HUNG/i.test(msg)) return `Google couldn't load this page to test it (${(msg.match(/\b[A-Z_]{6,}\b/) || ["error"])[0]}).`;
  return `Speed test failed (${status}${msg ? `: ${clean(msg).slice(0, 140)}` : ""}).`;
}
// read Google's answer into what the tool shows
export function parse(d, url) {
  const lh = d.lighthouseResult || {}, a = lh.audits || {}, le = d.loadingExperience || {}, ole = d.originLoadingExperience || {};
  const fieldOf = src => src && src.metrics ? { lcp: src.metrics.LARGEST_CONTENTFUL_PAINT_MS?.percentile ?? null, inp: src.metrics.INTERACTION_TO_NEXT_PAINT?.percentile ?? null,
    cls: src.metrics.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile != null ? src.metrics.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100 : null,
    fcp: src.metrics.FIRST_CONTENTFUL_PAINT_MS?.percentile ?? null, ttfb: src.metrics.EXPERIMENTAL_TIME_TO_FIRST_BYTE?.percentile ?? null, category: src.overall_category || null } : null;
  const num = k => a[k] && Number.isFinite(a[k].numericValue) ? a[k].numericValue : null;
  const opportunities = Object.entries(a).filter(([, x]) => x.details && x.details.type === "opportunity" && (x.numericValue || 0) >= 100 && (x.score ?? 1) < 0.9)
    .map(([id, x]) => ({ id, title: clean(x.title), savings_ms: Math.round(x.numericValue), how: clean(x.description).split(". ").slice(0, 2).join(". ") }))
    .sort((p, q) => q.savings_ms - p.savings_ms).slice(0, 6);
  const fieldPage = le.metrics && !le.origin_fallback ? fieldOf(le) : null;
  return { url, final_url: lh.finalDisplayedUrl || lh.finalUrl || url, at: Date.now(),
    score: lh.categories?.performance?.score != null ? Math.round(lh.categories.performance.score * 100) : null,
    lab: { lcp: num("largest-contentful-paint"), tbt: num("total-blocking-time"), cls: num("cumulative-layout-shift"), fcp: num("first-contentful-paint"), si: num("speed-index") },
    field: fieldPage, field_site: fieldOf(ole), opportunities };
}
export async function test(url, strategy = "mobile", signal = null) {
  const key = (getSettings().googleKey || "").trim();
  const q = new URLSearchParams({ url, strategy, category: "performance" }); if (key) q.set("key", key);
  let r; try { r = await fetch(`${API}?${q}`, { signal }); } catch (e) { if (e.name === "AbortError") throw e; throw new Error("Couldn't reach Google's speed test. Check your connection."); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(errorText(r.status, d));
  return parse(d, url);
}
// ---- real-visitor quick check: Chrome UX Report API (needs the free Google key; under a second per page) ----
const CRUX = "https://chromeuxreport.googleapis.com/v1/records:queryRecord";
const p75 = (m, k) => { const v = m?.[k]?.percentiles?.p75; return v == null ? null : Number(v); };
export async function crux(target, strategy = "mobile", signal = null) {
  const key = (getSettings().googleKey || "").trim(); if (!key) throw new Error("The quick check needs a free Google API key with the Chrome UX Report API enabled (Settings → Google & Bing).");
  const body = { ...(target.origin ? { origin: target.origin } : { url: target.url }), formFactor: strategy === "desktop" ? "DESKTOP" : "PHONE",
    metrics: ["largest_contentful_paint", "interaction_to_next_paint", "cumulative_layout_shift", "first_contentful_paint", "experimental_time_to_first_byte"] };
  let r; try { r = await fetch(`${CRUX}?key=${encodeURIComponent(key)}`, { method: "POST", signal, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }
  catch (e) { if (e.name === "AbortError") throw e; throw new Error("Couldn't reach Google's Chrome UX Report."); }
  if (r.status === 404) return null;   // not enough real visitors for this page
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(r.status === 403 || r.status === 400 ? "Google rejected the key for the Chrome UX Report API: enable that API for your key in Google Cloud (Settings → Google & Bing)." : r.status === 429 ? "Google's limit for quick checks was reached; try again in a minute." : `Chrome UX Report error ${r.status}`);
  const m = d.record?.metrics || {}, f = { lcp: p75(m, "largest_contentful_paint"), inp: p75(m, "interaction_to_next_paint"), cls: p75(m, "cumulative_layout_shift"), fcp: p75(m, "first_contentful_paint"), ttfb: p75(m, "experimental_time_to_first_byte") };
  f.category = ["lcp", "inp", "cls"].every(k => f[k] == null || rate(k, f[k]) === "good") ? "FAST" : ["lcp", "inp", "cls"].some(k => rate(k, f[k]) === "poor") ? "SLOW" : "AVERAGE";
  return f;
}
const histOf = (p, score) => [...(p?.history || []), ...(score != null ? [{ at: Date.now(), score }] : [])].slice(-8);
// real-visitor numbers for many pages in seconds (no lab test, no fixes); keeps any earlier lab results
export async function quick(id, urls, { strategy = "mobile", progress = () => {}, signal = null } = {}) {
  const prev = (await get(id)) || { pages: [], site: {} }, by = new Map((prev.pages || []).filter(p => p.strategy === strategy).map(p => [p.url, p]));
  const origin = new URL(urls[0]).origin, out = [], errors = []; let i = 0, done = 0;
  const site = await crux({ origin }, strategy, signal).catch(e => { if (/key|rejected/.test(e.message)) throw e; return null; });
  const worker = async () => { while (i < urls.length) { if (signal?.aborted) return; const url = urls[i++];
    try { const f = await crux({ url }, strategy, signal), old = by.get(url) || {}; out.push({ ...old, url, strategy, field: f, field_at: Date.now(), quick: !old.score, at: old.at || Date.now(), opportunities: old.opportunities || [], lab: old.lab || {} }); }
    catch (e) { if (e.name === "AbortError") return; errors.push({ url, error: e.message }); }
    progress(`Checked ${++done} of ${urls.length} pages…`); } };
  await Promise.all(Array.from({ length: 6 }, worker));
  const keep = (prev.pages || []).filter(p => p.strategy !== strategy || !out.some(o => o.url === p.url));
  const saved = { ...prev, at: Date.now(), strategy, pages: [...out, ...keep].slice(0, 200), site: { ...(prev.site || {}), [strategy]: site || prev.site?.[strategy] || null }, errors, quick_at: Date.now() };
  await store.set(KEY(id), saved); return saved;
}
// full tests (lab score and fixes), three at a time; pages fully tested in the last 24 hours are reused unless force
export async function run(id, urls, { strategy = "mobile", progress = () => {}, signal = null, force = false } = {}) {
  const prev = (await get(id)) || { pages: [] }, prevBy = new Map((prev.pages || []).filter(p => p.strategy === strategy).map(p => [p.url, p]));
  const fresh = u => { const p = prevBy.get(u); return !force && p && p.score != null && Date.now() - (p.at || 0) < 864e5; };
  const todo = urls.filter(u => !fresh(u)), reused = urls.length - todo.length;
  const out = [], errors = []; let i = 0, done = 0;
  const worker = async () => { while (i < todo.length) { if (signal?.aborted) return; const url = todo[i++];
    try { const r = await test(url, strategy, signal), old = prevBy.get(url); r.strategy = strategy; r.prev_score = old?.score ?? null; r.history = histOf(old, r.score); if (!r.field && old?.field) { r.field = old.field; r.field_at = old.field_at; } out.push(r); }
    catch (e) { if (e.name === "AbortError") return; errors.push({ url, error: e.message }); if (/free limit|rejected the API key/.test(e.message)) { i = todo.length; } }
    progress(`Tested ${++done} of ${todo.length} pages${reused ? ` (${reused} tested in the last 24 hours, reused)` : ""}; each test takes 10-30 seconds on Google's side…`); } };
  await Promise.all([worker(), worker(), worker()]);
  const keep = (prev.pages || []).filter(p => p.strategy !== strategy || !out.some(o => o.url === p.url));
  const site = out.find(o => o.field_site)?.field_site || prev.site?.[strategy] || null;
  const saved = { ...prev, at: Date.now(), strategy, pages: [...out, ...keep].slice(0, 200), site: { ...(prev.site || {}), [strategy]: site }, errors, reused };
  await store.set(KEY(id), saved);
  return saved;
}
// the same fix across many pages, once: how many pages it helps and the total time it saves
export function topFixes(pages) {
  const m = new Map();
  for (const p of pages) for (const o of p.opportunities || []) { const x = m.get(o.id) || { id: o.id, title: o.title, how: o.how, pages: 0, savings_ms: 0 }; x.pages++; x.savings_ms += o.savings_ms; m.set(o.id, x); }
  return [...m.values()].sort((a, b) => b.pages - a.pages || b.savings_ms - a.savings_ms);
}
