// _lib/auth.mjs - shared sign-in logic for the Netlify functions (not a function itself: it lives in a folder without an index file).
// Accounts, workspaces and invites live in Netlify Blobs. Passwords are stored only as scrypt hashes. Sessions are signed,
// HttpOnly cookies that page scripts can't read. Enabled when AUTH_SECRET is set in Netlify.
import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";

export const ROLES = ["owner", "admin", "editor", "viewer", "client"];
export const CAN = {
  write: r => ["owner", "admin", "editor"].includes(r),
  manage: r => ["owner", "admin"].includes(r),
};
const COOKIE = "ce_session", DAY = 86400;
export const enabled = () => !!(process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 16);
export const authStore = () => getStore({ name: "content-engine-auth", consistency: "strong" });
export const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
export const sameText = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
export const normEmail = e => String(e || "").trim().toLowerCase();
export const validEmail = e => /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i.test(e);
export const id = (n = 12) => crypto.randomBytes(n).toString("base64url");

// ---- passwords ----
export function hashPassword(pw, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(pw), salt, 64, { N: 16384, r: 8, p: 1 }).toString("hex");
  return { salt, hash };
}
export function checkPassword(pw, salt, hash) {
  const h = crypto.scryptSync(String(pw), salt, 64, { N: 16384, r: 8, p: 1 });
  return h.length === Buffer.from(hash, "hex").length && crypto.timingSafeEqual(h, Buffer.from(hash, "hex"));
}
export const passwordProblem = pw => String(pw || "").length < 10 ? "Use at least 10 characters." : null;

// ---- signed session tokens: base64url(payload).hmac ----
function sign(data) { return crypto.createHmac("sha256", process.env.AUTH_SECRET).update(data).digest("base64url"); }
export function makeToken(user, days = 30) {
  const payload = Buffer.from(JSON.stringify({ uid: user.id, email: user.email, v: user.pwv || 1, exp: Math.floor(Date.now() / 1000) + days * DAY })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}
export function readToken(tok) {
  if (!tok || !tok.includes(".")) return null;
  const [payload, sig] = tok.split(".");
  if (!sig || !sameText(sig, sign(payload))) return null;
  try { const d = JSON.parse(Buffer.from(payload, "base64url").toString()); return d.exp > Date.now() / 1000 ? d : null; } catch { return null; }
}
export const sessionCookie = (tok, req) => `${COOKIE}=${tok}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${30 * DAY}${new URL(req.url).protocol === "https:" ? "; Secure" : ""}`;
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
const cookieOf = req => { const m = (req.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`)); return m ? m[1] : ""; };

// ---- data helpers ----
export async function getUserByEmail(store, email) { return store.get(`user:${normEmail(email)}`, { type: "json" }); }
export async function saveUser(store, u) { await store.setJSON(`user:${u.email}`, u); }
export async function getWorkspace(store, wsid) { return store.get(`ws:${wsid}`, { type: "json" }); }
export async function saveWorkspace(store, ws) { await store.setJSON(`ws:${ws.id}`, ws); }
export async function userCount(store) { const { blobs } = await store.list({ prefix: "user:" }); return blobs.length; }
export const publicUser = u => ({ id: u.id, email: u.email, name: u.name || "", created_at: u.created_at });

// who is calling? returns { user } or { error: Response }
export async function currentUser(req) {
  if (!enabled()) return { error: json(501, { error: "Accounts aren't set up on this site." }) };
  const t = readToken(cookieOf(req)); if (!t) return { error: json(401, { error: "Please sign in." }) };
  const store = authStore(), u = await getUserByEmail(store, t.email);
  if (!u || u.id !== t.uid || u.disabled || (u.pwv || 1) !== t.v) return { error: json(401, { error: "Your session has ended. Please sign in again." }) };
  return { user: u, store };
}
// the caller's role in a workspace (null if not a member)
export async function roleIn(store, user, wsid) { const ws = wsid ? await getWorkspace(store, wsid) : null; return ws ? { ws, role: ws.members?.[user.id]?.role || null } : { ws: null, role: null }; }

// activity log per workspace (last 500 events)
export async function logActivity(store, wsid, entry) {
  const key = `log:${wsid}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = await store.getWithMetadata(key, { type: "json" });
    const list = [{ at: Date.now(), ...entry }, ...((cur && cur.data) || [])].slice(0, 500);
    const res = await store.setJSON(key, list, cur ? { onlyIfMatch: cur.etag } : { onlyIfNew: true });
    if (!res || res.modified !== false) return;
  }
}
// simple login throttle: max 8 failed attempts per email per 15 minutes
export async function throttled(store, email) {
  const k = `throttle:${normEmail(email)}`, t = await store.get(k, { type: "json" }) || { n: 0, since: Date.now() };
  return Date.now() - t.since < 15 * 60e3 && t.n >= 8;
}
export async function noteFailure(store, email) {
  const k = `throttle:${normEmail(email)}`, t = await store.get(k, { type: "json" });
  const fresh = !t || Date.now() - t.since > 15 * 60e3;
  await store.setJSON(k, fresh ? { n: 1, since: Date.now() } : { ...t, n: t.n + 1 });
}
export async function clearFailures(store, email) { await store.delete(`throttle:${normEmail(email)}`); }
