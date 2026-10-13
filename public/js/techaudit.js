// techaudit.js - deterministic technical / on-page SEO audit of the pages read. No AI involved.
import { langOf } from "./text.js";
export const SEV = { error: 0, high: 1, medium: 2, low: 3 };
// check: [severity, label, how to fix, why it matters]
export const CHECKS = {
  http_error: ["error", "Page returns an error", "Fix the page, or redirect it to the right page and update links pointing to it.", "Visitors and Google hit a dead end, and the page can't rank."],
  broken_internal_link: ["error", "Links to a broken page", "Update or remove links that point to pages returning errors.", "Broken links frustrate readers and waste Google's crawling."],
  noindex: ["high", "Hidden from Google (noindex)", "Remove the noindex tag unless the page should stay out of search on purpose (then click Ignore).", "A noindex page can never rank or be cited from Google Search."],
  canonical_elsewhere: ["high", "Canonical points to another URL", "Point the canonical to the page itself, unless this page is meant to be a duplicate.", "Google may index the other URL instead of this one."],
  missing_viewport: ["high", "Not set up for mobile", "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"> to the page head.", "Google ranks the mobile version of pages; without this, phones show a shrunk desktop page."],
  missing_title: ["high", "Missing title tag", "Add a unique, descriptive title that matches what searchers want.", "The title is the main headline people see in Google."],
  duplicate_title: ["high", "Same title as another page", "Give each page its own title, or merge pages that cover the same thing.", "Duplicate titles make pages compete with each other and confuse searchers."],
  missing_h1: ["high", "Missing main heading (H1)", "Add one clear H1 stating the page's topic.", "The H1 tells readers and Google what the page is about."],
  near_empty: ["high", "Almost no readable text", "Make sure the main content is in the HTML, not only loaded by JavaScript.", "Google and AI tools may see an empty page."],
  insecure_resources: ["medium", "Loads insecure (http) files", "Load images, scripts and styles over https.", "Browsers block or warn about mixed content, which breaks pages and hurts trust."],
  multiple_h1: ["medium", "More than one H1", "Keep one H1; turn the others into H2s. Repeated template blocks often cause this.", "Several main headings blur what the page is about."],
  duplicate_h1: ["medium", "Same H1 as another page", "Make each page's main heading specific to that page.", "Pages look interchangeable to readers and Google."],
  title_length: ["medium", "Title too long or too short", "Aim for 30–60 characters, with the main topic near the start.", "Long titles get cut off in Google; very short ones waste the space."],
  missing_meta: ["medium", "Missing meta description", "Write an honest 120–160 character summary of the page.", "Without one, Google picks a random snippet, which often gets fewer clicks."],
  duplicate_meta: ["medium", "Same meta description as another page", "Write a unique description for each page.", "Identical snippets make pages look the same in search results."],
  thin: ["medium", "Thin page (under 300 words)", "Add what the searcher needs, or merge the page into a stronger one.", "Thin pages rarely satisfy searchers and can drag down site quality."],
  meta_length: ["low", "Meta description too long or too short", "Aim for about 120–160 characters.", "Too long gets cut off; too short undersells the page."],
  links_to_redirect: ["low", "Links to a redirecting URL", "Point links straight to the final URL.", "Each redirect slows visitors down and wastes crawling."],
  redirect_in_sitemap: ["low", "Sitemap lists a redirecting URL", "List the final URL in your sitemap instead.", "Sitemaps should only list pages you want indexed."],
  images_missing_alt: ["low", "Images without alt text", "Describe meaningful images in their alt text; decorative images can have empty alt.", "Alt text helps screen readers, image search and AI understanding."],
  missing_lang: ["low", "Page language not declared", "Add a lang attribute, e.g. <html lang=\"en\">.", "Helps browsers, screen readers and search engines handle the language correctly."],
  missing_og: ["low", "No social sharing tags", "Add og:title and og:image (and og:description).", "Without them, shared links on LinkedIn, Slack or WhatsApp look bare."],
  no_internal_links: ["low", "No links to other pages", "Add links to related pages that help the reader's next step.", "Internal links guide readers and help Google discover pages."],
  few_inbound: ["low", "No other page links here", "Link to this page from related pages, or check it's still needed.", "Orphan pages are hard for readers and Google to find."],
  no_structured_data: ["low", "No structured data", "Add relevant schema (Article, Product, Organization, BreadcrumbList).", "Structured data helps Google and AI tools understand the page."],
  large_html: ["low", "Very large page", "Trim inline code and unused markup.", "Heavy pages load slowly, especially on phones."],
  long_url: ["low", "Very long URL", "Use a short, readable slug.", "Short URLs are easier to read, share and understand."],
};
const norm = u => (u || "").replace(/\/$/, "").split("#")[0].split("?")[0].toLowerCase();

// pages: crawled pages; opts.ignored: Set of "check|url"; opts.traffic: Map(normUrl -> {clicks, impressions})
export function run(site, pages, opts = {}) {
  const ignored = opts.ignored || new Set(), traffic = opts.traffic || new Map();
  const f = {}; let ignoredN = 0;
  const push = (k, x) => { if (ignored.has(k + "|" + x.url)) { ignoredN++; return; } (f[k] = f[k] || []).push(x); };
  const summ = site.summary || {};
  const failed = new Map((summ.failed_pages || []).map(x => [norm(x.url), x]));
  const redirectFrom = new Map((summ.redirects || []).map(x => [norm(x.from), x.to]));
  for (const x of failed.values()) push("http_error", { url: x.url, detail: `status ${x.status || "no response"} ${x.error || ""}`.trim() });
  for (const [from, to] of redirectFrom) push("redirect_in_sitemap", { url: from, detail: `redirects to ${to}` });
  const complete = pages.length >= 0.8 * (summ.urls_discovered || pages.length);
  const titles = new Map(), h1s = new Map(), metas = new Map(); const grp = (m, k, u) => { if (!m.has(k)) m.set(k, []); m.get(k).push(u); };
  for (const p of pages) {
    const url = p.url, title = (p.title || "").trim(), meta = (p.meta_description || "").trim(), lang = langOf(url);
    const h = (Array.isArray(p.h1) ? p.h1 : [p.h1]).filter(Boolean);
    if (p.noindex) push("noindex", { url, detail: "" });
    if (p.canonical && /^http/.test(p.canonical) && norm(p.canonical) !== norm(url)) push("canonical_elsewhere", { url, detail: `canonical: ${p.canonical}` });
    if (p.viewport === false) push("missing_viewport", { url, detail: "" });
    if (!title) push("missing_title", { url, detail: "" });
    else if (title.length < 30 || title.length > 60) push("title_length", { url, detail: `${title.length} characters: ${title.slice(0, 80)}` });
    if (title) grp(titles, lang + "|" + title.toLowerCase(), url);
    if (!h.length) push("missing_h1", { url, detail: "" }); else if (h.length > 1) push("multiple_h1", { url, detail: `${h.length} H1s` });
    if (h.length) grp(h1s, lang + "|" + h[0].toLowerCase(), url);
    if (!meta) push("missing_meta", { url, detail: "" });
    else { grp(metas, lang + "|" + meta.toLowerCase(), url); if (meta.length < 70 || meta.length > 160) push("meta_length", { url, detail: `${meta.length} characters` }); }
    const wc = p.word_count || 0;
    if (wc < 30) push("near_empty", { url, detail: `${wc} words` }); else if (wc < 300) push("thin", { url, detail: `${wc} words` });
    if ((p.images_missing_alt || 0) > 0) push("images_missing_alt", { url, detail: `${p.images_missing_alt} of ${p.images || "?"} images` });
    if (p.internal_links === 0) push("no_internal_links", { url, detail: "" });
    if (complete && pages.length >= 20 && p.inbound_links === 0 && norm(url) !== norm(site.url)) push("few_inbound", { url, detail: "" });
    if (Array.isArray(p.schema_types) && !p.schema_types.length) push("no_structured_data", { url, detail: "" });
    if (p.lang === "" && "viewport" in p) push("missing_lang", { url, detail: "" });
    if (p.og === false) push("missing_og", { url, detail: "" });
    if ((p.insecure_resources || 0) > 0) push("insecure_resources", { url, detail: `${p.insecure_resources} insecure files` });
    if ((p.html_bytes || 0) > 1500000) push("large_html", { url, detail: `${Math.round(p.html_bytes / 1024)} KB of HTML` });
    if (url.length > 115) push("long_url", { url, detail: `${url.length} characters` });
    if (Array.isArray(p.links_out)) {
      const broken = p.links_out.filter(l => failed.has(norm(l)));
      if (broken.length) push("broken_internal_link", { url, detail: `${broken.length} broken: ${broken.slice(0, 3).join(", ")}` });
      const red = p.links_out.filter(l => redirectFrom.has(norm(l)));
      if (red.length) push("links_to_redirect", { url, detail: `${red.length} link${red.length > 1 ? "s" : ""}: ${red.slice(0, 2).join(", ")}` });
    }
  }
  for (const [key, m] of [["duplicate_title", titles], ["duplicate_h1", h1s], ["duplicate_meta", metas]])
    for (const [k, urls] of m) if (urls.length > 1) for (const u of urls) push(key, { url: u, detail: `shared by ${urls.length} pages: “${k.split("|").slice(1).join("|").slice(0, 70)}”` });
  const tr = u => traffic.get(norm(u)) || null;
  const issues = Object.entries(f).map(([key, items]) => {
    const [severity, label, fix, why] = CHECKS[key];
    const withT = items.map(x => ({ ...x, clicks: tr(x.url)?.clicks ?? null })).sort((a, b) => (b.clicks || 0) - (a.clicks || 0));
    return { check: key, severity, label, fix, why, count: items.length, clicks: withT.reduce((a, x) => a + (x.clicks || 0), 0), pages: withT.slice(0, 200) };
  }).sort((a, b) => SEV[a.severity] - SEV[b.severity] || b.clicks - a.clicks || b.count - a.count);
  // page index for the "Pages" view
  const byPage = new Map();
  for (const i of issues) for (const x of i.pages) {
    const e = byPage.get(x.url) || { url: x.url, issues: [], error: 0, high: 0, medium: 0, low: 0, clicks: tr(x.url)?.clicks ?? null, impressions: tr(x.url)?.impressions ?? null };
    e.issues.push({ check: i.check, severity: i.severity, label: i.label, detail: x.detail }); e[i.severity]++; byPage.set(x.url, e);
  }
  const pageRows = [...byPage.values()].sort((a, b) => (b.error * 1000 + b.high * 100 + b.medium * 10 + b.low) * (1 + Math.log10(1 + (b.clicks || 0))) - (a.error * 1000 + a.high * 100 + a.medium * 10 + a.low) * (1 + Math.log10(1 + (a.clicks || 0))));
  const serious = new Set(issues.filter(i => ["error", "high"].includes(i.severity)).flatMap(i => i.pages.map(x => x.url)));
  const keys = issues.flatMap(i => i.pages.map(x => i.check + "|" + x.url));
  return { pages_checked: pages.length, health_score: Math.max(0, Math.round(100 - 100 * serious.size / Math.max(pages.length + failed.size, 1))),   // failed pages count as checked pages
    counts: Object.fromEntries(Object.keys(SEV).map(s => [s, issues.filter(i => i.severity === s).reduce((a, i) => a + i.count, 0)])),
    issues, page_rows: pageRows, ignored_count: ignoredN, keys, has_traffic: traffic.size > 0,
    crawled_at: summ.crawled_at || "", crawl_id: summ.crawl_id || summ.crawled_at || "", complete,
    note: complete ? "All pages on the site were checked." : `Checked the ${pages.length} pages read in the last crawl (out of ${summ.urls_discovered || "?"} on the site). Read more pages for fuller coverage.` };
}
