// kwdata.js - keyword demand and ideas, free: Bing's own search numbers for any keyword (Bing Webmaster API key), and the real
// searches people type from Google, Bing and YouTube autocomplete. Everything is cached (volumes 30 days, suggestions 7 days).
import * as store from "./store.js";
import { getSettings } from "./llm.js";
import { bingDate } from "./bing.js";

const DAY = 864e5;
export const bingReady = () => !!(getSettings().bingKey || "").trim();
// which market to research: remembered per browser
export function market() { try { return { country: "us", language: "en-US", ...(JSON.parse(localStorage.getItem("ce-kw-market") || "{}")) }; } catch { return { country: "us", language: "en-US" }; } }
export const setMarket = m => { try { localStorage.setItem("ce-kw-market", JSON.stringify(m)); } catch { } };
export const MARKETS = [["us", "en-US", "United States"], ["in", "en-IN", "India"], ["gb", "en-GB", "United Kingdom"], ["ca", "en-CA", "Canada"], ["au", "en-AU", "Australia"],
  ["de", "de-DE", "Germany"], ["fr", "fr-FR", "France"], ["es", "es-ES", "Spain"], ["br", "pt-BR", "Brazil"], ["jp", "ja-JP", "Japan"]];

async function relay(path, body) {
  const tok = getSettings().crawlToken;
  let r; try { r = await fetch(path, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", ...(tok ? { "x-crawl-token": tok } : {}) }, body: JSON.stringify(body) }); }
  catch { throw new Error("Couldn't reach the keyword function. Check your connection."); }
  const d = await r.json().catch(() => ({}));
  if (r.status === 404 && !d.error) throw new Error("The keyword function isn't deployed yet. Push the latest code to GitHub.");
  if (!r.ok) throw new Error(d.error || `Keyword request failed (${r.status})`);
  return d;
}
const bing = (op, extra) => relay("/api/bing", { key: (getSettings().bingKey || "").trim(), op, ...extra }).then(d => d.data);
const ymd = t => new Date(t).toISOString().slice(0, 10);
// demand level from Bing's monthly searches (Bing's share is smaller than Google's, so these are deliberately modest thresholds)
export const level = n => n == null ? "" : n >= 5000 ? "high" : n >= 500 ? "medium" : n >= 50 ? "low" : "very low";

// monthly searches on Bing, and the trend (last 12 weeks against the 12 before), from the weekly history
export async function volume(keyword, m = market(), { fresh = false } = {}) {
  const kw = String(keyword || "").trim().toLowerCase(), ck = `kwvol:${m.country}:${kw}`;
  const hit = fresh ? null : await store.get(ck, null); if (hit && Date.now() - hit.at < 30 * DAY) return hit;
  const rows = (await bing("GetKeywordStats", { q: kw, country: m.country, language: m.language }) || []).map(r => ({ date: bingDate(r.Date), exact: r.Impressions || 0, broad: r.BroadImpressions || 0 })).sort((a, b) => a.date < b.date ? -1 : 1);
  const last = rows.slice(-4), monthly = last.length ? Math.round(last.reduce((a, r) => a + r.exact, 0) * (30 / (7 * last.length))) : 0;
  const broad = last.length ? Math.round(last.reduce((a, r) => a + r.broad, 0) * (30 / (7 * last.length))) : 0;
  const sum = a => a.reduce((x, r) => x + r.exact, 0), a12 = rows.slice(-12), b12 = rows.slice(-24, -12);
  const trend = b12.length >= 8 && sum(b12) > 0 ? Math.round((sum(a12) / sum(b12) - 1) * 100) : null;
  // the busiest month in the history, for seasonal topics
  const byMonth = {}; rows.forEach(r => { const k = r.date.slice(5, 7); byMonth[k] = (byMonth[k] || 0) + r.exact; });
  const peak = Object.entries(byMonth).sort((a, b) => b[1] - a[1])[0];
  const v = { keyword: kw, monthly, broad, trend, peak_month: peak && rows.length >= 26 ? +peak[0] : null, weeks: rows.slice(-26).map(r => r.exact), level: level(monthly), at: Date.now(), market: m.country };
  await store.set(ck, v); return v;
}
// volumes for many keywords, one at a time with a short pause (Bing limits requests); stops politely on its limit
export async function volumes(keywords, progress = () => {}, m = market()) {
  const out = {}, list = [...new Set(keywords.map(k => String(k).trim().toLowerCase()).filter(Boolean))];
  for (let i = 0; i < list.length; i++) {
    progress(`Getting search numbers from Bing (${i + 1} of ${list.length})…`);
    try { const cached = await store.get(`kwvol:${m.country}:${list[i]}`, null); out[list[i]] = await volume(list[i], m); if (!cached || Date.now() - cached.at >= 30 * DAY) await new Promise(r => setTimeout(r, 250)); }
    catch (e) { if (/limit/i.test(e.message)) { out._stopped = e.message; break; } out[list[i]] = { error: e.message }; }
  }
  return out;
}
// related searches on Bing with their numbers (last 30 days)
export async function related(keyword, m = market()) {
  const kw = String(keyword || "").trim().toLowerCase(), ck = `kwrel:${m.country}:${kw}`, hit = await store.get(ck, null);
  if (hit && Date.now() - hit.at < 30 * DAY) return hit.rows;
  const end = Date.now() - 2 * DAY, rows = (await bing("GetRelatedKeywords", { q: kw, country: m.country, language: m.language, startDate: ymd(end - 30 * DAY), endDate: ymd(end) }) || [])
    .map(r => ({ keyword: String(r.Query || "").toLowerCase(), monthly: r.Impressions || 0, broad: r.BroadImpressions || 0 })).filter(r => r.keyword && r.keyword !== kw).sort((a, b) => b.monthly - a.monthly).slice(0, 50);
  await store.set(ck, { at: Date.now(), rows }); return rows;
}
// real searches people type: the keyword itself, a-z after it, and question words before it
const QUESTIONS = ["how", "what", "why", "best", "can", "is", "vs", "free", "for"];
export async function suggestions(keyword, { sources = ["google", "bing"], expand = "questions", m = market() } = {}, progress = () => {}) {
  const kw = String(keyword || "").trim().toLowerCase(), ck = `kwsug:${m.country}:${sources.join(",")}:${expand}:${kw}`, hit = await store.get(ck, null);
  if (hit && Date.now() - hit.at < 7 * DAY) return hit.r;
  const qs = [kw, ...(expand === "az" ? "abcdefghijklmnopqrstuvwxyz".split("").map(c => `${kw} ${c}`) : expand === "questions" ? QUESTIONS.map(w => w === "vs" || w === "for" || w === "free" ? `${kw} ${w}` : `${w} ${kw}`) : [])];
  progress(`Collecting real searches from ${sources.join(", ")}…`);
  const d = await relay("/api/suggest", { queries: qs, sources, hl: m.language.slice(0, 2), gl: m.country });
  const seen = new Map();
  for (const src of sources) for (const [q, list] of Object.entries(d.results?.[src] || {})) for (const s of list) {
    const k = s.toLowerCase(); if (k === kw) continue; const e = seen.get(k) || { keyword: k, sources: new Set(), from: q }; e.sources.add(src); seen.set(k, e);
  }
  const groups = { questions: [], comparisons: [], other: [] };
  for (const e of seen.values()) { const x = { keyword: e.keyword, sources: [...e.sources] };
    (/^(how|what|why|when|where|which|who|can|is|are|does|do|should)\b/.test(e.keyword) ? groups.questions : /\b(vs|versus|alternative|alternatives|compared|or)\b/.test(e.keyword) ? groups.comparisons : groups.other).push(x); }
  for (const g of Object.values(groups)) g.sort((a, b) => b.sources.length - a.sources.length || a.keyword.length - b.keyword.length);
  const r = { ...groups, total: seen.size, blocked: d.blocked || [], incomplete: !!d.incomplete };
  if (seen.size) await store.set(ck, { at: Date.now(), r });
  return r;
}
