// extlinks.js - links from your pages to other websites: gathered from the pages read, checked hop by hop (through /api/redirects),
// and judged in plain words: broken, now pointing to a different website, page removed (redirects to the homepage), moved, server error.
const host = u => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };
// the registrable part of a domain (good enough: last two labels, or three for co.uk-style endings)
const site = u => { const h = host(u).split("."); return h.length > 2 && /^(co|com|org|net|gov|ac|edu)$/.test(h[h.length - 2]) && h[h.length - 1].length === 2 ? h.slice(-3).join(".") : h.slice(-2).join("."); };
const SOCIAL = /(^|\.)(facebook|instagram|linkedin|twitter|x|youtube|tiktok|pinterest)\.com$/;
export function collect(pages) {
  const by = new Map();
  for (const p of pages) for (const l of p.links_ext || []) { const [u, inMain] = Array.isArray(l) ? l : [l, 0];
    const o = by.get(u) || { url: u, pages: [], in_content: false }; if (!o.pages.includes(p.url)) o.pages.push(p.url); if (inMain) o.in_content = true; by.set(u, o); }
  return [...by.values()].sort((a, b) => (b.in_content - a.in_content) || b.pages.length - a.pages.length);
}
export function judge(link, t) {
  if (!t || t.skipped) return { verdict: "skipped", text: "Not checked (time ran out)." };
  const hops = t.hops || [], last = hops[hops.length - 1] || {}, redirects = hops.filter(h => h.status >= 300 && h.status < 400);
  if (t.loop) return { verdict: "broken", text: "Redirects in a loop and never loads." };
  if (last.error === "private address") return { verdict: "skipped", text: "Points to a private address; not checked." };
  if (!last.status) return { verdict: "broken", text: last.error === "timed out" ? "The site didn't answer in time (it may be down)." : "The site can't be reached (it may no longer exist)." };
  if ([403, 429, 401, 999].includes(last.status)) return { verdict: "blocked", text: `The site blocks automated checks (${last.status}). Check it yourself if it matters.` };
  if (last.status === 404 || last.status === 410) return { verdict: "broken", text: `The page is gone (${last.status}).` };
  if (last.status >= 500) return { verdict: "server", text: `The site returned a server error (${last.status}); it may be temporary.` };
  if (redirects.length) {
    if (site(t.final) !== site(link.url) && !(SOCIAL.test(host(link.url)) && SOCIAL.test(host(t.final))))
      return { verdict: "domain", text: `Now leads to a different website (${host(t.final)}). If the domain changed hands it could be spam: check it.` };
    let p0 = "/", p1 = "/"; try { p0 = new URL(link.url).pathname; p1 = new URL(t.final).pathname; } catch { }
    if (p0.replace(/\/$/, "").length > 1 && (p1 === "/" || p1 === "")) return { verdict: "removed", text: "The page was removed: the link now just redirects to the site's homepage." };
    // only http -> https or adding/removing "www": harmless, counts as working
    const same = (a, b) => { try { const x = new URL(a), y = new URL(b); return x.hostname.replace(/^www\./, "") === y.hostname.replace(/^www\./, "") && x.pathname.replace(/\/$/, "") === y.pathname.replace(/\/$/, "") && x.search === y.search; } catch { return false; } };
    if (redirects.some(h => [301, 308].includes(h.status)) && !same(t.final, link.url)) return { verdict: "moved", text: "Moved permanently. Update the link to the new address.", final: t.final };
  }
  return { verdict: "ok", text: "Works." };
}

// ---- checking: through /api/redirects, polite to other websites ----
import { getSettings } from "./llm.js";
export async function traceUrls(urls, opts = {}) {
  const tok = getSettings().crawlToken;
  const r = await fetch("/api/redirects", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", ...(tok ? { "x-crawl-token": tok } : {}) }, body: JSON.stringify({ urls, ...(opts.sizes ? { sizes: true } : {}) }) });
  const d = await r.json().catch(() => ({}));
  if (r.status === 404 && !d.error) throw new Error("The link checker isn't deployed yet. Push the latest code to GitHub.");
  if (!r.ok) throw new Error(d.error || `Link check failed (${r.status})`); return d.results;
}
// batches of 20 with at most 2 links per website each (the checker runs 5 at a time, so no website gets more than 2 requests at once)
export function politeBatches(urls, size = 20, perSite = 2) {
  const byHost = new Map(); for (const u of urls) { let h = ""; try { h = new URL(u).hostname.replace(/^www\./, ""); } catch { } const l = byHost.get(h) || []; l.push(u); byHost.set(h, l); }
  const queues = [...byHost.values()], batches = [];
  while (queues.some(q => q.length)) { const b = []; for (const q of queues) { for (let k = 0; k < perSite && q.length && b.length < size; k++) b.push(q.shift()); if (b.length >= size) break; } batches.push(b); }
  return batches;
}
// problems grouped by website ("6 links to techsmith.com are broken")
export function byWebsite(results) {
  const m = new Map(); for (const r of results.filter(x => ["broken", "removed", "domain", "server"].includes(x.verdict))) { let h = ""; try { h = new URL(r.url).hostname.replace(/^www\./, ""); } catch { } const o = m.get(h) || { host: h, links: 0, pages: new Set() }; o.links++; r.pages.forEach(p => o.pages.add(p)); m.set(h, o); }
  return [...m.values()].filter(o => o.links >= 2).map(o => ({ host: o.host, links: o.links, pages: o.pages.size })).sort((a, b) => b.links - a.links);
}
