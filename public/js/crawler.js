// crawler.js - reads a live website in the browser. Pages are fetched through the site's /api/fetch function (CORS).
import { getSettings } from "./llm.js";
const SKIP = /\.(jpg|jpeg|png|gif|webp|svg|pdf|zip|mp4|mp3|css|js|ico|json|woff2?)(\?|$)/i;
const LANG = /^[a-z]{2}(-[a-z]{2})?$/i;

async function fetchPage(url) {
  const tok = getSettings().crawlToken;
  const r = await fetch(`/api/fetch?url=${encodeURIComponent(url)}`, { headers: tok ? { "x-crawl-token": tok } : {} });
  if (r.status === 401) throw new Error("This site requires a crawl token. Add it in Settings.");
  if (r.status === 404) throw new Error("The page-reading function isn't available. Deploy on Netlify (or run `netlify dev`) so /api/fetch exists.");
  return r.json();
}
const norm = u => { try { const x = new URL(u); x.hash = ""; x.search = ""; return x.toString(); } catch { return u; } };
const sameSite = (u, host) => { try { return new URL(u).host.replace(/^www\./, "").toLowerCase() === host.replace(/^www\./, "").toLowerCase(); } catch { return false; } };

function robots(text) {
  const rules = []; let applies = false;
  for (const raw of (text || "").split(/\r?\n/)) {
    const line = raw.split("#")[0].trim(); const i = line.indexOf(":"); if (i < 0) continue;
    const k = line.slice(0, i).trim().toLowerCase(), v = line.slice(i + 1).trim();
    if (k === "user-agent") applies = v === "*";
    else if (applies && (k === "disallow" || k === "allow") && v) rules.push({ allow: k === "allow", path: v });
  }
  return u => { let p; try { p = new URL(u).pathname; } catch { return true; }
    let best = null; for (const r of rules) { const re = new RegExp("^" + r.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$")); if (re.test(p) && (!best || r.path.length > best.path.length)) best = r; }
    return !best || best.allow; };
}
async function parseSitemap(url, host, seen, depth = 0) {
  if (depth > 3 || seen.has(url)) return []; seen.add(url);
  let r; try { r = await fetchPage(url); } catch (e) { if (/token|function/.test(e.message)) throw e; return []; }
  if (!r || r.status !== 200 || !r.body) return [];
  const doc = new DOMParser().parseFromString(r.body, "application/xml"); let out = [];
  for (const sm of doc.getElementsByTagName("sitemap")) { const loc = sm.getElementsByTagName("loc")[0]; if (loc) out = out.concat(await parseSitemap(loc.textContent.trim(), host, seen, depth + 1)); }
  for (const u of doc.getElementsByTagName("url")) { const loc = u.getElementsByTagName("loc")[0], lm = u.getElementsByTagName("lastmod")[0];
    if (loc && sameSite(loc.textContent.trim(), host)) out.push([norm(loc.textContent.trim()), lm ? lm.textContent.trim() : ""]); }
  return out;
}
function sectionOf(u) { let parts = new URL(u).pathname.split("/").filter(Boolean), lang = ""; if (parts[0] && LANG.test(parts[0])) { lang = parts[0].toLowerCase(); parts = parts.slice(1); } return [lang, parts.length ? "/" + parts[0] : "/"]; }
function roundRobin(buckets, n) {
  const keys = [...buckets.keys()].sort((a, b) => buckets.get(b).length - buckets.get(a).length), out = []; let i = 0;
  while (out.length < n && keys.some(k => buckets.get(k).length)) { const k = keys[i % keys.length]; if (buckets.get(k).length) out.push(buckets.get(k).shift()); i++; }
  return out;
}
function sampleFair(urls, max) {
  const main = new Map(), trans = new Map();
  for (const [u, lm] of urls) { const [lang, sec] = sectionOf(u), m = lang ? trans : main, k = lang || sec; if (!m.has(k)) m.set(k, []); m.get(k).push([u, lm]); }
  for (const m of [main, trans]) for (const v of m.values()) v.sort((a, b) => (b[1] || "").localeCompare(a[1] || "") || b[0].length - a[0].length);
  const nTrans = Math.min([...trans.values()].reduce((a, v) => a + v.length, 0), Math.floor(max / 5));
  const picked = roundRobin(main, max - nTrans); return picked.concat(roundRobin(trans, max - picked.length));
}
export function extract(url, html, host) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const htmlBytes = html.length;
  const isHttps = /^https:/i.test(url);
  const insecure = isHttps ? [...doc.querySelectorAll("a[href^='http:'],img[src^='http:'],script[src^='http:'],link[href^='http:'],iframe[src^='http:']")]
    .filter(e => e.tagName !== "A").length : 0;   // insecure resources (mixed content); plain http links to other sites are fine
  const schema = [];
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) { try { const d = JSON.parse(s.textContent || "{}"); const items = Array.isArray(d) ? d : (d["@graph"] || [d]);
    for (const it of items) if (it && it["@type"]) schema.push(...[].concat(it["@type"])); } catch { /* bad json-ld */ } }
  doc.querySelectorAll("script,style,noscript,svg,iframe,template").forEach(e => e.remove());
  const meta = n => doc.querySelector(`meta[name="${n}" i]`)?.getAttribute("content") || "";
  const title = (doc.querySelector("title")?.textContent || "").trim();
  const canon = doc.querySelector('link[rel~="canonical"]')?.getAttribute("href") || "";
  const h1 = [...doc.querySelectorAll("h1")].map(h => h.textContent.replace(/\s+/g, " ").trim()).slice(0, 3);
  const h2 = [...doc.querySelectorAll("h2")].map(h => h.textContent.replace(/\s+/g, " ").trim()).slice(0, 15);
  const links = [...doc.querySelectorAll("a[href]")].map(a => { try { return norm(new URL(a.getAttribute("href"), url).toString()); } catch { return null; } }).filter(u => u && /^https?:/.test(u) && sameSite(u, host));
  const imgs = [...doc.querySelectorAll("img")];
  const hasAuthor = !!meta("author") || !!doc.querySelector('[class*="author" i],[class*="byline" i],[rel="author"]');
  const date = doc.querySelector('meta[property^="article:published_time"],meta[property^="article:modified_time"]')?.getAttribute("content") || doc.querySelector("time")?.getAttribute("datetime") || "";
  const main = doc.querySelector("main") || doc.querySelector("article") || doc.body || doc.documentElement;
  main.querySelectorAll("nav,header,footer,aside,form").forEach(e => e.remove());
  const text = (main.textContent || "").replace(/\s+/g, " ").trim();
  return { url, title, meta_description: meta("description").trim(), h1, h2, word_count: text ? text.split(" ").length : 0, excerpt: text.slice(0, 1200),
    lang: doc.documentElement.getAttribute("lang") || "", canonical: canon ? (() => { try { return new URL(canon, url).toString(); } catch { return canon; } })() : "",
    noindex: /noindex/i.test(meta("robots")), date, has_author: hasAuthor, images: imgs.length, images_missing_alt: imgs.filter(i => !(i.getAttribute("alt") || "").trim()).length,
    viewport: !!doc.querySelector('meta[name="viewport" i]'),
    og: !!(doc.querySelector('meta[property="og:title"]') && doc.querySelector('meta[property="og:image"]')),
    hreflang: doc.querySelectorAll('link[rel="alternate"][hreflang]').length,
    insecure_resources: insecure, html_bytes: htmlBytes,
    links_out: [...new Set(links)].filter(l => l !== norm(url)).slice(0, 150),
    internal_links: new Set(links).size, schema_types: [...new Set(schema.map(String))].slice(0, 8), _links: [...new Set(links)].slice(0, 300),
    _text: text.slice(0, 40000), _outline: [...main.querySelectorAll("h2,h3")].map(h => (h.tagName === "H2" ? "## " : "### ") + h.textContent.replace(/\s+/g, " ").trim()).slice(0, 60) };
}
import { htmlToMarkdown } from "./md.js";
// read a live page as Markdown (for Review a draft)
export async function readPageMarkdown(url) {
  const r = await fetchPage(url);
  if (!r || r.status !== 200 || !r.body) throw new Error(`Couldn't read ${url} (${r?.error || "status " + r?.status})`);
  const doc = new DOMParser().parseFromString(r.body, "text/html");
  const meta = doc.querySelector('meta[name="description" i]')?.getAttribute("content") || "";
  const title = (doc.querySelector("title")?.textContent || "").trim();
  const main = doc.querySelector("main") || doc.querySelector("article") || doc.body;
  main.querySelectorAll("nav,header,footer,aside,form,script,style,noscript,svg,iframe").forEach(e => e.remove());
  main.querySelectorAll("a[href]").forEach(a => { try { a.setAttribute("href", new URL(a.getAttribute("href"), r.url || url).toString()); } catch {} });
  main.querySelectorAll("img[src]").forEach(i => { try { i.setAttribute("src", new URL(i.getAttribute("src"), r.url || url).toString()); } catch {} });
  return { url: r.url || url, title, meta_description: meta.trim(), markdown: htmlToMarkdown(main) };
}
// read one live page in full (for update plans)
export async function readPage(url) {
  const r = await fetchPage(url);
  if (!r || r.status !== 200 || !r.body) throw new Error(`Couldn't read ${url} (${r?.error || "status " + r?.status})`);
  const host = new URL(r.url || url).host, d = extract(norm(r.url || url), r.body, host);
  return { url: d.url, title: d.title, meta_description: d.meta_description, h1: d.h1, outline: d._outline, word_count: d.word_count, text: d._text };
}
function titlePattern(t) { t = t.replace(/\s*[|\-–—:]\s*[^|\-–—:]{2,40}$/, "").replace(/\b\d{4}\b/g, "{year}"); const w = t.toLowerCase().split(/\s+/); return w.length >= 3 ? w.slice(0, 3).join(" ") : t.toLowerCase(); }

export async function crawl(startUrl, maxPages = 200, onProgress = () => {}) {
  let start = /^https?:/i.test(startUrl) ? startUrl : "https://" + startUrl;
  onProgress("Opening the homepage…");
  const r0 = await fetchPage(start);
  if (!r0 || !r0.status || r0.status >= 400 || !r0.body) throw new Error(`Could not open ${start} (${r0?.error || "status " + r0?.status})`);
  start = norm(r0.url || start); const host = new URL(start).host, base = `${new URL(start).protocol}//${host}`;
  onProgress("Reading robots.txt and sitemaps…");
  let canFetch = () => true, sitemaps = [];
  try { const rr = await fetchPage(base + "/robots.txt"); if (rr.status === 200 && rr.body) { canFetch = robots(rr.body); sitemaps = rr.body.split(/\r?\n/).filter(l => /^sitemap:/i.test(l.trim())).map(l => l.trim().slice(8).trim()); } } catch (e) { if (/token|function/.test(e.message)) throw e; }
  if (!sitemaps.length) sitemaps = [base + "/sitemap.xml", base + "/sitemap_index.xml"];
  const seen = new Set(); let found = [];
  for (const sm of sitemaps) found = found.concat(await parseSitemap(sm, host, seen));
  let source = "sitemap";
  if (!found.length) { source = "links"; const home = extract(start, r0.body, host); found = [[start, ""], ...home._links.map(u => [u, ""])]; }
  const dedup = new Map(); for (const [u, lm] of found) if (!SKIP.test(u) && canFetch(u) && !dedup.has(u)) dedup.set(u, lm);
  if (!dedup.has(start)) dedup.set(start, "");
  const urls = [...dedup];
  let picked = sampleFair(urls, maxPages); if (!picked.some(([u]) => u === start)) picked.unshift([start, ""]);
  const pages = new Array(picked.length); let done = 0, i = 0;
  const worker = async () => {
    while (i < picked.length) {
      const k = i++, [u, lm] = picked[k];
      try { const r = await fetchPage(u);
        pages[k] = (!r || r.status !== 200 || !r.body || !/html/i.test(r.contentType || "html")) ? { url: u, status: r?.status || 0, error: r?.error || "not an HTML 200 page" }
          : { ...extract(norm(r.url || u), r.body, host), status: 200, lastmod: lm || "", ...(norm(r.url || u) !== norm(u) ? { redirected_from: norm(u) } : {}) };
      } catch (e) { pages[k] = { url: u, status: 0, error: e.message }; }
      done++; if (done % 5 === 0 || done === picked.length) onProgress(`Reading pages… ${done}/${picked.length}`);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  // merge pages that several sitemap URLs redirect to; remember every redirecting source URL
  const byUrl = new Map(), redirects = [];
  for (const p of pages) {
    if (p.status !== 200) continue;
    if (p.redirected_from) redirects.push({ from: p.redirected_from, to: p.url });
    if (!byUrl.has(p.url)) byUrl.set(p.url, p);
  }
  const ok = [...byUrl.values()];
  const inbound = new Map(); for (const p of ok) for (const l of new Set(p._links || [])) inbound.set(l, (inbound.get(l) || 0) + 1);
  for (const p of ok) { p.inbound_links = inbound.get(p.url) || 0; delete p._links; delete p._text; delete p._outline; }
  const secC = new Map(), langC = new Map(); for (const [u] of urls) { const [lang, sec] = sectionOf(u); secC.set(sec, (secC.get(sec) || 0) + 1); langC.set(lang || "default", (langC.get(lang || "default") || 0) + 1); }
  const cnt = arr => { const m = new Map(); for (const x of arr) m.set(x, (m.get(x) || 0) + 1); return [...m].sort((a, b) => b[1] - a[1]); };
  const wc = ok.map(p => p.word_count).sort((a, b) => a - b);
  const summary = { site: base, crawl_id: Date.now(), crawled_at: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC", url_source: source, urls_discovered: urls.length,
    pages_read: ok.length, pages_failed: pages.length - ok.length, sections: [...secC].sort((a, b) => b[1] - a[1]).slice(0, 25), languages: [...langC].sort((a, b) => b[1] - a[1]).slice(0, 15),
    median_word_count: wc[Math.floor(wc.length / 2)] || 0, thin_pages_under_300_words: ok.filter(p => p.word_count < 300).map(p => p.url).slice(0, 40),
    duplicate_titles: cnt(ok.map(p => p.title).filter(Boolean)).filter(([, n]) => n > 1).slice(0, 20),
    repeated_title_patterns: cnt(ok.map(p => p.title).filter(Boolean).map(titlePattern)).filter(([, n]) => n >= 3).slice(0, 15),
    missing_meta_description: ok.filter(p => !p.meta_description).length, pages_with_author_signal: ok.filter(p => p.has_author).length,
    pages_with_date: ok.filter(p => p.date).length, redirects: redirects.slice(0, 300), failed_pages: pages.filter(p => p.status !== 200).map(p => ({ url: p.url, status: p.status, error: p.error || "" })).slice(0, 200) };
  return { summary, pages: ok };
}
