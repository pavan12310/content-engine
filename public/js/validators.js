// validators.js - deterministic checks of every generated page (no AI)
import { SEO, FILLER_PHRASES, PLACEHOLDER_RE } from "./rules.js";
const words = s => (s || "").match(/[A-Za-z0-9\u00c0-\uffff']+/g) || [];
const host = u => { try { return new URL(u).host.replace(/^www\./, ""); } catch { return ""; } };
const norm = u => (u || "").replace(/\/$/, "").split("#")[0].toLowerCase();

export function check(payload, keyword, pageType, validUrls, author = "") {
  const body = payload.body_markdown || "", checks = [];
  const add = (id, label, ok, detail = "", level = "fail") => checks.push({ id, label, status: ok ? "pass" : level, detail });
  const t = payload.title_tag || "";
  add("title_len", "Title tag length", t.length >= SEO.title_min_chars && t.length <= SEO.title_max_chars, `${t.length} chars (target ${SEO.title_min_chars}-${SEO.title_max_chars})`);
  const kw = words(keyword.toLowerCase()).filter(w => w.length > 2);
  add("title_kw", "Keyword in title tag", kw.length ? kw.slice(0, 3).every(w => t.toLowerCase().includes(w)) : true, "", "warn");
  const m = payload.meta_description || "";
  add("meta_len", "Meta description length", m.length >= SEO.meta_min_chars && m.length <= SEO.meta_max_chars, `${m.length} chars (target ${SEO.meta_min_chars}-${SEO.meta_max_chars})`, "warn");
  const slug = payload.slug || "";
  add("slug", "Clean URL slug", /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) && slug.split("-").length <= SEO.slug_max_words, slug, "warn");
  const h1 = body.match(/^# (?!#)/gm) || [];
  add("h1", "Exactly one H1", h1.length === 1, `${h1.length} found`);
  const h2 = body.match(/^## (?!#).+$/gm) || [];
  add("h2", "H2 sections", h2.length >= SEO.min_h2 && h2.length <= SEO.max_h2, `${h2.length} H2s (target ${SEO.min_h2}-${SEO.max_h2})`);
  const after = body.split(/^# .*$/m); let first = "";
  if (after.length > 1) first = (after[1].trim().split(/\n\n/).map(x => x.trim()).filter(x => x && !x.startsWith("#"))[0]) || "";
  const fw = words(first).length;
  add("direct_answer", "Direct answer right under the H1", fw > 0 && fw <= SEO.direct_answer_max_words + 15, `${fw} words`, "warn");
  add("answer_kw", "Keyword in the opening answer", kw.length ? kw.some(w => first.toLowerCase().includes(w)) : true, "", "warn");
  const wc = words(body).length, minw = SEO.min_words[pageType] || 800;
  add("length", "Enough depth for the page type", wc >= minw, `${wc} words (minimum ${minw} for ${pageType})`);
  const links = [...body.matchAll(/(?<!!)\[[^\]]+\]\((https?:\/\/[^)\s]+)\)/g)].map(x => x[1]);   // images (![..](..)) are not links
  const vset = new Set([...validUrls].map(norm)), hosts = new Set([...vset].map(host));
  const internal = new Set(links.filter(u => vset.has(norm(u))));
  const fake = links.filter(u => hosts.has(host(u)) && !vset.has(norm(u)));
  add("internal_links", "Internal links to real pages", internal.size >= SEO.internal_links_min && internal.size <= SEO.internal_links_max, `${internal.size} internal links (target ${SEO.internal_links_min}-${SEO.internal_links_max})`);
  add("no_fake_links", "No links to pages that don't exist", !fake.length, fake.slice(0, 5).join(", "));
  const faqs = payload.faqs || [];
  add("faq", "FAQ section", faqs.length >= SEO.faq_min && faqs.length <= SEO.faq_max && /^## .*(faq|frequently asked)/im.test(body), `${faqs.length} FAQs`, "warn");
  // unnatural repetition (no density target)
  const phrase = keyword.toLowerCase().trim(), stuffing = [];
  if (phrase) {
    const toks = words(body.toLowerCase()), pw = phrase.split(/\s+/), L = pw.length, hits = [];
    for (let i = 0; i + L <= toks.length; i++) if (pw.every((w, k) => toks[i + k] === w)) hits.push(i);
    const worst = Math.max(0, ...hits.map(a => hits.filter(h => h >= a && h < a + 150).length));
    if (worst > Math.max(2, SEO.max_phrase_per_100_words * 1.5)) stuffing.push(`${worst} uses of "${phrase}" within 150 words`);
    for (const sent of body.toLowerCase().split(/(?<=[.!?])\s+|\n+/)) {
      if (sent.trim().startsWith("#")) continue;
      if (sent.split(phrase).length - 1 > SEO.max_phrase_per_sentence) { stuffing.push("phrase repeated in one sentence: " + sent.slice(0, 70)); break; }
    }
    const anchors = [...body.matchAll(/(?<!!)\[([^\]]+)\]\(https?:\/\//g)].map(x => x[1].toLowerCase().trim());
    if (anchors.length >= 3 && anchors.filter(a => a === phrase).length / anchors.length > SEO.max_exact_match_anchor_share) stuffing.push("too many exact-match anchors");
  }
  add("repetition", "No unnatural keyword repetition", !stuffing.length, stuffing.join("; ") || "natural");
  const low = body.toLowerCase(), fillers = FILLER_PHRASES.filter(f => low.includes(f));
  add("filler", "No filler / generic AI phrases", !fillers.length, fillers.join(", "), fillers.length <= 2 ? "warn" : "fail");
  const longP = body.split(/\n\n/).filter(p => !/^\s*(#|\||-|\*|1\.)/.test(p) && words(p).length > SEO.paragraph_max_words);
  add("paragraphs", "Short, readable paragraphs", !longP.length, `${longP.length} long paragraphs`, "warn");
  const stat = body.split(/(?<=[.!?])\s+/).filter(s => /\d+(\.\d+)?\s?%|\b\d{2,}\b.*\b(percent|users|companies|study|survey|report)\b/i.test(s));
  const unsourced = stat.filter(s => !/\]\(https?:\/\/|\[SOURCE|\[ADD DATA|according to \[/i.test(s));
  add("stats_sourced", "Statistics have sources or placeholders", !unsourced.length, `${unsourced.length} unsourced: ` + unsourced.slice(0, 3).map(x => x.slice(0, 80)).join(" | "));
  const ph = body.match(PLACEHOLDER_RE) || [];
  add("proof", "First-hand proof marked for the author", ph.length >= 1, `${ph.length} placeholders to fill before publishing`, "warn");
  add("author", "Named author", !!author.trim(), author.trim() ? author : "Add the author's name and role");
  const fails = checks.filter(c => c.status === "fail").length, warns = checks.filter(c => c.status === "warn").length;
  return { checks, fails, warns, seo_score: Math.round(100 * (checks.length - fails - 0.5 * warns) / checks.length), word_count: wc,
    placeholders: ph.length, fix_list: checks.filter(c => c.status === "fail" && c.id !== "author").map(c => `${c.label}: ${c.detail}`) };
}
