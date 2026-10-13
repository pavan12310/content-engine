// services.js - the workflows. Google's rules are enforced here as guardrails and a release gate.
import * as store from "./store.js";
import * as P from "./prompts.js";
import { ask, getSettings } from "./llm.js";
import { crawl, readPage, readPageMarkdown } from "./crawler.js";
import { pageIntent, findMatches, verdict, siteGroups, buildIndex, coverage, clusterKeywords, classify } from "./text.js";
import { check } from "./validators.js";
import * as techaudit from "./techaudit.js";
import * as gsc from "./gsc.js";
import { FILLER_PHRASES, SEO, GOOGLE_UPDATES, GUARDRAILS, SCORECARD, MUST_PASS, INTENTS, PAGE_TYPES, HIGH_RISK_PAGE_TYPES, RELEASE_GATE, URL_ACTIONS, structureFor } from "./rules.js";

export class GuardrailError extends Error { constructor(m) { super(m); this.guardrail = true; } }
const LEVEL = { none: 0, low: 1, medium: 2, high: 3 };

// ---------------- data access ----------------
export const sites = async () => store.get("sites", []);
export async function site(id) { return (await sites()).find(s => s.id === id) || null; }
export async function updateSite(id, patch) { const all = await sites(); const i = all.findIndex(s => s.id === id); if (i >= 0) { all[i] = { ...all[i], ...patch }; await store.set("sites", all); return all[i]; } }
export const pages = id => store.get(`pages:${id}`, []);
export const keywords = id => store.get(`keywords:${id}`, []);
export const contents = id => store.get(`contents:${id}`, []);
export const recs = id => store.get(`recs:${id}`, []);
export const gscImports = id => store.get(`gsc:${id}`, []);
export const visRows = id => store.get(`vis:${id}`, []);
async function ctx(id) {
  const s = await site(id); if (!s) throw new GuardrailError("Site not found.");
  const p = await pages(id); if (!p.length) throw new GuardrailError("This site has no pages yet. Read the website first.");
  return [s, p];
}

// ---------------- sites + crawling ----------------
export async function addSite({ url, name = "", product = "", audience = "", max_pages = 200 }) {
  url = url.trim(); if (!/^https?:/i.test(url)) url = "https://" + url; url = url.replace(/\/+$/, "");
  const all = await sites(); let s = all.find(x => x.url === url);
  if (!s) { s = { id: store.newId(), url, name, product, audience, status: "new", created_at: Date.now() }; all.unshift(s); }
  else Object.assign(s, { name: name || s.name, product: product || s.product, audience: audience || s.audience });
  await store.set("sites", all);
  runCrawl(s.id, max_pages);
  return s;
}
export async function deleteSite(id) {
  await store.set("sites", (await sites()).filter(s => s.id !== id));
  for (const k of ["pages", "keywords", "contents", "recs", "gsc", "vis", "urlreview"]) await store.del(`${k}:${id}`);
}
export async function runCrawl(id, maxPages = 200) {
  const s = await site(id); await updateSite(id, { status: "crawling", error: "", max_pages: maxPages });
  try {
    const { summary, pages: pg } = await crawl(s.url, maxPages, msg => updateSite(id, { status: "crawling: " + msg }));
    for (const p of pg) p.intent = pageIntent(p);
    await store.set(`pages:${id}`, pg);
    await updateSite(id, { status: "ready", summary, crawled_at: summary.crawled_at });
  } catch (e) { await updateSite(id, { status: "error", error: String(e.message || e).slice(0, 500) }); }
}
export async function siteDetail(id) {
  const s = await site(id); if (!s) throw new GuardrailError("Site not found.");
  const p = await pages(id), counts = {}; for (const x of p) counts[x.intent] = (counts[x.intent] || 0) + 1;
  return { ...s, page_count: p.length, intent_counts: counts };
}

// ---------------- strategy / keyword check / URL map ----------------
export async function strategy(id) { const [s, p] = await ctx(id); return ask("strategy", P.strategy(s, p)); }

// ---------------- content strategy v2 + content plan ----------------
async function strategyEvidence(id, pg) {
  const ev = {}, ix = buildIndex(pg);
  const kws = await keywordTable(id);
  ev.keyword_gaps = kws.filter(k => k.coverage?.status === "gap" && k.action !== "skip").slice(0, 25).map(k => ({ keyword: k.keyword, volume: k.volume ?? k.gsc_impressions ?? null, opportunity: k.opportunity }));
  ev.tracked_keywords = kws.slice(0, 60).map(k => k.keyword);
  const imps = await gscImports(id);
  if (imps.length) {
    const a = gsc.analyse(imps[0].rows, imps[1]?.rows || null);
    ev.google_near_page_one = a.striking_distance.slice(0, 20).map(r => ({ search: r.query, impressions: Math.round(r.impressions), position: r.position }));
    const q = imps[0].rows.filter(r => r.kind === "query" || r.kind === "query_page");
    ev.google_searches_without_a_page = q.sort((x, y) => y.impressions - x.impressions).slice(0, 300)
      .filter(r => coverage(ix, r.query, classify(r.query)).status === "gap").slice(0, 20).map(r => ({ search: r.query, impressions: Math.round(r.impressions), position: r.position }));
  }
  const s = await site(id), vis = visSummary(await visRows(id), s.url, { brand: s.name || "", questions: await aiQuestions(id) });
  ev.ai_questions_not_mentioning_you = vis.questions.filter(q => q.checked && Object.values(q.results).some(r => !r.mentioned && !r.error)).slice(0, 15).map(q => ({ question: q.question, named_instead: [...new Set(Object.values(q.results).flatMap(r => r.brands || []))].slice(0, 5) }));
  const counts = {}; for (const p of pg) counts[p.intent] = (counts[p.intent] || 0) + 1; ev.existing_pages_by_intent = counts;
  return ev;
}
export async function contentStrategy(id, { focus = "" } = {}, progress = () => {}) {
  const [s, p] = await ctx(id);
  progress("Gathering evidence from your keywords, Google data and AI answers…");
  const evidence = await strategyEvidence(id, p);
  progress("Building the strategy… about a minute.");
  const res = await ask("strategy_v2", P.strategyV2(s, p, evidence, focus), { maxTokens: 12000 });
  // check every idea against the site and the keyword list (no AI): never suggest a page that already exists
  const ix = buildIndex(p), kset = new Set((await keywords(id)).map(k => k.keyword)), plan = await planItems(id);
  const planned = new Set(plan.map(x => x.keyword));
  for (const c of res.clusters || []) for (const it of c.ideas || []) {
    it.keyword = String(it.keyword || "").toLowerCase().trim();
    if (!INTENTS[it.intent]) it.intent = classify(it.keyword);
    if (!PAGE_TYPES.includes(it.page_type)) it.page_type = INTENTS[it.intent].formats.find(f => PAGE_TYPES.includes(f)) || "blog_post";
    const cov = coverage(ix, it.keyword, it.intent); it.coverage = cov;
    it.in_keywords = kset.has(it.keyword); it.in_plan = planned.has(it.keyword);
  }
  const run = { ...res, evidence_used: { keyword_gaps: evidence.keyword_gaps.length, google_near_page_one: evidence.google_near_page_one?.length || 0,
    google_searches_without_a_page: evidence.google_searches_without_a_page?.length || 0, ai_gaps: evidence.ai_questions_not_mentioning_you.length },
    existing_by_intent: evidence.existing_pages_by_intent, focus, at: Date.now() };
  const hist = await store.get(`strategy:${id}`, []); hist.unshift(run); await store.set(`strategy:${id}`, hist.slice(0, 10));
  return run;
}
export async function savedStrategy(id) {
  const run = (await store.get(`strategy:${id}`, []))[0] || null; if (!run) return null;
  const plan = new Set((await planItems(id)).map(x => x.keyword)), kset = new Set((await keywords(id)).map(k => k.keyword));
  for (const c of run.clusters || []) for (const it of c.ideas || []) { it.in_plan = plan.has(it.keyword); it.in_keywords = kset.has(it.keyword); }
  return run;
}
export const planItems = id => store.get(`plan:${id}`, []);
const thisMonth = () => new Date().toISOString().slice(0, 7);
export async function addToPlan(id, items) {
  const all = await planItems(id), have = new Set(all.map(x => x.keyword)); let added = 0;
  for (const it of items) { const kw = String(it.keyword || "").toLowerCase().trim(); if (!kw || have.has(kw)) continue;
    all.push({ id: store.newId(), keyword: kw, title: it.title_idea || it.title || kw, intent: it.intent || classify(kw), page_type: it.page_type || "blog_post", cluster: it.cluster || "",
      funnel: it.funnel || "", angle: it.angle || "", information_gain: it.information_gain || "", evidence: it.evidence || [], priority: it.priority || "medium",
      month: it.month || thisMonth(), owner: "", status: "planned", created_at: Date.now() }); have.add(kw); added++;
    await upsertKeyword(id, kw, { intent: it.intent }, "content plan"); }
  await store.set(`plan:${id}`, all); return { added };
}
export async function updatePlanItem(id, pid, fields) {
  const all = await planItems(id), it = all.find(x => x.id === pid); if (!it) throw new GuardrailError("Not found");
  for (const k of ["month", "owner", "status", "title", "page_type", "intent"]) if (fields[k] !== undefined) it[k] = String(fields[k]).slice(0, 200);
  await store.set(`plan:${id}`, all); return it;
}
export async function removePlanItem(id, pid) { await store.set(`plan:${id}`, (await planItems(id)).filter(x => x.id !== pid)); return { ok: true }; }
export async function planView(id) {
  // link plan items to written pages: status follows the page automatically
  const all = await planItems(id), items = await contents(id);
  for (const it of all) {
    const c = items.find(x => x.keyword.toLowerCase().trim() === it.keyword);
    if (c) { it.content_id = c.id; it.content_status = c.status;
      if (["planned", "writing", "review"].includes(it.status)) it.status = c.status === "approved" ? "approved" : c.status === "ready_for_human_review" ? "review" : "writing"; }
  }
  await store.set(`plan:${id}`, all);
  return all.sort((a, b) => (a.month || "").localeCompare(b.month || "") || ({ high: 0, medium: 1, low: 2 }[a.priority] ?? 1) - ({ high: 0, medium: 1, low: 2 }[b.priority] ?? 1));
}
export async function planCsv(id) {
  const all = await planView(id), esc = v => { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  const rows = [["month", "status", "title", "keyword", "intent", "page_type", "cluster", "funnel", "priority", "owner", "angle", "information_gain"]];
  for (const x of all) rows.push([x.month, x.status, x.title, x.keyword, x.intent, x.page_type, x.cluster, x.funnel, x.priority, x.owner, x.angle, x.information_gain]);
  return rows.map(r => r.map(esc).join(",")).join("\n");
}

export async function upsertKeyword(id, keyword, fields = {}, source = "manual") {
  const kw = keyword.toLowerCase().trim(); if (!kw) return;
  const all = await keywords(id); let k = all.find(x => x.keyword === kw);
  if (!k) { k = { keyword: kw, action: "review", business_value: 3, source }; all.unshift(k); }
  for (const [f, v] of Object.entries(fields)) if (v !== undefined && v !== null) k[f] = v;
  k.updated_at = Date.now(); await store.set(`keywords:${id}`, all);
}
export async function deleteKeyword(id, keyword) { await store.set(`keywords:${id}`, (await keywords(id)).filter(k => k.keyword !== keyword.toLowerCase().trim())); }

export async function keywordCheck(id, keyword, { research = true } = {}, progress = () => {}) {
  const [s, p] = await ctx(id);
  keyword = keyword.trim(); if (!keyword) throw new GuardrailError("Enter a keyword.");
  const matches = findMatches(keyword, p), v = verdict(keyword, matches);
  progress("Comparing with your pages and working out the search intent…");
  const ai = await ask("keyword", P.keywordAnalysis(s, p, keyword, matches, v));
  const dom = INTENTS[ai.dominant_intent] ? ai.dominant_intent : v.keyword_intent;
  for (const m of matches) m.same_intent = m.intent === dom;
  const blocking = matches.filter(m => m.same_intent && m.similarity >= GUARDRAILS.block_if_same_intent_page_exists_similarity);
  v.keyword_intent = dom;
  if (blocking.length) { v.status = "exists"; v.message = `You already have a page for this keyword with the same search intent: ${blocking[0].url}. Improve that page instead of writing a new one.`; }
  let action = URL_ACTIONS[ai.decision] ? ai.decision : (blocking.length ? "update" : "create");
  if (blocking.length && action === "create") { action = "update"; ai.decision_reason = `A page already serves this keyword with the same intent (${blocking[0].url}). Improve that page instead of creating a duplicate. ` + (ai.decision_reason || ""); }
  const primary = ai.primary_url || (blocking[0]?.url || "");
  let serp = null;
  if (research) {
    if (!getSettings().webSearch) serp = { searched: false, error: "Web search is turned off in AI & data settings, so current rankings weren't researched." };
    else {
      progress("Researching what currently ranks (web search, about 30 seconds)…");
      try { serp = await ask("serp", P.serpResearch(s, keyword), { webSearch: true, maxSearches: 6 }); }
      catch (e) { serp = { searched: false, error: e.message }; }
      if (serp && serp._no_search) serp = { searched: false, error: "This model can't search the web, so current rankings weren't researched. Choose a model with web search in AI & data." };
    }
  }
  const check = { keyword, matches, verdict: v, analysis: ai, action, primary_url: primary, serp, checked_at: Date.now() };
  await upsertKeyword(id, keyword, { intent: dom, primary_url: primary, action, reason: ai.decision_reason || "", check }, "keyword check");
  return check;
}
let IX_CACHE = { id: null, n: 0, ix: null };
export async function coverageFor(id, keyword) {
  const p = await pages(id); if (!p.length) return { status: "unknown" };
  if (IX_CACHE.id !== id || IX_CACHE.n !== p.length) IX_CACHE = { id, n: p.length, ix: buildIndex(p) };
  return coverage(IX_CACHE.ix, keyword.trim(), classify(keyword));
}
export async function savedCheck(id, keyword) {
  const k = (await keywords(id)).find(x => x.keyword === keyword.toLowerCase().trim());
  return k && k.check ? { ...k.check, update_plan: k.update_plan || null } : null;
}
export async function recentChecks(id, n = 8) {
  return (await keywords(id)).filter(k => k.check).sort((a, b) => b.check.checked_at - a.check.checked_at).slice(0, n)
    .map(k => ({ keyword: k.keyword, action: k.check.action, checked_at: k.check.checked_at }));
}
export async function makeUpdatePlan(id, keyword, url) {
  const s = await site(id); if (!s) throw new GuardrailError("Site not found.");
  const k = (await keywords(id)).find(x => x.keyword === keyword.toLowerCase().trim());
  const page = await readPage(url);
  const plan = await ask("update_plan", P.updatePlan(s, keyword, page, k?.check?.serp, k?.check?.analysis));
  plan.page = { url: page.url, title: page.title, word_count: page.word_count }; plan.created_at = Date.now();
  await upsertKeyword(id, keyword, { update_plan: plan });
  return plan;
}
export async function urlMap(id) { const [, p] = await ctx(id); return { groups: siteGroups(p), keywords: await keywords(id), review: await store.get(`urlreview:${id}`) }; }
export async function reviewUrlMap(id) {
  const [s, p] = await ctx(id); const groups = siteGroups(p);
  const out = groups.length ? await ask("url_review", P.urlMapReview(s, groups)) : { groups: [] };
  await store.set(`urlreview:${id}`, { review: out, updated_at: Date.now() }); return out;
}

// ---------------- generation ----------------
function buildSchema(s, payload, author, pageType) {
  const base = s.url.replace(/\/$/, ""), url = `${base}/${payload.slug || ""}`, today = new Date().toISOString().slice(0, 10);
  const graph = [{ "@type": pageType === "landing_page" ? "WebPage" : "Article", headline: payload.h1 || payload.title_tag, description: payload.meta_description,
    author: { "@type": "Person", name: author || "[ADD AUTHOR]" }, publisher: { "@type": "Organization", name: s.name || base, url: base },
    datePublished: today, dateModified: today, mainEntityOfPage: url },
  { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Home", item: base }, { "@type": "ListItem", position: 2, name: payload.h1 || "", item: url }] }];
  const faqs = (payload.faqs || []).filter(f => f.q);
  if (faqs.length) graph.push({ "@type": "FAQPage", mainEntity: faqs.map(f => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) });
  return { "@context": "https://schema.org", "@graph": graph };
}
function gate(val, ev, claimsSummary = null, dup = false) {
  const n = x => parseInt(x || 0, 10) || 0;
  const sc = { seo_readiness: val.seo_score || 0, content_quality: n(ev.content_quality?.score), search_satisfaction: n(ev.satisfaction?.score),
    task_completion: n(ev.task_completion?.score), evidence: n(ev.evidence?.score), ai_citation_readiness: n(ev.ai_citation_readiness?.score) };
  if (claimsSummary && claimsSummary.total) {
    const cs = Math.round(100 * ((claimsSummary.supported || 0) + 0.5 * (claimsSummary.needs_publisher_data || 0)) / claimsSummary.total);
    sc.evidence = Math.round((sc.evidence + cs) / 2);
  }
  const spam = Math.max(0, ...(ev.spam_risk || []).map(r => LEVEL[String(r.level || "none").toLowerCase()] || 0), dup ? 2 : 0);
  const spamLevel = Object.keys(LEVEL).find(k => LEVEL[k] === spam);
  const card = (ev.content_quality?.scorecard || []).slice(0, SCORECARD.length).map(x => n(x.score));
  const critical = (ev.issues || []).filter(i => i.severity === "critical"), reasons = [];
  if (MUST_PASS.some(i => i < card.length && card[i] === 0)) reasons.push("Fails a must-pass helpful-content question (topic fit, originality, or people-first purpose).");
  if (spam >= LEVEL.high) reasons.push("High spam risk.");
  if (claimsSummary && RELEASE_GATE.block_on_false_claims && (claimsSummary.false || claimsSummary.outdated)) reasons.push(`${claimsSummary.false || 0} false and ${claimsSummary.outdated || 0} outdated claims.`);
  if (critical.length) reasons.push(`${critical.length} critical issues.`);
  const below = Object.fromEntries(Object.entries(sc).filter(([k, v]) => v < (RELEASE_GATE.min_scores[k] || 0)));
  const status = reasons.length ? "do_not_publish" : (Object.keys(below).length || val.fails || spam > LEVEL[RELEASE_GATE.max_spam_risk]) ? "improve_before_publishing" : "ready_for_human_review";
  return { status, scores: sc, below_threshold: below, spam_risk: spamLevel, blocking_reasons: reasons };
}
function fixList(val, ev) {
  const f = [...(val.fix_list || [])];
  for (const i of ev.issues || []) if (["critical", "major"].includes(i.severity) && !/placeholder/i.test((i.issue || "") + (i.fix || ""))) f.push(`[${i.area}] ${i.issue} -> ${i.fix}`);
  for (const m of (ev.satisfaction?.missing || []).slice(0, 5)) f.push(`[satisfaction] Searcher still lacks: ${m}`);
  for (const b of (ev.task_completion?.blockers || []).slice(0, 4)) f.push(`[task] Reader cannot complete the task because: ${b}`);
  for (const q of ev.question_coverage || []) if (q.status === "missing") f.push(`[coverage] Answer this question: ${q.question}`);
  for (const w of (ev.ai_citation_readiness?.weak_passages || []).slice(0, 3)) f.push(`[citation] Make this passage specific and self-contained: ${w}`);
  return f.slice(0, 25);
}
const today = () => new Date().toISOString().slice(0, 10);
export async function generate(id, { keyword, intent, page_type, audience = "", notes = "", author = "", override_duplicate = false, verify_claims = true }, progress = () => {}) {
  const [s, p] = await ctx(id);
  keyword = keyword.trim();
  if (!PAGE_TYPES.includes(page_type)) throw new GuardrailError(`Unknown page type. Use one of: ${PAGE_TYPES.join(", ")}`);
  if (!INTENTS[intent]) throw new GuardrailError(`Unknown intent. Use one of: ${Object.keys(INTENTS).join(", ")}`);
  if (GUARDRAILS.require_author && !author.trim()) throw new GuardrailError("Add a named author with relevant expertise (Google's 'Who' test).");
  const all = await contents(id);
  if (all.filter(c => Date.now() - c.created_at < 86400000).length >= GUARDRAILS.max_generations_per_site_per_day)
    throw new GuardrailError(`Daily limit of ${GUARDRAILS.max_generations_per_site_per_day} pages reached for this site. Google's scaled content abuse policy targets volume without value, so this tool limits output.`);
  const mapped = (await keywords(id)).find(k => k.keyword === keyword.toLowerCase());
  if (mapped && mapped.action === "skip" && !override_duplicate) throw new GuardrailError(`The keyword check recommended SKIP for this keyword: ${mapped.reason || ""}`);
  const matches = findMatches(keyword, p);
  const same = matches.filter(m => m.intent === intent && m.similarity >= GUARDRAILS.block_if_same_intent_page_exists_similarity);
  if (same.length && !override_duplicate) throw new GuardrailError(`BLOCKED: ${same[0].url} already targets "${keyword}" with the same ${intent} intent. Update that page, or choose a different search intent. (Use "Check a keyword" to see open intents.)`);
  const warnings = [];
  if (["comparison", "alternatives", "listicle", "glossary"].includes(page_type)) warnings.push(`High-risk page type: ${HIGH_RISK_PAGE_TYPES[page_type] || ""}`);
  if (!INTENTS[intent].formats.includes(page_type)) warnings.push(`Page type '${page_type}' is unusual for ${intent} intent. Usual formats: ${INTENTS[intent].formats.join(", ")}.`);
  if (same.length && override_duplicate) warnings.push(`Generated despite an existing same-intent page (${same[0].url}). Review for cannibalisation before publishing.`);
  const structure = structureFor(keyword, intent, page_type);
  progress("Understanding the searcher (1/5)…");
  const sat = await ask("satisfaction", P.satisfaction(s, keyword, intent));
  if (sat.best_format && !["guide", "explainer"].includes(sat.best_format) && sat.format_reason) warnings.push(`Best format for this searcher: ${sat.best_format}. ${sat.format_reason}`);
  progress("Planning the page (2/5)…");
  const saved = (await keywords(id)).find(k => k.keyword === keyword.toLowerCase());
  const serp = saved?.check?.serp?.searched ? saved.check.serp : null;
  if (serp) warnings.push("Using your keyword check's research on what currently ranks.");
  const b = await ask("brief", P.brief(s, p, keyword, intent, page_type, audience, notes, matches, sat, structure, serp));
  const valid = p.map(x => x.url);
  progress("Writing the page (3/5)…");
  const style = s.style || null;
  let payload = await ask("article", P.article(s, keyword, intent, page_type, b, author, valid, null, null, style), { maxTokens: 16000 });
  const rounds = []; let val, ev, g;
  for (let r = 1; r <= RELEASE_GATE.max_repair_rounds; r++) {
    progress(`Checking quality, round ${r} (4/5)…`);
    val = check(payload, keyword, page_type, new Set(valid), author);
    ev = await ask("evaluate", P.evaluate(keyword, intent, sat, s, payload.body_markdown || "", matches));
    g = gate(val, ev, null, same.length > 0);
    rounds.push({ round: r, status: g.status, scores: g.scores, spam_risk: g.spam_risk, fails: val.fails });
    if (g.status === "ready_for_human_review" || r === RELEASE_GATE.max_repair_rounds) break;
    const fixes = fixList(val, ev); if (!fixes.length) break;
    progress(`Fixing ${fixes.length} issues, round ${r} (4/5)…`);
    payload = await ask("article", P.article(s, keyword, intent, page_type, b, author, valid, fixes, payload.body_markdown || "", style), { maxTokens: 16000 });
  }
  let claims = null;
  if (verify_claims) {
    progress("Fact-checking claims with web search (5/5)…");
    claims = await ask("claims", P.claims(keyword, payload.body_markdown || ""), { webSearch: true });
    let body = payload.body_markdown || "", applied = 0; const sm = claims.summary = claims.summary || {};
    for (const c of claims.claims || []) if (["false", "outdated", "unsupported"].includes(c.status) && c.claim && c.correction && body.includes(c.claim)) {
      body = body.replace(c.claim, c.correction); applied++;
      sm[c.status] = Math.max(0, (sm[c.status] || 0) - 1); const to = c.correction.includes("[SOURCE") ? "needs_publisher_data" : "supported"; sm[to] = (sm[to] || 0) + 1; c.status = "corrected";
    }
    claims.corrections_applied = applied; payload.body_markdown = body;
    val = check(payload, keyword, page_type, new Set(valid), author);
  }
  g = gate(val, ev, claims?.summary, same.length > 0);
  payload.schema_jsonld = buildSchema(s, payload, author, page_type);
  payload.html = mdToHtml(payload.body_markdown || "");
  const report = { satisfaction_model: sat, structure, brief: b, matches, warnings, validation: val, evaluation: ev, claims, gate: g, rounds, status: g.status,
    note: "Fill every placeholder with real proof and have the named author review before publishing." };
  const item = { id: store.newId(), keyword, intent, page_type, author, title: payload.title_tag || "", slug: payload.slug || "", payload, report, status: g.status, created_at: Date.now(),
    versions: [{ v: 1, at: Date.now(), source: "ai", note: "Written by AI", markdown: payload.body_markdown || "" }] };
  await rememberAuthor(author);
  await store.set(`contents:${id}`, [item, ...all]);
  return { id: item.id, content: payload, report };
}
export async function audit(id, { keyword = "", draft = "", verify_claims = false }) {
  const [s, p] = await ctx(id); const matches = keyword ? findMatches(keyword, p) : [];
  const a = await ask("audit", P.audit(s, p, keyword, draft, matches));
  const det = check({ body_markdown: draft, faqs: [] }, keyword, "blog_post", new Set(p.map(x => x.url)), "x");
  const keep = new Set(["h1", "h2", "length", "repetition", "filler", "paragraphs", "stats_sourced", "internal_links", "no_fake_links"]);
  a.seo_checks = det.checks.filter(c => keep.has(c.id)); a.matches = matches;
  a.total = (a.scores || []).slice(0, 10).reduce((t, x) => t + (parseInt(x.score) || 0), 0);
  if (verify_claims) a.claims = await ask("claims", P.claims(keyword, draft), { webSearch: true });
  return a;
}

// ---------------- review a draft ----------------
export async function loadUrlDraft(id, url) {
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  return readPageMarkdown(url);
}
function highlights(md, keyword) {
  const out = [], low = md.toLowerCase();
  for (const f of FILLER_PHRASES) if (low.includes(f)) out.push({ text: f, type: "filler", message: "Filler phrase: says nothing specific. Cut it or replace it with a concrete point." });
  for (const sent of md.split(/(?<=[.!?])\s+/)) {
    if (/\d+(\.\d+)?\s?%|\b\d{2,}\b.*\b(percent|users|companies|study|survey|report)\b/i.test(sent) && !/\]\(https?:\/\/|\[SOURCE|\[ADD DATA/i.test(sent))
      out.push({ text: sent.trim().replace(/^(#{1,6} |> |[-*] |\d+\. )+/, "").slice(0, 160), type: "unsourced", message: "Statistic without a source. Link to where it comes from, or remove it." });
  }
  const phrase = (keyword || "").toLowerCase().trim();
  if (phrase) for (const sent of md.split(/(?<=[.!?])\s+|\n+/)) if (!sent.trim().startsWith("#") && sent.toLowerCase().split(phrase).length - 1 > 1)
    out.push({ text: sent.trim().slice(0, 160), type: "repetition", message: `“${keyword}” appears more than once in this sentence. Use natural wording.` });
  for (const para of md.split(/\n\n/)) { const w = (para.match(/[A-Za-z0-9\u00c0-\uffff']+/g) || []).length;
    if (w > SEO.paragraph_max_words && !/^\s*(#|\||-|\*|\d+\.)/.test(para)) out.push({ text: para.trim().split(/(?<=[.!?])\s+/)[0].slice(0, 120), type: "long", message: `Long paragraph (${w} words). Split it so it's easy to scan.` }); }
  return out.slice(0, 60);
}
export async function reviewDraft(id, { keyword = "", draft = "", title_tag = "", meta_description = "", author = "", source = "paste", source_url = "", verify_claims = false }, progress = () => {}) {
  const [s, p] = await ctx(id);
  keyword = keyword.trim(); draft = String(draft || "").trim();
  if (!draft || draft.split(/\s+/).length < 80) throw new GuardrailError("Add a fuller draft (at least about 80 words) to review.");
  if (!keyword) throw new GuardrailError("Enter the keyword this page should rank for.");
  const saved = (await keywords(id)).find(k => k.keyword === keyword.toLowerCase());
  const intent = saved?.check?.analysis?.dominant_intent && INTENTS[saved.check.analysis.dominant_intent] ? saved.check.analysis.dominant_intent : classify(keyword);
  const page_type = INTENTS[intent].formats.find(f => PAGE_TYPES.includes(f)) || "blog_post";
  const matches = findMatches(keyword, p).filter(m => !source_url || nurl(m.url) !== nurl(source_url));   // reviewing your own live page isn't a duplicate of itself
  const dupe = matches.some(m => m.intent === intent && m.similarity >= GUARDRAILS.block_if_same_intent_page_exists_similarity);
  progress("Reviewing as a searcher and a Google quality rater… about a minute.");
  const [ev, au] = await Promise.all([
    ask("evaluate", P.evaluate(keyword, intent, saved?.check?.satisfaction || {}, s, draft, matches)),
    ask("audit", P.audit(s, p, keyword, draft, matches)),
  ]);
  let claims = null;
  if (verify_claims) { progress("Fact-checking claims with web search…"); claims = await ask("claims", P.claims(keyword, draft), { webSearch: true }); }
  const payload = { body_markdown: draft, title_tag, meta_description, slug: "", faqs: [] };
  const val = check(payload, keyword, page_type, new Set(p.map(x => x.url)), author || "");
  // title/meta are optional here: don't let missing ones fail the review
  if (!title_tag || !meta_description) { val.checks = val.checks.filter(c => !((!title_tag && ["title_len", "title_kw"].includes(c.id)) || (!meta_description && c.id === "meta_len") || c.id === "slug" || (!author && c.id === "author")));
    val.fails = val.checks.filter(c => c.status === "fail").length; val.warns = val.checks.filter(c => c.status === "warn").length;
    val.seo_score = Math.round(100 * (val.checks.length - val.fails - 0.5 * val.warns) / val.checks.length); }
  const g = gate(val, ev, claims?.summary, dupe);
  const rev = { id: store.newId(), keyword, intent, page_type, title_tag, meta_description, author, source, source_url, draft, evaluation: ev, audit: au, validation: val, gate: g,
    claims, matches, highlights: highlights(draft, keyword), at: Date.now() };
  const hist = await store.get(`reviews:${id}`, []); hist.unshift(rev); await store.set(`reviews:${id}`, hist.slice(0, 20));
  return rev;
}
export async function reviews(id) { return (await store.get(`reviews:${id}`, [])).map(({ draft, evaluation, audit, validation, claims, matches, highlights, ...r }) => r); }
export async function getReview(id, rid) { const r = (await store.get(`reviews:${id}`, [])).find(x => x.id === rid); if (!r) throw new GuardrailError("Review not found."); return r; }
export async function importReview(id, rid) {
  const s = await site(id), r = await getReview(id, rid), md = r.draft;
  const h1 = (md.match(/^# (?!#)(.+)$/m) || [])[1] || r.keyword;
  const faqSec = md.split(/^## .*(?:faq|frequently asked).*$/im)[1] || "";
  const faqs = [...faqSec.matchAll(/^### (.+)\n+([^#][\s\S]*?)(?=\n### |\n## |$)/gm)].map(m => ({ q: m[1].trim(), a: m[2].trim() })).slice(0, 8);
  const payload = { title_tag: r.title_tag || h1.slice(0, 60), meta_description: r.meta_description || "", slug: r.keyword.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").split("-").slice(0, 6).join("-"),
    h1, body_markdown: md, faqs, internal_links: [], image_suggestions: [], secondary_keywords: [], cta: "", ai_disclosure: "" };
  payload.html = mdToHtml(md); payload.schema_jsonld = buildSchema(s, payload, r.author || "", r.page_type);
  const report = { satisfaction_model: {}, structure: structureFor(r.keyword, r.intent, r.page_type), brief: {}, matches: r.matches, warnings: [`Imported from Review a draft${r.source_url ? ` (${r.source_url})` : ""}.`],
    validation: r.validation, evaluation: r.evaluation, claims: r.claims, gate: r.gate, rounds: [], status: r.gate.status,
    note: "Fix the issues in the Edit tab, fill any placeholders with real proof, then approve." };
  const item = { id: store.newId(), keyword: r.keyword, intent: r.intent, page_type: r.page_type, author: r.author || "", title: payload.title_tag, slug: payload.slug, payload, report,
    status: r.gate.status, created_at: Date.now(), imported_from: r.source_url || "draft", versions: [{ v: 1, at: Date.now(), source: "import", note: "Imported from Review a draft", markdown: md }] };
  const all = await contents(id); await store.set(`contents:${id}`, [item, ...all]);
  return item;
}

// ---------------- site health ----------------
const nurl = u => (u || "").replace(/\/$/, "").split("#")[0].split("?")[0].toLowerCase();
async function trafficMap(id) {
  const imps = await gscImports(id), m = new Map(); if (!imps.length) return m;
  for (const r of imps[0].rows) if (r.kind === "page" || r.kind === "query_page") {
    const k = nurl(r.page), e = m.get(k) || { clicks: 0, impressions: 0 }; e.clicks += r.clicks; e.impressions += r.impressions; m.set(k, e);
  }
  for (const v of m.values()) { v.clicks = Math.round(v.clicks); v.impressions = Math.round(v.impressions); }
  return m;
}
export async function ignoredIssues(id) { return store.get(`ignored:${id}`, []); }
export async function auditFor(id) {
  const s = await site(id), p = await pages(id); if (!p.length) throw new GuardrailError("Read the website first.");
  const ign = await ignoredIssues(id);
  return techaudit.run(s, p, { ignored: new Set(ign.map(x => x.check + "|" + x.url)), traffic: await trafficMap(id) });
}
export async function siteHealth(id) {
  const a = await auditFor(id), hist = await store.get(`health:${id}`, []);
  const snap = { at: Date.now(), crawl_id: a.crawl_id, crawled_at: a.crawled_at, health: a.health_score, counts: a.counts, pages: a.pages_checked, keys: a.keys };
  const last = hist[hist.length - 1];
  if (last && (last.crawl_id || last.crawled_at) === a.crawl_id) hist[hist.length - 1] = snap; else hist.push(snap);   // one snapshot per crawl
  await store.set(`health:${id}`, hist.slice(-24));
  const prev = hist.length > 1 ? hist[hist.length - 2] : null;
  if (prev) {
    const cur = new Set(a.keys), old = new Set(prev.keys || []);
    a.progress = { since: prev.crawled_at, fixed: [...old].filter(k => !cur.has(k)).length, new: [...cur].filter(k => !old.has(k)).length, health_before: prev.health };
  }
  a.history = hist.map(h => ({ crawled_at: h.crawled_at, health: h.health, counts: h.counts }));
  a.ignored = await ignoredIssues(id);
  delete a.keys; return a;
}
export async function ignoreIssue(id, { check, url, reason = "" }) {
  const all = (await ignoredIssues(id)).filter(x => !(x.check === check && x.url === url));
  all.unshift({ check, url, reason, at: Date.now() }); await store.set(`ignored:${id}`, all); return { ok: true };
}
export async function unignoreIssue(id, { check, url }) {
  await store.set(`ignored:${id}`, (await ignoredIssues(id)).filter(x => !(x.check === check && x.url === url))); return { ok: true };
}
export async function pageFixes(id, url) {
  const s = await site(id), p = (await pages(id)).find(x => x.url === url); if (!p) throw new GuardrailError("Page not found in the pages read.");
  const a = await auditFor(id), row = a.page_rows.find(r => r.url === url), issues = row ? row.issues : [];
  const kw = (await keywords(id)).find(k => k.primary_url && nurl(k.primary_url) === nurl(url));
  const res = await ask("page_fixes", P.pageFixes(s, p, issues, kw?.keyword || ""));
  res.current = { title_tag: p.title || "", meta_description: p.meta_description || "", h1: (p.h1 || [])[0] || "" };
  return res;
}
export async function healthCsv(id) {
  const a = await auditFor(id), esc = v => { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  const rows = [["severity", "issue", "page", "detail", "google_clicks", "how_to_fix"]];
  for (const i of a.issues) for (const x of i.pages) rows.push([i.severity, i.label, x.url, x.detail, x.clicks ?? "", i.fix]);
  return rows.map(r => r.map(esc).join(",")).join("\n");
}

// ---------------- AI visibility ----------------
export const ENGINES = ["chatgpt", "google_ai_overviews", "google_ai_mode", "perplexity", "gemini", "copilot", "claude", "claude_web_search", "chatgpt_web_search", "gemini_web_search", "demo", "other"];
export const PROVIDER_ENGINE = { claude: "claude_web_search", openai: "chatgpt_web_search", gemini: "gemini_web_search", mock: "demo" };
const domainOf = u => { try { return new URL(/^https?:/.test(u) ? u : "https://" + u).host.toLowerCase().replace(/^www\./, ""); } catch { return ""; } };
const reEsc = x => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const aiQuestions = id => store.get(`aiq:${id}`, []);
export async function addQuestions(id, list, topic = "") {
  const all = await aiQuestions(id), have = new Set(all.map(q => q.question.toLowerCase().trim())); let added = 0;
  for (let q of list) { q = String(q || "").trim().replace(/\s+/g, " "); if (!q || q.length > 300 || have.has(q.toLowerCase())) continue;
    all.push({ id: store.newId(), question: q, topic, created_at: Date.now() }); have.add(q.toLowerCase()); added++; }
  await store.set(`aiq:${id}`, all.slice(0, 200)); return { added };
}
export async function removeQuestion(id, qid) { await store.set(`aiq:${id}`, (await aiQuestions(id)).filter(q => q.id !== qid)); return { ok: true }; }
export async function setCompetitors(id, names) { await updateSite(id, { competitors: names.map(n => n.trim()).filter(Boolean).slice(0, 15) }); return { ok: true }; }
function brandOf(s) { return (s.name || "").trim(); }
function mentions(text, name) { return !!name && new RegExp("(^|[^a-z0-9])" + reEsc(name.toLowerCase()) + "([^a-z0-9]|$)").test(text.toLowerCase()); }
export async function runChecks(id, { question_ids = null, providers = [] } = {}, progress = () => {}) {
  const s = await site(id), brand = brandOf(s), dom = domainOf(s.url);
  let qs = await aiQuestions(id); if (question_ids && question_ids.length) qs = qs.filter(q => question_ids.includes(q.id));
  if (!qs.length) throw new GuardrailError("Add at least one question to track.");
  if (!providers.length) throw new GuardrailError("Choose at least one AI assistant.");
  qs = qs.slice(0, 25);
  const runId = Date.now(), rows = [], total = qs.length * providers.length; let n = 0, failed = 0;
  for (const q of qs) for (const prov of providers) {
    n++; progress(`Asking ${prov === "mock" ? "Demo" : prov} (${n}/${total}): ${q.question.slice(0, 60)}…`);
    let res;
    try { res = await ask("visibility", P.visibility(q.question), { webSearch: true, maxSearches: 5, provider: prov }); }
    catch (e) { failed++; rows.push({ id: store.newId(), question_id: q.id, prompt: q.question, engine: PROVIDER_ENGINE[prov] || "other", provider: prov, error: e.message, run_id: runId, method: "auto", checked_at: today(), at: Date.now() }); continue; }
    const answer = String(res.answer || ""), sources = (res.sources || []).filter(x => typeof x === "string").slice(0, 15), brands = (res.brands_mentioned || []).filter(x => typeof x === "string").slice(0, 15);
    const text = answer + " " + brands.join(" ");
    const mentioned = mentions(text, brand) || text.toLowerCase().includes(dom), cited = sources.find(x => domainOf(x).endsWith(dom)) || "";
    const pos = brands.findIndex(b => mentions(b, brand)), sentences = answer.split(/(?<=[.!?])\s+/).filter(x => mentions(x, brand)).slice(0, 3);
    rows.push({ id: store.newId(), question_id: q.id, prompt: q.question, engine: PROVIDER_ENGINE[prov] || "other", provider: prov, mentioned: mentioned || !!cited, cited_url: cited,
      position: pos >= 0 ? pos + 1 : null, brands, competitors: brands.filter(b => !mentions(b, brand)).join(", "), sources, cited_domains: [...new Set(sources.map(domainOf))],
      brand_context: sentences.join(" "), answer_excerpt: answer.slice(0, 900), no_search: !!res._no_search, run_id: runId, method: "auto", checked_at: today(), at: Date.now() });
  }
  const all = await visRows(id); await store.set(`vis:${id}`, [...rows.reverse(), ...all].slice(0, 3000));
  return { run_id: runId, checks: rows.length, failed, errors: [...new Set(rows.filter(r => r.error).map(r => r.error))].slice(0, 3) };
}
export async function addVis(id, rows) {
  const qs = await aiQuestions(id), all = await visRows(id);
  await addQuestions(id, rows.map(r => r.prompt));
  const qs2 = await aiQuestions(id);
  for (const r of rows) { const q = qs2.find(x => x.question.toLowerCase() === String(r.prompt).toLowerCase().trim());
    all.unshift({ id: store.newId(), method: "manual", ...r, question_id: q?.id || null, brands: (r.competitors || "").split(",").map(x => x.trim()).filter(Boolean), sources: r.cited_url ? [r.cited_url] : [],
      cited_domains: r.cited_url ? [domainOf(r.cited_url)] : [], checked_at: r.checked_at || today(), at: Date.now(), run_id: "manual-" + (r.checked_at || today()) }); }
  await store.set(`vis:${id}`, all);
}
export function visSummary(rows, siteUrl, { brand = "", competitors = [], questions = [] } = {}) {
  const ours = domainOf(siteUrl), ok = rows.filter(r => !r.error);
  // latest result per question x assistant = "current state"
  const latest = new Map(); for (const r of ok) { const k = r.prompt.trim().toLowerCase() + "|" + r.engine; if (!latest.has(k)) latest.set(k, r); }
  const cur = [...latest.values()];
  const rate = (a, f) => a.length ? Math.round(100 * a.filter(f).length / a.length) : 0;
  const posd = cur.filter(r => r.mentioned && r.position);
  const by = {}; for (const r of cur) { const e = by[r.engine] = by[r.engine] || { checks: 0, mentioned: 0, cited: 0 }; e.checks++; e.mentioned += r.mentioned ? 1 : 0; e.cited += r.cited_url && domainOf(r.cited_url).endsWith(ours) ? 1 : 0; }
  const engines = Object.fromEntries(Object.entries(by).map(([k, v]) => [k, { ...v, mention_rate: Math.round(100 * v.mentioned / v.checks), citation_rate: Math.round(100 * v.cited / v.checks) }]));
  // share of voice across current answers: our brand + tracked competitors + the most-named others
  const counts = new Map(); for (const r of cur) for (const b of new Set((r.brands || []).map(x => x.trim()).filter(Boolean))) { const k = b.toLowerCase(); const e = counts.get(k) || { name: b, n: 0 }; e.n++; counts.set(k, e); }
  if (brand) { const k = brand.toLowerCase(); const e = counts.get(k) || { name: brand, n: 0 }; e.n = Math.max(e.n, cur.filter(r => r.mentioned).length); e.ours = true; counts.set(k, e); }
  const tracked = new Set(competitors.map(c => c.toLowerCase()));
  const sov = [...counts.values()].filter(e => e.ours || tracked.has(e.name.toLowerCase()) || true).sort((a, b) => (b.ours - a.ours) || b.n - a.n);
  const top = [...sov.filter(e => e.ours), ...sov.filter(e => !e.ours && tracked.has(e.name.toLowerCase())), ...sov.filter(e => !e.ours && !tracked.has(e.name.toLowerCase()))].slice(0, 10);
  const totalN = top.reduce((t, e) => t + e.n, 0) || 1;
  const share_of_voice = top.map(e => ({ name: e.name, answers: e.n, share: Math.round(100 * e.n / totalN), ours: !!e.ours, tracked: tracked.has(e.name.toLowerCase()) }));
  const dc = new Map(); for (const r of cur) for (const d of r.cited_domains || []) if (d && !d.endsWith(ours)) dc.set(d, (dc.get(d) || 0) + 1);
  const sources = [...dc].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([domain, n]) => ({ domain, answers: n }));
  // trend: mention rate per run
  const runs = new Map(); for (const r of ok) { const k = String(r.run_id || r.checked_at); const e = runs.get(k) || { run: k, date: r.checked_at, at: r.at || 0, n: 0, m: 0 }; e.n++; e.m += r.mentioned ? 1 : 0; runs.set(k, e); }
  const trend = [...runs.values()].sort((a, b) => a.at - b.at).slice(-12).map(e => ({ date: e.date, at: e.at, checks: e.n, mention_rate: Math.round(100 * e.m / e.n) }));
  // per question
  const qmap = new Map(questions.map(q => [q.question.trim().toLowerCase(), { ...q, results: {}, history: [] }]));
  for (const r of ok) { const k = r.prompt.trim().toLowerCase(); if (!qmap.has(k)) qmap.set(k, { id: null, question: r.prompt, results: {}, history: [] });
    const q = qmap.get(k); if (!q.results[r.engine]) q.results[r.engine] = r; if (q.history.length < 8) q.history.push({ engine: r.engine, mentioned: !!r.mentioned, date: r.checked_at }); }
  const qrows = [...qmap.values()].map(q => { const res = Object.values(q.results);
    return { id: q.id, question: q.question, topic: q.topic || "", analysis: q.analysis || null, results: q.results, history: q.history.reverse(),
      mentioned_any: res.some(r => r.mentioned), checked: res.length > 0, last: res.length ? res.map(r => r.checked_at).sort().pop() : null }; });
  const gaps = cur.filter(r => !r.mentioned && (r.brands || []).length).map(r => ({ prompt: r.prompt, engine: r.engine, competitors: (r.brands || []).join(", "), checked_at: r.checked_at }));
  return { checks: ok.length, prompts: qrows.length, mention_rate: rate(cur, r => r.mentioned), citation_rate: rate(cur, r => r.cited_url && domainOf(r.cited_url).endsWith(ours)),
    avg_position: posd.length ? Math.round(10 * posd.reduce((t, r) => t + r.position, 0) / posd.length) / 10 : null,
    engines, share_of_voice, sources, trend, questions: qrows, gaps: gaps.slice(0, 50),
    top_competitors: share_of_voice.filter(e => !e.ours).map(e => [e.name, e.answers]),
    note: "Each check is one sample. AI answers vary by time, location, account and wording, so look at trends across several runs." };
}
export async function visOverview(id) {
  const s = await site(id), rows = await visRows(id), qs = await aiQuestions(id);
  return { rows, questions: qs, competitors: s.competitors || [], brand: brandOf(s), engines: ENGINES,
    summary: visSummary(rows, s.url, { brand: brandOf(s), competitors: s.competitors || [], questions: qs }) };
}
export async function whyNotUs(id, qid) {
  const [s, p] = await ctx(id), qs = await aiQuestions(id), q = qs.find(x => x.id === qid); if (!q) throw new GuardrailError("Question not found.");
  const rows = (await visRows(id)).filter(r => r.question_id === qid && !r.error), latest = new Map(); for (const r of rows) if (!latest.has(r.engine)) latest.set(r.engine, r);
  if (!latest.size) throw new GuardrailError("Run this question first, so there are answers to analyse.");
  const related = findMatches(q.question, p, 5).map(m => ({ url: m.url, title: m.title, match: m.similarity }));
  const res = await ask("why_not_us", P.whyNotUs(s, q.question, [...latest.values()], related));
  q.analysis = { ...res, at: Date.now() }; await store.set(`aiq:${id}`, qs); return q.analysis;
}
export async function questionIdeas(id, { topic = "" } = {}) {
  const s = await site(id), kws = (await keywords(id)).map(k => k.keyword), qs = await aiQuestions(id);
  const res = await ask("question_ideas", P.questionIdeas(s, topic, kws, qs.map(q => q.question)));
  const have = new Set(qs.map(q => q.question.toLowerCase()));
  return (res.questions || []).filter(x => x && x.question).map(x => ({ ...x, tracked: have.has(String(x.question).toLowerCase()) }));
}
// kept for older callers: ask a few questions with the active provider
export async function autoVis(id, prompts) {
  await addQuestions(id, prompts); const qs = await aiQuestions(id), ids = qs.filter(q => prompts.map(p => p.toLowerCase().trim()).includes(q.question.toLowerCase())).map(q => q.id);
  await runChecks(id, { question_ids: ids, providers: [getSettings().provider] });
  const rows = (await visRows(id)).filter(r => ids.includes(r.question_id)).slice(0, ids.length);
  return rows.map(r => ({ prompt: r.prompt, engine: r.engine, mentioned: r.mentioned, cited_url: r.cited_url, competitors: r.competitors, notes: r.error || (r.position ? `Brand position in answer: ${r.position}.` : ""), answer_excerpt: r.answer_excerpt || "", sources: r.sources || [] }));
}

// ---------------- Search Console ----------------
export async function gscImport(id, file, label) {
  const { files, rows } = await gsc.parseFile(file);
  const range = gsc.dateRange(rows);
  if (!label && range) { const f = d => new Date(d + "T00:00:00Z").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }); label = `${f(range.from)} – ${f(range.to)}`; }
  if (!rows.length) throw new GuardrailError("No Search Console data found. Upload the zip from Performance → Export, Queries.csv / Pages.csv, or a CSV with query/page, clicks, impressions, CTR and position.");
  const all = await gscImports(id); all.unshift({ id: store.newId(), label: label || file.name, files, rows, created_at: Date.now() });
  await store.set(`gsc:${id}`, all); return { rows: rows.length, files };
}
export async function brandTerms(id) {
  const s = await site(id); if (!s) return [];
  if (Array.isArray(s.brand_terms)) return s.brand_terms;
  const host = (() => { try { return new URL(s.url).host.replace(/^www\./, "").split(".")[0]; } catch { return ""; } })();
  return [...new Set([(s.name || "").toLowerCase().trim(), host].filter(x => x && x.length >= 3))];
}
export async function setBrandTerms(id, terms) { await updateSite(id, { brand_terms: terms.map(t => t.toLowerCase().trim()).filter(Boolean).slice(0, 20) }); return brandTerms(id); }
export async function gscOverview(id) {
  const imps = await gscImports(id); if (!imps.length) return { imports: [], analysis: null };
  const rows = imps[0].rows, prev = imps[1]?.rows || null, terms = await brandTerms(id);
  const analysis = gsc.analyse(rows, prev), ex = gsc.extras(rows, prev, { brandTerms: terms, updates: GOOGLE_UPDATES });
  // topics: group the searches into clusters, one page per topic
  let q = rows.filter(r => r.kind === "query"); if (!q.length) q = rows.filter(r => r.kind === "query_page");
  const top = [...q].sort((a, b) => b.impressions - a.impressions).slice(0, 400).filter(r => !gsc.isBranded(r.query, terms));
  const byQ = new Map(top.map(r => [r.query.toLowerCase(), r]));
  const pg = await pages(id), ix = pg.length ? buildIndex(pg) : null;
  const topics = clusterKeywords(top.map(r => ({ keyword: r.query.toLowerCase(), volume: r.impressions, opportunity: r.impressions, intent: classify(r.query) })))
    .filter(c => c.size >= 2).map(c => {
      const rs = c.keywords.map(k => byQ.get(k)).filter(Boolean), imp = rs.reduce((t, r) => t + r.impressions, 0), clk = rs.reduce((t, r) => t + r.clicks, 0);
      const pos = imp ? rs.reduce((t, r) => t + r.position * r.impressions, 0) / imp : 0;
      return { topic: c.primary, intent: c.intent, searches: c.keywords, clicks: Math.round(clk), impressions: Math.round(imp), ctr: imp ? Math.round(10000 * clk / imp) / 100 : 0,
        position: Math.round(pos * 10) / 10, coverage: ix ? coverage(ix, c.primary, c.intent) : null };
    }).sort((a, b) => b.impressions - a.impressions).slice(0, 25);
  return { imports: imps.map(({ rows, ...i }) => ({ ...i, rows: rows.length })), analysis: { ...analysis, ...ex, topics, brand_terms: terms } };
}
export async function snippetFix(id, row) {
  const s = await site(id); if (!s) throw new GuardrailError("Site not found.");
  const p = row.page ? (await pages(id)).find(x => nurl(x.url) === nurl(row.page)) : null;
  return ask("snippet_fix", P.snippetFix(s, row, p));
}
export async function gscTrend(id) {
  return (await gscImports(id)).slice().reverse().map(i => {
    let base = i.rows.filter(r => r.kind === "page"); if (!base.length) base = i.rows.filter(r => r.kind === "query"); if (!base.length) base = i.rows;
    return { label: i.label, clicks: Math.round(base.reduce((a, r) => a + r.clicks, 0)), impressions: Math.round(base.reduce((a, r) => a + r.impressions, 0)) };
  });
}

// ---------------- keyword table + action list ----------------
function opportunity(k, maxVol) {
  const vol = k.volume || k.gsc_impressions || 0, v = maxVol ? vol / maxVol : 0;
  const ease = typeof k.difficulty === "number" && k.difficulty ? 1 - k.difficulty / 100 : 0.6, bv = (k.business_value || 3) / 5;
  return Math.round(100 * (0.45 * v + 0.35 * bv + 0.20 * ease));
}
export async function keywordTable(id) {
  const kws = await keywords(id), imps = await gscImports(id), gq = new Map();
  if (imps.length) for (const r of imps[0].rows) if (r.query) { const g = gq.get(r.query.toLowerCase()) || { impressions: 0, clicks: 0, pos: r.position }; g.impressions += r.impressions; g.clicks += r.clicks; gq.set(r.query.toLowerCase(), g); }
  for (const k of kws) { const g = gq.get(k.keyword); k.gsc_impressions = g ? Math.round(g.impressions) : null; k.gsc_clicks = g ? Math.round(g.clicks) : null; k.gsc_position = g ? g.pos : null; }
  const maxVol = Math.max(0, ...kws.map(k => k.volume || k.gsc_impressions || 0));
  const pg = await pages(id), ix = pg.length ? buildIndex(pg) : null;
  for (const k of kws) {
    k.opportunity = opportunity(k, maxVol);
    if (!k.intent) { k.intent = classify(k.keyword); k.intent_guessed = true; }
    k.coverage = ix ? coverage(ix, k.keyword, k.intent) : { status: "unknown", url: "", similarity: 0 };
  }
  return kws.sort((a, b) => b.opportunity - a.opportunity);
}
const fp = (...parts) => parts.map(p => String(p).trim().toLowerCase().replace(/\s+/g, " ").slice(0, 180)).join(":");
export async function buildActions(id) {
  const s = await site(id), p = await pages(id), out = [];
  const SEVP = { error: "P0", high: "P1", medium: "P2", low: "P3" };
  if (p.length) for (const i of (await auditFor(id)).issues) out.push({ fingerprint: fp("tech", i.check), link: { view: "tech", check: i.check }, source: "Site health", priority: SEVP[i.severity], type: "technical",
    title: `${i.label} (${i.count} pages)`, detail: i.fix, urls: i.pages.slice(0, 20).map(x => x.url), impact: i.severity, effort: "low" });
  for (const k of await keywordTable(id)) if (["create", "update", "merge", "redirect"].includes(k.action)) {
    const verb = { create: "Create a page for", update: "Improve the page for", merge: "Merge pages for", redirect: "Redirect duplicate page for" }[k.action];
    out.push({ fingerprint: fp("kw", k.keyword, k.action), link: { view: k.action === "create" ? "generate" : "keyword", keyword: k.keyword, intent: k.intent }, source: "Keywords", priority: k.opportunity >= 60 ? "P1" : k.opportunity >= 35 ? "P2" : "P3", type: "content",
      title: `${verb} "${k.keyword}"`, detail: `${(k.reason || "").slice(0, 400)} Opportunity score ${k.opportunity}.`, urls: k.primary_url ? [k.primary_url] : [], impact: `opportunity ${k.opportunity}`, effort: k.action === "create" ? "high" : "medium" });
  }
  const rv = await store.get(`urlreview:${id}`);
  for (const g of rv?.review?.groups || []) { const acts = (g.urls || []).filter(u => ["merge", "redirect", "update"].includes(u.action));
    if (acts.length) out.push({ fingerprint: fp("urlmap", g.primary_url), link: { view: "urlmap", tab: "compete" }, source: "Competing pages", priority: ["P0", "P1", "P2", "P3"].includes(g.priority) ? g.priority : "P2", type: "consolidation",
      title: `Consolidate "${g.topic || ""}" into one main page`, detail: acts.map(u => `${u.action}: ${u.url}`).join("; ").slice(0, 600), urls: [g.primary_url, ...acts.map(u => u.url)], impact: "high", effort: "medium" }); }
  const imps = await gscImports(id);
  if (imps.length) {
    const a = gsc.analyse(imps[0].rows, imps[1]?.rows || null);
    for (const r of a.low_ctr.slice(0, 15)) { const key = r.query || r.page; out.push({ fingerprint: fp("gsc-ctr", key), link: { view: "gsc", tab: "quick" }, source: "Google search", priority: r.missed_clicks >= 100 ? "P1" : "P2", type: "snippet",
      title: `Low click-through for "${key}"`, detail: `CTR ${r.ctr}% at position ${r.position} vs this site's ${r.benchmark_ctr}% (${r.bucket}). About ${r.missed_clicks} clicks missed. Check the title and description match what searchers want.`, urls: r.page ? [r.page] : [], impact: `~${r.missed_clicks} clicks`, effort: "low" }); }
    for (const r of a.striking_distance.slice(0, 10)) out.push({ fingerprint: fp("gsc-strike", r.query), link: { view: "keyword", keyword: r.query }, source: "Google search", priority: "P2", type: "content", title: `Close to page 1: "${r.query}" (position ${r.position})`,
      detail: `${Math.round(r.impressions)} impressions. Check the keyword, then strengthen the page that owns this search.`, urls: [], impact: `${Math.round(r.impressions)} impressions`, effort: "medium" });
    for (const c of a.cannibalisation.slice(0, 10)) out.push({ fingerprint: fp("gsc-canni", c.query), link: { view: "gsc", tab: "compete" }, source: "Google search", priority: "P1", type: "consolidation", title: `${c.pages.length} pages compete for "${c.query}"`,
      detail: "Pick one main page; merge, differentiate or redirect the others.", urls: c.pages.map(x => x.page), impact: `${c.impressions} impressions`, effort: "medium" });
    for (const d of a.declining_pages.slice(0, 10)) out.push({ fingerprint: fp("gsc-decline", d.page), link: { view: "tech", url: d.page }, source: "Google search", priority: "P1", type: "refresh", title: `Clicks down ${Math.abs(d.change_pct)}% on a page`,
      detail: `${d.clicks_before} → ${d.clicks_now} clicks; position ${d.position_before} → ${d.position_now}. Check what changed and whether the page still fully answers the search.`, urls: [d.page], impact: `-${d.clicks_before - d.clicks_now} clicks`, effort: "medium" });
    for (const r of a.pages_with_impressions_no_clicks.slice(0, 10)) out.push({ fingerprint: fp("gsc-noclick", r.page), link: { view: "tech", url: r.page }, source: "Google search", priority: "P2", type: "snippet", title: "Page gets impressions but no clicks",
      detail: `${Math.round(r.impressions)} impressions at position ${r.position}.`, urls: [r.page], impact: `${Math.round(r.impressions)} impressions`, effort: "low" });
  }
  for (const g of visSummary(await visRows(id), s.url, { brand: s.name || "" }).gaps.slice(0, 20)) out.push({ fingerprint: fp("ai", g.prompt, g.engine), link: { view: "aivis", question: g.prompt }, source: "AI answers", priority: "P2", type: "ai_visibility",
    title: `Not mentioned by ${({ claude_web_search: "Claude", chatgpt_web_search: "ChatGPT", gemini_web_search: "Gemini", demo: "Demo" })[g.engine] || g.engine.replace(/_/g, " ")} for "${g.prompt.slice(0, 80)}"`, detail: `Named instead: ${g.competitors}. Make sure a page clearly answers this question with original, sourced facts.`, urls: [], impact: "AI visibility", effort: "medium" });
  for (const c of await contents(id)) if (c.status === "ready_for_human_review") {
    const ph = c.report?.validation?.placeholders || 0;
    out.push({ fingerprint: fp("approve", c.id), link: { view: "library", content_id: c.id }, source: "My pages", priority: "P1", type: "content",
      title: `Review and approve: ${c.title || c.keyword}`, detail: `${ph ? `Fill ${ph} placeholder${ph > 1 ? "s" : ""} with real proof, then ` : ""}have the author check it and approve it in the Edit tab.`,
      urls: [], impact: "ready to publish", effort: ph ? "medium" : "low" });
  }
  for (const c of await contents(id)) if (["improve_before_publishing", "do_not_publish"].includes(c.status)) out.push({ fingerprint: fp("content", c.id), link: { view: "library", content_id: c.id }, source: "My pages", priority: "P2", type: "content",
    title: `Finish draft: ${c.title || c.keyword}`, detail: `Status: ${c.status.replace(/_/g, " ")}. Open it in My pages to see what's missing.`, urls: [], impact: "medium", effort: "medium" });
  const PTS = { P0: 100, P1: 60, P2: 30, P3: 10 }, EFF = { low: 1, medium: 2, high: 3 };
  for (const r of out) { r.score = Math.round(PTS[r.priority] / (EFF[r.effort] || 2)); r.quick_win = r.effort === "low" && ["P0", "P1", "P2"].includes(r.priority); }
  // merge with existing: keep status, owner, due date and notes; resolve vanished
  const old = await recs(id), byFp = new Map(old.map(r => [r.fingerprint, r])), live = new Set(out.map(r => r.fingerprint)), now = Date.now();
  const merged = out.map(r => { const o = byFp.get(r.fingerprint); return o ? { ...o, ...r, status: o.status === "resolved" ? "open" : o.status, updated_at: now } : { ...r, id: store.newId(), status: "open", created_at: now, updated_at: now }; });
  for (const o of old) if (!live.has(o.fingerprint)) merged.push({ ...o, status: ["open", "in_progress"].includes(o.status) ? "resolved" : o.status });
  const order = { open: 0, in_progress: 1 }; merged.sort((a, b) => (order[a.status] ?? 2) - (order[b.status] ?? 2) || a.priority.localeCompare(b.priority) || a.id - b.id);
  await store.set(`recs:${id}`, merged); return merged;
}
export async function setRecStatus(id, rid, status) { return updateRec(id, rid, { status }); }
export async function updateRec(id, rid, fields) {
  const all = await recs(id), r = all.find(x => x.id === rid); if (!r) throw new GuardrailError("Not found");
  if (fields.status && !["open", "in_progress", "done", "dismissed"].includes(fields.status)) throw new GuardrailError("Invalid status");
  for (const k of ["status", "owner", "due", "notes"]) if (fields[k] !== undefined) r[k] = typeof fields[k] === "string" ? fields[k].trim().slice(0, 500) : fields[k];
  if (fields.status === "done" && !r.done_at) r.done_at = Date.now();
  if (fields.status && fields.status !== "done") delete r.done_at;
  r.updated_at = Date.now(); await store.set(`recs:${id}`, all); return r;
}
export async function actionsCsv(id) {
  const all = await recs(id), esc = v => { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  const rows = [["priority", "status", "action", "detail", "source", "impact", "effort", "owner", "due", "notes", "pages"]];
  for (const r of all.filter(x => ["open", "in_progress"].includes(x.status))) rows.push([r.priority, r.status, r.title, r.detail, r.source, r.impact, r.effort, r.owner || "", r.due || "", r.notes || "", (r.urls || []).join(" ")]);
  return rows.map(r => r.map(esc).join(",")).join("\n");
}

// ---------------- keyword research + clusters + bulk ----------------
export async function addKeywords(id, list, source = "added") {
  const clean = [...new Set(list.map(k => String(k).toLowerCase().replace(/\s+/g, " ").trim()).filter(k => k && k.length <= 120))].slice(0, 2000);
  const existing = new Set((await keywords(id)).map(k => k.keyword));
  let added = 0; for (const k of clean) if (!existing.has(k)) { await upsertKeyword(id, k, {}, source); added++; }
  return { added, skipped: clean.length - added };
}
export async function bulkKeywords(id, list, op, fields = {}) {
  const set = new Set(list.map(k => k.toLowerCase().trim()));
  let all = await keywords(id);
  if (op === "delete") all = all.filter(k => !set.has(k.keyword));
  else for (const k of all) if (set.has(k.keyword)) { for (const [f, v] of Object.entries(fields)) if (v !== undefined && v !== null && v !== "") k[f] = v; k.updated_at = Date.now(); }
  await store.set(`keywords:${id}`, all); return { updated: set.size };
}
export async function keywordIdeas(id, { seed, focus = "" }) {
  const [s, p] = await ctx(id);
  if (!seed || !seed.trim()) throw new GuardrailError("Enter a topic or seed keyword.");
  const res = await ask("ideas", P.keywordIdeas(s, p, seed.trim(), focus));
  const ix = buildIndex(p), have = new Set((await keywords(id)).map(k => k.keyword));
  const ideas = (res.ideas || []).filter(x => x && x.keyword).map(x => {
    const kw = String(x.keyword).toLowerCase().trim(), intent = INTENTS[x.intent] ? x.intent : classify(kw);
    return { ...x, keyword: kw, intent, coverage: coverage(ix, kw, intent), in_list: have.has(kw) };
  });
  return { seed: seed.trim(), ideas, note: res.note || "" };
}
export async function keywordClusters(id) {
  const kws = await keywordTable(id), byKw = new Map(kws.map(k => [k.keyword, k]));
  const pg = await pages(id), ix = pg.length ? buildIndex(pg) : null;
  return clusterKeywords(kws).map(c => {
    // the page that should own the cluster: best existing match across its keywords
    let best = null;
    if (ix) for (const k of c.keywords) { const cv = byKw.get(k)?.coverage; if (cv && cv.url && (!best || cv.similarity > best.similarity)) best = { ...cv, keyword: k }; }
    const action = best && best.status === "covered" ? "update" : best && best.status === "partial" ? "update_or_create" : "create";
    return { ...c, owner_url: best?.url || "", owner_title: best?.title || "", owner_status: best?.status || "gap", action };
  });
}


// ---------------- editing, versions, approval ----------------
export function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  doc.querySelectorAll("script,style,iframe,object,embed,form,input,button,textarea,select,link,meta,base,svg,math").forEach(e => e.remove());
  for (const el of doc.querySelectorAll("*")) for (const a of [...el.attributes]) {
    const n = a.name.toLowerCase(), v = (a.value || "").trim().toLowerCase();
    if (n.startsWith("on") || n === "style" || n === "srcdoc" || ((n === "href" || n === "src" || n === "xlink:href") && /^(javascript|data|vbscript):/.test(v))) el.removeAttribute(a.name);
  }
  doc.querySelectorAll("a[href]").forEach(a => { a.setAttribute("rel", "noopener"); });
  return doc.body.firstChild.innerHTML;
}
export const mdToHtml = md => sanitizeHtml(window.marked ? window.marked.parse(md || "") : (md || ""));
export const placeholders = md => [...(md || "").matchAll(/\[(ADD|SOURCE|SCREENSHOT|DATA|QUOTE|EXPERT|EXAMPLE)[^\]]*\]/g)].map(m => ({ text: m[0], index: m.index }));

export async function getStyle(id) { return (await site(id))?.style || {}; }
export async function setStyle(id, style) { await updateSite(id, { style }); return style; }
export async function authors() { return store.get("authors", []); }
async function rememberAuthor(a) { a = (a || "").trim(); if (!a) return; const all = (await authors()).filter(x => x !== a); all.unshift(a); await store.set("authors", all.slice(0, 20)); }

async function loadItem(id, cid) {
  const all = await contents(id), i = all.findIndex(c => c.id === cid);
  if (i < 0) throw new GuardrailError("Page not found."); return [all, i];
}
function regate(item, pages) {
  const valid = new Set(pages.map(p => p.url)), r = item.report;
  const val = check(item.payload, item.keyword, item.page_type, valid, item.author || "");
  const g = gate(val, r.evaluation || {}, r.claims?.summary, false);
  r.validation = val; r.gate = g;
  if (item.status !== "approved" || val.placeholders || val.fails) { r.status = g.status; item.status = g.status; delete item.approved; }
  return item;
}
export async function saveDraft(id, cid, { markdown, title_tag, meta_description, slug, note = "", source = "edit" }) {
  const p = await pages(id), [all, i] = await loadItem(id, cid), item = all[i];
  if (typeof markdown === "string") item.payload.body_markdown = markdown;
  if (typeof title_tag === "string") item.payload.title_tag = title_tag.trim();
  if (typeof meta_description === "string") item.payload.meta_description = meta_description.trim();
  if (typeof slug === "string") item.payload.slug = slug.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
  const h1 = (item.payload.body_markdown.match(/^# (?!#)(.+)$/m) || [])[1]; if (h1) item.payload.h1 = h1.trim();
  item.payload.html = mdToHtml(item.payload.body_markdown);
  item.title = item.payload.title_tag || item.title; item.slug = item.payload.slug || item.slug;
  const s = await site(id); item.payload.schema_jsonld = buildSchema(s, item.payload, item.author || "", item.page_type);
  item.versions = item.versions || [];
  const last = item.versions[item.versions.length - 1];
  if (!last || last.markdown !== item.payload.body_markdown) item.versions.push({ v: (last?.v || 0) + 1, at: Date.now(), source, note, markdown: item.payload.body_markdown });
  if (item.versions.length > 30) item.versions = item.versions.slice(-30);
  regate(item, p); item.updated_at = Date.now();
  all[i] = item; await store.set(`contents:${id}`, all); return item;
}
export async function restoreVersion(id, cid, v) {
  const [all, i] = await loadItem(id, cid), ver = (all[i].versions || []).find(x => x.v === v);
  if (!ver) throw new GuardrailError("Version not found.");
  return saveDraft(id, cid, { markdown: ver.markdown, source: "restore", note: `Restored version ${v}` });
}
export function sections(md) {
  const lines = (md || "").split("\n"), out = []; let cur = null;
  lines.forEach((l, n) => { if (/^## (?!#)/.test(l)) { if (cur) out.push(cur); cur = { heading: l.slice(3).trim(), start: n, end: n }; } else if (cur) cur.end = n; });
  if (cur) out.push(cur); return out;
}
export async function rewriteSection(id, cid, heading, instruction) {
  const [s, p] = await ctx(id), [all, i] = await loadItem(id, cid), item = all[i];
  const md = item.payload.body_markdown, sec = sections(md).find(x => x.heading === heading);
  if (!sec) throw new GuardrailError("Section not found. Save your edits first, then pick the section again.");
  const lines = md.split("\n"), text = lines.slice(sec.start, sec.end + 1).join("\n");
  const res = await ask("rewrite_section", P.rewriteSection(s, item.keyword, item.intent, sections(md).map(x => x.heading), text, instruction, p.map(x => x.url), s.style));
  let newSec = String(res.markdown || "").trim(); if (!newSec) throw new GuardrailError("The AI returned an empty section. Try again.");
  if (!/^## /.test(newSec)) newSec = `## ${heading}\n\n${newSec}`;
  const updated = [...lines.slice(0, sec.start), ...newSec.split("\n"), "", ...lines.slice(sec.end + 1)].join("\n").replace(/\n{3,}/g, "\n\n");
  const saved = await saveDraft(id, cid, { markdown: updated, source: "section", note: `Rewrote “${heading}”: ${res.summary || instruction || ""}`.slice(0, 200) });
  return { item: saved, summary: res.summary || "" };
}
export async function reReview(id, cid) {
  const [s, p] = await ctx(id), [all, i] = await loadItem(id, cid), item = all[i];
  const matches = findMatches(item.keyword, p);
  item.report.evaluation = await ask("evaluate", P.evaluate(item.keyword, item.intent, item.report.satisfaction_model, s, item.payload.body_markdown, matches));
  regate(item, p); item.report.reviewed_at = Date.now(); all[i] = item; await store.set(`contents:${id}`, all); return item;
}
export async function approve(id, cid, { reviewer, confirmations = [] }) {
  const p = await pages(id), [all, i] = await loadItem(id, cid), item = regate(all[i], p), val = item.report.validation, problems = [];
  if (!reviewer || !reviewer.trim()) problems.push("Enter the name of the person approving the page.");
  if (val.placeholders) problems.push(`${val.placeholders} placeholder${val.placeholders > 1 ? "s" : ""} still need real content.`);
  if (val.fails) problems.push(`${val.fails} SEO check${val.fails > 1 ? "s" : ""} still failing (see the Checks tab).`);
  if (item.report.gate.status === "do_not_publish") problems.push("The release gate says do not publish: " + (item.report.gate.blocking_reasons || []).join(" "));
  if (confirmations.length < 3) problems.push("Tick all three confirmations.");
  if (problems.length) throw new GuardrailError("Not ready to approve yet: " + problems.join(" "));
  item.status = "approved"; item.approved = { by: reviewer.trim(), at: Date.now() };
  all[i] = item; await store.set(`contents:${id}`, all); return item;
}
export async function getItem(id, cid) { const [all, i] = await loadItem(id, cid); return all[i]; }
export function fullHtml(item) {
  const x = item.payload, e = t => String(t || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>${e(x.title_tag)}</title>\n<meta name="description" content="${e(x.meta_description)}">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<script type="application/ld+json">\n${JSON.stringify(x.schema_jsonld || {}, null, 2).replace(/</g, "\\u003c")}\n</script>\n</head>\n<body>\n<article>\n${mdToHtml(x.body_markdown)}\n</article>\n</body>\n</html>\n`;
}
