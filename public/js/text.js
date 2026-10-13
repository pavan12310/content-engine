// text.js - tokenising, intent classification and duplicate-keyword detection (ported from the tested Python version)
import { INTENTS, GUARDRAILS } from "./rules.js";

const ORDER = ["navigational", "transactional", "commercial", "how_to", "informational"];
export function classify(text, url = "") {
  const t = " " + (text || "").toLowerCase() + " ", path = (url || "").toLowerCase();
  const scores = Object.fromEntries(Object.keys(INTENTS).map(k => [k, 0]));
  for (const [k, v] of Object.entries(INTENTS)) for (const s of v.signals) if (t.includes(s)) scores[k] += s.length > 4 ? 2 : 1;
  const hints = { "/blog": "informational", "/glossary": "informational", "/tutorial": "how_to", "/how-to": "how_to", "/guide": "informational",
    "/compare": "commercial", "-vs-": "commercial", "/alternatives": "commercial", "/competitor": "commercial", "/pricing": "transactional",
    "/features": "transactional", "/tools": "transactional", "/solutions": "commercial", "/usecases": "commercial", "/use-case": "commercial",
    "/customer": "commercial", "/docs": "navigational", "/help": "how_to", "/support": "navigational" };
  for (const [h, k] of Object.entries(hints)) if (path.includes(h)) scores[k] += 2;
  let best = ORDER[0];
  for (const k of ORDER) if (scores[k] > scores[best]) best = k;
  return scores[best] > 0 ? best : "informational";
}
export function pageIntent(p) {
  const h1 = Array.isArray(p.h1) ? (p.h1[0] || "") : (p.h1 || "");
  return classify(`${p.title || ""} ${h1}`, p.url || "");
}

const STOP = new Set("a an the and or of to for in on with by at from is are be how what why when your you our we it this that vs best top using use into without can do does".split(" "));
const SYN = { create: "make", build: "make", produce: "make", creating: "make", making: "make", made: "make", tool: "software", app: "software",
  platform: "software", tutorial: "guide", record: "recording", recorder: "recording", translator: "translate", translation: "translate",
  translating: "translate", documentation: "doc", document: "doc", docs: "doc" };
export function tokens(s) {
  s = (s || "").toLowerCase().replace(/[-_/]/g, " ");
  const out = [];
  for (let w of s.match(/[a-z0-9\u00c0-\uffff]+/g) || []) {
    if (STOP.has(w) || w.length < 2) continue;
    if (w.length > 4 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
    out.push(SYN[w] || w);
  }
  return out;
}
const pathOf = u => { try { return new URL(u).pathname; } catch { return u || ""; } };
export function titleTokens(p) {
  const h1 = Array.isArray(p.h1) ? (p.h1[0] || "") : (p.h1 || "");
  return new Set([...tokens(p.title), ...tokens(h1), ...tokens(pathOf(p.url))]);
}
function pageDoc(p) {
  const h1 = Array.isArray(p.h1) ? p.h1.join(" ") : (p.h1 || ""), h2 = Array.isArray(p.h2) ? p.h2.join(" ") : (p.h2 || "");
  const ex = (p.excerpt || "").split(/\s+/).slice(0, 60).join(" ");
  const rep = (a, n) => Array(n).fill(a).flat();
  return [...rep(tokens(p.title), 3), ...rep(tokens(h1), 3), ...rep(tokens(pathOf(p.url)), 2), ...tokens(h2), ...tokens(ex)];
}
const counter = arr => { const m = new Map(); for (const x of arr) m.set(x, (m.get(x) || 0) + 1); return m; };

// Build the page index once, then match many keywords against it cheaply.
export function buildIndex(pages) {
  const docs = pages.map(p => counter(pageDoc(p))), n = docs.length;
  const df = new Map(); for (const d of docs) for (const t of d.keys()) df.set(t, (df.get(t) || 0) + 1);
  const idf = t => Math.log((n + 1) / ((df.get(t) || 0) + 1)) + 1;
  const tdf = new Map(); for (const p of pages) for (const t of new Set(tokens(p.title))) tdf.set(t, (tdf.get(t) || 0) + 1);
  const common = new Set([...tdf].filter(([, c]) => c / n > 0.6).map(([t]) => t));
  const vec = c => new Map([...c].map(([t, v]) => [t, (1 + Math.log(v)) * idf(t)]));
  const dvecs = docs.map(d => { const v = vec(d); return { v, n: Math.sqrt([...v.values()].reduce((a, x) => a + x * x, 0)) || 1 }; });
  const tts = pages.map(p => titleTokens(p));
  return { pages, docs, dvecs, tts, common, idf, vec };
}
export function matchIndex(ix, keyword, top = 8) {
  const { pages, docs, dvecs, tts, common, vec } = ix;
  if (!pages.length) return [];
  let q = counter(tokens(keyword)); if (!q.size) return [];
  if ([...q.keys()].some(t => !common.has(t))) q = new Map([...q].filter(([t]) => !common.has(t)));
  const qv = vec(q), qn = Math.sqrt([...qv.values()].reduce((a, x) => a + x * x, 0)) || 1, wsum = [...qv.values()].reduce((a, x) => a + x, 0) || 1;
  const kwIntent = classify(keyword), res = [];
  pages.forEach((p, i) => {
    const d = docs[i], { v: dv, n: dn } = dvecs[i];
    let dot = 0, cov = 0, tcov = 0;
    for (const [t, w] of qv) { dot += w * (dv.get(t) || 0); if (d.has(t)) cov += w; if (tts[i].has(t)) tcov += w; }
    const score = Math.round((0.55 * tcov / wsum + 0.25 * cov / wsum + 0.20 * Math.min(dot / (qn * dn) * 2, 1)) * 1000) / 1000;
    if (score >= 0.2) { const pi = p.intent || pageIntent(p); res.push({ url: p.url, title: p.title || "", intent: pi, same_intent: pi === kwIntent, similarity: score, word_count: p.word_count || 0 }); }
  });
  return res.sort((a, b) => b.similarity - a.similarity).slice(0, top);
}
export function findMatches(keyword, pages, top = 8) { return matchIndex(buildIndex(pages), keyword, top); }

// Coverage of one keyword by the existing site: covered / partial / gap
export function coverage(ix, keyword, intent) {
  const m = matchIndex(ix, keyword, 3), best = m[0];
  const it = intent || classify(keyword);
  if (!best) return { status: "gap", url: "", title: "", similarity: 0 };
  const status = best.similarity >= GUARDRAILS.block_if_same_intent_page_exists_similarity && best.intent === it ? "covered"
    : best.similarity >= GUARDRAILS.warn_similarity ? "partial" : "gap";
  return { status, url: status === "gap" ? "" : best.url, title: status === "gap" ? "" : best.title, similarity: best.similarity, page_intent: best.intent };
}

// Group keywords that one page should target together (avoids one thin page per keyword)
// Words that change what kind of page the searcher wants: keywords only cluster when these match.
const FORMAT_MODS = [["definition", /\b(what is|what are|what's|meaning|definition|define)\b/], ["template", /\b(template|templates|checklist|sample|samples|format|example|examples)\b/],
  ["compare", /\b(vs|versus|alternative|alternatives|compare|comparison)\b/], ["price", /\b(pricing|price|prices|cost|costs)\b/],
  ["free", /\bfree\b/], ["jobs", /\b(job|jobs|salary|career|course|certification)\b/]];
export const formatMods = kw => FORMAT_MODS.filter(([, re]) => re.test(kw.toLowerCase())).map(([k]) => k).sort().join(",");
export function clusterKeywords(kws, threshold = 0.5) {
  const sets = kws.map(k => new Set(tokens(k.keyword))), mods = kws.map(k => formatMods(k.keyword));
  const df = counter(sets.flatMap(s => [...s])), n = kws.length || 1;
  const w = t => Math.log((n + 1) / ((df.get(t) || 0) + 1)) + 1;
  const sim = (a, b) => { let inter = 0, uni = 0; for (const t of new Set([...a, ...b])) { const x = w(t); uni += x; if (a.has(t) && b.has(t)) inter += x; } return uni ? inter / uni : 0; };
  const intentOf = k => k.intent || classify(k.keyword);
  const order = kws.map((k, i) => i).sort((a, b) => (kws[b].opportunity || 0) - (kws[a].opportunity || 0) || sets[a].size - sets[b].size || kws[a].keyword.length - kws[b].keyword.length);
  const assigned = new Map(), clusters = [];
  for (const i of order) {
    if (assigned.has(i)) continue;
    const c = { seed: i, members: [i] }; assigned.set(i, c);
    for (const j of order) {
      if (assigned.has(j) || intentOf(kws[j]) !== intentOf(kws[i]) || mods[j] !== mods[i]) continue;
      // join if close to the main keyword, or if it extends/narrows any member (e.g. "sop template" -> "sop template word")
      const fits = m => { const s1 = sim(sets[m], sets[j]); const contained = [...sets[j]].every(t => sets[m].has(t)) || [...sets[m]].every(t => sets[j].has(t));
        return (m === i && s1 >= threshold) || (contained && s1 >= 0.34); };
      if (c.members.some(fits)) { c.members.push(j); assigned.set(j, c); }
    }
    clusters.push(c);
  }
  return clusters.map(c => {
    const members = c.members.map(i => kws[i]), main = kws[c.seed];
    const vol = members.reduce((a, k) => a + (k.volume || k.gsc_impressions || 0), 0);
    return { name: main.keyword, intent: intentOf(main), primary: main.keyword, keywords: members.map(k => k.keyword),
      total_volume: vol, opportunity: Math.max(...members.map(k => k.opportunity || 0)), size: members.length };
  }).sort((a, b) => b.size - a.size || b.opportunity - a.opportunity);
}
export function verdict(keyword, matches) {
  const kwIntent = classify(keyword);
  const same = matches.filter(m => m.same_intent && m.similarity >= GUARDRAILS.block_if_same_intent_page_exists_similarity);
  const close = matches.filter(m => m.similarity >= GUARDRAILS.warn_similarity);
  const covered = [...new Set(close.map(m => m.intent))].sort();
  const open = Object.keys(INTENTS).filter(i => !covered.includes(i) && i !== "navigational");
  let status, message;
  if (same.length) { status = "exists"; message = `You already have a page for this keyword with the same search intent (${kwIntent}): ${same[0].url}. Update that page instead, or create a page for a different search intent.`; }
  else if (close.length) { status = "related"; message = "Related pages exist with a different intent or partial overlap. A new page is fine only if it serves a clearly different search intent and links to these pages."; }
  else { status = "clear"; message = "No existing page targets this keyword. You can create a new page."; }
  return { status, message, keyword_intent: kwIntent, covered_intents: covered, open_intents: open };
}

const LANG_RE = /^[a-z]{2}(-[a-z]{2})?$/;
export function langOf(url) { const parts = pathOf(url).split("/").filter(Boolean); return parts[0] && LANG_RE.test(parts[0].toLowerCase()) ? parts[0].toLowerCase() : ""; }

export function siteGroups(pages, threshold = 0.6, maxGroups = 60) {
  const n = pages.length; if (n < 2) return [];
  const tdf = counter(pages.flatMap(p => [...new Set(tokens(p.title))]));
  const common = new Set([...tdf].filter(([, c]) => c / n > 0.6).map(([t]) => t));
  const df = counter(pages.flatMap(p => [...titleTokens(p)]));
  const idf = t => Math.log((n + 1) / ((df.get(t) || 0) + 1)) + 1;
  const section = u => { let parts = pathOf(u).split("/").filter(Boolean); if (parts[0] && LANG_RE.test(parts[0])) parts = parts.slice(1); return parts.length > 1 ? parts[0] : "_root"; };
  const secPages = new Map(); pages.forEach((p, k) => { const s = section(p.url); if (!secPages.has(s)) secPages.set(s, []); secPages.get(s).push(k); });
  const template = new Map();
  for (const [sec, idxs] of secPages) if (idxs.length >= 4 && sec !== "_root") {
    const c = counter(idxs.flatMap(k => [...titleTokens(pages[k])]));
    template.set(sec, new Set([...c].filter(([, v]) => v / idxs.length > 0.5).map(([t]) => t)));
  }
  const sets = pages.map(p => new Set([...titleTokens(p)].filter(t => !common.has(t) && !(template.get(section(p.url)) || new Set()).has(t) && !/^\d+$/.test(t))));
  const inv = new Map(); sets.forEach((st, i) => { for (const t of st) { if (!inv.has(t)) inv.set(t, []); inv.get(t).push(i); } });
  const GENERIC = new Set(["minute", "free", "online", "easy", "quick", "step", "complete", "ultimate", "guide", "way", "tip", "2024", "2025", "2026", "new", "software", "tool", "make", "ai"]);
  const intentOf = p => p.intent || pageIntent(p), w = s => [...s].reduce((a, t) => a + idf(t), 0);
  const pairs = new Map();
  sets.forEach((st, i) => {
    if (!st.size) return;
    const cand = new Map();
    for (const t of st) { const lst = inv.get(t); if (lst.length < Math.max(20, Math.floor(n / 5))) for (const j of lst) if (j > i) cand.set(j, (cand.get(j) || 0) + 1); }
    for (const [j, shared] of cand) {
      const inter = [...sets[i]].filter(t => sets[j].has(t) && !GENERIC.has(t));
      if (shared < 2 || !inter.length) continue;
      if (langOf(pages[i].url) !== langOf(pages[j].url) || intentOf(pages[i]) !== intentOf(pages[j])) continue;
      const a = new Set([...sets[i]].filter(t => !GENERIC.has(t))), b = new Set([...sets[j]].filter(t => !GENERIC.has(t)));
      const ti = (pages[i].title || "").toLowerCase(), tj = (pages[j].title || "").toLowerCase();
      const eq = a.size === b.size && [...a].every(t => b.has(t));
      if (/ vs\.? /.test(ti) && / vs\.? /.test(tj) && !eq) continue;
      const score = w(new Set([...a].filter(t => b.has(t)))) / (Math.min(w(a), w(b)) || 1);
      if (score >= threshold) pairs.set(`${i},${j}`, Math.round(score * 100) / 100);
    }
  });
  const seedOf = new Map(), members = new Map();
  for (const [key, sc] of [...pairs].sort((x, y) => y[1] - x[1])) {
    const [i, j] = key.split(",").map(Number), si = seedOf.get(i), sj = seedOf.get(j);
    const ps = (a, b) => pairs.get(a < b ? `${a},${b}` : `${b},${a}`) || 0;
    if (si === undefined && sj === undefined) { seedOf.set(i, i); seedOf.set(j, i); members.set(i, new Set([i, j])); }
    else if (si !== undefined && sj === undefined && ps(si, j) >= threshold) { seedOf.set(j, si); members.get(si).add(j); }
    else if (sj !== undefined && si === undefined && ps(sj, i) >= threshold) { seedOf.set(i, sj); members.get(sj).add(i); }
  }
  const out = [];
  for (const mem of members.values()) {
    const idx = [...mem].sort((a, b) => (pages[b].word_count || 0) - (pages[a].word_count || 0));
    const terms = [...counter(idx.flatMap(k => [...sets[k]]))].sort((x, y) => y[1] - x[1]).slice(0, 4);
    let maxSim = 0; for (const [key, v] of pairs) { const [a, b] = key.split(",").map(Number); if (mem.has(a) && mem.has(b)) maxSim = Math.max(maxSim, v); }
    out.push({ topic: terms.filter(([, c]) => c > 1).map(([t]) => t).join(" ") || terms.slice(0, 2).map(([t]) => t).join(" "),
      intent: intentOf(pages[idx[0]]), urls: idx.slice(0, 8).map(k => ({ url: pages[k].url, title: pages[k].title || "", words: pages[k].word_count || 0 })),
      size: idx.length, max_similarity: maxSim });
  }
  return out.sort((a, b) => b.size - a.size || b.max_similarity - a.max_similarity).slice(0, maxGroups);
}
