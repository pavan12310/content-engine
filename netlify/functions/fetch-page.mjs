// fetch-page.mjs - reads one public web page for the site crawler.
// Browsers can't fetch other websites directly (CORS), so the crawler asks this function.
// Safety: GET only, http(s) only, no private/internal addresses, 3 MB cap, 9 s timeout,
// HTML/XML/text only, and an optional shared token (set CRAWL_TOKEN in Netlify to require it).
import dns from "node:dns/promises";
import net from "node:net";

const MAX_BYTES = 3 * 1024 * 1024;
const UA = "Mozilla/5.0 (compatible; ContentEngineBot/1.0; +content-audit)";

function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
           (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const l = ip.toLowerCase();
  return l === "::1" || l === "::" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80") || l.startsWith("::ffff:127.") || l.startsWith("::ffff:10.") || l.startsWith("::ffff:192.168.");
}

async function safeUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return "Invalid URL"; }
  if (!["http:", "https:"].includes(u.protocol)) return "Only http and https URLs are allowed";
  if (u.username || u.password) return "URLs with credentials are not allowed";
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) return "Internal hosts are not allowed";
  try {
    const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
    if (addrs.some(a => privateIp(a.address))) return "Private network addresses are not allowed";
  } catch { return "Could not resolve host"; }
  return null;
}

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export default async (req) => {
  if (req.method !== "GET") return json(405, { error: "GET only" });
  const params = new URL(req.url).searchParams;
  const token = process.env.CRAWL_TOKEN;
  if (token && params.get("token") !== token && req.headers.get("x-crawl-token") !== token)
    return json(401, { error: "Crawl token required (set it in the app's Settings)" });
  let target = params.get("url") || "";
  // follow redirects manually so every hop is checked
  for (let hop = 0; hop < 5; hop++) {
    const bad = await safeUrl(target);
    if (bad) return json(400, { error: bad, url: target });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9000);
    let r;
    try {
      r = await fetch(target, { redirect: "manual", signal: ctrl.signal,
        headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,application/xml,text/plain;q=0.9,*/*;q=0.5" } });
    } catch (e) {
      clearTimeout(timer);
      return json(200, { url: target, status: 0, error: e.name === "AbortError" ? "timeout" : "no response" });
    }
    if ([301, 302, 303, 307, 308].includes(r.status) && r.headers.get("location")) {
      clearTimeout(timer);
      target = new URL(r.headers.get("location"), target).toString();
      continue;
    }
    const type = r.headers.get("content-type") || "";
    if (!/html|xml|text\/plain|gzip|octet-stream/i.test(type)) {
      clearTimeout(timer);
      return json(200, { url: target, status: r.status, contentType: type, error: "not an HTML/XML page" });
    }
    // read with a size cap
    const reader = r.body.getReader(); const chunks = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_BYTES) { ctrl.abort(); break; }
        chunks.push(value);
      }
    } catch { /* aborted at cap */ }
    clearTimeout(timer);
    let buf = Buffer.concat(chunks.map(c => Buffer.from(c)));
    if (/\.gz$/i.test(new URL(target).pathname) || /gzip/i.test(type)) {
      try { const zlib = await import("node:zlib"); buf = zlib.gunzipSync(buf); } catch { /* not actually gzipped */ }
    }
    return json(200, { url: target, status: r.status, contentType: type, truncated: size > MAX_BYTES, body: buf.toString("utf8") });
  }
  return json(200, { url: target, status: 0, error: "too many redirects" });
};

export const config = { path: "/api/fetch" };
