// kb.js - a knowledge base per website: the business's own documents and quick facts.
// Documents are split into passages and ranked with BM25 (a standard search-ranking formula), so each writing step
// gets only the most relevant real material. Stored per website (key kb:<siteId>) and synced with the team like other data.
import * as store from "./store.js";
import { tokens } from "./text.js";

export const KINDS = { product: "Product or service details", case_study: "Case study or customer result", faq: "FAQ or support answers",
  data: "Data, research or statistics", voice: "Brand voice and messaging", policy: "Policies (pricing, shipping, returns, terms)", facts: "Quick facts", other: "Other" };
const key = id => `kb:${id}`;
const words = t => (String(t || "").match(/\S+/g) || []).length;
export const list = async id => (await store.get(key(id), [])) || [];
async function save(id, docs) { await store.set(key(id), docs); INDEX.delete(id); }

export async function add(id, { title, kind = "other", text, source = "paste", url = "" }) {
  text = String(text || "").replace(/\r/g, "").trim(); title = String(title || "").trim().slice(0, 160);
  if (!text) throw new Error("Add some text first.");
  if (text.length > 400000) throw new Error("That document is very long (over 400,000 characters). Split it into smaller parts.");
  const docs = await list(id);
  const doc = { id: store.newId(), title: title || text.split("\n")[0].replace(/^#+\s*/, "").slice(0, 80) || "Untitled", kind: KINDS[kind] ? kind : "other",
    text, source, url, words: words(text), added_at: Date.now(), updated_at: Date.now() };
  docs.unshift(doc); await save(id, docs); return doc;
}
export async function update(id, docId, patch) {
  const docs = await list(id), d = docs.find(x => x.id === docId); if (!d) throw new Error("Document not found.");
  for (const k of ["title", "kind", "text"]) if (patch[k] !== undefined) d[k] = k === "kind" && !KINDS[patch[k]] ? "other" : String(patch[k]);
  d.words = words(d.text); d.updated_at = Date.now(); await save(id, docs); return d;
}
export async function remove(id, docId) { await save(id, (await list(id)).filter(x => x.id !== docId)); }

// ---- quick facts: one "Label: value" per line, kept in a single document of kind "facts" ----
export function parseFacts(text) {
  return String(text || "").split("\n").map(l => l.trim()).filter(Boolean).map(l => { const i = l.indexOf(":");
    return i > 0 ? { label: l.slice(0, i).trim(), value: l.slice(i + 1).trim() } : { label: "", value: l }; }).filter(f => f.value).slice(0, 200);
}
export async function facts(id) { const d = (await list(id)).find(x => x.kind === "facts"); return d ? parseFacts(d.text) : []; }
export async function setFacts(id, text) {
  const docs = await list(id), d = docs.find(x => x.kind === "facts");
  if (d) { d.text = text; d.words = words(text); d.updated_at = Date.now(); }
  else if (text.trim()) docs.unshift({ id: store.newId(), title: "Quick facts", kind: "facts", text, source: "facts", url: "", words: words(text), added_at: Date.now(), updated_at: Date.now() });
  await save(id, docs.filter(x => x.kind !== "facts" || x.text.trim()));
}
export const factsText = fs => fs.map(f => f.label ? `- ${f.label}: ${f.value}` : `- ${f.value}`).join("\n");

// ---- passages: split by headings and paragraphs into ~180-word chunks, each carrying its heading for context ----
export function chunk(doc, target = 180) {
  const out = []; let heading = "", buf = [], n = 0;
  const flush = () => { if (buf.length) { const t = buf.join("\n\n").trim(); if (t) out.push({ doc: doc.id, title: doc.title, kind: doc.kind, heading, text: t }); } buf = []; n = 0; };
  for (const block of String(doc.text).split(/\n\s*\n/)) {
    const b = block.trim(); if (!b) continue;
    const h = b.match(/^#{1,4}\s+(.+)$/m); if (h && b.split("\n").length === 1) { flush(); heading = h[1].trim(); continue; }
    const w = words(b);
    if (w > target * 1.6) {   // a very long paragraph: split by sentences
      flush(); let part = [], pn = 0;
      for (const s of b.split(/(?<=[.!?])\s+/)) { part.push(s); pn += words(s); if (pn >= target) { buf = [part.join(" ")]; flush(); part = []; pn = 0; } }
      if (part.length) { buf = [part.join(" ")]; n = pn; }
      continue;
    }
    if (n + w > target && buf.length) flush();
    buf.push(b); n += w;
  }
  flush(); return out;
}
// ---- BM25 index, cached per website until the documents change ----
const INDEX = new Map();
async function index(id) {
  if (INDEX.has(id)) return INDEX.get(id);
  const docs = (await list(id)).filter(d => d.kind !== "facts"), chunks = docs.flatMap(d => chunk(d));
  const tf = chunks.map(c => { const m = new Map(); for (const t of tokens(`${c.title} ${c.heading} ${c.heading} ${c.text}`)) m.set(t, (m.get(t) || 0) + 1); return m; });
  const df = new Map(); for (const m of tf) for (const t of m.keys()) df.set(t, (df.get(t) || 0) + 1);
  const len = tf.map(m => [...m.values()].reduce((a, b) => a + b, 0)), avg = len.reduce((a, b) => a + b, 0) / (len.length || 1);
  const ix = { chunks, tf, df, len, avg, n: chunks.length }; INDEX.set(id, ix); return ix;
}
export async function search(id, query, k = 5, { kinds = null } = {}) {
  const ix = await index(id); if (!ix.n) return [];
  const q = [...new Set(tokens(query))]; if (!q.length) return [];
  const K1 = 1.4, Bb = 0.75, out = [];
  ix.chunks.forEach((c, i) => {
    if (kinds && !kinds.includes(c.kind)) return;
    let s = 0; for (const t of q) { const f = ix.tf[i].get(t); if (!f) continue;
      const idf = Math.log(1 + (ix.n - (ix.df.get(t) || 0) + 0.5) / ((ix.df.get(t) || 0) + 0.5));
      s += idf * (f * (K1 + 1)) / (f + K1 * (1 - Bb + Bb * ix.len[i] / ix.avg)); }
    if (s > 0) out.push({ ...c, score: Math.round(s * 100) / 100 });
  });
  return out.sort((a, b) => b.score - a.score).slice(0, k);
}
// a ready-to-use block for prompts: facts + the most relevant passages, within a word budget
export async function knowledgeFor(id, query, { k = 6, budgetWords = 1400, withFacts = true } = {}) {
  const fs = withFacts ? await facts(id) : [], hits = await search(id, query, k * 2), picked = []; let used = 0;
  for (const h of hits) { const w = words(h.text); if (picked.length >= k || used + w > budgetWords) continue; picked.push(h); used += w; }
  if (!fs.length && !picked.length) return { text: "", sources: [] };
  const text = [fs.length ? `Quick facts:\n${factsText(fs)}` : "", ...picked.map(h => `[From "${h.title}"${h.heading ? `, ${h.heading}` : ""}]\n${h.text}`)].filter(Boolean).join("\n\n");
  return { text, sources: [...new Set(picked.map(h => h.title))], facts: fs.length };
}
export async function summary(id) {
  const docs = await list(id), fs = await facts(id);
  return { docs: docs.filter(d => d.kind !== "facts").length, words: docs.filter(d => d.kind !== "facts").reduce((t, d) => t + d.words, 0), facts: fs.length,
    by_kind: Object.fromEntries(Object.keys(KINDS).map(k => [k, docs.filter(d => d.kind === k).length]).filter(([, n]) => n)) };
}
