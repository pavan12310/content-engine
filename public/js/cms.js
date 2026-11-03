// cms.js - publishing approved pages to the website's CMS (WordPress first). Connection details are kept per website
// in this browser only (like AI keys) and sent through the site's /api/cms relay; they're never synced or stored on a server.
import { dbName } from "./store.js";
import { getSettings } from "./llm.js";
const key = siteId => `ce-cms:${dbName()}:${siteId}`;
export function settings(siteId) { try { return { platform: "wordpress", site_url: "", username: "", app_password: "", post_type: "posts", status: "draft", category: "", schema: true, ...(JSON.parse(localStorage.getItem(key(siteId)) || "{}")) }; } catch { return { platform: "wordpress" }; } }
export function save(siteId, s) { localStorage.setItem(key(siteId), JSON.stringify(s)); }
export const configured = siteId => { const s = settings(siteId);
  if (s.platform === "framer") return !!(s.project_url && s.api_key && s.collection_id && s.map?.content);
  if (s.platform === "webflow") return !!(s.wf_token && s.wf_collection && s.wf_map?.content);
  if (s.platform === "hubspot") return !!(s.hs_token && s.hs_blog);
  return !!(s.site_url && s.username && s.app_password); };
export const NAMES = { wordpress: "WordPress", framer: "Framer", webflow: "Webflow", hubspot: "HubSpot" };
export const platformName = siteId => NAMES[settings(siteId).platform] || "WordPress";
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
  if (settings(siteId).platform === "framer") return sendFramer(siteId, item);
  if (settings(siteId).platform === "webflow") return sendWebflow(siteId, item);
  if (settings(siteId).platform === "hubspot") return sendHubspot(siteId, item);
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

// ---------------- Framer (Server API, through the site's /api/framer relay) ----------------
async function framerRelay(body) {
  const tok = getSettings().crawlToken;
  let r; try { r = await fetch("/api/framer", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", ...(tok ? { "x-crawl-token": tok } : {}) }, body: JSON.stringify(body) }); }
  catch { throw new Error("Couldn't reach the Framer publishing function. Check your connection."); }
  const d = await r.json().catch(() => ({}));
  if (r.status === 404 && !d.error) throw new Error("The Framer publishing function isn't deployed yet. Push the latest code to GitHub so Netlify deploys it.");
  if (!r.ok) throw new Error(d.error || `Publishing to Framer failed (${r.status})`);
  return d;
}
export const testFramer = s => framerRelay({ action: "test", project_url: s.project_url, api_key: s.api_key });
// which Framer field gets what: guessed from the field names and types, and changeable in the form
export function guessMap(fields = []) {
  const pick = (types, re) => (fields.find(f => types.includes(f.type) && re.test(f.name)) || null)?.id || "";
  const first = t => (fields.find(f => f.type === t) || null)?.id || "";
  return { title: pick(["string"], /^(title|name|heading|headline)$/i) || pick(["string"], /title|name/i) || first("string"),
    content: pick(["formattedText"], /content|body|post|article|text/i) || first("formattedText"),
    description: pick(["string", "formattedText"], /excerpt|summary|subtitle|intro/i) || pick(["string", "formattedText"], /description/i),
    seo_title: pick(["string"], /seo.?title|meta.?title|page.?title/i),
    seo_description: pick(["string"], /seo.?desc|meta.?desc/i),
    date: pick(["date"], /date|published|publish/i) || first("date"),
    author: pick(["string"], /author|writer|by/i) };
}
// a written page as a Framer CMS item: Markdown goes into the rich-text field as Markdown (the H1 is left out: Framer shows the title)
export function toFramer(item, s) {
  const p = item.payload || {}, fields = (s.collections || []).find(c => c.id === s.collection_id)?.fields || [], type = id => fields.find(f => f.id === id)?.type, m = s.map || {}, fd = {};
  const set = (id, v, extra = {}) => { if (id && type(id) && v != null && v !== "") fd[id] = { type: type(id), value: v, ...extra }; };
  set(m.title, p.h1 || item.title || p.title_tag || item.keyword);
  if (m.content) fd[m.content] = { type: "formattedText", value: String(p.body_markdown || "").replace(/^\s*#\s+.*\n+/, ""), contentType: "markdown" };
  set(m.description, p.meta_description || "", type(m.description) === "formattedText" ? { contentType: "markdown" } : {});
  set(m.seo_title, p.title_tag || "");
  set(m.seo_description, p.meta_description || "");
  set(m.date, new Date().toISOString());
  set(m.author, String(item.author || "").split(",")[0].trim());
  return { slug: p.slug || item.slug || "", fieldData: fd };
}
async function sendFramer(siteId, item) {
  const s = settings(siteId); if (!configured(siteId)) throw new Error("Connect Framer first (Websites → Publishing).");
  const prev = item.published && item.published.platform === "framer" && item.published.project_url === s.project_url ? item.published.id : "";
  const mode = s.mode || "draft", body = { project_url: s.project_url, api_key: s.api_key };
  const r = await framerRelay({ action: "save", ...body, collection_id: s.collection_id, item: toFramer(item, s), item_id: prev, mode });
  const col = (s.collections || []).find(c => c.id === s.collection_id), page = s.page_pattern ? s.page_pattern.replace("{slug}", r.slug) : "";
  const out = { ...r, platform: "framer", collection: col?.name || "", status: "draft", edit_link: s.project_url, link: "", page_url: page };
  if (mode === "preview" || mode === "live") {
    // a separate step: if publishing is slow or fails, the page is still saved in Framer
    try { const p2 = await framerRelay({ action: "publish", ...body, mode }); Object.assign(out, { preview: p2.preview, live: p2.live, status: mode === "live" ? "live" : "preview published",
      link: mode === "live" ? (page || (p2.live?.[0] ? `https://${p2.live[0]}` : "")) : p2.preview ? `https://${p2.preview}` : "" }); }
    catch (e) { out.publish_error = `Saved in Framer, but publishing didn't finish: ${e.message} Publish it from Framer.`; }
  }
  return out;
}

// ---------------- Webflow and HubSpot (through the site's /api/publish relay) ----------------
async function pubRelay(body) {
  const tok = getSettings().crawlToken;
  let r; try { r = await fetch("/api/publish", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", ...(tok ? { "x-crawl-token": tok } : {}) }, body: JSON.stringify(body) }); }
  catch { throw new Error("Couldn't reach the publishing function. Check your connection."); }
  const d = await r.json().catch(() => ({}));
  if (r.status === 404 && !d.error) throw new Error("The publishing function isn't deployed yet. Push the latest code to GitHub so Netlify deploys it.");
  if (!r.ok) throw new Error(d.error || `Publishing failed (${r.status})`);
  return d;
}
const bodyHtml = item => String(item.payload?.html || "").replace(/^\s*<h1[^>]*>[\s\S]*?<\/h1>\s*/i, "");
export const testWebflow = s => pubRelay({ platform: "webflow", action: "test", token: s.wf_token });
export const testHubspot = s => pubRelay({ platform: "hubspot", action: "test", token: s.hs_token });
// Webflow fields are addressed by their slug; matched from names and types, changeable in the form
export function guessWebflowMap(fields = []) {
  const pick = (types, re) => (fields.find(f => types.includes(f.type) && re.test(`${f.id} ${f.name}`)) || null)?.id || "";
  const first = t => (fields.find(f => f.type === t) || null)?.id || "";
  return { content: pick(["RichText"], /post-body|content|body|article|text/i) || first("RichText"),
    summary: pick(["PlainText", "RichText"], /summary|excerpt|intro|description|subtitle/i),
    date: pick(["DateTime"], /publish|date/i) || first("DateTime"),
    author: pick(["PlainText"], /author|writer/i),
    seo_title: pick(["PlainText"], /seo.?title|meta.?title/i), seo_description: pick(["PlainText"], /meta.?desc|seo.?desc/i) };
}
export function toWebflow(item, s) {
  const p = item.payload || {}, m = s.wf_map || {}, fd = { name: String(p.h1 || item.title || p.title_tag || item.keyword).slice(0, 256), slug: String(p.slug || item.slug || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 256) };
  if (m.content) fd[m.content] = bodyHtml(item);
  if (m.summary) fd[m.summary] = p.meta_description || "";
  if (m.date) fd[m.date] = new Date().toISOString();
  if (m.author) fd[m.author] = String(item.author || "").split(",")[0].trim();
  if (m.seo_title) fd[m.seo_title] = p.title_tag || "";
  if (m.seo_description) fd[m.seo_description] = p.meta_description || "";
  return fd;
}
async function sendWebflow(siteId, item) {
  const s = settings(siteId); if (!configured(siteId)) throw new Error("Connect Webflow first (Websites → Publishing).");
  const prev = item.published?.platform === "webflow" && item.published.collection_id === s.wf_collection ? item.published.id : "";
  const fieldData = toWebflow(item, s), mode = s.wf_mode || "draft";
  const r = await pubRelay({ platform: "webflow", action: "save", token: s.wf_token, collection_id: s.wf_collection, item_id: prev, mode, fieldData });
  const col = (s.wf_collections || []).find(c => c.id === s.wf_collection), page = s.wf_pattern ? s.wf_pattern.replace("{slug}", r.slug) : "";
  const out = { ...r, platform: "webflow", collection_id: s.wf_collection, collection: col?.name || "", status: "draft", edit_link: "https://webflow.com/dashboard", link: "", page_url: page };
  if (mode === "live") { try { await pubRelay({ platform: "webflow", action: "publish", token: s.wf_token, collection_id: s.wf_collection, item_id: r.id, fieldData }); Object.assign(out, { status: "live", link: page }); }
    catch (e) { out.publish_error = `Saved in Webflow, but publishing didn't finish: ${e.message} Publish it from Webflow.`; } }
  return out;
}
export function toHubspot(item) {
  const p = item.payload || {};
  return { name: p.h1 || item.title || p.title_tag || item.keyword, slug: p.slug || item.slug || "", postBody: bodyHtml(item), metaDescription: p.meta_description || "", htmlTitle: p.title_tag || p.h1 || "" };
}
async function sendHubspot(siteId, item) {
  const s = settings(siteId); if (!configured(siteId)) throw new Error("Connect HubSpot first (Websites → Publishing).");
  const prev = item.published?.platform === "hubspot" && item.published.blog_id === s.hs_blog ? item.published.id : "", mode = s.hs_mode || "draft", post = toHubspot(item);
  const r = await pubRelay({ platform: "hubspot", action: "save", token: s.hs_token, blog_id: s.hs_blog, author_id: s.hs_author || "", post_id: prev, post });
  const blog = (s.hs_blogs || []).find(b => b.id === s.hs_blog);
  const out = { ...r, platform: "hubspot", blog_id: s.hs_blog, collection: blog?.name || "blog", status: "draft", edit_link: `https://app.hubspot.com/blog`, link: "", page_url: blog?.url ? `${blog.url.replace(/\/$/, "")}/${post.slug}` : "" };
  if (mode === "live") { try { const p2 = await pubRelay({ platform: "hubspot", action: "publish", token: s.hs_token, post_id: r.id, post }); Object.assign(out, { status: "live", link: p2.url || out.page_url, page_url: p2.url || out.page_url }); }
    catch (e) { out.publish_error = `Saved in HubSpot, but publishing didn't finish: ${e.message} Publish it from HubSpot.`; } }
  return out;
}
