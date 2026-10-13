// mock.js - canned answers so the whole app can be tried without an API key (provider "Demo mode")
const S = { evalN: 0 };
const urls = (p, n) => { const a = [...p.matchAll(/- (https?:\/\/\S+) \|/g)].map(m => m[1]); return (a.length ? a : [...p.matchAll(/"(https?:\/\/[^"]+)"/g)].map(m => m[1])).slice(0, n); };
export async function mockResponse(task, prompt) {
  await new Promise(r => setTimeout(r, 150));
  const u = urls(prompt, 8), kwm = prompt.match(/(?:keyword|KEYWORD):?\s*"([^"]+)"/) || prompt.match(/Primary keyword: "([^"]+)"/), kw = kwm ? kwm[1] : "example keyword";
  if (task === "strategy") return { summary: "Demo summary of the site.", fit_score: 6, strengths: ["Product pages are detailed."],
    risks: [{ issue: "Large templated section", evidence: "/tutorials", severity: "high", fix: "Prune off-topic tutorials" }],
    section_review: [{ section: "/blog", verdict: "keep", reason: "On-topic" }], pages_to_improve: u[0] ? [{ url: u[0], why: "Thin", what_to_add: "Examples" }] : [],
    new_content: [{ keyword: "product demo video examples", intent: "informational", page_type: "blog_post", title_idea: "Product demo video examples", why_gap: "Not covered", information_gain: "Own customer examples", priority: "high", link_from: u.slice(0, 2) }] };
  if (task === "keyword") return { dominant_intent: "how_to", secondary_intents: ["informational"], intent_explanation: "Searchers want steps.", serp_format_expected: "Step-by-step guide",
    decision: "create", decision_reason: "Demo.", primary_url: "", consolidation: [], link_to_new_page_from: u.slice(0, 2).map(x => ({ url: x, anchor: "related", reason: "demo" })),
    existing_assessment: [], update_plan: { url: "", additions: [] }, different_intent_options: [{ keyword: kw + " examples", intent: "informational", page_type: "blog_post", angle: "Examples gallery", title_idea: kw + " examples" }] };
  if (task === "satisfaction") return { user_problem: "Needs to do X", user_goal: "Finish X today", why_now: "Deadline", knowledge_level: "beginner", expected_answer: "Steps plus example",
    required_information: ["steps", "example"], action_after_reading: "Complete X", best_format: "guide", format_reason: "",
    question_map: { primary: `How to ${kw}?`, supporting: ["What do I need?"], decision: ["Which tool?"], action: ["How do I start?"] }, next_questions: [{ question: "How long does it take?", own_page: false }], trust_needs: ["screenshots"] };
  if (task === "brief") return { angle: "Demo angle", reader: "Marketers", main_question: `How to ${kw}?`, direct_answer: "Short answer.", secondary_keywords: [],
    outline: [1, 2, 3, 4].map(i => ({ h2: `Step ${i}`, h3: [], notes: "" })), faqs: ["Q1?", "Q2?", "Q3?"], information_gain: ["Own data"], proof_needed: ["Screenshot"],
    internal_links: u.slice(0, 3).map(x => ({ url: x, anchor: "related guide", placement: "intro" })), link_from_existing: u.slice(0, 1).map(x => ({ url: x, anchor: "guide", where: "intro" })), cta: "Try it" };
  if (task === "article") {
    const links = u.slice(0, 4).map((x, i) => `See [related page ${i}](${x}).`).join(" ");
    const para = "This section explains the step clearly with practical detail for the reader and a worked example. ".repeat(6).trim();
    const secs = [1, 2, 3, 4, 5].map(i => `## Step ${i}: do the thing\n\n${para}\n\n${para}\n\n[ADD SCREENSHOT: step ${i}]`).join("\n\n");
    const faq = [1, 2, 3].map(i => `### Question ${i}?\n\nAnswer ${i} in two short sentences. It is direct.`).join("\n\n");
    return { title_tag: `How to ${kw}: Step-by-Step Guide`.slice(0, 60), meta_description: (`Learn how to ${kw} in five clear steps, with screenshots, examples and tips to avoid common mistakes. Updated guide.`).slice(0, 158),
      slug: kw.toLowerCase().split(/\s+/).slice(0, 6).join("-"), h1: `How to ${kw}`, direct_answer: "To do it, record, narrate, share.",
      body_markdown: `# How to ${kw}\n\nTo ${kw}, record your screen, add narration and share the link. This guide shows each step with examples.\n\n${links}\n\n${secs}\n\n## Frequently asked questions\n\n${faq}\n`,
      faqs: [1, 2, 3].map(i => ({ q: `Question ${i}?`, a: `Answer ${i}.` })), internal_links: u.slice(0, 4).map(x => ({ url: x, anchor: "related" })), secondary_keywords: [],
      image_suggestions: [{ placement: "Step 1", description: "Screenshot", alt: "Recording screen" }], proof_placeholders: ["[ADD SCREENSHOT: step 1]"],
      ai_disclosure: "Drafted with AI assistance and reviewed by the author.", cta: "Start free" };
  }
  if (task === "evaluate") {
    S.evalN++; const good = S.evalN % 2 === 0, sc = good ? 88 : 60;
    return { satisfaction: { factors: {}, score: sc, missing: good ? [] : ["No example"] }, task_completion: { score: sc, blockers: good ? [] : ["No checklist"] },
      question_coverage: [{ question: "What do I need?", type: "supporting", status: good ? "answered" : "missing" }], ai_citation_readiness: { score: sc, weak_passages: [] },
      evidence: { score: sc, note: "" }, content_quality: { score: sc, scorecard: Array.from({ length: 10 }, (_, i) => ({ q: i + 1, score: 2, reason: "demo" })) },
      spam_risk: [{ check: "duplicate_intent", level: "low", evidence: "demo" }], issues: good ? [] : [{ severity: "major", area: "satisfaction", issue: "No example", fix: "Add a worked example" }] };
  }
  if (task === "claims") return { claims: [{ claim: "record your screen", status: "supported", source_url: "https://example.com", source_tier: 1, note: "", correction: "" }],
    summary: { total: 1, supported: 1, unsupported: 0, false: 0, outdated: 0, needs_publisher_data: 0 } };
  if (task === "url_review") { const g = [...prompt.matchAll(/"url":"(https?:\/\/[^"]+)"/g)].map(m => m[1]).slice(0, 2);
    return { groups: [{ topic: "demo", intent: "transactional", primary_url: g[0] || "", urls: g.map((x, i) => ({ url: x, action: i ? "merge" : "keep", reason: "demo" })), priority: "P1" }] }; }
  if (task === "visibility") { const q = (prompt.match(/Question: "([^"]+)"/) || [])[1] || "";
    const us = /sop|demo/i.test(q);
    return { answer: us ? "Good options are Scribe, Trupeer and Tango. Trupeer turns screen recordings into polished videos and step-by-step guides." : "Popular options include Scribe, Tango and Loom for turning recordings into guides.",
      sources: us ? ["https://www.g2.com/categories/sop", "https://www.trupeer.ai/sop-creator", "https://www.reddit.com/r/sysadmin/sop"] : ["https://www.g2.com/categories/screen-recording", "https://www.capterra.com/screen-recording", "https://zapier.com/blog/best-screen-recorder"],
      brands_mentioned: us ? ["Scribe", "Trupeer", "Tango"] : ["Scribe", "Tango", "Loom"] }; }
  if (task === "why_not_us") return { summary: "Assistants recommend tools that appear on review sites and comparison articles. Your site isn't among the sources they used.",
    reasons: ["The answers cite G2 and Capterra category pages where you aren't listed prominently.", "No page on your site directly answers this question."],
    actions: [{ type: "get_listed", title: "Get reviews on G2", detail: "Ask 10 happy customers to review you on the G2 category page the assistants cited.", target: "https://www.g2.com/categories/screen-recording" },
      { type: "create_page", title: "Publish a comparison page", detail: "Create an honest comparison that answers this exact question, with your own test results.", target: "" }],
    suggested_keyword: "best screen recorder for tutorials" };
  if (task === "question_ideas") return { questions: [{ question: "What's the best tool to turn a screen recording into an SOP?", type: "recommendation", why: "Core use case" },
      { question: "Scribe vs Tango: which is better for documenting processes?", type: "comparison", why: "Buyers compare tools" },
      { question: "How do I create training videos without editing skills?", type: "how_to", why: "Common problem" }] };
  if (task === "ideas") { const seed = (prompt.match(/seed topic "([^"]+)"/) || [])[1] || "topic";
    return { ideas: [["how to create " + seed, "how_to", "question"], [seed + " template", "informational", "long_tail"], ["best " + seed + " software", "commercial", "comparison"],
      [seed + " for hr teams", "commercial", "use_case"], ["what is " + seed, "informational", "question"], [seed + " examples", "informational", "long_tail"], ["how to create product demo videos", "how_to", "question"]]
      .map(([keyword, intent, type]) => ({ keyword, intent, type, why: "Demo idea", suggested_page_type: intent === "how_to" ? "how_to_guide" : "blog_post", priority: "medium" })),
      note: "Demo ideas. Check real search volumes in Ahrefs, Semrush or Keyword Planner." }; }
  if (task === "serp") return { searched: true, results: [
      { title: "How to Create a Product Demo Video (Step by Step)", url: "https://example.com/blog/product-demo-video", type: "guide", angle: "Step-by-step guide with templates" },
      { title: "12 Best Product Demo Video Examples", url: "https://example.org/demo-examples", type: "listicle", angle: "Gallery of examples" },
      { title: "Demo video maker", url: "https://example.net/demo-maker", type: "tool", angle: "Product page for a video tool" },
      { title: "Reddit: how do you make demo videos?", url: "https://reddit.com/r/saas/demo", type: "forum", angle: "Practitioner tips" }],
    dominant_format: "Step-by-step how-to guide", format_mix: [{ type: "guide", count: 5 }, { type: "listicle", count: 2 }, { type: "tool", count: 2 }, { type: "forum", count: 1 }],
    must_cover: [{ topic: "Scripting the demo", share: "most" }, { topic: "Recording tools", share: "most" }, { topic: "Editing and voiceover", share: "some" }, { topic: "Video length", share: "few" }],
    questions: ["How long should a product demo video be?", "What should a demo video include?", "Which tool is best for demo videos?"],
    gaps: ["Few show a real before/after example", "Nobody covers updating demos when the UI changes"],
    competition: { level: "medium", reason: "Mix of SaaS blogs and tool vendors; no dominant brand" },
    recommended_angle: "Show a real recording turned into a finished demo, with timings", recommended_page_type: "how_to_guide", length_note: "1,500-2,500-word guides" };
  if (task === "update_plan") return { verdict: "Covers the basics but misses steps searchers expect.", fit_score: 58,
    keep: ["Clear intro", "Product screenshots"], add_sections: [{ heading: "How long should a demo video be?", why: "Common question", priority: "high" }, { heading: "Script template", why: "Top pages include one", priority: "medium" }],
    questions_to_answer: ["What should a demo video include?"], rewrite: [{ what: "title tag", current: "Old title", suggested: "How to Create a Product Demo Video (2026 Guide)", why: "Matches the search" }],
    remove_or_trim: ["Generic opening paragraph"], proof_to_add: ["A before/after example from a customer"], internal_links: ["Link from the pricing page"],
    first_three_steps: ["Add the length section", "Rewrite the title", "Add a real example"] };
  if (task === "rewrite_section") { const sec = (prompt.split('SECTION TO REWRITE:\n"""\n')[1] || "").split('\n"""')[0]; const head = (sec.match(/^## .+$/m) || ["## Section"])[0];
    return { markdown: `${head}\n\nThis section was rewritten to be more specific. It now walks through the step with a concrete example and a short checklist.\n\n- Check one thing first\n- Then do the next thing\n\n[ADD SCREENSHOT: the finished result]`, summary: "Made it more specific and added a checklist." }; }
  if (task === "page_fixes") return { keyword: "product demo videos", title_tag: "Product Demo Videos: Create Them in Minutes | Demo",
    meta_description: "Turn a screen recording into a polished product demo video with voiceover, zooms and captions. See how it works and start free today.",
    h1: "Create product demo videos in minutes", why: "Shorter title with the topic first; the description now says what the page offers.",
    other_fixes: ["Keep one H1 and turn the repeated banner heading into an H2.", "Add alt text to the hero images."] };
  if (task === "snippet_fix") return { diagnosis: "The title talks about the brand, not what the searcher asked.",
    options: [{ angle: "Direct answer", title_tag: "SOP Software: Create SOPs From Screen Recordings", meta_description: "Record a process once and get a step-by-step SOP with screenshots in minutes. See how SOP software turns recordings into docs your team uses." },
      { angle: "Outcome", title_tag: "SOP Software That Writes Your SOPs in Minutes", meta_description: "Stop writing SOPs by hand. Record your screen and get a ready-to-share SOP with steps and screenshots. Free to start, no setup needed." },
      { angle: "Specific detail", title_tag: "SOP Software With Screenshots and Video Steps", meta_description: "Each SOP comes with annotated screenshots, a short video and editable steps, so new hires follow the process without asking. See examples." }] };
  if (task === "strategy_v2") return { summary: "The site covers product videos and documentation well, but has few comparison and decision pages. Tutorials about other companies' products dilute topical focus.", fit_score: 7,
    strengths: ["Strong product pages for SOP creation and video translation", "Many customer stories"], risks: [{ issue: "Large templated tutorial section about third-party tools", evidence: "/tutorials", severity: "high", fix: "Keep tutorials tied to your product; noindex or remove the rest" }],
    section_review: [{ section: "/blog", verdict: "keep", reason: "On-topic" }, { section: "/tutorials", verdict: "improve", reason: "Mostly off-topic" }],
    pages_to_improve: u[0] ? [{ url: u[0], why: "Ranks on page 2 for its main search", what_to_add: "Worked example and comparison table", keyword: "sop software" }] : [],
    clusters: [{ name: "SOP creation", pillar: { keyword: "sop software", title_idea: "SOP software guide", existing_url: u[1] || "" },
      ideas: [{ keyword: "how to write an sop", title_idea: "How to Write an SOP (With a Free Template)", intent: "how_to", page_type: "how_to_guide", funnel: "awareness", angle: "Real recording turned into an SOP", information_gain: "Before/after example", evidence: [{ type: "google", detail: "2,500 impressions at position 11" }], priority: "high", is_pillar: false },
        { keyword: "sop template", title_idea: "Free SOP Templates", intent: "informational", page_type: "blog_post", funnel: "awareness", angle: "Downloadable templates", information_gain: "Templates from real customers", evidence: [{ type: "keyword", detail: "Keyword with no page, 8,100 searches" }], priority: "high", is_pillar: false },
        { keyword: "scribe vs tango", title_idea: "Scribe vs Tango: Honest Comparison", intent: "commercial", page_type: "comparison", funnel: "decision", angle: "Hands-on test", information_gain: "Own test results", evidence: [{ type: "ai", detail: "ChatGPT names Scribe and Tango, not you" }], priority: "medium", is_pillar: false }] },
      { name: "Product demo videos", pillar: { keyword: "product demo video", title_idea: "Product Demo Videos: The Complete Guide", existing_url: "" },
        ideas: [{ keyword: "product demo video", title_idea: "Product Demo Videos: The Complete Guide", intent: "informational", page_type: "pillar_guide", funnel: "awareness", angle: "Everything in one place", information_gain: "Benchmarks from your own videos", evidence: [{ type: "site", detail: "No pillar page for this topic" }], priority: "high", is_pillar: true },
          { keyword: "how to make a product demo video", title_idea: "How to Make a Product Demo Video", intent: "how_to", page_type: "how_to_guide", funnel: "consideration", angle: "Step by step", information_gain: "Screenshots", evidence: [{ type: "judgement", detail: "Core use case" }], priority: "medium", is_pillar: false }] }] };
  if (task === "audit") return { scores: Array.from({ length: 10 }, (_, i) => ({ q: i + 1, score: 1, reason: "demo" })), intent: { detected: "how_to", matches_keyword: true, note: "" },
    duplicates: [], risk_flags: [], internal_links: u.slice(0, 3).map(x => ({ url: x, anchor: "x" })), satisfaction: { score: 70, missing: ["Example"] }, task_completion: { score: 65, blockers: [] },
    ai_citation_readiness: { score: 60, weak_passages: [] }, spam_risk: [], suggested_title_tag: "Demo", suggested_meta_description: "Demo", suggested_h2s: [], suggested_faqs: [], top_fixes: ["Demo fix"] };
  return {};
}
