// monitor-core.mjs - the weekly "what changed" check. Pure JavaScript with no browser APIs, so the same code runs in the
// browser ("Run the check now") and in the Netlify scheduled function. Page fetching is passed in by the caller.

const BLOCKED = new Set([401, 403, 429, 503]);
const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…", copy: "©", reg: "®", trade: "™" };
const decode = s => String(s || "").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);
const strip = s => decode(String(s || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
// text from the full website reader and from this light check can differ in spacing and character codes: compare the meaning
const same = (a, b) => decode(a).replace(/\s+/g, " ").trim() === decode(b).replace(/\s+/g, " ").trim();
const attr = (tag, name) => { const m = tag.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i")); return m ? (m[2] ?? m[3] ?? m[4] ?? "") : ""; };
const normUrl = u => { try { const x = new URL(u); x.hash = ""; return x.toString().replace(/\/$/, ""); } catch { return String(u || "").replace(/\/$/, ""); } };

// light HTML reading without a DOM: enough to spot important changes
export function parseLite(html, url) {
  const h = String(html || "");
  const title = strip((h.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
  const metas = h.match(/<meta\b[^>]*>/gi) || [], links = h.match(/<link\b[^>]*>/gi) || [];
  const metaNamed = n => { const t = metas.find(m => attr(m, "name").toLowerCase() === n); return t ? attr(t, "content") : ""; };
  const canonTag = links.find(l => attr(l, "rel").toLowerCase().split(/\s+/).includes("canonical"));
  let canonical = canonTag ? attr(canonTag, "href") : ""; try { if (canonical) canonical = new URL(canonical, url).toString(); } catch { }
  const h1 = [...h.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(m => strip(m[1])).filter(Boolean);
  const body = h.replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, " ").replace(/<(nav|header|footer|aside|form)\b[\s\S]*?<\/\1>/gi, " ");
  const text = strip((body.match(/<body\b[\s\S]*<\/body>/i) || [body])[0]);
  return { title, meta_description: strip(metaNamed("description")), h1, canonical, noindex: /noindex/i.test(metaNamed("robots")), word_count: text ? text.split(" ").length : 0 };
}

// compare one page with how it looked at the last full read. severity: high (urgent), medium (check soon), low (for information)
export function comparePage(before, now) {
  const out = [], add = (severity, what, detail = "") => out.push({ url: before.url, severity, what, detail });
  if (now.status === 0) { add("medium", "didn't respond", now.error || ""); return out; }
  if (BLOCKED.has(now.status)) { add("info", "couldn't be checked", `the site refused the check (status ${now.status})`); return out; }
  if (now.status >= 400) { add("high", `now returns an error (${now.status})`, now.status === 404 || now.status === 410 ? "the page is gone; visitors and Google see an error" : "server error"); return out; }
  if (now.final_url && normUrl(now.final_url) !== normUrl(before.url)) add("medium", "now redirects", `to ${now.final_url}`);
  const p = now.parsed || {};
  if (p.noindex && !before.noindex) add("high", "is now hidden from Google (noindex)", "someone added a noindex tag");
  if (!p.noindex && before.noindex) add("low", "is no longer noindex", "it can now appear in Google");
  if (before.canonical && p.canonical && normUrl(p.canonical) !== normUrl(before.canonical)) add("medium", "points Google to a different page (canonical changed)", `${before.canonical} → ${p.canonical}`);
  else if (!before.canonical && p.canonical && normUrl(p.canonical) !== normUrl(before.url)) add("medium", "now points Google to a different page (canonical)", p.canonical);
  if (before.title && !p.title) add("medium", "lost its title tag", `was “${before.title}”`);
  else if (before.title && p.title && !same(p.title, before.title)) add("low", "title changed", `“${before.title}” → “${p.title}”`);
  if (before.meta_description && !p.meta_description) add("low", "lost its meta description", "");
  if ((before.h1 || []).length && !(p.h1 || []).length) add("low", "lost its main heading (H1)", "");
  // word counts from the full website reader are measured differently, so use a stricter threshold until a previous check exists
  const ratio = before._lite ? 0.5 : 0.35;
  if ((before.word_count || 0) >= 200 && p.word_count < before.word_count * ratio) add("medium", "lost most of its text", `${before.word_count} → ${p.word_count} words`);
  return out;
}

// the pages worth watching: the homepage, then the pages Google sends the most clicks to, then the rest of the last read
export function pickPages(pages, gscRows = [], n = 20) {
  const byUrl = new Map(pages.filter(p => p && p.url && !p.error).map(p => [normUrl(p.url), p]));
  const picked = new Map(), take = p => { if (p && picked.size < n && !picked.has(normUrl(p.url))) picked.set(normUrl(p.url), p); };
  const home = [...byUrl.values()].sort((a, b) => a.url.length - b.url.length)[0]; take(home);
  const clicks = new Map(); for (const r of gscRows) if (r.kind === "page" && r.page) clicks.set(normUrl(r.page), (clicks.get(normUrl(r.page)) || 0) + (r.clicks || 0));
  [...clicks.entries()].sort((a, b) => b[1] - a[1]).forEach(([u]) => take(byUrl.get(u)));
  for (const p of byUrl.values()) take(p);
  return [...picked.values()];
}

// check pages with limited concurrency and an overall time budget (Netlify scheduled functions have 30 seconds)
export async function checkPages(list, fetchFn, { concurrency = 6, budgetMs = 20000 } = {}) {
  const started = Date.now(), results = []; let i = 0;
  const worker = async () => { while (i < list.length && Date.now() - started < budgetMs) { const before = list[i++];
    let now; try { now = await fetchFn(before.url); } catch (e) { now = { status: 0, error: e.message }; }
    if (now.status === 200 && now.html) now.parsed = parseLite(now.html, now.final_url || before.url);
    const p = now.parsed, lite = p ? { title: p.title, meta_description: p.meta_description, h1: p.h1.slice(0, 2), canonical: p.canonical, noindex: p.noindex, word_count: p.word_count } : null;
    results.push({ url: before.url, status: now.status, lite, changes: comparePage(before, now) }); } };
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));
  return { checked: results.length, total: list.length, results };
}

// Google: the last 7 days against the 7 before, and the searches that moved most
export function gscWeek(dateRows, queryNow = [], queryBefore = []) {
  const days = [...dateRows].filter(r => r.dim || r.keys).map(r => ({ d: r.dim || r.keys[0], clicks: r.clicks || 0, impressions: r.impressions || 0 })).sort((a, b) => a.d.localeCompare(b.d));
  if (days.length < 14) return null;
  const last = days.slice(-7), prev = days.slice(-14, -7), sum = (a, k) => Math.round(a.reduce((t, x) => t + x[k], 0));
  const cur = { clicks: sum(last, "clicks"), impressions: sum(last, "impressions"), from: last[0].d, to: last[6].d }, before = { clicks: sum(prev, "clicks"), impressions: sum(prev, "impressions") };
  const pct = (a, b) => b ? Math.round(100 * (a - b) / b) : null;
  const qb = new Map(queryBefore.map(r => [r.query || r.keys?.[0], r.clicks || 0])), moves = [];
  for (const r of queryNow) { const q = r.query || r.keys?.[0], c = r.clicks || 0, b = qb.get(q) || 0; if (Math.max(c, b) >= 5) moves.push({ query: q, now: Math.round(c), before: Math.round(b), diff: Math.round(c - b) }); }
  for (const [q, b] of qb) if (!queryNow.some(r => (r.query || r.keys?.[0]) === q) && b >= 5) moves.push({ query: q, now: 0, before: Math.round(b), diff: -Math.round(b) });
  moves.sort((a, b) => a.diff - b.diff);
  return { last7: cur, prev7: before, clicks_change: pct(cur.clicks, before.clicks), impressions_change: pct(cur.impressions, before.impressions),
    drops: moves.filter(m => m.diff < 0).slice(0, 5), gains: moves.filter(m => m.diff > 0).reverse().slice(0, 5) };
}

// one snapshot's overall level and a plain-language list for the screen and the email
export function summarise(s) {
  const items = [];
  const pageIssues = (s.pages?.results || []).flatMap(r => r.changes).filter(c => c.severity !== "info");
  for (const c of pageIssues.filter(c => c.severity === "high")) items.push({ level: "alert", text: `${c.url} ${c.what}`, detail: c.detail });
  if (s.google && s.google.clicks_change != null && s.google.clicks_change <= -20 && s.google.prev7.clicks >= 30) items.push({ level: "alert", text: `Google clicks fell ${Math.abs(s.google.clicks_change)}% (last 7 days vs the 7 before)`, detail: s.google.drops.slice(0, 3).map(d => `“${d.query}” ${d.before}→${d.now}`).join(", ") });
  for (const c of pageIssues.filter(c => c.severity === "medium")) items.push({ level: "watch", text: `${c.url} ${c.what}`, detail: c.detail });
  if (s.google && s.google.clicks_change != null && s.google.clicks_change >= 20 && s.google.last7.clicks >= 30) items.push({ level: "good", text: `Google clicks rose ${s.google.clicks_change}%`, detail: s.google.gains.slice(0, 3).map(d => `“${d.query}” ${d.before}→${d.now}`).join(", ") });
  for (const u of s.updates || []) items.push({ level: "watch", text: `Google ${u.ongoing ? "is rolling out" : "rolled out"} the ${u.name}`, detail: "compare traffic a week after it finishes" });
  if (s.pending_approval) items.push({ level: "watch", text: `${s.pending_approval} page${s.pending_approval > 1 ? "s are" : " is"} waiting for approval`, detail: "" });
  if (s.overdue) items.push({ level: "watch", text: `${s.overdue} to-do${s.overdue > 1 ? "s are" : " is"} overdue`, detail: "" });
  for (const c of pageIssues.filter(c => c.severity === "low").slice(0, 5)) items.push({ level: "info", text: `${c.url} ${c.what}`, detail: c.detail });
  const level = items.some(i => i.level === "alert") ? "alert" : items.some(i => i.level === "watch") ? "watch" : "ok";
  const headline = level === "alert" ? "Something needs attention" : level === "watch" ? "A few things to keep an eye on" : "No important changes";
  return { level, headline, items };
}

// the baseline for each page: the previous check where there is one (measured the same way), otherwise the last full read
export function baselines(pages, lastSnapshot) {
  const prev = new Map(((lastSnapshot && lastSnapshot.pages && lastSnapshot.pages.results) || []).filter(r => r.lite && r.status === 200).map(r => [normUrl(r.url), r.lite]));
  return pages.map(p => { const l = prev.get(normUrl(p.url)); return l ? { ...p, ...l, url: p.url, _lite: true } : p; });
}
