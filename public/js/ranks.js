// ranks.js - daily rank tracking in the browser: the logic is in rank-core.mjs (shared with the weekly check); results are kept here
// (not synced: quick to fetch again) and refreshed once a day.
import * as store from "./store.js";
import * as C from "./rank-core.mjs";
export * from "./rank-core.mjs";
const KEY = id => `ranks:${id}`;
export const get = id => store.get(KEY(id), null);
export async function refresh(id, keywords, queryRange) { const snap = await C.fetchSeries(keywords, queryRange); await store.set(KEY(id), snap); return snap; }
