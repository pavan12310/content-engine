// reports.mjs - share links for client reports.
//   GET  /r/<token>                  public, read-only view of a report (sandboxed: no scripts can run, isolated origin)
//   POST /api/report                 create a link (signed-in editor+ in the workspace, or the team password)
//   GET  /api/report?op=list         this workspace's active links
//   DELETE /api/report?token=...     revoke a link
import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";
import { enabled as accountsOn, currentUser, roleIn, CAN } from "./_lib/auth.mjs";

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const page = (status, html) => new Response(html, { status, headers: {
  "content-type": "text/html; charset=utf-8", "cache-control": "private, max-age=300", "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox allow-popups allow-popups-to-escape-sandbox",
  "x-content-type-options": "nosniff" } });
const gone = `<!doctype html><meta charset="utf-8"><title>Report unavailable</title><body style="font:16px system-ui;padding:40px;color:#374151"><h1 style="font-size:22px">This report link has expired or was removed</h1><p>Ask the person who shared it for a new link.</p></body>`;
// belt and braces: the policy above already blocks scripts, but never store them either
const clean = h => String(h).replace(/<script[\s\S]*?<\/script\s*>/gi, "").replace(/<script[^>]*>/gi, "").replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "").replace(/javascript:/gi, "");

async function who(req) {
  if (accountsOn() && (req.headers.get("cookie") || "").includes("ce_session=")) {
    const me = await currentUser(req); if (me.error) return { error: me.error };
    const ws = req.headers.get("x-workspace") || "", { role } = await roleIn(me.store, me.user, ws);
    if (!role) return { error: json(403, { error: "You're not a member of this workspace." }) };
    return { scope: `ws:${ws}`, by: me.user.email, canWrite: CAN.write(role) };
  }
  const pass = process.env.TEAM_PASSWORD;
  if (pass && same(req.headers.get("x-team-key") || "", pass)) return { scope: "team", by: "team", canWrite: true };
  return { error: json(accountsOn() || pass ? 401 : 501, { error: accountsOn() || pass ? "Please sign in (or turn on team sync) to share reports." : "Share links need accounts or team sync on this site. You can download the report as a file or PDF instead." }) };
}

export default async (req) => {
  const url = new URL(req.url), store = getStore({ name: "content-engine-reports", consistency: "strong" });
  const m = url.pathname.match(/^\/r\/([A-Za-z0-9_-]{16,64})\/?$/);
  if (m) {
    if (req.method !== "GET") return page(405, gone);
    const r = await store.getWithMetadata(m[1], { type: "text" });
    if (!r || Number(r.metadata?.expires) < Date.now()) return page(410, gone);
    return page(200, r.data);
  }
  const w = await who(req); if (w.error) return w.error;
  if (req.method === "POST") {
    if (!w.canWrite) return json(403, { error: "Your role is view-only, so you can't create share links. Download the report instead." });
    const body = await req.json().catch(() => ({}));
    const html = String(body.html || "");
    if (!/^<!doctype html>/i.test(html) || html.length > 2_500_000) return json(400, { error: "That isn't a report, or it's too large." });
    const days = Math.min(Math.max(Number(body.days) || 90, 1), 365), token = crypto.randomBytes(18).toString("base64url");
    const meta = { title: String(body.title || "Report").slice(0, 160), scope: w.scope, by: w.by, created: Date.now(), expires: Date.now() + days * 864e5 };
    await store.set(token, clean(html), { metadata: meta });
    return json(200, { url: `/r/${token}`, token, expires: meta.expires });
  }
  if (req.method === "GET" && url.searchParams.get("op") === "list") {
    const { blobs } = await store.list();
    const items = (await Promise.all(blobs.map(async b => ({ token: b.key, ...((await store.getMetadata(b.key))?.metadata || {}) }))))
      .filter(x => x.scope === w.scope && Number(x.expires) > Date.now()).sort((a, b) => b.created - a.created).slice(0, 50);
    return json(200, { links: items.map(x => ({ token: x.token, url: `/r/${x.token}`, title: x.title, by: x.by, created: x.created, expires: x.expires })) });
  }
  if (req.method === "DELETE") {
    if (!w.canWrite) return json(403, { error: "Your role is view-only." });
    const t = url.searchParams.get("token") || "", md = (await store.getMetadata(t))?.metadata;
    if (!md || md.scope !== w.scope) return json(404, { error: "Link not found." });
    await store.delete(t); return json(200, { ok: true });
  }
  return json(400, { error: "Unknown request" });
};

export const config = { path: ["/r/:token", "/api/report"] };
