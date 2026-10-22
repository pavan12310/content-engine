// _lib/notify.mjs - chat alerts to Slack, Microsoft Teams and Google Chat through incoming webhooks.
// Webhook addresses are secrets (anyone with one can post to the channel), so they're stored encrypted (AES-256-GCM) on the server;
// the browser only ever sees a masked version. Shared by the notify function and the weekly check.
import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";

export const store = () => getStore({ name: "content-engine-notify", consistency: "strong" });
const keyBytes = () => { const s = process.env.AUTH_SECRET || process.env.TEAM_PASSWORD || ""; return s ? crypto.createHash("sha256").update(`content-engine-hooks:${s}`).digest() : null; };
export const available = () => !!keyBytes();
export function encrypt(text) { const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", keyBytes(), iv); const enc = Buffer.concat([c.update(text, "utf8"), c.final()]); return [iv, c.getAuthTag(), enc].map(b => b.toString("base64url")).join("."); }
export function decrypt(s) { const [iv, tag, enc] = String(s).split(".").map(x => Buffer.from(x, "base64url")); const d = crypto.createDecipheriv("aes-256-gcm", keyBytes(), iv); d.setAuthTag(tag); return Buffer.concat([d.update(enc), d.final()]).toString("utf8"); }
// which service a webhook belongs to (only these three are accepted)
export function kindOf(url) {
  let u; try { u = new URL(url); } catch { return null; }
  if (u.protocol !== "https:") return null;
  if (u.hostname === "hooks.slack.com" && u.pathname.startsWith("/services/")) return "slack";
  if (u.hostname === "chat.googleapis.com" && /^\/v1\/spaces\/[^/]+\/messages$/.test(u.pathname)) return "gchat";
  if (/\.webhook\.office\.com$/.test(u.hostname) || /\.logic\.azure\.com$/.test(u.hostname) || /\.environment\.api\.powerplatform\.com$/.test(u.hostname)) return "teams";
  return null;
}
export const mask = url => { try { const u = new URL(url); return `${u.hostname}/…/${u.pathname.replace(/\/$/, "").slice(-4)}`; } catch { return "…"; } };
export const hooksKey = prefix => `${prefix || ""}hooks`;
export async function listHooks(prefix) { return (await store().get(hooksKey(prefix), { type: "json" })) || []; }
export async function saveHooks(prefix, hooks) { await store().setJSON(hooksKey(prefix), hooks); }
// one message in each service's format: a title, lines of text, and an optional button
export function format(kind, { title, lines: raw = [], level = "info", button = null }) {
  // *bold* in each service's own way: Slack *x*, Teams **x**, Google Chat <b>x</b> (other < and > are removed first)
  const bold = l => { const t = String(l).replace(/[<>]/g, ""); return kind === "teams" ? t.replace(/\*([^*]+)\*/g, "**$1**") : kind === "gchat" ? t.replace(/\*([^*]+)\*/g, "<b>$1</b>") : t; };
  const lines = raw.map(bold);
  const icon = { urgent: "🔴", watch: "🟠", ok: "🟢", info: "🔵" }[level] || "🔵";
  if (kind === "slack") return { text: `${icon} ${title}`, blocks: [{ type: "section", text: { type: "mrkdwn", text: `*${icon} ${title}*${lines.length ? "\n" + lines.map(l => `• ${l}`).join("\n") : ""}` } },
    ...(button ? [{ type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: button.text }, url: button.url }] }] : [])] };
  if (kind === "teams") return { type: "message", attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content: { $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.4",
    body: [{ type: "TextBlock", text: `${icon} ${title}`, weight: "Bolder", size: "Medium", wrap: true }, ...lines.map(l => ({ type: "TextBlock", text: `• ${l}`, wrap: true, spacing: "Small" }))],
    ...(button ? { actions: [{ type: "Action.OpenUrl", title: button.text, url: button.url }] } : {}) } }] };
  // Google Chat: a card with a header, text and a button
  return { text: `${icon} ${title}`, cardsV2: [{ cardId: "ce", card: { header: { title: `${icon} ${title}` }, sections: [{ widgets: [
    ...(lines.length ? [{ textParagraph: { text: lines.map(l => `• ${l}`).join("<br>") } }] : []),
    ...(button ? [{ buttonList: { buttons: [{ text: button.text, onClick: { openLink: { url: button.url } } }] } }] : [])] }] } }] };
}
// send to one hook, at most 30 messages an hour each
export async function sendTo(hook, msg) {
  const st = store(), rk = `rate:${hook.id}:${new Date().toISOString().slice(0, 13)}`, n = Number(await st.get(rk)) || 0;
  if (n >= 30) return { ok: false, error: "rate limit (30 messages an hour)" };
  await st.set(rk, String(n + 1));
  let url; try { url = decrypt(hook.enc); } catch { return { ok: false, error: "couldn't read the stored webhook (was AUTH_SECRET or TEAM_PASSWORD changed?)" }; }
  if (process.env.NOTIFY_TEST_SINK) url = process.env.NOTIFY_TEST_SINK + "?kind=" + hook.kind;   // local testing only: send to a stand-in
  const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 6000);
  try { const r = await fetch(url, { method: "POST", signal: ctrl.signal, headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(format(hook.kind, msg)) });
    return r.ok ? { ok: true } : { ok: false, error: `${hook.kind === "teams" ? "Teams" : hook.kind === "gchat" ? "Google Chat" : "Slack"} answered ${r.status}${r.status === 404 || r.status === 410 ? " (the webhook was removed)" : ""}` }; }
  catch (e) { return { ok: false, error: e.name === "AbortError" ? "timed out" : "unreachable" }; }
  finally { clearTimeout(t); }
}
// send an event to every hook in a scope that wants it (event = "weekly" | "urgent" | "approval" | "test")
export async function notify(prefix, event, msg) {
  if (!available()) return { sent: 0 };
  const hooks = (await listHooks(prefix)).filter(h => event === "test" || h.events?.[event]); let sent = 0; const errors = [];
  for (const h of hooks) { const r = await sendTo(h, msg); if (r.ok) sent++; else errors.push({ name: h.name, error: r.error }); }
  if (hooks.length) { const all = await listHooks(prefix); for (const h of all) { const e = errors.find(x => x.name === h.name); if (hooks.some(x => x.id === h.id)) { h.last = { at: Date.now(), ok: !e, error: e?.error || "" }; } } await saveHooks(prefix, all); }
  return { sent, errors };
}

// ---- combining, quiet hours and repeats (urgent alerts) ----
// Netlify functions can't wait and send later, so held alerts go out on the hourly scheduled run (flush), combined into one message.
const STATE = prefix => `${prefix || ""}notify-state`;
const lineKey = l => crypto.createHash("sha1").update(String(l)).digest("base64url").slice(0, 12);
async function readState(prefix) { return (await store().get(STATE(prefix), { type: "json" })) || { sent: {}, queue: {}, last: {} }; }
async function writeState(prefix, st) { await store().setJSON(STATE(prefix), st); }
// minutes since midnight in a time zone
const localMinutes = (tz, now = new Date()) => { try { const p = new Intl.DateTimeFormat("en-GB", { timeZone: tz || "UTC", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now); const h = +p.find(x => x.type === "hour").value % 24, m = +p.find(x => x.type === "minute").value; return h * 60 + m; } catch { return now.getUTCHours() * 60 + now.getUTCMinutes(); } };
const toMin = s => { const m = String(s || "").match(/^(\d{1,2}):(\d{2})$/); return m ? (+m[1]) * 60 + (+m[2]) : null; };
export function inQuiet(hook, now = new Date()) {
  const q = hook.quiet; if (!q || q.start == null || q.end == null) return false;
  const a = toMin(q.start), b = toMin(q.end); if (a == null || b == null || a === b) return false;
  const t = localMinutes(q.tz, now); return a < b ? t >= a && t < b : t >= a || t < b;   // e.g. 20:00-08:00 wraps past midnight
}
const COMBINE_MS = Number(process.env.NOTIFY_COMBINE_MS) || 10 * 60 * 1000, REPEAT_MS = 24 * 3600 * 1000;   // NOTIFY_COMBINE_MS: local testing only
// an urgent alert: repeats dropped, then sent now or held (quiet hours, or within 10 minutes of the last one)
export async function urgent(prefix, msg) {
  if (!available()) return { sent: 0, held: 0, skipped: 0 };
  const hooks = (await listHooks(prefix)).filter(h => h.events?.urgent), st = await readState(prefix), now = Date.now(); let sent = 0, held = 0, skipped = 0;
  for (const h of hooks) {
    const seen = st.sent[h.id] || {}, fresh = (msg.lines || []).filter(l => !(seen[lineKey(l)] > now - REPEAT_MS));
    if (msg.lines?.length && !fresh.length) { skipped++; continue; }
    const item = { at: now, title: msg.title, lines: fresh.length ? fresh : msg.lines || [], button: msg.button || null };
    if (inQuiet(h) || now - (st.last[h.id] || 0) < COMBINE_MS) { (st.queue[h.id] = st.queue[h.id] || []).push(item); held++; continue; }
    const items = [...(st.queue[h.id] || []), item], r = await sendTo(h, combine(items));
    if (r.ok) { sent++; st.last[h.id] = now; st.queue[h.id] = []; markSent(st, h.id, items); }
  }
  await writeState(prefix, st); return { sent, held, skipped };
}
function markSent(st, hookId, items) { const s = st.sent[hookId] = st.sent[hookId] || {}, now = Date.now(); for (const it of items) for (const l of it.lines) s[lineKey(l)] = now; for (const [k, t] of Object.entries(s)) if (t < now - REPEAT_MS) delete s[k]; }
function combine(items) {
  if (items.length === 1) return { title: items[0].title, lines: items[0].lines, level: "urgent", button: items[0].button };
  const lines = [...new Set(items.flatMap(i => i.lines))].slice(0, 15);
  return { title: `${items.length} urgent alerts${items[0] ? ` since ${new Date(items[0].at).toISOString().slice(11, 16)} UTC` : ""}`, lines, level: "urgent", button: items.find(i => i.button)?.button || null };
}
// on the hourly run: send what was held, combined, for channels that are out of quiet hours and past the 10-minute window
export async function flush(prefix) {
  if (!available()) return { sent: 0 };
  const st = await readState(prefix), hooks = await listHooks(prefix), now = Date.now(); let sent = 0;
  for (const h of hooks) { const q = st.queue[h.id] || []; if (!q.length || inQuiet(h) || now - (st.last[h.id] || 0) < COMBINE_MS) continue;
    const r = await sendTo(h, combine(q)); if (r.ok) { sent++; st.last[h.id] = now; st.queue[h.id] = []; markSent(st, h.id, q); } }
  if (sent) await writeState(prefix, st); return { sent };
}
export async function heldCount(prefix) { const st = await readState(prefix); return Object.fromEntries(Object.entries(st.queue || {}).map(([k, v]) => [k, v.length])); }
