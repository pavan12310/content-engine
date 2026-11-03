// research.js - read sources before writing, like an AI that browses: collect sources (your addresses, web search if a free key is set,
// Wikipedia), read each page's main text, split it into short passages, and give each section only its most relevant passages,
// numbered, so even a small built-in model can write from many sources and cite them as [1], [2]...
import { tokens } from "./text.js";
import { webSearch, searchConfigured } from "./websearch.js";

const norm = t => String(t || "").replace(/\s+/g, " ").trim();
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
// passages of about 60-140 words, kept to whole sentences
export function passages(text, max = 80) {
  const out = []; let cur = "";
  for (const para of String(text || "").split(/\n{2,}|\r?\n(?=[A-Z0-9•\-])/)) {
    for (const s of norm(para).split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/)) {
      if ((cur + " " + s).split(" ").length > 140 && cur.split(" ").length >= 60) { out.push(cur.trim()); cur = ""; }
      cur += " " + s;
    }
    if (cur.split(" ").length >= 60) { out.push(cur.trim()); cur = ""; }
    if (out.length >= max) break;
  }
  if (cur.split(" ").length >= 25 && out.length < max) out.push(cur.trim());
  // drop menus, cookie notices and other boilerplate
  return out.filter(p => !/cookie|subscribe to our newsletter|all rights reserved|privacy policy|sign up for free|log in/i.test(p) || p.split(" ").length > 90);
}
// search words without how-to filler ("how to record your screen on mac" -> "record screen mac")
const FILLER = new Set("how to what why when where which who is are do does can i you your my our the a an for of in on with without best top free easy guide tutorial ways way tips step steps vs versus and or".split(" "));
export const coreWords = q => tokens(q).filter(w => !FILLER.has(w) && w.length > 1);
async function wikipedia(keyword, lang) {
  const base = `https://${lang}.wikipedia.org/w/api.php`, core = coreWords(keyword); if (!core.length) return [];
  const s = await (await fetch(`${base}?action=query&list=search&srsearch=${encodeURIComponent(core.join(" "))}&srlimit=4&format=json&origin=*`)).json();
  const out = [];
  for (const h of (s.query?.search || []).slice(0, 4)) {
    if (out.length >= 2) break;
    const d = await (await fetch(`${base}?action=query&prop=extracts&explaintext=1&exsectionformat=plain&titles=${encodeURIComponent(h.title)}&format=json&origin=*`)).json();
    const pg = Object.values(d.query?.pages || {})[0];
    // only articles really about the topic: most of the search's main words appear in the title and opening
    const head = new Set(tokens(`${h.title} ${String(pg?.extract || "").slice(0, 1500)}`)), hit = core.filter(w => head.has(w)).length;
    if (pg?.extract && hit / core.length >= 0.6) out.push({ url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(h.title.replace(/ /g, "_"))}`, title: `${h.title} (Wikipedia)`, text: pg.extract.slice(0, 40000), via: "Wikipedia" });
  }
  return out;
}
// collect and read the sources; returns { sources:[{n,url,title,via,words}], passages:[{n,text}] , notes:[] }
export async function gather({ keyword, siteUrl = "", urls = [], ownUrls = [], lang = "en", max = 6, progress = () => {}, readPage }) {
  const own = hostOf(siteUrl), cands = [], seen = new Set(), notes = [];
  const add = c => { const k = c.url.replace(/[#?].*$/, "").replace(/\/$/, ""); if (!seen.has(k)) { seen.add(k); cands.push(c); } };
  for (const u of urls) if (/^https?:\/\//i.test(u)) add({ url: u.trim(), via: "your list" });
  for (const u of ownUrls.slice(0, 2)) add({ url: u, via: "your website" });   // your own most relevant pages: product details from you, not third parties
  if (searchConfigured()) {
    progress("Searching the web for sources…");
    try { const r = await webSearch(keyword, { n: 10 }), hosts = new Set(); for (const x of r.results || []) { const h = hostOf(x.url); if (h === own || hosts.has(h)) continue; hosts.add(h); add({ url: x.url, title: x.title, via: "web search" }); } }
    catch (e) { notes.push(`Web search failed: ${e.message}`); }
  } else notes.push("Web search isn't set up (add a free Tavily or Brave key in Settings → AI), so sources are Wikipedia and any addresses you listed.");
  const read = [];
  for (const c of cands) {
    if (read.length >= max) break;
    progress(`Reading sources (${read.length + 1} of ${Math.min(max, cands.length)}): ${hostOf(c.url)}…`);
    try { const r = await readPage(c.url); if (r && r.text && r.text.split(/\s+/).length >= 120) read.push({ ...c, title: r.title || c.title || c.url, text: r.text }); else notes.push(`Couldn't read enough text from ${c.url}.`); }
    catch (e) { notes.push(`Couldn't read ${c.url}${e && e.message ? ` (${e.message})` : ""}.`); }
  }
  if (read.length < max) { progress("Reading Wikipedia…"); try { for (const w of await wikipedia(keyword, lang)) if (read.length < max) read.push(w); } catch { notes.push("Couldn't reach Wikipedia."); } }
  const sources = read.map((r, i) => ({ n: i + 1, url: r.url, title: norm(r.title).slice(0, 140), via: r.via, words: r.text.split(/\s+/).length }));
  const ps = read.flatMap((r, i) => passages(r.text).map(t => ({ n: i + 1, text: t })));
  const log = [...(searchConfigured() ? [`Searched the web for “${keyword}”`] : []), ...sources.map(x => `Read ${x.title} (${x.via})`), ...notes.filter(n => /^Couldn't/.test(n))];
  return { sources, passages: ps, notes, log };
}
// the best passages for a query (BM25), at most 2 per source so several sources get a say, within a word budget
export function select(research, query, budgetWords = 450) {
  if (!research || !research.passages?.length) return { text: "", used: [] };
  const P = research.passages.map(p => ({ ...p, t: tokens(p.text) })), N = P.length, avg = P.reduce((a, p) => a + p.t.length, 0) / N;
  const df = new Map(); for (const p of P) for (const w of new Set(p.t)) df.set(w, (df.get(w) || 0) + 1);
  const q = [...new Set(tokens(query))];
  const score = p => { const tf = new Map(); for (const w of p.t) tf.set(w, (tf.get(w) || 0) + 1);
    return q.reduce((s, w) => { const f = tf.get(w) || 0; if (!f) return s; const idf = Math.log(1 + (N - (df.get(w) || 0) + 0.5) / ((df.get(w) || 0) + 0.5)); return s + idf * f * 2.2 / (f + 1.2 * (0.25 + 0.75 * p.t.length / avg)); }, 0); };
  const ranked = P.map(p => ({ p, s: score(p) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s), per = new Map(), pick = []; let words = 0;
  for (const { p } of ranked) { if ((per.get(p.n) || 0) >= 2) continue; const w = p.text.split(" ").length; if (words + w > budgetWords) continue; pick.push(p); per.set(p.n, (per.get(p.n) || 0) + 1); words += w; if (words >= budgetWords * 0.9) break; }
  pick.sort((a, b) => a.n - b.n);
  return { text: pick.map(p => `[${p.n}] ${p.text}`).join("\n\n"), used: [...new Set(pick.map(p => p.n))] };
}
// [n] markers become links, and a Sources list is added for the sources actually cited
// does the sentence share enough of its key words with what source n said?
function backed(sentence, n, research) {
  const w = [...new Set(tokens(sentence))].filter(x => x.length > 3); if (w.length < 3) return true;
  return (research.passages || []).filter(p => p.n === n).some(p => { const t = new Set(tokens(p.text)); return w.filter(x => t.has(x)).length / w.length >= 0.3; });
}
export function cite(md, research) {
  const by = new Map((research?.sources || []).map(s => [s.n, s])), used = new Set(); let removed = 0;
  // citations on sentences the source doesn't support are removed (small models sometimes attach them at random)
  let out = String(md || "").replace(/[^.!?\n]*?\[(\d{1,2})\](?!\()/g, (seg, n) => { const s = by.get(+n), text = seg.replace(/\s*\[\d{1,2}\]$/, "");
    if (!s || !backed(text, +n, research)) { if (s) removed++; return text; } used.add(+n); return `${text} [[${n}]](${s.url})`; });
  out = out.replace(/ +([.,;:])/g, "$1");
  if (used.size) out += `\n\n## ${/^## Sources\s*$/m.test(out) ? "Sources cited" : "Sources"}\n\n${[...used].sort((a, b) => a - b).map(n => `${n}. [${by.get(n).title}](${by.get(n).url})`).join("\n")}`;
  return { md: out, used: [...used].sort((a, b) => a - b), removed };
}

// ---- key facts: sentences with numbers, dates, prices or percentages, most relevant to the topic first ----
export function keyFacts(research, query, max = 6) {
  if (!research?.passages?.length) return "";
  const q = new Set(coreWords(query)), seen = new Set(), out = [];
  const cands = research.passages.flatMap(p => p.text.split(/(?<=[.!?])\s+/).map(t => ({ n: p.n, t: t.trim() })))
    .filter(x => x.t.split(" ").length >= 6 && x.t.split(" ").length <= 40 && /\d/.test(x.t) && /(\d+(\.\d+)?\s?(%|percent|million|billion|k\b|x\b|times|minutes|hours|days|seconds|years|gb|mb|fps)|\b(19|20)\d{2}\b|[$€£₹]\s?\d)/i.test(x.t))
    .map(x => ({ ...x, s: tokens(x.t).filter(w => q.has(w)).length })).sort((a, b) => b.s - a.s);
  for (const x of cands) { const k = x.t.toLowerCase().slice(0, 50); if (seen.has(k)) continue; seen.add(k); out.push(`- ${x.t} [${x.n}]`); if (out.length >= max) break; }
  return out.length ? `KEY FACTS FROM THE SOURCES:\n${out.join("\n")}` : "";
}
// ---- copy check: runs of 10 or more words taken word for word from a source ----
export function copied(md, research, run = 10) {
  if (!research?.passages?.length) return [];
  const words = t => String(t).toLowerCase().replace(/\[\[?\d+\]\]?(\([^)]*\))?/g, " ").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  const grams = new Map();
  for (const p of research.passages) { const w = words(p.text); for (let i = 0; i + run <= w.length; i++) grams.set(w.slice(i, i + run).join(" "), p.n); }
  const out = [], lines = String(md).split("\n"); let heading = "";
  for (const line of lines) {
    if (/^##\s/.test(line)) { heading = line.replace(/^##\s+/, ""); continue; }
    const w = words(line); for (let i = 0; i + run <= w.length; i++) { const g = w.slice(i, i + run).join(" "); if (grams.has(g)) { out.push({ heading, n: grams.get(g), text: w.slice(i, Math.min(w.length, i + run + 6)).join(" ") }); break; } }
  }
  return out;
}

// leave out sources the person unticked, and renumber the rest 1, 2, 3...
export function without(research, urls = []) {
  const drop = new Set(urls.map(u => String(u).replace(/\/$/, ""))), keep = research.sources.filter(x => !drop.has(x.url.replace(/\/$/, "")));
  const map = new Map(keep.map((x, i) => [x.n, i + 1]));
  return { ...research, sources: keep.map(x => ({ ...x, n: map.get(x.n) })), passages: research.passages.filter(p => map.has(p.n)).map(p => ({ ...p, n: map.get(p.n) })) };
}

// deep research: one more search per section of the plan, reading one new source (from a website not used yet) for each
export async function deepen(research, { keyword, headings = [], siteUrl = "", readPage, progress = () => {}, maxNew = 4 }) {
  if (!searchConfigured() || !headings.length) return research;
  const r = { ...research, sources: [...research.sources], passages: [...research.passages], log: [...(research.log || [])] };
  const own = hostOf(siteUrl), have = new Set(r.sources.map(x => x.url.replace(/\/$/, ""))), hosts = new Set(r.sources.map(x => hostOf(x.url)));
  let added = 0;
  for (const h of headings.slice(0, 6)) {
    if (added >= maxNew) break;
    const q = `${coreWords(keyword).join(" ")} ${h}`.slice(0, 120);
    progress(`Researching “${h}”…`); r.log.push(`Searched the web for “${q}”`);
    let res; try { res = await webSearch(q, { n: 6 }); } catch (e) { r.log.push(`Search failed: ${e.message}`); continue; }
    for (const x of res.results || []) {
      const u = x.url.replace(/\/$/, ""), host = hostOf(x.url); if (have.has(u) || hosts.has(host) || host === own) continue;
      try { const pg = await readPage(x.url); if (!pg || !pg.text || pg.text.split(/\s+/).length < 150) { r.log.push(`Skipped ${host}: not enough text`); continue; }
        const n = r.sources.length + 1; r.sources.push({ n, url: x.url, title: norm(pg.title || x.title).slice(0, 140), via: `research: ${h}`.slice(0, 80), words: pg.text.split(/\s+/).length });
        r.passages.push(...passages(pg.text).map(t => ({ n, text: t }))); have.add(u); hosts.add(host); added++; r.log.push(`Read ${r.sources[n - 1].title}`); break; }
      catch (e) { r.log.push(`Skipped ${host}: ${e.message || "couldn't read it"}`); }
    }
  }
  return r;
}
