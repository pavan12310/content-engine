// crawl-batch.mjs - reads up to 10 pages of the person's own website in one call, for the whole-site crawl, and returns only what
// Site health checks (status, redirects, speed, title, description, H1s, canonical, noindex, words, links, images without alt text,
// language, structured data), so a 48,000-page site takes about 4,800 calls instead of 48,000. Same safety rules as the page reader.
import crypto from "node:crypto";
import { safeUrl } from "./fetch-page.mjs";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
async function gate(req) {   // same rule as the website reader: signed in, or the crawl token when one is set
  const { readToken, enabled: accountsOn } = await import("./_lib/auth.mjs");
  const session = (req.headers.get("cookie") || "").match(/(?:^|;\s*)ce_session=([^;]+)/);
  if (accountsOn()) return session && readToken(session[1]) ? null : json(401, { error: "Please sign in." });
  const tok = process.env.CRAWL_TOKEN; if (!tok) return null;
  const got = req.headers.get("x-crawl-token") || "", a = Buffer.from(got), b = Buffer.from(tok);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? null : json(401, { error: "Add the crawl token in Settings." });
}
const UA = "Mozilla/5.0 (compatible; ContentEngineBot/1.0; +content-audit)", MAX = 3 * 1024 * 1024;   // same limit as the page reader
const bare = h => String(h || "").toLowerCase().replace(/^www\./, "");
const ent = t => String(t || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/\s+/g, " ").trim();
const attr = (tag, name) => { const m = String(tag).match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i")); return m ? ent(m[2] ?? m[3] ?? m[4] ?? "") : null; };
const metaTag = (html, key, val) => (html.match(new RegExp(`<meta[^>]+${key}\\s*=\\s*["']?${val}["']?[^>]*>`, "i")) || [])[0];
// what Site health checks, from the HTML (no browser needed)
export function compact(html, url, host) {
  const head = html.slice(0, 200000), title = ent((head.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
  const desc = metaTag(head, "name", "description"), robots = metaTag(head, "name", "robots");
  const canon = (head.match(/<link[^>]+rel\s*=\s*["']?canonical["']?[^>]*>/i) || [])[0];
  const h1s = [...html.matchAll(/<h1[\s>][\s\S]*?<\/h1>/gi)].map(m => ent(m[0].replace(/<[^>]+>/g, " ")));
  const body = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>|<svg[\s\S]*?<\/svg>/gi, " ").replace(/<[^>]+>/g, " ");
  let linksInt = 0, linksExt = 0;
  for (const m of html.matchAll(/<a\s[^>]*href\s*=\s*["']([^"'#]+)["']/gi)) { try { const u = new URL(m[1], url); if (!/^https?:$/.test(u.protocol)) continue; bare(u.hostname) === host ? linksInt++ : linksExt++; } catch { } }
  const imgs = [...html.matchAll(/<img\s[^>]*>/gi)].map(m => m[0]);
  return { title, desc: desc ? attr(desc, "content") || "" : null, noindex: /noindex/i.test(robots ? attr(robots, "content") || "" : ""), canonical: canon ? attr(canon, "href") || "" : "",
    h1: h1s.length, h1_text: (h1s[0] || "").slice(0, 160), words: (ent(body).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length, links_int: linksInt, links_ext: linksExt,
    imgs: imgs.length, imgs_noalt: imgs.filter(t => attr(t, "alt") === null).length, lang: attr((html.match(/<html[^>]*>/i) || [""])[0], "lang") || "", schema: (html.match(/application\/ld\+json/gi) || []).length };
}
async function one(url, host, deadline) {
  const t0 = Date.now(); let cur = url, hops = 0;
  for (;;) {
    const bad = await safeUrl(cur); if (bad) return { url, error: bad };
    if (bare(new URL(cur).hostname) !== host) return { url, status: 301, final: cur, offsite: true, ms: Date.now() - t0 };
    const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), Math.max(1000, Math.min(6000, deadline - Date.now())));
    try {
      const r = await fetch(cur, { redirect: "manual", signal: ctrl.signal, headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" } });
      if (r.status >= 300 && r.status < 400 && r.headers.get("location") && hops < 5) { hops++; cur = new URL(r.headers.get("location"), cur).href; try { await r.body?.cancel(); } catch { } continue; }
      const out = { url, status: r.status, ms: Date.now() - t0, ...(cur !== url ? { final: cur, hops } : {}), noindex_header: /noindex/i.test(r.headers.get("x-robots-tag") || "") };
      const type = r.headers.get("content-type") || ""; if (r.status >= 400 || !/html/i.test(type)) { try { await r.body?.cancel(); } catch { } return { ...out, type: type.split(";")[0] }; }
      const reader = r.body.getReader(), chunks = []; let size = 0;
      let cut = false;
      for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > MAX) { cut = true; try { await reader.cancel(); } catch { } break; } chunks.push(value); }
      return { ...out, bytes: size, ...(cut ? { truncated: true } : {}), ...compact(Buffer.concat(chunks.map(c => Buffer.from(c))).toString("utf8"), cur, host) };
    } catch (e) { return { url, error: e.name === "AbortError" ? "too slow" : "couldn't connect", ms: Date.now() - t0 }; }
    finally { clearTimeout(t); }
  }
}
export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Use POST." });
  const denied = await gate(req); if (denied) return denied;
  const b = await req.json().catch(() => ({})); let site; try { site = new URL(b.site); } catch { return json(400, { error: "Which website?" }); }
  const host = bare(site.hostname), urls = [...new Set((Array.isArray(b.urls) ? b.urls : []).map(String))].slice(0, 10);
  // only the person's own website
  for (const u of urls) { try { if (bare(new URL(u).hostname) !== host) return json(400, { error: "Only pages on your own website can be crawled." }); } catch { return json(400, { error: "That isn't a web address." }); } }
  const deadline = Date.now() + 8500, out = [];
  for (let i = 0; i < urls.length; i += 5) {
    if (Date.now() > deadline - 1500) { for (const u of urls.slice(i)) out.push({ url: u, skipped: true }); break; }
    out.push(...await Promise.all(urls.slice(i, i + 5).map(u => one(u, host, deadline))));
  }
  return json(200, { results: out });
};
export const config = { path: "/api/crawl-batch" };
