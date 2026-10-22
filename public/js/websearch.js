// websearch.js - web search for the free AI options, through the site's /api/search function (Tavily or Brave).
// Results are cached for a day so repeated checks don't use up free searches.
import { getSettings, saveSettings, recordUsage } from "./llm.js";
const CACHE = "ce-search-cache", TTL = 24 * 3600e3;
export const SEARCH_PROVIDERS = { tavily: { label: "Tavily", help: "app.tavily.com: 1,000 free searches a month, no card needed" }, brave: { label: "Brave Search", help: "api-dashboard.search.brave.com: about 1,000 searches a month in free credit (card required)" } };
export function searchSettings() { return { provider: "tavily", key: "", team: false, ...(getSettings().search || {}) }; }
export function saveSearchSettings(patch) { const s = getSettings(); s.search = { ...searchSettings(), ...patch }; saveSettings(s); }
export const searchConfigured = () => { const c = searchSettings(); return !!(c.key || c.team); };
const cacheGet = k => { try { const c = JSON.parse(localStorage.getItem(CACHE) || "{}")[k]; return c && Date.now() - c.at < TTL ? c.results : null; } catch { return null; } };
const cacheSet = (k, results) => { try { const c = JSON.parse(localStorage.getItem(CACHE) || "{}"); c[k] = { at: Date.now(), results };
  const keys = Object.keys(c).sort((a, b) => c[b].at - c[a].at); for (const x of keys.slice(150)) delete c[x]; localStorage.setItem(CACHE, JSON.stringify(c)); } catch { } };
export async function webSearch(query, { n = 6, content = false, fresh = false } = {}) {
  const cfg = searchSettings(); if (!cfg.key && !cfg.team) throw new Error("Add a web search key in Settings to use web search with the free AI options.");
  const q = String(query || "").trim().slice(0, 400), ck = `${cfg.provider}|${n}|${content ? 1 : 0}|${q.toLowerCase()}`;
  const hit = fresh ? null : cacheGet(ck); if (hit) return { results: hit, cached: true, provider: cfg.provider };
  const s = getSettings(), headers = { "content-type": "application/json" };
  if (cfg.key) headers["x-search-key"] = cfg.key;
  else { if (s.sync?.teamKey) headers["x-team-key"] = s.sync.teamKey; if (s.crawlToken) headers["x-crawl-token"] = s.crawlToken; }
  let r; try { r = await fetch("/api/search", { method: "POST", headers, body: JSON.stringify({ provider: cfg.provider, query: q, max_results: n, include_content: content }) }); }
  catch { throw new Error("Couldn't reach the search function. Check your connection."); }
  const d = await r.json().catch(() => ({}));
  if (r.status === 404 && !d.error) throw new Error("The web search function isn't deployed yet. Push the latest code to GitHub so Netlify deploys it.");
  recordUsage(`search_${cfg.provider}`, { searches: 1, error: !r.ok });
  if (!r.ok) throw new Error(d.error || `Search failed (${r.status})`);
  cacheSet(ck, d.results || []);
  return { results: d.results || [], cached: false, provider: cfg.provider };
}
// format results for a prompt, numbered so the model can cite them
export function resultsBlock(results, { content = false } = {}) {
  return results.map((x, i) => `[${i + 1}] ${x.title}\nURL: ${x.url}${x.published ? `\nPublished: ${x.published}` : ""}\n${(content && x.content) || x.snippet}`).join("\n\n");
}
