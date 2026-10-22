// services.js - the workflows. Google's rules are enforced here as guardrails and a release gate.
import * as store from "./store.js";
import * as P from "./prompts.js";
import { ask, askText, getSettings, isFreeProvider, hybridReviewer, hybridSettings, startMeter, stopMeter, meterPeek, PROVIDERS } from "./llm.js";
import { crawl, readPage, readPageMarkdown } from "./crawler.js";
import { pageIntent, findMatches, verdict, siteGroups, buildIndex, coverage, clusterKeywords, classify, tokens } from "./text.js";
import { check } from "./validators.js";
import * as techaudit from "./techaudit.js";
import * as gsc from "./gsc.js";
import { googleUpdates } from "./updates.js";
import { webSearch, resultsBlock, searchConfigured, SEARCH_PROVIDERS } from "./websearch.js";
import * as KB from "./kb.js";
import * as MON from "./monitor-core.mjs";
import * as SPEED from "./speed.js";
import * as IDX from "./indexcheck.js";
import * as BING from "./bing.js";
import * as LINKS from "./linkmap.js";
import * as DECAY from "./decay.js";
import * as COMP from "./competitors-core.mjs";
import * as MIG from "./migration.js";
import * as SCHEMA from "./schema.js";
import * as DUPES from "./dupes.js";
import * as EXT from "./extlinks.js";
import * as INOW from "./indexnow.js";
import * as WIKI from "./wiki.js";
import * as GA4 from "./ga4.js";
import * as TD from "./trackdiff.js";
import { LANGS, detectLang } from "./lang.js";
import { BUSINESS_TYPES, FILLER_PHRASES, SEO, GOOGLE_UPDATES, GUARDRAILS, SCORECARD, MUST_PASS, INTENTS, PAGE_TYPES, HIGH_RISK_PAGE_TYPES, RELEASE_GATE, URL_ACTIONS, structureFor } from "./rules.js";

export class GuardrailError extends Error { constructor(m) { super(m); this.guardrail = true; } }
const LEVEL = { none: 0, low: 1, medium: 2, high: 3 };

// ---------------- data access ----------------
export const sites = async () => store.get("sites", []);
export async function site(id) { return (await sites()).find(s => s.id === id) || null; }
export async function updateSite(id, patch) { const all = await sites(); const i = all.findIndex(s => s.id === id); if (i >= 0) { all[i] = { ...all[i], ...patch, updated_at: Date.now() }; await store.set("sites", all); return all[i]; } }
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
export async function addSite({ url, name = "", product = "", audience = "", business_type = "", max_pages = 200 }) {
  url = url.trim(); if (!/^https?:/i.test(url)) url = "https://" + url; url = url.replace(/\/+$/, "");
  const all = await sites(); let s = all.find(x => x.url === url);
  const bt = BUSINESS_TYPES[business_type] ? business_type : "";
  if (!s) { s = { id: store.newId(), url, name, product, audience, business_type: bt, business_type_guessed: !bt, status: "new", created_at: Date.now() }; all.unshift(s); }
  else Object.assign(s, { name: name || s.name, product: product || s.product, audience: audience || s.audience, ...(bt ? { business_type: bt, business_type_guessed: false } : {}) });
  await store.set("sites", all);
  runCrawl(s.id, max_pages);
  return s;
}
export async function deleteSite(id) {
  await store.set("sites", (await sites()).filter(s => s.id !== id));
  for (const k of ["pages", "keywords", "contents", "recs", "gsc", "vis", "urlreview"]) await store.del(`${k}:${id}`);
}
const ACTIVE_CRAWLS = new Map();   // site id -> AbortController, for crawls running in this tab
export function stopCrawl(id) { const c = ACTIVE_CRAWLS.get(id); if (c) c.abort(); return { ok: !!c }; }
export async function runCrawl(id, maxPages = 200) {
  if (ACTIVE_CRAWLS.has(id)) return;   // already reading this site
  const ctrl = new AbortController(); ACTIVE_CRAWLS.set(id, ctrl);
  const s = await site(id); await updateSite(id, { status: "crawling", error: "", notice: "", max_pages: maxPages, crawl_beat: Date.now() });
  try {
    const { summary, pages: pg } = await crawl(s.url, maxPages, msg => updateSite(id, { status: "crawling: " + msg, crawl_beat: Date.now() }), ctrl.signal);
    const old = await pages(id);
    if (summary.partial && pg.length < 20 && old.length) {   // stopped almost immediately: keep the previous read
      await updateSite(id, { status: "ready", notice: "Reading stopped. Your previous read is still in use." });
      return;
    }
    for (const p of pg) p.intent = pageIntent(p);
    await store.set(`pages:${id}`, pg);
    const cur = await site(id);
    if (!cur.business_type || cur.business_type_guessed) await updateSite(id, { business_type: detectBusinessType(pg), business_type_guessed: true });
    await updateSite(id, { status: "ready", summary, crawled_at: summary.crawled_at,
      notice: [summary.partial ? `Reading stopped after ${pg.length} pages. Results use those pages.` : summary.sitemap_capped ? "Your sitemaps are very large, so pages were sampled from the first 60,000 URLs." : "",
        summary.blocked_pages ? `${summary.blocked_pages} page${summary.blocked_pages > 1 ? "s" : ""} couldn't be read because the site blocked or rate-limited the reader (bot protection). The reader slowed down automatically; if it's your site, allow it in your bot protection, or read fewer pages.` : ""].filter(Boolean).join(" ") });
    extLinksNew(id).catch(() => {});   // links to other websites that are new since the last check, in the background
  } catch (e) {
    const old = await pages(id);
    await updateSite(id, old.length ? { status: "ready", notice: `The last read failed (${String(e.message || e).slice(0, 200)}). Your previous read is still in use.` } : { status: "error", error: String(e.message || e).slice(0, 500) });
  } finally { ACTIVE_CRAWLS.delete(id); }
}
// guess the type of website from strong signals only (structured data, URL patterns, title wording); "other" when unsure
export function detectBusinessType(pages) {
  const n = pages.length || 1, types = pages.flatMap(p => (p.schema_types || []).map(String));
  const has = re => types.some(t => re.test(t)), shareUrl = re => pages.filter(p => re.test(p.url)).length / n;
  const shareTitle = re => pages.filter(p => re.test(`${p.title || ""} ${(p.h1 || [])[0] || ""}`)).length / n;
  if (has(/^(MedicalBusiness|Physician|Hospital|Dentist|MedicalClinic|Pharmacy|MedicalOrganization)$/) || shareTitle(/\b(symptoms?|treatment|diagnos|clinic|doctor|patients?|therapy|medical|dental|dentist|disease)\b/i) >= 0.3) return "health";
  if (has(/^(FinancialService|BankOrCreditUnion|InsuranceAgency|AccountingService)$/) || shareTitle(/\b(loans?|mortgages?|insurance|invest(ing|ment)?|credit cards?|tax(es)?|pension|retirement|stocks?|crypto)\b/i) >= 0.3) return "finance";
  if (has(/^(LegalService|Attorney|Notary)$/) || shareTitle(/\b(lawyers?|attorneys?|law firm|legal advice|solicitors?)\b/i) >= 0.3) return "legal";
  if (has(/^(Product|ProductGroup|Offer|AggregateOffer)$/) && shareUrl(/\/(products?|collections?|shop|store)\//i) >= 0.1 || shareUrl(/\/(products?|collections?)\//i) >= 0.25) return "ecommerce";
  if (has(/^(LocalBusiness|Restaurant|CafeOrCoffeeShop|HomeAndConstructionBusiness|AutoRepair|BeautySalon|HealthClub|LodgingBusiness|Store|ProfessionalService)$/)) return "local";
  if (has(/^SoftwareApplication$/) || shareUrl(/\/(pricing|features?|integrations?)(\/|$)/i) > 0 && shareUrl(/\/(docs|documentation|api|changelog|releases)(\/|$)/i) > 0) return "saas";
  if (pages.filter(p => (p.schema_types || []).some(t => /^(Article|NewsArticle|BlogPosting)$/.test(t))).length / n >= 0.4 || shareUrl(/\/(blog|news|articles?|magazine)\//i) >= 0.5) return "publisher";
  return "other";
}

// a crawl left "crawling" by a closed tab: mark it so the site doesn't look stuck forever
async function healStale(s) {
  if (s && String(s.status).startsWith("crawling") && !ACTIVE_CRAWLS.has(s.id) && Date.now() - (s.crawl_beat || 0) > 20000) {   // progress beats arrive every few seconds while reading
    const has = (await pages(s.id)).length;
    return updateSite(s.id, has ? { status: "ready", notice: "The last read was interrupted (the tab was closed or reloaded). Your previous read is still in use. Read again to refresh it." }
      : { status: "error", error: "Reading was interrupted (the tab was closed or reloaded). Click Read again." });
  }
  return s;
}
export async function siteDetail(id) {
  const s = await healStale(await site(id)); if (!s) throw new GuardrailError("Site not found.");
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
  for (const k of ["month", "owner", "status", "title", "page_type", "intent", "stage", "notes"]) if (fields[k] !== undefined) it[k] = String(fields[k]).slice(0, k === "notes" ? 2000 : 200);
  if (fields.due !== undefined) { const d = String(fields.due || ""); if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new GuardrailError("Use a date like 2026-11-15."); it.due = d; if (d) it.month = d.slice(0, 7); }
  it.updated_at = Date.now(); it.edited_at = Date.now();
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
    const rv = hybridReviewer();
    if (rv) {
      progress("Researching what currently ranks (paid model's web search)…");
      try { serp = await ask("serp", P.serpResearch(s, keyword), { webSearch: true, maxSearches: 6, provider: rv }); if (serp && serp._no_search) serp = { searched: false, error: "The review model couldn't search the web." }; }
      catch (e) { serp = { searched: false, error: e.message }; }
    } else if (isFreeProvider()) {
      // free models can't search by themselves: search for them, then let the model analyse the real results
      if (!searchConfigured()) serp = { searched: false, error: "The free AI options can't search the web by themselves. Add a free Tavily search key in Settings to research what currently ranks." };
      else {
        progress("Searching the web for what currently ranks…");
        try { const sr = await webSearch(keyword, { n: 8 }); const label = SEARCH_PROVIDERS[sr.provider]?.label || sr.provider;
          if (!sr.results.length) serp = { searched: false, error: `${label} found no results for this search.` };
          else { progress(`Analysing ${sr.results.length} search results…`); serp = await ask("serp_results", P.serpFromResults(s, keyword, resultsBlock(sr.results), label)); serp.searched = true; serp.via = label; } }
        catch (e) { serp = { searched: false, error: e.message }; }
      }
    } else
    if (!getSettings().webSearch) serp = { searched: false, error: "Web search is turned off in Settings, so current rankings weren't researched." };
    else {
      progress("Researching what currently ranks (web search, about 30 seconds)…");
      try { serp = await ask("serp", P.serpResearch(s, keyword), { webSearch: true, maxSearches: 6 }); }
      catch (e) { serp = { searched: false, error: e.message }; }
      if (serp && serp._no_search) serp = { searched: false, error: "This model can't search the web, so current rankings weren't researched. Choose a model with web search in Settings." };
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
  // the main type follows the page type; ratings and prices are never added automatically (Google penalises invented ones)
  const T = { landing_page: "WebPage", category_page: "CollectionPage", service_page: "WebPage", location_page: "WebPage", news_article: "NewsArticle", product_page: "Product" }[pageType] || "Article";
  if (T === "Product") { const g0 = [{ "@type": "Product", name: payload.h1 || payload.title_tag, description: payload.meta_description, brand: { "@type": "Brand", name: s.name || base }, url },
      { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Home", item: base }, { "@type": "ListItem", position: 2, name: payload.h1 || "", item: url }] }];
    return { "@context": "https://schema.org", "@graph": g0, _note: "Add offers (price, availability) and real review data from your store before publishing to be eligible for product rich results." }; }
  const graph = [{ "@type": T, headline: payload.h1 || payload.title_tag, description: payload.meta_description,
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
// ---- writing helpers ----
export function detectLanguage(site, pages) {
  if (site.style?.language) return { code: "", name: site.style.language };
  const c = new Map(); for (const p of pages) { if (/^\/[a-z]{2}(-[a-z]{2})?\//i.test(new URL(p.url).pathname)) continue; const l = (p.lang || "").slice(0, 2).toLowerCase(); if (l) c.set(l, (c.get(l) || 0) + 1); }
  const code = [...c].sort((a, b) => b[1] - a[1])[0]?.[0] || "en";
  let name = code; try { name = new Intl.DisplayNames(["en"], { type: "language" }).of(code) || code; } catch { }
  return { code, name };
}
// fix what code can fix, before spending an AI call
export function autoFix(payload, validUrls) {
  const fixed = []; let md = payload.body_markdown || "";
  const host = (() => { try { return new URL([...validUrls][0]).host.replace(/^www\./, ""); } catch { return ""; } })();
  const vset = new Set([...validUrls].map(u => u.replace(/\/$/, "").toLowerCase()));
  // 1. only one H1: later H1s become H2s
  let h1seen = 0; md = md.replace(/^# (?!#)(.*)$/gm, (m, t) => (++h1seen > 1 ? (fixed.push("extra H1 turned into H2"), `## ${t}`) : m));
  // 2. links to pages that don't exist on the site: keep the words, drop the link
  if (host) md = md.replace(/(?<!!)\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (m, txt, url) => {
    let h = ""; try { h = new URL(url).host.replace(/^www\./, ""); } catch { }
    if (h === host && !vset.has(url.replace(/\/$/, "").split("#")[0].toLowerCase())) { fixed.push(`removed link to missing page ${url}`); return txt; } return m; });
  // 3. paragraphs repeated word for word: keep the first
  const seen = new Set(); md = md.split(/\n\n/).filter(para => { const n = para.trim().toLowerCase().replace(/\s+/g, " "); if (n.split(" ").length < 12 || /^\s*[#|]/.test(para)) return true; if (seen.has(n)) { fixed.push("removed a repeated paragraph"); return false; } seen.add(n); return true; }).join("\n\n");
  // 4. clean slug
  const slug = String(payload.slug || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").split("-").slice(0, 6).join("-");
  if (slug && slug !== payload.slug) fixed.push("cleaned the URL slug");
  // 5. FAQ list in sync with the FAQ section
  let faqs = payload.faqs || [];
  if (!faqs.length) { const sec = md.split(/^## .*(?:faq|frequently asked).*$/im)[1] || ""; faqs = [...sec.matchAll(/^### (.+)\n+([^#][\s\S]*?)(?=\n### |\n## |$)/gm)].map(m => ({ q: m[1].trim(), a: m[2].trim() })).slice(0, 8); if (faqs.length) fixed.push("filled the FAQ list from the FAQ section"); }
  return { payload: { ...payload, body_markdown: md, slug: slug || payload.slug, faqs }, fixed };
}
// merge a targeted repair into the page: replace changed sections, insert new ones before the FAQ
export function mergeSections(md, res) {
  const lines = md.split("\n"), secs = sections(md), out = { md, changed: 0 };
  let text = md;
  for (const sec of (res.sections || [])) {
    const body = String(sec.markdown || "").trim(); if (!body) continue;
    if (sec.heading === "__intro__") {
      const m = text.match(/^(# .*\n)([\s\S]*?)(?=^## )/m); if (m) { text = text.replace(m[0], `${m[1]}\n${body.replace(/^## .*\n?/, "").trim()}\n\n`); out.changed++; } continue;
    }
    const cur = sections(text).find(x => x.heading.trim().toLowerCase() === String(sec.heading).trim().toLowerCase());
    const full = /^## /.test(body) ? body : `## ${sec.heading}\n\n${body}`;
    const ls = text.split("\n");
    if (cur) { text = [...ls.slice(0, cur.start), ...full.split("\n"), "", ...ls.slice(cur.end + 1)].join("\n"); }
    else { const faq = sections(text).find(x => /faq|frequently asked/i.test(x.heading)); text = faq ? [...ls.slice(0, faq.start), ...full.split("\n"), "", ...ls.slice(faq.start)].join("\n") : text.trimEnd() + "\n\n" + full + "\n"; }
    out.changed++;
  }
  out.md = text.replace(/\n{3,}/g, "\n\n"); return out;
}
const evalOk = ev => ev && ["content_quality", "satisfaction", "task_completion", "ai_citation_readiness", "evidence"].every(k => Number.isFinite(Number(ev[k]?.score)));
async function evaluateSafely(prompt, provider = null) {
  let ev = await ask("evaluate", prompt, { provider });
  if (!evalOk(ev)) ev = await ask("evaluate", prompt + "\n\nIMPORTANT: your last answer was missing scores. Return EVERY field in the JSON, with numeric scores.", { provider });
  if (!evalOk(ev)) for (const k of ["content_quality", "satisfaction", "task_completion", "ai_citation_readiness", "evidence"]) { ev[k] = ev[k] || {}; if (!Number.isFinite(Number(ev[k].score))) { ev[k].score = 50; ev[k].estimated = true; } }
  return ev;
}
// ---------------- location pages: real local details, and protection against doorway pages ----------------
export function localDetails(notes) {
  return String(notes || "").split(/\n|;/).map(x => x.trim()).filter(x => x.length >= 4).slice(0, 20);
}
// one distinctive token per detail (a number, postcode or the longest word), so rephrasing still counts as "used"
export function localTerms(details) {
  return details.map(d => { const v = d.includes(":") ? d.slice(d.indexOf(":") + 1) : d;
    const num = v.match(/\b[A-Z]{1,2}\d[\dA-Z]?\s?\d[A-Z]{2}\b|\b\d{3,}\b|\b\d{1,2}[:.]\d{2}\b/i); if (num) return num[0];
    return (v.match(/[\p{L}\d'-]{4,}/gu) || []).sort((a, b) => b.length - a.length)[0] || v.trim(); }).filter(Boolean);
}
// share of 5-word sequences two pages have in common (0..1)
export function overlapShare(a, b) {
  const sh = t => { const w = String(t).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean), out = new Set(); for (let i = 0; i + 5 <= w.length; i++) out.add(w.slice(i, i + 5).join(" ")); return out; };
  const A = sh(a), B = sh(b); if (!A.size || !B.size) return 0; let n = 0; for (const x of A) if (B.has(x)) n++; return n / Math.min(A.size, B.size);
}

// ---------------- section-by-section writing ----------------
const wordsOf = t => (String(t || "").match(/[A-Za-z0-9\u00c0-\uffff']+/g) || []).length;
const toks = t => new Set(String(t || "").toLowerCase().split(/[^a-z0-9\u00c0-\uffff]+/).filter(w => w.length > 3));
const overlap = (a, b) => { const A = toks(a), B = toks(b); let n = 0; for (const w of A) if (B.has(w)) n++; return n; };
// give each section the internal links that fit it (max 2 each, max 8 total, only pages that exist)
export function allocateLinks(links, outline, validUrls) {
  const vset = new Set([...validUrls].map(u => u.replace(/\/$/, "").toLowerCase())), seen = new Set(), per = outline.map(() => []);
  const ok = (links || []).filter(l => l && l.url && vset.has(String(l.url).replace(/\/$/, "").toLowerCase()) && !seen.has(l.url) && seen.add(l.url)).slice(0, 8);
  let rr = 0;
  for (const l of ok) {
    let best = -1, score = 0;
    outline.forEach((o, i) => { const sc = overlap(l.placement || "", o.h2) * 2 + overlap(l.anchor || "", `${o.h2} ${o.notes || ""}`); if (sc > score && per[i].length < 2) { best = i; score = sc; } });
    if (best < 0) { for (let k = 0; k < outline.length; k++) { const i = (rr + k) % outline.length; if (per[i].length < 2) { best = i; rr = i + 1; break; } } }
    if (best >= 0) per[best].push({ url: l.url, anchor: l.anchor || "related guide" });
  }
  return per;
}
// quick checks on one section right after it's written: returns a fix instruction, or "" if it's fine
export function sectionProblems(md, sec, target, keyword) {
  const p = [], w = wordsOf(md), low = md.toLowerCase();
  if (w < target * 0.5) p.push(`it's too short (${w} words): expand it to about ${target} words with specific, practical detail`);
  const fill = FILLER_PHRASES.filter(f => low.includes(f)); if (fill.length) p.push(`remove filler phrases: ${fill.slice(0, 4).join(", ")}`);
  const stats = md.replace(/^#+ .*$/gm, "").split(/(?<=[.!?])\s+/).map(x => x.trim()).filter(x => /\d+(\.\d+)?\s?%/.test(x) && !/\]\(https?:|\[SOURCE|\[ADD DATA/i.test(x));
  if (stats.length) p.push(`these statistics have no source: replace them with [ADD DATA: ...] or [SOURCE NEEDED: ...] unless the publisher gave them: ${stats.slice(0, 2).map(x => `"${x.slice(0, 80)}"`).join("; ")}`);
  const kw = keyword.toLowerCase().trim(); if (kw && low.split(kw).length - 1 > 3) p.push(`"${keyword}" is repeated too often: use natural wording`);
  if ((md.match(PLACEHOLDER_RE_S) || []).length > 3) p.push("too many placeholders: keep at most 2 and write real content elsewhere");
  return p.join("; ");
}
const PLACEHOLDER_RE_S = /\[(ADD|SOURCE|SCREENSHOT|DATA|QUOTE|EXPERT|EXAMPLE)[^\]]*\]/g;
function normaliseSection(md, h2) {
  let t = String(md || "").trim();
  t = t.replace(/^#\s+.*\n+/, "");                                   // a stray H1
  if (!/^##\s/.test(t)) t = `## ${h2}\n\n${t}`;
  else t = t.replace(/^##\s+.*$/m, `## ${h2}`);                      // keep the planned heading exactly
  return t.replace(/\n{3,}/g, "\n\n");
}
// small models return outlines in odd shapes: strings, "## 1. Heading", duplicates, sub-points as strings
export function normaliseOutline(raw) {
  const seen = new Set(), out = [];
  for (let o of Array.isArray(raw) ? raw : []) {
    if (typeof o === "string") o = { h2: o };
    if (!o || typeof o !== "object") continue;
    const h2 = String(o.h2 || o.heading || o.title || "").replace(/^#+\s*/, "").replace(/^(\d+[.)]|[-*])\s+/, "").replace(/\*\*/g, "").trim();
    if (!h2 || h2.length > 120 || /^(introduction|intro|conclusion|faq|frequently asked questions?)$/i.test(h2) || seen.has(h2.toLowerCase())) continue;
    seen.add(h2.toLowerCase());
    const h3 = (Array.isArray(o.h3) ? o.h3 : typeof o.h3 === "string" ? o.h3.split(/;|\n/) : []).map(x => String(typeof x === "object" ? x.h3 || x.heading || "" : x).replace(/^#+\s*/, "").trim()).filter(Boolean).slice(0, 5);
    out.push({ h2, h3, notes: String(o.notes || o.description || "").slice(0, 500) });
  }
  return out.slice(0, 12);
}
// when the plan has too few usable links (small models often skip them or invent URLs), link sections to the most related real pages
function topUpLinks(per, outline, pages, keyword, intent, exclude = new Set()) {
  const used = new Set([...exclude, ...per.flat().map(l => l.url)]), kwMatch = new Set(findMatches(keyword, pages, 3).filter(m => m.same_intent && m.similarity >= 0.7).map(m => m.url));
  const anchorOf = m => String(m.title || "related guide").split(/\s[|\-–—]\s/)[0].slice(0, 60).trim() || "related guide";
  // pass 1: one link for each section that has none; pass 2: a second link where needed, until there are at least 4
  for (const [pass, min] of [[1, 0.2], [2, 0.12]]) for (let i = 0; i < outline.length && used.size - exclude.size < 4 + (pass === 1 ? 1 : 0); i++) {
    if (per[i].length >= pass) continue;
    const m = findMatches(`${outline[i].h2} ${keyword}`, pages, 8).find(x => !used.has(x.url) && !kwMatch.has(x.url) && x.similarity >= min);
    if (m) { used.add(m.url); per[i].push({ url: m.url, anchor: anchorOf(m) }); }
  }
  return per;
}
async function writeBySections({ s, kbUsed = new Set(), p, keyword, intent, b, author, valid, style, lang, notes, page_type, job, save, progress, count }) {
  const outline = normaliseOutline(b.outline); b.outline = outline;
  if (outline.length < 2) throw new GuardrailError("The page plan came back without enough sections. Try again, or choose another model.");
  const st = job.sbs || (job.sbs = { sections: {} });
  // 1. title, description, H1 and intro
  if (!st.meta) {
    progress("Writing the title and introduction (2/4)…");
    const m = await ask("page_meta", P.pageMeta(s, keyword, intent, b, author, style, lang), { maxTokens: 900 }); count();
    st.meta = { title_tag: String(m.title_tag || b.main_question || keyword).slice(0, 70), meta_description: String(m.meta_description || "").slice(0, 170),
      slug: m.slug || keyword, h1: String(m.h1 || b.main_question || keyword).replace(/^#+\s*/, ""), intro: String(m.intro || b.direct_answer || "").replace(/^#+.*\n/gm, "").trim() };
    await save({ sbs: st });
  }
  b.h1 = st.meta.h1;
  // 2. each section, with its own links and an instant quality check
  let per = allocateLinks(b.internal_links, outline, valid);
  if (per.flat().length < 3) per = topUpLinks(per, outline, p, keyword, intent);
  st.links = per;
  const total = Math.round((SEO.min_words[page_type] || 900) * 1.25), target = Math.max(150, Math.min(450, Math.round(total / outline.length)));
  for (let i = 0; i < outline.length; i++) {
    if (st.sections[i]) continue;
    const sec = outline[i], prev = i ? String(st.sections[i - 1] || "").split(/\n\n/).filter(x => !/^\s*[#|-]/.test(x)).pop() || "" : st.meta.intro.split(/\n\n/)[0];
    progress(`Writing section ${i + 1} of ${outline.length}: ${sec.h2.slice(0, 60)} (2/4)…`);
    const kbs = s.id ? await KB.knowledgeFor(s.id, `${sec.h2} ${sec.notes || ""} ${keyword}`, { k: 3, budgetWords: isFreeProvider() ? 380 : 600 }) : { text: "", sources: [] };
    kbs.sources.forEach(t => kbUsed.add(t));
    const sSec = kbs.text ? { ...s, knowledge: kbs.text } : { ...s, knowledge: "" };
    const ask1 = (fix, cur) => askText("section", P.section(sSec, keyword, intent, b, sec, i, prev.slice(-300), per[i], target, notes, style, lang, fix, cur), { maxTokens: Math.round(target * 2.6) + 300 });
    let r = await ask1(null, ""); count(); let md = normaliseSection(r.text, sec.h2);
    const probs = sectionProblems(md, sec, target, keyword) + (r.truncated ? "; it was cut off: finish it, a little shorter" : "");
    if (probs) { progress(`Improving section ${i + 1} of ${outline.length} (2/4)…`); r = await ask1(probs, md); count(); const md2 = normaliseSection(r.text, sec.h2); if (wordsOf(md2) >= wordsOf(md) * 0.6) md = md2; }
    // make sure its planned links are in it
    for (const l of per[i]) if (!md.includes(l.url)) md += `\n\nFor more on this, see [${l.anchor}](${l.url}).`;
    st.sections[i] = md; await save({ sbs: st });
  }
  // 3. FAQ
  if (!st.faq) {
    progress("Writing the FAQ (2/4)…");
    const qs = (b.faqs || []).map(q => typeof q === "string" ? q : q.q).filter(Boolean).slice(0, 6);
    const r = await askText("faq", P.faqSection(s, keyword, qs.length ? qs : [`What is ${keyword}?`, `How long does it take?`, `What do I need to get started?`], b, style, lang), { maxTokens: 1400 }); count();
    st.faq = /^##\s/.test(r.text) ? r.text.replace(/^##\s+.*$/m, "## Frequently asked questions") : `## Frequently asked questions\n\n${r.text}`;
    await save({ sbs: st });
  }
  // 4. assemble
  const body = [`# ${st.meta.h1}`, st.meta.intro, ...outline.map((_, i) => st.sections[i]), st.faq].filter(Boolean).join("\n\n").replace(/\n{3,}/g, "\n\n");
  const faqs = [...st.faq.matchAll(/^### (.+)\n+([^#][\s\S]*?)(?=\n### |\n## |$)/gm)].map(m => ({ q: m[1].trim(), a: m[2].trim() })).slice(0, 8);
  return { title_tag: st.meta.title_tag, meta_description: st.meta.meta_description, slug: st.meta.slug, h1: st.meta.h1, direct_answer: st.meta.intro.split(/\n\n/)[0],
    body_markdown: body, faqs, internal_links: per.flat(), secondary_keywords: b.secondary_keywords || [], image_suggestions: [], proof_placeholders: [], ai_disclosure: "", cta: b.cta || "", written_by_sections: true };
}
// repair for section-by-section pages: rewrite only the sections with problems (max 3), one at a time
async function repairBySections({ s, keyword, intent, b, payload, val, ev, fixes, style, lang, notes, page_type, progress, count, round }) {
  const md = payload.body_markdown, secs = sections(md).filter(x => !/faq|frequently asked/i.test(x.heading)), lines = md.split("\n");
  const text = x => lines.slice(x.start, x.end + 1).join("\n");
  const want = new Map(); const add = (i, why) => { if (i < 0) return; want.set(i, [...(want.get(i) || []), why]); };
  // sections named in the fix list
  for (const f of fixes) secs.forEach((x, i) => { if (x.heading.length > 6 && f.toLowerCase().includes(x.heading.toLowerCase())) add(i, f); });
  // sections with deterministic problems (filler, unsourced stats, repetition, long paragraphs)
  for (const h of highlights(md, keyword)) { const i = secs.findIndex(x => text(x).toLowerCase().includes(String(h.text).toLowerCase().slice(0, 50))); if (i >= 0) add(i, h.message); }
  // keyword repeated too often: rewrite the sections that use it most
  if (val.checks.some(c => c.id === "repetition" && c.status === "fail")) {
    const kw = keyword.toLowerCase(); [...secs.keys()].map(i => [i, text(secs[i]).toLowerCase().split(kw).length - 1]).filter(x => x[1] > 1).sort((a, b2) => b2[1] - a[1]).slice(0, 2)
      .forEach(([i, n]) => add(i, `the exact phrase "${keyword}" appears ${n} times: use it at most once and use natural variations instead`));
  }
  // too short overall: expand the shortest sections
  if (val.checks.some(c => c.id === "length" && c.status === "fail")) [...secs.keys()].sort((a, b2) => wordsOf(text(secs[a])) - wordsOf(text(secs[b2]))).slice(0, 2).forEach(i => add(i, "expand it with more specific detail (about 40% longer)"));
  // what the searcher still lacks: give it to the most related section
  const missing = [...(ev?.satisfaction?.missing || []), ...(ev?.question_coverage || []).filter(q => q.status === "missing").map(q => `answer: ${q.question}`)].slice(0, 4);
  for (const m of missing) { let best = secs.length - 1, sc = -1; secs.forEach((x, i) => { const o = overlap(m, x.heading + " " + text(x).slice(0, 400)); if (o > sc) { sc = o; best = i; } }); add(best, `cover this, which readers still lack: ${m}`); }
  const pick = [...want.entries()].sort((a, b2) => b2[1].length - a[1].length).slice(0, 3);
  let out = md, changed = 0;
  for (const [i, why] of pick) {
    const x = sections(out).filter(y => !/faq|frequently asked/i.test(y.heading))[i]; if (!x) continue;
    const ls = out.split("\n"), cur = ls.slice(x.start, x.end + 1).join("\n"), sec = (b.outline || []).find(o => o.h2 === x.heading) || { h2: x.heading, notes: "" };
    const target = Math.max(150, Math.round(wordsOf(cur) * (why.some(w => /expand|longer|short/.test(w)) ? 1.4 : 1)));
    progress(`Improving “${x.heading.slice(0, 50)}”, round ${round} (3/4)…`);
    const r = await askText("section", P.section(s, keyword, intent, b, sec, i, "", [], target, notes, style, lang, [...new Set(why)].join("; "), cur), { maxTokens: Math.round(target * 2.6) + 300 }); count();
    const nu = normaliseSection(r.text, x.heading);
    if (wordsOf(nu) < wordsOf(cur) * 0.6) continue;   // a worse rewrite is ignored
    // keep links that were in the old version
    let fixed = nu; for (const m of cur.matchAll(/(?<!!)\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g)) if (!fixed.includes(m[2])) fixed += `\n\nFor more on this, see [${m[1]}](${m[2]}).`;
    out = [...ls.slice(0, x.start), ...fixed.split("\n"), "", ...ls.slice(x.end + 1)].join("\n").replace(/\n{3,}/g, "\n\n"); changed++;
  }
  // too few internal links: add links to related real pages (no AI needed)
  if (val.checks.some(c => c.id === "internal_links" && c.status === "fail")) {
    const have = new Set([...out.matchAll(/(?<!!)\]\((https?:\/\/[^)\s]+)\)/g)].map(m => m[1]));
    const secsNow = sections(out).filter(y => !/faq|frequently asked/i.test(y.heading)), per = topUpLinks(secsNow.map(() => []), secsNow.map(x => ({ h2: x.heading })), b._pages || [], keyword, intent, have);
    let ls = out.split("\n"), added = 0;
    for (let i = secsNow.length - 1; i >= 0; i--) for (const l of per[i]) if (!have.has(l.url) && have.size + added < 5) {
      const x = secsNow[i]; ls.splice(x.end + 1, 0, "", `For more on this, see [${l.anchor}](${l.url}).`); added++;
    }
    if (added) { out = ls.join("\n").replace(/\n{3,}/g, "\n\n"); changed++; }
  }
  let meta = {};
  if (fixes.some(f => /title tag|meta description/i.test(f))) {
    progress(`Fixing the title and description, round ${round} (3/4)…`);
    const m = await ask("page_meta", P.pageMeta(s, keyword, intent, b, "", style, lang), { maxTokens: 900 }); count();
    meta = { ...(m.title_tag ? { title_tag: m.title_tag } : {}), ...(m.meta_description ? { meta_description: m.meta_description } : {}) };
  }
  return { payload: { ...payload, body_markdown: out, ...meta }, changed };
}

// fact-checking for free models: list the claims, search for each, judge each claim against the real results
export async function factCheckFree(keyword, body, progress = () => {}, count = () => {}) {
  progress("Finding the facts to check (4/4)…");
  const list = await ask("claims_list", P.claimsList(keyword, body), { maxTokens: 1500 }); count();
  const out = [], items = (list.claims || []).filter(c => c && c.claim && body.includes(String(c.claim).slice(0, 40))).slice(0, 6);
  for (const [k, c] of items.entries()) {
    if (c.own_product) { out.push({ claim: c.claim, status: "needs_publisher_data", source_url: "", note: "Only you can confirm this about your product.", correction: "" }); continue; }
    progress(`Checking fact ${k + 1} of ${items.length} with web search (4/4)…`);
    let sr; try { sr = await webSearch(c.query || c.claim, { n: 4 }); } catch (e) { out.push({ claim: c.claim, status: "unsupported", note: `Search failed: ${e.message}`, correction: "" }); continue; }
    if (!sr.results.length) { out.push({ claim: c.claim, status: "unsupported", note: "No search results.", correction: "" }); continue; }
    const j = await ask("claim_judge", P.claimJudge(c.claim, resultsBlock(sr.results)), { maxTokens: 600 }); count();
    const okUrl = sr.results.some(r => r.url === j.source_url);   // only accept sources that were really in the results
    const status = ["supported", "false", "outdated", "unsupported"].includes(j.status) && (okUrl || j.status === "unsupported") ? j.status : "unsupported";
    const downgraded = status === "unsupported" && j.status !== "unsupported";
    out.push({ claim: c.claim, status, source_url: okUrl ? j.source_url : "", source_tier: Number(j.source_tier) || 3,
      note: downgraded ? "The AI cited a source that wasn't in the search results, so it was ignored." : j.note || "",
      correction: downgraded || (status === "unsupported" && !/\[SOURCE NEEDED/.test(j.correction || "")) ? `${c.claim} [SOURCE NEEDED: a reliable source for this]` : j.correction || "" });
  }
  const summary = { total: out.length }; for (const c of out) summary[c.status] = (summary[c.status] || 0) + 1;
  return { claims: out, summary, via: SEARCH_PROVIDERS[(getSettings().search || {}).provider || "tavily"]?.label };
}

export async function verifyWithKnowledge(id, claims) {
  if (!claims || !Array.isArray(claims.claims)) return claims;
  const num = t => (String(t).match(/\d[\d.,]*%?/g) || []).map(x => x.replace(/,/g, ""));
  for (const c of claims.claims) {
    if (!["needs_publisher_data", "unsupported"].includes(c.status)) continue;
    const hits = await KB.search(id, c.claim, 3), fs = await KB.facts(id);
    const cand = [...hits.map(h => ({ text: h.text, title: h.title })), ...fs.map(f => ({ text: `${f.label} ${f.value}`, title: "Quick facts" }))];
    const nums = num(c.claim), toks = tokens(c.claim);
    const match = cand.find(x => { const xt = new Set(tokens(x.text)), shared = toks.filter(t => xt.has(t)).length / (toks.length || 1);
      return nums.every(n => num(x.text).includes(n)) && (nums.length ? shared >= 0.35 : shared >= 0.6); });
    const was = c.status, sm = claims.summary = claims.summary || {};
    if (match) { c.status = "supported"; c.source_url = ""; c.source_tier = 1; c.note = `Confirmed by your knowledge base (“${match.title}”).`; c.correction = "";
      sm[was] = Math.max(0, (sm[was] || 0) - 1); sm.supported = (sm.supported || 0) + 1; continue; }
    // same statement but different numbers: the page most likely contradicts the business's own data
    if (!nums.length) continue;
    let best = null, bestShared = 0;
    for (const x of cand) for (const sent of String(x.text).split(/(?<=[.!?])\s+|\n+/)) {
      const st = new Set(tokens(sent)), shared = toks.filter(t => st.has(t)).length / (toks.length || 1), sn = num(sent);
      if (sn.length && shared > bestShared && !nums.some(n => sn.includes(n))) { best = { sent: sent.trim(), title: x.title }; bestShared = shared; }
    }
    if (best && bestShared >= 0.5) { c.status = "false"; c.source_url = ""; c.source_tier = 1; c.note = `Your knowledge base (“${best.title}”) says: “${best.sent.slice(0, 160)}”`;
      c.correction = best.sent.replace(/^[-*]\s*/, "").slice(0, 300); sm[was] = Math.max(0, (sm[was] || 0) - 1); sm.false = (sm.false || 0) + 1; }
  }
  return claims;
}

// checkpoints: a failed step can resume instead of starting over
const JOB = id => `genjob:${id}`;
export async function checkpoint(id) { return store.get(JOB(id), null); }
export async function dropCheckpoint(id) { return store.del(JOB(id)); }

export async function generate(id, args, progress = () => {}) {
  startMeter();
  try { return await generateInner(id, args, progress); } finally { stopMeter(); }
}
async function generateInner(id, args, progress) {
  let { keyword, intent, page_type, audience = "", notes = "", author = "", override_duplicate = false, verify_claims = true, resume = false } = args;
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
  const bt = BUSINESS_TYPES[s.business_type];
  if (bt?.ymyl) { verify_claims = true; warnings.push(`${bt.label} is a "Your Money or Your Life" topic: before publishing, have a qualified professional review the page and name them with their credentials, and check every fact. Fact-checking is always on for this website.`); }
  // the business's own knowledge for this page: facts plus the most relevant passages (smaller budget for free models)
  const kbAll = await KB.knowledgeFor(id, `${keyword} ${notes}`, { k: isFreeProvider() ? 5 : 8, budgetWords: isFreeProvider() ? 800 : 1600 });
  const sK = kbAll.text ? { ...s, knowledge: kbAll.text } : s, kbUsed = new Set(kbAll.sources);
  let locTerms = [];
  if (page_type === "location_page") {
    const det = localDetails(notes);
    if (det.length < 3) throw new GuardrailError("Location pages need real local details, or Google treats them as doorway pages. In “Anything the page should include”, add at least three, one per line: the address, opening hours, the local team, nearby projects or customers, parking, the area served…");
    locTerms = localTerms(det);
    const recentLoc = all.filter(c => c.page_type === "location_page" && Date.now() - c.created_at < 30 * 864e5).length;
    if (recentLoc >= 5) warnings.push(`${recentLoc + 1} location pages in 30 days. Only create them for real branches or genuinely local service, each with its own local details.`);
  }
  const structure = structureFor(keyword, intent, page_type), style = s.style || null, lang = detectLanguage(s, p), valid = p.map(x => x.url);
  if (lang.name && !/^english/i.test(lang.name)) warnings.push(`Written in ${lang.name}, the main language of your site. Change it under Writing style.`);
  // resume from a checkpoint for the same keyword and settings
  let job = resume ? await checkpoint(id) : null;
  if (!job || job.keyword !== keyword || job.page_type !== page_type || job.intent !== intent) job = { keyword, intent, page_type, step: 0, rounds: [], started: Date.now() };
  else warnings.push(`Resumed from step ${job.step} after an interruption.`);
  const save = async patch => { Object.assign(job, patch, { at: Date.now() }); await store.set(JOB(id), job); };
  const calls = { ai: 0 }; const ask2 = (...a) => { calls.ai++; return ask(...a); };
  // hybrid mode: the free model writes; a paid model plans (optional), reviews, repairs and fact-checks
  const reviewer = hybridReviewer(), planner = reviewer && hybridSettings().plan ? reviewer : null;
  if (reviewer) warnings.push(`Hybrid mode: written by ${PROVIDERS[getSettings().provider].label.split(" (")[0]}, ${planner ? "planned, " : ""}reviewed${verify_claims ? ", fact-checked" : ""} and repaired by ${PROVIDERS[reviewer].label.split(" (")[0]}.`);
  // 1+2. plan the page and model the searcher in ONE call
  if (job.step < 2) {
    progress("Understanding the searcher and planning the page (1/4)…");
    const saved = (await keywords(id)).find(k => k.keyword === keyword.toLowerCase());
    const serp = saved?.check?.serp?.searched ? saved.check.serp : null;
    if (serp) warnings.push("Using your keyword check's research on what currently ranks.");
    const b = await ask2("brief", P.brief(sK, p, keyword, intent, page_type, audience, notes, matches, null, structure, serp, lang), { provider: planner });
    const sat = b.searcher || {}; delete b.searcher;
    await save({ step: 2, b, sat });
  }
  const b = job.b, sat = job.sat;
  if (sat.best_format && !["guide", "explainer"].includes(sat.best_format) && sat.format_reason) warnings.push(`Best format for this searcher: ${sat.best_format}. ${sat.format_reason}`);
  const outline = normaliseOutline(b.outline).map(o => o.h2);
  // 3. write: whole page at once, or section by section (automatic for free models, or by choice in Writing style)
  const mode = style?.write_mode || "auto", bySections = mode === "sections" || (mode === "auto" && isFreeProvider());
  if (bySections) warnings.push("Written section by section, so each part gets the model's full attention.");
  if (job.step < 3) {
    let payload;
    if (bySections) payload = await writeBySections({ s: sK, kbUsed, p, keyword, intent, b, author, valid, style, lang, notes, page_type, job, save, progress, count: () => calls.ai++ });
    else { progress("Writing the page (2/4)…"); payload = await ask2("article", P.article(sK, keyword, intent, page_type, b, author, valid, null, null, style, lang), { maxTokens: 16000 }); }
    await save({ step: 3, payload });
  }
  let payload = job.payload, val, ev, g; const rounds = job.rounds || [], autoFixed = [];
  // 4. check -> fix (code first, then targeted AI repair; full rewrite only for structural problems)
  const maxRounds = reviewer ? Math.min(2, RELEASE_GATE.max_repair_rounds) : RELEASE_GATE.max_repair_rounds;   // each paid review re-reads the whole page
  for (let r = rounds.length + 1; r <= maxRounds; r++) {
    progress(`Checking quality, round ${r} (3/4)…`);
    const af = autoFix(payload, valid); payload = af.payload; autoFixed.push(...af.fixed);
    val = check(payload, keyword, page_type, new Set(valid), author, { outline, localTerms: locTerms });
    ev = await evaluateSafely(P.evaluate(keyword, intent, sat, sK, payload.body_markdown || "", matches), reviewer); calls.ai++;
    g = gate(val, ev, null, same.length > 0);
    const prevRound = rounds[rounds.length - 1];
    rounds.push({ round: r, status: g.status, scores: g.scores, spam_risk: g.spam_risk, fails: val.fails, warns: val.warns });
    const sum = x => Object.values(x || {}).reduce((t, v) => t + (Number(v) || 0), 0);
    if (prevRound && val.fails >= prevRound.fails && val.warns >= (prevRound.warns ?? val.warns) && sum(g.scores) <= sum(prevRound.scores) + 1) {
      rounds[rounds.length - 1].note = "no further improvement, stopped repairing"; await save({ payload, rounds, ev }); break;
    }
    await save({ payload, rounds, ev });
    if (g.status === "ready_for_human_review" || r === maxRounds) break;
    const fixes = fixList(val, ev); if (!fixes.length) break;
    const structural = val.checks.some(c => c.status === "fail" && ["h2", "length"].includes(c.id));
    if (reviewer && !structural) {
      // hybrid: the paid model sees the whole page and fixes only the flagged sections
      progress(`Fixing ${fixes.length} issues in the affected sections (paid model), round ${r} (3/4)…`);
      const res = await ask2("repair_sections", P.repairSections(sK, keyword, intent, payload.body_markdown || "", fixes, valid, style, lang), { maxTokens: 8000, provider: reviewer });
      const m = mergeSections(payload.body_markdown || "", res);
      payload = { ...payload, body_markdown: m.md, ...(res.title_tag ? { title_tag: res.title_tag } : {}), ...(res.meta_description ? { meta_description: res.meta_description } : {}), ...((res.faqs || []).length ? { faqs: res.faqs } : {}) };
      rounds[rounds.length - 1].repair = `${m.changed} section${m.changed === 1 ? "" : "s"} fixed by the paid model${res.summary ? `: ${res.summary}` : ""}`;
      if (!m.changed && !res.title_tag && !res.meta_description) { await save({ payload, rounds }); break; }   // nothing changed: don't pay to re-review the same page
    } else if (bySections) {
      Object.defineProperty(b, "_pages", { value: p, enumerable: false, configurable: true });
      const rr = await repairBySections({ s: sK, keyword, intent, b, payload, val, ev, fixes, style, lang, notes, page_type, progress, count: () => calls.ai++, round: r });
      payload = rr.payload; rounds[rounds.length - 1].repair = `${rr.changed} section${rr.changed === 1 ? "" : "s"} improved`;
      if (!rr.changed && !fixes.some(f => /title tag|meta description/i.test(f))) { await save({ payload, rounds }); break; }   // nothing more a rewrite can fix
    } else if (structural) {
      progress(`Rewriting the page to fix its structure, round ${r} (3/4)…`);
      payload = await ask2("article", P.article(sK, keyword, intent, page_type, b, author, valid, fixes, payload.body_markdown || "", style, lang), { maxTokens: 16000 });
      rounds[rounds.length - 1].repair = "full rewrite";
    } else {
      progress(`Fixing ${fixes.length} issues in the affected sections only, round ${r} (3/4)…`);
      const res = await ask2("repair_sections", P.repairSections(sK, keyword, intent, payload.body_markdown || "", fixes, valid, style, lang), { maxTokens: 8000 });
      const m = mergeSections(payload.body_markdown || "", res);
      payload = { ...payload, body_markdown: m.md, ...(res.title_tag ? { title_tag: res.title_tag } : {}), ...(res.meta_description ? { meta_description: res.meta_description } : {}), ...((res.faqs || []).length ? { faqs: res.faqs } : {}) };
      rounds[rounds.length - 1].repair = `${m.changed} section${m.changed === 1 ? "" : "s"} rewritten${res.summary ? `: ${res.summary}` : ""}`;
    }
    await save({ payload, rounds });
  }
  let claims = null;
  if (verify_claims) {
    progress("Fact-checking claims with web search (4/4)…");
    if (reviewer) claims = await ask2("claims", P.claims(keyword, payload.body_markdown || ""), { webSearch: true, provider: reviewer });
    else if (isFreeProvider()) claims = searchConfigured() ? await factCheckFree(keyword, payload.body_markdown || "", progress, () => calls.ai++) : { _no_search: true };
    else claims = await ask2("claims", P.claims(keyword, payload.body_markdown || ""), { webSearch: true });
    if (claims && !claims._no_search) claims = await verifyWithKnowledge(id, claims);
    if (claims && claims._no_search) { claims = null; warnings.push("Fact-checking needs web search. Add a free Tavily search key in Settings (the free AI options can't search by themselves), or switch to Claude, ChatGPT or Gemini."); }
    if (claims) { let body = payload.body_markdown || "", applied = 0; const sm = claims.summary = claims.summary || {};
    for (const c of claims.claims || []) if (["false", "outdated", "unsupported"].includes(c.status) && c.claim && c.correction && body.includes(c.claim)) {
      body = body.replace(c.claim, c.correction); applied++;
      sm[c.status] = Math.max(0, (sm[c.status] || 0) - 1); const to = c.correction.includes("[SOURCE") ? "needs_publisher_data" : "supported"; sm[to] = (sm[to] || 0) + 1; c.status = "corrected";
    }
    claims.corrections_applied = applied; payload.body_markdown = body; }
  }
  const af = autoFix(payload, valid); payload = af.payload; autoFixed.push(...af.fixed);
  val = check(payload, keyword, page_type, new Set(valid), author, { outline, localTerms: locTerms });
  g = gate(val, ev, claims?.summary, same.length > 0);
  // doorway protection: a location page that mostly repeats another location page must not be published
  if (page_type === "location_page") {
    const others = all.filter(c => c.page_type === "location_page" && c.payload?.body_markdown);
    const worst = others.map(c => ({ c, share: overlapShare(payload.body_markdown || "", c.payload.body_markdown) })).sort((a, b) => b.share - a.share)[0];
    if (worst && worst.share > 0.5) { g.status = "do_not_publish"; g.blocking_reasons = [...(g.blocking_reasons || []), `${Math.round(worst.share * 100)}% of the text is the same as the location page “${worst.c.title || worst.c.keyword}”. Near-identical location pages are doorway pages in Google's eyes: rewrite it around this location's own details.`]; }
  }
  payload.schema_jsonld = buildSchema(s, payload, author, page_type);
  // the generated structured data is checked with the same rules as the site check
  try { for (const o of (payload.schema_jsonld?.["@graph"] || [payload.schema_jsonld]).filter(Boolean)) { const v = SCHEMA.validate(o); for (const e of v.errors) warnings.push(`Structured data (${v.type}): ${e}.`); } } catch { }
  payload.html = mdToHtml(payload.body_markdown || "");
  if (autoFixed.length) warnings.push(`Fixed automatically: ${[...new Set(autoFixed)].slice(0, 6).join("; ")}.`);
  const il = val.checks.find(c => c.id === "internal_links");
  if (il && il.status === "fail") warnings.push(`Only a few of the pages read from your site relate closely to this topic, so the page has fewer than 3 internal links. Read more of your website (Websites → Read again with a higher page count), or add links to related pages in the Edit tab.`);
  if (ev && ["content_quality", "satisfaction"].some(k => ev[k]?.estimated)) warnings.push("The AI's quality review came back incomplete, so some scores are estimates. Use Re-review with AI.");
  const used = Object.fromEntries(Object.entries(meterPeek()).map(([k, v]) => [k, v]));
  const tot = Object.values(used).reduce((t, v) => t + v.input + v.output, 0), paidTok = Object.entries(used).filter(([k]) => !PROVIDERS[k]?.keyless && k !== "mock").reduce((t, [, v]) => t + v.input + v.output, 0);
  const W = 5, cost = v => v.input + W * v.output;   // rough price weighting: writing (output) costs ~5x reading (input)
  const paidCost = Object.entries(used).filter(([k]) => !PROVIDERS[k]?.keyless && k !== "mock").reduce((t, [, v]) => t + cost(v), 0);
  const freeCost = Object.entries(used).filter(([k]) => PROVIDERS[k]?.keyless).reduce((t, [, v]) => t + cost(v), 0);
  const hybrid = reviewer ? { writer: getSettings().provider, reviewer, planner: !!planner, used, paid_share: tot ? Math.round(100 * paidTok / tot) : 0,
    est_saving: paidCost + freeCost ? Math.round(100 * freeCost / (paidCost + freeCost)) : 0,
    paid_output_share: (() => { const o = Object.values(used).reduce((t, v) => t + v.output, 0), po = Object.entries(used).filter(([k]) => !PROVIDERS[k]?.keyless).reduce((t, [, v]) => t + v.output, 0); return o ? Math.round(100 * po / o) : 0; })() } : null;
  if (kbUsed.size || kbAll.facts) warnings.push(`Used your knowledge base: ${kbAll.facts ? `${kbAll.facts} quick facts` : ""}${kbAll.facts && kbUsed.size ? " and " : ""}${kbUsed.size ? `passages from ${[...kbUsed].slice(0, 6).map(t => `“${t}”`).join(", ")}` : ""}.`);
  else warnings.push("No knowledge base for this website yet. Adding product details, case studies and quick facts (Knowledge base in the menu) gives the AI real proof to use, so pages need fewer placeholders.");
  const report = { knowledge: { sources: [...kbUsed], facts: kbAll.facts || 0 }, satisfaction_model: sat, structure, brief: b, matches, warnings, validation: val, evaluation: ev, claims, gate: g, rounds, status: g.status, language: lang.name, ai_calls: calls.ai, hybrid, usage: used,
    note: "Fill every placeholder with real proof and have the named author review before publishing." };
  const item = { id: store.newId(), keyword, intent, page_type, author, title: payload.title_tag || "", slug: payload.slug || "", payload, report, status: g.status, created_at: Date.now(),
    versions: [{ v: 1, at: Date.now(), source: "ai", note: "Written by AI", markdown: payload.body_markdown || "" }] };
  await rememberAuthor(author);
  // names and dates checked against Wikidata (best effort: at most 8 seconds, skipped in Demo mode or when offline)
  if (getSettings().provider !== "mock") try {
    progress("Checking names and dates against Wikidata…");
    const wk = await Promise.race([WIKI.checkPage(payload.body_markdown || "", (lang && lang.code) || "en"), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000))]);
    item.report.wikidata = { looked: wk.looked, checks: wk.checks, at: Date.now() };
    for (const c of wk.checks) item.report.warnings = [...(item.report.warnings || []), `Wikidata check: “${c.sentence.slice(0, 110)}” says ${c.says}, but Wikidata says ${c.wikidata}. Check which is right.`];
  } catch { }
  await store.set(`contents:${id}`, [item, ...all]);
  await dropCheckpoint(id);
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
  const reviewer = hybridReviewer();
  const kbR = await KB.knowledgeFor(id, keyword, { k: 6, budgetWords: 1200 }), sK = kbR.text ? { ...s, knowledge: kbR.text } : s;
  const [ev, au] = await Promise.all([
    ask("evaluate", P.evaluate(keyword, intent, saved?.check?.satisfaction || {}, sK, draft, matches), { provider: reviewer }),
    ask("audit", P.audit(sK, p, keyword, draft, matches), { provider: reviewer }),
  ]);
  let claims = null;
  if (verify_claims) { progress("Fact-checking claims with web search…");
    claims = reviewer ? await ask("claims", P.claims(keyword, draft), { webSearch: true, provider: reviewer })
      : isFreeProvider() ? (searchConfigured() ? await factCheckFree(keyword, draft, progress) : { _no_search: true }) : await ask("claims", P.claims(keyword, draft), { webSearch: true });
    if (claims && !claims._no_search) claims = await verifyWithKnowledge(id, claims);
    if (claims && claims._no_search) claims = { claims: [], summary: { total: 0 }, skipped: "Fact-checking needs web search. Add a free Tavily search key in Settings, or use Claude, ChatGPT or Gemini." }; }
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
const AUDIT_CACHE = new WeakMap();   // per page list; reused while pages, ignored issues and Google data are unchanged
export async function auditFor(id) {
  const s = await site(id), p = await pages(id); if (!p.length) throw new GuardrailError("Read the website first.");
  const ign = await ignoredIssues(id), imps = await gscImports(id), key = `${s.summary?.crawl_id || ""}|${ign.length}|${ign[0]?.at || ""}|${imps[0]?.id || ""}`;
  const c = AUDIT_CACHE.get(p); if (c && c.key === key) return structuredClone(c.v);
  const v = techaudit.run(s, p, { ignored: new Set(ign.map(x => x.check + "|" + x.url)), traffic: await trafficMap(id) });
  AUDIT_CACHE.set(p, { key, v }); return structuredClone(v);
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
  q.analysis = { ...res, at: Date.now() }; q.updated_at = Date.now(); await store.set(`aiq:${id}`, qs); return q.analysis;
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
  const analysis = gsc.analyse(rows, prev), ex = gsc.extras(rows, prev, { brandTerms: terms, updates: await googleUpdates() });
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
  // copies: display fields must not leak into stored records
  const kws = (await keywords(id)).map(k => ({ ...k })), imps = await gscImports(id), gq = new Map();
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
  // slow pages: real-visitor problems first (what Google ranks on), then poor lab scores
  const sp = await SPEED.get(id);
  for (const r of (sp?.pages || []).filter(x => x.strategy === "mobile")) {
    const poorField = r.field && ["lcp", "inp", "cls"].filter(m => SPEED.rate(m, r.field[m]) === "poor");
    const what = poorField && poorField.length ? poorField.map(m => ({ lcp: `loads its main content in ${(r.field.lcp / 1000).toFixed(1)} s`, inp: `reacts to clicks in ${Math.round(r.field.inp)} ms`, cls: `shifts around while loading (CLS ${r.field.cls.toFixed(2)})` }[m])).join(", ") : r.score != null && r.score < 50 ? `scores ${r.score}/100 on Google's mobile speed test` : "";
    if (!what) continue;
    const top = r.opportunities[0];
    out.push({ fingerprint: fp("speed", r.url), link: { view: "tech", tab: "speed" }, source: "Page speed", priority: poorField && poorField.length ? "P1" : "P2", type: "speed",
      title: `Speed up ${r.url.replace(/^https?:\/\/[^/]+/, "") || "/"}: it ${what} for mobile visitors`,
      detail: top ? `Biggest fix: ${top.title} (saves about ${(top.savings_ms / 1000).toFixed(1)} s). ${top.how}` : "Open Site health → Speed for the details.", urls: [r.url], impact: poorField && poorField.length ? "real visitors affected" : "lab test", effort: "medium" });
  }
  // important pages missing from Google, and pages where Google ignores your canonical
  const ix = await IDX.get(id);
  for (const c of (ix?.changes || []).filter(c => c.kind === "dropped" && Date.now() - c.at < 30 * 864e5).slice(0, 5))
    out.push({ fingerprint: fp("dropped", c.url), link: { view: "tech", tab: "index" }, source: "In Google", priority: "P1", type: "index",
      title: `Dropped out of Google: ${c.url.replace(/^https?:\/\/[^/]+/, "") || "/"}`, detail: `It was “${c.from}” and is now “${c.to}” (since ${new Date(c.at).toISOString().slice(0, 10)}). Open Site health → In Google for what it means and the fix.`, urls: [c.url], impact: "page lost from Google", effort: "medium" });
  for (const r of (ix?.results || [])) {
    if (r.status === "problem") out.push({ fingerprint: fp("index", r.url), link: { view: "tech", tab: "index" }, source: "In Google", priority: "P1", type: "index",
      title: `Not in Google: ${r.url.replace(/^https?:\/\/[^/]+/, "") || "/"} (${r.coverage})`, detail: `${r.meaning} ${r.fix}`, urls: [r.url], impact: "page can't get Google traffic", effort: "medium" });
    else if (r.canonical_mismatch) out.push({ fingerprint: fp("canon", r.url), link: { view: "tech", tab: "index" }, source: "In Google", priority: "P2", type: "index",
      title: `Google chose a different main page for ${r.url.replace(/^https?:\/\/[^/]+/, "") || "/"}`, detail: `Your canonical: ${r.user_canonical}. Google's choice: ${r.google_canonical}. Make sure the page you want to rank is the canonical, and that the two pages aren't near-duplicates.`, urls: [r.url], impact: "ranking split", effort: "low" });
  }
  // links to other websites that are broken or now lead somewhere else
  const ex = await store.get(`extlinks:${id}`, null);
  for (const l of (ex?.results || []).filter(x => ["domain", "broken", "removed"].includes(x.verdict)).slice(0, 10))
    out.push({ fingerprint: fp("ext", l.url), link: { view: "tech", tab: "ext" }, source: "External links", priority: l.verdict === "domain" ? "P1" : "P2", type: "ext",
      title: `${l.verdict === "domain" ? "Link now leads to a different website" : l.verdict === "removed" ? "Linked page was removed" : "Broken link"}: ${l.url.replace(/^https?:\/\//, "").slice(0, 70)}`,
      detail: `${l.text} It's on ${l.pages.length} page${l.pages.length > 1 ? "s" : ""}, e.g. ${l.pages[0]}. Replace it with a working source or remove it.`, urls: l.pages.slice(0, 20), impact: l.verdict === "domain" ? "possible spam link" : "broken link", effort: "low" });
  // near-duplicate pages and duplicate titles
  if (p.length >= 5) { const du = DUPES.analyse(p, { clicks: new Map() });
    for (const g of du.groups.filter(g => g.action.kind !== "handled").slice(0, 6))
      out.push({ fingerprint: fp("dupe", g.pages.map(x => x.url).sort().join("|")), link: { view: "tech", tab: "dupes" }, source: "Duplicate content", priority: "P2", type: "dupes",
        title: `${g.pages.length} pages are ${g.similarity}% the same: ${g.pages.slice(0, 2).map(x => x.url.replace(/^https?:\/\/[^/]+/, "") || "/").join(", ")}${g.pages.length > 2 ? "…" : ""}`, detail: g.action.text, urls: g.pages.map(x => x.url), impact: "pages compete with each other", effort: "medium" });
    const dt = du.titles.filter(t => t.urls.length >= 2);
    if (dt.length) out.push({ fingerprint: fp("duptitles", String(dt.length)), link: { view: "tech", tab: "dupes" }, source: "Duplicate content", priority: "P2", type: "dupes",
      title: `${dt.length} title${dt.length > 1 ? "s are" : " is"} used on more than one page`, detail: `For example “${dt[0].text.slice(0, 60)}” on ${dt[0].urls.length} pages. Give each page its own title so Google can tell them apart.`, urls: dt.flatMap(t => t.urls).slice(0, 20), impact: "unclear pages", effort: "low" }); }
  // structured data errors (each problem type once, with the pages it affects)
  const sc = await store.get(`schemacheck:${id}`, null);
  for (const pr of (sc?.problems || []).filter(x => x.level === "error").slice(0, 8))
    out.push({ fingerprint: fp("schema", pr.key), link: { view: "tech", tab: "schema" }, source: "Structured data", priority: pr.type === "JSON-LD" ? "P1" : "P2", type: "schema",
      title: `${pr.type === "JSON-LD" ? "Broken structured data" : `${pr.type} structured data`}: ${pr.message.replace(/“[^”]*”/g, "").replace(/\s*\(like [^)]*\)/, "").replace(/\s+/g, " ").slice(0, 90)} (${pr.pages.length} page${pr.pages.length > 1 ? "s" : ""})`,
      detail: `Fix it so the page can show as a rich result in Google. For example on ${pr.pages[0]}.`, urls: pr.pages.slice(0, 20), impact: "rich results", effort: "low" });
  // redirect problems after a migration (pages with Google traffic first)
  const mg = await store.get(`migration:${id}`, null);
  for (const r of (mg?.checks?.results || []).filter(r => !["ok", "skipped"].includes(r.verdict)).sort((a, b) => (b.clicks || 0) - (a.clicks || 0)).slice(0, 10))
    out.push({ fingerprint: fp("redirect", r.url), link: { view: "migration" }, source: "Site migration", priority: r.clicks > 0 || ["loop", "dead", "missing"].includes(r.verdict) ? "P1" : "P2", type: "migration",
      title: `Redirect problem: ${r.url.replace(/^https?:\/\/[^/]+/, "") || "/"} (${r.verdict})`, detail: `${r.text}${r.clicks ? ` This page had ${r.clicks} Google clicks.` : ""}`, urls: [r.url], impact: r.clicks ? `${r.clicks} clicks at risk` : "redirect", effort: "low" });
  // competitors' new pages on your keywords where you have no page (last 14 days)
  for (const c of await competitors(id)) for (const h of (c.history || []).filter(h => h.at > Date.now() - 14 * 864e5))
    for (const x of (h.added || []).filter(x => x.overlap?.kind === "keyword_gap").slice(0, 5))
      out.push({ fingerprint: fp("comp", x.url), link: { view: "competitors" }, source: "Competitors", priority: "P2", type: "competitor",
        title: `${c.name} published “${x.title.slice(0, 70)}” on your keyword “${x.overlap.keyword}”`, detail: `You don't have a page for this yet. Check the keyword to see what ranks and whether a page of your own is worth it.`, urls: [x.url], impact: "competitor gap", effort: "medium" });
  // pages losing Google clicks month after month
  const dc = await DECAY.get(id);
  for (const d of (dc?.pages || []).filter(d => d.level !== "early" && d.lost >= 10).slice(0, 8))
    out.push({ fingerprint: fp("decay", d.url), link: { view: "gsc", section: "decay" }, source: "Content decay", priority: d.decline >= 50 ? "P1" : "P2", type: "decay",
      title: `Refresh ${d.url.replace(/^https?:\/\/[^/]+/, "") || "/"}: Google clicks down ${d.decline}% since ${d.peak_label}`, detail: `${d.peak} → ${d.last} clicks a month. ${d.causes.map(c => c.text).join(". ")}${d.causes.length ? "." : ""} Open Performance → Content decay to see the searches it lost.`, urls: [d.url], impact: `${d.lost} clicks a month lost`, effort: "medium" });
  // AI-answer readiness: blocked answer bots (urgent) and high-traffic pages that are hard to quote
  { const ar = await aiReadinessGet(id);
    if (ar) { const bl = ar.bots.filter(b => b.kind === "search" && !b.allowed);
      if (bl.length) out.push({ fingerprint: fp("aibots", bl.map(b => b.agent).join(",")), link: { view: "aivis" }, source: "AI answers", priority: "P1", type: "aibots", title: `robots.txt blocks ${bl.map(b => b.agent).join(", ")}`, detail: "These fetch pages to cite them in AI answers; blocking them keeps you out of those answers. Allow them in robots.txt (training bots can stay blocked).", urls: [], impact: "AI citations", effort: "low" });
      for (const p of ar.pages.filter(p => p.score < 45 && p.clicks >= 20).slice(0, 3)) out.push({ fingerprint: fp("aiready", p.url), link: { view: "aivis" }, source: "AI answers", priority: "P3", type: "aiready", title: `Make ${p.url.replace(/^https?:\/\/[^/]+/, "") || "/"} easier for AI answers to quote (score ${p.score})`, detail: p.checks.filter(c => !c.ok).map(c => c.fix).join(" "), urls: [p.url], impact: "AI citations", effort: "medium" }); } }
  // images: broken ones, and very heavy ones
  { const im = await imagesGet(id);
    if (im) { const br = im.images.filter(i => i.issues.some(x => x.kind === "broken")), hv = im.images.filter(i => i.bytes > 1024 * 1024);
      if (br.length) out.push({ fingerprint: fp("imgbroken", String(br.length)), link: { view: "tech", tab: "images" }, source: "Images", priority: "P2", type: "images", title: `${br.length} image${br.length > 1 ? "s don't" : " doesn't"} load`, detail: br.slice(0, 5).map(i => `${i.src.split("/").pop()} on ${i.pages[0].replace(/^https?:\/\/[^/]+/, "") || "/"}`).join("; "), urls: br.flatMap(i => i.pages).slice(0, 10), impact: "broken images", effort: "low" });
      if (hv.length) out.push({ fingerprint: fp("imgheavy", String(hv.length)), link: { view: "tech", tab: "images" }, source: "Images", priority: "P2", type: "images", title: `${hv.length} image${hv.length > 1 ? "s are" : " is"} over 1 MB`, detail: `Compress them and use WebP or AVIF: ${hv.slice(0, 4).map(i => `${i.src.split("/").pop()} (${(i.bytes / 1048576).toFixed(1)} MB)`).join(", ")}.`, urls: hv.flatMap(i => i.pages).slice(0, 10), impact: "page speed", effort: "low" });
      if (im.counts.alt_missing >= 3) out.push({ fingerprint: fp("imgalt", String(im.counts.alt_missing)), link: { view: "tech", tab: "images" }, source: "Images", priority: "P3", type: "images", title: `${im.counts.alt_missing} images in your content have no alt text`, detail: "Alt text helps image search and accessibility. Site health → Images can write suggestions.", urls: [], impact: "image search, accessibility", effort: "low" }); } }
  // sitemaps and robots.txt
  { const sm = await sitemapCheckGet(id);
    if (sm) { if (sm.blocked.length) out.push({ fingerprint: fp("smblocked", String(sm.blocked.length)), link: { view: "tech", tab: "sitemaps" }, source: "Sitemaps", priority: "P1", type: "sitemaps", title: `robots.txt blocks Google from ${sm.blocked.length} important page${sm.blocked.length > 1 ? "s" : ""}`, detail: sm.blocked.slice(0, 4).map(b => `${b.url.replace(/^https?:\/\/[^/]+/, "") || "/"} (${b.rule})`).join("; "), urls: sm.blocked.map(b => b.url).slice(0, 10), impact: "pages can't appear in Google", effort: "low" });
      if (sm.missing_count) out.push({ fingerprint: fp("smmissing", String(sm.missing_count)), link: { view: "tech", tab: "sitemaps" }, source: "Sitemaps", priority: "P2", type: "sitemaps", title: `${sm.missing_count} important page${sm.missing_count > 1 ? "s are" : " is"} missing from your sitemaps`, detail: sm.missing.slice(0, 5).map(m => m.url.replace(/^https?:\/\/[^/]+/, "") || "/").join(", "), urls: sm.missing.map(m => m.url).slice(0, 10), impact: "discovery", effort: "low" });
      if (sm.bad_count) out.push({ fingerprint: fp("smbad", String(sm.bad_count)), link: { view: "tech", tab: "sitemaps" }, source: "Sitemaps", priority: "P2", type: "sitemaps", title: `${sm.bad_count} sitemap entr${sm.bad_count > 1 ? "ies point" : "y points"} to redirects, errors or excluded pages`, detail: "List only pages you want in Google, at their final address. Site health → Sitemaps has a fixes file for your developer.", urls: sm.bad.map(b => b.url).slice(0, 10), impact: "crawl efficiency", effort: "low" });
      if (sm.total >= 50 && sm.dates.with < sm.total * 0.5) out.push({ fingerprint: fp("smlastmod", String(sm.total)), link: { view: "tech", tab: "sitemaps" }, source: "Sitemaps", priority: "P3", type: "sitemaps", title: "Add last-changed dates (lastmod) to your sitemaps", detail: `${sm.dates.with} of ${sm.total} entries have one. Google uses them to decide which pages to re-read after changes.`, urls: [], impact: "faster re-crawling of updated pages", effort: "medium" });
      for (const g of (sm.google?.sitemaps || []).filter(x => x.errors > 0).slice(0, 2)) out.push({ fingerprint: fp("smgerr", g.path), link: { view: "tech", tab: "sitemaps" }, source: "Sitemaps", priority: "P2", type: "sitemaps", title: `Google found ${g.errors} error${g.errors > 1 ? "s" : ""} in ${g.path.replace(/^https?:\/\/[^/]+/, "")}`, detail: "Open Search Console → Sitemaps to see them.", urls: [], impact: "discovery", effort: "low" }); } }
  // calendar cards past their due date
  { const today = new Date().toISOString().slice(0, 10), over = (await planItems(id)).filter(c => c.due && c.due < today && c.stage !== "published");
    if (over.length) out.push({ fingerprint: fp("caloverdue", String(over.length)), link: { view: "calendar" }, source: "Calendar", priority: "P2", type: "calendar",
      title: `${over.length} calendar item${over.length > 1 ? "s are" : " is"} overdue`, detail: over.slice(0, 5).map(c => `${c.title || c.keyword} (due ${c.due}${c.owner ? `, ${c.owner}` : ""})`).join("; "), urls: [], impact: "deadlines", effort: "low" }); }
  // Google Analytics: lots of visitors, few conversions
  { const ga = await GA4.report(id), an = ga ? GA4.analyse(ga, (await gscImports(id))[0]?.rows || []) : null;
    for (const pgx of (an?.improve || []).slice(0, 3)) out.push({ fingerprint: fp("ga4improve", pgx.path), link: { view: "gsc", section: "analytics" }, source: "Google Analytics", priority: "P2", type: "ga4",
      title: `Improve ${pgx.path}: ${pgx.sessions.toLocaleString("en-US")} visits but only ${(pgx.rate * 100).toFixed(1)}% convert`, detail: `The site average is ${(an.avg_rate * 100).toFixed(1)}%. Check the page answers what searchers want and has a clear next step near the top.`, urls: [], impact: "conversions", effort: "medium" }); }
  // link plans saved from Site health → Links: a to-do per page until its links exist
  { const plans = await linkPlans(id), links = new Set(); for (const pp of p) for (const l of pp.links_out || []) links.add(`${String(pp.url).replace(/\/$/, "")}>${String(l).replace(/\/$/, "")}`);
    for (const pl of plans) { const left = pl.links.filter(l => !links.has(`${pl.from}>${l.to}`)); if (!left.length) continue;
      out.push({ fingerprint: fp("linkplan", pl.from), link: { view: "tech", tab: "links" }, source: "Internal links", priority: "P2", type: "links",
        title: `Add ${left.length} link${left.length > 1 ? "s" : ""} on ${pl.from.replace(/^https?:\/\/[^/]+/, "") || "/"}`,
        detail: left.map(l => `Link “${l.anchor}” to ${l.to.replace(/^https?:\/\/[^/]+/, "") || "/"}${l.sentence ? ` in: “${l.sentence.slice(0, 90)}…”` : ""}`).join(" · "), urls: [pl.from], impact: "internal links", effort: "low" }); } }
  // orphan pages that matter: nothing links to them, but they get Google traffic or are substantial
  const found0 = s?.summary?.urls_discovered || 0;
  if (p.length >= 5 && (!found0 || p.length / found0 >= 0.8)) { const lm = LINKS.build(p, (await gscImports(id))[0]?.rows || []);
    for (const r of lm.rows.filter(r => r.url !== lm.home && r.inbound === 0 && (r.clicks > 0 || r.words >= 600)).sort((a, b) => b.clicks - a.clicks).slice(0, 8))
      out.push({ fingerprint: fp("orphan", r.url), link: { view: "tech", tab: "links" }, source: "Internal links", priority: r.clicks > 0 ? "P1" : "P2", type: "links",
        title: `No page links to ${r.url.replace(/^https?:\/\/[^/]+/, "") || "/"}`, detail: `Pages nobody links to are found and valued less by Google${r.clicks ? `, yet this one already gets ${r.clicks} Google clicks` : ""}. Add links to it from related pages (Site health → Links suggests where).`, urls: [r.url], impact: r.clicks ? "traffic page" : "orphan", effort: "low" }); }
  // Bing crawl errors on pages (Bing also powers ChatGPT search and Copilot)
  const bg = await BING.get(id), bad = (bg?.issues || []).filter(x => x.http >= 400);
  const bper = bg ? BING.period(bg.daily) : null;
  if (bper && bper.clicks_change != null && bper.clicks_change <= -25 && bper.clicks >= 0) out.push({ fingerprint: fp("bingdrop", bper.to), link: { view: "gsc", section: "bing" }, source: "Bing", priority: "P2", type: "bing",
    title: `Bing clicks down ${-bper.clicks_change}% in the last 28 days`, detail: `${fmtNum(bper.clicks)} clicks from ${bper.from} to ${bper.to}. Compare pages in Performance → Bing (Bing vs Google), and check Bing's crawl errors. Bing also feeds ChatGPT search and Copilot.`, urls: [], impact: "Bing traffic", effort: "medium" });
  if (bad.length) out.push({ fingerprint: fp("bing", "errors"), link: { view: "gsc", section: "bing" }, source: "Bing", priority: bad.some(x => x.http >= 500) ? "P1" : "P2", type: "bing",
    title: `Bing found ${bad.length} page${bad.length > 1 ? "s" : ""} with errors`, detail: `For example ${bad.slice(0, 3).map(x => `${x.url} (${x.http})`).join(", ")}. Fix or redirect them; Bing's index also feeds ChatGPT search and Copilot.`, urls: bad.slice(0, 20).map(x => x.url), impact: "crawl errors", effort: "low" });
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
  const merged = out.map(r => { const o = byFp.get(r.fingerprint);
    if (!o) return { ...r, id: store.newId(), status: "open", created_at: now, updated_at: now };
    const changed = o.title !== r.title || o.detail !== r.detail || o.priority !== r.priority || o.status === "resolved";
    return { ...o, ...r, status: o.status === "resolved" ? "open" : o.status, updated_at: changed ? now : (o.updated_at || now) }; });   // only real changes get a new timestamp
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
  // a person's edit: wins over automatic rebuilds when teammates merge
  r.updated_at = Date.now(); r.edited_at = Date.now();
  await store.set(`recs:${id}`, all); return r;
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
  if (!last || last.markdown !== item.payload.body_markdown) { item.versions.push({ v: (last?.v || 0) + 1, at: Date.now(), source, note, markdown: item.payload.body_markdown });
    if ((item.signoffs || []).length) { item.signoffs_cleared = { at: Date.now(), count: item.signoffs.length }; item.signoffs = []; } }   // nobody signs off text they didn't see
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
  { const wf = await workflow(id), done = new Set((item.signoffs || []).map(x => x.step)), left = wf.steps.filter(st => !done.has(st.name));
    if (left.length) problems.push(`Approval steps still to sign off: ${left.map(st => st.name).join(", ")}.`);
    if (wf.resolve_first) { const open = (await commentsFor(id, cid)).filter(c => !c.parent && !c.resolved).length; if (open) problems.push(`${open} comment${open > 1 ? "s are" : " is"} still open (this website requires comments to be resolved before approval).`); } }
  if (item.source_id && !String(arguments[2].fluent || "").trim()) problems.push(`Name the fluent ${LANGS[item.lang] || item.lang} speaker who reviewed this version.`);
  if (problems.length) throw new GuardrailError("Not ready to approve yet: " + problems.join(" "));
  item.status = "approved"; item.approved = { by: reviewer.trim(), at: Date.now(), ...(item.source_id ? { fluent: String(arguments[2].fluent).trim() } : {}) }; item.updated_at = Date.now();
  all[i] = item; await store.set(`contents:${id}`, all);
  const live = item.url || (item.published?.status === "publish" ? item.published.link : "");
  if (live) await inowQueue(id, live, "approved after changes", item.versions?.length || 1);
  return item;
}
export async function getItem(id, cid) { const [all, i] = await loadItem(id, cid); return all[i]; }
export function fullHtml(item) {
  const x = item.payload, e = t => String(t || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>${e(x.title_tag)}</title>\n<meta name="description" content="${e(x.meta_description)}">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<script type="application/ld+json">\n${JSON.stringify(x.schema_jsonld || {}, null, 2).replace(/</g, "\\u003c")}\n</script>\n</head>\n<body>\n<article>\n${mdToHtml(x.body_markdown)}\n</article>\n</body>\n</html>\n`;
}

// ---------------- client reports: everything that happened on a website in a period ----------------
export async function reportData(id, { from, to } = {}) {
  const s = await site(id); to = Number(to) || Date.now(); from = Number(from) || to - 30 * 864e5;
  const inP = t => { const x = typeof t === "string" ? Date.parse(t.replace(" UTC", "Z").replace(" ", "T")) : Number(t); return x >= from && x <= to; };
  const out = { site: { name: s.name || s.url, url: s.url, type: BUSINESS_TYPES[s.business_type]?.label || "" }, period: { from, to }, generated_at: Date.now() };
  // site health
  try { const h = await siteHealth(id), hist = (h.history || []).map(x => ({ at: Date.parse(String(x.crawled_at).replace(" UTC", "Z").replace(" ", "T")), health: x.health, counts: x.counts })).filter(x => x.at);
    const before = [...hist].filter(x => x.at < from).pop() || hist.find(x => inP(x.at)) || null;
    out.health = { score: h.health_score, start: before ? before.health : null, pages: h.pages_checked, crawled_at: h.crawled_at, counts: h.counts,
      top: (h.issues || []).filter(i => ["error", "high"].includes(i.severity)).slice(0, 5).map(i => ({ label: i.label, count: i.count, severity: i.severity })),
      trend: hist.filter(x => x.at <= to).slice(-12).map(x => ({ at: x.at, health: x.health })) };
  } catch { out.health = null; }
  // Google search
  try { const g = await gscOverview(id), a = g.analysis;
    if (a) { const daily = (a.daily || []).filter(d => inP(Date.parse(d.date))), useDaily = daily.length >= 7 ? daily : a.daily || [];
      const sum = k => Math.round(useDaily.reduce((t, d) => t + (d[k] || 0), 0));
      out.google = { range: a.range, label: g.imports[0]?.label || "", in_period: daily.length >= 7, totals: daily.length >= 7 ? { clicks: sum("clicks"), impressions: sum("impressions") } : a.totals,
        all_totals: a.totals, change: a.change, daily: useDaily.map(d => ({ date: d.date, clicks: d.clicks })), top_queries: (a.top_queries || []).slice(0, 8).map(q => ({ query: q.query, clicks: q.clicks, impressions: q.impressions, position: q.position })),
        rising: (a.rising || []).slice(0, 5), falling: (a.falling || []).slice(0, 5), near_page_one: (a.striking_distance || []).length,
        updates: (a.impact || []).map(u => ({ name: u.name, start: u.start, before: u.before, after: u.after })) };
    } else out.google = null;
  } catch { out.google = null; }
  // AI answers
  try { const v = (await visOverview(id)).summary;
    out.ai = v && v.checks ? { checks: v.checks, questions: v.prompts, mention_rate: v.mention_rate, citation_rate: v.citation_rate, trend: (v.trend || []).filter(t => t.at <= to),
      share: (v.share_of_voice || []).slice(0, 6).map(x => ({ name: x.name, share: x.share, ours: x.ours })), sources: (v.sources || []).slice(0, 5) } : null;
  } catch { out.ai = null; }
  // content
  const cs = await contents(id);
  out.content = { written: cs.filter(c => inP(c.created_at)).map(c => ({ title: c.title || c.keyword, keyword: c.keyword, status: c.status, approved: !!c.approved })),
    approved: cs.filter(c => c.approved && inP(c.approved.at)).map(c => ({ title: c.title || c.keyword, by: c.approved.by, at: c.approved.at })), total: cs.length };
  try { const pv = await planView(id); out.plan = pv && pv.items ? { total: pv.items.length, by_status: pv.items.reduce((m, x) => (m[x.status || "planned"] = (m[x.status || "planned"] || 0) + 1, m), {}) } : null; } catch { out.plan = null; }
  // to-dos
  const rs = await recs(id), RANK = { high: 0, medium: 1, low: 2 };
  out.todos = { done: rs.filter(r => r.status === "done" && r.done_at && inP(r.done_at)).map(r => ({ title: r.title, priority: r.priority })),
    open: rs.filter(r => ["open", "in_progress"].includes(r.status)).length, open_high: rs.filter(r => ["open", "in_progress"].includes(r.status) && r.priority === "high").length,
    next: rs.filter(r => ["open", "in_progress"].includes(r.status)).sort((a, b) => (RANK[a.priority] ?? 3) - (RANK[b.priority] ?? 3)).slice(0, 5).map(r => ({ title: r.title, detail: r.detail || "", priority: r.priority, owner: r.owner || "", due: r.due || "" })) };
  // keywords
  try { const kt = await keywordTable(id); out.keywords = { total: kt.length, covered: kt.filter(k => k.coverage?.status === "covered").length, gaps: kt.filter(k => k.coverage?.status === "gap").length, added: kt.filter(k => inP(k.created_at || 0)).length }; } catch { out.keywords = null; }
  out.auto_summary = autoSummary(out);
  return out;
}
function autoSummary(d) {
  const L = [], pct = (a, b) => b ? Math.round(100 * (a - b) / b) : null;
  if (d.health) L.push(d.health.start != null && d.health.start !== d.health.score ? `Site health moved from ${d.health.start} to ${d.health.score} out of 100.` : `Site health is ${d.health.score} out of 100 across ${d.health.pages} pages checked.`);
  if (d.google) { const ch = d.google.change && d.google.change.clicks != null ? ` (${d.google.change.clicks > 0 ? "+" : ""}${d.google.change.clicks}% vs the previous period)` : "";
    L.push(`Google sent ${fmt(d.google.totals.clicks)} clicks from ${fmt(d.google.totals.impressions)} appearances in search${ch}.`);
    if (d.google.near_page_one) L.push(`${d.google.near_page_one} searches are close to page one and are the quickest traffic wins.`); }
  if (d.ai) L.push(`AI assistants mentioned the brand in ${d.ai.mention_rate}% of ${d.ai.checks} checked answers.`);
  if (d.content.written.length || d.content.approved.length) L.push(`${d.content.written.length} page${d.content.written.length === 1 ? " was" : "s were"} written and ${d.content.approved.length} approved for publishing.`);
  if (d.todos.done.length) L.push(`${d.todos.done.length} improvement${d.todos.done.length === 1 ? " was" : "s were"} completed; ${d.todos.open} remain open (${d.todos.open_high} high priority).`);
  return L.join(" ");
}
const fmt = n => Number(n || 0).toLocaleString("en-US");
export async function reportSummary(id, data) {
  const res = await ask("report_summary", P.reportSummary(data), { maxTokens: 1200 });
  return { summary: String(res.summary || "").trim(), highlights: (res.highlights || []).slice(0, 4), watch: (res.watch || []).slice(0, 3) };
}

// remember where a page was published (WordPress post id, links), so the next send updates it instead of creating a duplicate
export async function markPublished(id, cid, info) {
  const all = await contents(id), it = all.find(c => c.id === cid); if (!it) throw new GuardrailError("Page not found.");
  it.published = { platform: info.platform || "wordpress", id: info.id, status: info.status, link: info.link, edit_link: info.edit_link, site_url: info.site_url, post_type: info.post_type, at: Date.now(), by: info.by || "" };
  it.updated_at = Date.now(); await store.set(`contents:${id}`, all);
  if (info.status === "publish" && info.link) await inowQueue(id, info.link, "updated on WordPress", `${it.versions?.length || 1}:${Date.now() - (Date.now() % 60000)}`);
  return it.published;
}

// data from the Search Console connection replaces earlier connected imports (zip uploads are kept)
export async function gscSetApi(id, { cur, prev, range, prevRange }) {
  const f = d => new Date(d + "T00:00:00Z").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const others = (await gscImports(id)).filter(i => i.source !== "api");
  const mk = (rows, r, tag) => ({ id: store.newId(), label: `${f(r.from)} – ${f(r.to)}${tag}`, files: ["Search Console (connected)"], rows, source: "api", created_at: Date.now() });
  await store.set(`gsc:${id}`, [mk(cur, range, ""), ...(prev.length ? [mk(prev, prevRange, " (earlier period)")] : []), ...others].slice(0, 6));
  return { rows: cur.length, previous: prev.length };
}

// ---------------- weekly monitoring: "what changed" ----------------
export const monitorSettings = async () => ({ enabled: false, emails: [], only_changes: false, ...((await store.get("monitor-settings", null)) || {}) });
export async function saveMonitorSettings(b) {
  const emails = String(Array.isArray(b.emails) ? b.emails.join(",") : b.emails || "").split(/[\s,;]+/).map(e => e.trim().toLowerCase()).filter(e => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e)).slice(0, 20);
  const day = b.day === undefined || b.day === null || b.day === "" ? null : Math.max(0, Math.min(6, Number(b.day) || 0));
  const sites = Array.isArray(b.sites) ? b.sites.map(Number).filter(Boolean).slice(0, 100) : [];
  const v = { enabled: !!b.enabled, emails, only_changes: !!b.only_changes, day, sites, updated_at: Date.now() };
  await store.set("monitor-settings", v); return v;
}
export const monitorHistory = async id => (await store.get(`monitor:${id}`, [])) || [];
// the same check the weekly scheduled job runs, done here in the browser
export async function runMonitor(id, progress = () => {}, { fetchFn = null, gscFetch = null } = {}) {
  const s = await site(id), pg = (await pages(id)) || [];
  if (!pg.length) throw new GuardrailError("Read the website first, so there's something to compare with.");
  const imps = await gscImports(id), latest = imps[0]?.rows || [];
  const hist0 = await monitorHistory(id);
  const list = MON.baselines(MON.pickPages(pg, latest, 20), hist0[0]);
  progress(`Checking ${list.length} important pages…`);
  const f = fetchFn || (async url => { const { fetchPage } = await import("./crawler.js"); const r = await fetchPage(url, { retries: 1 }); return { status: r?.status || 0, final_url: r?.url, html: r?.body || "", error: r?.error }; });
  const pagesRes = await MON.checkPages(list, f, { concurrency: 6, budgetMs: 120000 });
  progress("Comparing Google traffic…");
  let google = null, googleSource = "";
  if (gscFetch) { try { const g = await gscFetch(); if (g) { google = MON.gscWeek(g.dates, g.queryNow, g.queryBefore); googleSource = "live"; } } catch (e) { googleSource = `couldn't refresh: ${e.message}`; } }
  if (!google && latest.length) { google = MON.gscWeek(latest.filter(r => r.kind === "date")); googleSource = googleSource || "last import"; }
  const hist = await monitorHistory(id), prevAt = hist[0]?.at || Date.now() - 7 * 864e5;
  const updates = (await googleUpdates()).filter(u => Date.parse(u.start) > prevAt - 864e5 || (u.ongoing && Date.parse(u.start) > Date.now() - 21 * 864e5)).map(u => ({ name: u.name, start: u.start, ongoing: !!u.ongoing }));
  const today = new Date().toISOString().slice(0, 10);
  const snap = { at: Date.now(), by: "browser", site: { name: s.name || s.url, url: s.url }, pages: pagesRes, google, google_source: googleSource, updates,
    pending_approval: (await contents(id)).filter(c => c.status === "ready_for_human_review").length,
    overdue: (await recs(id)).filter(r => ["open", "in_progress"].includes(r.status) && r.due && r.due < today).length };
  snap.summary = MON.summarise(snap);
  await store.set(`monitor:${id}`, [snap, ...hist].slice(0, 12));
  return snap;
}

// ---------------- localisation: versions of a page in other languages ----------------
const langOf = item => item.lang || detectLang(item.payload?.body_markdown || "");
export async function localKeywords(id, cid, { lang, market = "" }) {
  const [s] = await ctx(id), it = (await contents(id)).find(c => c.id === cid); if (!it) throw new GuardrailError("Page not found.");
  if (!LANGS[lang]) throw new GuardrailError("Choose a language.");
  const res = await ask("local_keywords", P.localKeywords(s, it, LANGS[lang], market), { webSearch: true, provider: hybridReviewer() });
  return { keywords: (res.keywords || []).filter(k => k && k.keyword).slice(0, 6), recommended: res.recommended || res.keywords?.[0]?.keyword || "", note: res.note || "", searched: !res._no_search };
}
export async function versions(id, cid) {
  const all = await contents(id), it = all.find(c => c.id === cid); if (!it) return [];
  const g = it.group_id || it.id;
  return all.filter(c => c.id === g || c.group_id === g).map(c => ({ id: c.id, lang: langOf(c), market: c.market || "", title: c.title || c.keyword, status: c.status,
    url: c.url || c.published?.link || "", approved: !!c.approved, source: !c.source_id }));
}
export async function setVersionUrl(id, cid, url) {
  const all = await contents(id), it = all.find(c => c.id === cid); if (!it) throw new GuardrailError("Page not found.");
  if (url && !/^https?:\/\/[^\s]+$/.test(url)) throw new GuardrailError("Enter the full page address, starting with https://");
  const changedUrl = url && url !== it.url;
  it.url = url || ""; it.updated_at = Date.now(); await store.set(`contents:${id}`, all);
  if (changedUrl && it.status === "approved") await inowQueue(id, url, "page address added", it.versions?.length || 1);
  return { ok: true };
}
// hreflang tags for a group: every version lists every version (Google requires the links to be reciprocal)
export function hreflangTags(vs) {
  const withUrl = vs.filter(v => v.url), src = vs.find(v => v.source) || vs[0];
  const code = v => (v.market && /^[A-Za-z]{2}$/.test(v.market) ? `${v.lang}-${v.market.toUpperCase()}` : v.lang);
  const lines = withUrl.map(v => `<link rel="alternate" hreflang="${code(v)}" href="${v.url}" />`);
  if (src && src.url) lines.push(`<link rel="alternate" hreflang="x-default" href="${src.url}" />`);
  return { tags: lines.join("\n"), missing: vs.filter(v => !v.url).length };
}
export async function localize(id, cid, { lang, market = "", keyword = "" }, progress = () => {}) {
  const [s, p] = await ctx(id), all = await contents(id), src = all.find(c => c.id === cid);
  if (!src) throw new GuardrailError("Page not found.");
  if (!LANGS[lang]) throw new GuardrailError("Choose a language.");
  if (!keyword.trim()) throw new GuardrailError("Choose or type the keyword people search for in that language.");
  if (src.status === "do_not_publish") throw new GuardrailError("Fix the original page first: the release gate says it shouldn't be published.");
  if (langOf(src) === lang) throw new GuardrailError(`This page is already in ${LANGS[lang]}.`);
  if (all.filter(c => Date.now() - c.created_at < 86400000).length >= GUARDRAILS.max_generations_per_site_per_day)
    throw new GuardrailError(`Daily limit of ${GUARDRAILS.max_generations_per_site_per_day} pages reached for this site (translations count too: mass-translated pages are scaled content in Google's eyes).`);
  const group = src.group_id || src.id;
  const existing = all.find(c => (c.id === group || c.group_id === group) && langOf(c) === lang && (c.market || "") === (market || ""));
  if (existing) { const e = new GuardrailError(`There's already a ${LANGS[lang]}${market ? ` (${market})` : ""} version of this page. Open it from Language versions instead of creating another.`); e.existing = existing.id; throw e; }
  const style = s.style || null, langName = LANGS[lang], reviewer = hybridReviewer();
  const kbAll = await KB.knowledgeFor(id, `${src.keyword} ${keyword}`, { k: 6, budgetWords: isFreeProvider() ? 600 : 1200 }), sK = kbAll.text ? { ...s, knowledge: kbAll.text } : s;
  const mode = style?.write_mode || "auto", bySections = mode === "sections" || (mode === "auto" && isFreeProvider());
  let res;
  if (bySections) {
    progress("Adapting the title and description (1/3)…");
    const meta = await ask("localize_meta", P.localizeMeta(sK, src, langName, market, keyword), { maxTokens: 800 });
    const md = String(src.payload?.body_markdown || ""), lines = md.split("\n"), secs = sections(md), parts = [];
    const firstH2 = secs.length ? secs[0].start : lines.length; parts.push(lines.slice(0, firstH2).join("\n"));
    for (const x of secs) parts.push(lines.slice(x.start, x.end + 1).join("\n"));
    const out = [];
    for (const [k, part] of parts.entries()) { if (!part.trim()) continue; progress(`Adapting section ${k + 1} of ${parts.length} (2/3)…`);
      out.push((await askText("localize_section", P.localizeSection(sK, langName, market, keyword, part, style), { maxTokens: 2600 })).text); }
    let body = out.join("\n\n"); if (meta.h1) body = body.replace(/^# .*$/m, `# ${meta.h1}`);
    res = { ...meta, body_markdown: body, changes: [], to_check: [] };
  } else {
    progress("Adapting the page (1/2)…");
    res = await ask("localize", P.localize(sK, src, langName, market, keyword, style), { maxTokens: 16000, provider: null });
  }
  let payload = { title_tag: String(res.title_tag || ""), meta_description: String(res.meta_description || ""), slug: res.slug || "", h1: res.h1 || "", body_markdown: String(res.body_markdown || "") };
  if (!payload.body_markdown.trim()) throw new GuardrailError("The AI returned an empty page. Try again.");
  payload.faqs = [...payload.body_markdown.matchAll(/^### (.+)\n+([^#][\s\S]*?)(?=\n### |\n## |$)/gm)].map(m => ({ q: m[1].trim(), a: m[2].trim() })).slice(0, 8);
  const valid = p.map(x => x.url), af = autoFix(payload, valid); payload = af.payload;
  progress(`Checking the ${langName} version (${bySections ? 3 : 2}/${bySections ? 3 : 2})…`);
  const val = check(payload, keyword, src.page_type, new Set(valid), src.author, { lang });
  const ev = await evaluateSafely(P.evaluate(keyword, src.intent, {}, sK, payload.body_markdown, []), reviewer);
  const g = gate(val, ev, null, false);
  payload.schema_jsonld = buildSchema(s, payload, src.author, src.page_type); payload.html = mdToHtml(payload.body_markdown);
  const localizeLeft = (payload.body_markdown.match(/\[LOCALIZE:[^\]]*\]/g) || []).length;
  const warnings = [`${langName} version of “${src.title || src.keyword}”. A fluent ${langName} speaker must review it before it can be approved.`,
    ...(localizeLeft ? [`${localizeLeft} [LOCALIZE] note${localizeLeft > 1 ? "s" : ""} to check with local knowledge.`] : []), ...(res.to_check || []).map(x => `To check: ${x}`)];
  src.group_id = group; src.lang = src.lang || langOf(src);
  const item = { id: store.newId(), keyword: keyword.trim(), intent: src.intent, page_type: src.page_type, author: src.author, title: payload.title_tag, slug: payload.slug, payload,
    report: { warnings, validation: val, evaluation: ev, gate: g, status: g.status, localization: { from: src.lang, to: lang, market, changes: res.changes || [], to_check: res.to_check || [], source_id: src.id }, rounds: [] },
    status: g.status, lang, market, group_id: group, source_id: src.id, created_at: Date.now(),
    versions: [{ v: 1, at: Date.now(), source: "ai", note: `Adapted from ${LANGS[src.lang] || src.lang}`, markdown: payload.body_markdown }] };
  await store.set(`contents:${id}`, [item, ...all]);
  return { id: item.id, status: item.status };
}

// ---------------- repurposing: one approved page -> other channels ----------------
// numbers in the new text that don't appear in the page are flagged, so invented statistics can't slip through
export function numberCheck(text, page) {
  const nums = t => (String(t).replace(/(^|\n)\s*\d+\/\s?/g, "$1").match(/\d[\d,.]*%?/g) || []).map(n => n.replace(/,/g, "").replace(/\.$/, ""));
  const inPage = new Set(nums(page));
  return [...new Set(nums(text))].filter(n => (n.endsWith("%") || n.replace("%", "").length >= 2 || n.includes(".")) && !inPage.has(n));
}
const xLen = t => String(t).replace(/https?:\/\/\S+/g, "x".repeat(23)).length;   // X counts every link as 23 characters
export async function repurpose(id, cid, { formats = Object.keys(P.REPURPOSE_FORMATS) } = {}) {
  const [s] = await ctx(id), all = await contents(id), it = all.find(c => c.id === cid);
  if (!it) throw new GuardrailError("Page not found.");
  if (it.status !== "approved") throw new GuardrailError("Approve the page first, so only checked facts are reused in other channels.");
  formats = formats.filter(f => P.REPURPOSE_FORMATS[f]); if (!formats.length) throw new GuardrailError("Choose at least one format.");
  const lang = it.lang || detectLang(it.payload?.body_markdown || ""), langName = LANGS[lang] || "English";
  const res = await ask("repurpose", P.repurpose(s, it, formats, s.style || null, langName), { maxTokens: 5000, provider: hybridReviewer() });
  const link = it.url || it.published?.link || "[ADD PAGE LINK]", body = it.payload?.body_markdown || "";
  const fill = t => String(t || "").replace(/\{link\}/g, link);
  const out = { at: Date.now(), link, formats: {} };
  const flag = (text, extra = []) => { const bad = numberCheck(text.replace(link, ""), body); return [...extra, ...(bad.length ? [`Numbers not found in the page: ${bad.join(", ")}. Check or remove them.`] : [])]; };
  if (formats.includes("linkedin") && res.linkedin) { const t = fill(res.linkedin.text); out.formats.linkedin = { text: t, chars: t.length, issues: flag(t, t.length > 3000 ? ["Over LinkedIn's 3,000-character limit."] : []) }; }
  if (formats.includes("x_thread") && res.x_thread) { const posts = (res.x_thread.posts || []).map(fill);
    out.formats.x_thread = { posts, issues: flag(posts.join("\n"), posts.map((p, i) => xLen(p) > 280 ? `Post ${i + 1} is ${xLen(p)} characters (limit 280).` : "").filter(Boolean)) }; }
  if (formats.includes("newsletter") && res.newsletter) { const n = res.newsletter, all2 = [n.subject, n.preview, n.body, n.cta].map(fill);
    out.formats.newsletter = { subject: all2[0], preview: all2[1], body: all2[2], cta: all2[3], issues: flag(all2.join("\n"), [...(all2[0].length > 70 ? ["Subject is long; aim for under 60 characters."] : [])]) }; }
  if (formats.includes("video_script") && res.video_script) { const v = res.video_script, scenes = (v.scenes || []).map(x => ({ seconds: Number(x.seconds) || 0, voiceover: fill(x.voiceover), on_screen: x.on_screen || "", show: x.show || "" }));
    const total = scenes.reduce((t, x) => t + x.seconds, 0);
    out.formats.video_script = { title: v.title || "", seconds: total, scenes, issues: flag(scenes.map(x => `${x.voiceover} ${x.on_screen}`).join("\n"), total > 120 ? [`${total} seconds: trim to under 90 for social video.`] : []) }; }
  if (formats.includes("snippets") && res.snippets) { const sn = (res.snippets || []).map(x => ({ text: fill(x.text), from: x.from || "" }));
    out.formats.snippets = { items: sn, issues: flag(sn.map(x => x.text).join("\n"), sn.filter(x => (x.text.match(/\S+/g) || []).length > 30).map(x => `Snippet too long: “${x.text.slice(0, 40)}…”`)) }; }
  it.repurposed = { ...(it.repurposed || {}), ...out, formats: { ...(it.repurposed?.formats || {}), ...out.formats } };
  it.updated_at = Date.now(); await store.set(`contents:${id}`, all);
  return it.repurposed;
}

// ---------------- chat: answers grounded in the website's own data ----------------
// conversations are personal: kept in this browser only (not synced with the team)
const CHAT = id => `chat:${id}`;
export const chatList = async id => ((await store.get(CHAT(id), [])) || []).map(c => ({ id: c.id, title: c.title, updated_at: c.updated_at, messages: c.messages.length }));
export const chatGet = async (id, chatId) => ((await store.get(CHAT(id), [])) || []).find(c => c.id === chatId) || null;
export async function chatDelete(id, chatId) { await store.set(CHAT(id), ((await store.get(CHAT(id), [])) || []).filter(c => c.id !== chatId)); return { ok: true }; }
const has = (q, re) => re.test(q);
// gather the data that matters for this question, numbered as sources, within a word budget
export async function chatContext(id, question, { budgetWords = 2500 } = {}) {
  const s = await site(id), q = String(question || "").toLowerCase(), sources = [], blocks = [];
  let used = 0;
  const add = (label, text, link = "") => { const w = countWordsLite(text); if (!text || used + w > budgetWords) return; sources.push({ n: sources.length + 1, label, link }); blocks.push(`[${sources.length}] ${label}${link ? ` (${link})` : ""}\n${text}`); used += w; };
  const health = await siteHealth(id).catch(() => null);
  add("Website overview", [`Website: ${s.name || ""} ${s.url}`, s.business_type ? `Type: ${BUSINESS_TYPES[s.business_type]?.label}` : "", s.product ? `Offers: ${s.product}` : "", s.audience ? `Audience: ${s.audience}` : "",
    `Pages read: ${s.page_count || 0}${s.summary?.urls_discovered ? ` of about ${s.summary.urls_discovered}` : ""}`, health ? `Site health: ${health.health_score}/100` : "", s.style ? `Brand style: ${JSON.stringify(s.style).slice(0, 400)}` : ""].filter(Boolean).join("\n"));
  // pages on the website that match the question
  const pg = await pages(id);
  for (const m of findMatches(question, pg, 4).filter(m => m.similarity >= 0.2)) { const p = pg.find(x => x.url === m.url);
    add(`Page: ${p?.title || m.title || m.url}`, `${(p?.excerpt || "").slice(0, 600)}${p ? `\n(${p.word_count} words, intent: ${p.intent || ""})` : ""}`, m.url); }
  // the knowledge base
  for (const h of await KB.search(id, question, 3)) add(`Knowledge base: ${h.title}${h.heading ? `, ${h.heading}` : ""}`, h.text.slice(0, 900));
  const facts = await KB.facts(id); if (facts.length) add("Quick facts", KB.factsText(facts).slice(0, 1200));
  // Google search data
  if (has(q, /google|search console|traffic|click|impression|rank|position|keyword|search|query|queries|seo|visit|tráfico|búsqueda|検索|順位/)) {
    try { const g = await gscOverview(id), a = g.analysis;
      if (a) add(`Google search data (${g.imports[0]?.label || ""})`, [`Totals: ${a.totals.clicks} clicks, ${a.totals.impressions} impressions, CTR ${a.totals.ctr}%, average position ${a.totals.position}`,
        a.change ? `Change vs previous period: clicks ${a.change.clicks}%, impressions ${a.change.impressions}%` : "",
        `Top searches: ${(a.top_queries || []).slice(0, 10).map(x => `${x.query} (${x.clicks} clicks, pos ${x.position})`).join("; ")}`,
        (a.striking_distance || []).length ? `Close to page one: ${a.striking_distance.slice(0, 8).map(x => `${x.query} (pos ${x.position})`).join("; ")}` : "",
        (a.falling || []).length ? `Falling: ${a.falling.slice(0, 6).map(x => `${x.query} (${x.change ?? ""})`).join("; ")}` : "",
        (a.low_ctr || []).length ? `Low click rate: ${a.low_ctr.slice(0, 5).map(x => x.query).join("; ")}` : ""].filter(Boolean).join("\n"));
      else add("Google search data", "No Search Console data imported yet."); } catch { }
  }
  if (has(q, /what happened|why did|drop|dropped|fell|spike|jump|increase|decrease|change|january|february|march|april|may|june|july|august|september|october|november|december|last month|this month|timeline/)) {
    const ann = await annotations(id); if (ann.length) add("Timeline (notes and events)", ann.slice(-25).map(n => `- ${n.date}: ${n.text}${n.impact != null ? ` (Google clicks ${n.impact >= 0 ? "+" : ""}${n.impact}% in the 14 days after)` : ""}`).join("\n"));
  }
  if (has(q, /conversion|convert|sign.?up|signups|sales|revenue|leads?|demo|purchase|key event|analytics|ga4|roi/)) {
    const ga = await GA4.report(id), an = ga ? GA4.analyse(ga, (await gscImports(id))[0]?.rows || []) : null;
    if (ga) add(`Google Analytics (last ${ga.days} days, ${ga.organic ? "organic search" : "all traffic"})`, [`Totals: ${ga.totals.sessions} sessions, ${Math.round(ga.totals.conversions)} key events (conversions), conversion rate ${(an.avg_rate * 100).toFixed(1)}%${ga.totals.revenue ? `, revenue ${Math.round(ga.totals.revenue)} ${ga.currency}` : ""}`,
      `Top converting pages: ${an.pages.slice(0, 8).map(p => `${p.path} (${Math.round(p.conversions)} conversions, ${(p.rate * 100).toFixed(1)}%)`).join("; ")}`,
      an.promote.length ? `Convert well but few visitors: ${an.promote.slice(0, 5).map(p => p.path).join(", ")}` : "", an.improve.length ? `Many visitors, few conversions: ${an.improve.slice(0, 5).map(p => p.path).join(", ")}` : ""].filter(Boolean).join("\n"));
    else add("Google Analytics", "Not connected. Connect it on the Performance screen to see conversions by page.");
  }
  if (has(q, /bing|copilot|chatgpt search|microsoft/)) {
    const bg = await BING.get(id), per = bg ? BING.period(bg.daily) : null;
    if (bg) add("Bing data", [per ? `Last 28 days: ${per.clicks} clicks, ${per.impressions} impressions${per.clicks_change != null ? ` (${per.clicks_change}% vs the 28 days before)` : ""}` : "",
      `Top Bing searches: ${bg.queries.slice(0, 10).map(x => `${x.query} (${x.clicks} clicks${x.position ? `, pos ${x.position}` : ""})`).join("; ")}`,
      bg.crawl ? `Bing crawl: ${bg.crawl.in_index} pages in index, ${bg.crawl.c4xx} 4xx and ${bg.crawl.c5xx} 5xx errors` : ""].filter(Boolean).join("\n"));
  }
  // site health
  if (health && has(q, /health|technical|broken|error|404|redirect|speed|index|crawl|issue|problem|fix|title|meta|h1|canonical|schema/))
    add("Site health", `Score ${health.health_score}/100 on ${health.pages_checked} pages.\n` + (health.issues || []).slice(0, 8).map(i => `- ${i.label}: ${i.count} pages (${i.severity})`).join("\n"));
  // to-dos
  if (has(q, /to-?do|task|priorit|first|next|should i|what to do|plan|quick win|focus|start/)) {
    const rs = (await recs(id)).filter(r => ["open", "in_progress"].includes(r.status)), R = { high: 0, medium: 1, low: 2 };
    if (rs.length) add("To-do list (open)", rs.sort((a, b) => (R[a.priority] ?? 3) - (R[b.priority] ?? 3)).slice(0, 10).map(r => `- [${r.priority}] ${r.title}${r.owner ? ` (owner: ${r.owner})` : ""}`).join("\n"));
  }
  // written pages
  if (has(q, /my pages|draft|written|approved|publish|content plan|pages i|article/)) {
    const cs = await contents(id); if (cs.length) add("Pages written in the tool", cs.slice(0, 12).map(c => `- ${c.title || c.keyword} (${c.status.replace(/_/g, " ")})`).join("\n"));
  }
  // AI answers
  if (has(q, /chatgpt|claude|gemini|perplexity|ai answer|ai assistant|mention|share of voice|llm|ai overview|visibility/)) {
    try { const v = (await visOverview(id)).summary; if (v && v.checks) add("AI answers", `Brand mentioned in ${v.mention_rate}% of ${v.checks} answers; linked in ${v.citation_rate}%.\nBrands named: ${(v.share_of_voice || []).slice(0, 6).map(x => `${x.name} ${x.share}%`).join(", ")}\nSites cited: ${(v.sources || []).slice(0, 5).map(x => x.domain).join(", ")}`); } catch { }
  }
  return { text: blocks.join("\n\n"), sources };
}
const countWordsLite = t => (String(t || "").match(/\S+/g) || []).length;
export async function chatSend(id, chatId, text) {
  text = String(text || "").trim(); if (!text) throw new GuardrailError("Type a message.");
  const [s] = await ctx(id), all = (await store.get(CHAT(id), [])) || [];
  let c = all.find(x => x.id === chatId);
  if (!c) { c = { id: store.newId(), title: text.slice(0, 60), messages: [], created_at: Date.now() }; all.unshift(c); }
  const free = isFreeProvider() && !hybridReviewer();
  const cx = await chatContext(id, text, { budgetWords: free ? 1200 : 3000 });
  const history = c.messages.slice(-10).map(m => `${m.role === "user" ? "USER" : "ASSISTANT"}: ${String(m.content).slice(0, free ? 600 : 1500)}`).join("\n\n");
  const r = await askText("chat", P.chat(s, cx.text, history, text, free), { maxTokens: free ? 900 : 2000 });
  const cited = new Set([...r.text.matchAll(/\[(\d+)\]/g)].map(m => +m[1]));
  c.messages.push({ role: "user", content: text, at: Date.now() }, { role: "assistant", content: r.text, at: Date.now(), sources: cx.sources.filter(x => cited.has(x.n)), all_sources: cx.sources.length });
  c.updated_at = Date.now();
  await store.set(CHAT(id), [c, ...all.filter(x => x.id !== c.id)].slice(0, 50));
  return c;
}

// ---------------- page speed ----------------
// the pages worth testing: the homepage, then the pages Google sends the most visitors to
export async function speedTargets(id, n = 10) {
  const pg = await pages(id), imps = await gscImports(id);
  return MON.pickPages(pg, imps[0]?.rows || [], n).map(p => p.url);
}
export async function speedRun(id, { strategy = "mobile", count = 10, force = false } = {}, progress = () => {}, signal = null) {
  const urls = await speedTargets(id, Math.min(Math.max(Number(count) || 10, 1), 30));
  if (!urls.length) throw new GuardrailError("Read the website first, so there are pages to test.");
  return SPEED.run(id, urls, { strategy: strategy === "desktop" ? "desktop" : "mobile", progress, signal, force: !!force });
}
export async function speedQuick(id, { strategy = "mobile", count = 50 } = {}, progress = () => {}, signal = null) {
  const urls = await speedTargets(id, Math.min(Math.max(Number(count) || 50, 1), 100));
  if (!urls.length) throw new GuardrailError("Read the website first, so there are pages to check.");
  return SPEED.quick(id, urls, { strategy: strategy === "desktop" ? "desktop" : "mobile", progress, signal });
}

// ---------------- "Is this page in Google?" ----------------
export async function indexRun(id, { count = 20, force = false, urls: only = null } = {}, progress = () => {}, signal = null, inspectFn) {
  const n = Math.min(Math.max(Number(count) || 20, 1), 100), urls = only && only.length ? only : await speedTargets(id, n);
  if (!urls.length) throw new GuardrailError("Read the website first, so there are pages to check.");
  const changed = only ? [] : await recentlyChangedUrls(id, 14).catch(() => []), declining = only ? [] : ((await DECAY.get(id))?.pages || []).map(d => d.url);
  return IDX.run(id, urls, inspectFn, { progress, signal, force: !!force, changed, declining, max: only ? only.length : n, exact: !!(only && only.length) });
}

// pages with a live address that changed in the last N days (for IndexNow batch submits)
export async function recentlyChangedUrls(id, days = 7) {
  const since = Date.now() - days * 864e5;
  return [...new Set((await contents(id)).filter(c => (c.updated_at || c.created_at || 0) >= since || (c.published?.at || 0) >= since).map(c => c.url || c.published?.link).filter(u => /^https?:\/\//.test(u || "")))];
}

// does the website already answer these questions? (no AI: matched against the pages read)
export async function questionCoverage(id, questions) {
  const pg = await pages(id);
  // pages written in the tool count too: their headings and FAQ questions
  const written = (await contents(id)).filter(c => c.status !== "do_not_publish").map(c => { const md = String(c.payload?.body_markdown || "");
    return { url: `written:${c.id}`, title: c.title || c.keyword, h1: [c.payload?.h1 || c.keyword], h2: [...md.matchAll(/^#{2,3}\s+(.+)$/gm)].map(m => m[1]).slice(0, 40), excerpt: "", word_count: 1000, _title: c.title || c.keyword }; });
  return questions.map(q => { const m = findMatches(q.title, pg, 1)[0]; const sim = m ? m.similarity : 0;
    const w = written.length ? findMatches(q.title, written, 1)[0] : null, wsim = w ? w.similarity : 0;
    if (wsim >= 0.5 && wsim > sim) { const wp = written.find(x => x.url === w.url); return { ...q, on_site: "written", match_url: "", written_title: wp?._title || "" }; }
    return { ...q, on_site: sim >= 0.5 ? "covered" : sim >= 0.28 ? "partial" : "gap", match_url: m && sim >= 0.28 ? m.url : "" }; });
}

// ---------------- internal link map ----------------
// computed once and reused until pages are read again or new Google data arrives (kept in this browser, not synced)
export async function linkMap(id, { fresh = false } = {}) {
  const st = await site(id), pg = await pages(id), imps = await gscImports(id);
  const sig = `${st?.summary?.crawl_id || st?.crawled_at || ""}|${pg.length}|${imps[0]?.id || ""}`, cached = await store.get(`linkmap-cache:${id}`, null);
  if (!fresh && cached && cached.sig === sig) return { ...cached.data, from_cache: true, plans: await linkPlans(id) };
  const map = LINKS.build(pg, imps[0]?.rows || []), found = st?.summary?.urls_discovered || 0;
  // orphans are only certain when most of the site was read: a page can look unlinked because the pages linking to it weren't read
  const coverage = found ? Math.min(1, pg.length / found) : 1;
  // progress: which earlier suggestions now exist as links
  let progress = cached?.data?.progress || null;
  if (cached && cached.sig !== sig && (cached.data.suggestions || []).length) {
    const now = new Set(); for (const p of pg) for (const l of p.links_out || []) now.add(`${String(p.url).replace(/\/$/, "")}>${String(l).replace(/\/$/, "")}`);
    const prev = cached.data.suggestions, added = prev.filter(x => now.has(`${x.from}>${x.to}`));
    progress = { at: Date.now(), added: added.length, total: prev.length, examples: added.slice(0, 5).map(x => ({ from: x.from, to: x.to })) };
  }
  const data = { ...map, coverage, discovered: found, suggestions: LINKS.suggestions(pg, map), layout: LINKS.layout(map), progress, computed_at: Date.now() };
  await store.set(`linkmap-cache:${id}`, { sig, data });
  return { ...data, plans: await linkPlans(id) };
}
// link plans: the suggested links for one source page, kept as a to-do until the links exist
const LPKEY = id => `linkplans:${id}`;
export const linkPlans = async id => (await store.get(LPKEY(id), [])) || [];
export async function addLinkPlan(id, from, links) {
  const list = (await linkPlans(id)).filter(p => p.from !== from);
  list.push({ id: store.newId(), from, links: links.slice(0, 10).map(l => ({ to: l.to, anchor: l.anchor, sentence: l.sentence || "" })), at: Date.now(), updated_at: Date.now() });
  await store.set(LPKEY(id), list); return list;
}

// ---------------- content decay ----------------
export async function decayRun(id, { monthFetch = null } = {}, progress = () => {}) {
  const pg = await pages(id), updates = await googleUpdates();
  let periods, source;
  let fetched = 0;
  if (monthFetch) {
    // completed months never change: keep each one (in this browser, not synced) and only fetch the months not seen yet
    const months = DECAY.lastMonths(6), cache = (await store.get(`decaymonths:${id}`, null)) || {}, missing = DECAY.missingMonths(cache, months);
    for (const [i, m] of missing.entries()) { progress(`Getting ${m.label} from Search Console (${i + 1}/${missing.length}; ${months.length - missing.length} month${months.length - missing.length === 1 ? "" : "s"} reused)…`); cache[m.from] = DECAY.compactRows(await monthFetch(m.from, m.to)); fetched++; }
    for (const k of Object.keys(cache)) if (!months.some(m => m.from === k)) delete cache[k];
    await store.set(`decaymonths:${id}`, cache);
    periods = months.map(m => ({ ...m, rows: DECAY.expandRows(cache[m.from]) }));
    source = "live";
  } else {
    const imps = (await gscImports(id)).filter(i => (i.rows || []).some(r => r.kind === "page")).slice(0, 2).reverse();
    if (imps.length < 2) throw new GuardrailError("To spot declining pages, connect Search Console (month-by-month data), or import two Search Console exports from different periods.");
    periods = imps.map(i => ({ label: i.label, rows: i.rows.filter(r => r.kind === "page").map(r => ({ page: r.page, clicks: r.clicks, impressions: r.impressions, position: r.position })) }));
    source = "imports";
  }
  const found = DECAY.analyse(periods, { updates, pages: pg });
  return DECAY.save(id, { at: Date.now(), source, months: periods.map(p => p.label), pages: found.slice(0, 100), fetched });
}

// ---------------- competitor tracking ----------------
const CKEY = id => `competitors:${id}`, SNAP = (id, cid) => `compsnap:${id}:${cid}`;
export const competitors = async id => (await store.get(CKEY(id), [])) || [];
export async function addCompetitor(id, { url, name = "" }) {
  let u; try { u = new URL(/^https?:/.test(url) ? url : "https://" + url); } catch { throw new GuardrailError("Enter the competitor's website address."); }
  const list = await competitors(id), mine = await site(id);
  if (u.hostname.replace(/^www\./, "") === new URL(mine.url).hostname.replace(/^www\./, "")) throw new GuardrailError("That's your own website.");
  if (list.some(c => new URL(c.url).hostname.replace(/^www\./, "") === u.hostname.replace(/^www\./, ""))) throw new GuardrailError("That competitor is already tracked.");
  if (list.length >= 10) throw new GuardrailError("You can track up to 10 competitors per website.");
  const c = { id: store.newId(), url: u.origin, name: name.trim() || u.hostname.replace(/^www\./, ""), added_at: Date.now(), updated_at: Date.now(), last_check: 0, tracked: 0, history: [] };
  await store.set(CKEY(id), [...list, c]); return c;
}
export async function removeCompetitor(id, cid) { await store.set(CKEY(id), (await competitors(id)).filter(c => c.id !== cid)); await store.del(SNAP(id, cid)); return { ok: true }; }
// label a competitor's new page against your keywords and pages (no AI)
export async function overlapLabel(id, title, url) {
  const text = `${title} ${COMP.slugWords(url)}`, tt = new Set(tokens(text)), kws = await keywordTable(id).catch(() => []), pg = await pages(id);
  let best = null, bs = 0; for (const k of kws) { const kt = tokens(k.keyword); if (!kt.length) continue; const n = kt.filter(w => tt.has(w)).length / kt.length; if (n > bs) { bs = n; best = k; } }
  const m = findMatches(text, pg, 1)[0];
  if (best && bs >= 0.6) return { kind: m && m.similarity >= 0.5 ? "keyword_covered" : "keyword_gap", keyword: best.keyword, your_page: m && m.similarity >= 0.5 ? m.url : "" };
  if (m && m.similarity >= 0.5) return { kind: "covered", your_page: m.url };
  return { kind: "new_topic" };
}
export async function checkCompetitor(id, cid, progress = () => {}, fetchText = null) {
  const list = await competitors(id), c = list.find(x => x.id === cid); if (!c) throw new GuardrailError("Competitor not found.");
  const ft = fetchText || (async u => { const { fetchPage } = await import("./crawler.js"); const r = await fetchPage(u, { retries: 1 }); return { status: r?.status || 0, text: r?.body || "" }; });
  progress(`Reading ${c.name}'s sitemaps…`);
  const prevSnap = await store.get(SNAP(id, cid), null);
  const res = await COMP.collect(c.url, ft, { maxFiles: 30, maxUrls: 10000, prev: prevSnap });
  if (!Object.keys(res.urls).length) throw new GuardrailError(`Couldn't find a sitemap for ${c.name} (or it blocks automated reading).`);
  const prev = COMP.snapUrls(prevSnap), d = COMP.diff(prev, res.urls), entry = { at: Date.now(), tracked: Object.keys(res.urls).length, baseline: !prev, files_fetched: res.fetched, files_reused: res.reused };
  if (prev) {
    const added = [];
    for (const [i, u] of d.added.slice(0, 50).entries()) {
      let title = ""; if (i < 15) { progress(`Reading new page ${i + 1} of ${Math.min(15, d.added.length)}…`); try { title = COMP.titleOf((await ft(u)).text); } catch { } }
      added.push({ url: u, title: title || COMP.slugWords(u), overlap: await overlapLabel(id, title, u) });
    }
    Object.assign(entry, { added, added_count: d.added.length, removed: d.removed.slice(0, 50), removed_count: d.removed.length, updated: d.updated.slice(0, 50), updated_count: d.updated.length });
  }
  await store.set(SNAP(id, cid), COMP.toSnapshot(res));
  const fresh = await competitors(id), cc = fresh.find(x => x.id === cid);
  Object.assign(cc, { last_check: Date.now(), updated_at: Date.now(), tracked: entry.tracked, capped: res.capped, files: res.files, history: [entry, ...(cc.history || [])].slice(0, 20) });
  await store.set(CKEY(id), fresh); return cc;
}

// ---------------- site migration planner ----------------
const MKEY = id => `migration:${id}`;
export const migration = async id => (await store.get(MKEY(id), null)) || { old: [], new: [], rows: [], checks: null };
async function relayText(u) { const { fetchPage } = await import("./crawler.js"); const r = await fetchPage(u, { retries: 1 }); return { status: r?.status || 0, text: r?.body || "" }; }
// every current address: the sitemap, plus every page with Google traffic, plus the pages read
export async function migrationLoadOld(id, progress = () => {}) {
  const s = await site(id), pg = await pages(id), imps = await gscImports(id), m = await migration(id);
  progress("Reading your sitemap…");
  const sm = await COMP.collect(s.url, relayText, { maxFiles: 40, maxUrls: 10000 }).catch(() => ({ urls: {} }));
  const by = new Map(), add = (u, extra = {}) => { const k = u.replace(/\/$/, "") || u; const o = by.get(k) || { url: u, clicks: 0, title: "" }; Object.assign(o, Object.fromEntries(Object.entries(extra).filter(([, v]) => v))); by.set(k, o); };
  for (const u of Object.keys(sm.urls || {})) add(u);
  for (const r of (imps[0]?.rows || []).filter(r => r.kind === "page" && r.page)) { add(r.page); const o = by.get(r.page.replace(/\/$/, "") || r.page); o.clicks = (o.clicks || 0) + (r.clicks || 0); }
  for (const p of pg) add(p.url, { title: p.title });
  m.old = [...by.values()].sort((a, b) => b.clicks - a.clicks); m.old_at = Date.now(); m.old_capped = !!sm.capped;
  await store.set(MKEY(id), m); return { count: m.old.length, with_traffic: m.old.filter(o => o.clicks > 0).length, from_sitemap: Object.keys(sm.urls || {}).length, capped: !!sm.capped };
}
export async function migrationSetNew(id, { urls = [], sitemap = "" }, progress = () => {}) {
  const m = await migration(id); let list = urls.map(String).map(x => x.trim()).filter(u => /^https?:\/\//.test(u));
  if (sitemap) { progress("Reading the new site's sitemap…"); const r = await COMP.collect(sitemap, relayText, { maxFiles: 40, maxUrls: 10000 }); list = [...list, ...Object.keys(r.urls)]; if (!list.length) throw new GuardrailError("Couldn't find any pages in that sitemap."); }
  if (!list.length) throw new GuardrailError("Paste the new addresses (one per line), or give the new site's sitemap.");
  m.new = [...new Set(list)].slice(0, 20000); await store.set(MKEY(id), m); return { count: m.new.length };
}
export async function migrationMatch(id, progress = () => {}) {
  const m = await migration(id); if (!m.old.length) throw new GuardrailError("Load the current pages first (step 1)."); if (!m.new.length) throw new GuardrailError("Add the new addresses first (step 2).");
  const keep = new Map((m.rows || []).filter(r => r.edited).map(r => [r.url, r]));
  m.rows = (await MIG.matchAsync(m.old, m.new, progress)).map(r => keep.has(r.url) ? { ...r, target: keep.get(r.url).target, gone: keep.get(r.url).gone, edited: true } : r);
  m.matched_at = Date.now(); m.checks = null; await store.set(MKEY(id), m); return m;
}
export async function migrationEdit(id, url, { target, gone }) {
  const m = await migration(id), r = m.rows.find(x => x.url === url); if (!r) throw new GuardrailError("Row not found.");
  if (target !== undefined) { if (target && !/^https?:\/\//.test(target)) throw new GuardrailError("Enter the full new address, starting with https://"); r.target = target; r.kind = "edited"; r.confidence = 1; }
  if (gone !== undefined) r.gone = !!gone; r.edited = true; r.edited_at = Date.now(); await store.set(MKEY(id), m); return r;
}
export async function migrationCheck(id, progress = () => {}, traceFn, { all = false } = {}) {
  const m = await migration(id); if (!m.rows.length) throw new GuardrailError("Match the pages first.");
  // after the first check, only redirects with problems, rows edited since, and rows never checked are tested again
  const prev = new Map((m.checks?.results || []).map(x => [x.url, x])), since = m.checks?.at || 0;
  const planned = m.rows.filter(r => r.target || r.gone).slice(0, 2000);
  const rows = all || !m.checks ? planned : planned.filter(r => { const p = prev.get(r.url); return !p || !["ok"].includes(p.verdict) || (r.edited_at || 0) > since; });
  const results = [];
  for (let i = 0; i < rows.length; i += 20) { progress(`Checking redirects ${i + 1}-${Math.min(i + 20, rows.length)} of ${rows.length}…`); results.push(...await traceFn(rows.slice(i, i + 20).map(r => r.url))); }
  const byUrl = new Map(results.map(t => [t.url, t]));
  const fresh = rows.map(r => ({ url: r.url, target: r.target, gone: !!r.gone, clicks: r.clicks, hops: byUrl.get(r.url)?.hops || [], at: Date.now(), ...MIG.judge(r, byUrl.get(r.url)) }));
  const merged = new Map(planned.map(r => [r.url, prev.get(r.url)]).filter(([, v]) => v)); for (const f of fresh) merged.set(f.url, f);
  m.checks = { at: Date.now(), results: [...merged.values()], rechecked: rows.length, total: planned.length };
  await store.set(MKEY(id), m); return m.checks;
}

// ---------------- structured data checker ----------------
// the same problem on many pages counts once: specific values are replaced by "…"
export const schemaProblemKey = (type, msg) => `${type}: ${msg.replace(/“[^”]*”/g, "…").replace(/\b\d+(\.\d+)?\b/g, "N")}`;
export async function schemaRun(id, { count = 30, force = false } = {}, progress = () => {}) {
  const urls = await speedTargets(id, Math.min(Math.max(Number(count) || 30, 1), 50));
  if (!urls.length) throw new GuardrailError("Read the website first, so there are pages to check.");
  // pages checked in the last 24 hours are reused unless forced; a fingerprint of each page's markup shows what changed
  const prev = (await store.get(`schemacheck:${id}`, null)) || null, prevBy = new Map((prev?.pages || []).map(p => [p.url, p]));
  const fresh = u => !force && prevBy.get(u) && !prevBy.get(u).error && Date.now() - (prevBy.get(u).at || 0) < 864e5;
  const todo = urls.filter(u => !fresh(u)), reused = urls.filter(fresh).map(u => ({ ...prevBy.get(u), reused: true }));
  const { fetchPage } = await import("./crawler.js"), out = [...reused]; let i = 0, done = 0;
  const worker = async () => { while (i < todo.length) { const u = todo[i++];
    try { const r = await fetchPage(u, { retries: 1 }); if (r?.status === 200 && r.body) { const c = SCHEMA.checkHtml(r.body), old = prevBy.get(u); out.push({ url: u, at: Date.now(), ...c, changed: !!old && !!old.fp && old.fp !== c.fp }); } else out.push({ url: u, at: Date.now(), error: `couldn't be read (${r?.status || "no answer"})` }); }
    catch (e) { out.push({ url: u, at: Date.now(), error: e.message }); }
    progress(`Checked ${++done} of ${todo.length} pages${reused.length ? ` (${reused.length} checked in the last 24 hours, reused)` : ""}…`); } };
  await Promise.all([worker(), worker(), worker(), worker()]);
  // site-wide summary: each problem with the pages it affects
  const probs = new Map(), types = new Map();
  for (const p of out) {
    for (const e of p.parse_errors || []) { const k = "Invalid JSON-LD"; const o = probs.get(k) || { key: k, type: "JSON-LD", message: "The structured data can't be read at all (a syntax error)", level: "error", pages: [] }; o.pages.push(p.url); probs.set(k, o); }
    for (const it of p.items || []) {
      if (it.known) { const t = types.get(it.type) || { type: it.type, result: it.result, urls: new Set(), ok: new Set(), note: it.note }; t.urls.add(p.url); if (it.eligible) t.ok.add(p.url); types.set(it.type, t); }
      for (const [level, list] of [["error", it.errors], ["warning", it.warnings]]) for (const m of list) { const k = schemaProblemKey(it.type, m); const o = probs.get(k) || { key: k, type: it.type, message: m, level, pages: [] }; if (!o.pages.includes(p.url)) o.pages.push(p.url); probs.set(k, o); }
    }
  }
  // errors fixed since the previous check (per page, by problem)
  const errKeys = p => new Set([...(p.parse_errors || []).map(() => "Invalid JSON-LD"), ...(p.items || []).flatMap(it => (it.errors || []).map(m => schemaProblemKey(it.type, m)))]);
  const fixedSince = []; for (const p of out) { const old = prevBy.get(p.url); if (!old || p.reused) continue; const now = errKeys(p); for (const k of errKeys(old)) if (!now.has(k)) fixedSince.push({ url: p.url, problem: k }); }
  const res = { at: Date.now(), reused: reused.length, changed: out.filter(p => p.changed).length, fixed_since: fixedSince.slice(0, 50), pages: out, types: [...types.values()].map(t => ({ type: t.type, result: t.result, note: t.note, pages: t.urls.size, eligible: t.ok.size })).sort((a, b) => b.pages - a.pages), problems: [...probs.values()].sort((a, b) => (a.level === "error" ? 0 : 1) - (b.level === "error" ? 0 : 1) || b.pages.length - a.pages.length) };
  await store.set(`schemacheck:${id}`, res); return res;
}

// ---------------- duplicate content ----------------
export async function duplicates(id) {
  const pg = await pages(id), imps = await gscImports(id), clicks = new Map();
  for (const r of (imps[0]?.rows || []).filter(r => r.kind === "page" && r.page)) { const u = r.page.replace(/\/$/, ""); clicks.set(u, (clicks.get(u) || 0) + (r.clicks || 0)); }
  return DUPES.analyse(pg, { clicks });
}

// ---------------- external links ----------------
export async function extLinksRun(id, { limit = 500, all = false, only = null } = {}, progress = () => {}, traceFn = EXT.traceUrls) {
  const pg = await pages(id), every = EXT.collect(pg);
  if (!pg.some(p => Array.isArray(p.links_ext))) throw new GuardrailError("Read the website again first: links to other websites are recorded when pages are read.");
  if (!every.length) throw new GuardrailError("No links to other websites were found on the pages read.");
  // links that worked (or block checks) in the last 7 days are reused; problems and new links are always checked
  const prev = (await store.get(`extlinks:${id}`, null)) || null, prevBy = new Map((prev?.results || []).map(r => [r.url, r]));
  const fresh = l => { const p = prevBy.get(l.url); return !all && p && ["ok", "blocked"].includes(p.verdict) && Date.now() - (p.checked_at || prev.at) < 7 * 864e5; };
  const pool = (only ? every.filter(l => only.includes(l.url)) : every).slice(0, Math.min(limit, 1000)), todo = pool.filter(l => !fresh(l)), traced = new Map();
  const batches = EXT.politeBatches(todo.map(l => l.url)); let done = 0;
  for (const b of batches) { progress(`Checking links ${done + 1}-${done + b.length} of ${todo.length}${pool.length - todo.length ? ` (${pool.length - todo.length} that worked in the last 7 days reused)` : ""}…`); for (const t of await traceFn(b)) traced.set(t.url, t); done += b.length; }
  const order = { domain: 0, broken: 1, removed: 2, server: 3, moved: 4, blocked: 5, skipped: 6, ok: 7 };
  const checkedNow = todo.map(l => ({ ...l, ...EXT.judge(l, traced.get(l.url)), status: traced.get(l.url)?.final_status || 0, final_url: traced.get(l.url)?.final || "", checked_at: Date.now() }));
  // keep earlier results for links not checked this time (still on the site), refreshed with the pages they're on
  const now = new Map(every.map(l => [l.url, l])), merged = new Map();
  for (const r of prev?.results || []) if (now.has(r.url)) merged.set(r.url, { ...r, pages: now.get(r.url).pages, in_content: now.get(r.url).in_content });
  for (const r of checkedNow) merged.set(r.url, r);
  const results = [...merged.values()].sort((a, b) => order[a.verdict] - order[b.verdict] || b.pages.length - a.pages.length);
  const res = { at: Date.now(), total: every.length, checked: checkedNow.length, reused: pool.length - todo.length, results, by_website: EXT.byWebsite(results) };
  await store.set(`extlinks:${id}`, res); return res;
}
// after the website is read again: check only links never seen before (if this check has been used), in the background
export async function extLinksNew(id) {
  const prev = await store.get(`extlinks:${id}`, null); if (!prev) return null;
  const seen = new Set((prev.results || []).map(r => r.url)), fresh = EXT.collect(await pages(id)).filter(l => !seen.has(l.url)).slice(0, 100).map(l => l.url);
  if (!fresh.length) return { checked: 0 };
  return extLinksRun(id, { only: fresh });
}

// IndexNow: add a page to the pending list (quietly does nothing when IndexNow isn't set up)
async function inowQueue(id, url, reason, version) { try { const s = await site(id); if (url && /^https?:\/\//.test(url)) await INOW.queue(id, s.url, [{ url, reason, version }]); } catch { } }
export async function indexNowRecent(id) { const s = await site(id), urls = await recentlyChangedUrls(id, 7); await INOW.queue(id, s.url, urls.map(u => ({ url: u, reason: "changed in the last 7 days" }))); return INOW.get(id); }

const fmtNum = n => Number(n || 0).toLocaleString("en-US");

// competitor topic trends (30 and 90 days) and one feed of new pages across all competitors, most relevant first
export async function competitorInsights(id) {
  const list = await competitors(id), kws = (await keywordTable(id).catch(() => [])).map(k => k.keyword), kwTok = kws.map(k => new Set(tokens(k)));
  const rank = { keyword_gap: 0, keyword_covered: 1, covered: 2, new_topic: 3 }, now = Date.now(), feed = [], per = [];
  for (const c of list) {
    const items = (c.history || []).flatMap(h => (h.added || []).map(a => ({ ...a, at: h.at, competitor: c.name })));
    const t = days => COMP.topics(items.filter(x => now - x.at < days * 864e5), { brand: c.name }).map(x => ({ ...x, yours: kwTok.some(k => { const tt = tokens(x.topic); return tt.length && tt.every(w => k.has(w)); }) }));
    per.push({ id: c.id, name: c.name, topics30: t(30), topics90: t(90) });
    feed.push(...items.filter(x => now - x.at < 30 * 864e5));
  }
  feed.sort((a, b) => (rank[a.overlap?.kind] ?? 3) - (rank[b.overlap?.kind] ?? 3) || b.at - a.at);
  return { per, feed: feed.slice(0, 60) };
}

// better targets for "no good match" pages with Google traffic, using page titles (reads up to `limit` new pages)
export async function migrationTitles(id, { limit = 100 } = {}, progress = () => {}) {
  const m = await migration(id), { fetchPage } = await import("./crawler.js"), titles = new Map();
  const rows = m.rows.filter(r => !r.edited && !r.gone && ["none", "parent"].includes(r.kind) && r.title && (r.clicks || 0) > 0).sort((a, b) => b.clicks - a.clicks).slice(0, 20);
  const want = [...new Set(rows.flatMap(r => MIG.candidatesFor(r, m.new, 5)))].slice(0, limit); let done = 0, improved = 0;
  for (const u of want) { try { const r = await fetchPage(u, { retries: 0 }); const t = (String(r?.body || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]; if (t) titles.set(u, t.replace(/\s+/g, " ").trim()); } catch { } progress(`Read ${++done} of ${want.length} new pages…`); }
  for (const r of rows) { const better = MIG.titleRescore(r, MIG.candidatesFor(r, m.new, 5).map(u => ({ url: u, title: titles.get(u) || "" }))); if (better) { Object.assign(r, better, { suggestion: "" }); improved++; } }
  await store.set(`migration:${id}`, m); return { read: want.length, improved };
}

// read two pages live and compare them sentence by sentence
export async function dupCompare(id, a, b) {
  const { fetchPage, extract } = await import("./crawler.js"), host = new URL(a).host;
  const read = async u => { const r = await fetchPage(u, { retries: 1 }); if (!r || r.status !== 200 || !r.body) throw new GuardrailError(`Couldn't read ${u} (${r?.status || "no answer"}).`); const d = extract(u, r.body, host); return { title: d.title || u, text: d._text || "" }; };
  const [A, B] = await Promise.all([read(a), read(b)]);
  return { a: { url: a, title: A.title }, b: { url: b, title: B.title }, ...DUPES.sideBySide(A.text, B.text) };
}

// ---------------- refresh drafts: an updated version of a live page, as tracked changes ----------------
export async function refreshDraft(id, url, progress = () => {}) {
  const s = await site(id), { fetchPage, extract, mainContent } = await import("./crawler.js"), { htmlToMarkdown } = await import("./md.js");
  progress("Reading the live page…");
  const r = await fetchPage(url, { retries: 1 }); if (!r || r.status !== 200 || !r.body) throw new GuardrailError(`Couldn't read ${url} (${r?.status || "no answer"}).`);
  const facts = extract(url, r.body, new URL(s.url).host), doc = new DOMParser().parseFromString(r.body, "text/html");
  let markdown = htmlToMarkdown(mainContent(doc).innerHTML || "").trim(); if (!/^# /m.test(markdown) && facts.h1?.[0]) markdown = `# ${facts.h1[0]}\n\n${markdown}`;
  if (markdown.split(/\s+/).length < 80) throw new GuardrailError("The page has too little text to refresh.");
  const norm = u => String(u || "").replace(/\/$/, ""), dc = (await DECAY.get(id))?.pages?.find(p => norm(p.url) === norm(url));
  if (dc && !dc.lost_queries && dc.peak_period?.from) try {
    const GSCC = await import("./gscconn.js"), conn = await GSCC.get(id);
    if (conn?.property) { progress("Getting the searches this page lost from Search Console…");
      const [before, after] = await Promise.all([GSCC.queryRange(id, ["query"], dc.peak_period.from, dc.peak_period.to, { page: url, rowLimit: 200 }), GSCC.queryRange(id, ["query"], dc.last_period.from, dc.last_period.to, { page: url, rowLimit: 200 })]);
      dc.lost_queries = DECAY.lostQueries(before, after); }
  } catch { }
  const imps = await gscImports(id), queries = (imps[0]?.rows || []).filter(x => x.kind === "qp" && norm(x.page) === norm(url)).sort((a, b) => b.clicks - a.clicks).map(x => x.query);
  const kb = await KB.knowledgeFor(id, `${facts.title} ${(dc?.lost_queries || []).map(q => q.query).join(" ")}`, { k: 6, budgetWords: isFreeProvider() ? 600 : 1200 });
  progress("Writing the updated version (only what needs changing)…");
  const res = await ask("refresh", P.refresh(kb.text ? { ...s, knowledge: kb.text } : s, { title_tag: facts.title || "", meta_description: facts.meta_description || "", markdown },
    { lost: dc?.lost_queries || [], queries, causes: (dc?.causes || []).map(c => c.text) }, s.style || null), { maxTokens: 16000 });
  if (!String(res.body_markdown || "").trim()) throw new GuardrailError("The AI returned an empty page. Try again.");
  const seq = TD.diff(markdown, res.body_markdown), pageRow = (await pages(id)).find(p => norm(p.url) === norm(url));
  const payload = { title_tag: String(res.title_tag || facts.title || ""), meta_description: String(res.meta_description || facts.meta_description || ""), body_markdown: res.body_markdown, slug: (new URL(url).pathname.split("/").filter(Boolean).pop() || "").toLowerCase() };
  payload.html = mdToHtml(payload.body_markdown); payload.h1 = (payload.body_markdown.match(/^# (?!#)(.+)$/m) || [])[1] || "";
  const all = await contents(id);
  const item = { id: store.newId(), keyword: dc?.lost_queries?.[0]?.query || queries[0] || facts.title || url, intent: pageRow?.intent || "informational", page_type: "blog_post", author: "", title: payload.title_tag, slug: payload.slug, url,
    payload, status: "ready_for_human_review", created_at: Date.now(), updated_at: Date.now(),
    refresh: { source_url: url, original: { markdown, title_tag: facts.title || "", meta_description: facts.meta_description || "" }, updated: res.body_markdown, changes_ai: (res.changes || []).slice(0, 20), applied: false, decline: dc?.decline ?? null,
      lost: (dc?.lost_queries || []).map(q => q.query).slice(0, 10), compare: refreshCompare(markdown, res.body_markdown, (dc?.lost_queries || []).map(q => q.query).slice(0, 10)) },
    report: { warnings: [`A refresh of ${url}. Review the tracked changes, then apply your decisions.`], rounds: [] }, versions: [{ v: 1, at: Date.now(), source: "refresh", note: "Original page, as read", markdown }] };
  regate(item, await pages(id)); item.status = "ready_for_human_review";
  await store.set(`contents:${id}`, [item, ...all]);
  return { id: item.id, changes: TD.changes(seq).length };
}
// apply accept/reject decisions: the result becomes the page's text, checked like any edit
export async function refreshApply(id, cid, { decisions = {}, title = "accept", meta = "accept", edits = {} } = {}) {
  const [all, i] = await loadItem(id, cid), item = all[i]; if (!item.refresh) throw new GuardrailError("This page isn't a refresh draft.");
  const seq = TD.diff(item.refresh.original.markdown, item.refresh.updated), md = TD.apply(seq, decisions, edits);
  const n = TD.changes(seq), acc = n.filter(c => decisions[c.id] !== "reject").length;
  await saveDraft(id, cid, { markdown: md, title_tag: title === "reject" ? item.refresh.original.title_tag : item.payload.title_tag, meta_description: meta === "reject" ? item.refresh.original.meta_description : item.payload.meta_description, source: "refresh", note: `${acc} of ${n.length} changes accepted` });
  const [all2, j] = await loadItem(id, cid); all2[j].refresh = { ...all2[j].refresh, applied: true, decisions, title, meta, applied_at: Date.now() }; await store.set(`contents:${id}`, all2);
  return all2[j];
}

// before/after: how many lost searches each version covers (most of a search's words present), and length
export function refreshCompare(orig, upd, lost) {
  const covers = (md, q) => { const t = new Set(tokens(md)), w = tokens(q); return w.length && w.filter(x => t.has(x)).length / w.length >= 0.8; };
  const words = md => (String(md).match(/\S+/g) || []).length;
  return { lost: lost.map(q => ({ query: q, before: covers(orig, q), after: covers(upd, q) })), words_before: words(orig), words_after: words(upd) };
}
// refresh drafts for the pages losing the most clicks (one after another)
export async function refreshTop(id, n = 3, progress = () => {}) {
  const dc = (await DECAY.get(id))?.pages?.filter(p => p.level !== "early").slice(0, n) || []; if (!dc.length) throw new GuardrailError("No declining pages yet. Check for declining pages first.");
  const out = []; for (const [k, p] of dc.entries()) { try { const r = await refreshDraft(id, p.url, t => progress(`Page ${k + 1} of ${dc.length}: ${t}`)); out.push({ url: p.url, id: r.id, changes: r.changes }); } catch (e) { out.push({ url: p.url, error: e.message }); } }
  return out;
}

// ---------------- editorial calendar: the content plan as a board ----------------
// stages: idea → brief → writing → review → approved → published. Cards linked to a written page follow the page;
// every written page gets a card automatically.
export const STAGES = ["idea", "brief", "writing", "review", "approved", "published"];
const stageOfContent = c => (c.url || c.published?.status === "publish") && c.status === "approved" ? "published" : c.status === "approved" ? "approved" : ["ready_for_human_review", "improve_before_publishing", "do_not_publish"].includes(c.status) ? "review" : "writing";
export async function calendarView(id) {
  await planView(id);   // links plan items to written pages
  const all = await planItems(id), items = await contents(id), linked = new Set(all.map(x => x.content_id).filter(Boolean));
  let added = 0;
  for (const c of items) if (!linked.has(c.id) && !all.some(x => x.keyword === String(c.keyword || "").toLowerCase().trim())) {
    all.push({ id: store.newId(), keyword: String(c.keyword || c.title || "").toLowerCase().trim(), title: c.title || c.keyword, intent: c.intent, page_type: c.page_type, priority: "medium",
      month: new Date(c.created_at || Date.now()).toISOString().slice(0, 7), owner: c.author || "", status: "writing", content_id: c.id, source: "page", created_at: Date.now() }); added++; }
  const byId = new Map(items.map(c => [c.id, c]));
  for (const it of all) { const c = byId.get(it.content_id);
    if (c) { it.stage = stageOfContent(c); it.content_status = c.status; it.url = c.url || c.published?.link || ""; }
    else if (!STAGES.includes(it.stage)) it.stage = it.status === "writing" ? "writing" : "idea"; }
  await store.set(`plan:${id}`, all);
  return { cards: all, added };
}

// due dates as a calendar file (.ics) for Google Calendar, Outlook or Apple Calendar
export async function calendarIcs(id) {
  const s = await site(id), cards = (await planItems(id)).filter(c => c.due && c.stage !== "published"), now = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const esc = t => String(t || "").replace(/[\\;,]/g, m => "\\" + m).replace(/\n/g, "\\n");
  const ev = c => { const d = c.due.replace(/-/g, ""), next = new Date(Date.parse(c.due) + 864e5).toISOString().slice(0, 10).replace(/-/g, "");
    return ["BEGIN:VEVENT", `UID:ce-${id}-${c.id}@content-engine`, `DTSTAMP:${now}`, `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${next}`, `SUMMARY:${esc(`${c.title || c.keyword} (${c.stage || "idea"})`)}`,
      `DESCRIPTION:${esc(`${s.name || s.url} content calendar${c.owner ? `. Owner: ${c.owner}` : ""}${c.keyword ? `. Keyword: ${c.keyword}` : ""}`)}`, "END:VEVENT"].join("\r\n"); };
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Content Engine//Calendar//EN", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${esc(`${s.name || "Content"} calendar`)}`, ...cards.map(ev), "END:VCALENDAR"].join("\r\n") + "\r\n";
}

// ---------------- content briefs ----------------
const BKEY = id => `briefs:${id}`;
export const briefs = async id => (await store.get(BKEY(id), [])) || [];
export async function deleteBrief(id, bid) { await store.set(BKEY(id), (await briefs(id)).filter(b => b.id !== bid)); return { ok: true }; }
export async function createBrief(id, keyword, progress = () => {}) {
  keyword = String(keyword || "").toLowerCase().trim(); if (!keyword) throw new GuardrailError("Choose a keyword.");
  const s = await site(id), pg = await pages(id), intent = classify(keyword), structure = structureFor(keyword, intent, "blog_post");
  const page_type = { how_to: "how_to_guide", transactional: "landing_page", commercial: "comparison" }[intent] || "blog_post";
  const words = Math.max(SEO.min_words[page_type] || 900, 900);
  progress("Gathering what the tool knows…");
  const kwRec = (await keywordTable(id).catch(() => [])).find(k => k.keyword === keyword), serpRaw = kwRec?.check?.serp;
  const serp = serpRaw && serpRaw.searched !== false ? JSON.stringify(serpRaw).replace(/[{}"\[\]]/g, " ").replace(/\s+/g, " ").slice(0, 1500) : "";
  const kwT = new Set(tokens(keyword)), rel = t => tokens(t).filter(w => kwT.has(w)).length >= Math.min(2, kwT.size);
  const questions = [...new Set([...(await (await import("./questions.js")).bank(id)).filter(q => rel(q.title)).map(q => q.title)])].slice(0, 10);
  const imps = await gscImports(id), searches = [...new Set((imps[0]?.rows || []).filter(r => r.query && rel(r.query)).sort((a, b) => (b.impressions || 0) - (a.impressions || 0)).map(r => r.query))].filter(q => q !== keyword).slice(0, 12);
  const links = findMatches(keyword, pg, 6).filter(m => m.similarity >= 0.15).slice(0, 5).map(m => ({ title: (pg.find(p => p.url === m.url)?.title || m.url).split(/\s[|\-–—]\s/)[0], url: m.url }));
  let subtopics = []; try { const t = await Promise.race([WIKI.topic(keyword, "en"), new Promise((_, r) => setTimeout(() => r(new Error("timeout")), 6000))]); subtopics = (t?.sections || []).map(x => x.title).slice(0, 10); } catch { }
  const kb = await KB.knowledgeFor(id, keyword, { k: 6, budgetWords: isFreeProvider() ? 600 : 1200 });
  progress("Writing the brief…");
  const b = await ask("writer_brief", P.writerBrief(kb.text ? { ...s, knowledge: kb.text } : s, { keyword, intent, page_type, words, serp, subtopics, questions, searches, links }, s.style || null), { maxTokens: 4000 });
  const rec = { id: store.newId(), keyword, intent, page_type, words, created_at: Date.now(), updated_at: Date.now(), brief: b, links,
    sources: { ranking: !!serp, wikipedia: subtopics.length, questions: questions.length, searches: searches.length, knowledge: !!kb.text } };
  await store.set(BKEY(id), [rec, ...(await briefs(id)).filter(x => x.keyword !== keyword)].slice(0, 200));
  // the calendar card for this keyword moves to Brief (created if missing)
  await addToPlan(id, [{ keyword, title: b.title_ideas?.[0] || keyword, intent, page_type }]);
  const plan = await planItems(id), card = plan.find(x => x.keyword === keyword); if (card && !card.content_id && ["idea", undefined, ""].includes(card.stage || "")) { card.stage = "brief"; card.brief_id = rec.id; card.updated_at = Date.now(); await store.set(`plan:${id}`, plan); }
  return rec;
}
// the brief as Markdown (to copy, download or give to a writer)
export function briefMarkdown(r, siteName = "") {
  const b = r.brief || {}, L = (t, list) => list?.length ? `\n## ${t}\n\n${list.map(x => `- ${x}`).join("\n")}\n` : "";
  return `# Content brief: ${r.keyword}\n\n${siteName ? `**Website:** ${siteName}  \n` : ""}**Search intent:** ${r.intent} · **Page type:** ${r.page_type.replace(/_/g, " ")} · **Length:** about ${r.words} words\n` +
    `${b.title_ideas?.length ? `\n## Title ideas\n\n${b.title_ideas.map(t => `- ${t}`).join("\n")}\n` : ""}${b.reader ? `\n## Who is searching\n\n${b.reader}\n` : ""}${b.angle ? `\n## Our angle\n\n${b.angle}\n` : ""}` +
    `${(b.outline || []).length ? `\n## Outline\n\n${b.outline.map(o => `### ${o.h2}\n${o.notes ? `${o.notes}\n` : ""}${(o.h3 || []).map(h => `- ${h}`).join("\n")}`).join("\n\n")}\n` : ""}` +
    L("Questions to answer", b.questions) + L("Facts and sources to use", b.facts) + L("Must include", b.must_include) + L("Avoid", b.avoid) +
    `${(r.links || []).length ? `\n## Link to these pages\n\n${r.links.map(l => `- ${l.title}: ${l.url}`).join("\n")}\n` : ""}${b.cta ? `\n## Call to action\n\n${b.cta}\n` : ""}`;
}

// edit a brief (the edited Markdown replaces the generated one)
export async function updateBrief(id, bid, { markdown }) {
  const list = await briefs(id), b = list.find(x => x.id === bid); if (!b) throw new GuardrailError("Brief not found.");
  b.edited_md = String(markdown || "").slice(0, 60000); b.updated_at = Date.now(); await store.set(BKEY(id), list); return b;
}
export async function briefDoc(id, bid) {
  const b = (await briefs(id)).find(x => x.id === bid); if (!b) throw new GuardrailError("Brief not found.");
  const s = await site(id), card = (await planItems(id)).find(x => x.keyword === b.keyword);
  let md = b.edited_md || briefMarkdown(b, s.name || s.url);
  if (card && (card.owner || card.due) && !b.edited_md) md = md.replace(/\n/, `\n\n${card.owner ? `**Writer:** ${card.owner}  \n` : ""}${card.due ? `**Due:** ${card.due}  \n` : ""}`);
  return { markdown: md, brief: b, owner: card?.owner || "", due: card?.due || "" };
}
// how much of a brief a written page covers: outline sections (by heading words) and questions (by their words in the text)
export function briefCoverage(b, md) {
  const text = new Set(tokens(md)), heads = [...String(md).matchAll(/^#{2,3}\s+(.+)$/gm)].map(m => new Set(tokens(m[1])));
  const sec = (b.brief?.outline || []).map(o => { const w = tokens(o.h2); const inHead = heads.some(h => w.length && w.filter(x => h.has(x)).length / w.length >= 0.6); const inText = w.length && w.filter(x => text.has(x)).length / w.length >= 0.8; return { h2: o.h2, covered: inHead || inText }; });
  const qs = (b.brief?.questions || []).map(q => { const w = tokens(q); return { q, covered: !!w.length && w.filter(x => text.has(x)).length / w.length >= 0.7 }; });
  return { sections: sec, questions: qs };
}
export async function briefCoverageFor(id, cid) {
  const it = (await contents(id)).find(c => c.id === cid); if (!it) return null;
  const b = (await briefs(id)).find(x => x.keyword === String(it.keyword || "").toLowerCase().trim()); if (!b) return null;
  return { brief_id: b.id, ...briefCoverage(b, it.payload?.body_markdown || "") };
}

// ---------------- annotations: what happened when (your notes plus automatic markers) ----------------
const NKEY = id => `notes:${id}`;
export const notes = async id => (await store.get(NKEY(id), [])) || [];
export async function addNote(id, { date, text, by = "" }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) throw new GuardrailError("Choose a date.");
  text = String(text || "").trim().slice(0, 200); if (!text) throw new GuardrailError("Write what happened.");
  const n = { id: store.newId(), date, text, by: String(by || "").slice(0, 60), kind: "note", created_at: Date.now(), updated_at: Date.now() };
  await store.set(NKEY(id), [...(await notes(id)), n]); return n;
}
export async function deleteNote(id, nid) { await store.set(NKEY(id), (await notes(id)).filter(n => n.id !== nid)); return { ok: true }; }
const day = t => new Date(t).toISOString().slice(0, 10);
// automatic markers from what the tool knows (Google updates are shown separately, as shaded bands)
export async function annotations(id) {
  const out = (await notes(id)).map(n => ({ ...n }));
  for (const c of await contents(id)) {
    if (c.status === "approved" && (c.url || c.published?.status === "publish")) out.push({ id: `pub${c.id}`, date: day(c.published?.at || c.approved?.at || c.updated_at || c.created_at), text: `Published: ${c.title || c.keyword}`, kind: "published", url: c.url || c.published?.link || "" });
    if (c.refresh?.applied_at) out.push({ id: `ref${c.id}`, date: day(c.refresh.applied_at), text: `Refreshed: ${String(c.refresh.source_url).replace(/^https?:\/\/[^/]+/, "") || "/"}`, kind: "refreshed", url: c.refresh.source_url });
  }
  for (const c of await competitors(id)) for (const h of c.history || []) if ((h.added_count || 0) >= 5) out.push({ id: `cmp${c.id}${h.at}`, date: day(h.at), text: `${c.name} published ${h.added_count} new pages`, kind: "competitor" });
  const mg = await store.get(`migration:${id}`, null); if (mg?.checks?.at) out.push({ id: "mig", date: day(mg.checks.at), text: "Site migration: redirects checked", kind: "migration" });
  // what happened next: Google clicks per day, 14 days before vs 14 days after (when the data covers both)
  const daily = new Map(((await gscImports(id))[0]?.rows || []).filter(r => r.kind === "date").map(r => [r.dim || r.date, r.clicks || 0]));
  if (daily.size) for (const n of out) { const t = Date.parse(n.date); let b = 0, a = 0, nb = 0, na = 0;
    for (let k = 1; k <= 14; k++) { const db = day(t - k * 864e5), da = day(t + (k - 1) * 864e5); if (daily.has(db)) { b += daily.get(db); nb++; } if (daily.has(da)) { a += daily.get(da); na++; } }
    if (nb >= 10 && na >= 10 && b) n.impact = Math.round(100 * ((a / na) - (b / nb)) / (b / nb)); }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------- AI-answer readiness ----------------
export async function aiReadiness(id, progress = () => {}) {
  const s = await site(id), pg = await pages(id); if (!pg.length) throw new GuardrailError("Read the website first.");
  const AIR = await import("./aiready.js"), { fetchPage } = await import("./crawler.js"), origin = new URL(s.url).origin;
  progress("Reading robots.txt and llms.txt…");
  const get = async u => { try { const r = await fetchPage(u, { retries: 0 }); return r && r.status === 200 ? String(r.body || "") : null; } catch { return null; } };
  const [robots, llms] = await Promise.all([get(`${origin}/robots.txt`), get(`${origin}/llms.txt`)]);
  const clicks = new Map(); for (const r of (await gscImports(id))[0]?.rows || []) if (r.kind === "page" && r.page) clicks.set(r.page.replace(/\/$/, ""), (clicks.get(r.page.replace(/\/$/, "")) || 0) + (r.clicks || 0));
  const clicksOf = u => clicks.get(String(u).replace(/\/$/, "")) || 0;
  const top = [...pg].filter(p => (p.word_count || 0) >= 150 && !p.noindex).sort((a, b) => clicksOf(b.url) - clicksOf(a.url) || (b.word_count || 0) - (a.word_count || 0)).slice(0, 25);
  // check the bots against the homepage and a few important sections
  const paths = [...new Set(["/", ...top.slice(0, 6).map(p => { try { return new URL(p.url).pathname; } catch { return "/"; } })])];
  const looksLlms = t => t && !/^\s*</.test(t) && /^#\s/m.test(t);
  const res = { at: Date.now(), robots_found: robots != null, bots: AIR.botReport(robots || "", paths), paths, llms_found: looksLlms(llms), llms_live: looksLlms(llms) ? llms.slice(0, 20000) : "",
    llms_generated: AIR.llmsTxt(s, pg, new Map(pg.map(p => [p.url, clicksOf(p.url)]))), pages: top.map(p => ({ ...AIR.pageCheck(p), clicks: clicksOf(p.url) })) };
  res.score = res.pages.length ? Math.round(res.pages.reduce((a, p) => a + p.score, 0) / res.pages.length) : null;
  if (res.llms_found) { res.llms_compare = AIR.compareLlms(res.llms_live, res.llms_generated, pg.map(p => p.url));
    // links not among the pages read may still exist (only part of the site is read): check them, and report only the broken ones
    const unk = res.llms_compare.unknown; res.llms_compare.unknown = []; res.llms_compare.broken = [];
    if (unk.length) { progress(`Checking ${unk.length} links in your llms.txt…`);
      try { for (const t of await EXT.traceUrls(unk.slice(0, 20))) if ((t.final_status || 0) >= 400 || t.error) res.llms_compare.broken.push({ url: t.url, status: t.final_status || 0 }); } catch { res.llms_compare.unchecked = unk.length; } } }
  // the score over time
  const prev = await store.get(`aiready:${id}`, null); res.history = [...(prev?.history || []), { at: res.at, score: res.score, search_blocked: res.bots.filter(b => b.kind === "search" && !b.allowed).length }].slice(-24);
  await store.set(`aiready:${id}`, res); return res;
}
export const aiReadinessGet = id => store.get(`aiready:${id}`, null);

// suggested fixes for one page (AI), from the page's own text
export async function aiFixesFor(id, url) {
  const s = await site(id), r = await aiReadinessGet(id), pc = r?.pages?.find(p => p.url === url); if (!pc) throw new GuardrailError("Check AI-answer readiness first.");
  const { fetchPage, extract } = await import("./crawler.js"); const res = await fetchPage(url, { retries: 1 }); if (!res || res.status !== 200) throw new GuardrailError(`Couldn't read ${url}.`);
  const d = extract(url, res.body, new URL(s.url).host);
  const fx = await ask("ai_fixes", P.aiFixes(s, { url, title: d.title, h2: d.h2, text: d._text }, pc.checks.filter(c => !c.ok).map(c => c.label)), { maxTokens: 1500 });
  pc.fixes = fx; await store.set(`aiready:${id}`, r); return fx;
}

// ---------------- image SEO ----------------
export async function imagesRun(id, { limit = 300, all: everything = false } = {}, progress = () => {}, traceFn = EXT.traceUrls) {
  const IMG = await import("./images.js"), pg = await pages(id);
  if (!pg.some(p => Array.isArray(p.imgs_d))) throw new GuardrailError("Read the website again first: images are recorded when pages are read.");
  const all = IMG.collect(pg).sort((a, b) => b.pages.length - a.pages.length || (b.main ? 1 : 0) - (a.main ? 1 : 0)), todo = all.slice(0, limit), checked = new Map();
  // images checked in the last 7 days are reused (sizes rarely change); problems and new images are checked again
  const prev = await imagesGet(id), prevSeen = new Map(Object.entries(prev?.seen || {}));
  for (const im of todo) { const p = prevSeen.get(im.src); if (!everything && p && p.final_status >= 200 && p.final_status < 400 && Date.now() - p.at < 7 * 864e5) checked.set(im.src, { ...p, reused: true }); }
  // headers only (no image is downloaded); image hosts and CDNs handle a few requests at once
  const batches = EXT.politeBatches(todo.filter(i => !checked.has(i.src)).map(i => i.src), 20, 8); let done = 0;
  for (const b of batches) { progress(`Checking images ${done + 1}-${done + b.length} of ${todo.length}…`); for (const t of await traceFn(b, { sizes: true })) checked.set(t.url, t); done += b.length; }
  // one more try, on their own, for images the busy batches couldn't check in time (often the largest ones)
  const slow = todo.filter(im => { const c = checked.get(im.src); return !c || c.skipped || (c.final_status === 0 && (!c.error || c.error === "timed out")); }).map(im => im.src).slice(0, 20);
  for (let i = 0; i < slow.length; i += 2) { progress(`Checking ${slow.length} slow image${slow.length > 1 ? "s" : ""} again…`); try { for (const t of await traceFn(slow.slice(i, i + 2), { sizes: true })) if (t.final_status) checked.set(t.url, t); } catch { } }
  const images = todo.map(im => { const c = checked.get(im.src) || {}; return { ...im, bytes: c.bytes || null, at_least: !!c.at_least, type: c.type || "", status: c.final_status ?? null, error: c.error || "", issues: IMG.judge(im, c) }; });
  const count = k => images.filter(i => i.issues.some(x => x.kind === k)).length;
  const res = { at: Date.now(), total: all.length, checked: images.length, pages: pg.filter(p => (p.imgs_d || []).length).length,
    unchecked: images.filter(i => i.issues.some(x => x.kind === "unchecked")).length,
    counts: { broken: count("broken"), alt_missing: count("alt_missing"), alt_poor: count("alt_poor"), big: count("big"), format: count("format"), dims: count("dims"), lazy_first: count("lazy_first") },
    reused: [...checked.values()].filter(c => c.reused).length,
    seen: Object.fromEntries([...checked.entries()].filter(([, c]) => c.final_status).map(([u, c]) => [u, { final_status: c.final_status, bytes: c.bytes || null, type: c.type || "", at_least: !!c.at_least, at: c.reused ? c.at : Date.now() }])),
    // estimated savings: WebP/AVIF is typically 25-50% smaller than JPEG/PNG (30% assumed); files over 300 KB can usually be compressed by about half
    savings_kb: Math.round(images.reduce((a, i) => { if (!i.bytes) return a; const kb = i.bytes / 1024, old = ["jpg", "jpeg", "png", "gif", "bmp"].includes(i.ext) || /image\/(jpeg|png|gif|bmp)/.test(i.type);
      return a + (kb > 300 ? kb * 0.5 : old && kb > 100 ? kb * 0.3 : 0); }, 0)),
    heavy_kb: Math.round(images.filter(i => i.bytes > 300 * 1024 && !i.srcset).reduce((a, i) => a + i.bytes, 0) / 1024), heavy_kb_srcset: Math.round(images.filter(i => i.bytes > 300 * 1024 && i.srcset).reduce((a, i) => a + i.bytes, 0) / 1024), images: images.filter(i => i.issues.length).slice(0, 400), alts: (await store.get(`images:${id}`, null))?.alts || {} };
  await store.set(`images:${id}`, res); return res;
}
export const imagesGet = id => store.get(`images:${id}`, null);
export async function altSuggestions(id, srcs) {
  const s = await site(id), r = await imagesGet(id); if (!r) throw new GuardrailError("Check images first.");
  const items = r.images.filter(i => srcs.includes(i.src)).slice(0, 20); if (!items.length) return r.alts;
  const out = await ask("alt_text", P.altText(s, items.map(i => ({ file: decodeURIComponent(i.src.split("/").pop().split("?")[0]).slice(0, 80), page: i.page_title, context: i.context }))), { maxTokens: 2000 });
  for (const a of out.alts || []) { const im = items[(a.n || 0) - 1]; if (im && a.alt) r.alts[im.src] = { alt: String(a.alt).slice(0, 160), check: !!a.check }; }
  await store.set(`images:${id}`, r); return r.alts;
}

export async function imagesForPage(id, url) { const r = await imagesGet(id); if (!r) return null; const n = String(url).replace(/\/$/, ""); return r.images.filter(i => i.pages.some(p => p.replace(/\/$/, "") === n)); }

// ---------------- sitemap and robots.txt checker ----------------
export async function sitemapCheck(id, progress = () => {}, traceFn = EXT.traceUrls) {
  const s = await site(id), pg = await pages(id); if (!pg.length) throw new GuardrailError("Read the website first.");
  const AIR = await import("./aiready.js"), { fetchPage } = await import("./crawler.js"), origin = new URL(s.url).origin;
  const ft = async u => { const r = await fetchPage(u, { retries: 1 }); return { status: r?.status || 0, text: r?.body || "" }; };
  const norm = u => { try { const x = new URL(u); return (x.hostname.replace(/^www\./, "") + x.pathname.replace(/\/$/, "") + x.search).toLowerCase(); } catch { return String(u).toLowerCase(); } };
  progress("Reading robots.txt…");
  const robotsR = await ft(`${origin}/robots.txt`), robots = robotsR.status === 200 && !/^\s*</.test(robotsR.text) ? robotsR.text : "";
  const listed = [...robots.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map(m => m[1]);
  progress("Reading your sitemaps…");
  const res = await COMP.collect(s.url, ft, { maxFiles: 60, maxUrls: 50000 });
  const urls = Object.entries(res.urls), inMap = new Set(urls.map(([u]) => norm(u)));
  // health: files, counts per file, last-changed dates
  const perFile = new Map(); for (const k of Object.values(res.file_of || {})) perFile.set(k, (perFile.get(k) || 0) + 1);
  const files = (res.files || []).map((f, k) => ({ url: f.url, count: perFile.get(k) || 0, over_limit: (perFile.get(k) || 0) > 50000 }));
  const lm = urls.map(([, v]) => v).filter(Boolean), today = new Date().toISOString().slice(0, 10);
  const lmCount = new Map(); for (const v of lm) lmCount.set(v, (lmCount.get(v) || 0) + 1);
  const topLm = [...lmCount.entries()].sort((a, b) => b[1] - a[1])[0];
  const byNorm = new Map(pg.map(p => [norm(p.url), p]));
  const stale = urls.filter(([u, v]) => { const p = byNorm.get(norm(u)); return v && p?.date_modified && p.date_modified > v; }).map(([u, v]) => ({ url: u, lastmod: v, page_updated: byNorm.get(norm(u)).date_modified }));
  const dates = { total: urls.length, with: lm.length, future: lm.filter(v => v > today).length, same: topLm && topLm[1] >= 20 && topLm[1] / Math.max(lm.length, 1) >= 0.8 ? { date: topLm[0], count: topLm[1] } : null, stale: stale.slice(0, 30), stale_count: stale.length };
  // important pages missing from the sitemaps
  const clicks = new Map(); for (const r of (await gscImports(id))[0]?.rows || []) if (r.kind === "page" && r.page) clicks.set(norm(r.page), (clicks.get(norm(r.page)) || 0) + (r.clicks || 0));
  const selfCanon = p => !p.canonical || norm(p.canonical) === norm(p.url);
  const missing = pg.filter(p => !p.noindex && selfCanon(p) && !inMap.has(norm(p.url)) && ((clicks.get(norm(p.url)) || 0) > 0 || (p.inbound_links || 0) >= 3))
    .map(p => ({ url: p.url, clicks: clicks.get(norm(p.url)) || 0, inbound: p.inbound_links || 0 })).sort((a, b) => b.clicks - a.clicks || b.inbound - a.inbound);
  // entries that shouldn't be there: noindex or canonical elsewhere (pages read), redirects and errors (a sample checked)
  const bad = [];
  for (const [u] of urls) { const p = byNorm.get(norm(u)); if (!p) continue;
    if (p.noindex) bad.push({ url: u, why: "noindex", text: "marked noindex: remove it from the sitemap, or remove the noindex" });
    else if (!selfCanon(p)) bad.push({ url: u, why: "canonical", text: `its canonical points to ${p.canonical}: list that address instead` }); }
  const unread = urls.map(([u]) => u).filter(u => !byNorm.has(norm(u))), sample = [...unread, ...urls.map(([u]) => u).filter(u => byNorm.has(norm(u)))].slice(0, 100);   // entries the reader didn't visit first
  progress(`Checking ${sample.length} sitemap addresses…`); const checked = [];
  for (const b of EXT.politeBatches(sample, 20, 6)) { try { checked.push(...await traceFn(b)); } catch { break; } }
  for (const t of checked) { if (t.final_status >= 400) bad.push({ url: t.url, why: "error", text: `returns ${t.final_status}: remove it from the sitemap` });
    else if (t.final_status >= 200 && t.hops?.length > 1 && norm(t.final) !== norm(t.url)) bad.push({ url: t.url, why: "redirect", text: `redirects to ${t.final}: list the final address instead` }); }
  // robots.txt: Google blocked from important pages, sitemap entries, or the files it needs to render pages
  const groups = AIR.parseRobots(robots), pathOf = u => { try { const x = new URL(u); return x.pathname + x.search; } catch { return "/"; } };
  const important = [...new Set([...pg.filter(p => (clicks.get(norm(p.url)) || 0) > 0).map(p => p.url), ...urls.slice(0, 300).map(([u]) => u)])];
  const blocked = important.filter(u => !AIR.allowed(groups, "Googlebot", pathOf(u)).allowed).slice(0, 50).map(u => ({ url: u, rule: AIR.allowed(groups, "Googlebot", pathOf(u)).rule }));
  const resources = ["/assets/app.css", "/_next/static/chunks/main.js", "/static/js/main.js", "/wp-content/themes/theme/style.css", "/wp-includes/js/jquery.js", "/css/site.css", "/js/site.js"]
    .filter(p => !AIR.allowed(groups, "Googlebot", p).allowed).map(p => ({ path: p, rule: AIR.allowed(groups, "Googlebot", p).rule }));
  // Google's own view, with Search Console connected: submitted sitemaps, last read, errors and warnings
  let google = null; try { const G = await import("./gscconn.js"); const sm = await G.sitemaps(id); if (sm) { const found = new Set([...listed, ...(res.files || []).map(f => f.url)].map(norm));
    google = { sitemaps: sm, not_submitted: [...new Set(listed)].filter(u => !sm.some(x => norm(x.path) === norm(u))), unknown: sm.filter(x => !found.has(norm(x.path))).map(x => x.path) }; } } catch { }
  const out = { at: Date.now(), google, robots_found: !!robots, sitemaps_in_robots: listed, files, total: urls.length, capped: !!res.capped, incomplete: !!res.incomplete, skipped_gz: res.skipped_gz || 0,
    dates, missing: missing.slice(0, 100), missing_count: missing.length, bad: bad.slice(0, 150), bad_count: bad.length, checked: checked.length, blocked, resources };
  await store.set(`sitemapcheck:${id}`, out); return out;
}
export const sitemapCheckGet = id => store.get(`sitemapcheck:${id}`, null);

// fixes for a developer: what to add to and remove from the sitemaps
export async function sitemapFixesCsv(id) {
  const d = await sitemapCheckGet(id); if (!d) throw new GuardrailError("Check the sitemaps first.");
  const q = v => /[",\n]/.test(String(v ?? "")) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? "");
  const rows = [...d.missing.map(m => ["add", m.url, `important page (${m.clicks} Google clicks, ${m.inbound} internal links)`]), ...d.bad.map(b => [b.why === "redirect" || b.why === "canonical" ? "replace" : "remove", b.url, b.text]),
    ...d.dates.stale.map(s2 => ["update lastmod", s2.url, `page updated ${s2.page_updated}, sitemap says ${s2.lastmod}`])];
  return "action,address,reason\n" + rows.map(r => r.map(q).join(",")).join("\n") + "\n";
}

// ---------------- approval steps (per website) ----------------
export const workflow = async id => (await store.get(`workflow:${id}`, null)) || { steps: [] };
export async function setWorkflow(id, steps, { resolveFirst } = {}) {
  // "Legal (Rahul)" names who signs off that step
  const clean = [...new Map((steps || []).map(x => String(x || "").trim()).filter(Boolean).map(x => { const m = x.match(/^(.*?)\s*\(([^)]+)\)\s*$/); const name = (m ? m[1] : x).trim().slice(0, 40); return [name.toLowerCase(), { name, ...(m ? { who: m[2].trim().slice(0, 60) } : {}) }]; })).values()].slice(0, 6);
  const prev = await workflow(id), wf = { steps: clean, resolve_first: resolveFirst === undefined ? !!prev.resolve_first : !!resolveFirst, updated_at: Date.now() };
  await store.set(`workflow:${id}`, wf); return wf;
}
export async function signOff(id, cid, { step, by, note = "" }) {
  const wf = await workflow(id), [all, i] = await loadItem(id, cid), item = all[i], k = wf.steps.findIndex(x => x.name === step);
  if (k < 0) throw new GuardrailError("Unknown approval step.");
  if (!String(by || "").trim()) throw new GuardrailError("Enter your name.");
  const done = new Set((item.signoffs || []).map(x => x.step)), before = wf.steps.slice(0, k).filter(x => !done.has(x.name));
  if (before.length) throw new GuardrailError(`Sign off ${before.map(x => x.name).join(", ")} first.`);
  if (done.has(step)) throw new GuardrailError("Already signed off.");
  item.signoffs = [...(item.signoffs || []), { step, by: String(by).trim().slice(0, 60), note: String(note || "").slice(0, 300), at: Date.now() }]; item.updated_at = Date.now();
  await store.set(`contents:${id}`, all); return item.signoffs;
}
// ---------------- comments and suggestions (each its own record, so teammates never overwrite each other) ----------------
const CMKEY = id => `comments:${id}`;
export const blockKey = t => { let h = 2166136261; const x = String(t || "").replace(/\s+/g, " ").trim(); for (let i = 0; i < x.length; i++) { h ^= x.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36); };
export async function commentsFor(id, cid) { return ((await store.get(CMKEY(id), [])) || []).filter(c => c.cid === cid && !c.deleted); }
async function saveComment(id, rec) { const list = (await store.get(CMKEY(id), [])) || [], i = list.findIndex(c => c.id === rec.id); if (i >= 0) list[i] = rec; else list.push(rec); await store.set(CMKEY(id), list); return rec; }
export async function addComment(id, cid, { block = "", text = "", by = "", suggestion = null, parent = null }) {
  if (!String(by).trim()) throw new GuardrailError("Enter your name (Settings → Team & data, or your account).");
  if (!String(text).trim() && !suggestion) throw new GuardrailError("Write a comment.");
  const rec = { id: store.newId(), cid, parent, block_key: block ? blockKey(block) : "", quote: String(block || "").replace(/\s+/g, " ").slice(0, 160), text: String(text).trim().slice(0, 2000), by: String(by).trim().slice(0, 60),
    kind: suggestion ? "suggestion" : "comment", ...(suggestion ? { suggestion: { from: String(block), to: String(suggestion).trim().slice(0, 6000) }, status: "open" } : {}), resolved: false, at: Date.now(), updated_at: Date.now() };
  return saveComment(id, rec);
}
export async function resolveComment(id, cmid, resolved = true) { const list = (await store.get(CMKEY(id), [])) || [], c = list.find(x => x.id === cmid); if (!c) throw new GuardrailError("Comment not found."); c.resolved = !!resolved; c.updated_at = Date.now(); return saveComment(id, c); }
// accept or reject a suggested rewording: accepting replaces that paragraph (a new version is saved and the page re-checked)
export async function decideSuggestion(id, cmid, { accept, by = "" }) {
  const list = (await store.get(CMKEY(id), [])) || [], c = list.find(x => x.id === cmid); if (!c || c.kind !== "suggestion") throw new GuardrailError("Suggestion not found.");
  if (accept) { const [all, i] = await loadItem(id, c.cid), md = all[i].payload.body_markdown, TDm = await import("./trackdiff.js"), bl = TDm.blocks(md), k = bl.findIndex(b => blockKey(b) === c.block_key);
    if (k < 0) throw new GuardrailError("That paragraph has changed since the suggestion was made. Copy the suggested text in by hand.");
    bl[k] = c.suggestion.to; await saveDraft(id, c.cid, { markdown: bl.join("\n\n"), source: "suggestion", note: `Suggestion by ${c.by} accepted${by ? ` by ${by}` : ""}` }); }
  c.status = accept ? "accepted" : "rejected"; c.resolved = true; c.decided_by = String(by || "").slice(0, 60); c.updated_at = Date.now(); return saveComment(id, c);
}

// for one person: open comments that mention them, and pages waiting for their sign-off
export async function forPerson(id, name) {
  const me = String(name || "").trim().toLowerCase(); if (!me) return { mentions: [], signoffs: [] };
  const first = me.split(/\s+/)[0], items = await contents(id), byId = new Map(items.map(c => [c.id, c]));
  const all = ((await store.get(CMKEY(id), [])) || []).filter(c => !c.deleted), threadOf = c => c.parent ? all.find(x => x.id === c.parent) : c;
  const mentions = all.filter(c => new RegExp(`@${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(c.text || "") && !threadOf(c)?.resolved && c.by.toLowerCase() !== me && byId.has(c.cid))
    .map(c => ({ cid: c.cid, title: byId.get(c.cid).title || byId.get(c.cid).keyword, by: c.by, text: c.text, at: c.at })).sort((a, b) => b.at - a.at).slice(0, 20);
  const wf = await workflow(id), signoffs = [];
  for (const it of items) { if (it.status === "approved") continue; const done = new Set((it.signoffs || []).map(x => x.step)), next = wf.steps.find(st => !done.has(st.name));
    if (next?.who && next.who.toLowerCase().split(/\s+/)[0] === first) signoffs.push({ cid: it.id, title: it.title || it.keyword, step: next.name }); }
  return { mentions, signoffs };
}
export async function openCommentCounts(id) { const m = {}; for (const c of ((await store.get(CMKEY(id), [])) || [])) if (!c.parent && !c.resolved && !c.deleted) m[c.cid] = (m[c.cid] || 0) + 1; return m; }

// problem counts for the Site health tabs, from each check's saved results (null = not checked yet)
export async function healthCounts(id) {
  const n = v => v == null ? null : v;
  const sp = await SPEED.get(id), ix = await IDX.get(id), lm = await store.get(`linkmap-cache:${id}`, null), sc = await store.get(`schemacheck:${id}`, null);
  const ex = await store.get(`extlinks:${id}`, null), im = await store.get(`images:${id}`, null), sm = await store.get(`sitemapcheck:${id}`, null);
  let dupes = null; try { const pg = await pages(id); if (pg.some(p => p.sig)) dupes = (await duplicates(id)).groups.length; } catch { }
  return {
    speed: sp ? (sp.pages || []).filter(p => (p.score != null && p.score < 50) || p.field?.category === "SLOW").length : null,
    index: ix ? (ix.results || []).filter(r => r.status && r.status !== "ok").length : null,
    sitemaps: sm ? (sm.missing_count || 0) + (sm.bad_count || 0) + (sm.blocked || []).length : null,
    // pages with no links to them only mean something when most of the site was read
    links: lm ? ((lm.data?.coverage ?? 1) < 0.5 ? "partial" : (lm.data?.rows || []).filter(r => r.inbound === 0 && r.url !== lm.data.home).length) : null,
    ext: ex ? (ex.results || []).filter(r => ["broken", "domain", "removed", "server"].includes(r.verdict)).length : null,
    dupes: n(dupes),
    schema: sc ? (sc.pages || []).filter(p => (p.parse_errors || []).length || (p.items || []).some(it => (it.errors || []).length)).length : null,
    images: im ? (im.images || []).filter(i => i.issues.some(x => x.level === "fail" || x.level === "warn")).length : null,
  };
}
