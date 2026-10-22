// report.js - turns report data into one self-contained HTML document (inline styles, SVG charts, no scripts, no
// external files), so the same page works as a preview, a downloaded file, a PDF (print) and a share link.
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtN = n => Number(n || 0).toLocaleString("en-US");
const fmtD = t => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const safeColor = c => /^#[0-9a-f]{3,8}$/i.test(String(c || "")) ? c : "#0f766e";
const safeLogo = l => /^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(String(l || "")) && l.length < 450000 ? l : "";
export const SECTIONS = { summary: "Summary", health: "Site health", google: "Google search", ai: "AI answers", content: "Content", todos: "Work done and next steps", keywords: "Keywords" };

function line(points, { w = 640, h = 150, color }) {
  if (points.length < 2) return "";
  const max = Math.max(...points.map(p => p.v), 1), dx = w / (points.length - 1);
  const pts = points.map((p, i) => `${(i * dx).toFixed(1)},${(h - 18 - (p.v / max) * (h - 30)).toFixed(1)}`).join(" ");
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Daily clicks chart" style="display:block">
    <polyline points="0,${h - 18} ${pts} ${w},${h - 18}" fill="${color}" fill-opacity=".10" stroke="none"/>
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2"/>
    <text x="0" y="${h - 2}" font-size="11" fill="#6b7280">${esc(points[0].label)}</text><text x="${w}" y="${h - 2}" font-size="11" fill="#6b7280" text-anchor="end">${esc(points[points.length - 1].label)}</text>
    <text x="0" y="11" font-size="11" fill="#6b7280">${fmtN(max)}</text></svg>`;
}
function bars(rows, { color }) {
  const max = Math.max(...rows.map(r => r.v), 1);
  return rows.map(r => `<div class="bar"><span class="bl">${esc(r.label)}</span><span class="bt"><i style="width:${Math.max(2, 100 * r.v / max).toFixed(1)}%;background:${r.hi ? color : "#cbd5e1"}"></i></span><span class="bv">${esc(r.text ?? fmtN(r.v))}</span></div>`).join("");
}
const kpi = (num, label, sub = "") => `<div class="kpi"><div class="n">${num}</div><div class="l">${esc(label)}</div>${sub ? `<div class="s">${sub}</div>` : ""}</div>`;
const delta = (now, then, suffix = "") => then == null || now == null || now === then ? "" : `<span class="${now > then ? "up" : "down"}">${now > then ? "▲" : "▼"} ${Math.abs(now - then)}${suffix}</span>`;

export function renderReport(d, opts = {}) {
  const color = safeColor(opts.color), logo = safeLogo(opts.logo), on = k => opts.sections ? opts.sections[k] !== false : true;
  const title = opts.title || `${d.site.name}: SEO and content report`, client = opts.client || d.site.name;
  const S = [];
  if (on("summary")) S.push(`<section><h2>Summary</h2><p class="lead">${esc(opts.summary || d.auto_summary || "")}</p>
    ${(opts.highlights || []).length ? `<div class="two"><div><h3>Highlights</h3><ul>${opts.highlights.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>${(opts.watch || []).length ? `<div><h3>To watch</h3><ul>${opts.watch.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}</div>` : ""}</section>`);
  if (on("health") && d.health) S.push(`<section><h2>Site health</h2><div class="kpis">${kpi(`${d.health.score}<small>/100</small> ${delta(d.health.score, d.health.start)}`, "Health score", d.health.start != null ? `was ${d.health.start} at the start of the period` : "")}
    ${kpi(fmtN(d.health.pages), "Pages checked", esc(d.health.crawled_at ? `last read ${d.health.crawled_at}` : ""))}${kpi(fmtN((d.health.counts?.error || 0) + (d.health.counts?.high || 0)), "Urgent issues")}${kpi(fmtN(d.health.counts?.medium || 0), "Medium issues")}</div>
    ${d.health.top.length ? `<h3>Most important issues</h3><table><tr><th>Issue</th><th>Pages</th></tr>${d.health.top.map(i => `<tr><td>${esc(i.label)}</td><td>${fmtN(i.count)}</td></tr>`).join("")}</table>` : `<p>No urgent technical issues on the pages checked.</p>`}</section>`);
  if (on("google") && d.google) { const g = d.google;
    const gTo = g.range && g.range.to ? Date.parse(g.range.to) : null, partial = g.in_period && gTo && gTo < d.period.to - 864e5;
    S.push(`<section><h2>Google search</h2><p class="muted">${esc(g.in_period ? `For ${fmtD(d.period.from)} – ${fmtD(partial ? gTo : d.period.to)}${partial ? ` (the latest Search Console data available; import a newer export to cover the whole period)` : ""}` : `Search Console data covers ${g.label || "the latest import"}`)}.</p>
    <div class="kpis">${kpi(fmtN(g.totals.clicks), "Clicks from Google", g.change?.clicks != null ? `<span class="${g.change.clicks >= 0 ? "up" : "down"}">${g.change.clicks >= 0 ? "▲" : "▼"} ${Math.abs(g.change.clicks)}%</span> vs previous period` : "")}
      ${kpi(fmtN(g.totals.impressions), "Times shown in Google")}${g.all_totals?.position ? kpi(String(g.all_totals.position), "Average position", "lower is better") : ""}${kpi(fmtN(g.near_page_one), "Searches close to page one", "quick wins")}</div>
    ${g.daily.length > 6 ? `<h3>Daily clicks</h3>${line(g.daily.map(x => ({ v: x.clicks, label: x.date })), { color })}` : ""}
    ${g.top_queries.length ? `<h3>Top searches</h3><table><tr><th>Search</th><th>Clicks</th><th>Shown</th><th>Position</th></tr>${g.top_queries.map(q => `<tr><td>${esc(q.query)}</td><td>${fmtN(q.clicks)}</td><td>${fmtN(q.impressions)}</td><td>${esc(q.position)}</td></tr>`).join("")}</table>` : ""}
    ${g.updates.length ? `<p class="muted">Google updates in this data: ${g.updates.map(u => esc(u.name)).join(", ")}.</p>` : ""}</section>`); }
  if (on("ai") && d.ai) S.push(`<section><h2>AI answers</h2><p class="muted">How often AI assistants (such as ChatGPT, Claude and Gemini) mention ${esc(client)} when asked questions customers ask. Each check is one sample, so trends matter more than single numbers.</p>
    <div class="kpis">${kpi(`${d.ai.mention_rate}%`, "Answers that mention the brand")}${kpi(`${d.ai.citation_rate}%`, "Answers that link to the site")}${kpi(fmtN(d.ai.checks), "Answers checked", `${fmtN(d.ai.questions)} questions`)}</div>
    ${d.ai.share.length ? `<h3>Share of voice: brands named in answers</h3>${bars(d.ai.share.map(x => ({ label: x.name, v: x.share, text: `${x.share}%`, hi: x.ours })), { color })}` : ""}
    ${d.ai.sources.length ? `<h3>Sites AI assistants cite most</h3><table><tr><th>Site</th><th>Answers</th></tr>${d.ai.sources.map(x => `<tr><td>${esc(x.domain)}</td><td>${fmtN(x.answers)}</td></tr>`).join("")}</table>` : ""}</section>`);
  if (on("content")) S.push(`<section><h2>Content</h2><div class="kpis">${kpi(fmtN(d.content.written.length), "Pages written")}${kpi(fmtN(d.content.approved.length), "Pages approved")}${d.plan ? kpi(fmtN(d.plan.total), "Ideas in the content plan") : ""}</div>
    ${d.content.written.length ? `<table><tr><th>Page</th><th>Status</th></tr>${d.content.written.slice(0, 15).map(c => `<tr><td>${esc(c.title)}</td><td>${c.approved ? "Approved" : c.status === "ready_for_human_review" ? "Ready for review" : "In progress"}</td></tr>`).join("")}</table>` : `<p>No new pages in this period.</p>`}</section>`);
  if (on("todos")) S.push(`<section><h2>Work done and next steps</h2><div class="kpis">${kpi(fmtN(d.todos.done.length), "Improvements completed")}${kpi(fmtN(d.todos.open), "Still open", `${fmtN(d.todos.open_high)} high priority`)}</div>
    ${d.todos.done.length ? `<h3>Completed</h3><ul>${d.todos.done.slice(0, 12).map(t => `<li>${esc(t.title)}</li>`).join("")}</ul>` : ""}
    ${d.todos.next.length ? `<h3>Next steps</h3><ol>${d.todos.next.map(t => `<li><b>${esc(t.title)}</b>${t.owner ? ` <span class="muted">· ${esc(t.owner)}${t.due ? `, due ${esc(t.due)}` : ""}</span>` : ""}${t.detail ? `<br><span class="muted">${esc(String(t.detail).slice(0, 220))}</span>` : ""}</li>`).join("")}</ol>` : ""}</section>`);
  if (on("keywords") && d.keywords && d.keywords.total) S.push(`<section><h2>Keywords</h2><div class="kpis">${kpi(fmtN(d.keywords.total), "Searches tracked")}${kpi(fmtN(d.keywords.covered), "With a page")}${kpi(fmtN(d.keywords.gaps), "Without a page yet")}${kpi(fmtN(d.keywords.added), "Added this period")}</div></section>`);

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)}</title><style>
*{box-sizing:border-box}body{margin:0;background:#f5f6f8;color:#111827;font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.page{max-width:860px;margin:24px auto;background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:36px 40px}
header{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;border-bottom:3px solid ${color};padding-bottom:18px;margin-bottom:8px}
header img{max-height:48px;max-width:200px}h1{font-size:26px;margin:0 0 4px;line-height:1.2}h2{font-size:19px;margin:0 0 10px;color:${color}}h3{font-size:14px;margin:16px 0 6px;text-transform:uppercase;letter-spacing:.04em;color:#374151}
section{padding:20px 0;border-bottom:1px solid #eef0f3;break-inside:avoid}section:last-of-type{border-bottom:0}
.muted{color:#6b7280;font-size:13px}.lead{font-size:16px}.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:8px 0}
.kpi{border:1px solid #e5e7eb;border-radius:10px;padding:12px 14px}.kpi .n{font-size:24px;font-weight:700}.kpi .n small{font-size:14px;color:#6b7280;font-weight:600}.kpi .l{font-size:13px;color:#374151}.kpi .s{font-size:12px;color:#6b7280;margin-top:2px}
.up{color:#047857;font-size:13px;font-weight:600}.down{color:#b91c1c;font-size:13px;font-weight:600}
table{width:100%;border-collapse:collapse;font-size:14px;margin:6px 0}th{text-align:left;font-size:12px;color:#6b7280;font-weight:600;border-bottom:1px solid #e5e7eb;padding:6px 8px}td{padding:7px 8px;border-bottom:1px solid #f1f2f4;vertical-align:top}
.bar{display:grid;grid-template-columns:160px 1fr 54px;gap:10px;align-items:center;font-size:14px;margin:5px 0}.bt{background:#f1f5f9;border-radius:99px;height:10px;overflow:hidden}.bt i{display:block;height:100%;border-radius:99px}.bv{text-align:right;font-variant-numeric:tabular-nums}
.two{display:grid;grid-template-columns:1fr 1fr;gap:20px}ul,ol{padding-left:20px;margin:6px 0}li{margin:4px 0}
footer{color:#9ca3af;font-size:12px;margin-top:18px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
@media(max-width:640px){.page{padding:22px 18px;margin:0;border-radius:0}.two{grid-template-columns:1fr}.bar{grid-template-columns:110px 1fr 44px}}
@media print{body{background:#fff}.page{border:0;margin:0;max-width:none;padding:0}@page{margin:16mm}}
</style></head><body><div class="page">
<header><div><div class="muted">${esc(fmtD(d.period.from))} – ${esc(fmtD(d.period.to))}</div><h1>${esc(title)}</h1><div class="muted">${esc(client)} · ${esc(d.site.url)}${d.site.type ? ` · ${esc(d.site.type)}` : ""}</div></div>
${logo ? `<img src="${logo}" alt="${esc(opts.brand || "Logo")}">` : opts.brand ? `<div style="font-weight:700;color:${color}">${esc(opts.brand)}</div>` : ""}</header>
${S.join("\n")}
<footer><span>${opts.brand ? `Prepared by ${esc(opts.brand)}` : ""}</span><span>Generated ${esc(fmtD(d.generated_at))}</span></footer>
</div></body></html>`;
}
