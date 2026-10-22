// redirects.mjs - follows redirects hop by hop (up to 10) for a batch of addresses, so a site migration can be checked after launch:
// where each old address ends up, through which hops, with which status codes; loops and chains are visible.
//   POST /api/redirects {urls: [...up to 20]} -> {results: [{url, hops:[{url,status,location}], final, final_status, loop}]}
import dns from "node:dns/promises";
import net from "node:net";
import crypto from "node:crypto";

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const PRIVATE = [/^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^::1$/, /^f[cd]/i, /^fe80/i];
async function isPublic(u) {
  if (process.env.FETCH_ALLOW_LOCAL === "1") return true;   // local testing only; never set this on Netlify
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) return false;
  const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => [])).map(a => a.address);
  return addrs.length > 0 && !addrs.some(a => PRIVATE.some(re => re.test(a)));
}
async function gate(req) {   // same rule as the other tools
  const { readToken, enabled: accountsOn } = await import("./_lib/auth.mjs");
  const session = (req.headers.get("cookie") || "").match(/(?:^|;\s*)ce_session=([^;]+)/);
  if (accountsOn()) return session && readToken(session[1]) ? null : json(401, { error: "Please sign in." });
  const tok = process.env.CRAWL_TOKEN; if (!tok) return null;
  const got = req.headers.get("x-crawl-token") || "", a = Buffer.from(got), b = Buffer.from(tok);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? null : json(401, { error: "Add the crawl token in Settings." });
}
// sizes: ask for just the first byte, so servers that don't send Content-Length still state the full size (Content-Range)
async function trace(start, deadline, sizes = false) {
  const hops = [], seen = new Set(); let url = start, loop = false;
  for (let i = 0; i < 10; i++) {
    let u; try { u = new URL(url); } catch { hops.push({ url, status: 0, error: "invalid address" }); break; }
    if (!(await isPublic(u))) { hops.push({ url, status: 0, error: "private address" }); break; }
    if (seen.has(u.toString())) { loop = true; break; } seen.add(u.toString());
    const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), Math.max(1000, Math.min(6000, deadline - Date.now())));
    let r; try { r = await fetch(u, { method: "GET", redirect: "manual", signal: ctrl.signal, headers: { "user-agent": "ContentEngine/1.0 (redirect check)", ...(sizes ? { range: "bytes=0-0" } : {}) } }); }
    catch (e) { hops.push({ url: u.toString(), status: 0, error: e.name === "AbortError" ? "timed out" : "unreachable" }); break; }
    finally { clearTimeout(t); }
    const loc = r.headers.get("location"), type = (r.headers.get("content-type") || "").split(";")[0].trim();
    const total = Number((r.headers.get("content-range") || "").split("/")[1]) || null; let len = r.status === 206 ? total : (Number(r.headers.get("content-length")) || null), over = false;
    // some image servers send no size at all: count the bytes as they arrive, stopping at 3 MB (images only, when sizes are asked for)
    if (sizes && !len && (r.status === 200 || r.status === 206) && /^image\//.test(type) && r.body) {
      const reader = r.body.getReader(), cap = 3 * 1024 * 1024, stop = Math.min(deadline - 1200, Date.now() + 5000); let n = 0;
      try { while (Date.now() < stop) { const { value, done } = await reader.read(); if (done) break; n += value.length; if (n > cap) { over = true; break; } } } catch { }
      if (n) len = n; if (Date.now() >= stop && !over) over = "partial";
      try { await reader.cancel(); } catch { }
    } else { try { await r.body?.cancel(); } catch { } }
    hops.push({ url: u.toString(), status: r.status === 206 ? 200 : r.status, ...(loc ? { location: loc } : {}), ...(len ? { bytes: len } : {}), ...(over ? { at_least: true } : {}), ...(type ? { type } : {}) });
    if (r.status >= 300 && r.status < 400 && loc) { url = new URL(loc, u).toString(); continue; }
    break;
  }
  const last = hops[hops.length - 1] || {};
  return { url: start, hops, final: last.url || start, final_status: last.status || 0, loop, ...(last.error ? { error: last.error } : {}), ...(last.bytes ? { bytes: last.bytes } : {}), ...(last.at_least ? { at_least: true } : {}), ...(last.type ? { type: last.type } : {}) };
}

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const blocked = await gate(req); if (blocked) return blocked;
  const b = await req.json().catch(() => ({}));
  const urls = (Array.isArray(b.urls) ? b.urls : []).map(String).filter(u => /^https?:\/\//.test(u)).slice(0, 20);
  if (!urls.length) return json(400, { error: "Add page addresses to check." });
  const deadline = Date.now() + 8500, results = [];
  // a few at a time, within the function's time limit
  for (let i = 0; i < urls.length; i += 5) {
    if (Date.now() > deadline - 1500) { for (const u of urls.slice(i)) results.push({ url: u, skipped: true }); break; }
    results.push(...await Promise.all(urls.slice(i, i + 5).map(u => trace(u, deadline, !!b.sizes))));
  }
  return json(200, { results });
};

export const config = { path: "/api/redirects" };
