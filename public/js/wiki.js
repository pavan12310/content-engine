// wiki.js - topic facts from Wikipedia and Wikidata (free, open APIs that allow browser requests; every Wikipedia language).
// Topic research: the matching article's summary, its sections (subtopics) and key Wikidata facts with sources.
// Fact check: organisations and products a page mentions, compared with Wikidata (founding year, headquarters).
const W = lang => `https://${/^[a-z]{2,3}(-[a-z]+)?$/.test(lang) ? lang : "en"}.wikipedia.org`;
const WD = "https://www.wikidata.org/w/api.php";
import * as store from "./store.js";
// lookups are cached for 7 days in this browser (not synced; the 300 most recent kept): encyclopedia facts change slowly
const CIDX = "wkcache-index", MEM = new Map(); let REQUESTS = 0;
export const requestCount = () => REQUESTS;
async function getJson(url) {
  const k = `wkcache:${url.length > 300 ? url.slice(0, 200) + url.length + url.slice(-80) : url}`;
  if (MEM.has(k)) return MEM.get(k);
  const c = await store.get(k, null).catch(() => null); if (c && Date.now() - c.at < 7 * 864e5) { MEM.set(k, c.data); return c.data; }
  const data = await fetchJson(url); MEM.set(k, data);
  try { await store.set(k, { at: Date.now(), data }); const idx = ((await store.get(CIDX, [])) || []).filter(x => x !== k); idx.push(k); while (idx.length > 300) await store.del(idx.shift()); await store.set(CIDX, idx); } catch { }
  return data;
}
async function fetchJson(url) {
  REQUESTS++;
  let r; try { r = await fetch(url); } catch { throw new Error("Couldn't reach Wikipedia. Check your connection."); }
  if (r.status === 429) throw new Error("Wikipedia is limiting requests right now. Try again in a minute.");
  if (!r.ok) throw new Error(`Wikipedia answered ${r.status}.`); return r.json();
}
// the best-matching article for a topic
export async function findArticle(q, lang = "en") {
  const p = new URLSearchParams({ action: "query", list: "search", srsearch: q, srlimit: "5", format: "json", origin: "*" });
  const d = await getJson(`${W(lang)}/w/api.php?${p}`);
  return (d.query?.search || []).map(x => x.title);
}
export async function summary(title, lang = "en") {
  const d = await getJson(`${W(lang)}/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`);
  return { title: d.title, description: d.description || "", extract: d.extract || "", qid: d.wikibase_item || "", url: d.content_urls?.desktop?.page || `${W(lang)}/wiki/${encodeURIComponent(title)}` };
}
// the article's section headings = the subtopics a complete treatment covers
const SKIP_SECTIONS = /^(see also|references|external links|further reading|notes|bibliography|sources|siehe auch|weblinks|literatur|einzelnachweise|véase también|referencias|enlaces externos|voir aussi|références|liens externes|vedi anche|note|collegamenti esterni|関連項目|脚注|外部リンク|参考文献|संदर्भ|बाहरी कड़ियाँ)$/i;
export async function sections(title, lang = "en") {
  const p = new URLSearchParams({ action: "parse", page: title, prop: "sections", format: "json", origin: "*", redirects: "1" });
  const d = await getJson(`${W(lang)}/w/api.php?${p}`);
  return (d.parse?.sections || []).filter(s => Number(s.toclevel) <= 2).map(s => ({ title: String(s.line || "").replace(/<[^>]+>/g, ""), level: Number(s.toclevel) })).filter(s => s.title && !SKIP_SECTIONS.test(s.title));
}
// key facts from Wikidata, with item values turned into names
const PROPS = { P571: "Founded", P112: "Founded by", P159: "Headquarters", P17: "Country", P452: "Industry", P169: "Chief executive", P856: "Official website",
  P1128: "Employees", P2139: "Revenue", P178: "Developer", P577: "First released", P348: "Latest version", P31: "Is a", P127: "Owned by", P749: "Parent organisation", P576: "Dissolved" };
function valueOf(snak) {
  const v = snak?.datavalue?.value; if (v == null) return null;
  if (typeof v === "string") return { text: v };
  if (v.id) return { id: v.id };
  if (v.time) return { text: v.time.replace(/^\+/, "").slice(0, v.precision >= 11 ? 10 : v.precision >= 10 ? 7 : 4), year: Number(v.time.replace(/^\+/, "").slice(0, 4)) };
  if (v.amount) return { text: Number(v.amount).toLocaleString("en-US") + (v.unit && /Q4917$/.test(v.unit) ? " US dollars" : ""), number: Number(v.amount) };
  if (v.text) return { text: v.text };
  return null;
}
// facts for many entities at once: one request for their claims (up to 50) and one for the names they point to
export async function factsMany(qids, lang = "en") {
  const ids = [...new Set(qids.filter(q => /^Q\d+$/.test(q || "")))].slice(0, 50); if (!ids.length) return {};
  const p = new URLSearchParams({ action: "wbgetentities", ids: ids.join("|"), props: "claims", format: "json", origin: "*" });
  const ents = (await getJson(`${WD}?${p}`)).entities || {}, rowsBy = {};
  for (const qid of ids) rowsBy[qid] = rowsOf(ents[qid]?.claims || {});
  const refs = [...new Set(Object.values(rowsBy).flat().filter(r => r.id).map(r => r.id))];
  if (refs.length) { const L = {};
    for (let i = 0; i < refs.length; i += 50) { const q = new URLSearchParams({ action: "wbgetentities", ids: refs.slice(i, i + 50).join("|"), props: "labels", languages: `${lang}|en`, format: "json", origin: "*" }); Object.assign(L, (await getJson(`${WD}?${q}`)).entities || {}); }
    for (const rows of Object.values(rowsBy)) for (const r of rows) if (r.id) r.text = L[r.id]?.labels?.[lang]?.value || L[r.id]?.labels?.en?.value || r.id; }
  for (const [qid, rows] of Object.entries(rowsBy)) rowsBy[qid] = rows.map(r => ({ ...r, source: `https://www.wikidata.org/wiki/${qid}#${r.pid}` }));
  return rowsBy;
}
export async function facts(qid, lang = "en") { return (await factsMany([qid], lang))[qid] || []; }
function rowsOf(claims) {
  const rows = [];
  for (const [pid, label] of Object.entries(PROPS)) {
    const list = (claims[pid] || []).filter(c => c.rank !== "deprecated");
    const preferred = list.filter(c => c.rank === "preferred"); const use = (preferred.length ? preferred : list).slice(0, pid === "P31" || pid === "P452" ? 3 : 1);
    for (const c of use) { const v = valueOf(c.mainsnak); if (v) rows.push({ pid, label, ...v }); }
  }
  return rows;
}
export async function topic(q, lang = "en") {
  const titles = await findArticle(q, lang); if (!titles.length) return null;
  const s = await summary(titles[0], lang);
  const [secs, fs] = await Promise.all([sections(s.title, lang).catch(() => []), facts(s.qid, lang).catch(() => [])]);
  return { ...s, sections: secs, facts: fs, alternatives: titles.slice(1) };
}
// ---- fact check: names a page mentions (capitalised phrases), looked up and compared with Wikidata ----
export function candidateNames(md) {
  const text = String(md || "").replace(/^#+.*$/gm, " ").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  const counts = new Map();
  // capitalised words joined only by spaces on the same line (never across full stops or line breaks)
  const COMMON = /^(The|This|That|These|Those|When|What|Why|How|Where|Which|Who|If|For|With|And|But|Or|So|Our|Your|You|We|They|It|Its|In|On|At|To|By|From|As|A|An|Many|Most|Some|All|Any|Each|Every|Many|More|Use|Using|Keep|Make|Start|Step|Steps|Add|Source|Note|Tip|Also|Then|Next|First|Second|Finally|However|Here|There|Yes|No|One|Two|Three|FAQ|Read|See|Learn|Get|Try|Best|Top|New|Free|Common|Why)$/;
  for (const line of text.split(/\n+/)) for (const m of line.matchAll(/\b([A-Z][\p{L}\d&'’-]+(?:[ ]+(?:of[ ]+|de[ ]+|&[ ]+)?[A-Z][\p{L}\d&'’-]+){0,3})/gu)) {
    const words = m[1].split(/[ ]+/).filter(w => !COMMON.test(w)); const n = words.join(" ").replace(/['’-]+$/, "");
    if (n.length < 3 || COMMON.test(n)) continue;
    counts.set(n, (counts.get(n) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n]) => n);
}
export function compareFacts(md, name, fs) {
  const plain = String(md || "").replace(/^#{1,6}\s.*$/gm, " ").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`>|]/g, " ");
  const out = [], sents = plain.split(/(?<=[.!?])\s+|\n{2,}/).map(x => x.replace(/\s+/g, " ").trim()).filter(s => s.includes(name));
  const founded = fs.find(f => f.pid === "P571" && f.year), hq = fs.find(f => f.pid === "P159");
  for (const s of sents) {
    if (founded && /\b(founded|established|launched|started|created|since|incorporated|gegründet|fundad[ao]|fondée?|fondata)\b/i.test(s)) {
      const years = (s.match(/\b(1[89]\d{2}|20\d{2})\b/g) || []).map(Number);
      if (years.length && !years.includes(founded.year)) out.push({ name, sentence: s.trim(), says: years.join(", "), wikidata: `founded ${founded.text}`, source: founded.source });
    }
    if (hq && /\b(headquartered|based in|headquarters|HQ)\b/i.test(s)) {
      const city = hq.text.toLowerCase(); if (!s.toLowerCase().includes(city)) out.push({ name, sentence: s.trim(), says: (s.match(/(?:headquartered|based) in ([A-Z][\w\s,]+?)(?:[.,;]|$)/) || [])[1] || "a different place", wikidata: `headquarters ${hq.text}`, source: hq.source });
    }
  }
  return out;
}
const ORG = /(company|business|enterprise|organi[sz]ation|software|application|website|web service|brand|product|corporation|startup|platform|agency|firm|subsidiary|publisher|retailer|manufacturer)/i;
// names as article titles, many at once: title -> {qid, disambiguation}
async function resolveTitles(titles, lang) {
  const out = {};
  for (let i = 0; i < titles.length; i += 50) {
    const p = new URLSearchParams({ action: "query", titles: titles.slice(i, i + 50).join("|"), prop: "pageprops", ppprop: "wikibase_item|disambiguation", redirects: "1", format: "json", origin: "*" });
    const d = (await getJson(`${W(lang)}/w/api.php?${p}`)).query || {}, map = new Map(titles.slice(i, i + 50).map(t => [t, t]));
    for (const n of [...(d.normalized || []), ...(d.redirects || [])]) for (const [orig, cur] of map) if (cur === n.from) map.set(orig, n.to);
    const byTitle = new Map(Object.values(d.pages || {}).map(pg => [pg.title, pg]));
    for (const [orig, t] of map) { const pg = byTitle.get(t); if (pg && !("missing" in pg)) out[orig] = { title: pg.title, qid: pg.pageprops?.wikibase_item || "", disambiguation: pg.pageprops && "disambiguation" in pg.pageprops }; }
  }
  return out;
}
export async function checkPage(md, lang = "en") {
  const names = candidateNames(md); if (!names.length) return { looked: [], checks: [], requests: 0 };
  const start = REQUESTS, direct = await resolveTitles(names, lang);
  // candidates per name: the exact article if it isn't a disambiguation page, plus search results for unclear names
  const cands = {};
  for (const n of names) { const d = direct[n]; cands[n] = d && d.qid && !d.disambiguation ? [d] : []; }
  const unclear = names.filter(n => !cands[n].length);
  for (const n of unclear) { try { const titles = (await findArticle(n, lang)).filter(t => t.toLowerCase().startsWith(n.toLowerCase().split(" ")[0])).slice(0, 3);
      if (titles.length) { const r = await resolveTitles(titles, lang); cands[n] = titles.map(t => r[t]).filter(x => x && x.qid && !x.disambiguation); } } catch { } }
  const all = await factsMany(Object.values(cands).flat().map(c => c.qid), lang).catch(() => ({}));
  const looked = [], checks = [];
  for (const n of names) {
    // only organisations and products: places, people and concepts have founding dates too, which would give false alarms
    const pick = cands[n].find(c => ORG.test((all[c.qid] || []).filter(f => f.pid === "P31").map(f => f.text).join(" ")));
    if (!pick) continue;
    looked.push({ name: n, title: pick.title, url: `${W(lang)}/wiki/${encodeURIComponent(pick.title.replace(/ /g, "_"))}` });
    checks.push(...compareFacts(md, n, all[pick.qid] || []));
  }
  return { looked, checks, requests: REQUESTS - start };
}
