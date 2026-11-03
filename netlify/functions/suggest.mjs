// suggest.mjs - real searches people type, from Google, Bing and YouTube autocomplete (not official APIs: used politely, a few at a
// time, with results cached for a week in the browser). POST { queries: [...], sources: ["google","bing","youtube"], hl, gl }.
import crypto from "node:crypto";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
async function gate(req) {   // same rule as the other tools: signed in when accounts are on, or the crawl token when one is set
  const { readToken, enabled: accountsOn } = await import("./_lib/auth.mjs");
  const session = (req.headers.get("cookie") || "").match(/(?:^|;\s*)ce_session=([^;]+)/);
  if (accountsOn()) return session && readToken(session[1]) ? null : json(401, { error: "Please sign in." });
  const tok = process.env.CRAWL_TOKEN; if (!tok) return null;
  const got = req.headers.get("x-crawl-token") || "", a = Buffer.from(got), b = Buffer.from(tok);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? null : json(401, { error: "Add the crawl token in Settings." });
}
const URLS = {   // SUGGEST_BASE: local tests only
  google: (q, hl, gl) => `${process.env.SUGGEST_BASE || "https://suggestqueries.google.com"}/complete/search?client=firefox&hl=${hl}&gl=${gl}&q=${encodeURIComponent(q)}`,
  youtube: (q, hl, gl) => `${process.env.SUGGEST_BASE || "https://suggestqueries.google.com"}/complete/search?client=firefox&ds=yt&hl=${hl}&gl=${gl}&q=${encodeURIComponent(q)}`,
  bing: (q, hl, gl) => `${process.env.SUGGEST_BASE ? process.env.SUGGEST_BASE + "/bing" : "https://api.bing.com"}/osjson.aspx?query=${encodeURIComponent(q)}&market=${hl}-${gl.toUpperCase()}`
};
export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const blocked = await gate(req); if (blocked) return blocked;
  const b = await req.json().catch(() => ({}));
  const queries = [...new Set((Array.isArray(b.queries) ? b.queries : []).map(q => String(q || "").trim().slice(0, 100)).filter(Boolean))].slice(0, 40);
  const sources = (Array.isArray(b.sources) ? b.sources : ["google"]).filter(x => URLS[x]).slice(0, 3);
  const hl = /^[a-z]{2}$/.test(b.hl || "") ? b.hl : "en", gl = /^[a-z]{2}$/.test(b.gl || "") ? b.gl : "us";
  if (!queries.length || !sources.length) return json(400, { error: "Type a keyword." });
  const jobs = sources.flatMap(src => queries.map(q => ({ src, q }))), out = {}, failed = new Set(), refusals = {}, deadline = Date.now() + 8500;
  for (const s of sources) out[s] = {};
  const one = async ({ src, q }, retry = true) => {
    if (Date.now() > deadline || failed.has(src)) return;
    const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 4000);
    try { const r = await fetch(URLS[src](q, hl, gl), { signal: ctrl.signal, headers: { "user-agent": "Mozilla/5.0 (compatible; ContentEngine/4.0)", accept: "application/json" } });
      if (!r.ok) {
        // "too many requests": wait a moment and try once more; a source only counts as stopped after refusing twice in a row
        if (r.status === 429 || r.status === 403) { refusals[src] = (refusals[src] || 0) + 1; if (refusals[src] >= 2 && !retry) failed.add(src);
          if (retry && Date.now() + 1500 < deadline) { clearTimeout(t); await new Promise(z => setTimeout(z, 900)); return one({ src, q }, false); } }
        return; }
      refusals[src] = 0;
      const d = JSON.parse(new TextDecoder("utf-8").decode(await r.arrayBuffer()));
      out[src][q] = (Array.isArray(d?.[1]) ? d[1] : []).map(x => String(x).trim()).filter(Boolean).slice(0, 10); }
    catch { } finally { clearTimeout(t); }
  };
  // gently: three at a time, with a short pause between batches
  for (let i = 0; i < jobs.length; i += 3) { await Promise.all(jobs.slice(i, i + 3).map(j => one(j))); if (i + 3 < jobs.length) await new Promise(z => setTimeout(z, 120)); }
  return json(200, { results: out, blocked: [...failed], incomplete: jobs.some(j => !(j.q in out[j.src]) && !failed.has(j.src)) });
};
export const config = { path: "/api/suggest" };
