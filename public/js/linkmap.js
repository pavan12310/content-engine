// linkmap.js - the internal link map, computed from the pages read (no outside service).
// Orphans (no other page links to them), clicks from the homepage, most and least linked pages, and suggested links:
// which related page should link to which, with what words, in which sentence.
import { findMatches, tokens, pageText, mainLinks } from "./text.js";
const norm = u => { try { const x = new URL(u); x.hash = ""; x.search = ""; return x.toString().replace(/\/$/, ""); } catch { return String(u || "").replace(/\/$/, ""); } };
const path = u => { try { return new URL(u).pathname || "/"; } catch { return u; } };
export const section = u => { const seg = path(u).split("/").filter(Boolean).filter(x => !/^[a-z]{2}(-[a-z]{2})?$/i.test(x)); return seg.length ? "/" + seg[0] : "/"; };
// a page's main topic words, from its title (brand part removed) or H1
const topicOf = p => (String((Array.isArray(p.h1) ? p.h1[0] : p.h1) || p.title || "").split(/\s[|\-–—]\s/)[0]).trim();

export function build(pages, gscRows = []) {
  const list = pages.filter(p => p && p.url && !p.error), by = new Map(list.map(p => [norm(p.url), p]));
  const hasMain = list.some(p => Array.isArray(p.links_main));
  const inAll = new Map(), inMain = new Map(), outMain = new Map(), edges = [];
  for (const p of list) {
    const from = norm(p.url);
    for (const l of p.links_out || []) { const to = norm(l); if (to !== from && by.has(to)) inAll.set(to, (inAll.get(to) || 0) + 1); }
    const content = hasMain ? (mainLinks(p) || []).map(x => norm(x.url)) : (p.links_out || []).map(norm);
    const uniq = [...new Set(content)].filter(to => to !== from && by.has(to));
    outMain.set(from, uniq.length);
    for (const to of uniq) { inMain.set(to, (inMain.get(to) || 0) + 1); edges.push([from, to]); }
  }
  // clicks from the homepage (shortest path over all links)
  const home = [...by.keys()].sort((a, b) => path(a).length - path(b).length)[0], depth = new Map([[home, 0]]), queue = [home];
  while (queue.length) { const u = queue.shift(), p = by.get(u); for (const l of p.links_out || []) { const t = norm(l); if (by.has(t) && !depth.has(t)) { depth.set(t, depth.get(u) + 1); queue.push(t); } } }
  const clicks = new Map(); for (const r of gscRows) if (r.kind === "page" && r.page) clicks.set(norm(r.page), (clicks.get(norm(r.page)) || 0) + (r.clicks || 0));
  const rows = [...by.entries()].map(([u, p]) => ({ url: u, title: p.title || u, section: section(u), inbound: inAll.get(u) || 0, inbound_content: inMain.get(u) || 0,
    outbound_content: outMain.get(u) || 0, depth: depth.has(u) ? depth.get(u) : null, clicks: clicks.get(u) || 0, words: p.word_count || 0 }));
  return { rows, edges, home, has_content_links: hasMain, pages: list.length };
}
// suggest links to pages that need them (orphans, weakly linked pages that matter), from related pages that don't link yet
export function suggestions(pages, map, { max = 30, perSource = 3 } = {}) {
  const by = new Map(pages.filter(p => p && p.url).map(p => [norm(p.url), p])), clicksOf = new Map(map.rows.map(r => [r.url, r.clicks || 0]));
  const allLinked = new Set(); for (const p of pages) for (const l of p.links_out || []) allLinked.add(`${norm(p.url)}>${norm(l)}`);
  const needy = map.rows.filter(r => r.url !== map.home && (r.inbound === 0 || (r.inbound_content <= 1 && (r.clicks > 0 || r.words >= 500))))
    .sort((a, b) => (a.inbound - b.inbound) || (b.clicks - a.clicks)).slice(0, 30);
  const out = [], perSrc = new Map(), usedSentences = new Set();
  for (const t of needy) {
    const tp = by.get(t.url), topic = topicOf(tp), tt = new Set(tokens(topic)); if (!tt.size) continue;
    // related pages that don't link yet; pages that already get Google traffic first (a link from a visited page passes on more value)
    const cands = findMatches(`${topic} ${(tp.h2 || []).slice(0, 3).join(" ")}`, pages, 10).filter(m => norm(m.url) !== t.url && !allLinked.has(`${norm(m.url)}>${t.url}`) && m.similarity >= 0.2 && (perSrc.get(norm(m.url)) || 0) < perSource)
      .map(m => ({ m, score: m.similarity * (1 + Math.log10(1 + (clicksOf.get(norm(m.url)) || 0))) })).sort((a, b) => b.score - a.score).slice(0, 2);
    for (const { m: c } of cands) {
      const from = norm(c.url), src = by.get(from), text = String(pageText(src));
      const sents = text.split(/(?<=[.!?])\s+/).filter(s => s.split(" ").length >= 6 && !usedSentences.has(`${from}|${s}`));
      let best = null, bs = 0; for (const s of sents) { const st = new Set(tokens(s)); let n = 0; for (const w of tt) if (st.has(w)) n++; if (n > bs) { bs = n; best = s; } }
      if (bs >= 1) usedSentences.add(`${from}|${best}`);
      perSrc.set(from, (perSrc.get(from) || 0) + 1);
      out.push({ from, from_title: src.title || c.url, from_clicks: clicksOf.get(from) || 0, to: t.url, to_title: tp.title || t.url, anchor: topic.length <= 60 ? topic : topic.split(" ").slice(0, 6).join(" "),
        sentence: bs >= 1 ? best.trim().slice(0, 220) : "", relatedness: Math.round(c.similarity * 100), reason: t.inbound === 0 ? "no page links to it" : t.clicks ? `gets Google traffic but only ${t.inbound_content} content link` : "a substantial page with few content links" });
      if (out.length >= max) return out;
    }
  }
  return out;
}
// a simple force layout for the map (positions in a 0..1 box), content links only, up to 150 pages
export function layout(map, maxNodes = 150) {
  const nodes = [...map.rows].sort((a, b) => (b.inbound_content + b.clicks / 10) - (a.inbound_content + a.clicks / 10)).slice(0, maxNodes);
  const idx = new Map(nodes.map((n, i) => [n.url, i])), E = map.edges.filter(([a, b]) => idx.has(a) && idx.has(b)).map(([a, b]) => [idx.get(a), idx.get(b)]);
  const secs = [...new Set(nodes.map(n => n.section))], N = nodes.length;
  const P = nodes.map((n, i) => { const k = secs.indexOf(n.section), ang = 2 * Math.PI * k / Math.max(secs.length, 1); return { x: 0.5 + 0.3 * Math.cos(ang) + (Math.sin(i * 12.9898) * 0.05), y: 0.5 + 0.3 * Math.sin(ang) + (Math.cos(i * 78.233) * 0.05) }; });
  for (let it = 0; it < 120; it++) {
    const F = P.map(() => ({ x: 0, y: 0 })), k = 0.6 / Math.sqrt(Math.max(N, 1));
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) { const dx = P[i].x - P[j].x, dy = P[i].y - P[j].y, d2 = dx * dx + dy * dy + 1e-4, f = k * k / d2 * 0.02;
      F[i].x += dx * f; F[i].y += dy * f; F[j].x -= dx * f; F[j].y -= dy * f; }
    for (const [a, b] of E) { const dx = P[a].x - P[b].x, dy = P[a].y - P[b].y, d = Math.sqrt(dx * dx + dy * dy) + 1e-4, f = d * 0.05;
      F[a].x -= dx / d * f; F[a].y -= dy / d * f; F[b].x += dx / d * f; F[b].y += dy / d * f; }
    for (let i = 0; i < N; i++) { P[i].x = Math.min(0.97, Math.max(0.03, P[i].x + Math.max(-0.02, Math.min(0.02, F[i].x + (0.5 - P[i].x) * 0.01)))); P[i].y = Math.min(0.97, Math.max(0.03, P[i].y + Math.max(-0.02, Math.min(0.02, F[i].y + (0.5 - P[i].y) * 0.01)))); }
  }
  // no overlaps: push apart any two circles closer than their radii (radius in px / 900 px wide map, plus a small gap)
  const R = nodes.map(n => (4 + Math.min(14, Math.sqrt(n.inbound_content) * 2.2) + 3) / 900), ASPECT = 520 / 900;
  for (let it = 0; it < 200; it++) { let moved = false;
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
      const dx = P[i].x - P[j].x, dy = (P[i].y - P[j].y) * ASPECT, d = Math.sqrt(dx * dx + dy * dy) || 1e-6, need = R[i] + R[j];
      if (d < need) { const push = (need - d) / 2, ux = dx / d, uy = dy / d; P[i].x += ux * push; P[j].x -= ux * push; P[i].y += uy * push / ASPECT; P[j].y -= uy * push / ASPECT; moved = true; }
    }
    for (let i = 0; i < N; i++) { P[i].x = Math.min(0.98, Math.max(0.02, P[i].x)); P[i].y = Math.min(0.97, Math.max(0.03, P[i].y)); }
    if (!moved) break;
  }
  return { nodes: nodes.map((n, i) => ({ ...n, x: P[i].x, y: P[i].y })), edges: E, sections: secs };
}
