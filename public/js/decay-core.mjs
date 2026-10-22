// decay-core.mjs - content decay logic shared by the browser and the weekly Netlify check (no browser APIs).
// With the Search Console connection it reads each page's clicks for the last 6 full months (one request per month);
// with zip imports only it compares the two most recent periods.
const norm = u => { try { const x = new URL(u); x.hash = ""; return x.toString().replace(/\/$/, ""); } catch { return String(u || "").replace(/\/$/, ""); } };
const iso = d => d.toISOString().slice(0, 10);
// the last n complete calendar months (Search Console data is final ~3 days after the day)
export function lastMonths(n = 6, now = new Date()) {
  const out = []; const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)); if (now.getUTCDate() <= 3) end.setUTCMonth(end.getUTCMonth() - 1);
  for (let i = n; i >= 1; i--) { const a = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i, 1)), b = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i + 1, 0));
    out.push({ label: a.toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }), from: iso(a), to: iso(b) }); }
  return out;
}
// find decaying pages in month-by-month (or two-period) data
export function analyse(periods, { updates = [], pages = [], minPeak = 15 } = {}) {
  const series = new Map();
  periods.forEach((p, i) => { for (const r of p.rows) { const u = norm(r.page || r.keys?.[0]); if (!u) continue;
    const s = series.get(u) || periods.map(() => ({ clicks: 0, impressions: 0, position: null }));
    s[i] = { clicks: r.clicks || 0, impressions: r.impressions || 0, position: r.position || null }; series.set(u, s); } });
  const byUrl = new Map(pages.map(p => [norm(p.url), p])), nowYear = new Date().getUTCFullYear(), out = [];
  for (const [url, s] of series) {
    const n = s.length, last = s[n - 1], earlier = s.slice(0, n - 1); if (!earlier.length) continue;
    const peakIdx = earlier.reduce((bi, x, i) => x.clicks > earlier[bi].clicks ? i : bi, 0), peak = earlier[peakIdx];
    if (peak.clicks < minPeak) continue;
    const decline = 1 - last.clicks / peak.clicks;
    const trending = n >= 3 ? s[n - 1].clicks <= s[n - 2].clicks * 1.05 && s[n - 2].clicks < peak.clicks : true;
    // early warning: two falling months in a row (each down 10% or more), already 15% below the peak
    const early = n >= 3 && s[n - 1].clicks <= s[n - 2].clicks * 0.9 && s[n - 2].clicks <= s[n - 3].clicks * 0.9 && decline >= 0.15;
    const level = decline >= 0.3 && trending ? "decay" : early ? "early" : null;
    if (!level) continue;
    // when did it start falling: the first month after the peak that dropped 15% or more
    let start = peakIdx + 1; for (let i = peakIdx + 1; i < n; i++) if (s[i].clicks <= peak.clicks * 0.85) { start = i; break; }
    const causes = [], dPos = peak.position && last.position ? last.position - peak.position : 0;
    const dImp = peak.impressions ? last.impressions / peak.impressions - 1 : 0, ctrP = peak.impressions ? peak.clicks / peak.impressions : 0, ctrL = last.impressions ? last.clicks / last.impressions : 0;
    if (dPos >= 2) causes.push({ kind: "rank", text: `Rankings fell (average position ${peak.position.toFixed(1)} → ${last.position.toFixed(1)}): other pages now rank above it` });
    else if (dImp <= -0.3) causes.push({ kind: "demand", text: `Fewer people search for this (appearances down ${Math.round(-dImp * 100)}%, position steady)` });
    else if (ctrP && ctrL < ctrP * 0.7) causes.push({ kind: "ctr", text: `Searchers click other results more (click rate ${(ctrP * 100).toFixed(1)}% → ${(ctrL * 100).toFixed(1)}%, position steady): check the title, or AI answers shown above it` });
    // a Google update that ran during the month the drop began, or in the last 10 days before it
    const m = periods[start]; if (m && m.from) { const from = new Date(Date.parse(m.from) - 10 * 864e5).toISOString().slice(0, 10);
      const hit = updates.find(u => u.start <= m.to && (u.end || u.start) >= from); if (hit) causes.push({ kind: "update", text: `The drop started around the ${hit.name}` }); }
    const pg = byUrl.get(url);
    if (pg) { const yrs = (String(pg.title || "").match(/\b20\d{2}\b/g) || []).map(Number); const old = pg.date && Date.parse(pg.date) && Date.now() - Date.parse(pg.date) > 548 * 864e5;
      if (yrs.length && Math.max(...yrs) < nowYear) causes.push({ kind: "dated", text: `Looks out of date: the title mentions ${Math.max(...yrs)}` });
      else if (old) causes.push({ kind: "dated", text: `Looks out of date: last dated ${String(pg.date).slice(0, 10)}` }); }
    out.push({ level, url, title: pg?.title || "", series: s.map(x => x.clicks), positions: s.map(x => x.position), peak: peak.clicks, peak_label: periods[peakIdx].label, last: last.clicks,
      lost: peak.clicks - last.clicks, decline: Math.round(decline * 100), start_label: periods[start]?.label || "", start_from: periods[start]?.from || "", peak_period: periods[peakIdx], last_period: periods[n - 1], causes });
  }
  return out.sort((a, b) => b.lost - a.lost);
}
// searches the page lost: the peak month against the latest month, for one page
export function lostQueries(before, after) {
  const a = new Map(after.map(r => [r.keys?.[0] || r.query, r]));
  return before.map(r => { const q = r.keys?.[0] || r.query, x = a.get(q); return { query: q, before: Math.round(r.clicks || 0), after: Math.round(x?.clicks || 0), pos_before: r.position ? Math.round(r.position * 10) / 10 : null, pos_after: x?.position ? Math.round(x.position * 10) / 10 : null }; })
    .filter(x => x.before - x.after >= 2).sort((p, q) => (q.before - q.after) - (p.before - p.after)).slice(0, 10);
}

// month data stored compactly: the top 2,000 pages as [page, clicks, impressions, position]
export const compactRows = rows => [...rows].sort((a, b) => (b.clicks || 0) - (a.clicks || 0)).slice(0, 2000).map(r => [r.page, r.clicks || 0, r.impressions || 0, r.position ? Math.round(r.position * 10) / 10 : null]);
export const expandRows = rows => (rows || []).map(([page, clicks, impressions, position]) => ({ page, clicks, impressions, position }));
// completed months never change, so only months missing from the cache need fetching
export const missingMonths = (cache, months) => months.filter(m => !(cache && cache[m.from]));
// pages declining now that weren't in the previous result (for the weekly summary)
export const newlyDeclining = (prev, now) => { const had = new Set((prev || []).map(p => p.url)); return now.filter(p => !had.has(p.url)); };
