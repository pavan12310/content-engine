// monitor.mjs - the weekly check, run by Netlify every hour with no browser open.
// For every workspace (or the shared team) that turned on Weekly monitoring, it checks the websites not checked in the
// last 7 days, using the same check logic as "Run the check now" in the browser (public/js/monitor-core.mjs):
// important pages, Google traffic (via the encrypted Search Console connection), Google updates, pages waiting for
// approval and overdue to-dos. Results go into the team's synced data (they appear on Home) and one email per workspace
// per run (Resend). Netlify gives scheduled functions 30 seconds; work that doesn't fit is picked up the next hour.
import zlib from "node:zlib";
import dns from "node:dns/promises";
import net from "node:net";
import { getStore } from "@netlify/blobs";
import * as MON from "../../public/js/monitor-core.mjs";
import * as COMP from "../../public/js/competitors-core.mjs";
import * as NOTIFY from "./_lib/notify.mjs";
import * as IDXC from "../../public/js/index-core.mjs";
import * as DECAYC from "../../public/js/decay-core.mjs";
import * as RANKC from "../../public/js/rank-core.mjs";
import { accessToken, gapi, configured as gscConfigured, ga4Report } from "./gsc.mjs";

const WEEK = 7 * 864e5, BUDGET_MS = 23000, UA = "Mozilla/5.0 (compatible; ContentEngineBot/1.0; +content-audit)";
const PRIVATE = [/^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^::1$/, /^f[cd]/i, /^fe80/i];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// the team's synced data is gzip + base64 JSON with newest-wins metadata
const unpack = d => { try { return d ? JSON.parse(zlib.gunzipSync(Buffer.from(d, "base64")).toString("utf8")) : null; } catch { return null; } };
const pack = v => zlib.gzipSync(Buffer.from(JSON.stringify(v))).toString("base64");
async function read(store, key) { const r = await store.getWithMetadata(key, { type: "text" }); return r && !r.metadata?.deleted ? unpack(r.data) : null; }
async function write(store, key, value) {
  for (let i = 0; i < 3; i++) {
    const cur = await store.getMetadata(key), data = pack(value);
    const res = await store.set(key, data, { metadata: { at: Date.now(), by: "weekly check", deleted: false, size: data.length }, ...(cur ? { onlyIfMatch: cur.etag } : { onlyIfNew: true }) });
    if (!res || res.modified !== false) return true;
  }
  return false;
}
// reading pages: public addresses only, short timeouts, redirects followed and reported
async function isPublic(u) {
  if (process.env.MONITOR_ALLOW_LOCAL === "1") return true;   // local testing only; never set this on Netlify
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) return false;
  const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => [])).map(a => a.address);
  return addrs.length > 0 && !addrs.some(a => PRIVATE.some(re => re.test(a)));
}
async function fetchPage(url) {
  let target = url;
  for (let hop = 0; hop < 5; hop++) {
    let u; try { u = new URL(target); } catch { return { status: 0, error: "bad address" }; }
    if (!(await isPublic(u))) return { status: 0, error: "private address" };
    const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 6000);
    try {
      const r = await fetch(target, { redirect: "manual", signal: ctrl.signal, headers: { "user-agent": UA, accept: "text/html,*/*;q=0.5" } });
      if ([301, 302, 303, 307, 308].includes(r.status) && r.headers.get("location")) { target = new URL(r.headers.get("location"), target).toString(); continue; }
      const html = /html/i.test(r.headers.get("content-type") || "") ? (await r.text()).slice(0, 2_000_000) : "";
      return { status: r.status, final_url: target, html };
    } catch (e) { return { status: 0, error: e.name === "AbortError" ? "timeout" : "no response" }; }
    finally { clearTimeout(t); }
  }
  return { status: 0, error: "too many redirects" };
}
// "Is this page in Google?" for up to 5 important pages a week, through the encrypted Search Console connection
const INSPECT = process.env.GSC_INSPECT_BASE || "https://searchconsole.googleapis.com/v1";
async function checkIndex(store, prefix, site, deadline) {
  const P = n => `${prefix}${n}:${site.id}`, conn = await read(store, P("gsc-conn")); if (!conn || !conn.property || !conn.token || !gscConfigured()) return null;
  const prev = (await read(store, P("index"))) || { results: [], changes: [] }, pages = (await read(store, P("pages"))) || [], imports = (await read(store, P("gsc"))) || [];
  const urls = MON.pickPages(pages, imports[0]?.rows || [], 10).map(p => p.url), plan = IDXC.due(prev.results, urls, { days: 6 });
  if (!plan.todo.length) return null;
  const at = await accessToken(conn.token), out = [];
  for (const url of plan.todo.slice(0, 5)) {
    if (Date.now() > deadline - 4000) break;
    const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 6000);
    try { const r = await fetch(`${INSPECT}/urlInspection/index:inspect`, { method: "POST", signal: ctrl.signal, headers: { authorization: `Bearer ${at}`, "content-type": "application/json" }, body: JSON.stringify({ inspectionUrl: url, siteUrl: conn.property, languageCode: "en-US" }) });
      if (r.ok) out.push({ url, at: Date.now(), by: "schedule", ...IDXC.explain((await r.json()).inspectionResult || {}) }); else if (r.status === 429) break; }
    catch { } finally { clearTimeout(t); }
  }
  if (!out.length) return null;
  const m = IDXC.merge(prev.results, out);
  await write(store, P("index"), { ...prev, at: Date.now(), results: m.results, changes: [...m.changes, ...(prev.changes || [])].slice(0, 50), checked: out.length, skipped: plan.skipped, by: "schedule" });
  return m.changes;
}
// ranking drops: tracked keywords with real traffic that fell 3+ places over 28 days (one Search Console request)
async function checkRanks(store, prefix, site) {
  const P = n => `${prefix}${n}:${site.id}`, conn = await read(store, P("gsc-conn")); if (!conn || !conn.property || !conn.token || !gscConfigured()) return null;
  const kws = ((await read(store, P("keywords"))) || []).map(k => k.keyword).filter(Boolean).slice(0, 150); if (!kws.length) return null;
  const at = await accessToken(conn.token);
  const snap = await RANKC.fetchSeries(kws, async (dims, from, to, re) => ((await gapi(`/sites/${encodeURIComponent(conn.property)}/searchAnalytics/query`, at, { startDate: from, endDate: to, dimensions: dims, rowLimit: 25000, dataState: "final",
    dimensionFilterGroups: [{ filters: [{ dimension: "query", operator: "includingRegex", expression: re }] }] })).rows || []));
  return RANKC.drops(RANKC.table(snap));
}
// Google Analytics: conversions from search against the 28 days before (and a fresh snapshot for the team)
async function checkGa4(store, prefix, site) {
  const P = n => `${prefix}${n}:${site.id}`, conn = await read(store, P("ga4-conn")); if (!conn || !conn.property || !conn.token || !gscConfigured()) return null;
  const r = await ga4Report(await accessToken(conn.token), conn.property, { days: 28, organic: true, event: conn.event || "" });
  const sum = rows => rows.reduce((t, x) => ({ sessions: t.sessions + (x.sessions || 0), engaged: t.engaged + (x.engaged || 0), conversions: t.conversions + (x.conversions || 0), revenue: t.revenue + (x.revenue || 0) }), { sessions: 0, engaged: 0, conversions: 0, revenue: 0 });
  const rows = r.rows.filter(x => x.sessions || x.prev.sessions).sort((a, b) => b.sessions - a.sessions).slice(0, 1000), totals = sum(rows), prev = sum(rows.map(x => x.prev));
  await write(store, P("ga4"), { at: Date.now(), days: 28, organic: true, event: r.event || "", property: conn.property, rows, totals, prev_totals: prev, ai: r.ai || [], conv_metric: r.conv_metric, currency: r.currency, by: "schedule" });
  return { now: totals.conversions, before: prev.conversions };
}
// content decay: pages losing Google clicks month after month. Months are cached in a separate store (not shared with browsers),
// so after the first run only the newest month is fetched
async function checkDecay(store, prefix, site, deadline) {
  const P = n => `${prefix}${n}:${site.id}`, conn = await read(store, P("gsc-conn")); if (!conn || !conn.property || !conn.token || !gscConfigured()) return null;
  const cstore = getStore({ name: "content-engine-cache", consistency: "strong" }), ck = `${prefix}decaymonths:${site.id}`;
  const months = DECAYC.lastMonths(6), cache = (await cstore.get(ck, { type: "json" })) || {}, missing = DECAYC.missingMonths(cache, months);
  if (missing.length) { const at = await accessToken(conn.token);
    for (const m of missing) { if (Date.now() > deadline - 5000) return null;
      const d = await gapi(`/sites/${encodeURIComponent(conn.property)}/searchAnalytics/query`, at, { startDate: m.from, endDate: m.to, dimensions: ["page"], rowLimit: 5000, dataState: "final" });
      cache[m.from] = DECAYC.compactRows((d.rows || []).map(r => ({ page: r.keys[0], clicks: r.clicks, impressions: r.impressions, position: r.position }))); }
    for (const k of Object.keys(cache)) if (!months.some(m => m.from === k)) delete cache[k];
    await cstore.setJSON(ck, cache); }
  const prev = await read(store, P("decay")), pages = (await read(store, P("pages"))) || [];
  const found = DECAYC.analyse(months.map(m => ({ ...m, rows: DECAYC.expandRows(cache[m.from]) })), { pages });
  await write(store, P("decay"), { at: Date.now(), source: "live", months: months.map(m => m.label), pages: found.slice(0, 100), fetched: missing.length, by: "schedule" });
  return DECAYC.newlyDeclining(prev?.pages, found);
}
// competitors: their public sitemaps, compared with last week's snapshot (same logic as "Check now" in the browser)
async function fetchText(url) {
  let u; try { u = new URL(url); } catch { return { status: 0, text: "" }; }
  if (!(await isPublic(u))) return { status: 0, text: "" };
  const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 5000);
  try { const r = await fetch(url, { signal: ctrl.signal, redirect: "follow", headers: { "user-agent": UA } }); return { status: r.status, text: (await r.text()).slice(0, 5_000_000) }; }
  catch { return { status: 0, text: "" }; } finally { clearTimeout(t); }
}
const words = t => new Set(String(t || "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 3));
async function checkCompetitors(store, prefix, siteId, deadline) {
  const key = `${prefix}competitors:${siteId}`, list = (await read(store, key)) || []; if (!list.length) return null;
  const due = list.filter(c => Date.now() - (c.last_check || 0) > WEEK - 3600e3).slice(0, 2); if (!due.length) return null;
  const kws = ((await read(store, `${prefix}keywords:${siteId}`)) || []).map(k => k.keyword), pages = (await read(store, `${prefix}pages:${siteId}`)) || [];
  const summary = [];
  for (const c of due) {
    if (Date.now() > deadline - 6000) break;
    const sk = `${prefix}compsnap:${siteId}:${c.id}`, prevSnap = await read(store, sk);
    const res = await COMP.collect(c.url, fetchText, { maxFiles: 10, maxUrls: 10000, deadline: deadline - 4000, prev: prevSnap });
    if (!Object.keys(res.urls).length) continue;
    const prev = COMP.snapUrls(prevSnap), d = COMP.diff(prev, res.urls), entry = { at: Date.now(), tracked: Object.keys(res.urls).length, baseline: !prev, by: "schedule", files_fetched: res.fetched, files_reused: res.reused };
    if (prev) {
      const added = [];
      for (const [i, u] of d.added.slice(0, 50).entries()) {
        let title = ""; if (i < 5 && Date.now() < deadline - 3000) title = COMP.titleOf((await fetchText(u)).text);
        const tt = words(`${title} ${COMP.slugWords(u)}`);
        let best = "", bs = 0; for (const k of kws) { const kw = [...words(k)]; if (!kw.length) continue; const n = kw.filter(w => tt.has(w)).length / kw.length; if (n > bs) { bs = n; best = k; } }
        const covered = pages.some(p => { const pw = words(p.title); let n = 0; for (const w of tt) if (pw.has(w)) n++; return tt.size && n / tt.size >= 0.6; });
        added.push({ url: u, title: title || COMP.slugWords(u), overlap: bs >= 0.6 ? { kind: covered ? "keyword_covered" : "keyword_gap", keyword: best } : covered ? { kind: "covered" } : { kind: "new_topic" } });
      }
      Object.assign(entry, { added, added_count: d.added.length, removed: d.removed.slice(0, 50), removed_count: d.removed.length, updated: d.updated.slice(0, 50), updated_count: d.updated.length });
      summary.push({ name: c.name, added: d.added.length, gaps: added.filter(a => a.overlap.kind === "keyword_gap").length });
    }
    await write(store, sk, COMP.toSnapshot(res));
    const fresh = (await read(store, key)) || list, cc = fresh.find(x => x.id === c.id);
    if (cc) { Object.assign(cc, { last_check: Date.now(), updated_at: Date.now(), tracked: entry.tracked, capped: res.capped, history: [entry, ...(cc.history || [])].slice(0, 20) }); await write(store, key, fresh); }
  }
  return summary;
}
// Google: live data through the encrypted connection
async function googleWeek(conn) {
  if (!conn || !conn.property || !conn.token || !gscConfigured()) return null;
  const at = await accessToken(conn.token), DAY = 864e5, iso = d => new Date(d).toISOString().slice(0, 10);
  const end = Date.now() - 3 * DAY, mid = end - 7 * DAY, start = end - 13 * DAY;
  const q = (dims, from, to, rowLimit) => gapi(`/sites/${encodeURIComponent(conn.property)}/searchAnalytics/query`, at, { startDate: from, endDate: to, dimensions: dims, rowLimit, dataState: "final" }).then(d => d.rows || []);
  const [dates, now, before] = await Promise.all([q(["date"], iso(start), iso(end), 100), q(["query"], iso(mid + DAY), iso(end), 1000), q(["query"], iso(start), iso(mid), 1000)]);
  return MON.gscWeek(dates, now, before);
}
let UPDATES = null;
async function googleUpdates() {
  if (UPDATES) return UPDATES;
  try { const r = await fetch(process.env.GOOGLE_STATUS_FEED || "https://status.search.google.com/incidents.json", { signal: AbortSignal.timeout(5000) });
    UPDATES = (await r.json()).filter(x => (x.affected_products || []).some(p => /ranking/i.test(p.title || ""))).map(x => ({ name: x.external_desc, start: String(x.begin).slice(0, 10), ongoing: !x.end })); }
  catch { UPDATES = []; }
  return UPDATES;
}
// one website
async function checkSite(store, prefix, siteRow, deadline) {
  const id = siteRow.id, P = k => `${prefix}${k}:${id}`;
  const [pages, imports, hist, conn, contents, recs] = await Promise.all([read(store, P("pages")), read(store, P("gsc")), read(store, P("monitor")), read(store, P("gsc-conn")), read(store, P("contents")), read(store, P("recs"))]);
  if (!pages || !pages.length) return null;
  const list = MON.baselines(MON.pickPages(pages, (imports && imports[0] && imports[0].rows) || [], 15), (hist || [])[0]);
  const res = await MON.checkPages(list, fetchPage, { concurrency: 8, budgetMs: Math.max(3000, Math.min(12000, deadline - Date.now() - 6000)) });
  let google = null, google_source = "";
  try { google = await googleWeek(conn); if (google) google_source = "live"; } catch (e) { google_source = `couldn't refresh: ${e.message}`; }
  if (!google && imports && imports[0]) { google = MON.gscWeek(imports[0].rows.filter(r => r.kind === "date")); if (google) google_source = google_source || "last import"; }
  const prevAt = (hist && hist[0] && hist[0].at) || Date.now() - WEEK, today = new Date().toISOString().slice(0, 10);
  const updates = (await googleUpdates()).filter(u => Date.parse(u.start) > prevAt - 864e5 || (u.ongoing && Date.parse(u.start) > Date.now() - 21 * 864e5));
  const snap = { at: Date.now(), by: "schedule", site: { name: siteRow.name || siteRow.url, url: siteRow.url }, pages: res, google, google_source, updates,
    pending_approval: (contents || []).filter(c => c.status === "ready_for_human_review").length,
    overdue: (recs || []).filter(r => ["open", "in_progress"].includes(r.status) && r.due && r.due < today).length };
  snap.summary = MON.summarise(snap);
  await write(store, P("monitor"), [snap, ...(hist || [])].slice(0, 12));
  return snap;
}
// the email
const COLORS = { alert: "#b91c1c", watch: "#b45309", good: "#047857", info: "#6b7280", ok: "#047857" };
const LABEL = { alert: "Needs attention", watch: "Keep an eye on", good: "Good news", info: "For information" };
export function emailHtml(name, snaps, appUrl) {
  const order = { alert: 0, watch: 1, ok: 2 }, sorted = [...snaps].sort((a, b) => order[a.summary.level] - order[b.summary.level]);
  const site = s => `<div style="border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;margin:0 0 14px">
    <div style="font-weight:700;font-size:16px">${esc(s.site.name)} <span style="font-weight:600;font-size:12px;color:${COLORS[s.summary.level]};border:1px solid ${COLORS[s.summary.level]};border-radius:99px;padding:1px 8px;margin-left:6px">${esc(s.summary.headline)}</span></div>
    <div style="color:#6b7280;font-size:12px;margin:2px 0 8px">${esc(s.site.url)} · ${s.pages.checked} important pages checked${s.google && s.google.clicks_change != null ? ` · Google clicks ${s.google.clicks_change > 0 ? "+" : ""}${s.google.clicks_change}% (last 7 days)` : ""}</div>
    ${s.summary.items.length ? `<ul style="margin:0;padding-left:18px">${s.summary.items.slice(0, 10).map(i => `<li style="margin:4px 0"><b style="color:${COLORS[i.level]}">${LABEL[i.level] || i.level}:</b> ${esc(i.text)}${i.detail ? `<br><span style="color:#6b7280;font-size:13px">${esc(i.detail)}</span>` : ""}</li>`).join("")}</ul>` : `<p style="margin:0;color:#047857">Nothing important changed.</p>`}</div>`;
  return `<!doctype html><html><body style="margin:0;background:#f5f6f8;font:15px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111827">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px"><div style="background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:24px">
  <div style="color:#6b7280;font-size:13px">Content Engine · weekly check</div><h1 style="font-size:21px;margin:4px 0 16px">${esc(name)}: what changed this week</h1>
  ${sorted.map(site).join("")}
  ${appUrl ? `<p style="margin:16px 0 0"><a href="${esc(appUrl)}" style="background:#0f766e;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600;display:inline-block">Open Content Engine</a></p>` : ""}
  <p style="color:#9ca3af;font-size:12px;margin:18px 0 0">You get this because you're listed under Settings → Alerts. Change the list there to stop or add people.</p>
  </div></div></body></html>`;
}
async function sendEmail(to, subject, html) {
  const key = process.env.RESEND_API_KEY, from = process.env.MONITOR_FROM;
  if (!key || !from) return { skipped: "email isn't set up (RESEND_API_KEY and MONITOR_FROM)" };
  if (!to.length) return { skipped: "no recipients" };
  try {
    const r = await fetch(`${process.env.RESEND_BASE || "https://api.resend.com"}/emails`, { method: "POST", signal: AbortSignal.timeout(8000),
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ from, to, subject, html }) });
    const d = await r.json().catch(() => ({})); return r.ok ? { sent: to.length, id: d.id } : { error: d.message || `email failed (${r.status})` };
  } catch (e) { return { error: e.message }; }
}
// one hourly run
export async function runOnce({ now = Date.now(), force = false } = {}) {
  UPDATES = null;
  const deadline = now + BUDGET_MS, store = getStore({ name: "content-engine-team", consistency: "strong" }), out = [];
  const { blobs } = await store.list();
  // chat alerts held for quiet hours or combining: every team and workspace with chat channels, whether or not monitoring is on
  try { const { blobs: hk } = await NOTIFY.store().list(); for (const k of hk.map(b => b.key).filter(k => /^(w:[^:]+:)?hooks$/.test(k))) await NOTIFY.flush(k.replace(/hooks$/, "")).catch(() => {}); } catch { }
  const scopes = blobs.map(b => b.key).filter(k => /^(w:[^:]+:)?monitor-settings$/.test(k)).map(k => k.replace(/monitor-settings$/, ""));
  for (const prefix of scopes) {
    if (Date.now() > deadline - 4000) break;
    const settings = await read(store, `${prefix}monitor-settings`); if (!settings || !settings.enabled) continue;
    const sites = (await read(store, `${prefix}sites`)) || [], done = [], skipped = [];
    for (const s of sites) {
      if (Date.now() > deadline - 7000) { skipped.push(s.id); continue; }   // next hour
      const hist = await read(store, `${prefix}monitor:${s.id}`), last = (hist && hist[0] && hist[0].at) || 0;
      if (!force && now - last < WEEK - 3600e3) continue;   // checked within the last week
      if (Array.isArray(settings.sites) && settings.sites.length && !settings.sites.includes(s.id)) continue;   // not one of the chosen websites (always respected)
      // the chosen day (UTC); if a week was missed (8+ days), run at the next opportunity
      if (!force && settings.day != null && new Date(now).getUTCDay() !== settings.day && last && now - last < 8 * 864e5) continue;
      try { const snap = await checkSite(store, prefix, s, deadline);
        if (snap) {
          // index status of important pages, if there's time left
          const ixc = Date.now() < deadline - 10000 ? await checkIndex(store, prefix, s, deadline).catch(() => null) : null;
          for (const c of (ixc || []).filter(c => c.kind === "dropped")) { snap.summary.items.unshift({ level: "alert", text: `Dropped out of Google: ${c.url.replace(/^https?:\/\/[^/]+/, "") || "/"} (now “${c.to}”)`, detail: "See Site health → In Google" }); snap.summary.level = "alert"; snap.summary.headline = "Needs attention"; }
          for (const c of (ixc || []).filter(c => c.kind === "fixed")) snap.summary.items.push({ level: "good", text: `Back in Google: ${c.url.replace(/^https?:\/\/[^/]+/, "") || "/"}` });
          // calendar items past their due date
          { const plan = (await read(store, `${prefix}plan:${s.id}`)) || [], today = new Date().toISOString().slice(0, 10), over = plan.filter(c => c.due && c.due < today && c.stage !== "published");
            if (over.length) snap.summary.items.push({ level: "info", text: `${over.length} calendar item${over.length > 1 ? "s are" : " is"} overdue: ${over.slice(0, 3).map(c => c.title || c.keyword).join(", ")}${over.length > 3 ? "…" : ""}`, detail: "See Calendar" }); }
          // ranking drops, if there's time left
          const rk = Date.now() < deadline - 9000 ? await checkRanks(store, prefix, s).catch(() => null) : null;
          if (rk && rk.length) { snap.summary.items.push({ level: "watch", text: `Ranking drops: ${rk.slice(0, 3).map(r => `“${r.keyword}” ▼ ${Math.abs(r.change28)} (now ${r.pos})`).join(", ")}${rk.length > 3 ? ` and ${rk.length - 3} more` : ""}`, detail: "See Performance → Rankings" }); if (snap.summary.level === "ok") { snap.summary.level = "watch"; snap.summary.headline = "A few things to keep an eye on"; } }
          // Google Analytics conversions, if there's time left
          const ga = Date.now() < deadline - 8000 ? await checkGa4(store, prefix, s).catch(() => null) : null;
          if (ga && ga.before >= 10 && ga.now <= ga.before * 0.75) { snap.summary.items.unshift({ level: "watch", text: `Conversions from Google search down ${Math.round(100 * (1 - ga.now / ga.before))}% (${Math.round(ga.now)} vs ${Math.round(ga.before)} in the 28 days before)`, detail: "See Performance → Google Analytics" }); if (snap.summary.level === "ok") { snap.summary.level = "watch"; snap.summary.headline = "A few things to keep an eye on"; } }
          // content decay, if there's time left
          const dcy = Date.now() < deadline - 9000 ? await checkDecay(store, prefix, s, deadline).catch(() => null) : null;
          for (const x of (dcy || []).slice(0, 5)) snap.summary.items.push({ level: x.level === "early" ? "info" : "watch", text: `${x.level === "early" ? "Starting to lose" : "Losing"} Google clicks: ${x.url.replace(/^https?:\/\/[^/]+/, "") || "/"} (−${x.decline}% since ${x.peak_label})`, detail: "See Performance → Content decay" });
          if ((dcy || []).some(x => x.level !== "early") && snap.summary.level === "ok") { snap.summary.level = "watch"; snap.summary.headline = "A few things to keep an eye on"; }
          // competitors, if there's time left in this run
          const comp = Date.now() < deadline - 8000 ? await checkCompetitors(store, prefix, s.id, deadline).catch(() => null) : null;
          for (const c of comp || []) if (c.added) { snap.summary.items.push({ level: c.gaps ? "watch" : "info", text: `${c.name} published ${c.added} new page${c.added > 1 ? "s" : ""}${c.gaps ? `, ${c.gaps} on your keywords where you have no page` : ""}`, detail: "See Competitors" }); if (c.gaps && snap.summary.level === "ok") { snap.summary.level = "watch"; snap.summary.headline = "A few things to keep an eye on"; } }
          if (true) { const k = `${prefix}monitor:${s.id}`, h = (await read(store, k)) || []; if (h[0] && h[0].at === snap.at) { h[0] = snap; await write(store, k, h); } }
          done.push(snap);
        } } catch (e) { out.push({ scope: prefix || "team", site: s.id, error: e.message }); }
    }
    if (!done.length) { if (skipped.length) out.push({ scope: prefix || "team", deferred: skipped.length }); continue; }
    let wsName = "Your websites";
    if (prefix) { try { wsName = (await getStore({ name: "content-engine-auth", consistency: "strong" }).get(`ws:${prefix.split(":")[1]}`, { type: "json" }))?.name || "Your workspace"; } catch { } }
    const needs = done.some(s => s.summary.level !== "ok");
    let email = { skipped: "nothing needs attention (only-changes is on)" };
    if (!settings.only_changes || needs) {
      const worst = done.some(s => s.summary.level === "alert") ? "Needs attention" : needs ? "A few things to check" : "All good";
      email = await sendEmail(settings.emails || [], `${worst}: weekly check for ${wsName}`, emailHtml(wsName, done, process.env.URL || process.env.APP_URL || ""));
    }
    // chat alerts: the weekly summary, and urgent problems as their own alert
    let chat = null;
    try {
      const app = process.env.URL || process.env.APP_URL || "", button = app.startsWith("https://") ? { text: "Open Content Engine", url: app } : null;
      const lines = done.flatMap(s => [`*${s.site.name}*: ${s.summary.headline}`, ...s.summary.items.filter(i => i.level === "alert" || i.level === "watch").slice(0, 4).map(i => i.text)]).slice(0, 12);
      const worstLevel = done.some(s => s.summary.level === "alert") ? "urgent" : done.some(s => s.summary.level === "watch") ? "watch" : "ok";
      chat = await NOTIFY.notify(prefix, "weekly", { title: `Weekly check for ${wsName}`, lines, level: worstLevel, button });
      const urgent = done.filter(s => s.summary.level === "alert");
      if (urgent.length) { const u = await NOTIFY.urgent(prefix, { title: `Urgent: ${urgent.map(s => s.site.name).join(", ")}`, lines: urgent.flatMap(s => s.summary.items.filter(i => i.level === "alert").map(i => `${s.site.name}: ${i.text}`)).slice(0, 8), level: "urgent", button }); chat.sent += u.sent; }
    } catch (e) { chat = { error: e.message }; }
    out.push({ scope: prefix || "team", checked: done.map(s => s.site.name), levels: done.map(s => s.summary.level), deferred: skipped.length, email, chat });
  }
  return out;
}
export default async () => { const r = await runOnce(); console.log("weekly check:", JSON.stringify(r)); return new Response("ok"); };
export const config = { schedule: "@hourly" };
