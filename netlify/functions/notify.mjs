// notify.mjs - manage chat webhooks (Slack, Microsoft Teams, Google Chat) and send alerts.
// Same access as team sync: a signed-in account (workspace-scoped, role-checked) or the shared team password.
//   POST /api/notify {op:"list"}                        any member: the webhooks, masked
//   POST /api/notify {op:"add", name, url, events}      owners and admins (or the team password)
//   POST /api/notify {op:"update", id, events, name}    owners and admins
//   POST /api/notify {op:"remove", id}                  owners and admins
//   POST /api/notify {op:"test", id}                    owners and admins
//   POST /api/notify {op:"event", event, title, lines, link}   editors and above: an urgent alert or an approval request
import crypto from "node:crypto";
import { enabled as accountsOn, currentUser, roleIn, CAN, json, sameText } from "./_lib/auth.mjs";
import * as N from "./_lib/notify.mjs";

const clip = (s, n) => String(s || "").replace(/[<>]/g, "").slice(0, n);
async function scope(req) {
  if (accountsOn() && (req.headers.get("cookie") || "").includes("ce_session=")) {
    const me = await currentUser(req); if (me.error) return { error: me.error };
    const { ws, role } = await roleIn(me.store, me.user, req.headers.get("x-workspace") || "");
    if (!ws || !role) return { error: json(403, { error: "You're not a member of this workspace." }) };
    return { prefix: `w:${ws.id}:`, manage: CAN.manage(role), write: CAN.write(role) };
  }
  const pass = process.env.TEAM_PASSWORD;
  if (!pass) return { error: json(accountsOn() ? 401 : 501, { error: accountsOn() ? "Please sign in." : "Chat alerts need team sync or accounts. In Netlify, add TEAM_PASSWORD (or AUTH_SECRET for accounts)." }) };
  if (!sameText(req.headers.get("x-team-key") || "", pass)) return { error: json(401, { error: "Wrong team password." }) };
  return { prefix: "", manage: true, write: true };
}
const EVENTS = ["weekly", "urgent", "approval"];
const cleanEvents = e => Object.fromEntries(EVENTS.map(k => [k, !!(e && e[k])]));
const shown = (h, held = {}) => ({ id: h.id, name: h.name, kind: h.kind, masked: h.masked, events: h.events, quiet: h.quiet || null, held: held[h.id] || 0, last: h.last || null, added_at: h.added_at });

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  if (!N.available()) return json(501, { error: "Chat alerts need team sync or accounts. In Netlify, add TEAM_PASSWORD (or AUTH_SECRET for accounts)." });
  const sc = await scope(req); if (sc.error) return sc.error;
  const b = await req.json().catch(() => ({})), hooks = await N.listHooks(sc.prefix);
  const needManage = () => sc.manage ? null : json(403, { error: "Only owners and admins can change chat alerts." });
  switch (b.op) {
    case "list": { const held = await N.heldCount(sc.prefix).catch(() => ({})); return json(200, { hooks: hooks.map(h => shown(h, held)) }); }
    case "add": {
      const no = needManage(); if (no) return no;
      const url = String(b.url || "").trim(), kind = N.kindOf(url);
      if (!kind) return json(400, { error: "That isn't a Slack, Microsoft Teams or Google Chat incoming webhook address (it must start with https://)." });
      if (hooks.length >= 10) return json(400, { error: "Up to 10 chat webhooks." });
      const h = { id: crypto.randomBytes(8).toString("hex"), name: clip(b.name, 60) || ({ slack: "Slack", teams: "Microsoft Teams", gchat: "Google Chat" })[kind], kind,
        enc: N.encrypt(url), masked: N.mask(url), events: cleanEvents(b.events || { weekly: true, urgent: true, approval: false }), added_at: Date.now() };
      await N.saveHooks(sc.prefix, [...hooks, h]); return json(200, { hook: shown(h) });
    }
    case "update": {
      const no = needManage(); if (no) return no;
      const h = hooks.find(x => x.id === b.id); if (!h) return json(404, { error: "Webhook not found." });
      if (b.events) h.events = cleanEvents(b.events); if (b.name) h.name = clip(b.name, 60);
      if (b.quiet !== undefined) { const ok = t => /^([01]?\d|2[0-3]):[0-5]\d$/.test(t || "");
        if (b.quiet === null || (!b.quiet.start && !b.quiet.end)) h.quiet = null;
        else if (ok(b.quiet.start) && ok(b.quiet.end)) h.quiet = { start: b.quiet.start, end: b.quiet.end, tz: clip(b.quiet.tz || "UTC", 60) };
        else return json(400, { error: "Quiet hours need a start and end time, like 20:00 and 08:00." }); }
      await N.saveHooks(sc.prefix, hooks); return json(200, { hook: shown(h) });
    }
    case "remove": {
      const no = needManage(); if (no) return no;
      await N.saveHooks(sc.prefix, hooks.filter(x => x.id !== b.id)); return json(200, { ok: true });
    }
    case "test": {
      const no = needManage(); if (no) return no;
      const h = hooks.find(x => x.id === b.id); if (!h) return json(404, { error: "Webhook not found." });
      const r = await N.sendTo(h, { title: "Content Engine is connected", lines: ["This channel will get the alerts you chose: " + EVENTS.filter(e => h.events[e]).map(e => ({ weekly: "the weekly check summary", urgent: "urgent problems", approval: "reviews, sign-offs and @mentions" })[e]).join(", ") + "."], level: "ok" });
      h.last = { at: Date.now(), ok: r.ok, error: r.error || "" }; await N.saveHooks(sc.prefix, hooks);
      return json(r.ok ? 200 : 502, r.ok ? { ok: true } : { error: `The test message wasn't delivered: ${r.error}.` });
    }
    case "event": {
      if (!sc.write) return json(403, { error: "Your role can't send alerts." });
      if (!["urgent", "approval"].includes(b.event)) return json(400, { error: "Unknown alert." });
      const link = /^https:\/\//.test(b.link || "") ? b.link : null;
      const msg = { title: clip(b.title, 150), lines: (Array.isArray(b.lines) ? b.lines : []).slice(0, 8).map(l => clip(l, 300)), level: b.event === "urgent" ? "urgent" : "info", button: link ? { text: "Open Content Engine", url: link } : null };
      const r = b.event === "urgent" ? await N.urgent(sc.prefix, msg) : await N.notify(sc.prefix, b.event, msg);
      return json(200, r);
    }
  }
  return json(400, { error: "Unknown request" });
};

export const config = { path: "/api/notify" };
