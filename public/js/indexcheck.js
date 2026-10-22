// indexcheck.js - "Is this page in Google?" via Search Console's URL Inspection API (free, 2,000 a day per property).
// The plain-words statuses, history and priorities live in index-core.mjs (shared with the weekly check).
import * as store from "./store.js";
import { explain, merge, due } from "./index-core.mjs";
export { explain, merge, due };
const KEY = id => `index:${id}`;
export const get = id => store.get(KEY(id), null);
export async function run(id, urls, inspectFn, { progress = () => {}, signal = null, force = false, changed = [], declining = [], max = 20, exact = false } = {}) {
  // exact: check exactly these pages (a single-page check), nothing added or reordered
  const prev = (await get(id)) || { results: [], changes: [] }, plan = exact ? { todo: [...urls], skipped: 0 } : due(prev.results, urls, { force, changed, declining });
  const todo = plan.todo.slice(0, max), out = [], errors = []; let i = 0, done = 0;
  const worker = async () => { while (i < todo.length) { if (signal?.aborted) return; const url = todo[i++];
    try { const r = await inspectFn(url); out.push({ url, at: Date.now(), ...explain(r) }); }
    catch (e) { errors.push({ url, error: e.message }); if (/daily inspection limit|can't inspect/.test(e.message)) i = todo.length; }
    progress(`Checked ${++done} of ${todo.length} pages in Google${plan.skipped ? ` (${plan.skipped} checked in the last 3 days, skipped)` : ""}…`); } };
  await Promise.all([worker(), worker(), worker()]);
  const m = merge(prev.results, out);
  const saved = { at: Date.now(), results: m.results, changes: [...m.changes, ...(prev.changes || [])].slice(0, 50), errors, checked: out.length, skipped: plan.skipped };
  await store.set(KEY(id), saved); return saved;
}
