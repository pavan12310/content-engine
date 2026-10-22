// dupes.js - duplicate content: compact text fingerprints computed when pages are read (MinHash over 5-word sequences,
// 64 numbers per page) and paragraph fingerprints, then near-duplicate groups, repeated blocks and duplicate titles/descriptions.
const fnv = (s, seed = 2166136261) => { let h = seed >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; };
const K = 64, SEEDS = Array.from({ length: K }, (_, i) => fnv(`seed${i}`));
const wordsOf = t => String(t || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
// the fingerprint of a whole text: for each of 64 hash functions, the smallest hash over all 5-word sequences
export function minhash(text) {
  const w = wordsOf(text); if (w.length < 8) return null;
  const sig = new Array(K).fill(0xffffffff);
  for (let i = 0; i + 5 <= w.length; i++) { const sh = w.slice(i, i + 5).join(" "); const base = fnv(sh);
    for (let k = 0; k < K; k++) { const h = Math.imul(base ^ SEEDS[k], 2654435761) >>> 0; if (h < sig[k]) sig[k] = h; } }
  return sig;
}
export const similarity = (a, b) => { if (!a || !b) return 0; let n = 0; for (let k = 0; k < K; k++) if (a[k] === b[k]) n++; return n / K; };
// paragraph fingerprints (paragraphs of 20+ words), each with a short preview
export function paragraphs(mainEl) {
  const out = [], seen = new Set();
  for (const el of mainEl.querySelectorAll("p, li, blockquote")) {
    const t = (el.textContent || "").replace(/\s+/g, " ").trim(); if (t.split(" ").length < 20) continue;
    const h = fnv(wordsOf(t).join(" ")); if (seen.has(h)) continue; seen.add(h); out.push([h, t.slice(0, 50)]); if (out.length >= 20) break;
  }
  return out;
}
const norm = s => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
const normUrl = u => { try { const x = new URL(u); x.hash = ""; return x.toString().replace(/\/$/, ""); } catch { return String(u || "").replace(/\/$/, ""); } };
// near-duplicate groups (banding: 16 bands of 4 numbers find likely pairs without comparing every page with every other)
export function analyse(pages, { clicks = new Map(), threshold = 0.6 } = {}) {
  const list = pages.filter(p => p && p.url && !p.error && (p.word_count || 0) >= 80).map(p => ({ p, url: normUrl(p.url), sig: p.sig || minhash(p.text_snip || ((p.excerpt || "") + (p.text_more || ""))), full: !!p.sig }));
  // template paragraphs: on at least half the pages of a section (5+ pages), or 40% of all pages
  const secOf = u => { try { return new URL(u).pathname.split("/").filter(Boolean)[0] || "/"; } catch { return "/"; } };
  const secCount = new Map(), secPara = new Map(), allPara = new Map(), withP = list.filter(x => Array.isArray(x.p.paras) && x.p.paras.length);
  for (const x of withP) { const sc = secOf(x.url); secCount.set(sc, (secCount.get(sc) || 0) + 1); for (const [h] of x.p.paras) { secPara.set(`${sc}|${h}`, (secPara.get(`${sc}|${h}`) || 0) + 1); allPara.set(h, (allPara.get(h) || 0) + 1); } }
  const isTemplate = (x, h) => { const sc = secOf(x.url), n = secCount.get(sc) || 0; return (n >= 5 && (secPara.get(`${sc}|${h}`) || 0) >= n * 0.5) || (withP.length >= 10 && (allPara.get(h) || 0) >= withP.length * 0.4); };
  const tshare = x => !Array.isArray(x.p.paras) || !x.p.paras.length ? 0 : x.p.paras.filter(([h]) => isTemplate(x, h)).length / x.p.paras.length;
  list.forEach(x => { x.t = tshare(x); });
  const adjusted = (s, A, B) => { const t = Math.min(A.t, B.t); return t > 0 && t < 1 ? Math.max(0, (s - t) / (1 - t)) : s; };
  const buckets = new Map(), pairs = new Map(), raw = new Map();
  list.forEach((x, i) => { if (!x.sig) return; for (let b = 0; b < 16; b++) { const key = `${b}:${x.sig.slice(b * 4, b * 4 + 4).join(",")}`; const l = buckets.get(key) || []; l.push(i); buckets.set(key, l); } });
  for (const l of buckets.values()) { if (l.length < 2 || l.length > 200) continue;
    for (let a = 0; a < l.length; a++) for (let b = a + 1; b < l.length; b++) { const k = `${l[a]}-${l[b]}`; if (pairs.has(k)) continue;
      const A = list[l[a]], B = list[l[b]];
      if (A.p.lang && B.p.lang && A.p.lang !== B.p.lang) continue;   // other-language versions aren't duplicates
      const s0 = similarity(A.sig, B.sig), s = adjusted(s0, A, B); if (s0 >= threshold) raw.set(k, s0); if (s >= threshold) pairs.set(k, s); } }
  // group pairs (union-find)
  const parent = list.map((_, i) => i), find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
  for (const k of pairs.keys()) { const [a, b] = k.split("-").map(Number); parent[find(a)] = find(b); }
  const groups = new Map(); for (const k of pairs.keys()) for (const i of k.split("-").map(Number)) { const r = find(i); const g = groups.get(r) || new Set(); g.add(i); groups.set(r, g); }
  const out = [];
  for (const g of groups.values()) {
    const idx = [...g], members = idx.map(i => list[i]);
    let max = 0, min = 1, rawMax = 0; for (const [k, s] of pairs) { const [a, b] = k.split("-").map(Number); if (g.has(a) && g.has(b)) { max = Math.max(max, s); min = Math.min(min, s); rawMax = Math.max(rawMax, raw.get(k) || s); } }
    const withClicks = members.map(m => ({ url: m.url, title: m.p.title || "", clicks: clicks.get(m.url) || 0, canonical: m.p.canonical ? normUrl(m.p.canonical) : "", words: m.p.word_count || 0 })).sort((a, b) => b.clicks - a.clicks || b.words - a.words);
    const main = withClicks[0], handled = withClicks.slice(1).every(m => m.canonical && m.canonical !== m.url && withClicks.some(x => x.url === m.canonical));
    const action = handled ? { kind: "handled", text: "Already handled: these pages point to one main page with a canonical tag." }
      : withClicks.some(m => /(\/lp\b|\/lp\/|landing|\/go\/|\/campaign|\/promo|[?&]utm_)/i.test(m.url)) ? { kind: "rewrite", text: `One of these looks like a landing page for ads or campaigns (${withClicks.filter(m => /(\/lp\b|\/lp\/|landing|\/go\/|\/campaign|\/promo|[?&]utm_)/i.test(m.url)).map(m => m.url.replace(/^https?:\/\/[^/]+/, "")).join(", ")}). If it's only for ads, keep it out of Google with a noindex tag (or point it to the main page with a canonical tag) so it doesn't compete with the main page.` }
      : max >= 0.85 ? { kind: "merge", text: `Nearly identical. Keep ${main.url.replace(/^https?:\/\/[^/]+/, "") || "/"} as the main page${main.clicks ? " (it gets the most Google clicks)" : ""}; merge anything unique from the others into it and redirect them (301), or point them to it with a canonical tag.` }
      : { kind: "rewrite", text: "Very similar but not identical: if each page should rank on its own (e.g. a product or location), rewrite each with its own details; otherwise merge them into one page." };
    out.push({ pages: withClicks, similarity: Math.round(max * 100), min_similarity: Math.round(min * 100), raw_similarity: Math.round(rawMax * 100), template_share: Math.round(Math.min(...members.map(m => m.t)) * 100), action, full_text: members.every(m => m.full) });
  }
  out.sort((a, b) => (a.action.kind === "handled") - (b.action.kind === "handled") || b.pages.reduce((t, p) => t + p.clicks, 0) - a.pages.reduce((t, p) => t + p.clicks, 0) || b.similarity - a.similarity);
  // repeated blocks: the same paragraph on 3+ pages but not on nearly all (menus, footers and cookie notices are on all)
  const counts = new Map(), withParas = pages.filter(p => Array.isArray(p.paras));
  for (const p of withParas) for (const [h, prev] of p.paras) { const o = counts.get(h) || { preview: prev, urls: [] }; o.urls.push(normUrl(p.url)); counts.set(h, o); }
  const n = withParas.length, blocks = [...counts.values()].filter(o => o.urls.length >= 3 && o.urls.length <= Math.max(3, n * 0.6)).sort((a, b) => b.urls.length - a.urls.length).slice(0, 20);
  // duplicate titles and descriptions
  const dupBy = key => { const m = new Map(); for (const p of pages) { const v = norm(p[key]); if (v.length < 10) continue; const l = m.get(v) || []; l.push(normUrl(p.url)); m.set(v, l); } return [...m.entries()].filter(([, l]) => l.length > 1).map(([v, l]) => ({ text: v, urls: [...new Set(l)] })).filter(x => x.urls.length > 1).sort((a, b) => b.urls.length - a.urls.length).slice(0, 30); };
  const templateOnly = [...raw.keys()].filter(k => !pairs.has(k)).length;
  return { groups: out, blocks, titles: dupBy("title"), descriptions: dupBy("meta_description"), pages: list.length, full_text: list.filter(x => x.full).length, block_pages: n, template_only: templateOnly };
}

// side by side: sentences two pages share, and what is unique to each
export function sideBySide(textA, textB) {
  const sents = t => String(t || "").split(/(?<=[.!?。！？])\s+|\n+/).map(x => x.replace(/\s+/g, " ").trim()).filter(x => x.split(" ").length >= 5);
  const key = x => x.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ");
  const A = sents(textA), B = sents(textB), ka = new Set(A.map(key)), kb = new Set(B.map(key));
  const shared = A.filter(x => kb.has(key(x))), onlyA = A.filter(x => !kb.has(key(x))), onlyB = B.filter(x => !ka.has(key(x)));
  const total = new Set([...ka, ...kb]).size;
  return { shared, onlyA, onlyB, shared_pct: total ? Math.round(100 * shared.length / total) : 0 };
}
