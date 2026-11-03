// framer.mjs - publishing approved pages to a Framer site's CMS through Framer's Server API (official framer-api package).
// The project address and API key come from the person's browser with each request (like WordPress details); nothing is stored here.
// action "test": connect and list the collections you can edit, with their fields. action "save": add or update the page (by slug),
// then optionally publish a preview or deploy it to the live site.
import crypto from "node:crypto";

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
async function gate(req) {   // same rule as the website reader: signed in, or the crawl token when one is set
  const { readToken, enabled: accountsOn } = await import("./_lib/auth.mjs");
  const session = (req.headers.get("cookie") || "").match(/(?:^|;\s*)ce_session=([^;]+)/);
  if (accountsOn()) return session && readToken(session[1]) ? null : json(401, { error: "Please sign in." });
  const tok = process.env.CRAWL_TOKEN; if (!tok) return null;
  const got = req.headers.get("x-crawl-token") || "", a = Buffer.from(got), b = Buffer.from(tok);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? null : json(401, { error: "Add the crawl token in Settings." });
}
// only Framer project addresses (https://framer.com/projects/Name--id)
function projectUrl(u) {
  let x; try { x = new URL(String(u || "").trim()); } catch { return null; }
  return x.protocol === "https:" && /(^|\.)framer\.com$/.test(x.hostname) && /^\/projects\/[^/]+/.test(x.pathname) ? `https://framer.com${x.pathname.split("/").slice(0, 3).join("/")}` : null;
}
const FIELD_TYPES = new Set(["string", "formattedText", "date", "link", "boolean", "number", "image"]);
const why = e => {
  const m = String(e && e.message || e);
  if (/unauthori|invalid.*(key|token)|401|forbidden|403/i.test(m)) return "Framer didn't accept the API key. Create a Server API key in the project's site settings (API) and paste it again.";
  if (/not.?found|404|no such project/i.test(m)) return "Framer couldn't find that project. Copy the address from the browser while the project is open (https://framer.com/projects/…).";
  if (/managed|read.?only/i.test(m)) return "That collection is managed by a plugin, so it can't be edited from outside. Choose a collection you created yourself.";
  return `Framer answered with an error: ${m.slice(0, 220)}`;
};
const api = async () => process.env.FRAMER_API_MODULE ? import(process.env.FRAMER_API_MODULE) : import("framer-api");   // FRAMER_API_MODULE: local tests only

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Use POST." });
  const denied = await gate(req); if (denied) return denied;
  const b = await req.json().catch(() => ({}));
  const url = projectUrl(b.project_url); if (!url) return json(400, { error: "Paste the Framer project address, like https://framer.com/projects/Name--abc123." });
  const key = String(b.api_key || "").trim(); if (key.length < 10) return json(400, { error: "Paste the Framer Server API key." });
  let framer;
  try {
    const { connect } = await api();
    framer = await connect(url, key);
    const editable = (await framer.getCollections()).filter(c => !c.managedBy || c.managedBy === "user");
    if (b.action === "test") {
      const collections = [];
      for (const c of editable.slice(0, 30)) collections.push({ id: c.id, name: c.name, fields: (await c.getFields()).filter(f => FIELD_TYPES.has(f.type)).map(f => ({ id: f.id, name: f.name, type: f.type })) });
      return json(200, { ok: true, collections });
    }
    if (b.action === "publish") {
      const pub = await framer.publish(), out = { ok: true, deployment: pub.deployment?.id || "", preview: (pub.hostnames || []).map(h => h.hostname).filter(Boolean)[0] || "" };
      if (b.mode === "live") { const hosts = await framer.deploy(pub.deployment.id); out.live = (hosts || []).map(h => h.hostname).filter(Boolean); }
      return json(200, out);
    }
    if (b.action !== "save") return json(400, { error: "Unknown action." });
    const col = editable.find(c => c.id === b.collection_id); if (!col) return json(404, { error: "That collection wasn't found (or is managed by a plugin). Test the connection again and choose a collection." });
    const it = b.item || {}, slug = String(it.slug || "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
    if (!slug) return json(400, { error: "The page needs a URL slug." });
    const fieldData = {}; for (const [id, v] of Object.entries(it.fieldData || {})) if (v && FIELD_TYPES.has(v.type)) fieldData[id] = v;
    // the same page again updates its own item (by its id); an item someone else made with the same slug is never overwritten
    const items = await col.getItems(), prev = b.item_id ? items.find(x => x.id === b.item_id) : null;
    const clash = items.find(x => x.slug === slug && (!prev || x.id !== prev.id));
    if (clash) return json(409, { error: `The ${col.name} collection already has an item with the address “${slug}”. Change this page's URL slug (Edit tab), or rename that item in Framer.` });
    await col.addItems([{ ...(prev ? { id: prev.id } : {}), slug, draft: b.mode === "draft", fieldData }]);
    const saved = (await col.getItems()).find(x => x.slug === slug);
    return json(200, { ok: true, id: saved?.id || prev?.id || "", slug, updated: !!prev, mode: b.mode || "draft", project_url: url });
  } catch (e) { return json(502, { error: why(e) }); }
  finally { try { await framer?.disconnect(); } catch { } }
};
export const config = { path: "/api/framer" };
