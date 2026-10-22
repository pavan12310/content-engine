// updates.js - Google ranking updates, read live from the Google Search Status Dashboard (status.search.google.com),
// cached for 12 hours, with the built-in list in rules.js as a fallback when the feed can't be reached.
import { GOOGLE_UPDATES } from "./rules.js";
const FEED = "https://status.search.google.com/incidents.json", KEY = "ce-google-updates", TTL = 12 * 3600e3;
const typeOf = name => /core update/i.test(name) ? "core" : /spam/i.test(name) ? "spam" : "other";
let mem = null;
export async function googleUpdates({ force = false } = {}) {
  if (!force && mem && Date.now() - mem.at < TTL) return mem.list;
  try { const c = JSON.parse(localStorage.getItem(KEY) || "null"); if (!force && c && Date.now() - c.at < TTL) { mem = c; return c.list; } } catch { }
  try {
    const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(FEED, { signal: ctrl.signal }); clearTimeout(t);
    if (!r.ok) throw new Error(String(r.status));
    const data = await r.json(), today = new Date().toISOString().slice(0, 10);
    const live = data.filter(x => (x.affected_products || []).some(p => /ranking/i.test(p.title || "")) && x.begin)
      .map(x => ({ name: x.external_desc, type: typeOf(x.external_desc), start: x.begin.slice(0, 10), end: (x.end || "").slice(0, 10) || today, ongoing: !x.end, source: "google" }));
    const names = new Set(live.map(u => u.name.toLowerCase()));
    const list = [...live, ...GOOGLE_UPDATES.filter(u => !names.has(u.name.toLowerCase()))].sort((a, b) => a.start.localeCompare(b.start));
    mem = { at: Date.now(), list, live: true };
    try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch { }
    return list;
  } catch {
    mem = { at: Date.now() - TTL + 600e3, list: GOOGLE_UPDATES, live: false };   // retry in 10 minutes
    return GOOGLE_UPDATES;
  }
}
export function updatesSource() { return mem ? (mem.live ? "live from Google's Search Status Dashboard" : "built-in list (Google's feed couldn't be reached)") : ""; }
