// questions.js - real questions people ask, from the free Stack Exchange API (Stack Overflow, Super User, Web Applications and 170+ sites).
// Called straight from the browser (the API is made for that; about 300 searches a day without a key). Saved questions form a
// question bank per website (shared with the team) that Write a page can use as FAQ ideas.
import * as store from "./store.js";
import { tokens } from "./text.js";
const API = "https://api.stackexchange.com/2.3";
export const SITES = { superuser: "Super User (computer software)", webapps: "Web Applications", softwarerecs: "Software Recommendations", stackoverflow: "Stack Overflow (programming)",
  pm: "Project Management", workplace: "The Workplace", ux: "User Experience", webmasters: "Webmasters (SEO and websites)", money: "Personal Finance", diy: "Home Improvement",
  cooking: "Cooking", travel: "Travel", fitness: "Physical Fitness", photo: "Photography", graphicdesign: "Graphic Design", law: "Law" };
export const DEFAULT_SITES = { saas: ["superuser", "webapps", "softwarerecs"], agency: ["webmasters", "ux", "pm"], publisher: ["webmasters", "superuser", "webapps"],
  ecommerce: ["webapps", "superuser", "softwarerecs"], local: ["diy", "superuser", "webapps"], finance: ["money", "law", "superuser"], legal: ["law", "money", "workplace"], health: ["fitness", "superuser", "webapps"] };
const decode = s => { const t = document.createElement("textarea"); t.innerHTML = String(s || ""); return t.value; };
const norm = s => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
// searches are cached for 24 hours in this browser (not synced), and Stack Exchange's "back off" request is respected
let BACKOFF_UNTIL = 0;
const ckey = (q, site) => `qxcache:${site}:${norm(q)}`;
async function searchSite(q, site) {
  const c = await store.get(ckey(q, site), null); if (c && Date.now() - c.at < 864e5) return { items: c.items, quota: null, cached: true };
  const wait = BACKOFF_UNTIL - Date.now(); if (wait > 0) { if (wait > 15000) throw new Error(`Stack Exchange asked us to pause for ${Math.ceil(wait / 1000)} seconds. Try again shortly.`); await new Promise(r => setTimeout(r, wait)); }
  const p = new URLSearchParams({ order: "desc", sort: "relevance", q, site, pagesize: "30", filter: "default" });
  const r = await fetch(`${API}/search/advanced?${p}`); const d = await r.json().catch(() => ({}));
  if (d.backoff) BACKOFF_UNTIL = Date.now() + d.backoff * 1000;
  if (!r.ok || d.error_id) { if (d.error_id === 502 || r.status === 429) throw new Error("Stack Exchange is limiting requests from this network for now. Try again later."); throw new Error(d.error_message || `Stack Exchange error ${r.status}`); }
  const items = (d.items || []).map(x => ({ id: `${site}:${x.question_id}`, site, title: decode(x.title), link: x.link, views: x.view_count || 0, score: x.score || 0, answers: x.answer_count || 0,
    answered: !!x.accepted_answer_id || (x.is_answered && (x.score || 0) >= 1), tags: x.tags || [], created: (x.creation_date || 0) * 1000 }));
  await store.set(ckey(q, site), { at: Date.now(), items });
  return { items, quota: d.quota_remaining, cached: false };
}
// search several Q&A sites at once; merge, drop near-duplicate titles, most viewed first
export async function search(q, sites) {
  const res = await Promise.allSettled(sites.map(s => searchSite(q, s)));
  const ok = res.filter(r => r.status === "fulfilled").map(r => r.value), failed = res.filter(r => r.status === "rejected").map(r => r.reason.message);
  if (!ok.length) throw new Error(failed[0] || "No results.");
  const seen = new Set(), out = [];
  for (const x of ok.flatMap(r => r.items).sort((a, b) => b.views - a.views)) { const k = norm(x.title); if (seen.has(k)) continue; seen.add(k); out.push(x); }
  const quotas = ok.map(r => r.quota).filter(x => x != null);
  return { items: out, quota: quotas.length ? Math.min(...quotas) : null, failed, cached: ok.filter(r => r.cached).length, searched: ok.length };
}
// similar questions as one topic: weighted word overlap (rare words count more), grouped around the most viewed question
const QSTOP = new Set(["how", "what", "why", "when", "can", "does", "do", "is", "are", "the", "a", "to", "in", "on", "for", "with", "my", "i", "you", "of", "and", "or", "it", "way", "best", "get", "use", "using", "there"]);
// word endings and common equivalents, so "recording"/"record" and "macOS"/"Mac" match
const EQUIV = { macos: "mac", maco: "mac", osx: "mac", macbook: "mac", win: "windows", win10: "windows", win11: "windows", vid: "video", videos: "video", screencast: "screen", screenshot: "screen", doc: "document", docs: "document", documentation: "document" };
const stem = t => { t = EQUIV[t] || t; if (t.length > 5) t = t.replace(/(ings?|ed|es|s)$/, ""); return EQUIV[t] || t; };
export function group(qs, threshold = 0.4) {
  const sets = qs.map(q => new Set(tokens(q.title).filter(t => !QSTOP.has(t)).map(stem))), df = new Map();
  for (const s of sets) for (const t of s) df.set(t, (df.get(t) || 0) + 1);
  const w = t => Math.log((qs.length + 1) / ((df.get(t) || 0) + 1)) + 1;
  const sim = (a, b) => { let inter = 0, uni = 0; for (const t of new Set([...a, ...b])) { const x = w(t); uni += x; if (a.has(t) && b.has(t)) inter += x; } return uni ? inter / uni : 0; };
  const order = qs.map((_, i) => i).sort((a, b) => qs[b].views - qs[a].views), used = new Set(), groups = [];
  for (const i of order) { if (used.has(i)) continue; used.add(i); const g = [i];
    for (const j of order) if (!used.has(j) && sim(sets[i], sets[j]) >= threshold) { used.add(j); g.push(j); }
    groups.push({ head: qs[i], members: g.map(k => qs[k]), views: g.reduce((t, k) => t + qs[k].views, 0), sites: [...new Set(g.map(k => qs[k].site))] }); }
  return groups;
}
const BANK = id => `questions:${id}`;
export const bank = async id => (await store.get(BANK(id), [])) || [];
export async function save(id, q) { const b = await bank(id); if (!b.some(x => x.id === q.id)) b.unshift({ ...q, id: q.id, saved_at: Date.now(), updated_at: Date.now() }); await store.set(BANK(id), b.slice(0, 300)); return b; }
export async function remove(id, qid) { const b = (await bank(id)).filter(x => x.id !== qid); await store.set(BANK(id), b); return b; }
