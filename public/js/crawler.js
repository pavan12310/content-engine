// crawler.js - reads a live website in the browser. Pages are fetched through the site's /api/fetch function (CORS).
import { getSettings } from "./llm.js";
const SKIP = /\.(jpg|jpeg|png|gif|webp|avif|svg|pdf|zip|gz|mp4|webm|mov|mp3|wav|css|js|mjs|ico|json|woff2?|ttf|otf|md|txt|xml|rss|atom|csv|xlsx?|docx?|pptx?|webmanifest|map)(\?|$)/i;
import { minhash, paragraphs } from "./dupes.js";
export const BLOCKED = new Set([401, 403, 429, 503]);   // the site refused the reader (bot protection, rate limits): not the site's own errors
const LANG = /^[a-z]{2}(-[a-z]{2})?$/i;

// shared slow-down when the target site rate-limits us (429/503): every worker waits this long before its next page
const PACE = { wait: 0, retries: 0, limit: 6, active: 0, okStreak: 0 };
const pause = ms => new Promise(r => setTimeout(r, ms));
export async function fetchPage(url, { retries = 2 } = {}) {
  const tok = getSettings().crawlToken;
  for (let attempt = 0; ; attempt++) {
    while (PACE.active >= PACE.limit) await pause(150);   // after a 429 the reader goes one page at a time
    if (PACE.wait) await pause(PACE.wait);
    let r, data = null;
    PACE.active++;
    try { r = await fetch(`/api/fetch?url=${encodeURIComponent(url)}`, { headers: tok ? { "x-crawl-token": tok } : {} }); }
    catch { PACE.active--; if (attempt < retries) { PACE.retries++; await pause(1500 * (attempt + 1)); continue; } return { url, status: 0, error: "couldn't reach the page reader" }; }
    PACE.active--;
    if (r.status === 401) throw new Error("This site requires a crawl token. Add it in Settings.");
    if (r.status === 404) throw new Error("The page-reading function isn't available. Deploy on Netlify (or run `netlify dev`) so /api/fetch exists.");
    if (r.status >= 500) {   // the Netlify function itself timed out or crashed: retry
      if (attempt < retries) { PACE.retries++; await pause(2000 * (attempt + 1)); continue; }
      return { url, status: 0, error: `page reader error ${r.status}` };
    }
    try { data = await r.json(); } catch { data = { url, status: 0, error: "unreadable reply" }; }
    if (data.status === 429 || data.status === 503) {   // the website asked us to slow down: one page at a time, longer pauses
      PACE.limit = 1; PACE.okStreak = 0; PACE.wait = Math.min((PACE.wait || 1000) * 2, 10000);
      if (attempt < retries) { PACE.retries++; await pause(PACE.wait); continue; }
    }
    if (data.status === 200) {
      if (PACE.wait) PACE.wait = Math.max(0, Math.floor(PACE.wait / 2) - 100);
      if (++PACE.okStreak >= 8 && PACE.limit < 6) { PACE.limit++; PACE.okStreak = 0; }   // speed back up gradually
    }
    return data;
  }
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
const SITEMAP_MAX_FILES = 80, SITEMAP_MAX_URLS = 60000;   // huge sites: stop once we have plenty to sample from
async function parseSitemap(url, host, seen, depth = 0, budget = { urls: 0 }) {
  if (depth > 3 || seen.has(url) || seen.size >= SITEMAP_MAX_FILES || budget.urls >= SITEMAP_MAX_URLS) return []; seen.add(url);
  let r; try { r = await fetchPage(url); } catch (e) { if (/token|function/.test(e.message)) throw e; return []; }
  if (!r || r.status !== 200 || !r.body) return [];
  const doc = new DOMParser().parseFromString(r.body, "application/xml"); let out = [];
  for (const sm of doc.getElementsByTagName("sitemap")) { const loc = sm.getElementsByTagName("loc")[0]; if (loc) out = out.concat(await parseSitemap(loc.textContent.trim(), host, seen, depth + 1, budget)); if (budget.urls >= SITEMAP_MAX_URLS) break; }
  for (const u of doc.getElementsByTagName("url")) { const loc = u.getElementsByTagName("loc")[0], lm = u.getElementsByTagName("lastmod")[0];
    if (!loc) continue; const href = loc.textContent.trim();
    // some sites list their other sitemaps as if they were pages: open them as sitemaps
    if (/\.xml(\.gz)?(\?|$)/i.test(href)) { if (budget.urls < SITEMAP_MAX_URLS) out = out.concat(await parseSitemap(href, host, seen, depth + 1, budget)); continue; }
    if (sameSite(href, host)) { out.push([norm(href), lm ? lm.textContent.trim() : ""]); budget.urls++; } }
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
// Pick the element that really holds the page's text. <main>/<article> can be empty placeholders,
// so use the candidate with the most words, and fall back to the whole body (minus menus) when they hold little.
const CHROME = "nav,header,footer,aside,form,script,style,noscript,svg,iframe,template,[role=navigation],[role=banner],[role=contentinfo]";
const wordsIn = el => { const t = (el?.textContent || "").replace(/\s+/g, " ").trim(); return t ? t.split(" ").length : 0; };
export function mainContent(doc) {
  const body = doc.body || doc.documentElement;
  const clean = el => { const c = el.cloneNode(true); c.querySelectorAll(CHROME).forEach(e => e.remove()); return c; };
  const bodyClean = clean(body), bodyWords = wordsIn(bodyClean);
  let best = null, bestWords = 0;
  for (const el of doc.querySelectorAll("main, article, [role=main]")) { const c = clean(el), w = wordsIn(c); if (w > bestWords) { best = c; bestWords = w; } }
  return best && bestWords >= Math.max(50, bodyWords * 0.3) ? best : bodyClean;
}
// Text a JavaScript-rendered page ships inside its data (Next.js, JSON-LD articleBody), used only when the HTML has almost none
function scriptText(doc) {
  const out = [];
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) { try { const d = JSON.parse(s.textContent || "{}"); for (const it of [].concat(d["@graph"] || d)) for (const k of ["articleBody", "text", "description"]) if (typeof it?.[k] === "string") out.push(it[k]); } catch { } }
  const nd = doc.getElementById("__NEXT_DATA__");
  if (nd) { try { const walk = v => { if (typeof v === "string") { if (v.length >= 40 && /[a-z]{3,}\s+[a-z]{3,}/i.test(v) && !/^(https?:|\/|[{[])/.test(v)) out.push(v); } else if (v && typeof v === "object") Object.values(v).forEach(walk); }; walk(JSON.parse(nd.textContent || "{}").props); } catch { } }
  return [...new Set(out)].join(" ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
// links inside the content, stored compactly as [position in links_out, link text]
function compactLinks(d) { const idx = new Map((d.links_out || []).map((u, i) => [u, i])); d.links_main = (d._main_links || []).filter(l => idx.has(l.url)).map(l => [idx.get(l.url), l.text]); delete d._main_links; return d; }
export function extract(url, html, host) { return compactLinks(extractRaw(url, html, host)); }
function extractRaw(url, html, host) {
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
  const main = mainContent(doc);
  let text = (main.textContent || "").replace(/\s+/g, " ").trim(), jsText = false;
  if (text.split(" ").length < 50) { const st = scriptText(doc); if (st.split(" ").length > text.split(" ").length + 30) { text = st; jsText = true; } }
  return { url, title, meta_description: meta("description").trim(), h1, h2, word_count: text ? text.split(" ").length : 0, excerpt: text.slice(0, 1200),
    lang: doc.documentElement.getAttribute("lang") || "", canonical: canon ? (() => { try { return new URL(canon, url).toString(); } catch { return canon; } })() : "",
    noindex: /noindex/i.test(meta("robots")), date, has_author: hasAuthor, images: imgs.length, images_missing_alt: imgs.filter(i => !(i.getAttribute("alt") || "").trim()).length,
    // each image (up to 25): address, alt (null = no alt attribute), width/height given, lazy, in the main content, position
    imgs_d: (() => { const mainEl = mainContent(doc); return imgs.slice(0, 25).map((im, k) => { const src = im.getAttribute("src") || im.getAttribute("data-src") || (im.getAttribute("srcset") || "").split(/\s+/)[0] || "";
      let abs = ""; try { abs = src && !src.startsWith("data:") ? new URL(src, url).toString() : ""; } catch { }
      return abs ? [abs.slice(0, 400), im.hasAttribute("alt") ? (im.getAttribute("alt") || "").slice(0, 160) : null, im.hasAttribute("width") && im.hasAttribute("height") ? 1 : 0, (im.getAttribute("loading") || "") === "lazy" ? 1 : 0, mainEl && mainEl.contains(im) ? 1 : 0, k,
        (im.closest("figure")?.querySelector("figcaption")?.textContent || im.closest("p,li,figure,section")?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 140),
        im.hasAttribute("srcset") || !!im.closest("picture")?.querySelector("source[srcset]") ? 1 : 0] : null; }).filter(Boolean); })(),
    viewport: !!doc.querySelector('meta[name="viewport" i]'),
    og: !!(doc.querySelector('meta[property="og:title"]') && doc.querySelector('meta[property="og:image"]')),
    hreflang: doc.querySelectorAll('link[rel="alternate"][hreflang]').length,
    insecure_resources: insecure, html_bytes: htmlBytes,
    links_out: [...new Set(links)].filter(l => l !== norm(url)).slice(0, 150),
    internal_links: new Set(links).size, schema_types: [...new Set(schema.map(String))].slice(0, 8), _links: [...new Set(links)].slice(0, 300),
    // links inside the main content (not menus or footers), with their link text, and a short text sample for link suggestions
    // links to other websites: [address, 1 if inside the main content], up to 30
    links_ext: (() => { const inMain = new Set([...main.querySelectorAll("a[href]")].map(a => a.getAttribute("href"))), seen = new Set(), out = [];
      for (const a of doc.querySelectorAll("a[href]")) { const raw = a.getAttribute("href"); let u; try { u = new URL(raw, url); } catch { continue; }
        if (!/^https?:$/.test(u.protocol) || sameSite(u.toString(), host)) continue; u.hash = ""; const k = u.toString(); if (seen.has(k)) continue; seen.add(k);
        out.push([k, inMain.has(raw) ? 1 : 0]); if (out.length >= 30) break; } return out; })(),
    _main_links: (() => { const seen = new Set(), out = []; for (const a of main.querySelectorAll("a[href]")) { let u; try { u = norm(new URL(a.getAttribute("href"), url).toString()); } catch { continue; }
      if (!/^https?:/.test(u) || !sameSite(u, host) || u === norm(url) || seen.has(u)) continue; seen.add(u); out.push({ url: u, text: (a.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40) }); if (out.length >= 40) break; } return out; })(),
    text_more: text.slice(1200, 2500),
    // dates: article meta tags, JSON-LD, or a <time> element (AI tools favour visibly dated, recently updated pages)
    ...(() => { const meta = n => doc.querySelector(`meta[property="${n}"],meta[name="${n}"],meta[itemprop="${n}"]`)?.getAttribute("content") || "";
      const ld = [...doc.querySelectorAll('script[type="application/ld+json"]')].map(x => x.textContent).join(" "), pick = k => (ld.match(new RegExp(`"${k}"\\s*:\\s*"(\\d{4}-\\d{2}-\\d{2})`)) || [])[1] || "";
      const t = doc.querySelector("time[datetime]")?.getAttribute("datetime") || "", d = v => /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : "";
      return { date_published: d(meta("article:published_time")) || pick("datePublished") || d(t), date_modified: d(meta("article:modified_time")) || d(meta("og:updated_time")) || pick("dateModified") }; })(),   // the excerpt plus this = the first 2,500 characters
    sig: minhash(text), paras: paragraphs(main),   // fingerprints of the whole text and of its paragraphs, for the duplicate content finder
    ...(jsText ? { text_from_scripts: true } : {}), _text: text.slice(0, 40000), _outline: [...main.querySelectorAll("h2,h3")].map(h => (h.tagName === "H2" ? "## " : "### ") + h.textContent.replace(/\s+/g, " ").trim()).slice(0, 60) };
}
import { htmlToMarkdown } from "./md.js";
// read a live page as Markdown (for Review a draft)
export async function readPageMarkdown(url) {
  const r = await fetchPage(url);
  if (!r || r.status !== 200 || !r.body) throw new Error(`Couldn't read ${url} (${r?.error || "status " + r?.status})`);
  const doc = new DOMParser().parseFromString(r.body, "text/html");
  const meta = doc.querySelector('meta[name="description" i]')?.getAttribute("content") || "";
  const title = (doc.querySelector("title")?.textContent || "").trim();
  const main = mainContent(doc);
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

export async function crawl(startUrl, maxPages = 200, onProgress = () => {}, signal = null) {
  PACE.wait = 0; PACE.retries = 0; PACE.limit = 6; PACE.active = 0; PACE.okStreak = 0;
  let start = /^https?:/i.test(startUrl) ? startUrl : "https://" + startUrl;
  onProgress("Opening the homepage…");
  const r0 = await fetchPage(start);
  if (r0 && BLOCKED.has(r0.status)) throw new Error(`${start} is blocking automated reading right now (status ${r0.status}: ${r0.status === 429 ? "too many requests" : r0.status === 403 ? "forbidden, usually bot protection" : "unavailable"}). Wait a few minutes and try again with fewer pages. If it's your site, allow the reader in your bot protection or firewall settings.`);
  if (!r0 || !r0.status || r0.status >= 400 || !r0.body) throw new Error(`Could not open ${start} (${r0?.error || "status " + r0?.status})`);
  start = norm(r0.url || start); const host = new URL(start).host, base = `${new URL(start).protocol}//${host}`;
  onProgress("Reading robots.txt and sitemaps…");
  let canFetch = () => true, sitemaps = [];
  try { const rr = await fetchPage(base + "/robots.txt"); if (rr.status === 200 && rr.body) { canFetch = robots(rr.body); sitemaps = rr.body.split(/\r?\n/).filter(l => /^sitemap:/i.test(l.trim())).map(l => l.trim().slice(8).trim()); } } catch (e) { if (/token|function/.test(e.message)) throw e; }
  if (!sitemaps.length) sitemaps = [base + "/sitemap.xml", base + "/sitemap_index.xml"];
  const seen = new Set(), budget = { urls: 0 }; let found = [];
  for (const sm of sitemaps) { if (signal?.aborted) break; found = found.concat(await parseSitemap(sm, host, seen, 0, budget)); }
  let source = "sitemap";
  if (!found.length) { source = "links"; const home = extract(start, r0.body, host); found = [[start, ""], ...home._links.map(u => [u, ""])]; }
  // the address entered has a path (/es, /blog): stay inside it, so a language or section is read on its own
  const scope = (() => { try { return new URL(/^https?:/i.test(startUrl) ? startUrl : "https://" + startUrl).pathname.replace(/\/+$/, ""); } catch { return ""; } })();
  if (scope && scope !== "/") {
    const inScope = found.filter(([u]) => { try { const p = new URL(u).pathname.replace(/\/+$/, ""); return p === scope || p.startsWith(scope + "/"); } catch { return false; } });
    if (inScope.length >= 5) { found = inScope; onProgress(`Reading only pages under ${scope}/…`); }
  }
  const dedup = new Map(); for (const [u, lm] of found) if (!SKIP.test(u) && canFetch(u) && !dedup.has(u)) dedup.set(u, lm);
  if (!dedup.has(start)) dedup.set(start, "");
  const urls = [...dedup];
  let picked = sampleFair(urls, maxPages); if (!picked.some(([u]) => u === start)) picked.unshift([start, ""]);
  const pages = new Array(picked.length); let done = 0, i = 0;
  const worker = async () => {
    while (i < picked.length && !signal?.aborted) {
      const k = i++, [u, lm] = picked[k];
      try { const r = await fetchPage(u);
        pages[k] = (!r || r.status !== 200 || !r.body || r.error || !/html/i.test(r.contentType || "html"))
          ? { url: u, status: r?.status || 0, error: r?.error || "not an HTML page", kind: !r ? "error" : BLOCKED.has(r.status) ? "blocked" : r.status === 200 ? "not_page" : "error" }
          : { ...extract(norm(r.url || u), r.body, host), status: 200, lastmod: lm || "", ...(norm(r.url || u) !== norm(u) ? { redirected_from: norm(u) } : {}) };
      } catch (e) { pages[k] = { url: u, status: 0, error: e.message }; }
      done++; if (done % 5 === 0 || done === picked.length) onProgress(`Reading pages… ${done}/${picked.length}`);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  // merge pages that several sitemap URLs redirect to; remember every redirecting source URL
  const byUrl = new Map(), redirects = [];
  for (const p of pages.filter(Boolean)) {
    if (p.status !== 200 || p.error || p.kind) continue;
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
    pages_read: ok.length, pages_failed: pages.filter(p => p && p.kind === "error").length, sections: [...secC].sort((a, b) => b[1] - a[1]).slice(0, 25), languages: [...langC].sort((a, b) => b[1] - a[1]).slice(0, 15),
    median_word_count: wc[Math.floor(wc.length / 2)] || 0, thin_pages_under_300_words: ok.filter(p => p.word_count < 300).map(p => p.url).slice(0, 40),
    duplicate_titles: cnt(ok.map(p => p.title).filter(Boolean)).filter(([, n]) => n > 1).slice(0, 20),
    repeated_title_patterns: cnt(ok.map(p => p.title).filter(Boolean).map(titlePattern)).filter(([, n]) => n >= 3).slice(0, 15),
    missing_meta_description: ok.filter(p => !p.meta_description).length, pages_with_author_signal: ok.filter(p => p.has_author).length,
    pages_with_date: ok.filter(p => p.date).length, redirects: redirects.slice(0, 300),
    partial: !!signal?.aborted, sitemap_capped: budget.urls >= SITEMAP_MAX_URLS || seen.size >= SITEMAP_MAX_FILES, retries: PACE.retries, blocked_pages: pages.filter(p => p && p.kind === "blocked").length, skipped_files: pages.filter(p => p && p.kind === "not_page").length,
    failed_pages: pages.filter(p => p && p.kind === "error").map(p => ({ url: p.url, status: p.status, error: p.error || "" })).slice(0, 200) };
  return { summary, pages: ok };
}
