// wayback.mjs - page history from the Internet Archive's Wayback Machine (free).
// It only ever contacts web.archive.org, building the address itself from the page address, so it can't be used to reach anything else.
//   POST /api/wayback {op:"history", url}          -> distinct archived versions (newest first)
//   POST /api/wayback {op:"snapshot", url, timestamp} -> the archived page's original HTML (no Wayback toolbar)
import crypto from "node:crypto";

const BASE = process.env.WAYBACK_BASE || "https://web.archive.org";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
async function gate(req) {   // same rule as the other tools: signed in when accounts are on, or the crawl token when one is set
  const { readToken, enabled: accountsOn } = await import("./_lib/auth.mjs");
  const session = (req.headers.get("cookie") || "").match(/(?:^|;\s*)ce_session=([^;]+)/);
  if (accountsOn()) return session && readToken(session[1]) ? null : json(401, { error: "Please sign in." });
  const tok = process.env.CRAWL_TOKEN; if (!tok) return null;
  const got = req.headers.get("x-crawl-token") || "", a = Buffer.from(got), b = Buffer.from(tok);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? null : json(401, { error: "Add the crawl token in Settings." });
}
async function get(url, ms) {
  const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { signal: ctrl.signal, redirect: "follow", headers: { "user-agent": "ContentEngine/1.0 (page history)" } }); } finally { clearTimeout(t); }
}

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const blocked = await gate(req); if (blocked) return blocked;
  const b = await req.json().catch(() => ({}));
  let page; try { page = new URL(String(b.url || "")); if (!/^https?:$/.test(page.protocol)) throw 0; } catch { return json(400, { error: "Enter a full page address, starting with https://" }); }
  const target = page.toString().replace(/#.*$/, "");
  try {
    if (b.op === "history") {
      // distinct versions only (collapse by content digest), newest 150
      const q = new URLSearchParams({ url: target, output: "json", fl: "timestamp,original,statuscode,digest,length", collapse: "digest", limit: "-150" });
      const r = await get(`${BASE}/cdx/search/cdx?${q}`, 9000);
      if (r.status === 429) return json(429, { error: "The Internet Archive is limiting requests right now. Try again in a minute." });
      if (!r.ok) return json(502, { error: `The Internet Archive answered ${r.status}. It's sometimes slow or down; try again shortly.` });
      const rows = await r.json().catch(() => []);
      const [head, ...data] = Array.isArray(rows) ? rows : [];
      const versions = data.map(x => ({ timestamp: x[0], url: x[1], status: x[2] === "-" ? null : Number(x[2]), digest: x[3], length: Number(x[4]) || null })).reverse();
      return json(200, { url: target, versions });
    }
    if (b.op === "snapshot") {
      const ts = String(b.timestamp || "");
      if (!/^\d{8,14}$/.test(ts)) return json(400, { error: "Choose a version." });
      const r = await get(`${BASE}/web/${ts}id_/${target}`, 9000);   // "id_" returns the page as it was, without the archive's toolbar
      if (!r.ok) return json(r.status === 404 ? 404 : 502, { error: r.status === 404 ? "That version isn't available in the archive." : `The Internet Archive answered ${r.status}. Try again shortly.` });
      const type = r.headers.get("content-type") || "";
      if (!/html|text/i.test(type)) return json(415, { error: "That version isn't a web page (it may be a file or an image)." });
      const html = (await r.text()).slice(0, 3_000_000);
      return json(200, { url: target, timestamp: ts, html, archive_url: `https://web.archive.org/web/${ts}/${target}` });
    }
    return json(400, { error: "Unknown request" });
  } catch (e) {
    return json(504, { error: e.name === "AbortError" ? "The Internet Archive took too long to answer (it's often slow). Try again." : "Couldn't reach the Internet Archive." });
  }
};

export const config = { path: "/api/wayback" };
