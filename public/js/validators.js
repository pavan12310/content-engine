// validators.js - deterministic checks of every generated page (no AI)
import { SEO, FILLER_PHRASES, PLACEHOLDER_RE } from "./rules.js";
import { wordList, countWords, sentences, detectLang, isCJK, FILLERS, readabilityLimit } from "./lang.js";
const words = s => wordList(s);   // counts Japanese/Chinese by characters (about two per word)
const host = u => { try { return new URL(u).host.replace(/^www\./, ""); } catch { return ""; } };
const norm = u => (u || "").replace(/\/$/, "").split("#")[0].toLowerCase();

export function check(payload, keyword, pageType, validUrls, author = "", opts = {}) {
  const body = payload.body_markdown || "", checks = [], lang = opts.lang || detectLang(body);
  const add = (id, label, ok, detail = "", level = "fail") => checks.push({ id, label, status: ok ? "pass" : level, detail });
  // images in the page: each needs alt text (image search and accessibility)
  { const imgs = [...String(payload.body_markdown || "").matchAll(/!\[([^\]]*)\]\(([^)\s]+)/g)];
    if (imgs.length) { const noAlt = imgs.filter(m => !m[1].trim() || /^(image|img|photo|picture|screenshot)\s*\d*$/i.test(m[1].trim()));
      add("image_alt", "Images have alt text", !noAlt.length, noAlt.length ? `${noAlt.length} of ${imgs.length} image${imgs.length > 1 ? "s" : ""} without useful alt text: ${noAlt.slice(0, 3).map(m => m[2].split("/").pop()).join(", ")}` : "", "warn"); } }
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
    for (const sent of sentences(body.toLowerCase())) {
      if (sent.trim().startsWith("#")) continue;
      if (sent.split(phrase).length - 1 > SEO.max_phrase_per_sentence) { stuffing.push("phrase repeated in one sentence: " + sent.slice(0, 70)); break; }
    }
    const anchors = [...body.matchAll(/(?<!!)\[([^\]]+)\]\(https?:\/\//g)].map(x => x[1].toLowerCase().trim());
    if (anchors.length >= 3 && anchors.filter(a => a === phrase).length / anchors.length > SEO.max_exact_match_anchor_share) stuffing.push("too many exact-match anchors");
  }
  // Japanese/Chinese keywords have no spaces: count the exact keyword inside any 300-character window
  if (isCJK(keyword)) { const k = keyword.trim(), pos = []; let i = body.indexOf(k); while (i >= 0) { pos.push(i); i = body.indexOf(k, i + k.length); }
    const worstC = Math.max(0, ...pos.map(a => pos.filter(b => b >= a && b < a + 300).length)); if (worstC > 3) stuffing.push(`${worstC} uses of “${k}” within 300 characters`); }
  add("repetition", "No unnatural keyword repetition", !stuffing.length, stuffing.join("; ") || "natural");
  const low = body.toLowerCase(), fillers = [...FILLER_PHRASES, ...(FILLERS[lang] || [])].filter(f => low.includes(f.toLowerCase()));
  add("filler", "No filler / generic AI phrases", !fillers.length, fillers.join(", "), fillers.length <= 2 ? "warn" : "fail");
  const longP = body.split(/\n\n/).filter(p => !/^\s*(#|\||-|\*|1\.)/.test(p) && words(p).length > SEO.paragraph_max_words);
  add("paragraphs", "Short, readable paragraphs", !longP.length, `${longP.length} long paragraphs`, "warn");
  const stat = sentences(body).filter(s => /\d+(\.\d+)?\s?%|\b\d{2,}\b.*\b(percent|users|companies|study|survey|report)\b/i.test(s));
  const unsourced = stat.filter(s => !/\]\(https?:\/\/|\[SOURCE|\[ADD DATA|according to \[/i.test(s));
  add("stats_sourced", "Statistics have sources or placeholders", !unsourced.length, `${unsourced.length} unsourced: ` + unsourced.slice(0, 3).map(x => x.slice(0, 80)).join(" | "));
  const ph = body.match(PLACEHOLDER_RE) || [];
  add("proof", "First-hand proof marked for the author", ph.length >= 1, `${ph.length} placeholders to fill before publishing`, "warn");
  // repeated paragraphs: a common AI failure (same paragraph pasted into several sections)
  const normP = t => t.toLowerCase().replace(/[^a-z0-9\u00c0-\uffff ]+/g, " ").replace(/\s+/g, " ").trim();
  const seenP = new Map(); let dups = 0;
  for (const para of body.split(/\n\n/)) { const n = normP(para); if (countWords(para) < 12 || /^\s*[#|]/.test(para)) continue; seenP.set(n, (seenP.get(n) || 0) + 1); }
  for (const v of seenP.values()) if (v > 1) dups += v - 1;
  add("duplicates", "No repeated paragraphs", !dups, dups ? `${dups} paragraph${dups > 1 ? "s" : ""} repeated word for word` : "");
  const generic = h2.map(h => h.replace(/^## /, "").trim()).filter(h => /^(introduction|intro|conclusion|in conclusion|final thoughts|summary|overview|wrapping up|key takeaways|the bottom line|introducción|conclusión|conclusiones|resumen|introdução|conclusão|resumo|résumé|en conclusion|einleitung|fazit|zusammenfassung|introduzione|conclusione|riepilogo|inleiding|conclusie|samenvatting|はじめに|まとめ|おわりに|结论|总结|परिचय|निष्कर्ष)\s*[:：]?$/i.test(h));
  add("generic_headings", "Specific headings (no generic \"Introduction\"/\"Conclusion\")", !generic.length, generic.join(", "), "warn");
  const prose = body.split(/\n\n/).filter(x => !/^\s*(#|\||-|\*|\d+\.|>|!\[)/.test(x)).join(" ");
  const sents = sentences(prose).filter(x => words(x).length >= 3), avg = sents.length ? words(prose).length / sents.length : 0, lim = readabilityLimit(lang);
  add("readability", "Easy-to-read sentences", avg <= lim, `${avg.toFixed(1)} ${isCJK(prose) ? "word-equivalents (about 2 characters each)" : "words"} per sentence on average (aim for under ${lim - 2})`, "warn");
  const phN = (body.match(PLACEHOLDER_RE) || []).length;
  add("placeholder_load", "Not too many gaps to fill", phN <= 12, `${phN} placeholders${phN > 12 ? ": add more notes and proof when writing, so the AI can fill more itself" : ""}`, "warn");
  if (Array.isArray(opts.outline) && opts.outline.length) {
    const tok = t => new Set(normP(t).split(" ").filter(w => w.length > 3));
    const have = h2.map(h => tok(h)), missing = opts.outline.filter(o => { const t = tok(o); return t.size && !have.some(h => [...t].filter(w => h.has(w)).length / t.size >= 0.5); });
    add("outline", "Covers the planned sections", missing.length <= Math.floor(opts.outline.length / 3), missing.length ? `Missing: ${missing.slice(0, 4).join("; ")}` : "all planned sections present", "warn");
  }
  // checks for specific page types
  const hasTable = /^\s*\|.+\|\s*$/m.test(body);
  if (pageType === "product_page") {
    add("specs_table", "Specifications in a table", hasTable, hasTable ? "" : "add a table of key specifications", "warn");
    const ratings = sentences(body).filter(x => /(\b\d(\.\d)?\s*(\/\s*5|out of 5|stars?|estrellas|étoiles|sterne)\b|\brated\s+\d)/i.test(x) && !/\[(ADD|SOURCE|REVIEW)/i.test(x));
    add("no_fake_ratings", "No ratings unless they come from real reviews", !ratings.length, ratings.length ? `remove or source: ${ratings[0].slice(0, 80)}` : "");
  }
  if (pageType === "category_page") {
    const intro = body.split(/^## /m)[0].replace(/^# .*$/m, ""), iw = countWords(intro);
    add("category_intro", "Short, helpful intro (50-150 words) above the products", iw >= 40 && iw <= 200, `${iw} words before the first section`, "warn");
  }
  if (pageType === "review") {
    const tested = /^#{2,3}\s+.*(how (we|i) tested|testing method|our testing|cómo (lo )?(probamos|hemos probado)|como testamos|comment nous avons test|so haben wir getestet|wie wir getestet|come abbiamo testato|テスト方法|検証方法|試した方法)/im.test(body);
    add("how_tested", "Explains how the product was tested", tested, tested ? "" : "add a “How we tested” section with first-hand details");
    const evidence = /\[(ADD (PHOTO|SCREENSHOT|DATA|MEASUREMENT)|ADD EXAMPLE)[^\]]*\]|!\[/i.test(body);
    add("test_evidence", "First-hand evidence (photos, measurements)", evidence, evidence ? "" : "add your own photos or measurements", "warn");
  }
  if (pageType === "news_article") {
    const src = /\]\(https?:\/\/|\[SOURCE/i.test(body);
    add("news_sources", "Sources cited", src, src ? "" : "link to the original sources or announcements", "warn");
  }
  if (pageType === "location_page" && Array.isArray(opts.localTerms) && opts.localTerms.length) {
    const lowB = body.toLowerCase(), found = opts.localTerms.filter(t => lowB.includes(t.toLowerCase()));
    add("local_details", "Uses the real local details you provided", found.length >= Math.min(2, opts.localTerms.length), `${found.length} of ${opts.localTerms.length} local details used`);
  }
  add("author", "Named author", !!author.trim(), author.trim() ? author : "Add the author's name and role");
  const fails = checks.filter(c => c.status === "fail").length, warns = checks.filter(c => c.status === "warn").length;
  return { checks, fails, warns, seo_score: Math.round(100 * (checks.length - fails - 0.5 * warns) / checks.length), word_count: wc,
    placeholders: ph.length, fix_list: checks.filter(c => c.status === "fail" && c.id !== "author").map(c => `${c.label}: ${c.detail}`) };
}
