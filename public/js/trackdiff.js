// trackdiff.js - tracked changes between an original page and an updated draft: blocks (paragraphs, headings, list items) are matched,
// differences grouped into changes ("hunks") that can each be accepted or rejected, and word-level differences inside changed paragraphs.
export const blocks = md => String(md || "").replace(/\r/g, "").split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
const norm = b => b.replace(/\s+/g, " ").trim();
// longest common subsequence over items, returning the edit script
function lcs(a, b, eq) {
  const n = a.length, m = b.length, dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = eq(a[i], b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops = []; let i = 0, j = 0;
  while (i < n && j < m) { if (eq(a[i], b[j])) { ops.push(["=", a[i], b[j]]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push(["-", a[i++]]); else ops.push(["+", b[j++]]); }
  while (i < n) ops.push(["-", a[i++]]); while (j < m) ops.push(["+", b[j++]]);
  return ops;
}
// the document as a sequence of unchanged blocks and changes; each change = { id, del: [...], ins: [...] }
export function diff(origMd, newMd) {
  const ops = lcs(blocks(origMd).slice(0, 600), blocks(newMd).slice(0, 600), (x, y) => norm(x) === norm(y));
  const seq = []; let cur = null, k = 0;
  for (const [op, x] of ops) {
    if (op === "=") { if (cur) { seq.push(cur); cur = null; } seq.push({ same: x }); continue; }
    if (!cur) cur = { id: `c${++k}`, del: [], ins: [] };
    (op === "-" ? cur.del : cur.ins).push(x);
  }
  if (cur) seq.push(cur);
  // split a change that replaces several blocks one-for-one: each section (a heading with its paragraphs) and each standalone paragraph
  // becomes its own change, so they can be accepted or rejected separately
  const isHead = b => /^#{1,6}\s/.test(b || ""), out = []; let n = 0;
  for (const x of seq) {
    if (x.same != null || x.del.length !== x.ins.length || x.del.length < 2) { out.push(x.same != null ? x : { ...x, id: `c${++n}` }); continue; }
    let part = null;
    x.del.forEach((d, i) => { const head = isHead(d) || isHead(x.ins[i]);
      if (!part || head || !part.section) { if (part) out.push(part); part = { id: `c${++n}`, del: [], ins: [], section: head }; }
      part.del.push(d); part.ins.push(x.ins[i]); });
    if (part) out.push(part);
  }
  return out;
}
// decisions: { c1: "accept" | "reject" }; changes without a decision are accepted
// edits: { c1: "replacement text you wrote" } overrides an accepted change's new text
export function apply(seq, decisions = {}, edits = {}) {
  return seq.flatMap(s => s.same != null ? [s.same] : (decisions[s.id] === "reject" ? s.del : (typeof edits[s.id] === "string" ? [edits[s.id].trim()].filter(Boolean) : s.ins))).join("\n\n");
}
export const changes = seq => seq.filter(s => s.same == null);
// word-level differences for one changed paragraph pair: [["=", text] | ["-", text] | ["+", text]]
export function words(a, b) {
  const A = String(a || "").split(/(\s+)/).filter(Boolean), B = String(b || "").split(/(\s+)/).filter(Boolean);
  if (A.length * B.length > 250000) return [["-", a], ["+", b]];
  const out = []; for (const [op, x, y] of lcs(A, B, (p, q) => p === q)) { const t = op === "+" ? x : x; const last = out[out.length - 1]; if (last && last[0] === op) last[1] += t; else out.push([op, t]); }
  return out;
}
