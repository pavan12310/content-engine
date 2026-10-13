// kwio.js - keyword import (Ahrefs UTF-16 TSV, Semrush, Keyword Planner, plain list) and CSV export
import { parseCsvText } from "./gsc.js";
const ALIASES = { keyword: ["keyword", "keywords", "query", "search term", "term"], volume: ["volume", "search volume", "avg. monthly searches", "avg monthly searches", "sv", "global volume"],
  difficulty: ["difficulty", "kd", "keyword difficulty", "kd %", "kd%", "competition (indexed value)"], business_value: ["business value", "business_value", "value", "priority"],
  intent: ["intent", "search intent", "intents"], notes: ["notes", "note", "comment"], primary_url: ["primary url", "primary_url", "url", "target url", "current url"] };
const IMAP = { informational: "informational", commercial: "commercial", transactional: "transactional", navigational: "navigational", how_to: "how_to", "how-to": "how_to", i: "informational", c: "commercial", t: "transactional", n: "navigational" };
function decode(buf) {
  if ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff)) return new TextDecoder(buf[0] === 0xff ? "utf-16le" : "utf-16be").decode(buf);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch { return new TextDecoder("latin1").decode(buf); }
}
const num = v => { let s = String(v || "").replace(/[,%]/g, "").trim(); if (/^\d.*-/.test(s)) s = s.split("-")[0]; const k = /k$/i.test(s) ? 1000 : 1; const n = parseFloat(s.replace(/k$/i, "")); return isNaN(n) ? null : n * k; };
function splitLine(line) {
  const d = (line.split("\t").length > line.split(",").length) ? "\t" : (line.split(";").length > line.split(",").length ? ";" : ",");
  return d;
}
export function parseText(text) {
  text = text.replace(/^\ufeff/, "");
  const lines = text.split(/\r?\n/).filter(l => l.trim()); if (!lines.length) return [];
  let start = 0, delim = splitLine(lines[0]);
  for (let i = 0; i < Math.min(6, lines.length); i++) {
    const d = splitLine(lines[i]), cells = lines[i].split(d).map(c => c.trim().replace(/^"|"$/g, "").toLowerCase());
    if (cells.some(c => ALIASES.keyword.includes(c))) { start = i; delim = d; break; }
  }
  const body = lines.slice(start).join("\n");
  let rows = delim === "," ? parseCsvText(body) : body.split("\n").map(l => l.split(delim).map(c => c.replace(/^"|"$/g, "")));
  const head = rows[0].map(h => h.trim().toLowerCase());
  const m = {}; for (const [k, al] of Object.entries(ALIASES)) head.forEach((h, i) => { if (al.includes(h) && !(k in m)) m[k] = i; });
  if (!("keyword" in m)) { m.keyword = 0; rows = [["keyword"], ...rows]; }
  const out = [];
  for (const r of rows.slice(1)) {
    const kw = (r[m.keyword] || "").trim().toLowerCase(); if (!kw) continue;
    const it = { keyword: kw };
    for (const f of ["volume", "difficulty", "business_value"]) if (f in m) { const n = num(r[m[f]]); if (n !== null) it[f] = f === "difficulty" ? n : Math.round(n); }
    if ("business_value" in it) it.business_value = Math.max(1, Math.min(5, it.business_value));
    if ("intent" in m) { const first = (r[m.intent] || "").trim().toLowerCase().split(",")[0].trim(); if (IMAP[first]) it.intent = IMAP[first]; }
    for (const f of ["notes", "primary_url"]) if (f in m && (r[m[f]] || "").trim()) it[f] = r[m[f]].trim();
    out.push(it);
  }
  return out;
}
export async function parseFile(file) { return parseText(decode(new Uint8Array(await file.arrayBuffer()))); }
export function toCsv(rows) {
  const cols = ["keyword", "intent", "action", "primary_url", "opportunity", "volume", "difficulty", "business_value", "gsc_impressions", "gsc_clicks", "gsc_position", "reason", "notes"];
  const esc = v => { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  return [cols.join(","), ...rows.map(r => cols.map(c => esc(r[c])).join(","))].join("\n");
}
