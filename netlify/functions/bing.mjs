// bing.mjs - read-only relay to the Bing Webmaster Tools API (free API key from Bing Webmaster Tools → Settings → API access).
// Bing's API doesn't accept requests from browsers, so this passes through only the read-only reports the tool needs.
//   POST /api/bing {key, op, site_url?}
import crypto from "node:crypto";

const BASE = process.env.BING_API_BASE || "https://ssl.bing.com/webmaster/api.svc/json";
const OPS = new Set(["GetUserSites", "GetRankAndTrafficStats", "GetQueryStats", "GetPageStats", "GetCrawlStats", "GetCrawlIssues", "GetUrlSubmissionQuota"]);
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
async function gate(req) {   // same rule as the other tools: signed in when accounts are on, or the crawl token when one is set
  const { readToken, enabled: accountsOn } = await import("./_lib/auth.mjs");
  const session = (req.headers.get("cookie") || "").match(/(?:^|;\s*)ce_session=([^;]+)/);
  if (accountsOn()) return session && readToken(session[1]) ? null : json(401, { error: "Please sign in." });
  const tok = process.env.CRAWL_TOKEN; if (!tok) return null;
  const got = req.headers.get("x-crawl-token") || "", a = Buffer.from(got), b = Buffer.from(tok);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? null : json(401, { error: "Add the crawl token in Settings." });
}
const explain = (status, d) => {
  const m = JSON.stringify(d || {});
  if (/InvalidApiKey|ApiKey/i.test(m) || status === 401) return "Bing didn't accept the API key. Create one in Bing Webmaster Tools → Settings → API access, and paste it in Settings.";
  if (/NotAuthorized|UserNotAuthorized|SiteNotAuthorized|NotVerified/i.test(m) || status === 403) return "This Bing account can't see that website. Add and verify it in Bing Webmaster Tools (you can import it from Google Search Console in one click).";
  if (/ThrottleUser|TooManyRequests/i.test(m) || status === 429) return "Bing's limit was reached for now. Try again in a few minutes.";
  return `Bing answered with an error (${status}).`;
};

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const blocked = await gate(req); if (blocked) return blocked;
  const b = await req.json().catch(() => ({}));
  const key = String(b.key || "").trim(), op = String(b.op || "");
  if (!/^[A-Za-z0-9]{16,64}$/.test(key)) return json(400, { error: "That doesn't look like a Bing Webmaster API key (32 letters and numbers)." });
  if (!OPS.has(op)) return json(400, { error: "Unknown Bing report." });
  const q = new URLSearchParams({ apikey: key }); if (op !== "GetUserSites") { if (!/^https?:\/\//.test(b.site_url || "")) return json(400, { error: "Choose the Bing website." }); q.set("siteUrl", b.site_url); }
  const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 9000);
  try {
    const r = await fetch(`${BASE}/${op}?${q}`, { signal: ctrl.signal, headers: { accept: "application/json" } });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d) return json(r.status === 200 ? 502 : r.status, { error: explain(r.status, d) });
    return json(200, { data: d.d ?? d });
  } catch (e) { return json(504, { error: e.name === "AbortError" ? "Bing took too long to answer. Try again." : "Couldn't reach Bing." }); }
  finally { clearTimeout(t); }
};

export const config = { path: "/api/bing" };
