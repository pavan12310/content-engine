// api.js - answers the same /api/... requests the interface makes, but locally in the browser.
import * as S from "./services.js";
import * as techaudit from "./techaudit.js";
import * as kwio from "./kwio.js";
import { rulesSummary, URL_ACTIONS } from "./rules.js";
import { getSettings, availableProviders } from "./llm.js";

const routes = [];
const on = (method, pattern, fn) => routes.push({ method, re: new RegExp("^" + pattern.replace(/:(\w+)/g, "(?<$1>[^/?]+)") + "(?:\\?(?<qs>.*))?$"), fn });
const num = x => Number(x);
export function download(name, text, type = "text/plain") {
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
async function findContent(cid) { for (const s of await S.sites()) { const c = (await S.contents(s.id)).find(x => x.id === cid); if (c) return [s, c]; } throw new S.GuardrailError("Not found"); }

on("GET", "/api/rules", () => rulesSummary());
on("GET", "/api/sites", async () => Promise.all((await S.sites()).map(async s => ({ ...s, page_count: (await S.pages(s.id)).length }))));
on("POST", "/api/sites", (p, b) => S.addSite(b));
on("DELETE", "/api/sites/:id", async p => { await S.deleteSite(num(p.id)); return { ok: true }; });
on("POST", "/api/sites/:id/recrawl", async p => { const s = await S.site(num(p.id)); S.runCrawl(num(p.id), s?.max_pages || 200); return { ok: true }; });
on("GET", "/api/sites/:id", p => S.siteDetail(num(p.id)));
on("GET", "/api/sites/:id/pages", p => S.pages(num(p.id)));
on("POST", "/api/sites/:id/strategy", p => S.strategy(num(p.id)));
on("POST", "/api/sites/:id/strategy-v2", (p, b, o) => S.contentStrategy(num(p.id), b, o.onProgress));
on("GET", "/api/sites/:id/strategy-v2", p => S.savedStrategy(num(p.id)));
on("GET", "/api/sites/:id/plan", p => S.planView(num(p.id)));
on("POST", "/api/sites/:id/plan", (p, b) => S.addToPlan(num(p.id), b.items || []));
on("PATCH", "/api/sites/:id/plan/:pid", (p, b) => S.updatePlanItem(num(p.id), num(p.pid), b));
on("DELETE", "/api/sites/:id/plan/:pid", p => S.removePlanItem(num(p.id), num(p.pid)));
on("GET", "/api/sites/:id/plan/export.csv", async p => { download("content-plan.csv", await S.planCsv(num(p.id)), "text/csv"); return { ok: true }; });
on("POST", "/api/sites/:id/keyword-check", (p, b, o) => S.keywordCheck(num(p.id), b.keyword || "", { research: b.research !== false }, o.onProgress));
on("GET", "/api/sites/:id/keyword-check/recent", p => S.recentChecks(num(p.id)));
on("GET", "/api/sites/:id/keyword-check/saved", (p, b, o, q) => S.savedCheck(num(p.id), q.get("keyword") || ""));
on("POST", "/api/sites/:id/keyword-check/update-plan", (p, b) => S.makeUpdatePlan(num(p.id), b.keyword || "", b.url || ""));
on("POST", "/api/sites/:id/generate", (p, b, o) => S.generate(num(p.id), b, o.onProgress));
on("POST", "/api/sites/:id/audit", (p, b) => S.audit(num(p.id), b));
on("POST", "/api/sites/:id/review", (p, b, o) => S.reviewDraft(num(p.id), b, o.onProgress));
on("GET", "/api/sites/:id/reviews", p => S.reviews(num(p.id)));
on("GET", "/api/sites/:id/reviews/:rid", p => S.getReview(num(p.id), num(p.rid)));
on("POST", "/api/sites/:id/reviews/:rid/import", p => S.importReview(num(p.id), num(p.rid)));
on("POST", "/api/sites/:id/review/load-url", (p, b) => S.loadUrlDraft(num(p.id), b.url || ""));
on("GET", "/api/sites/:id/contents", async p => (await S.contents(num(p.id))).map(({ payload, ...c }) => c));
on("GET", "/api/contents/:cid", async p => (await findContent(num(p.cid)))[1]);
on("GET", "/api/contents/:cid/export.md", async p => {
  const [, c] = await findContent(num(p.cid)), x = c.payload;
  const md = `---\ntitle: "${(x.title_tag || "").replace(/"/g, "'")}"\ndescription: "${(x.meta_description || "").replace(/"/g, "'")}"\nslug: ${x.slug || ""}\n---\n\n${x.body_markdown || ""}\n\n<script type="application/ld+json">\n${JSON.stringify(x.schema_jsonld || {}, null, 2)}\n</script>\n`;
  download(`${x.slug || "page"}.md`, md, "text/markdown"); return { ok: true };
});
on("GET", "/api/contents/:cid/export.html", async p => { const [, c] = await findContent(num(p.cid)); download(`${c.payload.slug || "page"}.html`, S.fullHtml(c), "text/html"); return { ok: true }; });
on("GET", "/api/sites/:id/style", p => S.getStyle(num(p.id)));
on("POST", "/api/sites/:id/style", (p, b) => S.setStyle(num(p.id), b || {}));
on("GET", "/api/authors", () => S.authors());
on("GET", "/api/sites/:id/coverage", (p, b, o, q) => S.coverageFor(num(p.id), q.get("keyword") || ""));
on("POST", "/api/sites/:id/contents/:cid/save", (p, b) => S.saveDraft(num(p.id), num(p.cid), b));
on("POST", "/api/sites/:id/contents/:cid/restore", (p, b) => S.restoreVersion(num(p.id), num(p.cid), Number(b.v)));
on("POST", "/api/sites/:id/contents/:cid/rewrite-section", (p, b) => S.rewriteSection(num(p.id), num(p.cid), b.heading || "", b.instruction || ""));
on("POST", "/api/sites/:id/contents/:cid/review", p => S.reReview(num(p.id), num(p.cid)));
on("POST", "/api/sites/:id/contents/:cid/approve", (p, b) => S.approve(num(p.id), num(p.cid), b));
on("GET", "/api/sites/:id/url-map", p => S.urlMap(num(p.id)));
on("POST", "/api/sites/:id/url-map/review", p => S.reviewUrlMap(num(p.id)));
on("GET", "/api/sites/:id/technical-audit", p => S.siteHealth(num(p.id)));
on("POST", "/api/sites/:id/technical-audit/ignore", (p, b) => S.ignoreIssue(num(p.id), b));
on("POST", "/api/sites/:id/technical-audit/unignore", (p, b) => S.unignoreIssue(num(p.id), b));
on("POST", "/api/sites/:id/technical-audit/page-fixes", (p, b) => S.pageFixes(num(p.id), b.url || ""));
on("GET", "/api/sites/:id/technical-audit/export.csv", async p => { download("site-health-issues.csv", await S.healthCsv(num(p.id)), "text/csv"); return { ok: true }; });
on("GET", "/api/sites/:id/page", async (p, b, o, q) => (await S.pages(num(p.id))).find(x => x.url === q.get("url")) || null);
on("GET", "/api/sites/:id/keywords", p => S.keywordTable(num(p.id)));
on("PATCH", "/api/sites/:id/keywords", async (p, b) => {
  if (b.action && !(b.action in URL_ACTIONS) && b.action !== "review") throw new S.GuardrailError(`Action must be one of: ${Object.keys(URL_ACTIONS).join(", ")}`);
  const { keyword, ...f } = b; await S.upsertKeyword(num(p.id), keyword, f); return { ok: true };
});
on("DELETE", "/api/sites/:id/keywords", async (p, b, o, q) => { await S.deleteKeyword(num(p.id), q.get("keyword") || ""); return { ok: true }; });
on("POST", "/api/sites/:id/keywords/add", (p, b) => S.addKeywords(num(p.id), b.keywords || [], b.source || "added"));
on("POST", "/api/sites/:id/keywords/bulk", (p, b) => {
  if (b.op !== "delete" && b.fields?.action && !(b.fields.action in URL_ACTIONS) && b.fields.action !== "review") throw new S.GuardrailError("Invalid action");
  return S.bulkKeywords(num(p.id), b.keywords || [], b.op, b.fields || {});
});
on("POST", "/api/sites/:id/keywords/ideas", (p, b) => S.keywordIdeas(num(p.id), b));
on("GET", "/api/sites/:id/keywords/clusters", p => S.keywordClusters(num(p.id)));
on("POST", "/api/sites/:id/keywords/import", async (p, b, o) => {
  const items = await kwio.parseFile(o.file); if (!items.length) throw new S.GuardrailError("No keywords found. The file needs a column named keyword (or query).");
  for (const it of items.slice(0, 5000)) { const { keyword, ...f } = it; await S.upsertKeyword(num(p.id), keyword, f, "import"); }
  return { imported: Math.min(items.length, 5000) };
});
on("GET", "/api/sites/:id/keywords/export.csv", async p => { download("keyword-url-map.csv", kwio.toCsv(await S.keywordTable(num(p.id))), "text/csv"); return { ok: true }; });
on("POST", "/api/sites/:id/gsc/import", (p, b, o) => S.gscImport(num(p.id), o.file, b.label || ""));
on("GET", "/api/sites/:id/gsc/trend", p => S.gscTrend(num(p.id)));
on("GET", "/api/sites/:id/brand-terms", p => S.brandTerms(num(p.id)));
on("POST", "/api/sites/:id/brand-terms", (p, b) => S.setBrandTerms(num(p.id), b.terms || []));
on("POST", "/api/sites/:id/gsc/snippet-fix", (p, b) => S.snippetFix(num(p.id), b));
on("GET", "/api/sites/:id/gsc", p => S.gscOverview(num(p.id)));
on("DELETE", "/api/sites/:id/gsc/:iid", async p => { const id = num(p.id); const { set } = await import("./store.js"); await set(`gsc:${id}`, (await S.gscImports(id)).filter(i => i.id !== num(p.iid))); return { ok: true }; });
on("POST", "/api/sites/:id/gsc/to-keywords", async (p, b) => { for (const q of (b.queries || []).slice(0, 500)) await S.upsertKeyword(num(p.id), q, {}, "Google search"); return { added: Math.min((b.queries || []).length, 500) }; });
on("GET", "/api/sites/:id/visibility", async p => ({ ...(await S.visOverview(num(p.id))), providers: availableProviders() }));
on("POST", "/api/sites/:id/visibility", async (p, b) => { for (const r of b) if (!S.ENGINES.includes(r.engine)) throw new S.GuardrailError("Unknown assistant"); await S.addVis(num(p.id), b); return { added: b.length }; });
on("POST", "/api/sites/:id/visibility/questions", (p, b) => S.addQuestions(num(p.id), b.questions || [], b.topic || ""));
on("DELETE", "/api/sites/:id/visibility/questions/:qid", p => S.removeQuestion(num(p.id), num(p.qid)));
on("POST", "/api/sites/:id/visibility/run", (p, b, o) => S.runChecks(num(p.id), b, o.onProgress));
on("POST", "/api/sites/:id/visibility/questions/:qid/why", p => S.whyNotUs(num(p.id), num(p.qid)));
on("POST", "/api/sites/:id/visibility/ideas", (p, b) => S.questionIdeas(num(p.id), b));
on("POST", "/api/sites/:id/visibility/competitors", (p, b) => S.setCompetitors(num(p.id), b.names || []));
on("POST", "/api/sites/:id/visibility/auto", async (p, b) => {
  const prompts = (b.prompts || []).map(x => x.trim()).filter(Boolean); if (!prompts.length) throw new S.GuardrailError("Add at least one question.");
  return { results: await S.autoVis(num(p.id), prompts) };
});
on("DELETE", "/api/sites/:id/visibility/:vid", async p => { const id = num(p.id); const { set } = await import("./store.js"); await set(`vis:${id}`, (await S.visRows(id)).filter(r => r.id !== num(p.vid))); return { ok: true }; });
on("POST", "/api/sites/:id/actions/generate", p => S.buildActions(num(p.id)));
on("GET", "/api/sites/:id/actions", p => S.recs(num(p.id)));
on("PATCH", "/api/sites/:id/actions/:rid", (p, b) => S.updateRec(num(p.id), num(p.rid), b));
on("GET", "/api/sites/:id/actions/export.csv", async p => { download("seo-todo-list.csv", await S.actionsCsv(num(p.id)), "text/csv"); return { ok: true }; });

export async function api(path, opts = {}) {
  const method = (opts.method || "GET").toUpperCase(), body = typeof opts.body === "string" ? JSON.parse(opts.body) : (opts.body || {});
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = path.match(r.re); if (!m) continue;
    try { return await r.fn(m.groups || {}, body, opts, new URLSearchParams(m.groups?.qs || "")); }
    catch (e) { const err = new Error(e.message || String(e)); err.guardrail = !!e.guardrail; throw err; }
  }
  throw new Error(`Unknown request: ${method} ${path}`);
}
