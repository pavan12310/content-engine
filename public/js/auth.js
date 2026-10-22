// auth.js - accounts in the browser. When the site has accounts switched on (AUTH_SECRET in Netlify), nothing loads until
// you sign in; each workspace gets its own browser database and syncs automatically. Without accounts the app works as before.
import * as SYNC from "./sync.js";
import { DEFAULT_DB, dbName } from "./store.js";

const WS_KEY = "ce-ws";
let STATE = { accounts: false, user: null, workspaces: [], workspace: null };
export const state = () => STATE;
export const canWrite = role => ["owner", "admin", "editor"].includes(role);
export const canManage = role => ["owner", "admin"].includes(role);
export const ROLE_LABEL = { owner: "Owner", admin: "Admin", editor: "Editor", viewer: "Viewer", client: "Client (view only)" };

async function call(op, { method = "GET", body, query = "" } = {}) {
  let r; try { r = await fetch(`/api/auth?op=${op}${query}`, { method, credentials: "same-origin", headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }); }
  catch { throw new Error("Couldn't reach the server. Check your connection."); }
  const d = await r.json().catch(() => ({}));
  if (r.status === 404 && !d.error) return { notDeployed: true };
  if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`);
  return d;
}
// switch the browser to a workspace's own database; the page reloads so everything starts clean
export function openWorkspace(ws) {
  localStorage.setItem(WS_KEY, JSON.stringify(ws));
  const want = `content-engine-ws-${ws.id}`;
  if (dbName() !== want) { localStorage.setItem("ce-db", want); location.reload(); return true; }
  return false;
}
// called once at start-up. Returns { ready: true } when the app can load, or { gate: ... } describing the screen to show.
export async function boot() {
  const invite = (location.hash.match(/invite=([A-Za-z0-9_-]+)/) || [])[1];
  let st; try { st = await call("status"); } catch { st = { accounts: false, offline: true }; }
  if (st.notDeployed || !st.accounts) {   // no accounts on this site: the app works as before (this browser, optional team password)
    if (dbName() !== DEFAULT_DB) { localStorage.setItem("ce-db", DEFAULT_DB); location.reload(); return { reloading: true }; }
    return { ready: true, accounts: false };
  }
  STATE = { accounts: true, user: st.user, workspaces: st.workspaces || [], workspace: null };
  if (invite) return { gate: "invite", token: invite };
  if (st.setup_needed) return { gate: "setup" };
  if (!st.user) return { gate: "login" };
  if (!STATE.workspaces.length) return { gate: "no-workspace" };
  let saved = null; try { saved = JSON.parse(localStorage.getItem(WS_KEY) || "null"); } catch { }
  const ws = STATE.workspaces.find(w => w.id === saved?.id) || STATE.workspaces[0];
  if (openWorkspace(ws)) return { reloading: true };
  STATE.workspace = ws;
  SYNC.setAccountMode({ user: STATE.user, workspace: ws, canWrite: canWrite(ws.role) });
  return { ready: true, accounts: true };
}
const afterSignIn = d => { STATE.user = d.user; STATE.workspaces = d.workspaces || [];
  const ws = STATE.workspaces.find(w => w.id === d.joined) || STATE.workspaces[0];
  if (location.hash.includes("invite=")) history.replaceState(null, "", location.pathname);
  if (ws) { localStorage.setItem(WS_KEY, JSON.stringify(ws)); localStorage.setItem("ce-db", `content-engine-ws-${ws.id}`); }
  location.reload(); };
export async function login(email, password) { afterSignIn(await call("login", { method: "POST", body: { email, password } })); }
export async function setup(f) { afterSignIn(await call("setup", { method: "POST", body: f })); }
export async function inviteInfo(token) { return call("invite_info", { query: `&token=${encodeURIComponent(token)}` }); }
export async function acceptInvite(token, name, password) { afterSignIn(await call("invite_accept", { method: "POST", body: { token, name, password } })); }
export async function logout() { try { await call("logout", { method: "POST" }); } catch { } localStorage.removeItem(WS_KEY); localStorage.setItem("ce-db", DEFAULT_DB); location.reload(); }
export const members = ws => call("members", { query: `&ws=${ws}` });
export const activity = ws => call("activity", { query: `&ws=${ws}` });
export const invite = (ws, email, role) => call("invite", { method: "POST", body: { ws, email, role } });
export const revoke = (ws, token) => call("invite_revoke", { method: "POST", body: { ws, token } });
export const setRole = (ws, user_id, role) => call("member_role", { method: "POST", body: { ws, user_id, role } });
export const remove = (ws, user_id) => call("member_remove", { method: "POST", body: { ws, user_id } });
export const leave = ws => call("leave", { method: "POST", body: { ws } });
export const rename = (ws, name) => call("workspace_rename", { method: "POST", body: { ws, name } });
export const changePassword = (current, password) => call("password", { method: "POST", body: { current, password } });
export const saveName = name => call("profile", { method: "POST", body: { name } });
export async function createWorkspace(name) { const d = await call("workspace_create", { method: "POST", body: { name } }); STATE.workspaces = d.workspaces; return d.workspace; }
