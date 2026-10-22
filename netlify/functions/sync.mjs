// sync.mjs - team workspace: keeps everyone's Content Engine data in one place (Netlify Blobs).
// Protected by a team password (TEAM_PASSWORD environment variable). API keys are never sent here.
// Each data item is stored with { at, by, deleted } metadata; the newest change wins, and conditional
// writes (etags) make sure two teammates saving at once can't silently overwrite each other.
import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";
import { enabled as accountsOn, currentUser, roleIn, CAN, logActivity } from "./_lib/auth.mjs";

const KEY_RE = /^[a-z0-9:_.-]{1,120}$/i;
const MAX_ITEMS = 20;
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

// readable names for the activity log
const WHAT = { sites: "websites", pages: "pages read from a website", keywords: "keywords", contents: "written pages", recs: "the to-do list", gsc: "Google search data",
  vis: "AI answer checks", aiq: "AI answer questions", plan: "the content plan", strategy: "content ideas", reviews: "draft reviews", ignored: "ignored site health issues",
  health: "site health history", kb: "the knowledge base", questions: "the question bank", urlreview: "competing pages", authors: "authors" };
const describe = keys => [...new Set(keys.map(k => WHAT[k.split(":")[0]] || k.split(":")[0]))].join(", ");

export default async (req) => {
  const store = getStore({ name: "content-engine-team", consistency: "strong" });
  const url = new URL(req.url), op = url.searchParams.get("op");
  // two ways in: a signed-in account (workspace-scoped, role-checked) or the shared team password (whole team, no roles)
  let prefix = "", canWrite = true, who = null, wsid = null, authStore = null;
  if (accountsOn() && (req.headers.get("cookie") || "").includes("ce_session=")) {
    const me = await currentUser(req); if (me.error) return me.error;
    wsid = req.headers.get("x-workspace") || "";
    const { ws, role } = await roleIn(me.store, me.user, wsid);
    if (!ws || !role) return json(403, { error: "You're not a member of this workspace." });
    prefix = `w:${ws.id}:`; canWrite = CAN.write(role); who = me.user.email; authStore = me.store;
  } else {
    const pass = process.env.TEAM_PASSWORD;
    if (accountsOn() && !req.headers.get("x-team-key")) return json(401, { error: "Please sign in." });
    if (!pass) return json(accountsOn() ? 401 : 501, { error: accountsOn() ? "Please sign in." : "Team sync isn't set up yet. In Netlify, add an environment variable TEAM_PASSWORD, then redeploy." });
    if (!same(req.headers.get("x-team-key") || "", pass)) return json(401, { error: "Wrong team password." });
  }
  try {
    if (req.method === "GET" && op === "index") {
      const { blobs } = await store.list(prefix ? { prefix } : {});
      const items = await Promise.all(blobs.filter(b => prefix || !b.key.startsWith("w:")).map(async b => {
        const m = await store.getMetadata(b.key);
        const md = m?.metadata || {};
        return { key: b.key.slice(prefix.length), at: Number(md.at) || 0, by: md.by || "", deleted: !!md.deleted, size: Number(md.size) || 0 };
      }));
      return json(200, { items, server_time: Date.now() });
    }
    if (req.method === "GET" && op === "get") {
      const key = url.searchParams.get("key") || "";
      if (!KEY_RE.test(key)) return json(400, { error: "Bad key" });
      const r = await store.getWithMetadata(prefix + key, { type: "text" });
      if (!r) return json(404, { error: "Not found" });
      return json(200, { key, data: r.data, ...(r.metadata || {}) });
    }
    if (req.method === "POST" && op === "put") {
      if (!canWrite) return json(403, { error: "Your role in this workspace is view-only." });
      const body = await req.json().catch(() => ({}));
      const items = Array.isArray(body.items) ? body.items.slice(0, MAX_ITEMS) : [];
      const results = [];
      for (const it of items) {
        if (!KEY_RE.test(String(it.key || "")) || !Number.isFinite(Number(it.at))) { results.push({ key: it.key, ok: false, reason: "invalid" }); continue; }
        let done = false;
        for (let attempt = 0; attempt < 3 && !done; attempt++) {
          const cur = await store.getMetadata(prefix + it.key);
          const curAt = Number(cur?.metadata?.at) || 0;
          if (cur && curAt > Number(it.at)) { results.push({ key: it.key, ok: false, reason: "newer", at: curAt, by: cur.metadata?.by || "" }); done = true; break; }
          const data = it.deleted ? "" : String(it.data || "");
          const opts = { metadata: { at: Number(it.at), by: who || String(it.by || "").slice(0, 60), deleted: !!it.deleted, size: data.length } };
          if (cur) opts.onlyIfMatch = cur.etag; else opts.onlyIfNew = true;
          const res = await store.set(prefix + it.key, data, opts);
          if (res && res.modified === false) continue;   // someone wrote in between: re-read and try again
          results.push({ key: it.key, ok: true, at: Number(it.at) }); done = true;
        }
        if (!done) results.push({ key: it.key, ok: false, reason: "busy" });
      }
      const saved = results.filter(r => r.ok).map(r => r.key);
      if (authStore && saved.length) await logActivity(authStore, wsid, { user: who, action: `updated ${describe(saved)}` });
      return json(200, { results });
    }
    return json(400, { error: "Unknown request" });
  } catch (e) {
    return json(500, { error: "Team storage error: " + (e?.message || e) });
  }
};

export const config = { path: "/api/sync" };
