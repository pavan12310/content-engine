// schema.js - structured data checker (JSON-LD), based on Google's published rich result requirements.
// Errors = required fields missing or invalid (the rich result can't show). Warnings = recommended fields missing or weak formats.
// Google's own Rich Results Test has no API; this follows the same documented rules for the common types.

const DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const URLRE = /^https?:\/\/\S+$/i;
const asArr = v => v == null ? [] : Array.isArray(v) ? v : [v];
const typesOf = o => asArr(o && o["@type"]).map(t => String(t).replace(/^https?:\/\/schema\.org\//, ""));
const has = (o, k) => o && o[k] != null && !(typeof o[k] === "string" && !o[k].trim()) && !(Array.isArray(o[k]) && !o[k].length);
const urlOf = v => typeof v === "string" ? v : v && (v.url || v["@id"] || v.contentUrl) || "";
const nameOf = v => typeof v === "string" ? v : v && v.name;

// every JSON-LD object on a page, with @graph and arrays expanded; invalid JSON is reported
export function extractJsonLd(html) {
  const items = [], errors = [];
  for (const m of String(html || "").matchAll(/<script[^>]+type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    let raw = m[1].trim().replace(/^<!--|-->$/g, "").replace(/^\s*\/\/<!\[CDATA\[|\/\/\]\]>\s*$/g, "");
    let data; try { data = JSON.parse(raw); } catch (e) { errors.push(`Invalid JSON-LD (it can't be read at all): ${String(e.message).slice(0, 80)}`); continue; }
    const walk = d => { for (const x of asArr(d)) { if (!x || typeof x !== "object") continue; if (x["@graph"]) walk(x["@graph"]); if (x["@type"]) items.push(x); } };
    walk(data);
  }
  // main entities nested in a WebPage count too
  for (const o of [...items]) { if (typesOf(o).some(t => /^(FAQPage|QAPage)$/.test(t))) continue;   // an FAQ's questions are part of the FAQ
    for (const e of asArr(o.mainEntity)) if (e && typeof e === "object" && typesOf(e).some(t => RULES[t]) && !items.includes(e)) items.push(e); }
  const microdata = (String(html).match(/\sitemtype\s*=\s*["']https?:\/\/schema\.org\//gi) || []).length, rdfa = (String(html).match(/\stypeof\s*=\s*["'][^"']+["']/gi) || []).length;
  return { items, errors, microdata, rdfa };
}

// rules per type: the rich result name, required and recommended fields, and extra checks
const ARTICLE = { result: "Article", required: [], recommended: ["headline", "image", "datePublished", "dateModified", "author"],
  check(o, E, W) {
    if (has(o, "headline") && String(o.headline).length > 110) W.push("headline is longer than 110 characters");
    for (const a of asArr(o.author)) if (a && typeof a === "object" && !has(a, "name")) W.push("author has no name");
    else if (typeof a === "string") W.push("author should be a Person or Organization with a name (not plain text)");
  } };
const OFFER = (offers, E, W, required) => {
  const list = asArr(offers); if (!list.length) return;
  for (const of of list) {
    if (!of || typeof of !== "object") continue;
    const price = of.price ?? of.priceSpecification?.price ?? of.lowPrice;
    if (price == null) (required ? E : W).push("offers has no price");
    else if (!/^\d+(\.\d+)?$/.test(String(price).trim())) E.push(`offers price “${price}” must be a plain number (no currency symbol or commas)`);
    const cur = of.priceCurrency ?? of.priceSpecification?.priceCurrency;
    if (!cur) (required ? E : W).push("offers has no priceCurrency"); else if (!/^[A-Z]{3}$/.test(String(cur))) E.push(`priceCurrency “${cur}” must be a 3-letter code like USD or EUR`);
    if (of.availability && !/schema\.org\/\w+$/.test(String(of.availability))) W.push("availability should be a schema.org value like https://schema.org/InStock");
  }
};
const RATING = (r, E, W, label) => {
  if (!r || typeof r !== "object") return;
  if (!has(r, "ratingValue")) E.push(`${label} has no ratingValue`);
  const best = Number(r.bestRating ?? 5), worst = Number(r.worstRating ?? 1), v = Number(r.ratingValue);
  if (has(r, "ratingValue") && (Number.isNaN(v) || v < worst || v > best)) E.push(`${label} ratingValue ${r.ratingValue} is outside ${worst}-${best}`);
};
export const RULES = {
  Article: ARTICLE, NewsArticle: { ...ARTICLE, result: "Article (news)" }, BlogPosting: { ...ARTICLE, result: "Article" },
  Product: { result: "Product snippet", required: ["name"], recommended: ["image", "description", "brand", "sku", "offers"],
    check(o, E, W) {
      if (!has(o, "offers") && !has(o, "review") && !has(o, "aggregateRating")) E.push("needs offers, review or aggregateRating (at least one) to show as a product result");
      OFFER(o.offers, E, W, false);
      if (has(o, "aggregateRating")) { RATING(o.aggregateRating, E, W, "aggregateRating"); if (!has(o.aggregateRating, "reviewCount") && !has(o.aggregateRating, "ratingCount")) E.push("aggregateRating needs reviewCount or ratingCount"); }
    } },
  Review: { result: "Review snippet", required: ["itemReviewed", "author", "reviewRating"], recommended: ["datePublished"],
    check(o, E, W) { RATING(o.reviewRating, E, W, "reviewRating"); for (const a of asArr(o.author)) if (!nameOf(a)) E.push("author has no name"); } },
  FAQPage: { result: "FAQ", required: ["mainEntity"], recommended: [],
    note: "Google shows FAQ rich results only for well-known government and health websites. The markup is harmless, but don't expect FAQ results.",
    check(o, E) { for (const [i, q] of asArr(o.mainEntity).entries()) { if (!has(q, "name")) E.push(`question ${i + 1} has no name (the question text)`); if (!has(q?.acceptedAnswer, "text")) E.push(`question ${i + 1} has no acceptedAnswer text`); } } },
  HowTo: { result: "How-to", required: ["name", "step"], recommended: ["image", "totalTime", "supply", "tool"],
    note: "Google retired how-to rich results in 2023, so this markup no longer produces a rich result." },
  Organization: { result: "Organization (logo, knowledge panel)", required: [], recommended: ["name", "url", "logo", "sameAs"],
    check(o, E, W) { if (has(o, "logo") && !URLRE.test(urlOf(o.logo))) E.push("logo must be an absolute image address"); if (has(o, "url") && !URLRE.test(urlOf(o.url))) E.push("url must be an absolute address"); } },
  LocalBusiness: { result: "Local business", required: ["name", "address"], recommended: ["telephone", "url", "openingHoursSpecification", "geo", "priceRange", "image"],
    check(o, E, W) { const a = o.address; if (a && typeof a === "object") { for (const k of ["streetAddress", "addressLocality", "postalCode", "addressCountry"]) if (!has(a, k)) W.push(`address has no ${k}`); } else if (typeof a === "string") W.push("address should be a PostalAddress with street, town, postcode and country"); } },
  BreadcrumbList: { result: "Breadcrumb", required: ["itemListElement"], recommended: [],
    check(o, E) { const L = asArr(o.itemListElement); L.forEach((li, i) => { if (!has(li, "position")) E.push(`breadcrumb item ${i + 1} has no position`); if (!has(li, "name") && !nameOf(li?.item)) E.push(`breadcrumb item ${i + 1} has no name`); if (i < L.length - 1 && !urlOf(li?.item)) E.push(`breadcrumb item ${i + 1} has no item address`); }); } },
  VideoObject: { result: "Video", required: ["name", "thumbnailUrl", "uploadDate"], recommended: ["description", "duration", "contentUrl", "embedUrl"],
    check(o, E, W) { if (has(o, "duration") && !/^P(T?(\d+H)?(\d+M)?(\d+(\.\d+)?S)?)$/.test(String(o.duration))) E.push(`duration “${o.duration}” must be ISO 8601, like PT1M30S`); if (!has(o, "contentUrl") && !has(o, "embedUrl")) W.push("add contentUrl or embedUrl so Google can fetch the video"); } },
  Event: { result: "Event", required: ["name", "startDate", "location"], recommended: ["endDate", "eventStatus", "image", "offers", "organizer", "description"],
    check(o, E, W) { OFFER(o.offers, E, W, false); } },
  Recipe: { result: "Recipe", required: ["name", "image"], recommended: ["author", "datePublished", "description", "recipeIngredient", "recipeInstructions", "totalTime", "aggregateRating"] },
  SoftwareApplication: { result: "Software app", required: ["name", "offers"], recommended: ["applicationCategory", "operatingSystem", "aggregateRating"],
    check(o, E, W) { OFFER(o.offers, E, W, true); if (!has(o, "aggregateRating") && !has(o, "review")) E.push("needs aggregateRating or review to show as a software result"); else if (has(o, "aggregateRating")) RATING(o.aggregateRating, E, W, "aggregateRating"); } },
  JobPosting: { result: "Job posting", required: ["title", "description", "datePosted", "hiringOrganization"], recommended: ["validThrough", "employmentType", "baseSalary", "identifier"],
    check(o, E) { if (!has(o, "jobLocation") && !(o.jobLocationType === "TELECOMMUTE" && has(o, "applicantLocationRequirements"))) E.push("needs jobLocation (or jobLocationType TELECOMMUTE with applicantLocationRequirements)"); } },
};
RULES.WebApplication = RULES.MobileApplication = { ...RULES.SoftwareApplication };
for (const t of ["Restaurant", "Store", "MedicalBusiness", "ProfessionalService", "Dentist", "LegalService", "AutoRepair", "HomeAndConstructionBusiness"]) RULES[t] = RULES.LocalBusiness;
const DATE_FIELDS = ["datePublished", "dateModified", "uploadDate", "startDate", "endDate", "datePosted", "validThrough"];
const URL_FIELDS = ["url", "image", "thumbnailUrl", "contentUrl", "embedUrl"];

// check one object: returns errors, warnings, the rich result it's for, and whether it qualifies
export function validate(o) {
  const types = typesOf(o), t = types.find(x => RULES[x]);
  if (!t) return { type: types.join(", ") || "unknown", known: false, errors: [], warnings: [], result: "", eligible: false };
  const R = RULES[t], E = [], W = [];
  for (const k of R.required) if (!has(o, k)) E.push(`missing required field “${k}”`);
  for (const k of R.recommended) if (!has(o, k)) W.push(`missing recommended field “${k}”`);
  for (const k of DATE_FIELDS) if (has(o, k) && !DATE.test(String(o[k]).trim())) E.push(`${k} “${String(o[k]).slice(0, 30)}” isn't a valid ISO 8601 date (like 2026-10-19 or 2026-10-19T09:00:00+05:30)`);
  for (const k of URL_FIELDS) for (const v of asArr(o[k])) { const u = urlOf(v); if (u && !URLRE.test(u)) E.push(`${k} “${String(u).slice(0, 40)}” must be an absolute address starting with https://`); }
  if (R.check) R.check(o, E, W);
  return { type: t, known: true, errors: [...new Set(E)], warnings: [...new Set(W)], result: R.result, eligible: !E.length && !R.note, note: R.note || "" };
}
export function checkHtml(html) {
  const x = extractJsonLd(html);
  // objects with errors are kept (up to 20 KB each) so a corrected version can be offered
  return { items: x.items.map(o => { const v = validate(o), raw = v.errors.length ? JSON.stringify(o) : ""; return raw && raw.length <= 20000 ? { ...v, raw } : v; }), parse_errors: x.errors, microdata: x.microdata, rdfa: x.rdfa, fp: fingerprint(html) };
}

// ---- fingerprints and ready-to-paste fixes ----
const fnv = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36); };
export const fingerprint = html => fnv([...String(html || "").matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1].replace(/\s+/g, " ").trim()).join("|"));
const SYMBOL = { "$": "USD", "US$": "USD", "€": "EUR", "£": "GBP", "₹": "INR", "¥": "JPY", "A$": "AUD", "C$": "CAD" };
// a corrected copy of one JSON-LD object, with what was changed and what still needs real information
export function fixObject(obj, pageUrl) {
  const o = JSON.parse(JSON.stringify(obj)), changes = [], needs = [];
  const abs = u => { try { return new URL(u, pageUrl).toString(); } catch { return u; } };
  const isoDate = v => { const s = String(v).trim(); let m;
    if ((m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/))) { const a = +m[1], b = +m[2]; if (a > 12) return `${m[3]}-${String(b).padStart(2, "0")}-${String(a).padStart(2, "0")}`; if (b > 12) return `${m[3]}-${String(a).padStart(2, "0")}-${String(b).padStart(2, "0")}`; return null; }
    if ((m = s.match(/^(\d{4})[\/.](\d{1,2})[\/.](\d{1,2})$/))) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    const d = Date.parse(s); return Number.isNaN(d) ? null : new Date(d).toISOString().slice(0, 10); };
  const walk = (x, path) => {
    if (Array.isArray(x)) { x.forEach((v, i) => walk(v, `${path}[${i}]`)); return; }
    if (!x || typeof x !== "object") return;
    for (const k of Object.keys(x)) {
      const v = x[k], here = path ? `${path}.${k}` : k;
      if (typeof v === "string" && /\{\{[^}]*\}\}|\[\[[^\]]*\]\]|%%[^%]+%%/.test(v)) { delete x[k]; changes.push(`removed ${here}: it was an unfilled template placeholder (“${v}”). Fix the template so it outputs the real value.`); continue; }
      if (["datePublished", "dateModified", "uploadDate", "startDate", "endDate", "datePosted", "validThrough"].includes(k) && typeof v === "string" && !DATE.test(v.trim())) {
        const f = isoDate(v); if (f) { x[k] = f; changes.push(`${here}: “${v}” → “${f}”`); } else needs.push(`${here}: “${v}” isn't a clear date (day and month could be either way); write it as YYYY-MM-DD.`); }
      if (["url", "image", "thumbnailUrl", "contentUrl", "embedUrl", "logo", "item"].includes(k) && typeof v === "string" && v && !URLRE.test(v)) { x[k] = abs(v); changes.push(`${here}: “${v}” → “${x[k]}”`); }
      if (k === "price" || k === "lowPrice" || k === "highPrice") { const s = String(v).trim(), sym = Object.keys(SYMBOL).find(c => s.startsWith(c)), n = s.replace(/[^\d.,]/g, "").replace(/,(?=\d{3}\b)/g, "").replace(",", ".");
        if (!/^\d+(\.\d+)?$/.test(s) && /^\d+(\.\d+)?$/.test(n)) { x[k] = n; changes.push(`${here}: “${v}” → “${n}”`); if (sym && !x.priceCurrency) { x.priceCurrency = SYMBOL[sym]; changes.push(`${path ? path + "." : ""}priceCurrency added: ${SYMBOL[sym]} (from the “${sym}” sign)`); } } }
      if (k === "priceCurrency" && typeof v === "string" && /^[a-z]{3}$/.test(v.trim())) { x[k] = v.trim().toUpperCase(); changes.push(`${here}: “${v}” → “${x[k]}”`); }
      if (k === "duration" && typeof v === "string") { const m = v.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/); if (m) { const h = +(m[1] || 0), mi = +m[2], se = +m[3], f = `PT${h ? h + "H" : ""}${mi ? mi + "M" : ""}${se ? se + "S" : ""}`; x[k] = f; changes.push(`${here}: “${v}” → “${f}”`); } }
      walk(x[k], here);
    }
    if (typesOf(x).includes("BreadcrumbList")) asArr(x.itemListElement).forEach((li, i) => { if (li && typeof li === "object" && li.position == null) { li.position = i + 1; changes.push(`breadcrumb item ${i + 1}: added position ${i + 1}`); } });
  };
  walk(o, "");
  const v = validate(o); for (const e of v.errors) needs.push(e);
  return { fixed: o, changes, needs: [...new Set(needs)] };
}
