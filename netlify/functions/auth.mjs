// auth.mjs - accounts, workspaces, members, invitations and activity log (/api/auth?op=...).
// Turn on by setting AUTH_SECRET (a long random string) in Netlify. The first owner signs up with the setup code
// (AUTH_SETUP_CODE, or TEAM_PASSWORD if that's set), then invites everyone else with links.
import { ROLES, CAN, enabled, authStore, json, sameText, normEmail, validEmail, id, hashPassword, checkPassword, passwordProblem,
  makeToken, sessionCookie, clearCookie, getUserByEmail, saveUser, getWorkspace, saveWorkspace, userCount, publicUser,
  currentUser, roleIn, logActivity, throttled, noteFailure, clearFailures } from "./_lib/auth.mjs";

const RANK = { owner: 4, admin: 3, editor: 2, viewer: 1, client: 1 };
const wsList = async (store, u) => (await Promise.all((u.workspaces || []).map(async w => { const ws = await getWorkspace(store, w); const role = ws?.members?.[u.id]?.role; return ws && role ? { id: ws.id, name: ws.name, role } : null; }))).filter(Boolean);
const signedIn = async (store, u, req, extra = {}) => json(200, { ok: true, user: publicUser(u), workspaces: await wsList(store, u), ...extra }, { "set-cookie": sessionCookie(makeToken(u), req) });
const owners = ws => Object.entries(ws.members || {}).filter(([, m]) => m.role === "owner").map(([k]) => k);

export default async (req) => {
  const url = new URL(req.url), op = url.searchParams.get("op") || "status";
  if (op === "status" && req.method === "GET") {
    if (!enabled()) return json(200, { accounts: false });
    const store = authStore(), setup_needed = (await userCount(store)) === 0;
    const me = await currentUser(req);
    return json(200, { accounts: true, setup_needed, user: me.user ? publicUser(me.user) : null, workspaces: me.user ? await wsList(store, me.user) : [] });
  }
  if (!enabled()) return json(501, { error: "Accounts aren't set up. In Netlify, add AUTH_SECRET (a long random text), then redeploy." });
  const store = authStore();
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

  // ---------- first owner ----------
  if (op === "setup" && req.method === "POST") {
    if ((await userCount(store)) > 0) return json(409, { error: "Setup is already done. Sign in instead." });
    const code = process.env.AUTH_SETUP_CODE || process.env.TEAM_PASSWORD;
    if (!code) return json(501, { error: "Add AUTH_SETUP_CODE in Netlify (the code the first owner uses to set up accounts), then redeploy." });
    if (!sameText(body.code || "", code)) return json(401, { error: "Wrong setup code." });
    const email = normEmail(body.email); if (!validEmail(email)) return json(400, { error: "Enter a valid email address." });
    const bad = passwordProblem(body.password); if (bad) return json(400, { error: bad });
    const u = { id: id(), email, name: String(body.name || "").slice(0, 80), ...hashPassword(body.password), pwv: 1, created_at: Date.now(), workspaces: [] };
    const ws = { id: id(9), name: String(body.workspace || "My workspace").slice(0, 80), created_at: Date.now(), members: { [u.id]: { role: "owner", email, name: u.name, added: Date.now() } } };
    u.workspaces.push(ws.id); await saveWorkspace(store, ws); await saveUser(store, u);
    await logActivity(store, ws.id, { user: email, action: "created the workspace" });
    return signedIn(store, u, req);
  }
  // ---------- sign in / out ----------
  if (op === "login" && req.method === "POST") {
    const email = normEmail(body.email);
    if (await throttled(store, email)) return json(429, { error: "Too many attempts. Wait 15 minutes and try again." });
    const u = await getUserByEmail(store, email);
    if (!u || u.disabled || !checkPassword(body.password || "", u.salt, u.hash)) { await noteFailure(store, email); return json(401, { error: "Wrong email or password." }); }
    await clearFailures(store, email);
    return signedIn(store, u, req);
  }
  if (op === "logout" && req.method === "POST") return json(200, { ok: true }, { "set-cookie": clearCookie() });

  // ---------- invitation details and acceptance (the invitee may not be signed in yet) ----------
  if (op === "invite_info" && req.method === "GET") {
    const inv = await store.get(`invite:${url.searchParams.get("token") || ""}`, { type: "json" });
    if (!inv || inv.exp < Date.now()) return json(404, { error: "This invitation has expired or was cancelled. Ask for a new one." });
    const ws = await getWorkspace(store, inv.ws);
    return json(200, { email: inv.email, role: inv.role, workspace: ws?.name || "", has_account: !!(await getUserByEmail(store, inv.email)) });
  }
  if (op === "invite_accept" && req.method === "POST") {
    const key = `invite:${body.token || ""}`, inv = await store.get(key, { type: "json" });
    if (!inv || inv.exp < Date.now()) return json(404, { error: "This invitation has expired or was cancelled. Ask for a new one." });
    const ws = await getWorkspace(store, inv.ws); if (!ws) return json(404, { error: "That workspace no longer exists." });
    let u = await getUserByEmail(store, inv.email);
    if (u) { if (!checkPassword(body.password || "", u.salt, u.hash)) { await noteFailure(store, inv.email); return json(401, { error: `Enter the password for ${inv.email}.` }); } }
    else { const bad = passwordProblem(body.password); if (bad) return json(400, { error: bad });
      u = { id: id(), email: inv.email, name: String(body.name || "").slice(0, 80), ...hashPassword(body.password), pwv: 1, created_at: Date.now(), workspaces: [] }; }
    ws.members = ws.members || {}; ws.members[u.id] = { role: inv.role, email: u.email, name: u.name, added: Date.now() };
    u.workspaces = [...new Set([...(u.workspaces || []), ws.id])];
    await saveWorkspace(store, ws); await saveUser(store, u); await store.delete(key);
    await logActivity(store, ws.id, { user: u.email, action: `joined as ${inv.role}` });
    return signedIn(store, u, req, { joined: ws.id });
  }

  // ---------- everything below needs a signed-in user ----------
  const me = await currentUser(req); if (me.error) return me.error;
  const u = me.user;
  if (op === "me" && req.method === "GET") return json(200, { user: publicUser(u), workspaces: await wsList(store, u) });
  if (op === "password" && req.method === "POST") {
    if (!checkPassword(body.current || "", u.salt, u.hash)) return json(401, { error: "Your current password is wrong." });
    const bad = passwordProblem(body.password); if (bad) return json(400, { error: bad });
    Object.assign(u, hashPassword(body.password), { pwv: (u.pwv || 1) + 1 }); await saveUser(store, u);   // signs out other devices
    return signedIn(store, u, req);
  }
  if (op === "profile" && req.method === "POST") { u.name = String(body.name || "").slice(0, 80); await saveUser(store, u); return json(200, { user: publicUser(u) }); }
  if (op === "workspace_create" && req.method === "POST") {
    const mine = await wsList(store, u);
    if (!mine.some(w => CAN.manage(w.role))) return json(403, { error: "Only owners and admins can create workspaces." });
    const ws = { id: id(9), name: String(body.name || "New workspace").slice(0, 80), created_at: Date.now(), members: { [u.id]: { role: "owner", email: u.email, name: u.name, added: Date.now() } } };
    u.workspaces = [...(u.workspaces || []), ws.id]; await saveWorkspace(store, ws); await saveUser(store, u);
    await logActivity(store, ws.id, { user: u.email, action: "created the workspace" });
    return json(200, { workspace: { id: ws.id, name: ws.name, role: "owner" }, workspaces: await wsList(store, u) });
  }
  // workspace-scoped operations
  const wsid = body.ws || url.searchParams.get("ws") || "";
  const { ws, role } = await roleIn(store, u, wsid);
  if (!ws || !role) return json(403, { error: "You're not a member of that workspace." });
  if (op === "activity" && req.method === "GET") return json(200, { activity: ((await store.get(`log:${ws.id}`, { type: "json" })) || []).slice(0, 200) });
  if (op === "members" && req.method === "GET") {
    const members = Object.entries(ws.members || {}).map(([uid, m]) => ({ id: uid, email: m.email, name: m.name || "", role: m.role, added: m.added, you: uid === u.id }));
    let invites = [];
    if (CAN.manage(role)) { const { blobs } = await store.list({ prefix: "invite:" });
      invites = (await Promise.all(blobs.map(async b => ({ token: b.key.slice(7), ...(await store.get(b.key, { type: "json" })) })))).filter(i => i.ws === ws.id && i.exp > Date.now()).map(i => ({ token: i.token, email: i.email, role: i.role, exp: i.exp, by: i.by })); }
    return json(200, { workspace: { id: ws.id, name: ws.name, role }, members, invites });
  }
  if (!CAN.manage(role) && op !== "leave") return json(403, { error: "Only owners and admins can manage this workspace." });
  if (op === "workspace_rename" && req.method === "POST") {
    ws.name = String(body.name || ws.name).slice(0, 80); await saveWorkspace(store, ws); await logActivity(store, ws.id, { user: u.email, action: `renamed the workspace to “${ws.name}”` });
    return json(200, { ok: true });
  }
  if (op === "invite" && req.method === "POST") {
    const email = normEmail(body.email), r = body.role;
    if (!validEmail(email)) return json(400, { error: "Enter a valid email address." });
    if (!ROLES.includes(r) || RANK[r] > RANK[role] || (r === "owner" && role !== "owner")) return json(403, { error: "You can't give someone a higher role than your own." });
    const existing = Object.values(ws.members || {}).find(m => m.email === email); if (existing) return json(409, { error: `${email} is already a member.` });
    const token = id(18); await store.setJSON(`invite:${token}`, { ws: ws.id, email, role: r, by: u.email, exp: Date.now() + 7 * 86400e3 });
    await logActivity(store, ws.id, { user: u.email, action: `invited ${email} as ${r}` });
    return json(200, { token, link: `/#invite=${token}`, expires_in_days: 7 });
  }
  if (op === "invite_revoke" && req.method === "POST") {
    const inv = await store.get(`invite:${body.token || ""}`, { type: "json" });
    if (inv && inv.ws === ws.id) { await store.delete(`invite:${body.token}`); await logActivity(store, ws.id, { user: u.email, action: `cancelled the invitation for ${inv.email}` }); }
    return json(200, { ok: true });
  }
  if ((op === "member_role" || op === "member_remove" || op === "leave") && req.method === "POST") {
    const target = op === "leave" ? u.id : body.user_id, m = ws.members?.[target];
    if (!m) return json(404, { error: "That person isn't a member." });
    if (op !== "leave" && m.role === "owner" && role !== "owner") return json(403, { error: "Only an owner can change another owner." });
    const newRole = op === "member_role" ? body.role : null;
    if (newRole && (!ROLES.includes(newRole) || (newRole === "owner" && role !== "owner") || RANK[newRole] > RANK[role])) return json(403, { error: "You can't give someone a higher role than your own." });
    if (m.role === "owner" && newRole !== "owner" && owners(ws).length === 1) return json(409, { error: "A workspace needs at least one owner. Make someone else an owner first." });
    if (newRole) { m.role = newRole; await saveWorkspace(store, ws); await logActivity(store, ws.id, { user: u.email, action: `changed ${m.email} to ${newRole}` }); return json(200, { ok: true }); }
    delete ws.members[target]; await saveWorkspace(store, ws);
    const tu = await getUserByEmail(store, m.email); if (tu) { tu.workspaces = (tu.workspaces || []).filter(w => w !== ws.id); await saveUser(store, tu); }
    await logActivity(store, ws.id, { user: u.email, action: op === "leave" ? "left the workspace" : `removed ${m.email}` });
    return json(200, { ok: true });
  }
  return json(400, { error: "Unknown request" });
};

export const config = { path: "/api/auth" };
