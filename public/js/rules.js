// rules.js - Google's content rules, written into code. Every prompt, validator and gate reads from here.
// Sources: developers.google.com/search/docs/essentials/spam-policies,
//          .../fundamentals/creating-helpful-content, .../fundamentals/using-gen-ai-content
export const RULES_VERSION = "2026-10.3";

export const CORE_PRINCIPLES = [
  "Google rewards helpful, reliable, people-first content, regardless of whether AI helped produce it.",
  "Scaled content abuse is spam: producing many pages primarily to manipulate search rankings rather than help users, whether by AI, automation or people.",
  "Attempting to manipulate Google's generative AI answers (AI Overviews, AI Mode) is also spam.",
  "Who/How/Why test: show who created the content (named author with relevant expertise); be transparent about how it was made where readers would wonder; it must exist to help people, not mainly to rank.",
  "Content must offer information gain: original information, first-hand experience, expert input, original assets, or clear reasoned opinions beyond what already ranks.",
  "Stay on topic: write about what the publisher genuinely knows and sells. Off-topic traffic grabs damage site-wide quality signals.",
  "Never invent facts, statistics, quotes, reviews, customer names or credentials.",
  "Answer the reader's question directly and early; the reader should not need to search again.",
];
export const SPAM_PATTERNS = [
  "Generating many pages with AI or other tools without adding value for users",
  "Scraping feeds or search results and republishing them",
  "Stitching or combining content from different sites without adding value",
  "Creating multiple sites to hide the scaled nature of content",
  "Pages stuffed with keywords that make little or no sense to a reader",
];
export const HIGH_RISK_PAGE_TYPES = {
  comparison: "Needs hands-on testing, transparent criteria, and honesty about where the publisher loses.",
  glossary: "Only a few deep explainers in the core topic; never hundreds of one-paragraph definitions.",
  listicle: "Only items actually tested, with evidence; never lists copied from other lists.",
  self_ranking: "Transparent methodology and fair treatment of rivals.",
  alternatives: "Honest fit guidance for different needs; never one template per competitor name.",
  location_language_copy: "Truly localised or native-reviewed content for real markets; never swapped words only.",
  faq_farm: "Group FAQs on a real page; never one thin page per question.",
  off_topic: "Avoid unless the publisher has genuine expertise.",
  location_page: "Only for a real branch or genuinely local service, with real local details; never near-identical pages for each town (doorway pages).",
  review: "Only products you actually tested, with evidence (photos, measurements, how you tested); Google's reviews system rewards first-hand testing.",
};
export const PAGE_TYPES = ["blog_post", "how_to_guide", "pillar_guide", "comparison", "alternatives", "listicle",
  "glossary", "landing_page", "use_case", "case_study", "help_article", "product_page", "category_page", "service_page", "location_page", "news_article", "review"];
// plain names, grouped for the page-type menu
export const PAGE_TYPE_LABELS = { blog_post: "Blog post", how_to_guide: "How-to guide", pillar_guide: "In-depth guide (pillar)", comparison: "Comparison (X vs Y)", alternatives: "Alternatives",
  listicle: "List (best X)", glossary: "Glossary / definition", landing_page: "Landing page", use_case: "Use case", case_study: "Case study", help_article: "Help article",
  product_page: "Product page", category_page: "Category page", service_page: "Service page", location_page: "Location page", news_article: "News article", review: "Review (first-hand testing)" };
export const PAGE_TYPE_GROUPS = [["Articles and guides", ["blog_post", "how_to_guide", "pillar_guide", "glossary", "help_article"]], ["Comparing and buying", ["comparison", "alternatives", "listicle", "review", "landing_page", "use_case", "case_study"]],
  ["Online store", ["product_page", "category_page"]], ["Services and local", ["service_page", "location_page"]], ["News", ["news_article"]]];
// the page types that suit each type of website, best first (used to suggest a page type)
export const TYPE_SUGGESTIONS = { ecommerce: ["product_page", "category_page", "how_to_guide", "listicle", "review"], local: ["service_page", "location_page", "how_to_guide", "blog_post"],
  publisher: ["news_article", "review", "blog_post", "how_to_guide", "listicle"], agency: ["service_page", "case_study", "blog_post", "how_to_guide"] };
export const INTENTS = {
  informational: { label: "Learn / understand", formats: ["explainer", "pillar_guide", "blog_post", "glossary", "news_article"],
    signals: ["what is", "what are", "why", "meaning", "definition", "examples", "ideas", "benefits", "guide", "explained", "vs what"] },
  how_to: { label: "Do a task", formats: ["how_to_guide", "help_article"],
    signals: ["how to", "how do", "how can", "step by step", "steps to", "tutorial", "set up", "setup", "install", "walkthrough", "guide to"] },
  commercial: { label: "Compare / evaluate before buying", formats: ["comparison", "alternatives", "listicle", "use_case", "review", "category_page"],
    signals: ["best", "top", " vs ", "versus", "alternative", "alternatives", "compare", "comparison", "review", "reviews", "pricing vs"] },
  transactional: { label: "Buy / sign up / use now", formats: ["landing_page", "product_page", "category_page", "service_page", "location_page"],
    signals: ["buy", "pricing", "price", "free trial", "download", "sign up", "signup", "book a demo", "tool", "software", "app", "generator", "translator", "maker", "editor", "recorder", "converter", "creator", "online", "free"] },
  navigational: { label: "Find a specific brand or page", formats: ["landing_page", "help_article"],
    signals: ["login", "log in", "sign in", "contact us", "customer support", "help center", "careers", "about us"] },
};
export const SEO = {
  title_max_chars: 60, title_min_chars: 30, meta_min_chars: 120, meta_max_chars: 160, slug_max_words: 6,
  h1_count: 1, min_h2: 3, max_h2: 12, direct_answer_max_words: 60, internal_links_min: 3, internal_links_max: 8,
  faq_min: 3, faq_max: 6,
  max_phrase_per_100_words: 1.2, max_phrase_per_sentence: 1, max_exact_match_anchor_share: 0.5,
  min_words: { blog_post: 900, how_to_guide: 700, pillar_guide: 1800, comparison: 1200, alternatives: 1200, listicle: 1000,
    glossary: 500, landing_page: 400, use_case: 700, case_study: 700, help_article: 300,
    product_page: 300, category_page: 250, service_page: 500, location_page: 500, news_article: 400, review: 1000 },
  paragraph_max_words: 90,
};
export const PLACEHOLDER_RE = /\[(ADD|SOURCE|SCREENSHOT|DATA|QUOTE|EXPERT|EXAMPLE)[^\]]*\]/g;
export const FILLER_PHRASES = ["in today's fast-paced world", "in today's digital age", "in the ever-evolving", "ever-changing landscape",
  "it's important to note that", "it is important to note that", "in conclusion", "delve into", "dive deep into", "let's dive in",
  "unlock the power", "unleash the power", "game-changer", "game changer", "revolutionize", "seamlessly", "cutting-edge",
  "a testament to", "navigate the complexities", "in the realm of", "look no further", "whether you're a beginner or",
  "at the end of the day", "tapestry", "embark on a journey", "elevate your", "harness the power", "plays a crucial role",
  "a myriad of", "it goes without saying"];
export const SCORECARD = [
  "Topic is clearly connected to what the publisher sells or knows",
  "Offers original information, data, testing or analysis",
  "Would be worth publishing even if search engines did not exist",
  "Answers the main question within the first few lines",
  "Shows first-hand experience (screenshots, results, examples)",
  "Named author or reviewer with relevant expertise",
  "Facts are checked and sourced",
  "Adds more than the current top results",
  "Reader leaves without needing to search again",
  "Free of filler, keyword stuffing and template feel",
];
export const MUST_PASS = [0, 1, 2];
export const GUARDRAILS = { max_generations_per_site_per_day: 10, block_if_same_intent_page_exists_similarity: 0.7,
  warn_similarity: 0.4, require_author: true, require_information_gain: true };
export const STRUCTURES = {
  product: ["Short summary: what it is and who it's for", "Key specifications (a table)", "Sizing, fit or compatibility", "Materials, care or what's in the box", "Shipping, delivery and returns", "What customers say (real reviews only, never invented)", "FAQ"],
  category: ["Short intro (50-150 words): what's in this category and how to choose", "(Your product grid goes here, from your store)", "How to choose: a short buying guide", "FAQ"],
  service: ["What the service is and who it's for", "What's included", "How it works (the process, step by step)", "Prices or price range", "Results and proof (real projects or customers)", "Area served or availability", "FAQ", "Next step: call, book or request a quote"],
  location: ["This location: address, opening hours, parking or how to get there", "Services at this location", "The local team", "Local proof: projects or customers nearby", "Area served", "FAQ for this area", "Book or contact this location"],
  news: ["What happened (lead: who, what, when, where)", "Why it matters", "Details and context", "What people said (attributed quotes only)", "What happens next", "Sources"],
  review: ["Verdict up front", "How we tested (first-hand: duration, conditions, measurements)", "Specifications", "What we liked", "What we didn't like", "Who it's for and who should skip it", "Alternatives worth considering", "Final verdict"],
  best_x: ["Quick answer: top picks by use case", "Comparison table", "How we evaluated (criteria + method)", "Detailed reviews (strengths, limits, pricing)", "Pricing overview", "Which to choose by user type", "FAQ"],
  how_to: ["Direct answer (what you'll do, time needed)", "What you need before starting", "Step-by-step instructions with screenshots", "Example / template", "Common mistakes", "Troubleshooting", "Next steps", "FAQ"],
  x_vs_y: ["Quick verdict", "Comparison table", "X overview", "Y overview", "Feature-by-feature comparison", "Pricing", "Use cases: when to pick each", "Which should you choose?", "FAQ"],
  what_is: ["Definition in 1-2 sentences", "How it works", "Why it matters / benefits", "Examples", "Types or components", "How to get started", "Related concepts", "FAQ"],
  template: ["The template (usable immediately)", "How to fill it in", "Filled-in example", "Customising for your case", "FAQ"],
  landing: ["Clear value proposition", "Who it is for", "Key capabilities with proof", "How it works", "Customer evidence", "Pricing / next step", "FAQ"],
  use_case: ["The problem in this context", "How teams solve it today", "Recommended workflow", "Example", "Results to expect (with evidence)", "FAQ"],
};
export function structureFor(keyword, intent, pageType) {
  const k = keyword.toLowerCase();
  const byType = { product_page: "product", category_page: "category", service_page: "service", location_page: "location", news_article: "news", review: "review" };
  if (byType[pageType]) return byType[pageType];
  if (pageType === "comparison" || ` ${k} `.includes(" vs ") || k.includes("versus")) return "x_vs_y";
  if (["listicle", "alternatives"].includes(pageType) || k.startsWith("best ") || k.startsWith("top ") || k.includes("alternative")) return "best_x";
  if (k.includes("template") || k.includes("checklist")) return "template";
  if (pageType === "landing_page" || intent === "transactional") return "landing";
  if (["use_case", "case_study"].includes(pageType)) return "use_case";
  if (intent === "how_to" || ["how_to_guide", "help_article"].includes(pageType)) return "how_to";
  return "what_is";
}
export const SATISFACTION_FACTORS = ["understands_question", "direct_answer", "complete_answer", "actionability", "evidence", "examples", "covers_follow_up_questions", "low_user_effort"];
export const SOURCE_TIERS = {
  1: "Government, universities, original research, official company data/docs, standards and industry bodies",
  2: "Major publications, established research firms, credible industry reports",
  3: "Blogs, aggregators, forums, anonymous or unclear sources (not enough on its own for key claims)",
};
export const SPAM_RISK_CHECKS = {
  scaled_content: "Generic page that could be produced for any keyword by swapping words",
  duplicate_intent: "Serves substantially the same purpose as an existing page",
  keyword_stuffing: "Unnatural repetition of keywords or phrases",
  scraped_or_rewritten: "Reads as a rewrite of commonly available content with nothing added",
  unsupported_claims: "Factual claims without adequate evidence",
  intent_mismatch: "Does not answer the target query",
  thin_content: "Little meaningful information",
  doorway: "Exists mainly to capture a query and funnel users elsewhere",
  irrelevant_topic: "Disconnected from the website's purpose and audience",
  misleading: "False claims, fabricated experience, inaccurate product details",
};
export const RELEASE_GATE = { max_repair_rounds: 3,
  min_scores: { seo_readiness: 80, content_quality: 75, search_satisfaction: 80, task_completion: 70, evidence: 70, ai_citation_readiness: 70 },
  max_spam_risk: "low", block_on_false_claims: true };
export const URL_ACTIONS = {
  create: "Genuinely new need; no page serves it",
  update: "An existing page serves this intent; improve it",
  merge: "Two or more pages overlap; combine into the primary URL",
  redirect: "Redundant URL; 301 to the primary URL after merging",
  keep: "Page serves a distinct purpose; leave it",
  skip: "Not worth a page: low value, off-topic, or covered as a section elsewhere",
};
export function rulesText() {
  return [`GOOGLE CONTENT RULES (version ${RULES_VERSION}). Follow all of them.`, "", "Core principles:",
    ...CORE_PRINCIPLES.map(p => "- " + p), "", "Never do any of these (Google spam policy - scaled content abuse):",
    ...SPAM_PATTERNS.map(p => "- " + p), "", "High-risk page types and what they require:",
    ...Object.entries(HIGH_RISK_PAGE_TYPES).map(([k, v]) => `- ${k}: ${v}`), "", "Writing rules:",
    "- Use placeholders like [ADD SCREENSHOT: ...], [ADD DATA: ...], [SOURCE NEEDED: ...], [ADD EXAMPLE: ...], [EXPERT QUOTE: ...] wherever first-hand proof belongs. Never invent it.",
    `- Plain language, short sentences, paragraphs under ${SEO.paragraph_max_words} words.`,
    "- No filler phrases such as: " + FILLER_PHRASES.slice(0, 12).join("; ") + ".",
    "- Mention the product only where it genuinely solves the problem being discussed.",
    "- Never repeat the keyword unnaturally. Use synonyms and natural language; there is no keyword-density target.",
    "- Choose the page structure from the search intent, not one blog template for everything."].join("\n");
}
export function rulesSummary() {
  return { version: RULES_VERSION, principles: CORE_PRINCIPLES, spam_patterns: SPAM_PATTERNS, high_risk_page_types: HIGH_RISK_PAGE_TYPES,
    intents: Object.fromEntries(Object.entries(INTENTS).map(([k, v]) => [k, v.label])),
    intent_formats: Object.fromEntries(Object.entries(INTENTS).map(([k, v]) => [k, v.formats])),
    page_types: PAGE_TYPES, page_type_labels: PAGE_TYPE_LABELS, page_type_groups: PAGE_TYPE_GROUPS, type_suggestions: TYPE_SUGGESTIONS, seo: SEO, scorecard: SCORECARD, guardrails: GUARDRAILS, structures: STRUCTURES,
    satisfaction_factors: SATISFACTION_FACTORS, source_tiers: SOURCE_TIERS, spam_risk_checks: SPAM_RISK_CHECKS,
    release_gate: RELEASE_GATE, url_actions: URL_ACTIONS };
}

// Confirmed Google Search ranking updates (Google Search Status Dashboard: status.search.google.com).
// Add new ones here as Google announces them.
export const GOOGLE_UPDATES = [
  { name: "March 2026 spam update", type: "spam", start: "2026-03-24", end: "2026-03-25" },
  { name: "March 2026 core update", type: "core", start: "2026-03-27", end: "2026-04-08" },
  { name: "May 2026 core update", type: "core", start: "2026-05-21", end: "2026-06-02" },
  { name: "June 2026 spam update", type: "spam", start: "2026-06-24", end: "2026-06-26" },
  { name: "August 2026 spam update", type: "spam", start: "2026-08-18", end: "2026-08-21" },
  { name: "September 2026 spam update", type: "spam", start: "2026-09-24", end: "2026-10-08" },
];

// What kind of website this is changes what a good page looks like. "ymyl" types (health, money, legal) need the strictest care:
// Google's guidelines call these "Your Money or Your Life" topics.
export const BUSINESS_TYPES = {
  saas: { label: "Software / SaaS", cta: "start a trial, book a demo, or see pricing", guidance: "Show the workflow with screenshots, be honest about limits, compare fairly with alternatives, and match calls to action to the funnel stage." },
  ecommerce: { label: "Online store", cta: "view the product, choose a size or variant, add to cart", guidance: "Include specifications, sizing or fit, materials, care, shipping, returns and real reviews; write unique descriptions (never copy manufacturer text); category pages need a short helpful intro, not a wall of keywords." },
  local: { label: "Local business or services", cta: "call, get directions, book an appointment, or request a quote", guidance: "Be specific about the area served, opening hours, prices or price ranges and what to expect. Never create near-identical pages for each town (doorway pages); only create a location page when there is a real branch or genuinely local content." },
  publisher: { label: "Publisher, blog or media", cta: "read a related article or subscribe", guidance: "Lead with original reporting, analysis or first-hand testing; credit sources; date and update articles; avoid rewriting what others published." },
  agency: { label: "Agency or professional services", cta: "see case studies or book a consultation", guidance: "Prove expertise with real case studies, named experts and specific results; explain the process and who it is for." },
  education: { label: "Education, nonprofit or community", cta: "learn more, enrol, donate or get involved", guidance: "Be accurate and accessible, cite authoritative sources, and state clearly who the organisation is and who runs it." },
  health: { label: "Health or medical", ymyl: true, cta: "book an appointment or talk to a professional", guidance: "This is a 'Your Money or Your Life' topic: content must be reviewed by a qualified medical professional (name and credentials), cite authoritative medical sources, never diagnose or replace professional advice, and avoid unsupported claims." },
  finance: { label: "Finance, insurance or investing", ymyl: true, cta: "talk to an adviser, compare options, or get a quote", guidance: "This is a 'Your Money or Your Life' topic: content must be reviewed by a qualified professional, cite official sources (regulators, official rates), state dates for figures, disclose risks and conflicts, and never promise returns." },
  legal: { label: "Legal", ymyl: true, cta: "book a consultation", guidance: "This is a 'Your Money or Your Life' topic: content must be reviewed by a qualified lawyer, say which jurisdiction it applies to, cite official sources, and make clear it is general information, not legal advice." },
  other: { label: "Other", cta: "take the most useful next step", guidance: "" },
};
