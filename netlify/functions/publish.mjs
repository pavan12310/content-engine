// publish.mjs - publishing approved pages to Webflow CMS (Data API v2, site token) and HubSpot blog (CMS v3, private app token).
// Tokens come from the person's browser with each request (like WordPress details); nothing is stored here.
// Pages are added as drafts unless publishing is chosen; a page only ever updates the item or post this tool created.
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
const WF = () => process.env.WEBFLOW_BASE || "https://api.webflow.com";     // *_BASE: local tests only
const HS = () => process.env.HUBSPOT_BASE || "https://api.hubapi.com";
class Bad extends Error { constructor(status, m) { super(m); this.status = status; } }
async function call(base, path, token, { method = "GET", body } = {}, explain) {
  const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 8500);
  try {
    const r = await fetch(`${base}${path}`, { method, signal: ctrl.signal, headers: { authorization: `Bearer ${token}`, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const txt = await r.text().catch(() => ""); let d; try { d = txt ? JSON.parse(txt) : {}; } catch { d = { message: txt.slice(0, 300) }; }   // some errors are plain text
    if (!r.ok) throw new Bad(r.status, explain(r.status, d));
    return d;
  } catch (e) { if (e instanceof Bad) throw e; throw new Bad(504, e.name === "AbortError" ? "The CMS took too long to answer. Try again." : "Couldn't reach the CMS."); }
  finally { clearTimeout(t); }
}
const wfErr = (s, d) => { const m = JSON.stringify(d || {});
  if (s === 401) return "Webflow didn't accept the token. In Webflow, open Site settings → Apps & integrations → API access, and generate a site token with CMS read and write access.";
  if (s === 403) return "This Webflow token can't do that. Generate a site token with CMS read and write access (and Sites read).";
  if (/unique|already in database|duplicate/i.test(m)) return "That collection already has an item with this address (slug). Change the page's URL slug (Edit tab), or rename that item in Webflow.";
  if (s === 400 && /required/i.test(m)) return `Webflow says a required field is missing: ${String(d?.message || "").slice(0, 160)} Map it in Websites → Publishing, or make it optional in Webflow.`;
  if (s === 404) return "Webflow couldn't find that collection or item. Test the connection again.";
  if (s === 429) return "Webflow's rate limit was reached. Try again in a minute.";
  return `Webflow answered with an error (${s}). ${String(d?.message || "").slice(0, 200)}`; };
const hsErr = (s, d) => {
  if (s === 400 && /invalid request/i.test(JSON.stringify(d || {}) + String(d?.message || ""))) return "That doesn't look like a HubSpot private app token (they start with “pat-”). Copy the access token from Settings → Integrations → Private apps.";
  if (s === 401) return "HubSpot didn't accept the token. Create a private app (Settings → Integrations → Private apps) with the “content” scope, and paste its access token.";
  if (s === 403) return "This HubSpot token can't edit blog posts. Give the private app the “content” scope.";
  if (s === 404) return "HubSpot couldn't find that blog or post. Test the connection again.";
  if (s === 409 || /slug|already exists/i.test(JSON.stringify(d || {}))) return "That blog already has a post at this address (slug). Change the page's URL slug (Edit tab).";
  if (s === 429) return "HubSpot's rate limit was reached. Try again in a minute.";
  return `HubSpot answered with an error (${s}). ${String(d?.message || "").slice(0, 200)}`; };

async function webflow(b, token) {
  const W = (p, o) => call(WF(), p, token, o, wfErr);
  if (b.action === "test") {
    const sites = (await W("/v2/sites")).sites || [], out = [];
    for (const s of sites.slice(0, 5)) {
      const cols = (await W(`/v2/sites/${s.id}/collections`)).collections || [];
      for (const c of cols.slice(0, 12)) { const d = await W(`/v2/collections/${c.id}`);
        out.push({ id: c.id, name: `${c.displayName || c.slug}${sites.length > 1 ? ` (${s.displayName || s.shortName})` : ""}`, site: s.displayName || s.shortName || "", domain: (s.customDomains || [])[0]?.url || (s.shortName ? `${s.shortName}.webflow.io` : ""),
          fields: (d.fields || []).map(f => ({ id: f.slug, name: f.displayName || f.slug, type: f.type, required: !!f.isRequired })) }); }
    }
    return { ok: true, collections: out };
  }
  const col = String(b.collection_id || ""); if (!/^[a-f0-9]{16,40}$/i.test(col)) throw new Bad(400, "Choose a Webflow collection (test the connection first).");
  const fd = b.fieldData && typeof b.fieldData === "object" ? b.fieldData : {}; if (!fd.name || !fd.slug) throw new Bad(400, "The page needs a title and a URL slug.");
  if (b.action === "publish") { await W(`/v2/collections/${col}/items/publish`, { method: "POST", body: { itemIds: [String(b.item_id)] } }); return { ok: true, live: true }; }
  if (b.action !== "save") throw new Bad(400, "Unknown action.");
  // update only the item this tool created; a new page is created as a draft (publishing is a separate step)
  if (b.item_id) { const d = await W(`/v2/collections/${col}/items/${encodeURIComponent(b.item_id)}`, { method: "PATCH", body: { isDraft: false, fieldData: fd } }); return { ok: true, id: d.id || b.item_id, slug: d.fieldData?.slug || fd.slug, updated: true }; }
  const d = await W(`/v2/collections/${col}/items`, { method: "POST", body: { isDraft: b.mode === "draft", fieldData: fd } });
  return { ok: true, id: d.id, slug: d.fieldData?.slug || fd.slug, updated: false };
}
async function hubspot(b, token) {
  const H = (p, o) => call(HS(), p, token, o, hsErr);
  if (b.action === "test") {
    const blogs = ((await H("/cms/v3/blog-settings/settings?limit=50")).results || []).map(x => ({ id: String(x.id), name: x.name || x.htmlTitle || String(x.id), url: x.absoluteUrl || "" }));
    const authors = ((await H("/cms/v3/blogs/authors?limit=100").catch(() => ({ results: [] }))).results || []).map(a => ({ id: String(a.id), name: a.displayName || a.fullName || a.name || a.email || String(a.id) }));
    return { ok: true, blogs, authors };
  }
  const p = b.post || {}; if (!p.name || !p.slug) throw new Bad(400, "The page needs a title and a URL slug.");
  if (b.action === "publish") {
    const cur = await H(`/cms/v3/blogs/posts/${encodeURIComponent(b.post_id)}`);
    if (cur.currentlyPublished) await H(`/cms/v3/blogs/posts/${encodeURIComponent(b.post_id)}/draft/push-live`, { method: "POST" });
    else await H(`/cms/v3/blogs/posts/${encodeURIComponent(b.post_id)}`, { method: "PATCH", body: { state: "PUBLISHED", publishDate: new Date().toISOString() } });
    const after = await H(`/cms/v3/blogs/posts/${encodeURIComponent(b.post_id)}`); return { ok: true, live: true, url: after.url || "" };
  }
  if (b.action !== "save") throw new Bad(400, "Unknown action.");
  const blog = String(b.blog_id || ""); if (!/^\d+$/.test(blog)) throw new Bad(400, "Choose a HubSpot blog (test the connection first).");
  const body = { name: String(p.name).slice(0, 250), slug: String(p.slug).slice(0, 200), postBody: String(p.postBody || ""), metaDescription: String(p.metaDescription || "").slice(0, 300), htmlTitle: String(p.htmlTitle || p.name).slice(0, 250), contentGroupId: blog, ...(b.author_id ? { blogAuthorId: String(b.author_id) } : {}) };
  // update only the post this tool created (its draft version, so a live post changes only when published)
  if (b.post_id) { const d = await H(`/cms/v3/blogs/posts/${encodeURIComponent(b.post_id)}/draft`, { method: "PATCH", body }); return { ok: true, id: String(d.id || b.post_id), updated: true, url: d.url || "" }; }
  const d = await H("/cms/v3/blogs/posts", { method: "POST", body: { ...body, state: "DRAFT" } });
  return { ok: true, id: String(d.id), updated: false, url: d.url || "" };
}
export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Use POST." });
  const denied = await gate(req); if (denied) return denied;
  const b = await req.json().catch(() => ({})), token = String(b.token || "").trim();
  if (token.length < 20) return json(400, { error: "Paste the API token." });
  try {
    if (b.platform === "webflow") return json(200, await webflow(b, token));
    if (b.platform === "hubspot") return json(200, await hubspot(b, token));
    return json(400, { error: "Unknown platform." });
  } catch (e) { return json(e.status || 502, { error: e.message }); }
};
export const config = { path: "/api/publish" };
