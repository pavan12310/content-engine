// gsc.mjs - Google Search Console connection (OAuth 2.0, read-only scope).
// Needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Netlify. The long-lived Google refresh token is encrypted here
// (AES-256-GCM, key derived from the client secret) and only the encrypted form goes to the browser; nothing is stored
// on the server. Every API call decrypts it, gets a short-lived access token, and queries Search Console.
//   GET  /api/gsc?op=status            is the connection set up?
//   GET  /api/gsc?op=start&site=..     returns the Google sign-in URL (signed, expiring state)
//   GET  /api/gsc/callback             Google returns here; redirects back to the app with the encrypted token in the URL fragment
//   POST /api/gsc {op:"sites"|"query"|"revoke", token, ...}
import crypto from "node:crypto";

const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
// Google Analytics 4 (read-only), through the same Google app and return address
const GA_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const GA_DATA = process.env.GA_DATA_BASE || "https://analyticsdata.googleapis.com/v1beta";
const GA_ADMIN = process.env.GA_ADMIN_BASE || "https://analyticsadmin.googleapis.com/v1beta";
async function gaFetch(url, at, body) {
  const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 20000);
  try { const r = await fetch(url, { method: body ? "POST" : "GET", signal: ctrl.signal, headers: { authorization: `Bearer ${at}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { const m = d.error?.message || ""; const e = new Error(r.status === 401 ? "Google ended this connection. Connect again." : r.status === 403 ? (/has not been used|disabled/i.test(m) ? "The Google Analytics Data API or Admin API isn't enabled in your Google Cloud project (see the README)." : "This Google account can't see that Analytics property.") : `Google Analytics error ${r.status}: ${m.slice(0, 160)}`); e.status = r.status; e.detail = m; throw e; }
    return d; } finally { clearTimeout(t); }
}
// the property's key events (newer properties), or conversion events (older ones)
export async function ga4Events(at, prop) {
  for (const path of ["keyEvents", "conversionEvents"]) { try { const d = await gaFetch(`${GA_ADMIN}/${prop}/${path}?pageSize=200`, at); const list = (d.keyEvents || d.conversionEvents || []).map(e => e.eventName).filter(Boolean); if (list.length || path === "conversionEvents") return list; } catch (e) { if (e.status !== 404 && e.status !== 400) throw e; } }
  return [];
}
// landing pages for this period and the one before (one request with two date ranges), and visitors from AI assistants.
// event: count only that key event (e.g. "purchase"); empty = all key events. Shared with the weekly check.
const AI_SOURCES = "chatgpt|openai|perplexity|gemini|bard|copilot|claude|anthropic|you\\.com|phind|poe\\.com|deepseek|meta\\.ai|mistral";
export async function ga4Report(at, prop, { days = 28, organic = false, event = "" } = {}) {
  days = Math.min(Math.max(Number(days) || 28, 7), 365);
  const ranges = [{ startDate: `${days}daysAgo`, endDate: "yesterday", name: "now" }, { startDate: `${days * 2}daysAgo`, endDate: `${days + 1}daysAgo`, name: "before" }];
  const ev = String(event || "").replace(/[^\w.-]/g, "").slice(0, 60);
  const run = async (conv) => {
    const convMetric = ev ? `${conv}:${ev}` : conv, metrics = ["sessions", "engagedSessions", convMetric, "totalRevenue"].map(name => ({ name }));
    const pages = await gaFetch(`${GA_DATA}/${prop}:runReport`, at, { dateRanges: ranges, dimensions: [{ name: "landingPage" }], metrics, limit: 2500, orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      ...(organic ? { dimensionFilter: { filter: { fieldName: "sessionDefaultChannelGroup", stringFilter: { matchType: "EXACT", value: "Organic Search" } } } } : {}) });
    const ai = await gaFetch(`${GA_DATA}/${prop}:runReport`, at, { dateRanges: ranges, dimensions: [{ name: "sessionSource" }], metrics: [{ name: "sessions" }, { name: convMetric }], limit: 100,
      dimensionFilter: { filter: { fieldName: "sessionSource", stringFilter: { matchType: "PARTIAL_REGEXP", value: AI_SOURCES, caseSensitive: false } } } }).catch(() => ({ rows: [] }));
    return { pages, ai, conv };
  };
  let r; try { r = await run("keyEvents"); } catch (e) { if (e.status !== 400) throw e; r = await run("conversions"); }   // older properties call key events "conversions"
  // with two date ranges, Google adds the range name as the last dimension
  const pick = (row, k) => +row.metricValues[k].value || 0, rangeOf = row => row.dimensionValues[row.dimensionValues.length - 1]?.value || "now";
  const by = new Map();
  for (const row of r.pages.rows || []) { const path = row.dimensionValues[0].value, o = by.get(path) || { path, sessions: 0, engaged: 0, conversions: 0, revenue: 0, prev: { sessions: 0, conversions: 0, revenue: 0 } };
    if (rangeOf(row) === "before") { o.prev.sessions += pick(row, 0); o.prev.conversions += pick(row, 2); o.prev.revenue += pick(row, 3); }
    else { o.sessions += pick(row, 0); o.engaged += pick(row, 1); o.conversions += pick(row, 2); o.revenue = Math.round((o.revenue + pick(row, 3)) * 100) / 100; }
    by.set(path, o); }
  const ai = new Map(); for (const row of r.ai.rows || []) { const src = row.dimensionValues[0].value, o = ai.get(src) || { source: src, sessions: 0, conversions: 0, prev_sessions: 0 };
    if (rangeOf(row) === "before") o.prev_sessions += pick(row, 0); else { o.sessions += pick(row, 0); o.conversions += pick(row, 1); } ai.set(src, o); }
  return { rows: [...by.values()], ai: [...ai.values()].sort((a, b) => b.sessions - a.sessions), conv_metric: r.conv, event: ev, currency: r.pages.metadata?.currencyCode || "", days, organic };
}
async function gaProperties(at) {
  const out = []; let page = "";
  for (let i = 0; i < 10; i++) { const d = await gaFetch(`${GA_ADMIN}/accountSummaries?pageSize=200${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`, at);
    for (const a of d.accountSummaries || []) for (const p of a.propertySummaries || []) out.push({ id: p.property, name: p.displayName, account: a.displayName });
    if (!d.nextPageToken) break; page = d.nextPageToken; }
  return out;
}
const AUTH_URL = process.env.GOOGLE_AUTH_URL || "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = process.env.GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token";
const REVOKE_URL = process.env.GOOGLE_REVOKE_URL || "https://oauth2.googleapis.com/revoke";
const API = process.env.GSC_API_BASE || "https://www.googleapis.com/webmasters/v3";
const INSPECT = process.env.GSC_INSPECT_BASE || "https://searchconsole.googleapis.com/v1";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
export const configured = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const key = () => crypto.createHash("sha256").update(`${process.env.GOOGLE_CLIENT_SECRET}|content-engine-gsc|${process.env.AUTH_SECRET || ""}`).digest();
const b64u = b => Buffer.from(b).toString("base64url");
function encrypt(text) { const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", key(), iv), ct = Buffer.concat([c.update(text, "utf8"), c.final()]); return b64u(Buffer.concat([iv, c.getAuthTag(), ct])); }
export function decrypt(tok) { const b = Buffer.from(String(tok || ""), "base64url"); if (b.length < 29) throw new Error("bad token");
  const d = crypto.createDecipheriv("aes-256-gcm", key(), b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8"); }
const sign = obj => { const p = b64u(JSON.stringify(obj)); return `${p}.${crypto.createHmac("sha256", key()).update(p).digest("base64url")}`; };
function unsign(s) { const [p, sig] = String(s || "").split("."); if (!p || !sig) return null;
  const want = crypto.createHmac("sha256", key()).update(p).digest("base64url"); if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try { const o = JSON.parse(Buffer.from(p, "base64url").toString()); return o.exp > Date.now() ? o : null; } catch { return null; } }
const redirectUri = req => `${new URL(req.url).origin}/api/gsc/callback`;
async function gate(req) {   // same rule as the website reader: signed in when accounts are on, or the crawl token when one is set
  const { readToken, enabled: accountsOn } = await import("./_lib/auth.mjs");
  const session = (req.headers.get("cookie") || "").match(/(?:^|;\s*)ce_session=([^;]+)/);
  if (accountsOn()) return session && readToken(session[1]) ? null : json(401, { error: "Please sign in." });
  const tok = process.env.CRAWL_TOKEN; if (!tok) return null;
  const got = req.headers.get("x-crawl-token") || new URL(req.url).searchParams.get("ct") || "";
  return got.length === tok.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(tok)) ? null : json(401, { error: "Add the crawl token in Settings." });
}
const ACCESS = new Map();   // short-lived access tokens, cached per connection for this function instance
const REVOKED = new Set();  // connections disconnected while this instance is running
export async function accessToken(enc) {
  const refresh = decrypt(enc), h = crypto.createHash("sha256").update(refresh).digest("hex"), c = ACCESS.get(h);
  if (REVOKED.has(refresh)) { const e = new Error("This Search Console connection was disconnected. Connect again."); e.status = 401; throw e; }
  if (c && c.exp > Date.now() + 60e3) return c.token;
  const r = await fetch(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, refresh_token: refresh, grant_type: "refresh_token" }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d.error === "invalid_grant" ? "Google ended this connection (the permission was removed, the password changed, or a test-mode app's 7-day limit passed). Connect again." : `Google sign-in failed: ${d.error_description || d.error || r.status}`); e.status = 401; throw e; }
  ACCESS.set(h, { token: d.access_token, exp: Date.now() + (d.expires_in || 3600) * 1000 }); return d.access_token;
}
export async function gapi(path, at, body) {
  const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 20000);
  try { const r = await fetch(API + path, { method: body ? "POST" : "GET", signal: ctrl.signal, headers: { authorization: `Bearer ${at}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(r.status === 401 ? "Google ended this connection. Connect again." : r.status === 403 ? "This Google account can't see that Search Console property. Choose another property, or ask its owner to add you in Search Console." : r.status === 429 ? "Google's Search Console limit was reached. Try again in a few minutes." : `Search Console error ${r.status}: ${d.error?.message || ""}`.trim()); e.status = r.status; throw e; }
    return d; } finally { clearTimeout(t); }
}
const page = (status, html) => new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
const back = (ret, frag) => new Response(null, { status: 302, headers: { location: `${ret || "/"}#${frag}`, "cache-control": "no-store" } });

export default async (req) => {
  const url = new URL(req.url);
  if (url.pathname.endsWith("/callback")) {
    const st = unsign(url.searchParams.get("state"));
    if (!st) return page(400, "<p>This sign-in link expired or was changed. Go back to Content Engine and click Connect again.</p>");
    const ret = /^\/[^/]/.test(st.ret || "") || st.ret === "/" ? st.ret : "/";
    if (url.searchParams.get("error")) return back(ret, `gsc-error=${encodeURIComponent(url.searchParams.get("error") === "access_denied" ? "Google access wasn't granted." : url.searchParams.get("error"))}`);
    const r = await fetch(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: url.searchParams.get("code") || "", client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri(req), grant_type: "authorization_code" }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.refresh_token) return back(ret, `gsc-error=${encodeURIComponent(!r.ok ? `Google sign-in failed: ${d.error_description || d.error || r.status}` : "Google didn't return a lasting permission. Remove Content Engine at myaccount.google.com/permissions and connect again.")}`);
    if (st.product === "ga4") {
      let properties = []; try { properties = await gaProperties(d.access_token); } catch { }
      return back(ret, `ga4-connected=${b64u(JSON.stringify({ site: st.site, token: encrypt(d.refresh_token), properties, at: Date.now() }))}`);
    }
    let sites = [];
    try { sites = ((await gapi("/sites", d.access_token)).siteEntry || []).filter(s => s.permissionLevel !== "siteUnverifiedUser").map(s => s.siteUrl); } catch { }
    const payload = b64u(JSON.stringify({ site: st.site, token: encrypt(d.refresh_token), sites, at: Date.now() }));
    return back(ret, `gsc-connected=${payload}`);
  }
  if (req.method === "GET" && url.searchParams.get("op") === "status") return json(200, { configured: configured(), redirect_uri: redirectUri(req) });
  if (!configured()) return json(501, { error: "Search Console connection isn't set up. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Netlify (see the README), then redeploy." });
  const blocked = await gate(req); if (blocked) return blocked;
  if (req.method === "GET" && url.searchParams.get("op") === "start") {
    const ga = url.searchParams.get("product") === "ga4";
    const state = sign({ n: crypto.randomBytes(8).toString("hex"), site: String(url.searchParams.get("site") || ""), ret: String(url.searchParams.get("ret") || "/"), product: ga ? "ga4" : "gsc", exp: Date.now() + 15 * 60e3 });
    const q = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri(req), response_type: "code", scope: ga ? GA_SCOPE : SCOPE, access_type: "offline", prompt: "consent", include_granted_scopes: "true", state });
    return json(200, { url: `${AUTH_URL}?${q}` });
  }
  if (req.method !== "POST") return json(405, { error: "Unknown request" });
  const b = await req.json().catch(() => ({}));
  try {
    if (b.op === "revoke") { try { const rt = decrypt(b.token); ACCESS.delete(crypto.createHash("sha256").update(rt).digest("hex")); REVOKED.add(rt);   // end access now, not when the cached token expires
      await fetch(`${REVOKE_URL}?token=${encodeURIComponent(rt)}`, { method: "POST" }); } catch { } return json(200, { ok: true }); }
    const at = await accessToken(b.token);
    if (b.op === "sites") return json(200, { sites: ((await gapi("/sites", at)).siteEntry || []).filter(s => s.permissionLevel !== "siteUnverifiedUser").map(s => s.siteUrl) });
    if (b.op === "ga4props") return json(200, { properties: await gaProperties(at) });
    // the sitemaps Google has been given for this property: when it last read them, errors and warnings (read-only)
    if (b.op === "sitemaps") { const prop = String(b.property || ""); if (!prop) return json(400, { error: "Choose the Search Console property." });
      const d = await gapi(`/sites/${encodeURIComponent(prop)}/sitemaps`, at);
      return json(200, { sitemaps: (d.sitemap || []).map(x => ({ path: x.path, last_submitted: x.lastSubmitted || "", last_read: x.lastDownloaded || "", pending: !!x.isPending, index: !!x.isSitemapsIndex,
        errors: Number(x.errors) || 0, warnings: Number(x.warnings) || 0, submitted: (x.contents || []).reduce((a, c) => a + (Number(c.submitted) || 0), 0) })) }); }
    if (b.op === "ga4events") { const prop = String(b.property || ""); if (!/^properties\/\d+$/.test(prop)) return json(400, { error: "Choose a Google Analytics property." }); return json(200, { events: await ga4Events(at, prop) }); }
    if (b.op === "ga4report") { const prop = String(b.property || ""); if (!/^properties\/\d+$/.test(prop)) return json(400, { error: "Choose a Google Analytics property." });
      return json(200, await ga4Report(at, prop, { days: b.days, organic: !!b.organic, event: b.event })); }
    if (b.op === "inspect") {
      // URL Inspection: is this page in Google's index, when was it crawled, which canonical did Google choose
      const prop = String(b.property || ""), url = String(b.url || "");
      if (!/^(sc-domain:|https?:\/\/)/.test(prop) || !/^https?:\/\//.test(url)) return json(400, { error: "Choose a Search Console property and a page address." });
      const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 9000);
      try {
        const r = await fetch(`${INSPECT}/urlInspection/index:inspect`, { method: "POST", signal: ctrl.signal, headers: { authorization: `Bearer ${at}`, "content-type": "application/json" },
          body: JSON.stringify({ inspectionUrl: url, siteUrl: prop, languageCode: "en-US" }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) return json(r.status === 429 ? 429 : r.status === 403 ? 403 : 502, { error: r.status === 429 ? "Google's daily inspection limit for this property was reached (2,000 a day). Try again tomorrow." : r.status === 403 ? "This Google account can't inspect pages for that property." : `URL Inspection error ${r.status}: ${d.error?.message || ""}`.trim() });
        return json(200, { result: d.inspectionResult || {} });
      } catch (e) { return json(504, { error: e.name === "AbortError" ? "Google took too long to inspect this page. Try again." : e.message }); }
      finally { clearTimeout(t); }
    }
    if (b.op === "query") {
      const prop = String(b.property || ""); if (!/^(sc-domain:|https?:\/\/)/.test(prop)) return json(400, { error: "Choose a Search Console property." });
      const q = b.query || {}, body = { startDate: q.startDate, endDate: q.endDate, dimensions: (q.dimensions || []).filter(d => ["date", "query", "page", "device", "country"].includes(d)),
        rowLimit: Math.min(Number(q.rowLimit) || 25000, 25000), startRow: Math.max(Number(q.startRow) || 0, 0), dataState: "final" };
      // optional filter to one page or one search (used for "which searches did this page lose")
      const filters = [];
      if (q.page && /^https?:\/\//.test(q.page)) filters.push({ dimension: "page", operator: "equals", expression: String(q.page).slice(0, 2000) });
      // many searches at once: a pattern like ^(sop software|sop template)$ (Search Console supports these "RE2" patterns)
      if (q.queryRegex) filters.push({ dimension: "query", operator: "includingRegex", expression: String(q.queryRegex).slice(0, 4000) });
      if (filters.length) body.dimensionFilterGroups = [{ filters }];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(body.startDate || "") || !/^\d{4}-\d{2}-\d{2}$/.test(body.endDate || "")) return json(400, { error: "Bad dates." });
      const d = await gapi(`/sites/${encodeURIComponent(prop)}/searchAnalytics/query`, at, body);
      return json(200, { rows: d.rows || [] });
    }
    return json(400, { error: "Unknown request" });
  } catch (e) { return json(e.status === 401 ? 401 : e.status === 403 ? 403 : e.status === 429 ? 429 : 502, { error: e.message }); }
};

export const config = { path: ["/api/gsc", "/api/gsc/callback"] };
