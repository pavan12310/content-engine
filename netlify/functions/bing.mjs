// bing.mjs - read-only relay to the Bing Webmaster Tools API (free API key from Bing Webmaster Tools → Settings → API access).
// Bing's API doesn't accept requests from browsers, so this passes through only the read-only reports the tool needs.
//   POST /api/bing {key, op, site_url?}
import crypto from "node:crypto";

const BASE = process.env.BING_API_BASE || "https://ssl.bing.com/webmaster/api.svc/json";
const OPS = new Set(["GetUserSites", "GetRankAndTrafficStats", "GetQueryStats", "GetPageStats", "GetCrawlStats", "GetCrawlIssues", "GetUrlSubmissionQuota", "GetLinkCounts", "GetUrlLinks"]);
// keyword research (Bing's own search logs, for any keyword): no website needed, a keyword, country and language instead
const KW_OPS = new Set(["GetKeyword", "GetRelatedKeywords", "GetKeywordStats"]);
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
  if (b.op === "PageRank") {
    const ok = String(b.opr_key || "").trim(), domains = [...new Set((Array.isArray(b.domains) ? b.domains : []).map(d => String(d).toLowerCase().trim()).filter(d => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)))].slice(0, 100);
    if (!/^[A-Za-z0-9]{20,80}$/.test(ok)) return json(400, { error: "That doesn't look like an Open PageRank key." }); if (!domains.length) return json(200, { data: [] });
    const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 9000);
    try { const r = await fetch(`${process.env.OPR_BASE || "https://openpagerank.com"}/api/v1.0/getPageRank?${domains.map(d => `domains[]=${encodeURIComponent(d)}`).join("&")}`, { signal: ctrl.signal, headers: { "API-OPR": ok, accept: "application/json" } });
      const d = await r.json().catch(() => null);
      if (r.status === 401 || r.status === 403) return json(401, { error: "Open PageRank didn't accept the key. Check it in Settings → Google & Bing." });
      if (!r.ok || !d) return json(502, { error: `Open PageRank answered with an error (${r.status}).` });
      return json(200, { data: (d.response || []).map(x => ({ domain: x.domain, strength: x.status_code === 200 ? Number(x.page_rank_decimal || 0) : null, rank: x.rank ? Number(x.rank) : null })) });
    } catch (e) { return json(504, { error: "Open PageRank took too long to answer." }); } finally { clearTimeout(t); }
  }
  const key = String(b.key || "").trim(), op = String(b.op || "");
  if (!/^[A-Za-z0-9]{16,64}$/.test(key)) return json(400, { error: "That doesn't look like a Bing Webmaster API key (32 letters and numbers)." });
  if (!OPS.has(op) && !KW_OPS.has(op)) return json(400, { error: "Unknown Bing report." });
  const q = new URLSearchParams({ apikey: key });
  if (KW_OPS.has(op)) {
    const kw = String(b.q || "").trim().slice(0, 100), country = String(b.country || "us").toLowerCase(), language = String(b.language || "en-US");
    if (!kw) return json(400, { error: "Type a keyword." });
    if (!/^[a-z]{2}$/.test(country) || !/^[a-z]{2}(-[A-Za-z]{2})?$/.test(language)) return json(400, { error: "Choose a country and language." });
    q.set("q", kw); q.set("country", country); q.set("language", language);
    if (op !== "GetKeywordStats") for (const d of ["startDate", "endDate"]) { const v = String(b[d] || ""); if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return json(400, { error: "Dates must be YYYY-MM-DD." }); q.set(d, v); }
  } else if (op === "GetLinkCounts" || op === "GetUrlLinks") {
    if (!/^https?:\/\//.test(b.site_url || "")) return json(400, { error: "Choose the Bing website." }); q.set("siteUrl", b.site_url);
    q.set("page", String(Math.max(0, Math.min(20, parseInt(b.page) || 0))));
    if (op === "GetUrlLinks") { let lu; try { lu = new URL(String(b.link || "")); } catch { return json(400, { error: "Which page's links?" }); }
      if (lu.hostname.replace(/^www\./, "") !== new URL(b.site_url).hostname.replace(/^www\./, "")) return json(400, { error: "That page isn't on this website." }); q.set("link", lu.href); }
  } else if (op !== "GetUserSites") { if (!/^https?:\/\//.test(b.site_url || "")) return json(400, { error: "Choose the Bing website." }); q.set("siteUrl", b.site_url); }
  const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 9000);
  try {
    const r = await fetch(`${BASE}/${op}?${q}`, { signal: ctrl.signal, headers: { accept: "application/json" } });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d) return json(r.status === 200 ? 502 : r.status, { error: explain(r.status, d) });
    if (op === "GetUrlLinks" && !((d.d ?? d)?.Details || []).length) {
      const q2 = new URLSearchParams(q); q2.set("link", JSON.stringify(q.get("link")));
      const r2 = await fetch(`${BASE}/${op}?${q2}`, { signal: ctrl.signal, headers: { accept: "application/json" } }).catch(() => null), d2 = r2 && r2.ok ? await r2.json().catch(() => null) : null;
      if (d2 && ((d2.d ?? d2)?.Details || []).length) return json(200, { data: d2.d ?? d2 });
    }
    return json(200, { data: d.d ?? d });
  } catch (e) { return json(504, { error: e.name === "AbortError" ? "Bing took too long to answer. Try again." : "Couldn't reach Bing." }); }
  finally { clearTimeout(t); }
};

export const config = { path: "/api/bing" };
