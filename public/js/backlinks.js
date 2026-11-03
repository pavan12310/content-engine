// backlinks.js - who links to your site, from Bing Webmaster Tools (free key): your pages that have links, the pages linking to the
// most-linked ones with their anchor text, grouped by website; strength from Open PageRank (optional free key); new and lost links since
// the last check; and linked pages that now return an error (redirect them to win the links back). Bing reports a sample, not every link.
import * as store from "./store.js";
import { getSettings } from "./llm.js";
import { sites, pickSite } from "./bing.js";
import { traceUrls } from "./extlinks.js";
import { matcher } from "./migration.js";

const KEY = id => `backlinks:${id}`;
export const get = id => store.get(KEY(id), null);
export const ready = () => !!(getSettings().bingKey || "").trim();
export const strengthReady = () => !!(getSettings().oprKey || "").trim();
export const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };
async function relay(body) {
  const tok = getSettings().crawlToken;
  let r; try { r = await fetch("/api/bing", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", ...(tok ? { "x-crawl-token": tok } : {}) }, body: JSON.stringify({ key: (getSettings().bingKey || "").trim(), ...body }) }); }
  catch { throw new Error("Couldn't reach the Bing function. Check your connection."); }
  const d = await r.json().catch(() => ({}));
  if (r.status === 404 && !d.error) throw new Error("The Bing function isn't deployed yet. Push the latest code to GitHub.");
  if (!r.ok) throw new Error(d.error || `Bing request failed (${r.status})`); return d.data;
}
const GENERIC = /^(click here|here|this|this article|this post|read more|learn more|more|website|site|link|source|homepage|home|visit|view|see more|official site|go)$/i;
export function anchorKind(anchor, brand = [], keywords = []) {
  const a = String(anchor || "").trim().toLowerCase();
  if (!a) return "no text (image link)";
  if (/^(https?:\/\/|www\.)|\.[a-z]{2,}(\/|$)/.test(a)) return "web address";
  if (GENERIC.test(a)) return "generic";
  if (brand.some(b => b && a.includes(b))) return "brand";
  if (keywords.some(k => k && a.includes(k))) return "keyword";
  return "other";
}
export async function refresh(id, siteUrl, { brand = [], keywords = [], livePages = [], progress = () => {} } = {}) {
  if (!ready()) throw new Error("Add your free Bing Webmaster API key first (Settings → Google & Bing).");
  progress("Finding your website in Bing Webmaster Tools…");
  const site = pickSite(await sites(), siteUrl); if (!site) throw new Error("This website isn't in your Bing Webmaster Tools account. Add and verify it there (you can import it from Google Search Console).");
  const own = hostOf(siteUrl), pages = [];
  for (let p = 0; p < 5; p++) { progress(`Reading which of your pages have links (${p + 1})…`);
    const d = await relay({ op: "GetLinkCounts", site_url: site, page: p }) || {}; for (const x of d.Links || []) pages.push({ url: x.Url, count: x.Count || 0 });
    if (p + 1 >= (d.TotalPages || 1)) break; }
  pages.sort((a, b) => b.count - a.count);
  const links = [], seen = new Set(), top = pages.slice(0, 25);
  for (const [i, pg] of top.entries()) {
    progress(`Reading who links to your pages (${i + 1} of ${top.length})…`);
    for (let p = 0; p < 2; p++) { let d; try { d = await relay({ op: "GetUrlLinks", site_url: site, link: pg.url, page: p }) || {}; } catch { break; }
      for (const x of d.Details || []) { const k = `${x.Url}|${pg.url}`; if (seen.has(k) || hostOf(x.Url) === own) continue; seen.add(k); links.push({ from: x.Url, to: pg.url, anchor: String(x.AnchorText || "").trim().slice(0, 160) }); }
      if (p + 1 >= (d.TotalPages || 1)) break; }
  }
  // by website
  const byDomain = new Map();
  for (const l of links) { const h = hostOf(l.from); const e = byDomain.get(h) || { domain: h, links: 0, targets: new Set(), anchors: new Map() }; e.links++; e.targets.add(l.to); if (l.anchor) e.anchors.set(l.anchor, (e.anchors.get(l.anchor) || 0) + 1); byDomain.set(h, e); }
  let domains = [...byDomain.values()].map(e => ({ domain: e.domain, links: e.links, pages: e.targets.size, anchor: [...e.anchors.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "", strength: null }));
  if (strengthReady() && domains.length) { progress("Looking up how strong each linking website is (Open PageRank)…");
    for (let i = 0; i < domains.length && i < 300; i += 100) { try { const r = await relay({ op: "PageRank", opr_key: (getSettings().oprKey || "").trim(), domains: domains.slice(i, i + 100).map(d => d.domain) });
      const m = new Map((r || []).map(x => [x.domain, x.strength])); domains.slice(i, i + 100).forEach(d => { if (m.has(d.domain)) d.strength = m.get(d.domain); }); } catch (e) { if (/key/i.test(e.message)) throw e; } } }
  domains.sort((a, b) => (b.strength ?? -1) - (a.strength ?? -1) || b.links - a.links);
  // anchor text mix
  const mix = {}; for (const l of links) { const k = anchorKind(l.anchor, brand, keywords); mix[k] = (mix[k] || 0) + 1; }
  // linked pages that now return an error: redirect them to win the links back
  const broken = []; const check = pages.slice(0, 40).map(p => p.url);
  if (check.length) { progress("Checking that your linked pages still work…"); try { const res = [];
    for (let i = 0; i < check.length; i += 20) res.push(...((await traceUrls(check.slice(i, i + 20))) || []));
    for (const r of res) { if (r.skipped) continue; const st = r.final_status ?? r.status; if (st >= 400 || (r.error && !st)) { const pg = pages.find(p => p.url === r.url); broken.push({ url: r.url, status: st || 0, links: pg?.count || 0, sites: domains.filter(d => links.some(l => l.to === r.url && hostOf(l.from) === d.domain)).length }); } } } catch { } }
  broken.sort((a, b) => b.links - a.links);
  // where each should redirect: the closest live page (by words in its address), never another broken one
  const bad = new Set(broken.map(b => b.url)), live = livePages.filter(u => !bad.has(u));
  if (broken.length && live.length) { const one = matcher(live); for (const b of broken) { { const m = one({ url: b.url });
    // never suggest the homepage: Google treats redirects of old pages to the homepage as "soft 404s", so the links' value is lost anyway
    let home = false; try { home = new URL(m?.target || "").pathname.replace(/\/+$/, "") === ""; } catch { }
    if (m && m.target && m.target !== b.url && !home && m.kind !== "home") { b.target = m.target; b.confidence = m.confidence ?? null; } else b.no_match = true; } } }
  // compared with the last check
  const prev = await get(id), strength = new Map(domains.map(d => [d.domain, d.strength])), key = l => `${l.from}|${l.to}`;
  let added = [], lost = [];
  if (prev?.links) { const before = new Set(prev.links.map(key)), now = new Set(links.map(key)); added = links.filter(l => !before.has(key(l))).slice(0, 100); lost = prev.links.filter(l => !now.has(key(l))).slice(0, 100).map(l => ({ ...l, strength: (prev.domains || []).find(d => d.domain === hostOf(l.from))?.strength ?? null })); }
  const snap = { at: Date.now(), site, totals: { domains: domains.length, links: links.length, pages: pages.length, linked_total: pages.reduce((a, p) => a + p.count, 0) },
    pages: pages.slice(0, 200), links: links.slice(0, 3000), domains: domains.slice(0, 1000), mix, broken, new: added, lost, compared_at: prev?.at || null,
    history: [...(prev?.history || []), { at: Date.now(), domains: domains.length, links: links.length }].slice(-26), strength: strengthReady() };
  await store.set(KEY(id), snap); return snap;
}
