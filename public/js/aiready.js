// aiready.js - AI-answer readiness: which AI crawlers robots.txt lets in, an llms.txt for the site, and a per-page checklist.
// Answer and search bots fetch pages to cite them; blocking them stops citations. Training bots collect data for model training;
// blocking them is a business choice and doesn't stop citations.
export const AI_BOTS = [
  { agent: "OAI-SearchBot", owner: "OpenAI", kind: "search", note: "ChatGPT search results" }, { agent: "ChatGPT-User", owner: "OpenAI", kind: "search", note: "pages ChatGPT opens for a user" },
  { agent: "GPTBot", owner: "OpenAI", kind: "training", note: "model training" },
  { agent: "Claude-SearchBot", owner: "Anthropic", kind: "search", note: "Claude search" }, { agent: "Claude-User", owner: "Anthropic", kind: "search", note: "pages Claude opens for a user" },
  { agent: "ClaudeBot", owner: "Anthropic", kind: "training", note: "model training" },
  { agent: "PerplexityBot", owner: "Perplexity", kind: "search", note: "Perplexity answers" }, { agent: "Perplexity-User", owner: "Perplexity", kind: "search", note: "pages Perplexity opens for a user" },
  { agent: "Bingbot", owner: "Microsoft", kind: "search", note: "Bing and Copilot answers" }, { agent: "Googlebot", owner: "Google", kind: "search", note: "Google Search and AI Overviews" },
  { agent: "Google-Extended", owner: "Google", kind: "training", note: "Gemini training (not Search)" }, { agent: "Applebot-Extended", owner: "Apple", kind: "training", note: "Apple AI training" },
  { agent: "CCBot", owner: "Common Crawl", kind: "training", note: "open dataset used to train many models" }, { agent: "Meta-ExternalAgent", owner: "Meta", kind: "training", note: "Meta AI training" },
  { agent: "Bytespider", owner: "ByteDance", kind: "training", note: "model training" }, { agent: "Amazonbot", owner: "Amazon", kind: "search", note: "Alexa and Amazon answers" },
];
// robots.txt groups: [{agents:[...], rules:[{allow, path}]}]
export function parseRobots(text) {
  const groups = []; let cur = null, lastWasAgent = false;
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim(); if (!line) continue;
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i); if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === "user-agent") { if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); lastWasAgent = true; }
    else { lastWasAgent = false; if (!cur) continue; if (k === "allow" || k === "disallow") cur.rules.push({ allow: k === "allow", path: v }); }
  }
  return groups;
}
const ruleMatches = (path, rule) => { if (!rule) return false; const re = new RegExp("^" + rule.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$")); return re.test(path); };
// may this crawler read this path? (the most specific matching rule wins; allow wins a tie; an empty Disallow allows everything)
export function allowed(groups, agent, path = "/") {
  const a = agent.toLowerCase(), g = groups.filter(x => x.agents.some(n => n !== "*" && a.includes(n))), use = g.length ? g : groups.filter(x => x.agents.includes("*"));
  if (!use.length) return { allowed: true, by: "no rules" };
  let best = null; for (const r of use.flatMap(x => x.rules)) { if (r.path === "" ) continue; if (!ruleMatches(path, r.path)) continue; if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r; }
  return { allowed: !best || best.allow, by: g.length ? `rules for ${agent}` : "rules for all crawlers (*)", rule: best ? `${best.allow ? "Allow" : "Disallow"}: ${best.path}` : "" };
}
export function botReport(robotsText, paths = ["/"]) {
  const groups = parseRobots(robotsText);
  return AI_BOTS.map(b => { const res = paths.map(p => ({ path: p, ...allowed(groups, b.agent, p) })); const blocked = res.filter(r => !r.allowed);
    return { ...b, allowed: !blocked.length, partial: blocked.length > 0 && blocked.length < res.length, blocked_paths: blocked.map(r => r.path), by: res[0].by, rule: blocked[0]?.rule || res[0].rule }; });
}
// a checklist per page, from what the reader recorded
const QWORD = /^(how|what|why|when|where|which|who|can|does|do|is|are|should|will)\b/i;
export function pageCheck(p, now = Date.now()) {
  const text = `${p.excerpt || ""}${p.text_more || ""}`, first = text.split(/(?<=[.!?])\s+/).slice(0, 2).join(" "), words = p.word_count || 0;
  const h2 = (p.h2 || []).filter(Boolean), qh = h2.filter(h => /\?\s*$/.test(h) || QWORD.test(h)).length, nums = (text.match(/\b\d[\d,.]*\s?(%|percent|x|times|minutes|hours|days|seconds|users|customers|\$|€|£)?/gi) || []).length;
  const dated = p.date_modified || p.date_published || "", age = dated ? Math.round((now - Date.parse(dated)) / 864e5) : null;
  const checks = [
    { id: "answer", label: "Answers the topic directly near the top", ok: first.split(/\s+/).length >= 12 && first.split(/\s+/).length <= 70 && / (is|are|means|lets|helps|allows|turns) /i.test(first), fix: "Open with a 1-2 sentence direct answer (what it is / how to do it) before any background." },
    { id: "questions", label: "Headings people would ask", ok: qh >= 2 || (h2.length && qh / h2.length >= 0.3), fix: "Phrase some headings as the questions people ask (How…, What…, Why…)." },
    { id: "facts", label: "Concrete facts and figures", ok: nums >= 3, fix: "Add specific numbers, steps, prices or dates that an AI answer can quote." },
    { id: "dated", label: "Shows when it was published or updated", ok: !!dated && age != null && age <= 365, fix: dated ? `Last dated ${dated}: review and update it, and show the updated date.` : "Show a published or updated date (and add datePublished/dateModified to the structured data)." },
    { id: "author", label: "Shows who wrote it", ok: !!p.has_author, fix: "Show the author (a named person or the company team) with a short credential." },
    { id: "schema", label: "Structured data", ok: (p.schema_types || []).length > 0, fix: "Add JSON-LD (Article, FAQPage where suitable, Organization, BreadcrumbList)." },
    { id: "depth", label: "Enough depth to be a source", ok: words >= 500, fix: `Only ${words} words: cover the topic fully enough to be quoted.` },
  ];
  return { url: p.url, title: p.title || p.url, score: Math.round(100 * checks.filter(c => c.ok).length / checks.length), checks, dated, age };
}
// llms.txt (llmstxt.org): a title, a short summary, and key pages grouped by section with one-line descriptions
export function llmsTxt(site, pages, clicksByUrl = new Map()) {
  const clean = t => String(t || "").replace(/\s+/g, " ").trim(), title = t => clean(String(t || "").split(/\s[|\-–—]\s/)[0]);
  const secOf = u => { try { const s = new URL(u).pathname.split("/").filter(Boolean)[0] || ""; return s ? s.replace(/[-_]/g, " ").replace(/^\w/, c => c.toUpperCase()) : "Main pages"; } catch { return "Main pages"; } };
  const list = pages.filter(p => p.url && !p.noindex && (p.word_count || 0) >= 150 && !/\.(pdf|jpg|png|zip)$/i.test(p.url))
    .sort((a, b) => (clicksByUrl.get(b.url) || 0) - (clicksByUrl.get(a.url) || 0) || (b.inbound_links || 0) - (a.inbound_links || 0)).slice(0, 80);
  const groups = new Map(); for (const p of list) { const s = secOf(p.url); if (!groups.has(s)) groups.set(s, []); groups.get(s).push(p); }
  const order = [...groups.entries()].sort((a, b) => (a[0] === "Main pages" ? -1 : b[0] === "Main pages" ? 1 : b[1].length - a[1].length));
  const summary = clean(site.product || site.description || list[0]?.meta_description || "");
  return `# ${clean(site.name || new URL(site.url).hostname)}\n\n${summary ? `> ${summary}\n\n` : ""}${site.audience ? `Built for: ${clean(site.audience)}\n\n` : ""}` +
    order.map(([sec, ps]) => `## ${sec}\n\n${ps.slice(0, 15).map(p => `- [${title(p.title) || p.url}](${p.url})${p.meta_description ? `: ${clean(p.meta_description).slice(0, 160)}` : ""}`).join("\n")}`).join("\n\n") + "\n";
}

// your live llms.txt against a fresh one: important pages it's missing, and links to pages that weren't found on the site
export function compareLlms(live, fresh, knownUrls) {
  const links = t => [...String(t || "").matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map(m => m[1].replace(/\/$/, ""));
  const L = new Set(links(live)), F = links(fresh), known = new Set([...knownUrls].map(u => String(u).replace(/\/$/, "")));
  return { missing: F.filter(u => !L.has(u)).slice(0, 20), unknown: [...L].filter(u => !known.has(u)).slice(0, 20), live_links: L.size };
}
