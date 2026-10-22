// prompts.js - every prompt carries the site context; Google's rules ride in the system prompt (llm.js)
import { BUSINESS_TYPES, SEO, INTENTS, SCORECARD, PAGE_TYPES, STRUCTURES, SATISFACTION_FACTORS, SOURCE_TIERS, SPAM_RISK_CHECKS, URL_ACTIONS } from "./rules.js";
const J = x => JSON.stringify(x);
// the business's own knowledge (facts, case studies, product details) retrieved for this step
export const kbLine = site => site?.knowledge ? `\nTHE PUBLISHER'S OWN KNOWLEDGE (real facts, examples and proof from the business. Use them wherever relevant instead of placeholders, keep numbers exactly as given, never contradict them, and never invent beyond them):\n"""\n${String(site.knowledge).slice(0, 12000)}\n"""\n` : "";
export const typeLine = site => BUSINESS_TYPES[site?.business_type] && BUSINESS_TYPES[site.business_type].guidance ? `\nTYPE OF WEBSITE: ${BUSINESS_TYPES[site.business_type].label}. ${BUSINESS_TYPES[site.business_type].guidance}\n` : "";
export const langLine = lang => lang && lang.name && !/^english/i.test(lang.name) ? `\nLANGUAGE: write everything (headings, text, title tag, meta description, FAQs) in ${lang.name}. Keep the keyword as given.\n` : "";
export function styleText(style) {
  if (!style) return "";
  const parts = [];
  if (style.tone) parts.push(`Tone of voice: ${style.tone}`);
  if (style.reading_level) parts.push(`Reading level: ${style.reading_level}`);
  if (style.person) parts.push(`Write in ${style.person}`);
  if (style.spelling) parts.push(`Spelling: ${style.spelling}`);
  if (style.avoid) parts.push(`Never use these words or phrases: ${style.avoid}`);
  if (style.cta) parts.push(`Preferred call to action: ${style.cta}`);
  if (style.notes) parts.push(`Other house rules: ${style.notes}`);
  return parts.length ? "\nHOUSE STYLE (follow exactly):\n- " + parts.join("\n- ") + "\n" : "";
}
const I = Object.keys(INTENTS).join("|"), A = Object.keys(URL_ACTIONS).join("|");

export function siteContext(site, pages, max = 60000) {
  const s = site.summary || {};
  const out = [`PUBLISHER: ${site.name || site.url} (${site.url})`, `WHAT THEY OFFER: ${site.product || "not described"}`, ...(BUSINESS_TYPES[site.business_type] ? [`TYPE OF WEBSITE: ${BUSINESS_TYPES[site.business_type].label}. ${BUSINESS_TYPES[site.business_type].guidance} Typical next steps for readers: ${BUSINESS_TYPES[site.business_type].cta}.`] : []), `AUDIENCE: ${site.audience || "not described"}`,
    `SITE SIZE: ${s.urls_discovered ?? "?"} URLs; pages read: ${pages.length}; median words ${s.median_word_count ?? "?"}`,
    `SECTIONS: ${(s.sections || []).slice(0, 20).map(([a, b]) => `${a}: ${b}`).join(", ")}`,
    `LANGUAGES: ${(s.languages || []).slice(0, 12).map(([a, b]) => `${a}: ${b}`).join(", ")}`, "EXISTING PAGES (url | title | intent | words | H2s):"];
  if (site.knowledge) out.push(kbLine(site).trim());
  let n = 0;
  for (const p of pages) {
    const line = `- ${p.url} | ${p.title || ""} | ${p.intent || ""} | ${p.word_count || 0}w | ${(p.h2 || []).slice(0, 4).join(" / ")}`;
    if (n + line.length > max) { out.push(`(…${pages.length} pages total, list truncated)`); break; }
    out.push(line); n += line.length;
  }
  return out.join("\n");
}
export const strategy = (site, pages) => `${siteContext(site, pages)}

TASK: Analyse the existing website content and recommend what to create next.
1. Describe what the site covers today and how well it fits the product.
2. Find risks against Google's rules (templated sections, off-topic content, mass translations, thin pages, missing authors).
3. Recommend NEW content only where the site has a real gap. Do not recommend topics already covered; recommend improving those pages instead.
4. For each recommendation, give the primary keyword, its search intent, the right page type, and the information gain needed.

Return JSON:
{"summary":"3 sentences","fit_score":0-10,"strengths":["..."],
 "risks":[{"issue":"","evidence":"sections/URLs/counts","severity":"high|medium|low","fix":""}],
 "section_review":[{"section":"/path","verdict":"keep|improve|merge|remove|noindex","reason":""}],
 "pages_to_improve":[{"url":"existing URL","why":"","what_to_add":""}],
 "new_content":[{"keyword":"","intent":"${I}","page_type":"${PAGE_TYPES.join("|")}","title_idea":"","why_gap":"","information_gain":"","priority":"high|medium|low","link_from":["existing URLs"]}]}
Give 8-12 new_content items, 5-10 pages_to_improve, all risks you can evidence.`;

export const keywordAnalysis = (site, pages, keyword, matches, v) => `${siteContext(site, pages, 30000)}

KEYWORD: "${keyword}"
RULE-BASED INTENT GUESS: ${v.keyword_intent}
EXISTING PAGES THAT MATCH THIS KEYWORD (similarity score, detected intent):
${JSON.stringify(matches, null, 1)}

TASK: Decide whether the site should create a new page for this keyword.
- Determine the TRUE dominant search intent of the keyword (what a searcher wants), and any secondary intents.
- For each matching existing page, judge its actual intent and whether it already satisfies the keyword's dominant intent.
- If an existing page already serves the same intent: recommend UPDATING it (say what to add). Do not recommend a duplicate page.
- If several existing pages compete for the same intent: choose ONE primary URL and say which others to merge, redirect or keep (different purpose).
- If the keyword is not worth a page (off-topic, too thin, or better as a section of another page): decision = skip.
- Actions: ${Object.entries(URL_ACTIONS).map(([k, x]) => `${k} = ${x}`).join("; ")}
- Suggest alternative keywords/angles with a DIFFERENT search intent the site does not cover yet, each with a concrete page idea.
- Suggest which existing pages should link TO the page that owns this keyword.

Return JSON:
{"dominant_intent":"${I}","secondary_intents":["..."],"intent_explanation":"what the searcher wants, 1-2 sentences",
 "serp_format_expected":"what format Google likely shows (guide, list, tool, comparison...)",
 "decision":"${A}","decision_reason":"","primary_url":"existing URL that should own this keyword, or empty if create",
 "consolidation":[{"url":"","action":"merge|redirect|keep","reason":""}],
 "link_to_new_page_from":[{"url":"existing URL that should link TO the page for this keyword","anchor":"","reason":""}],
 "existing_assessment":[{"url":"","actual_intent":"","serves_keyword":true,"gap":"what it lacks"}],
 "update_plan":{"url":"page to update or empty","additions":["..."]},
 "different_intent_options":[{"keyword":"","intent":"","page_type":"","angle":"how it differs from existing pages","title_idea":""}]}`;

export const satisfaction = (site, keyword, intent) => `Model the person who searches "${keyword}" (intent: ${intent}) and lands on a page from ${site.name || site.url} (${site.product || ""}).

Return JSON:
{"user_problem":"the real problem behind the query","user_goal":"what they want to accomplish","why_now":"what triggered the search",
 "knowledge_level":"beginner|intermediate|expert","expected_answer":"what a genuinely helpful answer contains, 2-3 sentences",
 "required_information":["must-have items"],"action_after_reading":"what the reader should be able to DO",
 "best_format":"guide|comparison|template|checklist|calculator|explainer|landing page|video tutorial","format_reason":"",
 "question_map":{"primary":"","supporting":["4-6"],"decision":["2-4"],"action":["2-4"]},
 "next_questions":[{"question":"","own_page":false}],"trust_needs":["what would make them trust the answer"]}`;

export const brief = (site, pages, keyword, intent, pageType, audience, notes, matches, sat, structure, serp = null, lang = null) => `${siteContext(site, pages, 30000)}

CREATE A BRIEF for one page.
Primary keyword: "${keyword}"
Required search intent: ${intent} (${INTENTS[intent]?.label || ""}). Formats that match this intent: ${J(INTENTS[intent]?.formats || [])}
Page type: ${pageType}
Target reader: ${audience || "infer from product"}
Publisher's notes, data and proof available: ${notes || "none provided - use placeholders"}
Related existing pages (must NOT be duplicated; differentiate and link): ${J(matches.slice(0, 6))}
${sat ? `SEARCHER MODEL (the page must satisfy this completely): ${J(sat)}` : `FIRST model the searcher: the real problem behind "${keyword}", their goal, what a genuinely helpful answer contains, and what they should be able to DO after reading. Then plan the page so it satisfies that completely.`}${langLine(lang)}
REQUIRED STRUCTURE for this intent (${structure}): ${J(STRUCTURES[structure] || [])}
Build the outline from the required structure, and make sure every question in the question map is answered somewhere.
${serp && serp.searched ? `WHAT CURRENTLY RANKS for this search (from web research): dominant format: ${serp.dominant_format || ""}; topics most top pages cover: ${JSON.stringify((serp.must_cover || []).map(x => x.topic))}; questions searchers ask: ${JSON.stringify(serp.questions || [])}; gaps the top results miss (win here): ${JSON.stringify(serp.gaps || [])}; recommended angle: ${serp.recommended_angle || ""}.
Cover the topics searchers expect, answer the questions, and make the gaps this page's information gain. Do not copy any ranking page.` : ""}

Return JSON:
{${sat ? "" : `"searcher":{"user_problem":"","user_goal":"","knowledge_level":"beginner|intermediate|expert","expected_answer":"","required_information":["..."],"action_after_reading":"","best_format":"guide|comparison|template|checklist|calculator|explainer|landing page|video tutorial","format_reason":"","question_map":{"primary":"","supporting":["4-6"],"decision":["2-4"],"action":["2-4"]},"next_questions":[{"question":"","own_page":false}],"trust_needs":["..."]},
 `}"angle":"how this page differs from existing pages and competitors","reader":"","main_question":"",
 "direct_answer":"2-3 sentence answer to the main question (max ${SEO.direct_answer_max_words} words)",
 "secondary_keywords":["5-8 related terms used naturally"],"outline":[{"h2":"","h3":["..."],"notes":"what goes here"}],
 "faqs":["${SEO.faq_min}-${SEO.faq_max} real follow-up questions searchers ask"],"information_gain":["3-4 specific unique additions"],
 "proof_needed":["screenshots/data/quotes the publisher must supply"],
 "internal_links":[{"url":"ONLY URLs from EXISTING PAGES above","anchor":"descriptive anchor text","placement":"which section"}],
 "link_from_existing":[{"url":"existing URL that should link TO this new page","anchor":"","where":"section of that page"}],
 "cta":"next step that fits the reader's stage (for early-stage learning searches, offer something helpful rather than pushing a sale, booking or demo)"}
Outline must have ${SEO.min_h2}-${SEO.max_h2} H2s that match the ${intent} intent. Give ${SEO.internal_links_min}-${SEO.internal_links_max} internal links.`;

export function article(site, keyword, intent, pageType, briefJson, author, validUrls, fixes = null, previous = null, style = null, lang = null) {
  let fix = "";
  if (fixes && fixes.length) { fix = "\nREVISE THE PREVIOUS DRAFT. Fix every issue below, keep everything that already works:\n- " + fixes.join("\n- "); if (previous) fix += "\n\nPREVIOUS DRAFT (markdown):\n" + previous.slice(0, 50000); }
  const minw = SEO.min_words[pageType] || 800;
  return `Write the full page from this brief, for ${site.name || site.url}.
Primary keyword: "${keyword}" | Search intent: ${intent} | Page type: ${pageType} | Author: ${author || "[ADD AUTHOR NAME AND ROLE]"}
Product: ${site.product || ""}
BRIEF: ${J(briefJson)}
ALLOWED INTERNAL LINK URLS (use only these, as markdown links with descriptive anchors): ${J(validUrls.slice(0, 200))}
${styleText(style)}${typeLine(site)}${kbLine(site)}${langLine(lang)}${fix}

SEO REQUIREMENTS:
- title_tag ${SEO.title_min_chars}-${SEO.title_max_chars} characters, keyword near the start, no clickbait.
- meta_description ${SEO.meta_min_chars}-${SEO.meta_max_chars} characters, honest summary with the keyword.
- slug: lowercase, hyphens, max ${SEO.slug_max_words} words.
- body_markdown starts with exactly ONE "# " H1, then the direct answer paragraph (max ${SEO.direct_answer_max_words} words, contains the keyword), then ${SEO.min_h2}-${SEO.max_h2} "## " H2 sections (use "### " H3 where useful), steps/tables/lists where the content has that shape.
- At least ${minw} words in body_markdown. Paragraphs under ${SEO.paragraph_max_words} words.
- ${SEO.internal_links_min}-${SEO.internal_links_max} internal links inside body_markdown, only from the allowed list.
- Include a "## Frequently asked questions" section at the end with ${SEO.faq_min}-${SEO.faq_max} Q&As as "### question" + answer, and repeat them in faqs.
- No unnatural keyword repetition (no density target; use natural language and synonyms). No filler phrases.
- Answer key questions in short, self-contained "answer blocks" (2-4 sentences directly under the question heading) so they can be quoted accurately.
- Every factual claim either links to a source, comes from the publisher's notes, or carries [SOURCE NEEDED: ...].
- Put placeholders like [ADD SCREENSHOT: ...], [ADD DATA: ...], [SOURCE NEEDED: ...], [EXPERT QUOTE: ...] where first-hand proof belongs. Never invent numbers, quotes or customers. Use the publisher's notes wherever they fit, so fewer placeholders are needed; keep placeholders to the places that truly need proof (usually 3-8).

BEFORE YOU ANSWER, CHECK: every H2 is specific to this topic (no generic "Introduction", "Conclusion" or "Final thoughts"); no paragraph or sentence is repeated; sentences average under 22 words; each section says something the others don't; the opening answers the main question in plain words.

Return JSON:
{"title_tag":"","meta_description":"","slug":"","h1":"","direct_answer":"","body_markdown":"full page in markdown",
 "faqs":[{"q":"","a":""}],"internal_links":[{"url":"","anchor":""}],"secondary_keywords":["..."],
 "image_suggestions":[{"placement":"","description":"","alt":""}],"proof_placeholders":["each placeholder used"],
 "ai_disclosure":"one honest sentence on how the page was produced, for the author box if appropriate","cta":""}`;
}
export const evaluate = (keyword, intent, sat, site, body, matches) => `Evaluate this page strictly, as the searcher and as a Google quality rater would.
Keyword: "${keyword}" | Intent: ${intent} | Publisher: ${site.name || site.url} - ${site.product || ""}
Searcher model: ${J(sat || {})}
Existing similar pages on the site: ${J(matches.slice(0, 5))}

Score 0-100 each factor: ${J(SATISFACTION_FACTORS)}.
Task completion 0-100: after reading, can the person actually do what they came to do?
Mark each question in the searcher's question map as answered / partial / missing.
AI citation readiness 0-100: direct answers, self-contained passages, clear definitions, explicit sources, original facts.
Content quality 0-100 against Google's helpful-content questions (score each 0-2): ${J(SCORECARD)}
Spam-risk audit (internal diagnostics, not Google's systems): rate each of ${J(SPAM_RISK_CHECKS)} as none|low|medium|high with evidence.
Placeholders such as [ADD SCREENSHOT] or [SOURCE NEEDED] are EXPECTED: the publisher fills them before publishing.
Do not raise issues asking to fill placeholders; judge whether the page is otherwise complete and whether each placeholder is in the right place.
Score evidence on what the writer controls: claims are sourced, attributed to the publisher, or clearly flagged.${site.knowledge ? `\nFacts that match THE PUBLISHER'S OWN KNOWLEDGE below are verified evidence.\n${kbLine(site)}` : ""}

Return JSON:
{"satisfaction":{"factors":{"understands_question":0},"score":0,"missing":["what the searcher still lacks"]},
 "task_completion":{"score":0,"blockers":["..."]},
 "question_coverage":[{"question":"","type":"primary|supporting|decision|action","status":"answered|partial|missing"}],
 "ai_citation_readiness":{"score":0,"weak_passages":["quote a vague sentence and how to make it citable"]},
 "content_quality":{"score":0,"scorecard":[{"q":1,"score":0,"reason":""}]},
 "evidence":{"score":0,"note":""},
 "spam_risk":[{"check":"","level":"none|low|medium|high","evidence":""}],
 "issues":[{"severity":"critical|major|minor","area":"satisfaction|task|evidence|seo|spam|citation|quality","issue":"","fix":"concrete instruction"}]}

PAGE:
"""
${body.slice(0, 60000)}
"""`;
export const claims = (keyword, body) => `Fact-check this page about "${keyword}".
1. Extract every factual claim a reader could verify (statistics, dates, prices, features, product capabilities, research findings). Skip opinions and plain instructions.
2. Use web search to verify the important ones (prioritise numbers, prices, competitor features, research).
3. Classify sources: ${Object.entries(SOURCE_TIERS).map(([k, v]) => `Tier ${k}: ${v}`).join("; ")}.
Return JSON:
{"claims":[{"claim":"exact sentence or phrase","status":"supported|unsupported|false|outdated|needs_publisher_data","source_url":"","source_tier":1,"note":"","correction":"corrected text with a markdown source link, or the claim with [SOURCE NEEDED: ...]"}],
 "summary":{"total":0,"supported":0,"unsupported":0,"false":0,"outdated":0,"needs_publisher_data":0}}
Never mark a claim supported without a real source you found. Claims about the publisher's own product that only they can confirm = needs_publisher_data.

PAGE:
"""
${body.slice(0, 50000)}
"""`;
export const urlMapReview = (site, groups) => `These groups of pages on ${site.url} look like they target the same topic with the same search intent (possible cannibalisation).
For each group choose ONE primary URL and an action for every other URL. Actions: ${J(URL_ACTIONS)}.
Pages with genuinely different purposes (e.g. a tool page vs a how-to guide) should be kept, with a note on how to differentiate.
Groups: ${J(groups.slice(0, 40))}
Return JSON: {"groups":[{"topic":"","intent":"","primary_url":"","urls":[{"url":"","action":"keep|merge|redirect|update","reason":""}],"priority":"P0|P1|P2|P3"}]}`;
export const audit = (site, pages, keyword, draft, matches) => `${siteContext(site, pages, 25000)}

AUDIT this draft before publishing. Keyword: "${keyword}".
Existing pages that may overlap: ${J(matches.slice(0, 6))}
Check: search intent match, duplication with existing pages, Google's rules, E-E-A-T, SEO structure (H1, H2s, FAQs, internal links), filler.
Score the 10 questions 0/1/2: ${J(SCORECARD)}
Return JSON: {"scores":[{"q":1,"score":0,"reason":""}],"intent":{"detected":"","matches_keyword":true,"note":""},
"duplicates":[{"url":"","issue":"","action":"update existing|merge|differentiate"}],
"risk_flags":[{"flag":"","severity":"high|medium|low","detail":""}],
"internal_links":[{"url":"existing URL","anchor":""}],
"satisfaction":{"score":0,"missing":["what the searcher still lacks"]},"task_completion":{"score":0,"blockers":["..."]},
"ai_citation_readiness":{"score":0,"weak_passages":["..."]},
"spam_risk":[{"check":"one of ${Object.keys(SPAM_RISK_CHECKS).join(", ")}","level":"none|low|medium|high","evidence":""}],
"suggested_title_tag":"","suggested_meta_description":"","suggested_h2s":["..."],"suggested_faqs":["..."],
"top_fixes":["5 concrete edits"]}

DRAFT:
"""
${draft.slice(0, 60000)}
"""`;
export const visibility = prompt => `Answer this question the way a helpful AI assistant would for a real user, using web search for current information.
Question: "${prompt}"

Then return JSON only:
{"answer":"your full answer as you would give it","sources":["every URL you cited or relied on"],
 "brands_mentioned":["every company or product named in your answer, in order of appearance"]}`;

export const keywordIdeas = (site, pages, seed, focus) => `${siteContext(site, pages, 15000)}

TASK: Suggest keyword ideas around the seed topic "${seed}" that this publisher could genuinely be an authority on.
${focus ? `Focus: ${focus}` : ""}
- Mix: questions people ask, long-tail problem searches, comparisons, use cases by role or industry, and buying-stage searches.
- Only ideas that fit what the publisher sells or knows. No off-topic traffic grabs (Google penalises those site-wide).
- Phrase each keyword the way a real person would type it into Google. Lowercase.
- Do NOT invent search volumes or difficulty; you don't have that data.
- Prefer ideas that need different pages (different search intent or format) over near-duplicates of each other.

Return JSON:
{"ideas":[{"keyword":"","intent":"${I}","type":"question|long_tail|comparison|use_case|buying|problem","why":"one line: why this fits the publisher","suggested_page_type":"${PAGE_TYPES.join("|")}","priority":"high|medium|low"}],
 "note":"one line on how to validate these with real search data"}
Give 20-30 ideas.`;

// ---- What currently ranks (uses the provider's web search) ----
export const serpResearch = (site, keyword) => `Research what currently ranks for the search "${keyword}".
Use web search the way a searcher would, then study the top results. The publisher is ${site.name || site.url} (${site.product || ""}).

Report only what you actually found. Never invent results, URLs, or statistics. If you couldn't search, set "searched": false and leave lists empty.

Return JSON:
{"searched":true,
 "results":[{"title":"","url":"","type":"guide|listicle|comparison|tool|product_page|template|video|forum|news|docs|other","angle":"one line: what this page offers"}],
 "dominant_format":"the format most top results use, in plain words",
 "format_mix":[{"type":"guide","count":0}],
 "must_cover":[{"topic":"a topic or section most top pages include","share":"most|some|few"}],
 "questions":["questions searchers ask around this topic (People-also-ask style), 5-8"],
 "gaps":["useful things the top results miss or do poorly, 3-5: this is where a new page can win"],
 "competition":{"level":"low|medium|high","reason":"who ranks: big brands, niche sites, forums... in one line"},
 "recommended_angle":"how ${site.name || "the publisher"} could stand out, based on what it genuinely knows",
 "recommended_page_type":"blog_post|how_to_guide|pillar_guide|comparison|alternatives|listicle|glossary|landing_page|use_case|case_study|help_article",
 "length_note":"rough depth of top results (e.g. short answer, 1,500-word guide)"}
List 5-10 results.`;

// ---- Update plan for an existing page ----
export const updatePlan = (site, keyword, page, serp, analysis) => `You are improving an EXISTING page so it fully satisfies the search "${keyword}".
Publisher: ${site.name || site.url} - ${site.product || ""}
Search intent: ${analysis?.dominant_intent || ""}. ${analysis?.intent_explanation || ""}
WHAT CURRENTLY RANKS (from web research; may be empty): ${JSON.stringify(serp || {})}

THE EXISTING PAGE
URL: ${page.url}
Title: ${page.title}
Meta description: ${page.meta_description}
H1: ${(page.h1 || []).join(" | ")}
Outline: ${(page.outline || []).join(" / ")}
Words: ${page.word_count}
Text:
"""
${(page.text || "").slice(0, 30000)}
"""

Compare the page with what the searcher needs and what ranks. Keep what works. Recommend specific, concrete changes, not generic advice.
Never invent statistics or claims; where proof is needed, say what proof to add.

Return JSON:
{"verdict":"one sentence: how well this page serves the search today",
 "fit_score":0,
 "keep":["what already works and should stay"],
 "add_sections":[{"heading":"suggested H2","why":"what it answers","priority":"high|medium|low"}],
 "questions_to_answer":["questions the page doesn't answer yet"],
 "rewrite":[{"what":"title tag|meta description|H1|intro|a section","current":"","suggested":"","why":""}],
 "remove_or_trim":["outdated, off-topic or padded parts"],
 "proof_to_add":["screenshots, data, examples or quotes that would add first-hand evidence"],
 "internal_links":["which related pages to link to or from"],
 "first_three_steps":["the three most valuable changes, in order"]}`;


// ---- Rewrite one section of a page ----
export const rewriteSection = (site, keyword, intent, outline, section, instruction, validUrls, style) => `Rewrite ONE section of a page for ${site.name || site.url}.
Page keyword: "${keyword}" | Search intent: ${intent}
Page outline (for context only, do not rewrite other sections): ${J(outline)}
${styleText(style)}
INSTRUCTION FROM THE EDITOR: ${instruction || "Make this section clearer, more specific and more useful."}

Rules: keep the same "## " heading line unless the instruction asks to change it; keep any links that point to the allowed URLs;
only link to these URLs: ${J(validUrls.slice(0, 150))}; keep existing placeholders unless the editor supplied the real content;
never invent statistics, quotes or customers (use [SOURCE NEEDED: ...] or [ADD DATA: ...] instead); short paragraphs; no filler.

SECTION TO REWRITE:
"""
${section}
"""

Return JSON: {"markdown":"the full rewritten section, starting with its ## heading","summary":"one line: what you changed"}`;

// ---- Suggested fixes for one page's on-page elements ----
export const pageFixes = (site, page, issues, keyword) => `Suggest better on-page elements for one page of ${site.name || site.url} (${site.product || ""}).
${keyword ? `The page should rank for: "${keyword}".` : "Infer the page's main search topic from its content."}
Current page:
URL: ${page.url}
Title tag (${(page.title || "").length} chars): ${page.title || "(none)"}
Meta description (${(page.meta_description || "").length} chars): ${page.meta_description || "(none)"}
H1: ${(page.h1 || []).join(" | ") || "(none)"}
H2s: ${(page.h2 || []).slice(0, 10).join(" / ")}
Text excerpt: ${(page.excerpt || "").slice(0, 900)}
Problems found: ${JSON.stringify(issues.map(i => i.label + (i.detail ? ` (${i.detail})` : "")))}

Rules: title 30-60 characters with the main topic near the start, honest, no clickbait, unique; meta description 120-160 characters,
an honest summary that makes the click worthwhile; exactly one clear H1. Only describe what the page actually offers. No invented claims.

Return JSON:
{"keyword":"the main search topic you optimised for",
 "title_tag":"","meta_description":"","h1":"",
 "why":"one or two sentences on what you changed and why",
 "other_fixes":["plain-language fixes for the remaining problems on this page, most important first"]}`;

// ---- Better search snippet for a query that gets few clicks ----
export const snippetFix = (site, row, page) => `A page from ${site.name || site.url} appears in Google for the search "${row.query || ""}" but few people click it.
Stats: ${Math.round(row.impressions)} impressions, ${row.ctr}% click rate at average position ${row.position}; this site's usual click rate at that position is ${row.benchmark_ctr}%.
${page ? `Current page: ${page.url}
Title tag: ${page.title || "(none)"}
Meta description: ${page.meta_description || "(none)"}
H1: ${(page.h1 || [])[0] || ""}
What the page offers (excerpt): ${(page.excerpt || "").slice(0, 700)}` : `Page: ${row.page || "unknown"} (not among the pages read, so describe it only from the search)`}

Write 3 alternative title tag + meta description pairs that match what this searcher wants and honestly describe the page.
Rules: title 30-60 characters with the searched topic near the start; meta description 120-160 characters; no clickbait, no invented claims, no ALL CAPS.
Each option should take a different angle (e.g. direct answer, outcome, specific detail).

Return JSON: {"diagnosis":"one sentence: why people probably skip this result","options":[{"angle":"","title_tag":"","meta_description":""}]}`;

// ---- Why isn't the brand in AI answers for this question? ----
export const whyNotUs = (site, question, answers, pages) => `People ask AI assistants: "${question}".
The publisher ${site.name || site.url} (${site.product || ""}; audience: ${site.audience || "not described"}) is ${answers.some(a => a.mentioned) ? "only sometimes" : "not"} mentioned.

What the assistants answered (excerpts), which brands they named and which sources they relied on:
${JSON.stringify(answers.map(a => ({ assistant: a.engine, mentioned_us: a.mentioned, brands: a.brands, sources: a.sources, excerpt: a.answer_excerpt })), null, 1)}

The publisher's pages most related to this question: ${JSON.stringify(pages)}

Explain, concretely and honestly, why the assistants favour the brands they named, and what the publisher could do.
Base reasons on the evidence above (sources cited, what the answers emphasise). Never promise that AI will mention the brand.
Actions can be: improve an existing page (say which and what to add), create a page, publish original data or comparisons,
get listed or reviewed on a cited source (name it), or fix how the product is described.

Return JSON:
{"summary":"two sentences","reasons":["evidence-based reasons, 2-4"],
 "actions":[{"type":"improve_page|create_page|get_listed|publish_data|fix_description","title":"short action","detail":"what exactly to do","target":"URL or site, if any"}],
 "suggested_keyword":"a search/keyword to check before writing, if a page is needed"}`;

// ---- Questions buyers might ask AI assistants ----
export const questionIdeas = (site, topic, keywords, existing) => `Suggest questions that buyers of ${site.name || site.url} (${site.product || ""}; audience: ${site.audience || "not described"}) would type into ChatGPT, Gemini, Perplexity or Google's AI Mode while researching${topic ? ` the topic "${topic}"` : ""}.
Mix: "best X for Y" recommendations, comparisons ("X vs Y"), how-to questions, problem questions ("how do I stop..."), and buying questions (pricing, alternatives).
Write them the way real people ask AI: natural, often longer than a Google search. Do not include the publisher's brand name (we want to see if AI recommends it unprompted).
Related keywords the publisher tracks: ${JSON.stringify(keywords.slice(0, 30))}
Already tracked (don't repeat): ${JSON.stringify(existing.slice(0, 50))}

Return JSON: {"questions":[{"question":"","type":"recommendation|comparison|how_to|problem|buying","why":"one line"}]} with 10-15 questions.`;

// ---- Content strategy grounded in the publisher's own data ----
export const strategyV2 = (site, pages, evidence, focus) => `${siteContext(site, pages, 40000)}

EVIDENCE FROM THE PUBLISHER'S OWN DATA (use it; cite it in each idea's "evidence"):
${JSON.stringify(evidence, null, 1)}
${focus ? `\nFOCUS REQUESTED BY THE USER: ${focus}\n` : ""}
TASK: Build a content strategy.
1. Review the site: what it covers, how well it fits the product, and risks under Google's rules (templated sections, off-topic content, mass translations, thin pages).
2. Propose NEW pages only where there's a real gap. Never propose a page the site already has: say which existing page to improve instead.
3. Organise ideas into 3-6 topic clusters. Each cluster has one pillar page (broad, comprehensive) and 2-6 supporting pages (specific, linking to the pillar). If a good pillar already exists on the site, use its URL.
4. Every idea needs evidence: Google search data, a keyword gap, an AI-answer gap, or a site gap. Ideas without evidence must be marked "evidence":[{"type":"judgement","detail":"why"}].
5. Balance the funnel: awareness (learn), consideration (compare, how-to with the product), decision (buy, pricing, alternatives).

Return JSON:
{"summary":"3 sentences","fit_score":0-10,"strengths":["..."],
 "risks":[{"issue":"","evidence":"sections/URLs/counts","severity":"high|medium|low","fix":""}],
 "section_review":[{"section":"/path","verdict":"keep|improve|merge|remove|noindex","reason":""}],
 "pages_to_improve":[{"url":"existing URL","why":"","what_to_add":"","keyword":"the search it should win"}],
 "clusters":[{"name":"","pillar":{"keyword":"","title_idea":"","existing_url":"URL if the site already has a good pillar, else empty"},
   "ideas":[{"keyword":"","title_idea":"","intent":"${Object.keys(INTENTS).join("|")}","page_type":"${PAGE_TYPES.join("|")}","funnel":"awareness|consideration|decision",
     "angle":"what makes this page different and genuinely useful","information_gain":"what original material it needs",
     "evidence":[{"type":"google|keyword|ai|site|judgement","detail":"e.g. 3,000 impressions at position 14"}],"priority":"high|medium|low","is_pillar":false}]}]}
Give 12-25 ideas in total, pillar ideas included (mark them is_pillar true unless the pillar already exists).`;


// ---- Targeted repair: rewrite only the sections that have problems ----
export const repairSections = (site, keyword, intent, md, issues, validUrls, style, lang) => `You are editing a page for ${site.name || site.url} so it passes quality review.
Keyword: "${keyword}" | Search intent: ${intent}
${styleText(style)}${kbLine(site)}${langLine(lang)}
PROBLEMS TO FIX (fix every one):
- ${issues.join("\n- ")}

Rules: change ONLY what's needed to fix the problems. Leave good sections untouched (do not return them).
Return each changed section in full, starting with its exact "## " heading line. Use heading "__intro__" for the text between the H1 and the first H2.
To ADD a missing section, return it with a new "## " heading; it will be inserted before the FAQ section.
Only link to these URLs: ${J(validUrls.slice(0, 150))}. Keep existing placeholders unless you have the real content. Never invent statistics, quotes or customers.

THE PAGE:
"""
${md.slice(0, 60000)}
"""

Return JSON: {"sections":[{"heading":"exact existing heading, __intro__, or a new heading","markdown":"the full section"}],
"title_tag":"only if it must change, else empty","meta_description":"only if it must change, else empty",
"faqs":[{"q":"","a":""}] (only if the FAQ section changed, else empty list),"summary":"one line: what you changed"}`;

// ---------------- section-by-section writing (free models, or by choice) ----------------
const outlineText = outline => outline.map((o, i) => `${i + 1}. ${o.h2}`).join("\n");
export const pageMeta = (site, keyword, intent, brief, author, style, lang) => `Write the opening of a web page for ${site.name || site.url}${site.product ? ` (${site.product})` : ""}.
Keyword: "${keyword}" | What the searcher wants: ${intent}
Main question: ${brief.main_question || keyword}
Angle (what makes this page different): ${brief.angle || ""}
Planned sections:
${outlineText(brief.outline || [])}
${styleText(style)}${kbLine(site)}${langLine(lang)}
Rules: title_tag 30-60 characters with the keyword near the start; meta_description 120-160 characters, an honest summary that includes the keyword;
slug lowercase-with-hyphens, at most 6 words; h1 clear and specific; intro = 2-3 short paragraphs: the first one answers the main question directly in under 60 words and includes the keyword,
then say what the reader will get from the page. No filler ("in today's fast-paced world" and similar). Never invent statistics.

Return JSON: {"title_tag":"","meta_description":"","slug":"","h1":"","intro":"markdown paragraphs, no heading"}`;

export const section = (site, keyword, intent, brief, sec, idx, prevTail, links, words, notes, style, lang, fix = null, current = "") => `${fix ? "Rewrite" : "Write"} ONE section of a web page for ${site.name || site.url}${site.product ? ` (${site.product})` : ""}.
Page: "${brief.h1 || keyword}" | keyword: "${keyword}" | searcher wants: ${intent}
Reader: ${brief.reader || "not specified"} | Angle: ${brief.angle || ""}
Whole page outline (for context only; write ONLY your section):
${outlineText(brief.outline || [])}

YOUR SECTION (#${idx + 1}): "## ${sec.h2}"
What it must cover: ${sec.notes || "the heading's topic, specifically and practically"}${(sec.h3 || []).length ? `\nSub-points to cover (use "### " headings): ${sec.h3.join("; ")}` : ""}
${prevTail ? `The previous section ended with: "${prevTail}"\nContinue naturally; don't repeat it.\n` : ""}Target length: about ${words} words.
${notes ? `Facts and proof from the publisher you can use (use them where they fit): ${notes}\n` : ""}${links.length ? `Link to these pages where it helps the reader, as markdown links with descriptive words (use the exact URLs): ${links.map(l => `[${l.anchor}](${l.url})`).join(", ")}\n` : ""}${styleText(style)}${langLine(lang)}
${typeLine(site)}${kbLine(site)}${fix ? `PROBLEMS TO FIX IN THE CURRENT VERSION: ${fix}\n\nCURRENT VERSION:\n"""\n${current.slice(0, 9000)}\n"""\n` : ""}Rules:
- Start with exactly this line: ## ${sec.h2}
- Short paragraphs (2-4 sentences). Use a numbered list for steps and a table only if it genuinely helps.
- Be specific and practical: concrete steps, examples, numbers the publisher gave you. No filler, no generic advice that fits any topic.
- Never invent statistics, quotes, prices or customers. Where proof belongs, write a placeholder: [ADD DATA: ...], [SOURCE NEEDED: ...], [ADD SCREENSHOT: ...], [ADD EXAMPLE: ...]. Use at most 2 placeholders.
- Don't write an introduction to the whole page, a conclusion, or an FAQ; other sections cover those.
Write the section now, in Markdown only.`;

export const faqSection = (site, keyword, questions, brief, style, lang) => `Write the FAQ section of a web page about "${keyword}" for ${site.name || site.url}${site.product ? ` (${site.product})` : ""}.
Answer these questions searchers ask:
${questions.map(q => "- " + q).join("\n")}
The page already covers: ${(brief.outline || []).map(o => o.h2).join("; ")}
${styleText(style)}${langLine(lang)}
Rules: start with exactly "## Frequently asked questions". Each question is a "### " heading followed by a direct 2-4 sentence answer that stands on its own.
Never invent statistics, prices or customers; use [SOURCE NEEDED: ...] if a fact needs proof. Write in Markdown only.`;

// ---------------- research and fact-checking from supplied search results (free models) ----------------
export const serpFromResults = (site, keyword, block, provider) => `These are the current top web search results for "${keyword}" (from ${provider}, today).
The publisher is ${site.name || site.url} (${site.product || ""}).

SEARCH RESULTS:
${block}

Study ONLY these results (don't invent others) and describe what ranks for this search.
Return JSON:
{"searched":true,
 "results":[{"title":"","url":"exact URL from the list","type":"guide|listicle|comparison|tool|product_page|template|video|forum|news|docs|other","angle":"one line: what this page offers"}],
 "dominant_format":"the format most results use, in plain words",
 "format_mix":[{"type":"guide","count":0}],
 "must_cover":[{"topic":"a topic most results cover","share":"most|some|few"}],
 "questions":["questions searchers have around this topic, 4-6"],
 "gaps":["useful things these results miss or do poorly, 2-4"],
 "competition":{"level":"low|medium|high","reason":"who ranks, in one line"},
 "recommended_angle":"how ${site.name || "the publisher"} could stand out",
 "recommended_page_type":"blog_post|how_to_guide|pillar_guide|comparison|alternatives|listicle|glossary|landing_page|use_case|case_study|help_article",
 "length_note":"rough depth of the results"}`;

export const claimsList = (keyword, body) => `List the factual claims in this page about "${keyword}" that a reader could check:
statistics, dates, prices, product features and capabilities, research findings. Skip opinions, advice and plain instructions.
Pick the 6 most important. For each, write a short web search query that would find a source for it.
Claims about the publisher's own product that only the publisher can confirm: mark own_product true.

Return JSON: {"claims":[{"claim":"the exact sentence or phrase from the page","query":"search query","own_product":false}]}

PAGE:
"""
${body.slice(0, 20000)}
"""`;

export const claimJudge = (claim, block) => `Check this claim against the search results below.
CLAIM: "${claim}"

SEARCH RESULTS:
${block}

Decide from these results only:
- supported: a result clearly states the same thing (give its URL)
- false: a result clearly contradicts it (give its URL and the correct fact)
- outdated: a result shows newer, different figures (give its URL and the current figure)
- unsupported: the results don't confirm or contradict it
Return JSON: {"status":"supported|false|outdated|unsupported","source_url":"exact URL from the results or empty","source_tier":1,
 "note":"one line: what the source says","correction":"for false/outdated: the corrected sentence with a markdown link to the source; for unsupported: the claim followed by [SOURCE NEEDED: what to find]; else empty"}
source_tier: 1 = government, university, official company or standards body; 2 = major publication or research firm; 3 = blog, forum, unclear.`;

// ---------------- client report summary ----------------
export const reportSummary = data => `Write the executive summary of a monthly SEO and content report for ${data.site.name} (${data.site.url}).
Audience: a client or manager who is busy and not an SEO expert. Use ONLY the numbers below; never invent figures, causes or forecasts.
Be specific and plain; name the most important change first. If the data is thin, say what to measure next instead of padding.

DATA (JSON):
${JSON.stringify({ ...data, google: data.google ? { ...data.google, daily: undefined } : null, health: data.health ? { ...data.health, trend: undefined } : null }).slice(0, 14000)}

Return JSON: {"summary":"one paragraph, 60-110 words","highlights":["2-4 short wins or key facts, each with a number from the data"],"watch":["1-3 short risks or things to act on next"]}`;

// ---------------- localisation: adapt a page for another language and market ----------------
const marketText = (lang, market) => `${lang}${market ? ` for readers in ${market}` : ""}`;
export const localKeywords = (site, item, langName, market) => `A page about "${item.keyword}" for ${site.name || site.url}${site.product ? ` (${site.product})` : ""} is being adapted into ${marketText(langName, market)}.
Find what people in that market actually type into Google for this topic. A word-for-word translation is often not what locals search; prefer the real local phrasing, including common English loanwords if locals use them.
The page title is: "${item.payload?.title_tag || item.title || item.keyword}". Search intent: ${item.intent}.

Return JSON: {"keywords":[{"keyword":"in ${langName}","why":"one line in English: why locals use this","intent":"${item.intent}","popularity":"high|medium|low"}],
"recommended":"the best one for this page","note":"one line in English, e.g. if the topic is searched mostly in English in this market"}
Give 3-6 keywords, most useful first. If you aren't sure of popularity, say "medium".`;

const LOCAL_RULES = (langName, market, keyword) => `RULES FOR ADAPTING (not translating word for word):
- Write natural, native ${marketText(langName, market)}, as a local expert writer would. Use the register locals expect for this kind of business (for example polite です・ます in Japanese, formal "Sie" in German B2B unless the brand style says otherwise).
- Use the local keyword "${keyword}" naturally in the title, H1, introduction and a heading or two. Never stuff it.
- Adapt examples, idioms, date formats, units and spelling to the market. Keep every fact, number, price and product name exactly as given; if a currency or a local fact would be needed but isn't known, write [LOCALIZE: what to check] instead of guessing.
- Keep every link URL and every placeholder (like [ADD SCREENSHOT: ...]) exactly; translate only the visible text around them.
- Keep the structure: same headings in the same order (translated), same lists and tables.
- Don't add claims that aren't in the original, and don't drop sections.`;

export const localize = (site, item, langName, market, keyword, style) => `Adapt this page for ${marketText(langName, market)}.
Business: ${site.name || site.url}${site.product ? ` (${site.product})` : ""}
${styleText(style)}${kbLine(site)}
${LOCAL_RULES(langName, market, keyword)}

ORIGINAL PAGE:
Title tag: ${item.payload?.title_tag || ""}
Meta description: ${item.payload?.meta_description || ""}
"""
${String(item.payload?.body_markdown || "").slice(0, 60000)}
"""

Return JSON: {"title_tag":"30-60 characters (for Japanese/Chinese about 25-35 characters), with the local keyword near the start","meta_description":"120-160 characters (Japanese/Chinese 60-90 characters)",
"slug":"lowercase-latin-letters-and-hyphens (romanise if needed)","h1":"","body_markdown":"the full adapted page in Markdown, starting with # H1",
"changes":["each adaptation you made beyond translation, in English, e.g. 'changed US example to a Spanish company'"],"to_check":["anything a local reviewer must verify, in English"]}`;

export const localizeMeta = (site, item, langName, market, keyword) => `Adapt the title, meta description and H1 of a page for ${marketText(langName, market)}. Local keyword: "${keyword}".
Original title tag: ${item.payload?.title_tag || ""}
Original meta description: ${item.payload?.meta_description || ""}
Original H1: ${item.payload?.h1 || item.title || ""}
Rules: natural native wording, local keyword near the start of the title; title 30-60 characters (Japanese/Chinese 25-35), meta description 120-160 (Japanese/Chinese 60-90); slug in lowercase latin letters and hyphens.
Return JSON: {"title_tag":"","meta_description":"","slug":"","h1":""}`;

export const localizeSection = (site, langName, market, keyword, sectionMd, style) => `Adapt ONE section of a web page for ${marketText(langName, market)}.
Business: ${site.name || site.url}
${styleText(style)}${kbLine(site)}
${LOCAL_RULES(langName, market, keyword)}

SECTION:
"""
${sectionMd.slice(0, 12000)}
"""
Write only the adapted section in Markdown, keeping its heading level. No notes, no preamble.`;

// ---------------- repurposing an approved page for other channels ----------------
export const REPURPOSE_FORMATS = { linkedin: "LinkedIn post", x_thread: "X (Twitter) thread", newsletter: "Newsletter section", video_script: "Short video script", snippets: "Social snippets" };
export const repurpose = (site, item, formats, style, langName) => `Turn this approved web page into content for other channels for ${site.name || site.url}${site.product ? ` (${site.product})` : ""}.
${styleText(style)}
RULES:
- Use ONLY facts, numbers, examples and claims that are in the page. Never add statistics, customers, results or promises that aren't there; keep numbers exactly as written.
- Write in ${langName}, matching the brand style. Plain, specific and useful; no hype words ("game-changer", "revolutionary", "unlock", "supercharge"), no clickbait.
- Where a link to the page belongs, write {link} exactly (it's replaced with the real address).
- Each piece must stand on its own for someone who hasn't read the page, and lead with the most useful point.

Make these formats: ${formats.map(f => REPURPOSE_FORMATS[f]).join(", ")}.
- LinkedIn post: 120-250 words, first line is a specific hook (not a question like "Did you know?"), short paragraphs, end with {link}, at most 3 relevant hashtags.
- X thread: 5-8 posts, each under 260 characters, numbered "1/", first post states the payoff, last post has {link}.
- Newsletter section: subject (under 60 characters), preview text (under 90 characters), body 100-180 words, and a call to action line ending with {link}.
- Short video script: 60-90 seconds as 4-7 scenes, each with seconds, voiceover, on-screen text (under 8 words) and what to show (for software, which screen to record).
- Social snippets: 5 short cards, each under 25 words, built on a concrete fact or tip from the page; give the exact page sentence each one comes from.

THE PAGE (title: ${item.payload?.title_tag || item.title || ""}):
"""
${String(item.payload?.body_markdown || "").slice(0, 40000)}
"""

Return JSON with only the requested keys:
{"linkedin":{"text":""},"x_thread":{"posts":["1/ ..."]},"newsletter":{"subject":"","preview":"","body":"","cta":""},
"video_script":{"title":"","seconds":75,"scenes":[{"seconds":10,"voiceover":"","on_screen":"","show":""}]},
"snippets":[{"text":"","from":"exact sentence from the page"}]}`;

// ---------------- chat ----------------
export const chat = (site, context, history, question, freeModel) => `You are the assistant inside Content Engine, an SEO and content tool, helping the team behind ${site.name || site.url}${site.product ? ` (${site.product})` : ""}.
Answer the user's latest message. Be specific, practical and concise; use Markdown (short paragraphs, lists or tables when they help).
Use the CONTEXT below, which comes from the user's own data in the tool. When you use something from it, cite it like [1] or [2].
Never invent numbers, rankings, pages or results. If the context doesn't contain what's needed, say so plainly and suggest where in the tool to get it
(for example: "Import your Search Console data under Google search", "Read more pages under Websites", "Check a keyword").
When asked to write content (posts, emails, headlines), write it in the brand style, from the facts available, without making up statistics.
Reply in the language of the user's message.${freeModel ? " Keep answers under 300 words." : ""}

CONTEXT:
${context || "(no matching data in the tool for this question)"}

CONVERSATION SO FAR:
${history || "(this is the first message)"}

USER: ${question}`;

// ---------------- refresh: update an existing page that is losing Google clicks ----------------
export const refresh = (site, page, ctx, style) => `Update an existing page on ${site.name || site.url} that is losing Google clicks. Today is ${new Date().toISOString().slice(0, 10)}.
${styleText(style)}${kbLine(site)}
WHAT WE KNOW:
${ctx.lost?.length ? `- Searches it lost clicks for (before → now): ${ctx.lost.map(q => `“${q.query}” ${q.before} → ${q.after}${q.pos_before && q.pos_after ? ` (position ${q.pos_before} → ${q.pos_after})` : ""}`).join("; ")}\n` : ""}${ctx.queries?.length ? `- Searches it still gets clicks for: ${ctx.queries.slice(0, 12).map(q => `“${q}”`).join(", ")}\n` : ""}${ctx.causes?.length ? `- Likely reasons: ${ctx.causes.join("; ")}\n` : ""}
RULES:
- Change ONLY what needs changing: outdated years, prices and facts (only from the knowledge base or the page itself; otherwise mark [CHECK: what to verify]), missing sections that answer the lost searches, a clearer title and description, a sharper introduction if it no longer matches what people search.
- Keep every paragraph, heading, link and image that is still right EXACTLY as it is, word for word, so the changes are easy to review.
- Don't invent statistics, customers, quotes or results. Keep the brand voice and the page's language.
- Keep the same Markdown structure; new sections go where they fit best.

THE CURRENT PAGE
Title tag: ${page.title_tag}
Meta description: ${page.meta_description}
"""
${String(page.markdown || "").slice(0, 50000)}
"""

Return JSON: {"title_tag":"30-60 characters","meta_description":"120-160 characters","body_markdown":"the full updated page in Markdown",
"changes":[{"what":"short description of one change","why":"which lost search or problem it addresses"}]}`;

// ---------------- content brief for a writer ----------------
export const writerBrief = (site, ctx, style) => `Write a content brief for a writer (in-house, freelancer or agency) for a new page on ${site.name || site.url}${site.product ? ` (${site.product})` : ""}.
Target keyword: "${ctx.keyword}". Search intent: ${ctx.intent}. Page type: ${ctx.page_type}. Suggested length: about ${ctx.words} words.
${site.audience ? `Audience: ${site.audience}\n` : ""}${styleText(style)}${kbLine(site)}
WHAT WE KNOW (use it; don't invent anything beyond it):
${ctx.serp ? `- What currently ranks: ${ctx.serp}\n` : ""}${ctx.subtopics?.length ? `- Subtopics a complete treatment covers (Wikipedia): ${ctx.subtopics.join("; ")}\n` : ""}${ctx.questions?.length ? `- Questions people ask: ${ctx.questions.join(" | ")}\n` : ""}${ctx.searches?.length ? `- Related searches people use to find the site: ${ctx.searches.join(", ")}\n` : ""}${ctx.links?.length ? `- Existing pages to link to: ${ctx.links.map(l => `${l.title} (${l.url})`).join("; ")}\n` : ""}
Make the brief specific and practical. The outline must answer the search intent in its first section, and include something useful that typical pages on this topic miss (first-hand experience, real examples, data from the knowledge base).

Return JSON: {"title_ideas":["2-3 title tags, 30-60 characters"],"reader":"who is searching and what they want, 1-2 sentences","angle":"the angle that makes this page better than what ranks, 1-2 sentences",
"outline":[{"h2":"","notes":"what to cover and why, 1-2 sentences","h3":["optional subheadings"]}],"questions":["questions the page must answer"],
"facts":["facts, numbers or examples to use, each with its source from the knowledge base"],"must_include":["specific things to include, e.g. a comparison table, screenshots, a checklist"],
"avoid":["things not to do"],"cta":"the next step to offer the reader"}`;

// ---------------- AI-answer readiness fixes for one page ----------------
export const aiFixes = (site, page, failing) => `A page on ${site.name || site.url} should be easier for AI assistants (ChatGPT, Perplexity, Google's AI answers) to quote. Use ONLY what the page says; don't invent facts, figures or claims.
Page: ${page.title} (${page.url})
Headings: ${(page.h2 || []).slice(0, 15).join(" | ")}
Start of the page:
"""
${String(page.text || "").slice(0, 3500)}
"""
What's missing: ${failing.join("; ")}

Return JSON: {"answer_opening":"a 1-2 sentence direct answer to open the page with (what it is / how to do it), in the page's language and voice",
"question_headings":[{"from":"an existing heading","to":"the same section as a question people ask"}],
"facts_to_add":["specific facts, numbers or steps the page could state clearly; only things the page already implies, or say what to look up"]}`;

// ---------------- alt text (from the page context; the image itself isn't sent) ----------------
export const altText = (site, items) => `Write alt text for images on ${site.name || site.url}. You can't see the images: use the file name, the page and the text around each image.
Good alt text says what the image shows and why it's there, in 5-15 words, without "image of" or "picture of", in the page's language. For logos, write the company name and "logo". If the context isn't enough to know what it shows, write your best description and set "check" to true.
${items.map((x, i) => `${i + 1}. file: ${x.file} | page: ${x.page} | text near it: ${x.context || "(none)"}`).join("\n")}
Return JSON: {"alts":[{"n":1,"alt":"","check":false}]}`;
