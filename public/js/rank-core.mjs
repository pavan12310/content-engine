// rank-core.mjs - rank tracking logic shared by the browser and the weekly Netlify check (no browser APIs).
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const iso = d => d.toISOString().slice(0, 10);
// Search Console data is final about 3 days after the day
export function window90(now = new Date()) { const to = new Date(now.getTime() - 3 * 864e5), from = new Date(to.getTime() - 89 * 864e5); return { from: iso(from), to: iso(to) }; }
export async function fetchSeries(keywords, queryRange) {
  const kws = [...new Set(keywords.map(k => String(k).toLowerCase().trim()).filter(Boolean))].slice(0, 200);
  if (!kws.length) throw new Error("Add keywords first (Keywords → My keywords).");
  const w = window90(), rows = [];
  // the pattern has a length limit, so very long keyword lists go in a few requests
  const groups = []; let cur = []; for (const k of kws) { if ((cur.join("|").length + k.length) > 3500) { groups.push(cur); cur = []; } cur.push(k); } if (cur.length) groups.push(cur);
  for (const g of groups) rows.push(...await queryRange(["date", "query", "page"], w.from, w.to, `^(${g.map(reEsc).join("|")})$`));
  const series = {};
  for (const r of rows) { const [d, q, page] = r.keys; const s = series[q] = series[q] || {}; const day = s[d] = s[d] || { imp: 0, clicks: 0, wpos: 0, pages: {} };
    day.imp += r.impressions || 0; day.clicks += r.clicks || 0; day.wpos += (r.position || 0) * (r.impressions || 0); day.pages[page] = (day.pages[page] || 0) + (r.impressions || 0); }
  const out = {};
  for (const [q, days] of Object.entries(series)) out[q] = Object.entries(days).sort(([a], [b]) => a.localeCompare(b)).map(([d, x]) => ({ d, pos: x.imp ? Math.round(10 * x.wpos / x.imp) / 10 : null, clicks: x.clicks, imp: x.imp, page: Object.entries(x.pages).sort((a, b) => b[1] - a[1])[0]?.[0] || "" }));
  return { at: Date.now(), ...w, keywords: kws, series: out };
}
// average position over a span of days ending `endOffset` days before the window's end (weighted by appearances)
function avgPos(pts, to, days, endOffset = 0) {
  const end = new Date(Date.parse(to) - endOffset * 864e5), start = new Date(end.getTime() - (days - 1) * 864e5), a = iso(start), b = iso(end);
  let w = 0, s = 0, c = 0, i = 0; for (const p of pts) if (p.d >= a && p.d <= b && p.pos != null) { w += p.imp; s += p.pos * p.imp; c += p.clicks; i += p.imp; }
  return { pos: w ? Math.round(10 * s / w) / 10 : null, clicks: c, imp: i };
}
export function table(snap) {
  if (!snap) return [];
  return snap.keywords.map(k => {
    const pts = snap.series[k] || [], now7 = avgPos(pts, snap.to, 7), prev7 = avgPos(pts, snap.to, 7, 7), now28 = avgPos(pts, snap.to, 28), prev28 = avgPos(pts, snap.to, 28, 28);
    // the ranking page per day over the last 28 days: switching back and forth means pages compete
    const recent = pts.filter(p => p.d >= iso(new Date(Date.parse(snap.to) - 27 * 864e5)) && p.page), pagesSeen = [...new Set(recent.map(p => p.page))];
    let switches = 0; for (let i = 1; i < recent.length; i++) if (recent[i].page !== recent[i - 1].page) switches++;
    const main = Object.entries(recent.reduce((m, p) => (m[p.page] = (m[p.page] || 0) + p.imp, m), {})).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    return { keyword: k, pos: now7.pos, change7: now7.pos != null && prev7.pos != null ? Math.round(10 * (prev7.pos - now7.pos)) / 10 : null, change28: now28.pos != null && prev28.pos != null ? Math.round(10 * (prev28.pos - now28.pos)) / 10 : null,
      clicks28: now28.clicks, imp28: now28.imp, page: main, competing: switches >= 3 && pagesSeen.length >= 2 ? pagesSeen : null, points: pts };
  }).sort((a, b) => (a.pos ?? 999) - (b.pos ?? 999));
}
// biggest gains and drops (positive change = moved up)
export function movers(rows, key = "change7", n = 5) {
  const m = rows.filter(r => r[key] != null && Math.abs(r[key]) >= 1);
  return { up: m.filter(r => r[key] > 0).sort((a, b) => b[key] - a[key]).slice(0, n), down: m.filter(r => r[key] < 0).sort((a, b) => a[key] - b[key]).slice(0, n) };
}

// how many keywords sit in each band (top 3, 4-10, 11-20, 21+), week by week
export function bands(snap) {
  if (!snap) return [];
  const weeks = []; for (let k = 12; k >= 0; k--) { const end = new Date(Date.parse(snap.to) - k * 7 * 864e5); if (end < new Date(Date.parse(snap.from) + 6 * 864e5)) continue;
    const c = { week: iso(end), top3: 0, top10: 0, top20: 0, beyond: 0 };
    for (const kw of snap.keywords) { const a = avgPos(snap.series[kw] || [], snap.to, 7, k * 7); if (a.pos == null) continue; if (a.pos <= 3) c.top3++; else if (a.pos <= 10) c.top10++; else if (a.pos <= 20) c.top20++; else c.beyond++; }
    weeks.push(c); }
  return weeks;
}
// keywords with real traffic that fell 3+ places over 28 days (for the weekly check)
export const drops = rows => rows.filter(r => r.change28 != null && r.change28 <= -3 && (r.clicks28 >= 10 || r.imp28 >= 300)).sort((a, b) => a.change28 - b.change28);
export function toCsv(rows) { const q = v => /[",\n]/.test(String(v ?? "")) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? "");
  return "keyword,position_7_days,change_7_days,change_28_days,clicks_28_days,impressions_28_days,ranking_page,competing_pages\n" + rows.map(r => [r.keyword, r.pos, r.change7, r.change28, r.clicks28, r.imp28, r.page, (r.competing || []).join(" ")].map(q).join(",")).join("\n") + "\n"; }
