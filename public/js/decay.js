// decay.js - content decay in the browser: the shared logic lives in decay-core.mjs; results and the month cache are stored here.
import * as store from "./store.js";
export * from "./decay-core.mjs";
const KEY = id => `decay:${id}`;
export const get = id => store.get(KEY(id), null);
export async function save(id, v) { await store.set(KEY(id), v); return v; }
