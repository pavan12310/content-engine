// gsc.js - Google Search Console CSV/zip import and analysis (benchmarks = the site's own CTR by position)
const ALIASES = { query: ["query", "queries", "top queries", "search query", "search term"], page: ["page", "pages", "top pages", "url", "landing page", "address"],
  clicks: ["clicks", "url clicks"], date: ["date", "day"], device: ["device", "devices"], country: ["country", "countries"], impressions: ["impressions"], ctr: ["ctr", "url ctr", "click-through rate"], position: ["position", "average position", "avg. position", "avg position"] };
export function parseCsvText(text) {
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}
function normDate(v) {   // "2026-09-30", "30/09/2026", "Sep 30, 2026" -> "2026-09-30"
  v = String(v || "").trim(); if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const d = new Date(v); return isNaN(d) ? v : new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10);
}
const num = v => { const n = parseFloat(String(v || "").replace(/[,%]/g, "").trim()); return isNaN(n) ? 0 : n; };
export function parseCsv(text) {
  const rows = parseCsvText(text.replace(/^\ufeff/, "")); if (!rows.length) return [];
  const m = {}; rows[0].forEach((h, i) => { const hl = h.trim().toLowerCase(); for (const [k, al] of Object.entries(ALIASES)) if (al.includes(hl) && !(k in m)) m[k] = i; });
  if (!("clicks" in m) || !("impressions" in m)) return [];
  const kind = "query" in m && "page" in m ? "query_page" : "query" in m ? "query" : "page" in m ? "page" : "date" in m ? "date" : "device" in m ? "device" : "country" in m ? "country" : null;
  if (!kind) return [];
  return rows.slice(1).filter(r => r.length > Math.max(...Object.values(m))).map(r => {
    const imp = num(r[m.impressions]), clicks = num(r[m.clicks]), raw = "ctr" in m ? r[m.ctr] : "";
    let ctr = raw ? num(raw) : (imp ? 100 * clicks / imp : 0); if (raw && !raw.includes("%") && ctr <= 1) ctr *= 100;
    const dim = kind === "date" ? normDate(r[m.date]) : kind === "device" ? r[m.device].trim() : kind === "country" ? r[m.country].trim() : "";
    return { kind, query: "query" in m ? r[m.query].trim() : "", page: "page" in m ? r[m.page].trim() : "", dim, clicks, impressions: imp,
      ctr: Math.round(ctr * 100) / 100, position: "position" in m ? num(r[m.position]) : 0 };
  });
}
export async function parseFile(file) {
  const buf = new Uint8Array(await file.arrayBuffer()), files = [], rows = [];
  if (/\.zip$/i.test(file.name) || (buf[0] === 0x50 && buf[1] === 0x4b)) {
    const zip = await window.JSZip.loadAsync(buf);
    for (const name of Object.keys(zip.files)) if (/\.csv$/i.test(name)) {
      const r = parseCsv(await zip.files[name].async("string")); if (r.length) { files.push(name); rows.push(...r); }
    }
  } else { const r = parseCsv(new TextDecoder().decode(buf)); if (r.length) { files.push(file.name); rows.push(...r); } }
  return { files, rows };
}
const bucket = p => p < 1.5 ? 1 : p < 2.5 ? 2 : p < 3.5 ? 3 : p < 5.5 ? 4 : p < 10.5 ? 5 : 6;
const BL = { 1: "position 1", 2: "position 2", 3: "position 3", 4: "positions 4-5", 5: "positions 6-10", 6: "below 10" };
const median = a => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const q3 = a => { if (a.length < 8) return 0; const s = [...a].sort((x, y) => x - y), pos = (s.length + 1) * 0.75 - 1, lo = Math.floor(pos); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (pos - lo); };
export function analyse(rows, prevRows = null) {
  const dims = k => rows.filter(r => r.kind === k);
  let q = rows.filter(r => r.kind === "query"); if (!q.length) q = rows.filter(r => r.kind === "query_page");
  let pg = rows.filter(r => r.kind === "page"); const qp = rows.filter(r => r.kind === "query_page");
  if (!pg.length && qp.length) {
    const agg = new Map();
    for (const r of qp) { const a = agg.get(r.page) || { clicks: 0, impressions: 0, pw: 0 }; a.clicks += r.clicks; a.impressions += r.impressions; a.pw += r.position * r.impressions; agg.set(r.page, a); }
    pg = [...agg].map(([page, v]) => ({ kind: "page", page, clicks: v.clicks, impressions: v.impressions, ctr: v.impressions ? Math.round(10000 * v.clicks / v.impressions) / 100 : 0, position: v.impressions ? Math.round(10 * v.pw / v.impressions) / 10 : 0 }));
  }
  const base = pg.length ? pg : q;
  const totals = { queries: new Set(q.map(r => r.query)).size, pages: pg.length, clicks: Math.round(base.reduce((a, r) => a + r.clicks, 0)), impressions: Math.round(base.reduce((a, r) => a + r.impressions, 0)) };
  const bk = {}; for (const r of [...q, ...pg]) if (r.impressions >= 50) (bk[bucket(r.position)] = bk[bucket(r.position)] || []).push(r.ctr);
  const bench = {}; for (const [b, v] of Object.entries(bk)) if (v.length >= 3) bench[b] = median(v);
  const top10 = Object.entries(bk).filter(([b]) => +b <= 5).flatMap(([, v]) => v), benchTop = top10.length >= 3 ? median(top10) : null;
  const minImp = Math.max(100, q3(q.map(r => r.impressions))), minImpP = Math.max(100, q3(pg.map(r => r.impressions)));
  const lowCtr = [];
  for (const r of [...q, ...pg]) {
    const b = bucket(r.position), ref = bench[b] || benchTop, floor = r.kind === "page" ? minImpP : minImp;
    if (b <= 5 && ref && r.impressions >= floor && r.ctr < 0.6 * ref)
      lowCtr.push({ ...r, benchmark_ctr: Math.round(ref * 100) / 100, bucket: bench[b] ? BL[b] : "top 10 overall", missed_clicks: Math.floor(ref * r.impressions / 100 - r.clicks) });
  }
  lowCtr.sort((a, b) => b.missed_clicks - a.missed_clicks);
  const striking = q.filter(r => r.position >= 8 && r.position <= 20 && r.impressions >= Math.max(50, minImp / 2)).sort((a, b) => b.impressions - a.impressions);
  const canni = [];
  if (qp.length) {
    const byq = new Map(); for (const r of qp) { if (!byq.has(r.query)) byq.set(r.query, []); byq.get(r.query).push(r); }
    for (const [query, rs] of byq) {
      const tot = rs.reduce((a, r) => a + r.impressions, 0), strong = rs.filter(r => tot && r.impressions / tot >= 0.15);
      if (strong.length >= 2 && tot >= 100) canni.push({ query, impressions: Math.round(tot), pages: strong.sort((a, b) => b.impressions - a.impressions).map(r => ({ page: r.page, impressions: Math.round(r.impressions), clicks: Math.round(r.clicks), position: r.position })) });
    }
    canni.sort((a, b) => b.impressions - a.impressions);
  }
  const declining = [];
  if (prevRows) {
    const prev = new Map(prevRows.filter(r => r.kind === "page").map(r => [r.page, r]));
    for (const r of pg) { const p = prev.get(r.page); if (p && p.clicks >= 20 && r.clicks < 0.8 * p.clicks)
      declining.push({ page: r.page, clicks_before: Math.round(p.clicks), clicks_now: Math.round(r.clicks), change_pct: Math.round(100 * (r.clicks - p.clicks) / p.clicks), position_before: p.position, position_now: r.position }); }
    declining.sort((a, b) => (a.clicks_now - a.clicks_before) - (b.clicks_now - b.clicks_before));
  }
  const noClicks = pg.filter(r => r.impressions >= minImpP && r.clicks === 0).sort((a, b) => b.impressions - a.impressions);
  return { totals, benchmarks: Object.fromEntries(Object.keys(bench).sort().map(b => [BL[b], Math.round(bench[b] * 100) / 100])),
    low_ctr: lowCtr.slice(0, 50), striking_distance: striking.slice(0, 50), cannibalisation: canni.slice(0, 50), declining_pages: declining.slice(0, 50),
    pages_with_impressions_no_clicks: noClicks.slice(0, 30), top_queries: [...q].sort((a, b) => b.clicks - a.clicks).slice(0, 50),
    has_query_page: qp.length > 0, compared: !!prevRows };
}

// ---------- extra views: daily trend, devices, countries, brand split, period comparison, update impact ----------
const sum = (a, f) => a.reduce((t, r) => t + (r[f] || 0), 0);
const BASES = ["date", "page", "query", "query_page"];   // daily totals are the most complete; query lists omit rare (anonymised) searches
export function totalsOf(rows, basis = null) {
  const pg = rows.filter(r => r.kind === "page"), q = rows.filter(r => r.kind === "query"), qp = rows.filter(r => r.kind === "query_page"), d = rows.filter(r => r.kind === "date");
  const by = { date: d, page: pg, query: q, query_page: qp };
  const base = basis ? by[basis] : (d.length ? d : pg.length ? pg : q.length ? q : qp);
  const clicks = sum(base, "clicks"), imp = sum(base, "impressions");
  const posBase = d.length ? d : q.length ? q : qp;   // average position weighted by impressions
  const pw = posBase.reduce((t, r) => t + r.position * r.impressions, 0), pi = sum(posBase, "impressions");
  return { clicks: Math.round(clicks), impressions: Math.round(imp), ctr: imp ? Math.round(10000 * clicks / imp) / 100 : 0, position: pi ? Math.round(10 * pw / pi) / 10 : null };
}
export function dateRange(rows) {
  const d = rows.filter(r => r.kind === "date").map(r => r.dim).filter(x => /^\d{4}-/.test(x)).sort();
  return d.length ? { from: d[0], to: d[d.length - 1], days: d.length } : null;
}
export function isBranded(query, terms) {
  const q = query.toLowerCase(), qs = q.replace(/\s+/g, "");
  return terms.some(t => t && (q.includes(t) || qs.includes(t.replace(/\s+/g, ""))));
}
export function extras(rows, prevRows, { brandTerms = [], updates = [] } = {}) {
  const daily = rows.filter(r => r.kind === "date" && /^\d{4}-/.test(r.dim)).sort((a, b) => a.dim.localeCompare(b.dim))
    .map(r => ({ date: r.dim, clicks: Math.round(r.clicks), impressions: Math.round(r.impressions), position: r.position }));
  const devices = rows.filter(r => r.kind === "device").map(r => ({ label: r.dim, clicks: Math.round(r.clicks), impressions: Math.round(r.impressions), ctr: r.ctr, position: r.position })).sort((a, b) => b.clicks - a.clicks);
  const countries = rows.filter(r => r.kind === "country").map(r => ({ label: r.dim, clicks: Math.round(r.clicks), impressions: Math.round(r.impressions), position: r.position })).sort((a, b) => b.clicks - a.clicks);
  let q = rows.filter(r => r.kind === "query"); if (!q.length) q = rows.filter(r => r.kind === "query_page");
  const terms = brandTerms.map(t => t.toLowerCase().trim()).filter(Boolean);
  let brand = null;
  if (terms.length && q.length) {
    const b = q.filter(r => isBranded(r.query, terms)), nb = q.filter(r => !isBranded(r.query, terms));
    brand = { terms, branded: { clicks: Math.round(sum(b, "clicks")), impressions: Math.round(sum(b, "impressions")), queries: b.length },
      non_branded: { clicks: Math.round(sum(nb, "clicks")), impressions: Math.round(sum(nb, "impressions")), queries: nb.length } };
  }
  const now = totalsOf(rows);
  // compare like with like: use a data type both periods have
  const common = prevRows ? BASES.find(b => rows.some(r => r.kind === b) && prevRows.some(r => r.kind === b)) : null;
  const before = common ? totalsOf(prevRows, common) : null, nowSame = common ? totalsOf(rows, common) : null;
  const pct = (a, b) => (b ? Math.round(100 * (a - b) / b) : null);
  const change = before ? { basis: common, clicks: pct(nowSame.clicks, before.clicks), impressions: pct(nowSame.impressions, before.impressions),
    ctr: before.ctr ? Math.round((nowSame.ctr - before.ctr) * 100) / 100 : null,
    position: before.position != null && nowSame.position != null ? Math.round((nowSame.position - before.position) * 10) / 10 : null } : null;
  let rising = [], falling = [];
  if (prevRows) {
    const pq = new Map(); for (const r of prevRows) if (r.kind === "query" || r.kind === "query_page") pq.set(r.query, (pq.get(r.query) || 0) + r.clicks);
    const cq = new Map(); for (const r of q) cq.set(r.query, (cq.get(r.query) || 0) + r.clicks);
    const diffs = [...new Set([...pq.keys(), ...cq.keys()])].map(k => ({ query: k, before: Math.round(pq.get(k) || 0), now: Math.round(cq.get(k) || 0) })).map(x => ({ ...x, diff: x.now - x.before }));
    rising = diffs.filter(x => x.diff >= 10).sort((a, b) => b.diff - a.diff).slice(0, 20);
    falling = diffs.filter(x => x.diff <= -10).sort((a, b) => a.diff - b.diff).slice(0, 20);
  }
  // update impact: average daily clicks in the 14 days before an update vs the 14 days after it finished
  const impact = [];
  if (daily.length >= 14) for (const u of updates) {
    const inRange = daily.some(d => d.date >= u.start && d.date <= u.end) || (daily[0].date <= u.end && daily[daily.length - 1].date >= u.start);
    if (!inRange) continue;
    const pre = daily.filter(d => d.date < u.start).slice(-14), post = daily.filter(d => d.date > u.end).slice(0, 14);
    const avg = a => a.length ? a.reduce((t, d) => t + d.clicks, 0) / a.length : null;
    const a = avg(pre), b = avg(post);
    impact.push({ ...u, before: a == null ? null : Math.round(a), after: b == null ? null : Math.round(b),
      change: a && b != null && pre.length >= 7 && post.length >= 7 ? Math.round(100 * (b - a) / a) : null, days_before: pre.length, days_after: post.length });
  }
  return { daily, devices, countries, brand, totals: now, totals_before: before, change, rising, falling, impact, range: dateRange(rows) };
}
