// search.mjs - web search for the free AI options (Built-in AI, Ollama), which can't search by themselves.
// Supports Tavily (1,000 free searches a month, no card) and Brave Search. The key comes either from the person's
// browser (x-search-key header) or, for a team-wide key, from TAVILY_API_KEY / BRAVE_API_KEY in Netlify. A team-wide key
// is only used for requests that carry the team password or crawl token, so strangers can't spend your credits.
import crypto from "node:crypto";

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const BASE = { tavily: process.env.TAVILY_BASE || "https://api.tavily.com", brave: process.env.BRAVE_BASE || "https://api.search.brave.com" };

async function withTimeout(url, opts, ms = 9000) {
  const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); } finally { clearTimeout(t); }
}
const clip = (t, n) => String(t || "").replace(/\s+/g, " ").trim().slice(0, n);

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const body = await req.json().catch(() => ({}));
  const provider = body.provider === "brave" ? "brave" : "tavily";
  const query = clip(body.query, 400), n = Math.min(Math.max(Number(body.max_results) || 6, 1), 10), content = !!body.include_content;
  if (!query) return json(400, { error: "Empty search." });
  let key = req.headers.get("x-search-key") || "";
  if (!key) {   // team-wide key: only for teammates (team password) or people with the crawl token
    const envKey = provider === "brave" ? process.env.BRAVE_API_KEY : process.env.TAVILY_API_KEY;
    const team = process.env.TEAM_PASSWORD, crawl = process.env.CRAWL_TOKEN;
    const session = (req.headers.get("cookie") || "").match(/(?:^|;\s*)ce_session=([^;]+)/);
    const { readToken, enabled: accountsOn } = await import("./_lib/auth.mjs");
    const ok = (accountsOn() && session && !!readToken(session[1])) || (team && same(req.headers.get("x-team-key") || "", team)) || (crawl && same(req.headers.get("x-crawl-token") || "", crawl));
    if (!envKey) return json(400, { error: "Add a search key in Settings (or ask your admin to set one in Netlify)." });
    if (!ok) return json(401, { error: "The team's search key needs the team password or crawl token (set them in Settings)." });
    key = envKey;
  }
  try {
    let r, d;
    if (provider === "tavily") {
      r = await withTimeout(`${BASE.tavily}/search`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({ query, max_results: n, search_depth: "basic", include_answer: false, include_raw_content: content ? "text" : false }) });
      d = await r.json().catch(() => ({}));
      if (!r.ok) return json(r.status === 401 || r.status === 403 ? 401 : r.status === 429 || r.status === 432 || r.status === 433 ? 429 : 502,
        { error: r.status === 401 || r.status === 403 ? "Tavily rejected the search key." : r.status === 429 || r.status === 432 || r.status === 433 ? "Tavily's free searches for this month are used up, or it's rate-limiting." : `Tavily error ${r.status}: ${clip(d.detail?.error || d.error || d.message, 160)}` });
      return json(200, { provider, query, results: (d.results || []).slice(0, n).map(x => ({ title: clip(x.title, 200), url: x.url, snippet: clip(x.content, 600), content: content ? clip(x.raw_content, 3000) : "", published: x.published_date || "" })) });
    }
    r = await withTimeout(`${BASE.brave}/res/v1/web/search?q=${encodeURIComponent(query)}&count=${n}`, { headers: { accept: "application/json", "x-subscription-token": key } });
    d = await r.json().catch(() => ({}));
    if (!r.ok) return json(r.status === 401 || r.status === 403 || r.status === 422 ? 401 : r.status === 429 ? 429 : 502,
      { error: r.status === 401 || r.status === 403 || r.status === 422 ? "Brave rejected the search key." : r.status === 429 ? "Brave's monthly credit is used up, or it's rate-limiting." : `Brave error ${r.status}` });
    const strip = t => String(t || "").replace(/<[^>]+>/g, "");
    return json(200, { provider, query, results: (d.web?.results || []).slice(0, n).map(x => ({ title: clip(strip(x.title), 200), url: x.url, snippet: clip(strip([x.description, ...(x.extra_snippets || [])].join(" ")), 600), content: "", published: x.page_age || x.age || "" })) });
  } catch (e) {
    return json(504, { error: e.name === "AbortError" ? "The search service didn't answer in time. Try again." : "Search failed: " + e.message });
  }
};

export const config = { path: "/api/search" };
