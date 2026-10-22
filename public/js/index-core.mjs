// index-core.mjs - "Is this page in Google?" logic shared by the browser and the weekly Netlify check (no browser APIs):
// Google's index statuses in plain words with a fix, per-page history, and changes since the last check.
const norm = u => { try { const x = new URL(u); x.hash = ""; return x.toString().replace(/\/$/, ""); } catch { return String(u || "").replace(/\/$/, ""); } };
// Google's coverage states -> what it means and what to do. "ok" pages are fine; "intended" are fine if you meant it
const STATES = [
  [/submitted and indexed/i, "ok", "In Google.", ""],
  [/indexed, not submitted in sitemap/i, "ok", "In Google, but not listed in your sitemap.", "Add it to your XML sitemap so Google rechecks it reliably."],
  [/indexed, though blocked by robots/i, "problem", "In Google, but robots.txt blocks Google from reading it, so Google can't see its content.", "Remove the robots.txt rule that blocks this page."],
  [/crawled.*currently not indexed/i, "problem", "Google read this page but decided not to index it. This usually means it looks thin, unhelpful or too similar to another page.", "Make the page clearly more useful and different from your other pages, link to it from related pages, then request indexing in Search Console."],
  [/discovered.*currently not indexed/i, "problem", "Google knows this page exists but hasn't read it yet, often because few pages link to it or the site is slow to crawl.", "Link to it from important pages, make sure it's in your sitemap, and check server speed."],
  [/google chose different canonical/i, "problem", "Google treats another page as the main version and ignores this one.", "If this page should rank, make it clearly different or point the other page to it; otherwise set its canonical to the page Google chose."],
  [/duplicate without user-selected canonical/i, "problem", "Google sees this as a duplicate and you haven't said which version is the main one.", "Add a canonical tag pointing to the version that should rank, or merge the pages."],
  [/alternate page with proper canonical/i, "intended", "Not indexed on purpose: it points Google to another page as the main version.", "Nothing to do if that's intended."],
  [/excluded by .?noindex/i, "intended", "Hidden from Google by a noindex tag.", "If this page should appear in Google, remove the noindex tag."],
  [/blocked by robots\.txt/i, "problem", "Google isn't allowed to read this page because of your robots.txt file.", "Remove the robots.txt rule if the page should rank."],
  [/page with redirect/i, "intended", "This address redirects elsewhere, so Google indexes the destination instead.", "Update links and your sitemap to point straight to the final address."],
  [/soft 404/i, "problem", "Google thinks this page is empty or an error page, even though it loads.", "Add real content, or return a proper 404 or redirect if it's gone."],
  [/not found \(404\)/i, "problem", "Google found this address but it returns 404 (not found).", "Restore the page or redirect it to the closest relevant page."],
  [/server error/i, "problem", "Google got a server error when it tried to read this page.", "Ask your developer or host to check server errors for this page."],
  [/unauthorized|access denied|forbidden/i, "problem", "Google was refused access to this page (it needs a login or is blocked).", "Make public pages reachable without a login."],
  [/unknown to google/i, "problem", "Google doesn't know this page exists yet.", "Link to it from your important pages, add it to your sitemap, and request indexing in Search Console."],
];
export function explain(r) {
  const idx = r.indexStatusResult || {}, cov = idx.coverageState || "";
  const hit = STATES.find(([re]) => re.test(cov));
  const [_, kind, meaning, fix] = hit || [null, idx.verdict === "PASS" ? "ok" : "problem", cov ? `Google says: “${cov}”.` : "Google didn't return a status for this page.", "Open the full report in Search Console for details."];
  const gc = idx.googleCanonical || "", uc = idx.userCanonical || "";
  const mismatch = !!(gc && uc && norm(gc) !== norm(uc));
  const rich = ((r.richResultsResult || {}).detectedItems || []).map(d => ({ type: d.richResultType, issues: (d.items || []).flatMap(i => (i.issues || []).map(x => ({ message: x.issueMessage, severity: x.severity }))) }));
  return { status: kind, coverage: cov || "Unknown", meaning, fix, verdict: idx.verdict || "", last_crawl: idx.lastCrawlTime || "", crawled_as: idx.crawledAs || "",
    robots: idx.robotsTxtState || "", indexing: idx.indexingState || "", fetch: idx.pageFetchState || "", google_canonical: gc, user_canonical: uc, canonical_mismatch: mismatch,
    in_sitemap: (idx.sitemap || []).length > 0, rich, link: r.inspectionResultLink || "" };
}

// results kept per page with a short history; a change of status is recorded with its date
export function merge(prevResults, fresh) {
  const by = new Map((prevResults || []).map(r => [r.url, r])), changes = [];
  for (const r of fresh) {
    const old = by.get(r.url), hist = [...(old?.history || (old ? [{ at: old.at, status: old.status, coverage: old.coverage }] : [])), { at: r.at, status: r.status, coverage: r.coverage }].slice(-10);
    if (old && old.status !== r.status && !(old.status === "intended" && r.status === "intended")) {
      const kind = r.status === "problem" && old.status === "ok" ? "dropped" : r.status === "ok" && old.status === "problem" ? "fixed" : "changed";
      changes.push({ url: r.url, at: r.at, kind, from: old.coverage, to: r.coverage });
    }
    by.set(r.url, { ...r, history: hist, changed_at: old && old.status !== r.status ? r.at : (old?.changed_at || null) });
  }
  return { results: [...by.values()].slice(0, 300), changes };
}
// which of these pages are due for a check (not inspected in the last `days` days), most important first:
// earlier problems (to see whether they're fixed), then new or changed pages, then pages losing traffic, then the rest in the given order
export function due(prevResults, urls, { days = 3, force = false, changed = [], declining = [] } = {}) {
  const by = new Map((prevResults || []).map(r => [r.url, r])), fresh = u => !force && by.get(u) && Date.now() - by.get(u).at < days * 864e5;
  const rank = u => by.get(u)?.status === "problem" ? 0 : changed.includes(u) ? 1 : declining.includes(u) ? 2 : by.has(u) ? 4 : 3;
  const all = [...new Set([...urls, ...changed, ...declining, ...[...by.values()].filter(r => r.status === "problem").map(r => r.url)])];
  const todo = all.filter(u => !fresh(u)).sort((a, b) => rank(a) - rank(b));
  return { todo, skipped: all.length - todo.length };
}
