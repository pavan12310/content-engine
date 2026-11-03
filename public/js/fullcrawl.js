// fullcrawl.js - the whole website, not a sample: every address in your sitemaps (up to 50,000), read 10 at a time through
// /api/crawl-batch, in this browser tab. It saves its place after every batch, so it can be paused, or the tab closed, and it carries on
// where it stopped. Results are compact (what Site health checks) and kept in this browser; they aren't shared with the team.
import * as store from "./store.js";
import { getSettings } from "./llm.js";

const META = id => `fc:${id}`, URLS = id => `fc-urls:${id}`, CHUNK = (id, n) => `fc-pages:${id}:${n}`, SUM = id => `fc-sum:${id}`, SIZE = 1000;
export const status = id => store.get(META(id), null);
export const summaryOf = id => store.get(SUM(id), null);
let RUN = null;
export const running = id => !!(RUN && RUN.id === id && !RUN.stop);
export function pause() { if (RUN) RUN.stop = true; }
async function batch(site, urls) {
  const tok = getSettings().crawlToken;
  let r; try { r = await fetch("/api/crawl-batch", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", ...(tok ? { "x-crawl-token": tok } : {}) }, body: JSON.stringify({ site, urls }) }); }
  catch { throw new Error("Couldn't reach the crawler. Check your connection."); }
  const d = await r.json().catch(() => ({}));
  if (r.status === 404 && !d.error) throw new Error("The whole-site crawler isn't deployed yet. Push the latest code to GitHub.");
  if (!r.ok) throw new Error(d.error || `The crawler failed (${r.status})`); return d.results || [];
}
// the address list: sitemaps first, plus pages already read (some pages are missing from sitemaps)
export async function prepare(id, site, urls) {
  const list = [...new Set(urls.map(u => String(u).replace(/#.*$/, "")).filter(u => /^https?:\/\//.test(u)))];
  const old = await status(id); if (old) for (let n = 0; n * SIZE < (old.stored || 0) + SIZE; n++) { try { await store.del(CHUNK(id, n), { silent: true }); } catch { } }
  await store.set(URLS(id), list);
  const m = { site, total: list.length, done: 0, stored: 0, state: "ready", started: null, updated: Date.now(), errors: 0, ms: 0 };
  const prevSum = await summaryOf(id); if (prevSum) await store.set(`fc-prev:${id}`, { at: prevSum.at, pages: prevSum.pages, counts: Object.fromEntries(Object.entries(prevSum.issues).map(([k, i]) => [k, i.count])) });
  await store.set(META(id), m); await store.set(SUM(id), null); return m;
}
export async function run(id, progress = () => {}) {
  const m = await status(id); if (!m) throw new Error("Prepare the crawl first.");
  if (RUN && !RUN.stop) throw new Error("The crawl is already running.");
  const urls = await store.get(URLS(id), []); RUN = { id, stop: false };
  m.state = "running"; m.started = m.started || Date.now(); const t0 = Date.now(), d0 = m.done; await store.set(META(id), m);
  // results are filed by how many have been stored (1,000 per chunk), so a resumed crawl carries on in the right place
  let buf = (await store.get(CHUNK(id, Math.floor((m.stored || 0) / SIZE)), [])) || [], fails = 0;
  try {
    while (m.done < urls.length && !RUN.stop) {
      // two batches of 10 at once: gentle on your site, and about 4,800 function calls for 48,000 pages
      const slices = [urls.slice(m.done, m.done + 10), urls.slice(m.done + 10, m.done + 20)].filter(x => x.length);
      let res; try { res = (await Promise.all(slices.map(x => batch(m.site, x)))).flat(); fails = 0; }
      catch (e) { if (++fails >= 3) throw e; await new Promise(r => setTimeout(r, 4000 * fails)); continue; }
      const retry = [];
      for (const r of res) {
        m.done++;
        if (r.skipped) { if ((r.retries || 0) < 2) retry.push(r.url); continue; }   // not read in time: read it again later
        buf.push(r); m.stored = (m.stored || 0) + 1; if (r.error || r.status >= 400) m.errors++; m.ms += r.ms || 0;
        if (buf.length >= SIZE) { await store.set(CHUNK(id, Math.floor((m.stored - 1) / SIZE)), buf); buf = []; }
      }
      if (retry.length) { urls.push(...retry); m.total = urls.length; await store.set(URLS(id), urls); }
      if (buf.length) await store.set(CHUNK(id, Math.floor(m.stored / SIZE)), buf);
      m.updated = Date.now(); await store.set(META(id), m);
      const rate = (m.done - d0) / Math.max(1, (Date.now() - t0) / 1000), left = rate > 0 ? Math.round((urls.length - m.done) / rate) : null;
      progress({ done: m.done, total: urls.length, errors: m.errors, eta: left });
    }
    m.state = m.done >= urls.length ? "done" : "paused"; m.updated = Date.now(); await store.set(META(id), m);
    if (m.state === "done") await summarise(id);
    return m;
  } catch (e) { m.state = "paused"; m.error = e.message; await store.set(META(id), m); throw e; }
  finally { RUN = null; }
}
export async function results(id) { const m = await status(id), out = []; if (!m) return out; for (let n = 0; n * SIZE < (m.stored || 0); n++) out.push(...((await store.get(CHUNK(id, n), [])) || [])); return out; }
const section = u => { try { const p = new URL(u).pathname.split("/").filter(Boolean); return p.length ? `/${p[0]}/` : "/ (home)"; } catch { return "?"; } };
const norm = u => { try { const x = new URL(u); return (x.origin.replace("://www.", "://") + x.pathname.replace(/\/+$/, "")).toLowerCase(); } catch { return u; } };
export const ISSUES = [
  ["error", "Broken (error status)", r => r.error || r.status >= 400],
  ["redirect", "Redirects (listed in the sitemap but redirect)", r => !!r.final],
  ["noindex", "Kept out of Google (noindex)", r => r.noindex || r.noindex_header],
  ["no_title", "No title", r => r.status === 200 && r.title === ""],
  ["dup_title", "Same title as another page", (r, ctx) => r.title && ctx.titles.get(r.title.toLowerCase()) > 1],
  ["no_desc", "No meta description", r => r.status === 200 && r.desc !== undefined && !r.desc],
  ["no_h1", "No H1 heading", r => r.status === 200 && r.h1 === 0],
  ["multi_h1", "More than one H1", r => r.h1 > 1],
  ["thin", "Thin content (under 200 words)", r => r.status === 200 && !r.noindex && r.words != null && r.words < 200],
  ["canonical", "Canonical points to another page", r => r.canonical && norm(r.canonical) !== norm(r.final || r.url)],
  ["slow", "Slow to answer (over 3 s)", r => r.ms > 3000],
  ["heavy", "Very large HTML (over 2.5 MB)", r => r.bytes > 2.5 * 1024 * 1024],
  ["alt", "Images without alt text", r => r.imgs_noalt > 0]
];
export async function summarise(id) {
  const rows = await results(id), titles = new Map();
  for (const r of rows) if (r.title) titles.set(r.title.toLowerCase(), (titles.get(r.title.toLowerCase()) || 0) + 1);
  const ctx = { titles }, secs = new Map(), issues = {};
  for (const [k] of ISSUES) issues[k] = { count: 0, examples: [], sections: {} };
  for (const r of rows) { const s = section(r.url), sec = secs.get(s) || { section: s, pages: 0 }; sec.pages++; secs.set(s, sec);
    for (const [k, , test] of ISSUES) if (test(r, ctx)) { const i = issues[k]; i.count++; i.sections[s] = (i.sections[s] || 0) + 1; if (i.examples.length < 200) i.examples.push(r.url); } }
  // for each problem, the sections where most pages have it (a template problem: one fix solves them all)
  for (const [k, i] of Object.entries(issues)) i.where = Object.entries(i.sections).map(([sec, n]) => ({ section: sec, n, of: secs.get(sec)?.pages || n, rate: n / (secs.get(sec)?.pages || n) }))
    .filter(x => x.n >= 3).sort((a, b) => b.rate - a.rate || b.n - a.n).slice(0, 3);
  const prev = await store.get(`fc-prev:${id}`, null);
  const sum = { at: Date.now(), pages: rows.length, prev, ok: rows.filter(r => r.status === 200).length, avg_ms: Math.round(rows.reduce((a, r) => a + (r.ms || 0), 0) / Math.max(1, rows.length)),
    sections: [...secs.values()].sort((a, b) => b.pages - a.pages).slice(0, 40), issues };
  await store.set(SUM(id), sum); return sum;
}
export async function csv(id) {
  const rows = await results(id), titles = new Map(); for (const r of rows) if (r.title) titles.set(r.title.toLowerCase(), (titles.get(r.title.toLowerCase()) || 0) + 1);
  const q = v => /[",\n]/.test(String(v ?? "")) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? "");
  return "url,status,problems,title,words,h1,ms\n" + rows.map(r => [r.url, r.status || r.error, ISSUES.filter(([, , t]) => t(r, { titles })).map(([, l]) => l).join("; "), r.title || "", r.words ?? "", r.h1 ?? "", r.ms ?? ""].map(q).join(",")).join("\n");
}
