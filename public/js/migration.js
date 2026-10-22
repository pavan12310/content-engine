// migration.js - site migration planner: match every old address to its best new one (no AI), export redirect rules,
// and judge the redirects after launch (traced hop by hop by /api/redirects).
import { tokens } from "./text.js";
const U = u => { try { const x = new URL(u); x.hash = ""; return x; } catch { return null; } };
export const pathOf = u => { const x = U(u); return x ? (x.pathname.replace(/\/+$/, "") || "/") + (x.search || "") : String(u || ""); };
const slugOf = u => { const p = pathOf(u).split("?")[0].split("/").filter(Boolean); return (p[p.length - 1] || "").replace(/\.(html?|php|aspx?)$/i, "").toLowerCase(); };
const words = (u, title = "") => new Set(tokens(`${pathOf(u).replace(/[\/_\-.?=&]+/g, " ")} ${title}`));
const sameAddr = (a, b) => { const x = U(a), y = U(b); return x && y && x.hostname.replace(/^www\./, "") === y.hostname.replace(/^www\./, "") && pathOf(a) === pathOf(b); };
// best new address for each old one: same path > same last part > most words in common > parent section > homepage
export function match(olds, news) { const one = matcher(news); return olds.map(one); }
// in batches, letting the screen update between them (large sites stay responsive)
export async function matchAsync(olds, news, progress = () => {}) { const one = matcher(news), out = [];
  for (let i = 0; i < olds.length; i += 250) { for (const o of olds.slice(i, i + 250)) out.push(one(o)); progress(`Matched ${Math.min(i + 250, olds.length)} of ${olds.length} pages…`); await new Promise(r => setTimeout(r, 0)); }
  return out; }
export function matcher(news) {
  const N = news.map(u => ({ url: u, path: pathOf(u).split("?")[0], slug: slugOf(u), w: words(u) }));
  const byPath = new Map(N.map(n => [n.path.toLowerCase(), n])), bySlug = new Map();
  for (const n of N) if (n.slug && n.slug.length >= 3) { const l = bySlug.get(n.slug) || []; l.push(n); bySlug.set(n.slug, l); }
  const home = N.find(n => n.path === "/") || N[0];
  const inv = new Map(); N.forEach((n, k) => { for (const w of n.w) { let l = inv.get(w); if (!l) inv.set(w, l = []); l.push(k); } });
  const maxDf = Math.max(50, N.length * 0.2);   // words on more than a fifth of the new addresses are too common to narrow the search
  return o => {
    const op = pathOf(o.url).split("?")[0], same = byPath.get(op.toLowerCase());
    if (same) return { ...o, target: same.url, kind: "same", confidence: 1 };
    const ow = words(o.url, o.title || ""), slug = slugOf(o.url);
    const bySame = slug.length >= 3 ? bySlug.get(slug) : null;
    if (bySame && bySame.length) { const pick = bySame.map(n => ({ n, s: [...n.w].filter(w => ow.has(w)).length })).sort((a, b) => b.s - a.s)[0].n; return { ...o, target: pick.url, kind: "slug", confidence: 0.9 }; }
    // only new addresses sharing a word with this one are compared (rarest words first), instead of every new address
    let best = null, bs = 0, cut = false; const cands = new Set();
    for (const w of [...ow].sort((x, y) => (inv.get(x)?.length || 0) - (inv.get(y)?.length || 0))) { const l = inv.get(w); if (!l) continue; if (l.length > maxDf && cands.size) { cut = true; continue; } for (const k of l) { cands.add(k); if (cands.size >= 500) { cut = true; break; } } if (cands.size >= 500) break; }
    const score = n => { if (!n.w.size || !ow.size) return 0; let inter = 0; for (const w of ow) if (n.w.has(w)) inter++; return inter / Math.max(ow.size, n.w.size) * 0.6 + inter / ow.size * 0.4; };
    for (const k of cands) { const sc = score(N[k]); if (sc > bs) { bs = sc; best = N[k]; } }
    // the shortlist was cut short and found nothing good: compare with every new address for this page (slower, never less accurate)
    if (cut && bs < 0.45) for (const n of N) { const sc = score(n); if (sc > bs) { bs = sc; best = n; } }
    if (best && bs >= 0.45) return { ...o, target: best.url, kind: "similar", confidence: Math.round(bs * 100) / 100 };
    const segs = op.split("/").filter(Boolean);
    for (let i = segs.length - 1; i >= 1; i--) { const parent = byPath.get(("/" + segs.slice(0, i).join("/")).toLowerCase()); if (parent) return { ...o, target: parent.url, kind: "parent", confidence: 0.3, suggestion: best ? best.url : "" }; }
    return { ...o, target: home ? home.url : "", kind: "none", confidence: 0, suggestion: best ? best.url : "" };
  };
}
// redirect rules in several formats (path-only targets when the domain stays the same)
export function exportRules(rows, format, oldOrigin) {
  const live = rows.filter(r => r.gone || (r.target && !sameAddr(r.url, r.target)));
  const tgt = r => { const t = U(r.target), o = U(r.url) || U(oldOrigin); return t && o && t.hostname.replace(/^www\./, "") === o.hostname.replace(/^www\./, "") ? pathOf(r.target) : r.target; };
  const src = r => pathOf(r.url);
  const csvq = v => /[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v;
  switch (format) {
    case "netlify": return "# Netlify _redirects file (put it in your site's publish folder)\n" + live.map(r => r.gone ? `${src(r)}  /404  410` : `${src(r)}  ${tgt(r)}  301`).join("\n") + "\n";
    case "apache": return "# Apache (.htaccess or site config)\n" + live.map(r => r.gone ? `Redirect gone ${src(r)}` : `Redirect 301 ${src(r)} ${tgt(r)}`).join("\n") + "\n";
    case "nginx": return "# Nginx (inside the server block)\n" + live.map(r => r.gone ? `location = ${src(r).split("?")[0]} { return 410; }` : `location = ${src(r).split("?")[0]} { return 301 ${tgt(r)}; }`).join("\n") + "\n";
    case "redirection": return "source,target,regex,code\n" + live.map(r => [src(r), r.gone ? "" : tgt(r), "0", r.gone ? "410" : "301"].map(csvq).join(",")).join("\n") + "\n";
    default: return "old_url,new_url,status\n" + live.map(r => [r.url, r.gone ? "" : r.target, r.gone ? "410" : "301"].map(csvq).join(",")).join("\n") + "\n";
  }
}
// judge one traced redirect against the plan
export function judge(row, t) {
  if (!t || t.skipped) return { verdict: "skipped", text: "Not checked (time ran out); check again." };
  const hops = t.hops || [], first = hops[0] || {}, redirects = hops.filter(h => h.status >= 300 && h.status < 400);
  if (t.loop) return { verdict: "loop", text: "Redirect loop: the address redirects in a circle and never loads." };
  if (row.gone) return [404, 410].includes(t.final_status) ? { verdict: "ok", text: `Gone, as planned (${t.final_status}).` } : { verdict: "wrong", text: `Planned as gone, but it ends at ${t.final} (${t.final_status}).` };
  if (sameAddr(row.url, row.target)) return t.final_status === 200 && !redirects.length ? { verdict: "ok", text: "Same address, loads normally." } : { verdict: t.final_status >= 400 ? "dead" : "wrong", text: `Expected to load as is, but it ${redirects.length ? `redirects to ${t.final}` : `returns ${t.final_status}`}.` };
  if (!redirects.length) return first.status === 200 ? { verdict: "missing", text: "No redirect: the old address still loads (the redirect isn't in place)." } : { verdict: "dead", text: `No redirect: the old address returns ${first.status || "an error"}.` };
  if (!sameAddr(t.final, row.target)) return { verdict: "wrong", text: `Ends at ${t.final} instead of ${row.target}.` };
  if (t.final_status >= 400) return { verdict: "dead", text: `The new address returns ${t.final_status}.` };
  const temp = redirects.filter(h => [302, 303, 307].includes(h.status));
  if (redirects.length > 1) return { verdict: "chain", text: `Works, but through ${redirects.length} redirects (${redirects.map(h => h.status).join(" → ")}). Point it straight at the new address.` };
  if (temp.length) return { verdict: "temporary", text: `Works, but uses a temporary redirect (${temp[0].status}). Use 301 so Google moves the page's ranking.` };
  return { verdict: "ok", text: "Redirects correctly (301)." };
}

// re-score "no good match" rows with page titles: the old title against the titles of the likeliest new pages
export function titleRescore(row, candidates) {
  const ow = new Set(tokens(row.title || "")); if (ow.size < 2) return null;
  let best = null, bs = 0;
  for (const c of candidates) { const cw = new Set(tokens(c.title || "")); if (!cw.size) continue; let inter = 0; for (const w of ow) if (cw.has(w)) inter++; const sc = inter / Math.max(ow.size, cw.size); if (sc > bs) { bs = sc; best = c; } }
  return best && bs >= 0.5 ? { target: best.url, kind: "title", confidence: Math.round(bs * 100) / 100 } : null;
}
export function candidatesFor(row, news, n = 5) {
  const ow = new Set(tokens(`${pathOf(row.url).replace(/[\/_\-.?=&]+/g, " ")} ${row.title || ""}`));
  return news.map(u => { const w = new Set(tokens(pathOf(u).replace(/[\/_\-.?=&]+/g, " "))); let i = 0; for (const x of ow) if (w.has(x)) i++; return { u, i }; }).filter(x => x.i > 0).sort((a, b) => b.i - a.i).slice(0, n).map(x => x.u);
}
