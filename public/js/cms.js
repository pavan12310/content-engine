// cms.js - publishing approved pages to the website's CMS (WordPress first). Connection details are kept per website
// in this browser only (like AI keys) and sent through the site's /api/cms relay; they're never synced or stored on a server.
import { dbName } from "./store.js";
import { getSettings } from "./llm.js";
const key = siteId => `ce-cms:${dbName()}:${siteId}`;
export function settings(siteId) { try { return { platform: "wordpress", site_url: "", username: "", app_password: "", post_type: "posts", status: "draft", category: "", schema: true, ...(JSON.parse(localStorage.getItem(key(siteId)) || "{}")) }; } catch { return { platform: "wordpress" }; } }
export function save(siteId, s) { localStorage.setItem(key(siteId), JSON.stringify(s)); }
export const configured = siteId => { const s = settings(siteId); return !!(s.site_url && s.username && s.app_password); };
async function relay(body) {
  const tok = getSettings().crawlToken;
  let r; try { r = await fetch("/api/cms", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", ...(tok ? { "x-crawl-token": tok } : {}) }, body: JSON.stringify(body) }); }
  catch { throw new Error("Couldn't reach the publishing function. Check your connection."); }
  const d = await r.json().catch(() => ({}));
  if (r.status === 404 && !d.error) throw new Error("The publishing function isn't deployed yet. Push the latest code to GitHub so Netlify deploys it.");
  if (!r.ok) throw new Error(d.error || `Publishing failed (${r.status})`);
  return d;
}
export const test = s => relay({ ...s, action: "test" });
// turn a written page into a WordPress post: the title shows as the heading, so the H1 is removed; schema goes in an HTML block
export function toWordPress(item, s) {
  const p = item.payload || {};
  let html = String(p.html || "").replace(/^\s*<h1[^>]*>[\s\S]*?<\/h1>\s*/i, "");
  if (s.schema !== false && p.schema_jsonld) html += `\n<!-- wp:html -->\n<script type="application/ld+json">${JSON.stringify(p.schema_jsonld).replace(/</g, "\\u003c")}</script>\n<!-- /wp:html -->`;
  return { title: p.h1 || item.title || p.title_tag || item.keyword, content: html, slug: p.slug || item.slug || "", excerpt: p.meta_description || "",
    status: s.status || "draft", categories: s.category ? [Number(s.category)] : [] };
}
export async function send(siteId, item) {
  const s = settings(siteId); if (!configured(siteId)) throw new Error("Connect WordPress first (Websites → Publishing).");
  const prev = item.published && item.published.platform === "wordpress" && item.published.site_url === s.site_url ? item.published.id : 0;
  const post = { ...toWordPress(item, s), id: prev };
  try { return { ...(await relay({ ...s, action: "save", post })), site_url: s.site_url, post_type: s.post_type }; }
  catch (e) {
    // the earlier post was deleted in WordPress: send it again as a new draft instead of failing every time
    if (prev && /no longer exists/.test(e.message)) return { ...(await relay({ ...s, action: "save", post: { ...post, id: 0 } })), site_url: s.site_url, post_type: s.post_type, recreated: true };
    throw e;
  }
}
