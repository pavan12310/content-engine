// prompts.js - every prompt carries the site context; Google's rules ride in the system prompt (llm.js)
import { SEO, INTENTS, SCORECARD, PAGE_TYPES, STRUCTURES, SATISFACTION_FACTORS, SOURCE_TIERS, SPAM_RISK_CHECKS, URL_ACTIONS } from "./rules.js";
const J = x => JSON.stringify(x);
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
  const out = [`PUBLISHER: ${site.name || site.url} (${site.url})`, `PRODUCT: ${site.product || "not described"}`, `AUDIENCE: ${site.audience || "not described"}`,
    `SITE SIZE: ${s.urls_discovered ?? "?"} URLs; pages read: ${pages.length}; median words ${s.median_word_count ?? "?"}`,
    `SECTIONS: ${(s.sections || []).slice(0, 20).map(([a, b]) => `${a}: ${b}`).join(", ")}`,
    `LANGUAGES: ${(s.languages || []).slice(0, 12).map(([a, b]) => `${a}: ${b}`).join(", ")}`, "EXISTING PAGES (url | title | intent | words | H2s):"];
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

export const brief = (site, pages, keyword, intent, pageType, audience, notes, matches, sat, structure, serp = null) => `${siteContext(site, pages, 30000)}

CREATE A BRIEF for one page.
Primary keyword: "${keyword}"
Required search intent: ${intent} (${INTENTS[intent]?.label || ""}). Formats that match this intent: ${J(INTENTS[intent]?.formats || [])}
Page type: ${pageType}
Target reader: ${audience || "infer from product"}
Publisher's notes, data and proof available: ${notes || "none provided - use placeholders"}
Related existing pages (must NOT be duplicated; differentiate and link): ${J(matches.slice(0, 6))}
SEARCHER MODEL (the page must satisfy this completely): ${J(sat || {})}
REQUIRED STRUCTURE for this intent (${structure}): ${J(STRUCTURES[structure] || [])}
Build the outline from the required structure, and make sure every question in the question map is answered somewhere.
${serp && serp.searched ? `WHAT CURRENTLY RANKS for this search (from web research): dominant format: ${serp.dominant_format || ""}; topics most top pages cover: ${JSON.stringify((serp.must_cover || []).map(x => x.topic))}; questions searchers ask: ${JSON.stringify(serp.questions || [])}; gaps the top results miss (win here): ${JSON.stringify(serp.gaps || [])}; recommended angle: ${serp.recommended_angle || ""}.
Cover the topics searchers expect, answer the questions, and make the gaps this page's information gain. Do not copy any ranking page.` : ""}

Return JSON:
{"angle":"how this page differs from existing pages and competitors","reader":"","main_question":"",
 "direct_answer":"2-3 sentence answer to the main question (max ${SEO.direct_answer_max_words} words)",
 "secondary_keywords":["5-8 related terms used naturally"],"outline":[{"h2":"","h3":["..."],"notes":"what goes here"}],
 "faqs":["${SEO.faq_min}-${SEO.faq_max} real follow-up questions searchers ask"],"information_gain":["3-4 specific unique additions"],
 "proof_needed":["screenshots/data/quotes the publisher must supply"],
 "internal_links":[{"url":"ONLY URLs from EXISTING PAGES above","anchor":"descriptive anchor text","placement":"which section"}],
 "link_from_existing":[{"url":"existing URL that should link TO this new page","anchor":"","where":"section of that page"}],
 "cta":"next step that fits the funnel stage (do not push a demo on early-stage informational queries)"}
Outline must have ${SEO.min_h2}-${SEO.max_h2} H2s that match the ${intent} intent. Give ${SEO.internal_links_min}-${SEO.internal_links_max} internal links.`;

export function article(site, keyword, intent, pageType, briefJson, author, validUrls, fixes = null, previous = null, style = null) {
  let fix = "";
  if (fixes && fixes.length) { fix = "\nREVISE THE PREVIOUS DRAFT. Fix every issue below, keep everything that already works:\n- " + fixes.join("\n- "); if (previous) fix += "\n\nPREVIOUS DRAFT (markdown):\n" + previous.slice(0, 50000); }
  const minw = SEO.min_words[pageType] || 800;
  return `Write the full page from this brief, for ${site.name || site.url}.
Primary keyword: "${keyword}" | Search intent: ${intent} | Page type: ${pageType} | Author: ${author || "[ADD AUTHOR NAME AND ROLE]"}
Product: ${site.product || ""}
BRIEF: ${J(briefJson)}
ALLOWED INTERNAL LINK URLS (use only these, as markdown links with descriptive anchors): ${J(validUrls.slice(0, 200))}
${styleText(style)}${fix}

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
- Put placeholders like [ADD SCREENSHOT: ...], [ADD DATA: ...], [SOURCE NEEDED: ...], [EXPERT QUOTE: ...] where first-hand proof belongs. Never invent numbers, quotes or customers.

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
Score evidence on what the writer controls: claims are sourced, attributed to the publisher, or clearly flagged.

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
