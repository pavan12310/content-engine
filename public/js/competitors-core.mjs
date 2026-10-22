// competitors-core.mjs - competitor tracking from public sitemaps. Pure JavaScript (no browser APIs), so the same code runs in
// the browser ("Check now") and in the weekly Netlify job. The caller passes in a fetchText(url) -> { status, text } function.

const decode = s => String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();
const tag = (block, name) => { const m = block.match(new RegExp(`<(?:[a-z]+:)?${name}[^>]*>([\\s\\S]*?)</(?:[a-z]+:)?${name}>`, "i")); return m ? decode(m[1]) : ""; };
// one sitemap file: either an index of other sitemaps or a list of pages
export function parseSitemap(xml) {
  const x = String(xml || "");
  if (/<(?:[a-z]+:)?sitemapindex[\s>]/i.test(x)) return { type: "index", items: [...x.matchAll(/<(?:[a-z]+:)?sitemap[\s>][\s\S]*?<\/(?:[a-z]+:)?sitemap>/gi)].map(m => ({ loc: tag(m[0], "loc"), lastmod: tag(m[0], "lastmod") })).filter(i => i.loc) };
  return { type: "urlset", items: [...x.matchAll(/<(?:[a-z]+:)?url[\s>][\s\S]*?<\/(?:[a-z]+:)?url>/gi)].map(m => ({ loc: tag(m[0], "loc"), lastmod: tag(m[0], "lastmod") })).filter(i => i.loc) };
}
const SKIP = /\.(jpg|jpeg|png|gif|webp|svg|pdf|zip|mp4|mp3|css|js|json)(\?|$)/i;
const normUrl = u => { try { const x = new URL(u); x.hash = ""; return x.toString().replace(/\/$/, ""); } catch { return ""; } };
const sameSite = (u, host) => { try { return new URL(u).hostname.replace(/^www\./, "") === host.replace(/^www\./, ""); } catch { return false; } };
// every page listed in a site's sitemaps (robots.txt Sitemap lines, then the usual locations), within limits.
// With the previous snapshot, a sitemap file whose last-changed date (from the sitemap index) hasn't changed isn't downloaded again:
// its pages are taken from the snapshot.
export const snapUrls = snap => !snap ? null : snap.v === 2 ? snap.urls : snap;   // older snapshots were a plain {url: lastmod} map
export async function collect(siteUrl, fetchText, { maxFiles = 30, maxUrls = 10000, deadline = Infinity, prev = null } = {}) {
  const origin = new URL(siteUrl).origin, host = new URL(siteUrl).hostname, queue = [], seen = new Set(), urls = new Map(), fileOf = new Map(), files = [], idxLastmod = new Map();
  const prevFiles = prev && prev.v === 2 ? new Map(prev.files.map((f, k) => [f.url, { ...f, k }])) : new Map();
  const prevByFile = new Map(); if (prev && prev.v === 2) for (const [u, k] of Object.entries(prev.file_of || {})) { const l = prevByFile.get(k) || []; l.push(u); prevByFile.set(k, l); }
  let fetched = 0, reused = 0, capped = false, skippedGz = 0;
  try { const r = await fetchText(`${origin}/robots.txt`); if (r.status === 200) for (const m of String(r.text).matchAll(/^\s*sitemap:\s*(\S+)/gim)) queue.push(m[1]); } catch { }
  if (!queue.length) queue.push(`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`);
  const addUrl = (u, lm, fk) => { if (urls.size >= maxUrls) { capped = true; return false; } urls.set(u, lm); fileOf.set(u, fk); return true; };
  while (queue.length && fetched + reused < maxFiles * 4 && fetched < maxFiles && Date.now() < deadline) {
    const sm = queue.shift(); if (seen.has(sm)) continue; seen.add(sm);
    if (/\.gz(\?|$)/i.test(sm)) { skippedGz++; continue; }
    // unchanged since last time (same last-changed date in the index): reuse its pages
    const pf = prevFiles.get(sm), lm = idxLastmod.get(sm);
    if (pf && lm && pf.lastmod === lm && prevByFile.has(pf.k)) {
      const fk = files.push({ url: sm, lastmod: lm }) - 1; reused++;
      for (const u of prevByFile.get(pf.k)) if (!addUrl(u, (prev.urls || {})[u] || "", fk)) break;
      if (capped) break; continue;
    }
    let r; try { r = await fetchText(sm); } catch { continue; } fetched++;
    if (r.status !== 200 || !/<(?:[a-z]+:)?(urlset|sitemapindex)/i.test(r.text || "")) continue;
    const p = parseSitemap(r.text), fk = p.type === "index" ? -1 : files.push({ url: sm, lastmod: lm || "" }) - 1;
    for (const it of p.items) {
      if (p.type === "index" || /\.xml(\.gz)?(\?|$)/i.test(it.loc)) { if (sameSite(it.loc, host)) { queue.push(it.loc); if (it.lastmod) idxLastmod.set(it.loc, it.lastmod.slice(0, 19)); } continue; }   // some sites list sitemaps as pages
      const u = normUrl(it.loc); if (!u || SKIP.test(u) || !sameSite(u, host)) continue;
      if (!addUrl(u, (it.lastmod || "").slice(0, 10), fk)) break;
    }
    if (capped) break;
  }
  return { urls: Object.fromEntries(urls), files, file_of: Object.fromEntries(fileOf), fetched, reused, capped, incomplete: queue.length > 0 && !capped, skipped_gz: skippedGz };
}
export const toSnapshot = res => ({ v: 2, urls: res.urls, file_of: res.file_of, files: res.files });
// what changed since the last snapshot
export function diff(prev, cur) {
  const p = prev || {}, c = cur || {}, added = [], removed = [], updated = [];
  for (const [u, lm] of Object.entries(c)) { if (!(u in p)) added.push(u); else if (lm && p[u] && lm > p[u]) updated.push(u); }
  for (const u of Object.keys(p)) if (!(u in c)) removed.push(u);
  return { added, removed, updated };
}
// the page title without the site's name ("Best X for Mac | Rival" -> "Best X for Mac")
export const cleanTitle = t => { const parts = String(t || "").split(/\s[|\-–—·:]\s/); return parts.length > 1 && parts.slice(1).join(" ").split(/\s+/).length <= 4 ? parts[0].trim() : String(t || "").trim(); };
export const titleOf = html => { const m = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i); return m ? cleanTitle(decode(m[1]).replace(/\s+/g, " ")).slice(0, 200) : ""; };
// words from a URL slug, as a stand-in title when the page itself isn't read
export const slugWords = u => { try { return decodeURIComponent(new URL(u).pathname.split("/").filter(Boolean).pop() || "").replace(/\.[a-z]+$/i, "").replace(/[-_]+/g, " ").trim(); } catch { return ""; } };

// what a competitor has been publishing about: the most common topic words and word pairs in new pages' titles and addresses
const TSTOP = new Set("the a an and or of for to in on with how what why when your you our we is are be can best top guide vs new free 2024 2025 2026 2027 blog page tips ways step steps complete ultimate".split(" "));
export function topics(items, { brand = "", max = 8 } = {}) {
  const b = String(brand || "").toLowerCase(), c = new Map();
  for (const it of items) {
    const w = `${it.title || ""} ${slugWords(it.url)}`.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(x => x.length >= 3 && !TSTOP.has(x) && !b.includes(x) && !/^\d+$/.test(x));
    const seen = new Set([...w, ...w.slice(0, -1).map((x, i) => `${x} ${w[i + 1]}`)]);
    for (const t of seen) c.set(t, (c.get(t) || 0) + 1);
  }
  // prefer word pairs when they're as common as their words
  const list = [...c.entries()].filter(([, n]) => n >= 2).sort((a, b2) => b2[1] - a[1] || b2[0].split(" ").length - a[0].split(" ").length);
  const out = []; for (const [t, n] of list) { if (out.some(o => (o.topic.includes(t) || t.includes(o.topic)) && Math.abs(o.pages - n) <= 1)) continue; out.push({ topic: t, pages: n }); if (out.length >= max) break; }
  return out;
}
